import { dataverseGet } from './dataverseClient';
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

/** Information about one CRM attribute retrieved from entity metadata. */
export interface CrmAttributeMetadata {
  logicalName: string;
  attributeType: CrmFieldType;
  displayName?: string;
  /** For Lookup/Customer/Owner attributes — target entity names. */
  targets?: string[];
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

/** Clear the metadata cache (e.g. when the target entity changes). */
export function clearMetadataCache(): void {
  metadataCache.clear();
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
