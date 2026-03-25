import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Company, SortField, SortDirection, PaginationInfo } from '../types';
import { 
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
  TableSelectionCell,
  Badge,
  Button,
  Avatar,
  Card,
  Text,
  makeStyles,
  shorthands,
  tokens,
  Tooltip,
  Link
} from '@fluentui/react-components';
import { 
  DatabaseIcon, 
  ChevronUpIcon, 
  ChevronDownIcon, 
  ChevronUpDownIcon,
  PlusIcon,
  HeadquarterIcon,
  BranchIcon,
  CheckCircleIcon,
  LinkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from './Icons';

interface ResultsGridProps {
  data: Company[];
  /** Called when the user clicks "Add" with the IDs of selected companies. */
  onAddToCRM?: (companyIds: string[]) => Promise<void>;
  /** Pagination state — when provided, pagination controls are displayed. */
  pagination?: PaginationInfo;
  /** Called when the user navigates to a different page. */
  onPageChange?: (page: number) => void;
  /** D365 org base URL for building CRM record links. */
  crmBaseUrl?: string;
  /** Entity logical name (etn) for CRM record links. */
  targetEntityName?: string;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
  },
  tableContainer: {
    overflowX: 'auto',
  },
  footer: {
    padding: '16px 24px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
  },
  footerSticky: {
    padding: '16px 24px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99,
    boxShadow: tokens.shadow16,
  },
  footerSentinel: {
    height: '1px',
  },
  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  footerRight: {
    display: 'flex',
    gap: '12px',
  },
  noResults: {
    padding: '48px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow2,
  },
  iconContainer: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
  },
  headerCellContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    userSelect: 'none',
    ':hover': {
      color: tokens.colorBrandForeground1,
    }
  },
  siret: {
    fontFamily: 'monospace',
    color: tokens.colorNeutralForeground2,
  },
  flagIcon: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: '20px',
  },
  flagIconInactive: {
    color: tokens.colorNeutralForeground3,
    fontSize: '20px',
  },
  activeBadge: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground1,
    ...shorthands.borderColor('transparent')
  },
  inactiveBadge: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1,
    ...shorthands.borderColor('transparent')
  },
  paginationBar: {
    padding: '12px 24px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '4px',
  },
  pageButton: {
    minWidth: '32px',
  },
  pageButtonActive: {
    minWidth: '32px',
    fontWeight: tokens.fontWeightSemibold as any,
  },
  paginationInfo: {
    margin: '0 12px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
});

