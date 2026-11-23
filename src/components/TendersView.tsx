import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Company, Project, ProjectTemplate, User } from '../types';
import type { NotificationToast } from '../hooks/useAuthSession';
import { getTodayIso } from '../utils/today';
import {
  buildTenderQueryParams,
  exportTendersCsv,
  formatTenderPercent,
  formatTenderPln,
  formatTenderPricePerUnit,
  formatTenderScope,
  INITIAL_TENDER_FILTERS,
  TENDER_PRICE_BASIS_LABELS,
  TENDER_STATUS_LABELS,
  TenderDetail,
  TenderFilterState,
  TenderListItem,
  TenderListResponse,
  TenderSortKey,
  TenderSortOrder,
  TenderSummary,
} from '../utils/tenderUi';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Gavel,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trophy,
  XCircle,
} from 'lucide-react';

const TenderDetailModal = lazy(() =>
  import('./TenderDetailModal').then((m) => ({ default: m.TenderDetailModal }))
);
const TenderFormModal = lazy(() =>
  import('./TenderFormModal').then((m) => ({ default: m.TenderFormModal }))
);
const TenderCopyToProjectModal = lazy(() =>
  import('./TenderCopyToProjectModal').then((m) => ({ default: m.TenderCopyToProjectModal }))
);

interface TendersViewProps {
  companies: Company[];
  projects: Project[];
  currentUser: User;
  onProjectCreated: (params: {
    project: Project;
    revision?: number;
    selectedTemplate?: ProjectTemplate;
  }) => void;
  onOpenProject: (projectId: string) => void;
  onNotify?: (
    message: string,
    type?: NotificationToast['type'],
    action?: NotificationToast['action']
  ) => void;
}

const EMPTY_SUMMARY: TenderSummary = {
  totalCount: 0,
  withScopeCount: 0,
  wonCount: 0,
  wonPercent: 0,
  commonScopeUnit: null,
  winnerPricePerUnit: null,
  winnerPricePerUnitByUnit: {},
};

