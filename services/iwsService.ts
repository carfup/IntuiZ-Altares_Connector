import { SearchCriteria, Company } from '../types';
import { logger } from '../utils/logger';

// Configuration de l'API IWS-REST
const IWS_BASE_URL = 'https://intuiz.altares.com/iws-rest';
const IWS_USERNAME = '69a01fd31bb041e331dd9a92';
const IWS_PASSWORD = 'kqB5eKJ7BjEYhy!'; // À remplacer par le vrai mot de passe
const REF_CLIENT = '81775918611';

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
  const params = new URLSearchParams({
    refClient: REF_CLIENT,
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
  const credentials = btoa(`${IWS_USERNAME}:${IWS_PASSWORD}`);

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