const ResultsGrid: React.FC<ResultsGridProps> = ({ data, onAddToCRM, pagination, onPageChange, crmBaseUrl, targetEntityName }) => {
  const styles = useStyles();
  const [sortConfig, setSortConfig] = useState<{ key: SortField; direction: SortDirection } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [isFooterSticky, setIsFooterSticky] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Use IntersectionObserver to detect when the footer's natural position is off-screen
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsFooterSticky(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data]);

  // Sorting Logic
  const handleSort = (key: SortField) => {
    let direction: SortDirection = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedData = useMemo(() => {
    if (!data) return [];
    let sortableItems = [...data];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        if (typeof aValue === 'string' && typeof bValue === 'string') {
           return sortConfig.direction === 'asc' 
             ? aValue.localeCompare(bValue) 
             : bValue.localeCompare(aValue);
        }
        
        if (aValue === bValue) return 0;
        if (sortConfig.direction === 'asc') {
            return aValue < bValue ? -1 : 1;
        } else {
            return aValue > bValue ? -1 : 1;
        }
      });
    }
    return sortableItems;
  }, [data, sortConfig]);

  // Selection Logic
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedData.map(c => c.id)));
    }
  };

  const getSortIcon = (key: SortField) => {
    if (sortConfig?.key !== key) return <ChevronUpDownIcon style={{ opacity: 0.2 }} />;
    return sortConfig.direction === 'asc' 
      ? <ChevronUpIcon style={{ color: tokens.colorBrandForeground1 }} /> 
      : <ChevronDownIcon style={{ color: tokens.colorBrandForeground1 }} />;
  };

  const SortableHeader: React.FC<{ label: string; sortKey?: SortField; centered?: boolean }> = ({ label, sortKey, centered }) => (
    <TableHeaderCell onClick={() => sortKey && handleSort(sortKey)}>
      <div className={styles.headerCellContent} style={{ justifyContent: centered ? 'center' : 'flex-start' }}>
        {label}
        {sortKey && getSortIcon(sortKey)}
      </div>
    </TableHeaderCell>
  );

  if (data.length === 0) {
    return (
      <div className={styles.noResults}>
        <div className={styles.iconContainer}>
          <DatabaseIcon style={{ fontSize: '32px' }} />
        </div>
        <Text size={500} weight="semibold">No results found</Text>
        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
          Try adjusting your search filters to find companies.
        </Text>
      </div>
    );
  }

  /** Build an array of page numbers to display (with ellipsis gaps). */
  const getPageNumbers = (): (number | '...')[] => {
    if (!pagination || pagination.totalPages <= 1) return [];
    const { currentPage, totalPages } = pagination;
    const pages: (number | '...')[] = [];
    const delta = 2; // pages around the current one

    // Always show first page
    pages.push(1);

    const rangeStart = Math.max(2, currentPage - delta);
    const rangeEnd = Math.min(totalPages - 1, currentPage + delta);

    if (rangeStart > 2) pages.push('...');
    for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
    if (rangeEnd < totalPages - 1) pages.push('...');

    // Always show last page
    if (totalPages > 1) pages.push(totalPages);
    return pages;
  };

  const allSelected = sortedData.length > 0 && selectedIds.size === sortedData.length;

  return (
    <div className={styles.root}>
      <div className={styles.tableContainer}>
        <Table size="medium" aria-label="Company search results">
          <TableHeader>
            <TableRow>
              <TableSelectionCell 
                checked={allSelected}
                onClick={toggleSelectAll}
                checkboxIndicator={{ "aria-label": "Select all rows" }}
              />
              <SortableHeader label="SIRET" sortKey="siret" />
              <SortableHeader label="Company" sortKey="companyName" />
          
              <SortableHeader label="Address" sortKey="address" />
              <SortableHeader label="Postal Code" sortKey="postalCode" />
              <TableHeaderCell style={{ width: '80px' }} onClick={() => handleSort('isActive')}>
                <div className={styles.headerCellContent}>Status {getSortIcon('isActive')}</div>
              </TableHeaderCell>
              <TableHeaderCell style={{ width: '50px' }} onClick={() => handleSort('isHeadquarter')}>
                <div className={styles.headerCellContent}>HQ {getSortIcon('isHeadquarter')}</div>
              </TableHeaderCell>
              <TableHeaderCell style={{ width: '60px' }} onClick={() => handleSort('isInCRM')}>
                <div className={styles.headerCellContent}>Source {getSortIcon('isInCRM')}</div>
              </TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((company) => {
              const isSelected = selectedIds.has(company.id);
              return (
                <TableRow key={company.id} appearance={isSelected ? "brand" : "none"}>
                  <TableSelectionCell
                    checked={isSelected}
                    onClick={() => toggleSelection(company.id)}
                    checkboxIndicator={{ "aria-label": "Select row" }}
                  />
                  
                  <TableCell>
                    <span className={styles.siret}>{company.siret}</span>
                  </TableCell>
                  
                  <TableCell>
                    <Text weight="medium">{company.companyName}</Text>
                  </TableCell>
                  
                
                  
                  <TableCell>
                    <div style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={company.address}>
                      {company.address}
                    </div>
                  </TableCell>
                  
                  <TableCell>{company.postalCode}</TableCell>
                  
                  <TableCell>
                    {company.isActive ? (
                      <Badge shape="rounded" appearance="tint" className={styles.activeBadge}>Active</Badge>
                    ) : (
                      <Badge shape="rounded" appearance="tint" className={styles.inactiveBadge}>Inactive</Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    {company.isHeadquarter ? (
                       <Tooltip content="Headquarters" relationship="label">
                         <HeadquarterIcon className={styles.flagIcon} />
                       </Tooltip>
                    ) : (
                       <Tooltip content="Branch Office" relationship="label">
                         <BranchIcon className={styles.flagIconInactive} />
                       </Tooltip>
                    )}
                  </TableCell>

                  <TableCell>
                    {company.isInCRM && company.crmRecordId ? (
                      <Tooltip content="Open in CRM" relationship="label">
                        <Link
                          href={`${crmBaseUrl || ''}/main.aspx?pagetype=entityrecord&etn=${targetEntityName || 'account'}&id=${company.crmRecordId}`}
                          target="_blank"
                          style={{ display: 'inline-flex', alignItems: 'center' }}
                        >
                          <CheckCircleIcon style={{ color: tokens.colorPaletteGreenForeground1, fontSize: '20px' }} />
                        </Link>
                      </Tooltip>
                    ) : (
                      <Tooltip content="External Source" relationship="label">
                         <LinkIcon style={{ color: tokens.colorNeutralForeground3, fontSize: '20px', cursor: 'pointer' }} />
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Footer Actions */}
      <div className={isFooterSticky ? styles.footerSticky : styles.footer}>
         <div className={styles.footerLeft}>
             <Text>Showing {data.length}{pagination ? ` of ${pagination.totalCount}` : ''} results</Text>
             <Text>|</Text>
             <Text>{selectedIds.size} selected</Text>
             {pagination && pagination.totalPages > 1 && (
               <>
                 <Text>|</Text>
                 <Text>Page {pagination.currentPage} of {pagination.totalPages}</Text>
               </>
             )}
         </div>

         <div className={styles.footerRight}>
            <Button 
              appearance="primary"
              disabled={selectedIds.size === 0 || isAdding}
              icon={<PlusIcon />}
              onClick={async () => {
                if (!onAddToCRM) return;
                setIsAdding(true);
                try {
                  await onAddToCRM(Array.from(selectedIds));
                  setSelectedIds(new Set());
                } finally {
                  setIsAdding(false);
                }
              }}
            >
              {isAdding ? 'Adding…' : 'Add to CRM'}
            </Button>
         </div>
      </div>

      {/* Sentinel element to detect when footer scrolls into view */}
      <div ref={sentinelRef} className={styles.footerSentinel} />
      {/* Spacer when footer is sticky so content isn't hidden behind it */}
      {isFooterSticky && <div style={{ height: '64px' }} />}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && onPageChange && (
        <div className={styles.paginationBar}>
          <Button
            appearance="subtle"
            icon={<ChevronDoubleLeftIcon />}
            disabled={pagination.currentPage <= 1}
            onClick={() => onPageChange(1)}
            aria-label="First page"
            size="small"
          />
          <Button
            appearance="subtle"
            icon={<ChevronLeftIcon />}
            disabled={pagination.currentPage <= 1}
            onClick={() => onPageChange(pagination.currentPage - 1)}
            aria-label="Previous page"
            size="small"
          />

          {getPageNumbers().map((page, idx) =>
            page === '...' ? (
              <Text key={`ellipsis-${idx}`} className={styles.paginationInfo}>…</Text>
            ) : (
              <Button
                key={page}
                appearance={page === pagination.currentPage ? 'primary' : 'subtle'}
                className={page === pagination.currentPage ? styles.pageButtonActive : styles.pageButton}
                onClick={() => onPageChange(page)}
                size="small"
              >
                {page}
              </Button>
            )
          )}

          <Button
            appearance="subtle"
            icon={<ChevronRightIcon />}
            disabled={pagination.currentPage >= pagination.totalPages}
            onClick={() => onPageChange(pagination.currentPage + 1)}
            aria-label="Next page"
            size="small"
          />
          <Button
            appearance="subtle"
            icon={<ChevronDoubleRightIcon />}
            disabled={pagination.currentPage >= pagination.totalPages}
            onClick={() => onPageChange(pagination.totalPages)}
            aria-label="Last page"
            size="small"
          />
        </div>
      )}
    </div>
  );
};

export default ResultsGrid;