export const TendersView: React.FC<TendersViewProps> = ({
  companies,
  projects,
  currentUser,
  onProjectCreated,
  onOpenProject,
  onNotify,
}) => {
  const uid = useId();
  const authorityListId = `${uid}-authority-suggestions`;

  const [filters, setFilters] = useState<TenderFilterState>(INITIAL_TENDER_FILTERS);
  const [sortKey, setSortKey] = useState<TenderSortKey>('resolutionDate');
  const [sortOrder, setSortOrder] = useState<TenderSortOrder>('desc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const [items, setItems] = useState<TenderListItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [summary, setSummary] = useState<TenderSummary>(EMPTY_SUMMARY);
  const [knownAuthorities, setKnownAuthorities] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);

  // Modale: szczegóły, tworzenie/edycja, kopiowanie do projektu
  const [detailTender, setDetailTender] = useState<TenderDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);
  const [formState, setFormState] = useState<{
    isOpen: boolean;
    editingTender: TenderDetail | null;
  }>({ isOpen: false, editingTender: null });
  const [copyTargetTender, setCopyTargetTender] = useState<TenderDetail | null>(null);
  const [createdProjectBanner, setCreatedProjectBanner] = useState<Project | null>(null);

  const fetchSeqRef = useRef(0);

  const projectsById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      if (p && p.id) map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const loadTenders = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = buildTenderQueryParams(filters, sortKey, sortOrder, page, pageSize);
      const res = await fetch(`/api/tenders?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as Partial<TenderListResponse> & {
        error?: string;
      };
      if (seq !== fetchSeqRef.current) return;
      if (!res.ok) {
        setLoadError(data?.error || 'Nie udało się pobrać listy przetargów.');
        return;
      }

      const fetchedItems = Array.isArray(data.items) ? data.items : [];
      setItems(fetchedItems);
      setTotal(typeof data.total === 'number' ? data.total : fetchedItems.length);
      setTotalPages(typeof data.totalPages === 'number' && data.totalPages > 0 ? data.totalPages : 1);
      setSummary(data.summary || EMPTY_SUMMARY);

      setKnownAuthorities((prev) => {
        const nextSet = new Set(prev);
        for (const t of fetchedItems) {
          if (t?.contractingAuthority?.trim()) {
            nextSet.add(t.contractingAuthority.trim());
          }
        }
        return Array.from(nextSet).sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' }));
      });
    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      setLoadError(err?.message || 'Błąd połączenia z serwerem podczas pobierania przetargów.');
    } finally {
      if (seq === fetchSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [filters, sortKey, sortOrder, page, pageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadTenders();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loadTenders]);

  const handleFilterChange = <K extends keyof TenderFilterState>(
    key: K,
    value: TenderFilterState[K]
  ) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const hasActiveFilters = useMemo(() => {
    return (
      filters.q.trim() !== '' ||
      filters.authority.trim() !== '' ||
      filters.status !== '' ||
      filters.from.trim() !== '' ||
      filters.to.trim() !== '' ||
      filters.ourOnly ||
      filters.won ||
      filters.minPrice.trim() !== '' ||
      filters.maxPrice.trim() !== ''
    );
  }, [filters]);

  const handleResetFilters = () => {
    setPage(1);
    setFilters(INITIAL_TENDER_FILTERS);
  };

  const handleSort = (key: TenderSortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder(key === 'resolutionDate' ? 'desc' : 'asc');
    }
  };

  const getAriaSort = (key: TenderSortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortOrder === 'asc' ? 'ascending' : 'descending';
  };

  const renderSortIcon = (key: TenderSortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3 h-3 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
    );
  };

  const handleOpenTenderDetail = async (tenderId: string) => {
    setIsDetailLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.tender) {
        onNotify?.(data?.error || 'Nie udało się pobrać szczegółów przetargu.', 'error');
        return;
      }
      setDetailTender(data.tender as TenderDetail);
    } catch (err: any) {
      onNotify?.(err?.message || 'Błąd połączenia przy otwieraniu szczegółów przetargu.', 'error');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleDeleteTender = async (tenderId: string) => {
    const res = await fetch(`/api/tenders/${tenderId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Nie udało się usunąć przetargu.');
    }
    setDetailTender(null);
    onNotify?.('Przetarg został usunięty.', 'success');
    loadTenders();
  };

  const handleTenderSaved = (saved: TenderDetail, isCreate: boolean) => {
    if (saved.contractingAuthority?.trim()) {
      setKnownAuthorities((prev) =>
        prev.includes(saved.contractingAuthority.trim())
          ? prev
          : [...prev, saved.contractingAuthority.trim()].sort((a, b) =>
              a.localeCompare(b, 'pl', { sensitivity: 'base' })
            )
      );
    }
    if (detailTender && detailTender.id === saved.id) {
      setDetailTender(saved);
    }
    onNotify?.(
      isCreate
        ? `Dodano przetarg "${saved.name}".`
        : `Zaktualizowano przetarg "${saved.name}".`,
      'success'
    );
    loadTenders();
  };

  const handleProjectCreatedFromModal = (result: {
    project: Project;
    tender: TenderDetail;
    revision?: number;
    selectedTemplate?: ProjectTemplate;
  }) => {
    onProjectCreated({
      project: result.project,
      revision: result.revision,
      selectedTemplate: result.selectedTemplate,
    });
    if (detailTender && detailTender.id === result.tender.id) {
      setDetailTender(result.tender);
    }
    setCreatedProjectBanner(result.project);
    onNotify?.(
      `Utworzono projekt [${result.project.key}]: ${result.project.name}.`,
      'success',
      {
        label: `Otwórz projekt ${result.project.key}`,
        onClick: () => onOpenProject(result.project.id),
      }
    );
    loadTenders();
  };

  const handleExportCsv = async () => {
    if (isExportingCsv) return;
    setIsExportingCsv(true);
    try {
      const allItems: TenderListItem[] = [];
      let currentFetchPage = 1;
      let fetchedTotalPages = 1;

      do {
        const params = buildTenderQueryParams(filters, sortKey, sortOrder, currentFetchPage, 100);
        const res = await fetch(`/api/tenders?${params.toString()}`, {
          credentials: 'same-origin',
        });
        const data = (await res.json().catch(() => ({}))) as Partial<TenderListResponse> & {
          error?: string;
        };
        if (!res.ok) {
          onNotify?.(data?.error || 'Nie udało się wyeksportować listy przetargów.', 'error');
          return;
        }
        const chunk = Array.isArray(data.items) ? data.items : [];
        allItems.push(...chunk);
        fetchedTotalPages =
          typeof data.totalPages === 'number' && data.totalPages > 0 ? data.totalPages : 1;
        currentFetchPage += 1;
      } while (currentFetchPage <= fetchedTotalPages);

      const csvContent = exportTendersCsv(allItems, companies);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `przetargi-${getTodayIso()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotify?.(`Wyeksportowano ${allItems.length} przetargów do pliku CSV.`, 'success');
    } catch (err: any) {
      onNotify?.(err?.message || 'Błąd podczas generowania pliku CSV.', 'error');
    } finally {
      setIsExportingCsv(false);
    }
  };

  const unitSummaryEntries = useMemo(
    () => Object.values(summary.winnerPricePerUnitByUnit || {}),
    [summary.winnerPricePerUnitByUnit]
  );

  return (
    <div className="space-y-4">
      {/* Nagłówek widoku */}
      <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-200 dark:border-slate-800 px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Gavel className="w-5 h-5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
              Przetargi
            </h1>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Rejestr postępowań przetargowych, analiza cen jednostkowych i tworzenie projektów z wygranych ofert.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isExportingCsv || total === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isExportingCsv ? 'Eksportowanie...' : 'Eksport CSV'}</span>
          </button>

          <button
            type="button"
            onClick={() => setFormState({ isOpen: true, editingTender: null })}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 dark:bg-sky-700 hover:bg-sky-800 dark:hover:bg-sky-600 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Dodaj przetarg</span>
          </button>
        </div>
      </div>

      {/* Baner z bezpośrednim linkiem do nowo utworzonego projektu */}
      {createdProjectBanner && (
        <div
          role="status"
          className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span>
              Utworzono projekt{' '}
              <strong className="font-mono">{createdProjectBanner.key}</strong> — {createdProjectBanner.name}.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenProject(createdProjectBanner.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Otwórz projekt {createdProjectBanner.key}</span>
            </button>
            <button
              type="button"
              onClick={() => setCreatedProjectBanner(null)}
              className="px-2 py-1 rounded text-emerald-900 dark:text-emerald-200 hover:bg-emerald-200/60 dark:hover:bg-emerald-900/50 font-medium"
            >
              Ukryj
            </button>
          </div>
        </div>
      )}

      {/* Karty podsumowania nad tabelą */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-4 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Liczba przetargów
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {summary.totalCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            Z określonym zakresem ilościowym: <span className="font-mono">{summary.withScopeCount}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-4 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Mediana ceny za jednostkę (zwycięzca)
          </div>
          {summary.winnerPricePerUnit ? (
            <>
              <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {formatTenderPricePerUnit(
                  summary.winnerPricePerUnit.median,
                  summary.winnerPricePerUnit.unit
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                Zakres: {formatTenderPln(summary.winnerPricePerUnit.min)} –{' '}
                {formatTenderPln(summary.winnerPricePerUnit.max)} (n={summary.winnerPricePerUnit.count})
              </div>
            </>
          ) : unitSummaryEntries.length > 0 ? (
            <div className="mt-1.5 space-y-0.5 text-xs">
              {unitSummaryEntries.slice(0, 3).map((stat) => (
                <div key={stat.unit} className="flex items-center justify-between gap-2 font-mono tabular-nums">
                  <span className="text-slate-600 dark:text-slate-400">
                    Jedn. {stat.unit} (n={stat.count}):
                  </span>
                  <strong className="text-slate-900 dark:text-white">
                    {formatTenderPricePerUnit(stat.median, stat.unit)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-400">
              Brak danych jednostkowych
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-4 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Wygrane przez nas
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatTenderPercent(summary.wonPercent)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            Wygrane postępowania: <span className="font-mono font-semibold">{summary.wonCount}</span> z{' '}
            <span className="font-mono">{summary.totalCount}</span>
          </div>
        </div>
      </div>

      {/* Pasek filtrów */}
      <section
        aria-label="Filtry przetargów"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 space-y-3 text-xs"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <label htmlFor={`${uid}-q`} className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Szukaj (nazwa, nr ref., oferent)
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                id={`${uid}-q`}
                type="search"
                value={filters.q}
                onChange={(e) => handleFilterChange('q', e.target.value)}
                placeholder="Wpisz frazę..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 pl-8 pr-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${uid}-authority`} className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Zamawiający
            </label>
            <input
              id={`${uid}-authority`}
              type="text"
              list={authorityListId}
              value={filters.authority}
              onChange={(e) => handleFilterChange('authority', e.target.value)}
              placeholder="Wszystkie instytucje..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <datalist id={authorityListId}>
              {knownAuthorities.map((auth) => (
                <option key={auth} value={auth} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor={`${uid}-status`} className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Status
            </label>
            <select
              id={`${uid}-status`}
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value as TenderFilterState['status'])}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">Wszystkie statusy</option>
              <option value="announced">{TENDER_STATUS_LABELS.announced}</option>
              <option value="resolved">{TENDER_STATUS_LABELS.resolved}</option>
              <option value="cancelled">{TENDER_STATUS_LABELS.cancelled}</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-from`} className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Rozstrzygnięcie od
            </label>
            <input
              id={`${uid}-from`}
              type="date"
              value={filters.from}
              onChange={(e) => handleFilterChange('from', e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label htmlFor={`${uid}-to`} className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Rozstrzygnięcie do
            </label>
            <input
              id={`${uid}-to`}
              type="date"
              value={filters.to}
              onChange={(e) => handleFilterChange('to', e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor={`${uid}-minPrice`} className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                Cena zwycięzcy od (zł):
              </label>
              <input
                id={`${uid}-minPrice`}
                type="text"
                inputMode="decimal"
                value={filters.minPrice}
                onChange={(e) => handleFilterChange('minPrice', e.target.value)}
                placeholder="min"
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor={`${uid}-maxPrice`} className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                do (zł):
              </label>
              <input
                id={`${uid}-maxPrice`}
                type="text"
                inputMode="decimal"
                value={filters.maxPrice}
                onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
                placeholder="max"
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.ourOnly}
                onChange={(e) => handleFilterChange('ourOnly', e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Tylko z naszą ofertą
              </span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.won}
                onChange={(e) => handleFilterChange('won', e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Wygrane przez nas
              </span>
            </label>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>Wyczyść filtry</span>
            </button>
          )}
        </div>
      </section>

      {/* Tabela wyników */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 overflow-hidden">
        {loadError ? (
          <div className="p-6 text-center space-y-3 text-xs">
            <div className="inline-flex items-center gap-2 text-rose-800 dark:text-rose-300 font-semibold">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span>{loadError}</span>
            </div>
            <div>
              <button
                type="button"
                onClick={loadTenders}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-700 text-white font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Spróbuj ponownie</span>
              </button>
            </div>
          </div>
        ) : isLoading && items.length === 0 ? (
          <div role="status" className="p-8 text-center text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Wczytywanie przetargów...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center space-y-3 text-xs">
            <p className="text-slate-700 dark:text-slate-300 font-medium">
              {hasActiveFilters
                ? 'Brak przetargów spełniających wybrane kryteria filtrowania.'
                : 'Nie zarejestrowano jeszcze żadnych przetargów.'}
            </p>
            <div className="flex justify-center gap-2">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-semibold"
                >
                  Wyczyść filtry
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setFormState({ isOpen: true, editingTender: null })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dodaj pierwszy przetarg</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <caption className="sr-only">
                  Lista przetargów (znaleziono {total} pozycji)
                </caption>
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th scope="col" aria-sort={getAriaSort('name')} className="px-3 py-2.5 font-semibold">
                      <button
                        type="button"
                        onClick={() => handleSort('name')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Nazwa</span>
                        {renderSortIcon('name')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={getAriaSort('contractingAuthority')} className="px-3 py-2.5 font-semibold">
                      <button
                        type="button"
                        onClick={() => handleSort('contractingAuthority')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Zamawiający</span>
                        {renderSortIcon('contractingAuthority')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={getAriaSort('resolutionDate')} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('resolutionDate')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Data rozstrzygnięcia</span>
                        {renderSortIcon('resolutionDate')}
                      </button>
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap">
                      Status
                    </th>
                    <th scope="col" aria-sort={getAriaSort('authorityBudget')} className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('authorityBudget')}
                        className="inline-flex items-center gap-1 ml-auto hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Cena zamawiającego</span>
                        {renderSortIcon('authorityBudget')}
                      </button>
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      Zakres
                    </th>
                    <th scope="col" aria-sort={getAriaSort('winnerPrice')} className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('winnerPrice')}
                        className="inline-flex items-center gap-1 ml-auto hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Cena zwycięzcy</span>
                        {renderSortIcon('winnerPrice')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={getAriaSort('ourPrice')} className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('ourPrice')}
                        className="inline-flex items-center gap-1 ml-auto hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Nasza oferta</span>
                        {renderSortIcon('ourPrice')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={getAriaSort('winnerPricePerUnit')} className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('winnerPricePerUnit')}
                        className="inline-flex items-center gap-1 ml-auto hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Cena/jedn. (zw.)</span>
                        {renderSortIcon('winnerPricePerUnit')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={getAriaSort('ourPricePerUnit')} className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('ourPricePerUnit')}
                        className="inline-flex items-center gap-1 ml-auto hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Nasza cena/jedn.</span>
                        {renderSortIcon('ourPricePerUnit')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={getAriaSort('winnerToBudgetPct')} className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('winnerToBudgetPct')}
                        className="inline-flex items-center gap-1 ml-auto hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>% ceny zam.</span>
                        {renderSortIcon('winnerToBudgetPct')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {items.map((item) => {
                    const linkedProj = item.linkedProjectId
                      ? projectsById.get(item.linkedProjectId)
                      : undefined;

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                          item.wonByUs
                            ? 'bg-emerald-50/40 dark:bg-emerald-950/20 text-slate-900 dark:text-slate-100'
                            : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <td className="px-3 py-2.5 align-top min-w-[220px]">
                          <div className="space-y-1">
                            <button
                              type="button"
                              onClick={() => handleOpenTenderDetail(item.id)}
                              className="text-left font-semibold text-sky-800 dark:text-sky-300 hover:underline focus:outline-none focus:underline"
                            >
                              {item.name}
                            </button>

                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              {item.referenceNumber && (
                                <span className="font-mono text-slate-600 dark:text-slate-400">
                                  {item.referenceNumber}
                                </span>
                              )}

                              {item.wonByUs && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 font-bold text-[10px]">
                                  <Trophy className="w-3 h-3" aria-hidden="true" />
                                  <span>Wygrany</span>
                                </span>
                              )}

                              {linkedProj && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenProject(linkedProj.id);
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-900 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-mono font-bold text-[10px] hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors"
                                >
                                  <Link2 className="w-2.5 h-2.5" aria-hidden="true" />
                                  <span>Projekt: {linkedProj.key}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-2.5 align-top text-slate-700 dark:text-slate-300 min-w-[160px]">
                          {item.contractingAuthority}
                        </td>

                        <td className="px-3 py-2.5 align-top font-mono tabular-nums whitespace-nowrap">
                          {item.resolutionDate}
                        </td>

                        <td className="px-3 py-2.5 align-top whitespace-nowrap">
                          {item.status === 'resolved' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200">
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>{TENDER_STATUS_LABELS[item.status]}</span>
                            </span>
                          ) : item.status === 'cancelled' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200">
                              <XCircle className="w-3 h-3" aria-hidden="true" />
                              <span>{TENDER_STATUS_LABELS[item.status]}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <span>{TENDER_STATUS_LABELS[item.status]}</span>
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          <div>{formatTenderPln(item.authorityBudget)}</div>
                          {item.authorityBudget !== undefined && (
                            <div className="text-[10px] text-slate-600 dark:text-slate-400">
                              {TENDER_PRICE_BASIS_LABELS[item.priceBasis]}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {formatTenderScope(item.scopeQuantity, item.scopeUnit)}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap font-semibold">
                          {formatTenderPln(item.winnerPrice)}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {item.ourPrice !== null ? (
                            <div>
                              <span className="font-semibold text-sky-800 dark:text-sky-300">
                                {formatTenderPln(item.ourPrice)}
                              </span>
                              {item.ourRank !== null && (
                                <span className="ml-1 text-[11px] text-slate-600 dark:text-slate-400">
                                  (#{item.ourRank})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {formatTenderPricePerUnit(item.winnerPricePerUnit, item.scopeUnit)}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {formatTenderPricePerUnit(item.ourPricePerUnit, item.scopeUnit)}
                        </td>

                        <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums whitespace-nowrap">
                          {formatTenderPercent(item.winnerToBudgetPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginacja */}
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span>
                  Strona <strong className="font-mono text-slate-900 dark:text-white">{page}</strong> z{' '}
                  <strong className="font-mono text-slate-900 dark:text-white">{totalPages}</strong> (łącznie{' '}
                  <strong className="font-mono text-slate-900 dark:text-white">{total}</strong>)
                </span>
                <label className="inline-flex items-center gap-1.5">
                  <span>Na stronie:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 font-semibold transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Poprzednia</span>
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 font-semibold transition-colors"
                >
                  <span>Następna</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {isDetailLoading && (
        <div role="status" className="sr-only">
          Ładowanie szczegółów przetargu...
        </div>
      )}

      <Suspense fallback={null}>
        <TenderDetailModal
          isOpen={Boolean(detailTender)}
          tender={detailTender}
          companies={companies}
          projects={projects}
          currentUser={currentUser}
          onClose={() => setDetailTender(null)}
          onEdit={(t) => {
            setFormState({ isOpen: true, editingTender: t });
          }}
          onDelete={handleDeleteTender}
          onCopyToProject={(t) => setCopyTargetTender(t)}
          onOpenProject={onOpenProject}
        />

        <TenderFormModal
          isOpen={formState.isOpen}
          initialTender={formState.editingTender}
          companies={companies}
          authoritySuggestions={knownAuthorities}
          onClose={() => setFormState({ isOpen: false, editingTender: null })}
          onSaved={handleTenderSaved}
        />

        <TenderCopyToProjectModal
          isOpen={Boolean(copyTargetTender)}
          tender={copyTargetTender}
          companies={companies}
          projects={projects}
          onClose={() => setCopyTargetTender(null)}
          onProjectCreated={handleProjectCreatedFromModal}
        />
      </Suspense>
    </div>
  );
};
