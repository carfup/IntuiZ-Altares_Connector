import { dataverseGet } from './dataverseClient';
import { CrmAttributeMetadata, resolveLookupTarget, searchRecordByName } from './metadataService';
import { logger } from '../utils/logger';

// ─── Dataverse entity for Altares ↔ CRM field mapping ────────────────────────
const MAPPING_ENTITY_SET = 'carfup_altaresmappings';

/**
 * A single mapping row: Altares source field → CRM Account target field.
 */
export interface AltaresFieldMapping {
  /** Altares / IWS field name (e.g. "raisonSociale", "codePostal") */
  fieldFrom: string;
  /** CRM Account logical name (e.g. "name", "address1_postalcode"). Null when not yet configured. */
  fieldTo: string | null;
  /** When true, this field pair is used to check if a record already exists in the CRM. */
  useForMatching: boolean;
}

interface ODataCollectionResponse<T = Record<string, unknown>> {
  value: T[];
}

// ─── In-memory cache (loaded once per session) ───────────────────────────────
let cachedMappings: AltaresFieldMapping[] | null = null;

/**
 * Fetch the mapping configuration from the `carfup_altaresmappings` table.
 * Returns only the two useful columns. Results are cached for the session.
 */
export async function loadFieldMappings(): Promise<AltaresFieldMapping[]> {
  if (cachedMappings) {
    return cachedMappings;
  }

  const path = `${MAPPING_ENTITY_SET}?$select=carfup_fieldfrom,carfup_fieldto,carfup_useformatching&$filter=statecode eq 0`;

  try {
    const response = await dataverseGet<ODataCollectionResponse>(path);

    cachedMappings = response.value.map((row) => ({
      fieldFrom: (row['carfup_fieldfrom'] as string) ?? '',
      fieldTo: (row['carfup_fieldto'] as string | null) ?? null,
      useForMatching: (row['carfup_useformatching'] as boolean) ?? false,
    }));

    const matchingCount = cachedMappings.filter((m) => m.useForMatching).length;
    logger.info(
      'Mapping',
      `Loaded ${cachedMappings.length} Altares→CRM mapping(s). ` +
        `${cachedMappings.filter((m) => m.fieldTo).length} have a CRM target configured. ` +
        `${matchingCount} used for matching.`,
    );

    return cachedMappings;
  } catch (error) {
    logger.error('Mapping', 'Failed to load field mappings from Dataverse', error);
    throw error;
  }
}

/**
 * Force-refresh the cache (e.g. after an admin changes the mapping table).
 */
export function clearMappingCache(): void {
  cachedMappings = null;
}

/**
 * Given raw Altares data and the mapping table, build a CRM-ready payload.
 * Only fields where `fieldTo` is configured (non-null / non-empty) are included.
 *
 * When `attributeMetadata` is provided, each value is coerced / formatted
 * to match the CRM target field type (Integer, Decimal, Boolean, DateTime, etc.).
 * Lookup fields are resolved asynchronously by searching the target entity.
 * Without metadata, values are passed through as-is (string).
 */
export async function buildCrmPayload(
  rawAltaresData: Record<string, unknown>,
  mappings: AltaresFieldMapping[],
  attributeMetadata?: Map<string, CrmAttributeMetadata>,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (!mapping.fieldTo) continue; // target not configured yet
    const value = rawAltaresData[mapping.fieldFrom];
    if (value === undefined || value === null || value === '') continue;

    const meta = attributeMetadata?.get(mapping.fieldTo);
    if (meta) {
      const formatted = await formatValueForCrmType(value, meta);
      if (formatted !== undefined) {
        // Lookup bind uses a special key format
        if (formatted && typeof formatted === 'object' && 'bindPath' in (formatted as Record<string, unknown>)) {
          const bind = formatted as { bindPath: string };
          payload[`${mapping.fieldTo}@odata.bind`] = bind.bindPath;
        } else {
          payload[mapping.fieldTo] = formatted;
        }
      }
    } else {
      // No metadata available — pass through as-is (backward compatible)
      payload[mapping.fieldTo] = value;
    }
  }

  return payload;
}

// ─── Value formatting helpers ────────────────────────────────────────────────

/**
 * Coerce / format a raw Altares value to match the expected CRM field type.
 * Returns `undefined` when the value cannot be meaningfully converted.
 * For Lookup fields, returns a `{ bindPath }` object when resolved.
 */
