import React from 'react';
import { SearchFilters } from '../types';
import { 
  Card, 
  CardHeader, 
  Input, 
  Label, 
  Button, 
  Checkbox,
  Dropdown,
  Option,
  makeStyles,
  shorthands,
  tokens,
  Spinner,
  Field
} from '@fluentui/react-components';
import { SearchIcon } from './Icons';
import { ArrowResetRegular } from '@fluentui/react-icons';

interface SearchFormProps {
  filters: SearchFilters;
  onFilterChange: (key: keyof SearchFilters, value: any) => void;
  onSearch: () => void;
  onReset: () => void;
  isLoading: boolean;
}

const MAX_RESULTS_OPTIONS = [10, 20, 50, 100, 150, 200];

const useStyles = makeStyles({
  card: {
    ...shorthands.padding('24px'),
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    ...shorthands.gap('24px'),
    marginBottom: '24px',
  },
  actions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '16px',
  },
  checkboxGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
  },
  maxResultsField: {
    minWidth: '100px',
    maxWidth: '120px',
  },
  searchButton: {
    minWidth: '120px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
  }
});

const SearchForm: React.FC<SearchFormProps> = ({ filters, onFilterChange, onSearch, onReset, isLoading }) => {
  const styles = useStyles();
  const hasCompanyName = !!filters.companyName.trim();
  const hasSiret = !!filters.siret.trim();
  const canSearch = (hasCompanyName || hasSiret) && !isLoading;

  return (
    <Card className={styles.card}>
      <CardHeader 
        header={<h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Company Search Criteria</h2>} 
        style={{ marginBottom: '16px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, paddingBottom: '8px' }}
      />
      
      <div className={styles.grid}>
        {/* Company Name */}
        <Field
          label="Company Name"
          required={!hasSiret}
        >
          <Input
            value={filters.companyName}
            onChange={(e, data) => onFilterChange('companyName', data.value)}
            placeholder="e.g. Acme Corp"
          />
        </Field>

        {/* SIRET */}
        <Field label="SIRET / Registration ID" required={!hasCompanyName}>
          <Input
            value={filters.siret}
            onChange={(e, data) => onFilterChange('siret', data.value)}
            placeholder="e.g. 123 456 789"
          />
        </Field>

        {/* City */}
        <Field label="City">
          <Input
            value={filters.city}
            onChange={(e, data) => onFilterChange('city', data.value)}
            placeholder="e.g. Paris"
          />
        </Field>
      </div>

      <div className={styles.actions}>
        <div className={styles.checkboxGroup}>
          <Checkbox
            checked={filters.activeOnly}
            onChange={(e, data) => onFilterChange('activeOnly', data.checked)}
            label="Active Companies Only"
          />
          <Checkbox
            checked={filters.headquarterOnly}
            onChange={(e, data) => onFilterChange('headquarterOnly', data.checked)}
            label="Headquarters Only"
          />
          <Field label="Max Results" className={styles.maxResultsField}>
            <Dropdown
              value={String(filters.maxResults)}
              selectedOptions={[String(filters.maxResults)]}
              onOptionSelect={(e, data) => onFilterChange('maxResults', Number(data.optionValue))}
              size="small"
            >
              {MAX_RESULTS_OPTIONS.map((n) => (
                <Option key={n} value={String(n)}>
                  {String(n)}
                </Option>
              ))}
            </Dropdown>
          </Field>
        </div>

        <div className={styles.buttonGroup}>
          <Button
            appearance="secondary"
            icon={<ArrowResetRegular />}
            onClick={onReset}
            disabled={isLoading}
            size="large"
          >
            Reset
          </Button>
          <Button
            appearance="primary"
            icon={isLoading ? <Spinner size="tiny" /> : <SearchIcon />}
            onClick={onSearch}
            disabled={!canSearch}
            className={styles.searchButton}
            size="large"
          >
            {isLoading ? 'Searching...' : 'Search Companies'}
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default SearchForm;