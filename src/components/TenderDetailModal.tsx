import React, { useId, useMemo, useRef, useState } from 'react';
import type { Company, Project, User } from '../types';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { useFocusTrap } from '../utils/useFocusTrap';
import {
  canDeleteTender,
  formatTenderPercent,
  formatTenderPln,
  formatTenderPricePerUnit,
  formatTenderScope,
  isValidTenderHttpUrl,
  sortComputedBiddersForDetail,
  TENDER_PRICE_BASIS_LABELS,
  TENDER_STATUS_LABELS,
  TenderDetail,
} from '../utils/tenderUi';
import {
  AlertTriangle,
  Ban,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  FolderPlus,
  Link2,
  Trash2,
  Trophy,
  X,
  XCircle,
} from 'lucide-react';

interface TenderDetailModalProps {
  isOpen: boolean;
  tender: TenderDetail | null;
  companies: Company[];
  projects: Project[];
  currentUser: User;
  onClose: () => void;
  onEdit: (tender: TenderDetail) => void;
  onDelete: (tenderId: string) => Promise<void>;
  onCopyToProject: (tender: TenderDetail) => void;
  onOpenProject: (projectId: string) => void;
}

export const TenderDetailModal: React.FC<TenderDetailModalProps> = ({
  isOpen,
  tender,
  companies,
  projects,
  currentUser,
  onClose,
  onEdit,
  onDelete,
  onCopyToProject,
  onOpenProject,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const deleteTitleId = useId();

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const activeDialog = isOpen && Boolean(tender);

  const { backdropProps: detailBackdropProps } = useDismissOnOutsideClick({
    isOpen: activeDialog && !isDeleteConfirmOpen,
    mode: 'dismiss',
    panelRef,
    onDismiss: onClose,
    disabled: isDeleteConfirmOpen || isDeleting,
  });

  useFocusTrap({
    isOpen: activeDialog && !isDeleteConfirmOpen,
    containerRef: panelRef,
    onClose,
    disableEscape: isDeleteConfirmOpen || isDeleting,
  });

  const { backdropProps: deleteBackdropProps, flashClassName: deleteFlashClassName } =
    useDismissOnOutsideClick({
      isOpen: activeDialog && isDeleteConfirmOpen,
      mode: 'form',
      panelRef: deleteDialogRef,
      onDismiss: () => {
        if (!isDeleting) setIsDeleteConfirmOpen(false);
      },
      disabled: isDeleting,
      cancelButtonRef: deleteCancelRef,
    });

  useFocusTrap({
    isOpen: activeDialog && isDeleteConfirmOpen,
    containerRef: deleteDialogRef,
    onClose: () => {
      if (!isDeleting) setIsDeleteConfirmOpen(false);
    },
    disableEscape: isDeleting,
  });

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of companies) {
      if (c && c.id) map.set(c.id, c);
    }
    return map;
  }, [companies]);

  const linkedProject = useMemo(() => {
    if (!tender?.linkedProjectId) return null;
    return projects.find((p) => p && p.id === tender.linkedProjectId) || null;
  }, [projects, tender?.linkedProjectId]);

  const sortedBidders = useMemo(
    () => (tender ? sortComputedBiddersForDetail(tender.bidders) : []),
    [tender]
  );

  if (!activeDialog || !tender) return null;

  const allowDelete = canDeleteTender(currentUser, tender);
  const safeUrl =
    tender.url && tender.url.trim() && isValidTenderHttpUrl(tender.url)
      ? tender.url.trim()
      : null;

  const copyDisabledReason = tender.wonByUs
    ? undefined
    : tender.status !== 'resolved'
      ? 'Kopiowanie do projektu jest dostępne po oznaczeniu statusu przetargu jako „Rozstrzygnięty”.'
      : 'Przycisk jest aktywny wyłącznie wtedy, gdy nasza oferta została wskazana jako zwycięzca przetargu.';

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(tender.id);
      setIsDeleteConfirmOpen(false);
    } catch (err: any) {
      setDeleteError(err?.message || 'Nie udało się usunąć przetargu.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-2xs flex justify-end"
      {...detailBackdropProps}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-3xl h-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Nagłówek szuflady */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {tender.status === 'resolved' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{TENDER_STATUS_LABELS[tender.status]}</span>
                </span>
              ) : tender.status === 'cancelled' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-800">
                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{TENDER_STATUS_LABELS[tender.status]}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{TENDER_STATUS_LABELS[tender.status]}</span>
                </span>
              )}

              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                Ceny: {TENDER_PRICE_BASIS_LABELS[tender.priceBasis]}
              </span>

              {tender.wonByUs && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-sky-100 dark:bg-sky-950/70 text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-800">
                  <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Wygrany przez nas</span>
                </span>
              )}

              {linkedProject && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProject(linkedProject.id);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors"
                >
                  <Link2 className="w-3 h-3" aria-hidden="true" />
                  <span>Projekt: {linkedProject.key}</span>
                </button>
              )}
            </div>

            <h2
              id={titleId}
              className="text-base font-bold text-slate-900 dark:text-white leading-snug break-words"
            >
              {tender.name}
            </h2>

            <p className="text-xs text-slate-700 dark:text-slate-300">
              Zamawiający: <strong className="font-semibold text-slate-900 dark:text-slate-100">{tender.contractingAuthority}</strong>
              {tender.referenceNumber && (
                <>
                  {' · '}Nr ref.: <span className="font-mono">{tender.referenceNumber}</span>
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij szczegóły przetargu"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Treść szuflady */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Terminy i kluczowe wartości */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Harmonogram postępowania</span>
              </div>
              <dl className="space-y-0.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Ogłoszenie:</dt>
                  <dd className="font-mono">{tender.announcementDate || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Składanie ofert:</dt>
                  <dd className="font-mono">{tender.submissionDeadline || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Rozstrzygnięcie:</dt>
                  <dd className="font-mono font-semibold text-slate-900 dark:text-white">
                    {tender.resolutionDate}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Budżet i zakres zamawiającego
              </div>
              <dl className="space-y-0.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">
                    Cena zam. ({TENDER_PRICE_BASIS_LABELS[tender.priceBasis].toLowerCase()}):
                  </dt>
                  <dd className="font-mono font-semibold tabular-nums">
                    {formatTenderPln(tender.authorityBudget)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Zakres:</dt>
                  <dd className="font-mono tabular-nums">
                    {formatTenderScope(tender.scopeQuantity, tender.scopeUnit)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Budżet/jedn.:</dt>
                  <dd className="font-mono tabular-nums">
                    {formatTenderPricePerUnit(tender.authorityBudgetPerUnit, tender.scopeUnit)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Wynik porównawczy
              </div>
              <dl className="space-y-0.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Cena zwycięzcy:</dt>
                  <dd className="font-mono font-semibold tabular-nums">
                    {formatTenderPln(tender.winnerPrice)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">Nasza oferta:</dt>
                  <dd className="font-mono tabular-nums">
                    {tender.ourPrice !== null
                      ? `${formatTenderPln(tender.ourPrice)}${tender.ourRank ? ` (#${tender.ourRank})` : ''}`
                      : 'Brak'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 dark:text-slate-400">% budżetu (zw.):</dt>
                  <dd className="font-mono tabular-nums">
                    {formatTenderPercent(tender.winnerToBudgetPct)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {safeUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-slate-800 dark:text-slate-200 px-3 py-2">
              <ExternalLink className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
              <span className="text-slate-600 dark:text-slate-400 shrink-0">Link do ogłoszenia:</span>
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-700 dark:text-sky-400 hover:underline truncate font-medium"
              >
                {safeUrl}
              </a>
            </div>
          )}

          {(tender.description || tender.notes) && (
            <div className="space-y-3">
              {tender.description && (
                <div className="space-y-1">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Opis przedmiotu zamówienia
                  </h3>
                  <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed bg-slate-50/60 dark:bg-slate-800/30 rounded-lg border border-slate-200/80 dark:border-slate-800 p-3">
                    {tender.description}
                  </p>
                </div>
              )}
              {tender.notes && (
                <div className="space-y-1">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Notatki wewnętrzne
                  </h3>
                  <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed bg-slate-50/60 dark:bg-slate-800/30 rounded-lg border border-slate-200/80 dark:border-slate-800 p-3">
                    {tender.notes}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tabela oferentów posortowana cenowo */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                Złożone oferty ({sortedBidders.length})
              </h3>
              <span className="text-[11px] text-slate-600 dark:text-slate-400">
                Podstawa: {TENDER_PRICE_BASIS_LABELS[tender.priceBasis]}
              </span>
            </div>

            {sortedBidders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-slate-600 dark:text-slate-400">
                Brak zapisanych oferentów dla tego przetargu.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse">
                  <caption className="sr-only">
                    Oferenci w postępowaniu przetargowym {tender.name}, posortowani według ceny
                  </caption>
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px]">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Oferent</th>
                      <th scope="col" className="px-3 py-2 font-semibold text-right">Cena oferty</th>
                      <th scope="col" className="px-3 py-2 font-semibold text-center">Miejsce</th>
                      <th scope="col" className="px-3 py-2 font-semibold text-right">Cena/jedn.</th>
                      <th scope="col" className="px-3 py-2 font-semibold text-right">% budżetu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {sortedBidders.map((bidder) => {
                      const isWinner =
                        tender.status === 'resolved' &&
                        tender.winnerBidderId === bidder.id &&
                        !bidder.isDisqualified;
                      const company = bidder.companyId ? companyMap.get(bidder.companyId) : undefined;
                      const rowBgClass = isWinner
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 text-slate-900 dark:text-slate-100'
                        : bidder.isOurs
                          ? 'bg-sky-50/50 dark:bg-sky-950/20 text-slate-900 dark:text-slate-100'
                          : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200';

                      return (
                        <tr key={bidder.id} className={rowBgClass}>
                          <td className="px-3 py-2.5 align-top">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={
                                  bidder.isDisqualified
                                    ? 'line-through text-slate-500 dark:text-slate-400 font-medium'
                                    : 'font-semibold text-slate-900 dark:text-slate-100'
                                }
                              >
                                {bidder.name}
                              </span>

                              {isWinner && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/70 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
                                  <Trophy className="w-3 h-3" aria-hidden="true" />
                                  <span>Zwycięzca</span>
                                </span>
                              )}

                              {bidder.isOurs && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 dark:bg-sky-900/70 text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-700">
                                  <Building2 className="w-3 h-3" aria-hidden="true" />
                                  <span>
                                    Nasza oferta{company ? ` (${company.letter})` : ''}
                                  </span>
                                </span>
                              )}

                              {bidder.isDisqualified && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/70 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-800">
                                  <Ban className="w-3 h-3" aria-hidden="true" />
                                  <span>Odrzucona</span>
                                </span>
                              )}
                            </div>

                            {bidder.notes && (
                              <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                                {bidder.notes}
                              </div>
                            )}
                          </td>

                          <td
                            className={`px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap align-top ${
                              bidder.isDisqualified
                                ? 'line-through text-slate-500 dark:text-slate-400'
                                : 'font-semibold'
                            }`}
                          >
                            {formatTenderPln(bidder.price)}
                          </td>

                          <td className="px-3 py-2.5 text-center font-mono tabular-nums whitespace-nowrap align-top">
                            {bidder.isDisqualified ? (
                              <span className="text-[11px] text-rose-700 dark:text-rose-300 font-medium">
                                Odrzucona
                              </span>
                            ) : bidder.rank !== null ? (
                              <span className="font-semibold">#{bidder.rank}</span>
                            ) : (
                              '—'
                            )}
                          </td>

                          <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap align-top">
                            {formatTenderPricePerUnit(bidder.pricePerUnit, tender.scopeUnit)}
                          </td>

                          <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap align-top">
                            {formatTenderPercent(bidder.pctOfBudget)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Stopka akcji */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onEdit(tender)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold text-xs transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Edytuj</span>
              </button>

              {allowDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setIsDeleteConfirmOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 font-semibold text-xs transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Usuń</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold text-xs transition-colors"
              >
                Zamknij
              </button>

              <button
                type="button"
                disabled={!tender.wonByUs}
                title={copyDisabledReason}
                onClick={() => onCopyToProject(tender)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold text-xs transition-colors disabled:cursor-not-allowed"
              >
                <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Kopiuj jako projekt</span>
              </button>
            </div>
          </div>

          {!tender.wonByUs && copyDisabledReason && (
            <p className="text-[11px] text-slate-600 dark:text-slate-400 text-right">
              {copyDisabledReason}
            </p>
          )}
        </div>
      </div>

      {/* Okno potwierdzenia usunięcia przetargu */}
      {isDeleteConfirmOpen && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-2xs flex items-center justify-center p-4"
          {...deleteBackdropProps}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            className={`w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-5 shadow-2xl space-y-4 text-xs ${deleteFlashClassName}`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h3 id={deleteTitleId} className="text-sm font-bold text-slate-900 dark:text-white">
                  Usunąć przetarg?
                </h3>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  Czy na pewno chcesz trwale usunąć postępowanie{' '}
                  <strong className="text-slate-900 dark:text-white">{tender.name}</strong>? Tej operacji nie można cofnąć.
                </p>
              </div>
            </div>

            {deleteError && (
              <div
                role="alert"
                className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 px-3 py-2"
              >
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                ref={deleteCancelRef}
                type="button"
                disabled={isDeleting}
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-semibold transition-colors"
              >
                {isDeleting ? 'Usuwanie...' : 'Tak, usuń przetarg'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
