import { SearchCriteria, Company } from '../types';
import { dataverseGet } from './dataverseClient';
import { logger } from '../utils/logger';

// Configuration de l'API IWS-REST
const IWS_BASE_URL = 'https://intuiz.altares.com/iws-rest';

// --- Credentials loaded from Dataverse environment variable ---

interface IWSCredentials {
  login: string;
  password: string;
  refClient: string;
}

/** Cached credentials promise — resolved once, then reused. */
let credentialsPromise: Promise<IWSCredentials> | null = null;

/**
 * Fetch IntuiZ credentials from the Dataverse environment variable
 * `carfup_IntuiZCredentials`. The value must be a JSON string containing
 * { login, password, refClient }.
 */
async function fetchCredentials(): Promise<IWSCredentials> {
  logger.info('IWS', 'Loading IntuiZ credentials from Dataverse environment variable...');

  interface EnvVarValue { value?: string }
  interface EnvVarDefinition {
    defaultvalue?: string;
    environmentvariabledefinition_environmentvariablevalue?: EnvVarValue[];
  }
  interface ODataResult { value: EnvVarDefinition[] }

  const path =
    "environmentvariabledefinitions?$filter=schemaname eq 'carfup_IntuiZCredentials'" +
    '&$select=defaultvalue' +
    '&$expand=environmentvariabledefinition_environmentvariablevalue($select=value)';

  const result = await dataverseGet<ODataResult>(path);

  if (!result.value || result.value.length === 0) {
    throw new Error(
      'Dataverse environment variable "carfup_IntuiZCredentials" not found. ' +
      'Please create it in your environment with the required JSON value.',
    );
  }

  const definition = result.value[0];
  // Current value takes precedence over default value
  const rawValue =
    definition.environmentvariabledefinition_environmentvariablevalue?.[0]?.value
    ?? definition.defaultvalue;

  if (!rawValue) {
    throw new Error(
      'Dataverse environment variable "carfup_IntuiZCredentials" exists but has no value. ' +
      'Please set a JSON value containing { login, password, refClient }.',
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(
      'Dataverse environment variable "carfup_IntuiZCredentials" contains invalid JSON.',
    );
  }

  const { login, password, refClient } = parsed as Record<string, string>;

  if (!login || typeof login !== 'string') {
    throw new Error('Environment variable "carfup_IntuiZCredentials" is missing a valid "login" field.');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Environment variable "carfup_IntuiZCredentials" is missing a valid "password" field.');
  }
  if (!refClient || typeof refClient !== 'string') {
    throw new Error('Environment variable "carfup_IntuiZCredentials" is missing a valid "refClient" field.');
  }

  logger.info('IWS', 'IntuiZ credentials loaded successfully from environment variable.');
  return { login, password, refClient };
}

/**
 * Returns the cached IWS credentials, fetching them on first call.
 * Call `resetCredentials()` to force a re-fetch (e.g. after an auth failure).
 */
function getCredentials(): Promise<IWSCredentials> {
  if (!credentialsPromise) {
    credentialsPromise = fetchCredentials();
  }
  return credentialsPromise;
}

/** Force re-fetching credentials on the next call. */
export function resetCredentials(): void {
  credentialsPromise = null;
}

export interface IWSSearchParams {
  qui?: string;        // Company name
  siret?: string;      // SIRET number  
  ou?: string;         // City
  rechercheActif: boolean;
  rechercheSiege: boolean;
  nbElt?: number;
  debutResultat?: number;
  elargie?: boolean;
}

export interface IWSCompanyResult {
  identifiantInterne?: string;
  siret?: string;
  raisonSociale?: string;
  rue?: string;
  codePostal?: string;
  ville?: string;
  siege?: boolean;
  actif?: boolean;
  // Autres champs possibles de l'API
  [key: string]: any;
}

export interface IWSSearchResponse {
  myInfo?: IWSCompanyResult[];
  nbResultats?: number;
  nbMatch?: number;
  // Autres champs de réponse
  [key: string]: any;
}

/** Paginated result returned by rechercheSimple. */
export interface PaginatedResult {
  companies: Company[];
  /** Total number of matching records reported by the API (nbMatch). */
  totalCount: number;
}

/**
 * Effectue une recherche simple via l'API IWS-REST.
 * Accepts the SearchCriteria interface (use toSearchCriteria() to convert from SearchFilters).
 */
export async function rechercheSimple(criteria: SearchCriteria, debutResultat: number = 0): Promise<PaginatedResult> {
  // Fetch credentials from Dataverse environment variable (cached after first call)
  const creds = await getCredentials();

  const params = new URLSearchParams({
    refClient: creds.refClient,
    categorieItemADeselectionner: 'false',
    categorieItemId: '',
    contexteRecherche: '',
    debutResultat: String(debutResultat || 0),
    elargie: 'true',
    nbElt: String(criteria.maxResults || 10),
    rechercheActif: criteria.isActive ? 'true' : 'false',
    rechercheSiege: criteria.isHeadquarters ? 'true' : 'false',
  });

  // Build search parameters based on which fields are filled:
  // - If only Siret is provided, use it as the 'qui' (name) parameter
  // - If both Company Name and Siret are provided, search by name and filter by siret
  // - City narrows down results when provided alongside name/siret
  const hasCompanyName = !!(criteria.companyName && criteria.companyName.trim());
  const hasSiret = !!(criteria.siret && criteria.siret.trim());

  if (hasCompanyName) {
    params.append('qui', criteria.companyName!.trim());
    if (hasSiret) {
      params.append('siret', criteria.siret!.trim());
    }
  } else if (hasSiret) {
    // Only SIRET provided — use it as the 'qui' query
    params.append('qui', criteria.siret!.trim());
  }

  if (criteria.city && criteria.city.trim()) {
    params.append('ou', criteria.city.trim());
  }

  const url = `${IWS_BASE_URL}/recherche-simple?${params.toString()}`;
  
  // Créer les credentials en Base64 pour Basic Auth
  const credentials = btoa(`${creds.login}:${creds.password}`);

  logger.info('IWS', `API Call: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`IWS API Error: ${response.status} ${response.statusText}`);
    }

    const data: IWSSearchResponse = await response.json();
    logger.info('IWS', `API returned ${data.nbResultats ?? 0} result(s), nbMatch=${data.nbMatch ?? 'N/A'}`);

    // Transformer les résultats IWS en format Company
    const companies = mapIWSResultsToCompanies(data);
    return {
      companies,
      totalCount: data.nbMatch ?? data.nbResultats ?? companies.length,
    };
  } catch (error) {
    logger.error('IWS', 'Erreur lors de l\'appel IWS', error);
    throw error;
  }
}

/**
 * Transforme les résultats de l'API IWS en objets Company.
 * Maps IWS fields → canonical Company interface.
 */
function mapIWSResultsToCompanies(response: IWSSearchResponse): Company[] {
  if (!response.myInfo || !Array.isArray(response.myInfo)) {
    return [];
  }

  return response.myInfo.map((etab, index) => {
    // Preserve the entire raw Altares object for dynamic CRM mapping
    const { identifiantInterne, ...rawFields } = etab;
    return {
      id: identifiantInterne || String(index + 1),
      siret: etab.siret || '',
      companyName: etab.raisonSociale || '',
      address: etab.rue || '',
      postalCode: etab.codePostal || '',
      city: etab.ville || '',
      isHeadquarter: etab.siege ?? false,
      isActive: etab.actif ?? true,
      isInCRM: false, // Will be enriched later by Dataverse lookup
      rawAltaresData: rawFields,
    };
  });
}
