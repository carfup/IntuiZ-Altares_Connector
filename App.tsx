import React, { useState, useEffect, useRef } from 'react';
import SearchForm from './components/SearchForm';
import ResultsGrid from './components/ResultsGrid';
import { SearchFilters, Company, PaginationInfo, toSearchCriteria } from './types';
import { rechercheSimple } from './services/iwsService';
import { checkCompaniesInCRM, createAccountInCRM, updateRecordInCRM, setTargetEntitySet } from './services/dataverseService';
import { getBaseUrl } from './services/dataverseClient';
import { loadFieldMappings, AltaresFieldMapping } from './services/mappingService';
import { loadAttributeMetadata, resolveEntityLogicalName, CrmAttributeMetadata } from './services/metadataService';
import { 
  FluentProvider, 
  webLightTheme, 
  makeStyles, 
  tokens,
  Title2,
  Text,
  Avatar,
  Card,
  CardHeader,
  shorthands,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  MessageBarActions,
  Button,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  root: {
    minHeight: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: '0 24px',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  brandIcon: {
    width: '32px',
    height: '32px',
    backgroundColor: tokens.colorBrandBackground,
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForegroundOnBrand,
  },
  main: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '32px 24px',
    flexGrow: 1,
    ...shorthands.gap('24px'),
    display: 'flex',
    flexDirection: 'column',
    '@media (min-width: 768px)': {
      padding: '32px 48px',
    },
    '@media (min-width: 1200px)': {
      padding: '32px 64px',
    },
  },
  welcomeSection: {
    marginBottom: '24px',
  },
  emptyState: {
    marginTop: '48px',
    textAlign: 'center',
    display: 'flex',
    justifyContent: 'center',
  },
  emptyStateCard: {
    ...shorthands.padding('32px'),
    maxWidth: '500px',
    ...shorthands.borderStyle('dashed'),
    ...shorthands.borderWidth('2px'),
    ...shorthands.borderColor(tokens.colorNeutralStroke2),
    backgroundColor: 'transparent',
  },
  footer: {
    padding: '24px',
    textAlign: 'center',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    marginTop: 'auto',
  },
  messageBar: {
    marginBottom: '8px',
  },
});

