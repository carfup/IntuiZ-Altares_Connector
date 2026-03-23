import { SearchFilters, Company } from "../types";

const mockCompanies: Omit<Company, 'id'>[] = [
  {
    siret: "44306184100047",
    companyName: "GOOGLE FRANCE",
    tradeName: "Google",
    address: "8 RUE DE LONDRES",
    postalCode: "75009",
    city: "Paris",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: true,
    websiteUrl: "https://www.google.fr"
  },
  {
    siret: "42449091200047",
    companyName: "MICROSOFT FRANCE",
    tradeName: "Microsoft",
    address: "39 QUAI DU PRESIDENT ROOSEVELT",
    postalCode: "92130",
    city: "Issy-les-Moulineaux",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: true,
    websiteUrl: "https://www.microsoft.fr"
  },
  {
    siret: "38012986649325",
    companyName: "APPLE FRANCE",
    tradeName: "Apple",
    address: "7 PLACE D'IENA",
    postalCode: "75116",
    city: "Paris",
    country: "France",
    isActive: true,
    isHeadquarter: false,
    isInCRM: false,
    websiteUrl: "https://www.apple.com/fr"
  },
  {
    siret: "51890091200035",
    companyName: "AMAZON FRANCE LOGISTIQUE SAS",
    tradeName: "Amazon",
    address: "67 BOULEVARD DU GENERAL LECLERC",
    postalCode: "92110",
    city: "Clichy",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: true,
    websiteUrl: "https://www.amazon.fr"
  },
  {
    siret: "34377929200035",
    companyName: "TOTAL ENERGIES SE",
    tradeName: "TotalEnergies",
    address: "2 PLACE JEAN MILLIER",
    postalCode: "92400",
    city: "Courbevoie",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: false,
    websiteUrl: "https://www.totalenergies.fr"
  },
  {
    siret: "55214862100012",
    companyName: "RENAULT SAS",
    tradeName: "Renault",
    address: "13-15 QUAI LE GALLO",
    postalCode: "92100",
    city: "Boulogne-Billancourt",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: true,
    websiteUrl: "https://www.renault.fr"
  },
  {
    siret: "58201294700016",
    companyName: "L'OREAL",
    tradeName: "L'Oréal",
    address: "41 RUE MARTRE",
    postalCode: "92110",
    city: "Clichy",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: false,
    websiteUrl: "https://www.loreal.com"
  },
  {
    siret: "55200240600059",
    companyName: "SOCIETE GENERALE",
    tradeName: "Société Générale",
    address: "29 BOULEVARD HAUSSMANN",
    postalCode: "75009",
    city: "Paris",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: true,
    websiteUrl: "https://www.societegenerale.fr"
  },
  {
    siret: "13453200200015",
    companyName: "BNP PARIBAS",
    tradeName: "BNP Paribas",
    address: "16 BOULEVARD DES ITALIENS",
    postalCode: "75009",
    city: "Paris",
    country: "France",
    isActive: true,
    isHeadquarter: true,
    isInCRM: false,
    websiteUrl: "https://www.bnpparibas.fr"
  },
  {
    siret: "78987654300012",
    companyName: "ACME INDUSTRIES SARL",
    tradeName: "Acme Industries",
    address: "15 RUE DE LA PAIX",
    postalCode: "69001",
    city: "Lyon",
    country: "France",
    isActive: false,
    isHeadquarter: false,
    isInCRM: false,
    websiteUrl: "https://www.acme-ind.fr"
  },
  {
    siret: "DE123456789",
    companyName: "BMW AG",
    tradeName: "BMW",
    address: "PETUELRING 130",
    postalCode: "80788",
    city: "Munich",
    country: "Germany",
    isActive: true,
    isHeadquarter: true,
    isInCRM: true,
    websiteUrl: "https://www.bmw.de"
  },
  {
    siret: "DE987654321",
    companyName: "SIEMENS AG",
    tradeName: "Siemens",
    address: "WERNER-VON-SIEMENS-STRASSE 1",
    postalCode: "80333",
    city: "Munich",
    country: "Germany",
    isActive: true,
    isHeadquarter: true,
    isInCRM: false,
    websiteUrl: "https://www.siemens.de"
  }
];

export const searchCompanies = async (filters: SearchFilters): Promise<Company[]> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  let filteredCompanies = [...mockCompanies];

  // Apply filters
  if (filters.companyName) {
    filteredCompanies = filteredCompanies.filter(c => 
      c.companyName.toLowerCase().includes(filters.companyName.toLowerCase()) ||
      c.tradeName.toLowerCase().includes(filters.companyName.toLowerCase())
    );
  }

  if (filters.siret) {
    filteredCompanies = filteredCompanies.filter(c => 
      c.siret.toLowerCase().includes(filters.siret.toLowerCase())
    );
  }

  if (filters.city) {
    filteredCompanies = filteredCompanies.filter(c => 
      c.city.toLowerCase().includes(filters.city.toLowerCase())
    );
  }

  if (filters.activeOnly) {
    filteredCompanies = filteredCompanies.filter(c => c.isActive);
  }

  if (filters.headquarterOnly) {
    filteredCompanies = filteredCompanies.filter(c => c.isHeadquarter);
  }

  // Add client-side IDs for React keys
  return filteredCompanies.map((item, index) => ({
    ...item,
    id: `mock-${Date.now()}-${index}`
  }));
};
