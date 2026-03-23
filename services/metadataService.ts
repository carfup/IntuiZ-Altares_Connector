import { dataverseGet, sanitizeODataValue } from './dataverseClient';
import { logger } from '../utils/logger';

// ─── Dataverse attribute types (from EntityDefinitions/Attributes API) ────────
// Reference: https://github.com/allandecastro/dataverse-erd-visualizer/blob/main/src/services/dataverseApi.ts

/**
 * Simplified attribute type system — mirrors what the Dataverse Web API returns
 * in the `AttributeType` property of EntityDefinitions/Attributes.
 */
export type CrmFieldType =
  | 'String'
  | 'Memo'
  | 'Integer'
  | 'BigInt'
  | 'Decimal'
  | 'Double'
  | 'Money'
  | 'Boolean'
  | 'DateTime'
  | 'Picklist'
  | 'Lookup'
  | 'Owner'
  | 'Customer'
  | 'State'
  | 'Status'
  | 'UniqueIdentifier'
  | 'Unknown';

/** A single option in a Picklist / State / Status field. */
export interface PicklistOption {
  value: number;
  label: string;
}

/** Information about one CRM attribute retrieved from entity metadata. */
export interface CrmAttributeMetadata {
  logicalName: string;
  attributeType: CrmFieldType;
  displayName?: string;
  /** For Lookup/Customer/Owner attributes — target entity names. */
  targets?: string[];
  /** For Picklist/State/Status attributes — available option values. */
  options?: PicklistOption[];
}

/** Resolved information about a lookup target entity. */
export interface LookupEntityInfo {
  entityLogicalName: string;
  entitySetName: string;
  primaryNameAttribute: string;
}

/** Raw attribute shape returned by the Dataverse Metadata API. */
interface DataverseAttributeResponse {
  '@odata.type'?: string;
  LogicalName: string;
  AttributeType: string;
  DisplayName?: {
    UserLocalizedLabel?: {
      Label: string;
    };
  };
  Targets?: string[];
  [key: string]: unknown;
}

/** Raw picklist attribute shape returned by the Dataverse OptionSet expansion. */
interface PicklistAttributeResponse {
  LogicalName: string;
  OptionSet?: {
    Options: {
      Value: number;
      Label?: {
        UserLocalizedLabel?: {
          Label: string;
        };
      };
    }[];
  };
}

// ─── In-memory cache (keyed by entity logical name) ──────────────────────────
const metadataCache = new Map<string, Map<string, CrmAttributeMetadata>>();

/**
 * Map the raw Dataverse AttributeType string to our simplified enum.
 * Handles both standard form ("String") and legacy form ("StringType").
 */
function mapAttributeType(raw: string): CrmFieldType {
  const typeMap: Record<string, CrmFieldType> = {
    // Standard (without "Type" suffix)
    String: 'String',
    Memo: 'Memo',
    Integer: 'Integer',
    BigInt: 'BigInt',
    Decimal: 'Decimal',
    Double: 'Double',
    Money: 'Money',
    Boolean: 'Boolean',
    DateTime: 'DateTime',
    Picklist: 'Picklist',
    Lookup: 'Lookup',
    Owner: 'Owner',
    Customer: 'Customer',
    State: 'State',
    Status: 'Status',
    Uniqueidentifier: 'UniqueIdentifier',
    // Legacy (with "Type" suffix)
    StringType: 'String',
    MemoType: 'Memo',
    IntegerType: 'Integer',
    BigIntType: 'BigInt',
    DecimalType: 'Decimal',
    DoubleType: 'Double',
    MoneyType: 'Money',
    BooleanType: 'Boolean',
    DateTimeType: 'DateTime',
    PicklistType: 'Picklist',
    LookupType: 'Lookup',
    OwnerType: 'Owner',
    CustomerType: 'Customer',
    StateType: 'State',
    StatusType: 'Status',
    UniqueidentifierType: 'UniqueIdentifier',
  };

  return typeMap[raw] || 'Unknown';
}

/**
 * Fetch attribute metadata for a given entity from the Dataverse EntityDefinitions API.
 * Follows the approach from https://github.com/allandecastro/dataverse-erd-visualizer.
 *
 * Results are cached per entity for the lifetime of the session.
 *
 * @param entityLogicalName — Singular logical name (e.g. "account", NOT "accounts")
 * @param fieldLogicalNames — Optional: restrict to only these fields (performance)
 */
export async function loadAttributeMetadata(
  entityLogicalName: string,
  fieldLogicalNames?: string[],
): Promise<Map<string, CrmAttributeMetadata>> {
  // Return from cache if already loaded
  const cached = metadataCache.get(entityLogicalName);
  if (cached) {
    return cached;
  }

  // Build the Metadata API query
  // e.g. EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,AttributeType,DisplayName
  let query =
    `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes` +
    `?$select=LogicalName,AttributeType,DisplayName`;

  // If specific fields are requested, filter for them to reduce response size
  if (fieldLogicalNames && fieldLogicalNames.length > 0) {
    const filterParts = fieldLogicalNames.map((f) => `LogicalName eq '${f}'`);
    query += `&$filter=${filterParts.join(' or ')}`;
  }

  try {
    const response = await dataverseGet<{ value: DataverseAttributeResponse[] }>(query);
    const attrMap = new Map<string, CrmAttributeMetadata>();

    for (const attr of response.value) {
      attrMap.set(attr.LogicalName, {
        logicalName: attr.LogicalName,
        attributeType: mapAttributeType(attr.AttributeType),
        displayName: attr.DisplayName?.UserLocalizedLabel?.Label,
        targets: attr.Targets,
      });
    }

    // Load picklist / state / status option values in a separate call
    await loadPicklistOptions(entityLogicalName, attrMap);

    metadataCache.set(entityLogicalName, attrMap);
    logger.info(
      'Metadata',
      `Loaded ${attrMap.size} attribute(s) for entity "${entityLogicalName}".`,
    );

    return attrMap;
  } catch (error) {
    logger.error(
      'Metadata',
      `Failed to load attribute metadata for entity "${entityLogicalName}"`,
      error,
    );
    throw error;
  }
}