async function formatValueForCrmType(
  rawValue: unknown,
  meta: CrmAttributeMetadata,
): Promise<unknown> {
  const { attributeType: targetType, logicalName: fieldName } = meta;
  try {
    switch (targetType) {
      // --- Text fields ---
      case 'String':
      case 'Memo':
        return String(rawValue);

      // --- Whole numbers ---
      case 'Integer':
      case 'BigInt': {
        const n = Number(rawValue);
        if (Number.isNaN(n)) {
          logger.warn('Mapping', `Cannot convert "${rawValue}" to integer for field "${fieldName}" — skipping.`);
          return undefined;
        }
        return Math.trunc(n);
      }

      // --- Picklist / State / Status (option set fields) ---
      case 'Picklist':
      case 'State':
      case 'Status': {
        // Already a number → use directly
        const n = Number(rawValue);
        if (!Number.isNaN(n)) {
          return Math.trunc(n);
        }
        // Try to resolve a text label to its numeric option value
        if (meta.options && meta.options.length > 0) {
          const label = String(rawValue).toLowerCase().trim();
          const match = meta.options.find((o) => o.label.toLowerCase() === label);
          if (match) {
            logger.debug('Mapping', `Resolved picklist label "${rawValue}" → ${match.value} for field "${fieldName}".`);
            return match.value;
          }
        }
        logger.warn('Mapping', `Cannot resolve "${rawValue}" to an option value for field "${fieldName}" — skipping.`);
        return undefined;
      }

      // --- Decimal / floating-point numbers ---
      case 'Decimal':
      case 'Double': {
        const d = Number(rawValue);
        if (Number.isNaN(d)) {
          logger.warn('Mapping', `Cannot convert "${rawValue}" to decimal for field "${fieldName}" — skipping.`);
          return undefined;
        }
        return d;
      }

      // --- Money ---
      case 'Money': {
        const m = Number(rawValue);
        if (Number.isNaN(m)) {
          logger.warn('Mapping', `Cannot convert "${rawValue}" to money for field "${fieldName}" — skipping.`);
          return undefined;
        }
        // Dataverse accepts decimal values for money fields
        return parseFloat(m.toFixed(4));
      }

      // --- Boolean ---
      case 'Boolean': {
        if (typeof rawValue === 'boolean') return rawValue;
        if (typeof rawValue === 'number') return rawValue !== 0;
        const str = String(rawValue).toLowerCase().trim();
        if (['true', '1', 'yes', 'oui', 'vrai'].includes(str)) return true;
        if (['false', '0', 'no', 'non', 'faux', ''].includes(str)) return false;
        logger.warn('Mapping', `Cannot convert "${rawValue}" to boolean for field "${fieldName}" — skipping.`);
        return undefined;
      }

      // --- Date/Time ---
      case 'DateTime': {
        // Dataverse expects ISO 8601 format (yyyy-MM-ddTHH:mm:ssZ)
        if (rawValue instanceof Date) {
          return rawValue.toISOString();
        }
        const str = String(rawValue).trim();
        // Try to parse various date formats
        const parsed = parseDateValue(str);
        if (parsed) return parsed;
        logger.warn('Mapping', `Cannot convert "${rawValue}" to DateTime for field "${fieldName}" — skipping.`);
        return undefined;
      }

      // --- Lookup / Owner / Customer ---
      // If already a GUID, build the bind path directly.
      // Otherwise, search the target entity by primary name to resolve the GUID.
      case 'Lookup':
      case 'Owner':
      case 'Customer': {
        const strVal = String(rawValue).trim();
        const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strVal);
        const targetEntity = meta.targets?.[0];
        if (!targetEntity) {
          logger.warn('Mapping', `No target entity defined for lookup field "${fieldName}" — skipping.`);
          return undefined;
        }

        const lookupInfo = await resolveLookupTarget(targetEntity);
        if (!lookupInfo) {
          logger.warn('Mapping', `Cannot resolve lookup target "${targetEntity}" for field "${fieldName}" — skipping.`);
          return undefined;
        }

        let guid: string | null;
        if (isGuid) {
          guid = strVal;
        } else {
          guid = await searchRecordByName(lookupInfo, strVal);
          if (guid) {
            logger.debug('Mapping', `Resolved lookup "${strVal}" → ${guid} in ${lookupInfo.entitySetName} for field "${fieldName}".`);
          } else {
            logger.warn('Mapping', `No record found for "${strVal}" in ${lookupInfo.entitySetName} (field "${fieldName}") — skipping.`);
            return undefined;
          }
        }

        return { bindPath: `/${lookupInfo.entitySetName}(${guid})` };
      }

      // --- GUID ---
      case 'UniqueIdentifier':
        return String(rawValue);

      // --- Unknown / unsupported ---
      case 'Unknown':
      default:
        return String(rawValue);
    }
  } catch (err) {
    logger.warn('Mapping', `Error formatting value for field "${fieldName}" (type=${targetType}): ${err}`);
    return undefined;
  }
}

/**
 * Attempt to parse a date string into ISO 8601 format.
 * Supports common patterns:
 * - ISO: "2024-03-15", "2024-03-15T10:30:00"
 * - French: "15/03/2024", "15-03-2024"
 * - Numeric: "20240315"
 */
function parseDateValue(str: string): string | null {
  // Already ISO format
  const isoDate = new Date(str);
  if (!isNaN(isoDate.getTime()) && (str.includes('-') || str.includes('T'))) {
    return isoDate.toISOString();
  }

  // French format: dd/MM/yyyy or dd-MM-yyyy
  const frenchMatch = str.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/);
  if (frenchMatch) {
    const [, day, month, year] = frenchMatch;
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Compact format: yyyyMMdd
  const compactMatch = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

/**
 * Return only the mapping rows that are flagged for matching
 * AND have both fieldFrom and fieldTo configured.
 */
export function getMatchingFields(mappings: AltaresFieldMapping[]): AltaresFieldMapping[] {
  return mappings.filter((m) => m.useForMatching && m.fieldFrom && m.fieldTo);
}
