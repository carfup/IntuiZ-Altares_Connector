import { Company } from '../types';
import { dataverseGet, dataversePost, dataversePatch, sanitizeODataValue } from './dataverseClient';
import { AltaresFieldMapping, buildCrmPayload, getMatchingFields } from './mappingService';
import { CrmAttributeMetadata } from './metadataService';
import { logger } from '../utils/logger';

// Nom logique de l'entité (pluriel pour OData) et du champ SIRET dans le CRM
const DEFAULT_ENTITY_SET = 'accounts';
const SIRET_FIELD = 'accountnumber';

/** Current target entity set — can be overridden via setTargetEntitySet(). */
let entitySet = DEFAULT_ENTITY_SET;

/**
 * Override the target Dataverse entity set (OData plural name).
 * Called once at app init based on the ?targetTable= URL parameter.
 */
export function setTargetEntitySet(name: string): void {
  entitySet = name;
  logger.info('Dataverse', `Target entity set overridden to "${entitySet}"`);
}

/** Return the current target entity set name. */
export function getTargetEntitySet(): string {
  return entitySet;
}

/**
 * Réponse OData standard pour une requête retrieveMultiple.
 */
interface ODataCollectionResponse<T = Record<string, unknown>> {
  value: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

/**
 * Vérifie quels SIRET existent déjà dans le CRM.
 * Utilise l'API REST Dataverse (GET) avec un filtre OData groupé.
 * Retourne un Set des SIRET trouvés.
 */
export async function checkSiretsInCRM(sirets: string[]): Promise<Set<string>> {
  // Filtrer les SIRET vides ou invalides
  const validSirets = sirets.filter(s => s && s.trim().length > 0);
  if (validSirets.length === 0) return new Set<string>();

  const foundSirets = new Set<string>();
  const BATCH_SIZE = 10;

  for (let i = 0; i < validSirets.length; i += BATCH_SIZE) {
    const batch = validSirets.slice(i, i + BATCH_SIZE);
    const filterParts = batch.map(s => `${SIRET_FIELD} eq '${sanitizeODataValue(s)}'`);
    const filter = filterParts.join(' or ');
    const path = `${entitySet}?$select=${SIRET_FIELD}&$filter=${filter}`;

    try {
      const result = await dataverseGet<ODataCollectionResponse>(path);
      for (const entity of result.value) {
        const siretValue = entity[SIRET_FIELD] as string | undefined;
        if (siretValue) {
          foundSirets.add(siretValue);
        }
      }
    } catch (error) {
      logger.error('Dataverse', 'Erreur lors de la vérification des SIRET:', error);
    }
  }

  logger.info('Dataverse', `${foundSirets.size} SIRET trouvé(s) dans le CRM sur ${validSirets.length} recherché(s).`);
  return foundSirets;
}

/** Max companies per OData RetrieveMultiple call (keeps URL length safe). */
const MATCH_BATCH_SIZE = 20;

/** GUID regex used to extract primary key values from OData responses. */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check which companies already exist in the CRM using the dynamic matching
 * fields defined in the `carfup_altaresmappings` table (useForMatching = true).
 *
 * Builds batched OData filters (compound OR of per-company AND clauses) so that
 * N companies are checked in ~ceil(N / MATCH_BATCH_SIZE) requests instead of N.
 *
 * Falls back to SIRET-only matching when no mapping is provided.
 */
export async function checkCompaniesInCRM(
  companies: Company[],
  mappings: AltaresFieldMapping[],
): Promise<Map<string, string>> {
  const matchingFields = getMatchingFields(mappings);

  // Fallback: no matching fields configured → use classic SIRET check
  if (matchingFields.length === 0) {
    logger.warn('Dataverse', 'No matching fields configured — falling back to SIRET-only matching.');
    const sirets = companies.map((c) => c.siret).filter(Boolean);
    const foundSirets = await checkSiretsInCRM(sirets);
    const result = new Map<string, string>();
    for (const c of companies) {
      if (foundSirets.has(c.siret)) {
        result.set(c.id, ''); // no record ID available in SIRET-only fallback
      }
    }
    return result;
  }

  // CRM fields we need in the response to compare & extract the primary key
  const selectFields = [...new Set(matchingFields.map((m) => m.fieldTo as string))];

  // ── Step 1: Build per-company filter clauses & collect matchable companies ──
  interface CompanyFilter {
    company: Company;
    /** Per-field expected values (CRM field → sanitized value string). */
    expected: Map<string, string>;
    /** Full OData sub-clause: "(field1 eq 'v1' and field2 eq 'v2')" */
    clause: string;
  }

  const companyFilters: CompanyFilter[] = [];

  for (const company of companies) {
    const raw = company.rawAltaresData;
    if (!raw) continue;

    const expected = new Map<string, string>();
    const parts: string[] = [];
    for (const mf of matchingFields) {
      const value = raw[mf.fieldFrom];
      if (value === undefined || value === null || value === '') continue;
      const strValue = String(value);
      expected.set(mf.fieldTo as string, strValue);
      parts.push(`${mf.fieldTo} eq '${sanitizeODataValue(strValue)}'`);
    }

    if (parts.length === 0) continue;

    companyFilters.push({
      company,
      expected,
      clause: parts.length === 1 ? parts[0] : `(${parts.join(' and ')})`,
    });
  }

  if (companyFilters.length === 0) {
    logger.info('Dataverse', 'No companies with usable matching data — skipping CRM check.');
    return new Map<string, string>();
  }

  // ── Step 2: Batch companies & execute one RetrieveMultiple per batch ────────
  const foundMap = new Map<string, string>();

  for (let i = 0; i < companyFilters.length; i += MATCH_BATCH_SIZE) {
    const batch = companyFilters.slice(i, i + MATCH_BATCH_SIZE);
    const combinedFilter = batch.map((cf) => cf.clause).join(' or ');
    const path = `${entitySet}?$select=${selectFields.join(',')}&$filter=${combinedFilter}`;

    try {
      const result = await dataverseGet<ODataCollectionResponse>(path);

      // ── Step 3: Map returned CRM records back to companies in-memory ──
      for (const record of result.value) {
        const recordId = Object.values(record).find(
          (v) => typeof v === 'string' && GUID_RE.test(v),
        ) as string | undefined;

        for (const cf of batch) {
          if (foundMap.has(cf.company.id)) continue; // already matched

          const allMatch = [...cf.expected.entries()].every(([field, expectedVal]) => {
            const crmVal = record[field];
            if (crmVal === undefined || crmVal === null) return false;
            return String(crmVal).toLowerCase() === expectedVal.toLowerCase();
          });

          if (allMatch) {
            foundMap.set(cf.company.id, recordId || '');
          }
        }
      }
    } catch (error) {
      logger.error('Dataverse', `Batch matching query failed (batch ${Math.floor(i / MATCH_BATCH_SIZE) + 1}):`, error);
    }
  }

  logger.info(
    'Dataverse',
    `${foundMap.size} record(s) found in the CRM out of ${companies.length} checked ` +
      `(${Math.ceil(companyFilters.length / MATCH_BATCH_SIZE)} query/queries for ${companyFilters.length} matchable companies).`,
  );
  return foundMap;
}

/**
 * Crée un enregistrement dans le CRM target table à partir d'une Company.
 * Uses the dynamic Altares→CRM mapping table to build the payload.
 * Falls back to hard-coded fields when no mapping is provided or rawAltaresData is absent.
 * Retourne l'ID du record créé.
 */
export async function createAccountInCRM(
  company: Company,
  mappings?: AltaresFieldMapping[],
  attributeMetadata?: Map<string, CrmAttributeMetadata>,
): Promise<string> {
  let body: Record<string, unknown>;

  if (mappings && mappings.length > 0 && company.rawAltaresData) {
    // Dynamic mapping from the carfup_altaresmappings table, with type-aware formatting
    body = await buildCrmPayload(company.rawAltaresData, mappings, attributeMetadata);
    logger.info('Dataverse', `Dynamic mapping produced ${Object.keys(body).length} field(s) for SIRET ${company.siret}`);
  } else {
    // Fallback — hard-coded mapping (backward-compatible)
    body = {
      name: company.companyName,
      address1_line1: company.address,
      address1_postalcode: company.postalCode,
      address1_city: company.city,
    };
  }

  try {
    const result = await dataversePost<Record<string, string>>(entitySet, body);
    // The primary key field name varies by entity; grab the first GUID-like value
    const recordId = Object.values(result).find((v) => typeof v === 'string' && v.length === 36) || 'unknown';
    logger.info('Dataverse', `Record créé avec succès in ${entitySet} — ID: ${recordId}`);
    return recordId;
  } catch (error) {
    logger.error('Dataverse', `Erreur lors de la création dans ${entitySet}:`, error);
    throw new Error(`Impossible de créer le record dans ${entitySet}.`);
  }
}

/**
 * Met à jour un enregistrement existant dans le CRM target table.
 * Uses the dynamic Altares→CRM mapping table to build the payload.
 * Falls back to hard-coded fields when no mapping is provided or rawAltaresData is absent.
 */
export async function updateRecordInCRM(
  company: Company,
  crmRecordId: string,
  mappings?: AltaresFieldMapping[],
  attributeMetadata?: Map<string, CrmAttributeMetadata>,
): Promise<void> {
  let body: Record<string, unknown>;

  if (mappings && mappings.length > 0 && company.rawAltaresData) {
    body = await buildCrmPayload(company.rawAltaresData, mappings, attributeMetadata);
    logger.info('Dataverse', `Dynamic mapping produced ${Object.keys(body).length} field(s) for update on ${crmRecordId}`);
  } else {
    body = {
      name: company.companyName,
      address1_line1: company.address,
      address1_postalcode: company.postalCode,
      address1_city: company.city,
    };
  }

  const path = `${entitySet}(${crmRecordId})`;
  try {
    await dataversePatch(path, body);
    logger.info('Dataverse', `Record updated in ${entitySet} — ID: ${crmRecordId}`);
  } catch (error) {
    logger.error('Dataverse', `Error updating record ${crmRecordId} in ${entitySet}:`, error);
    throw new Error(`Failed to update record ${crmRecordId} in ${entitySet}.`);
  }
}