/**
 * Fetch OptionSet values for all Picklist / State / Status attributes and
 * merge them into the already-loaded attribute metadata map.
 */
async function loadPicklistOptions(
  entityLogicalName: string,
  attrMap: Map<string, CrmAttributeMetadata>,
): Promise<void> {
  const picklistFields = [...attrMap.values()].filter(
    (a) => a.attributeType === 'Picklist' || a.attributeType === 'State' || a.attributeType === 'Status',
  );
  if (picklistFields.length === 0) return;

  try {
    const query =
      `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes/` +
      `Microsoft.Dynamics.CRM.PicklistAttributeMetadata` +
      `?$select=LogicalName&$expand=OptionSet($select=Options)`;

    const response = await dataverseGet<{ value: PicklistAttributeResponse[] }>(query);

    let enriched = 0;
    for (const attr of response.value) {
      const meta = attrMap.get(attr.LogicalName);
      if (!meta || !attr.OptionSet?.Options) continue;

      meta.options = attr.OptionSet.Options
        .map((opt) => ({
          value: opt.Value,
          label: opt.Label?.UserLocalizedLabel?.Label ?? '',
        }))
        .filter((o) => o.label !== '');

      if (meta.options.length > 0) enriched++;
    }

    logger.info('Metadata', `Enriched ${enriched} picklist attribute(s) with option values for "${entityLogicalName}".`);
  } catch (error) {
    logger.warn('Metadata', `Could not load picklist options for "${entityLogicalName}" — label-based matching will be unavailable.`, error);
  }
}

/** Clear the metadata cache (e.g. when the target entity changes). */
export function clearMetadataCache(): void {
  metadataCache.clear();
  lookupEntityCache.clear();
}

// ─── Lookup target resolution ────────────────────────────────────────────────

const lookupEntityCache = new Map<string, LookupEntityInfo>();

/**
 * Resolve the EntitySetName and PrimaryNameAttribute for a given entity.
 * Results are cached per entity for the session lifetime.
 */
export async function resolveLookupTarget(entityLogicalName: string): Promise<LookupEntityInfo | null> {
  const cached = lookupEntityCache.get(entityLogicalName);
  if (cached) return cached;

  try {
    const response = await dataverseGet<{ EntitySetName: string; PrimaryNameAttribute: string }>(
      `EntityDefinitions(LogicalName='${entityLogicalName}')?$select=EntitySetName,PrimaryNameAttribute`,
    );

    const info: LookupEntityInfo = {
      entityLogicalName,
      entitySetName: response.EntitySetName,
      primaryNameAttribute: response.PrimaryNameAttribute,
    };
    lookupEntityCache.set(entityLogicalName, info);
    logger.info('Metadata', `Resolved lookup target "${entityLogicalName}" → set="${info.entitySetName}", primaryName="${info.primaryNameAttribute}".`);
    return info;
  } catch (error) {
    logger.warn('Metadata', `Could not resolve lookup target entity "${entityLogicalName}".`, error);
    return null;
  }
}

/**
 * Search for a record in a target entity by its primary name attribute.
 * Returns the record GUID if found, or null.
 */
export async function searchRecordByName(
  lookupInfo: LookupEntityInfo,
  nameValue: string,
): Promise<string | null> {
  const filter = `${lookupInfo.primaryNameAttribute} eq '${sanitizeODataValue(nameValue)}'`;
  const path = `${lookupInfo.entitySetName}?$select=${lookupInfo.primaryNameAttribute}&$filter=${filter}&$top=1`;

  try {
    const result = await dataverseGet<{ value: Record<string, unknown>[] }>(path);
    if (result.value.length === 0) return null;

    const record = result.value[0];
    const guid = Object.values(record).find(
      (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    ) as string | undefined;
    return guid ?? null;
  } catch (error) {
    logger.warn('Metadata', `Lookup search failed for "${nameValue}" in ${lookupInfo.entitySetName}.`, error);
    return null;
  }
}

/**
 * Resolve the singular entity logical name from the OData entity set name.
 * Convention: most Dataverse entity sets are just the plural (adding "s" or "es").
 * For custom entities this is usually <prefix>_<name> (singular) → <prefix>_<name>es (plural).
 *
 * We query EntityDefinitions to find the exact match.
 */
export async function resolveEntityLogicalName(entitySetName: string): Promise<string> {
  try {
    const response = await dataverseGet<{ value: { LogicalName: string }[] }>(
      `EntityDefinitions?$select=LogicalName&$filter=EntitySetName eq '${entitySetName}'&$top=1`,
    );
    if (response.value.length > 0) {
      return response.value[0].LogicalName;
    }
  } catch (error) {
    logger.warn('Metadata', `Could not resolve entity logical name from set "${entitySetName}", will try fallback.`, error);
  }

  // Fallback: naive plural stripping (accounts → account, contacts → contact)
  if (entitySetName.endsWith('ies')) return entitySetName.slice(0, -3) + 'y';
  if (entitySetName.endsWith('ses')) return entitySetName.slice(0, -2);
  if (entitySetName.endsWith('s')) return entitySetName.slice(0, -1);
  return entitySetName;
}
