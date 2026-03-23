export interface Company {
  id: string;
  siret: string;
  companyName: string;
  tradeName?: string;
  address: string;
  postalCode: string;
  city: string;
  isActive: boolean;
  isHeadquarter: boolean;
  isInCRM: boolean;
  /** Dataverse record ID when the company already exists in the CRM. */
  crmRecordId?: string;
  websiteUrl?: string;
  country?: string;
  /** Raw key-value bag returned by the Altares IWS API — used for dynamic CRM mapping. */
  rawAltaresData?: Record<string, unknown>;
}

export interface SearchFilters {
  companyName: string;
  siret: string;
  city: string;
  activeOnly: boolean;
  headquarterOnly: boolean;
  maxResults: number;
}

/**
 * Criteria expected by the IWS service — derived from SearchFilters.
 */
export interface SearchCriteria {
  companyName?: string;
  siret?: string;
  city?: string;
  isActive: boolean;
  isHeadquarters: boolean;
  maxResults: number;
}

/** Convert the UI filter bag into IWS search criteria. */
export function toSearchCriteria(f: SearchFilters): SearchCriteria {
  return {
    companyName: f.companyName || undefined,
    siret: f.siret || undefined,
    city: f.city || undefined,
    isActive: f.activeOnly,
    isHeadquarters: f.headquarterOnly,
    maxResults: f.maxResults,
  };
}

export type SortField = keyof Company;
export type SortDirection = 'asc' | 'desc';

/** Pagination state shared between App and ResultsGrid. */
export interface PaginationInfo {
  /** Current page (1-based). */
  currentPage: number;
  /** Records per page (matches maxResults / nbElt). */
  pageSize: number;
  /** Total matching records from the API (nbMatch). */
  totalCount: number;
  /** Computed total number of pages. */
  totalPages: number;
}