const App: React.FC = () => {
  const styles = useStyles();
  const [filters, setFilters] = useState<SearchFilters>({
    companyName: '',
    siret: '',
    city: '',
    activeOnly: false,
    headquarterOnly: false,
    maxResults: 10,
  });

  const [results, setResults] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);

  // Altares → CRM field mappings (loaded once from Dataverse)
  const mappingsRef = useRef<AltaresFieldMapping[]>([]);
  // CRM target field metadata (types) for formatting values
  const metadataRef = useRef<Map<string, CrmAttributeMetadata>>(new Map());
  // Entity logical name for CRM record links
  const [targetEntityName, setTargetEntityName] = useState<string>('account');

  useEffect(() => {
    // Read optional ?data= URL param (encoded key-value pairs) to extract targetTable
    // Format: ?data=targetTable%3Daccount (the value after data= is URL-encoded)
    const params = new URLSearchParams(window.location.search);
    const dataParam = params.get('data');
    let targetTable: string | null = null;
    if (dataParam) {
      const decoded = decodeURIComponent(dataParam);
      const dataParams = new URLSearchParams(decoded);
      targetTable = dataParams.get('targetTable');
    }
    if (targetTable) {
      setTargetEntitySet(targetTable);
    }

    const entitySetName = targetTable || 'accounts';

    // Load mappings + attribute metadata in parallel
    const initPromises = Promise.all([
      loadFieldMappings().catch((err) => {
        console.warn('Could not load Altares→CRM mappings — will use fallback', err);
        return [] as AltaresFieldMapping[];
      }),
      resolveEntityLogicalName(entitySetName).catch(() => entitySetName.endsWith('s') ? entitySetName.slice(0, -1) : entitySetName),
    ]);

    initPromises.then(async ([mappings, entityLogicalName]) => {
      mappingsRef.current = mappings;
      setTargetEntityName(entityLogicalName);

      // Extract the CRM field names we need metadata for
      const targetFields = mappings
        .map((m) => m.fieldTo)
        .filter((f): f is string => !!f);

      if (targetFields.length > 0) {
        try {
          const meta = await loadAttributeMetadata(entityLogicalName, targetFields);
          metadataRef.current = meta;
          console.info(`Loaded metadata for ${meta.size} CRM field(s) on entity "${entityLogicalName}"`);
        } catch (err) {
          console.warn('Could not load CRM field metadata — values will be passed as-is', err);
        }
      }
    });
  }, []);

  const handleFilterChange = (key: keyof SearchFilters, value: any) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleReset = () => {
    setFilters({
      companyName: '',
      siret: '',
      city: '',
      activeOnly: false,
      headquarterOnly: false,
      maxResults: 10,
    });
    setResults([]);
    setHasSearched(false);
    setError(null);
    setSuccessMessage(null);
    setPagination(null);
  };

  /**
   * 1. Call the Intuiz IWS API via iwsService to retrieve companies
   * 2. Enrich results with Dataverse CRM presence via dataverseService
   */
  const handleSearch = async (page: number = 1) => {
    // Validate: at least Company Name or Siret must be provided
    if (!filters.companyName.trim() && !filters.siret.trim()) {
      setError('Please provide a Company Name or a SIRET number.');
      return;
    }
    setIsLoading(true);
    setHasSearched(true);
    setError(null);
    setSuccessMessage(null);
    try {
      // Step 1 — Retrieve companies from Intuiz / Altares
      const criteria = toSearchCriteria(filters);
      const debutResultat = (page - 1) * criteria.maxResults;
      const { companies, totalCount } = await rechercheSimple(criteria, debutResultat);

      // Update pagination state
      const totalPages = Math.max(1, Math.ceil(totalCount / criteria.maxResults));
      setPagination({
        currentPage: page,
        pageSize: criteria.maxResults,
        totalCount,
        totalPages,
      });

      // Step 2 — Check which companies already exist in the Dataverse CRM
      //          Uses the dynamic matching fields from the mapping table
      let matchedMap = new Map<string, string>();
      try {
        matchedMap = await checkCompaniesInCRM(companies, mappingsRef.current);
      } catch (crmErr) {
        console.warn('Could not check CRM presence — marking all as external', crmErr);
      }

      // Step 3 — Merge CRM presence flag and record ID into results
      const enriched = companies.map((c) => ({
        ...c,
        isInCRM: matchedMap.has(c.id),
        crmRecordId: matchedMap.get(c.id) || undefined,
      }));

      setResults(enriched);
    } catch (err: any) {
      console.error('Failed to fetch companies', err);
      setError(err?.message || 'An unexpected error occurred while searching.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  /** Navigate to a specific page — re-runs the search with the appropriate offset. */
  const handlePageChange = (page: number) => {
    handleSearch(page);
  };

  /**
   * Create or update selected companies in the Dataverse CRM.
   * - If the record already exists (isInCRM + crmRecordId), update it.
   * - Otherwise, create a new record.
   */
  const handleAddToCRM = async (companyIds: string[]) => {
    setError(null);
    setSuccessMessage(null);
    const selected = results.filter((c) => companyIds.includes(c.id));

    if (selected.length === 0) return;

    let createdCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const company of selected) {
      try {
        if (company.isInCRM && company.crmRecordId) {
          // Update existing record
          await updateRecordInCRM(company, company.crmRecordId, mappingsRef.current, metadataRef.current);
          updatedCount++;
        } else {
          // Create new record
          await createAccountInCRM(company, mappingsRef.current, metadataRef.current);
          createdCount++;
        }
      } catch (err: any) {
        errors.push(`${company.companyName}: ${err?.message || 'Unknown error'}`);
      }
    }

    // Refresh isInCRM flags locally
    if (createdCount > 0) {
      const insertedIds = new Set(
        selected.filter((c) => !c.isInCRM).map((c) => c.id),
      );
      setResults((prev) =>
        prev.map((c) => (insertedIds.has(c.id) ? { ...c, isInCRM: true } : c)),
      );
    }

    // Build success message
    const parts: string[] = [];
    if (createdCount > 0) parts.push(`${createdCount} created`);
    if (updatedCount > 0) parts.push(`${updatedCount} updated`);
    if (parts.length > 0) {
      setSuccessMessage(`${parts.join(', ')} in CRM.`);
    }

    if (errors.length > 0) {
      setError(`Some records failed:\n${errors.join('\n')}`);
    }
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
     

        {/* Main Content */}
        <main className={styles.main}>
      
          <SearchForm 
            filters={filters} 
            onFilterChange={handleFilterChange} 
            onSearch={() => handleSearch(1)}
            onReset={handleReset}
            isLoading={isLoading}
          />

          {error && (
            <MessageBar intent="error" className={styles.messageBar}>
              <MessageBarBody>
                <MessageBarTitle>Error</MessageBarTitle>
                {error}
              </MessageBarBody>
              <MessageBarActions containerAction={
                <Button appearance="transparent" icon={<DismissRegular />} onClick={() => setError(null)} />
              } />
            </MessageBar>
          )}

          {successMessage && (
            <MessageBar intent="success" className={styles.messageBar}>
              <MessageBarBody>
                <MessageBarTitle>Success</MessageBarTitle>
                {successMessage}
              </MessageBarBody>
              <MessageBarActions containerAction={
                <Button appearance="transparent" icon={<DismissRegular />} onClick={() => setSuccessMessage(null)} />
              } />
            </MessageBar>
          )}

          {hasSearched && !isLoading && (
            <ResultsGrid
              data={results}
              onAddToCRM={handleAddToCRM}
              pagination={pagination ?? undefined}
              onPageChange={handlePageChange}
              crmBaseUrl={getBaseUrl()}
              targetEntityName={targetEntityName}
            />
          )}
          
          {!hasSearched && (
            <div className={styles.emptyState}>
              <Card className={styles.emptyStateCard} appearance="subtle">
                <Text size={400} weight="medium" style={{ color: tokens.colorNeutralForeground3 }}>
                  Enter search criteria above to begin exploring the database.
                </Text>
              </Card>
            </div>
          )}
        </main>
        
      
      </div>
    </FluentProvider>
  );
};

export default App;