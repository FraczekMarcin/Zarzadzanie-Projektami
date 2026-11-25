import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Company, TenderPriceBasis, TenderStatus } from '../types';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { useFocusTrap } from '../utils/useFocusTrap';
import { parseApiErrorResponse, useFormSubmit } from '../hooks/useFormSubmit';
import { DiscardChangesModal } from './DiscardChangesModal';
import { FormError } from './FormError';
import {
  formatQuantity,
  MONEY_PRECISION_ERROR,
  parseMoney,
  parseQuantity,
  QUANTITY_PRECISION_ERROR,
} from '../utils/money';
import { getTodayIso } from '../utils/today';
import {
  COMMON_SCOPE_UNITS,
  computeLiveBidderPreview,
  formatTenderPercent,
  formatTenderPricePerUnit,
  isValidTenderHttpUrl,
  TENDER_PRICE_BASIS_LABELS,
  TENDER_STATUS_LABELS,
  TenderDetail,
} from '../utils/tenderUi';
import { Plus, RefreshCw, Trash2, Trophy, X } from 'lucide-react';

interface BidderFormRow {
  id: string;
  name: string;
  priceText: string;
  isOurs: boolean;
  companyId: string;
  isDisqualified: boolean;
  notes: string;
}

interface TenderFormState {
  name: string;
  contractingAuthority: string;
  referenceNumber: string;
  description: string;
  url: string;
  announcementDate: string;
  submissionDeadline: string;
  resolutionDate: string;
  status: TenderStatus;
  priceBasis: TenderPriceBasis;
  authorityBudgetText: string;
  scopeQuantityText: string;
  scopeUnit: string;
  notes: string;
  winnerBidderId: string;
  bidders: BidderFormRow[];
}

interface TenderFormModalProps {
  isOpen: boolean;
  initialTender: TenderDetail | null;
  companies: Company[];
  authoritySuggestions: string[];
  onClose: () => void;
  onSaved: (saved: TenderDetail, isCreate: boolean, revision?: number) => void;
}

function createBidderRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toInputDecimal(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '';
  return val.toFixed(2).replace('.', ',');
}

function createInitialFormState(tender: TenderDetail | null): TenderFormState {
  if (!tender) {
    return {
      name: '',
      contractingAuthority: '',
      referenceNumber: '',
      description: '',
      url: '',
      announcementDate: '',
      submissionDeadline: '',
      resolutionDate: getTodayIso(),
      status: 'announced',
      priceBasis: 'gross',
      authorityBudgetText: '',
      scopeQuantityText: '',
      scopeUnit: '',
      notes: '',
      winnerBidderId: '',
      bidders: [],
    };
  }

  return {
    name: tender.name || '',
    contractingAuthority: tender.contractingAuthority || '',
    referenceNumber: tender.referenceNumber || '',
    description: tender.description || '',
    url: tender.url || '',
    announcementDate: tender.announcementDate || '',
    submissionDeadline: tender.submissionDeadline || '',
    resolutionDate: tender.resolutionDate || getTodayIso(),
    status: tender.status,
    priceBasis: tender.priceBasis,
    authorityBudgetText: toInputDecimal(tender.authorityBudget),
    scopeQuantityText:
      tender.scopeQuantity !== undefined && tender.scopeQuantity !== null
        ? formatQuantity(tender.scopeQuantity)
        : '',
    scopeUnit: tender.scopeUnit || '',
    notes: tender.notes || '',
    winnerBidderId: tender.winnerBidderId || '',
    bidders: (tender.bidders || []).map((b) => ({
      id: b.id,
      name: b.name || '',
      priceText: toInputDecimal(b.price),
      isOurs: Boolean(b.isOurs),
      companyId: b.companyId || '',
      isDisqualified: Boolean(b.isDisqualified),
      notes: b.notes || '',
    })),
  };
}

export const TenderFormModal: React.FC<TenderFormModalProps> = ({
  isOpen,
  initialTender,
  companies,
  authoritySuggestions,
  onClose,
  onSaved,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const uid = useId();
  const authorityListId = `${uid}-authorities`;
  const unitListId = `${uid}-units`;

  const [form, setForm] = useState<TenderFormState>(() => createInitialFormState(initialTender));
  const [baselineSnapshot, setBaselineSnapshot] = useState<string>('');
  const [tenderRevision, setTenderRevision] = useState<number>(initialTender?.revision || 1);
  const saveSubmit = useFormSubmit();
  const errorAlertId = `${uid}-error`;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictTender, setConflictTender] = useState<TenderDetail | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const init = createInitialFormState(initialTender);
    setForm(init);
    setBaselineSnapshot(JSON.stringify(init));
    setTenderRevision(initialTender?.revision || 1);
    saveSubmit.clearError();
    setFieldErrors({});
    setConflictTender(null);
  }, [isOpen, initialTender, saveSubmit.clearError]);

  const isDirty = useMemo(() => {
    if (!isOpen || !baselineSnapshot) return false;
    return JSON.stringify(form) !== baselineSnapshot;
  }, [isOpen, form, baselineSnapshot]);

  const {
    backdropProps,
    flashClassName,
    requestClose,
    isDiscardModalOpen,
    confirmDiscard,
    cancelDiscard,
  } = useDismissOnOutsideClick({
    isOpen,
    mode: 'form',
    panelRef,
    onDismiss: onClose,
    isDirty,
    disabled: saveSubmit.isSubmitting,
    cancelButtonRef,
  });

  useFocusTrap({
    isOpen: isOpen && !isDiscardModalOpen,
    containerRef: panelRef,
    onClose: requestClose,
    disableEscape: saveSubmit.isSubmitting || isDiscardModalOpen,
  });

  const selectableCompanies = useMemo(() => {
    const active = companies.filter((c) => c.isActive);
    const activeIds = new Set(active.map((c) => c.id));
    const extras = companies.filter(
      (c) => !activeIds.has(c.id) && form.bidders.some((b) => b.companyId === c.id)
    );
    return [...active, ...extras].sort((a, b) => a.letter.localeCompare(b.letter, 'pl'));
  }, [companies, form.bidders]);

  const parsedBudgetPreview = useMemo(() => {
    if (!form.authorityBudgetText.trim()) return null;
    return parseMoney(form.authorityBudgetText);
  }, [form.authorityBudgetText]);

  const parsedScopePreview = useMemo(() => {
    if (!form.scopeQuantityText.trim()) return null;
    return parseQuantity(form.scopeQuantityText);
  }, [form.scopeQuantityText]);

  if (!isOpen) return null;

  const isEditing = Boolean(initialTender);

  const handleApplyConflictLatest = () => {
    if (!conflictTender) return;
    const refreshed = createInitialFormState(conflictTender);
    setForm(refreshed);
    setBaselineSnapshot(JSON.stringify(refreshed));
    setTenderRevision(conflictTender.revision || 1);
    setConflictTender(null);
    saveSubmit.clearError();
    setFieldErrors({});
    onSaved(conflictTender, false);
  };

  const handleAddBidder = () => {
    if (form.bidders.length >= 50) {
      saveSubmit.setValidationError('Przetarg może zawierać maksymalnie 50 oferentów.');
      return;
    }
    setForm((prev) => ({
      ...prev,
      bidders: [
        ...prev.bidders,
        {
          id: createBidderRowId(),
          name: '',
          priceText: '',
          isOurs: false,
          companyId: '',
          isDisqualified: false,
          notes: '',
        },
      ],
    }));
  };

  const handleRemoveBidder = (bidderId: string) => {
    setForm((prev) => ({
      ...prev,
      winnerBidderId: prev.winnerBidderId === bidderId ? '' : prev.winnerBidderId,
      bidders: prev.bidders.filter((b) => b.id !== bidderId),
    }));
  };

  const updateBidderRow = (bidderId: string, updater: (row: BidderFormRow) => BidderFormRow) => {
    setForm((prev) => {
      const nextBidders = prev.bidders.map((b) => (b.id === bidderId ? updater(b) : b));
      const changed = nextBidders.find((b) => b.id === bidderId);
      let finalBidders = nextBidders;
      if (changed?.isOurs) {
        finalBidders = nextBidders.map((b) =>
          b.id === bidderId ? b : { ...b, isOurs: false, companyId: '' }
        );
      }
      const nextWinner =
        changed?.isDisqualified && prev.winnerBidderId === bidderId ? '' : prev.winnerBidderId;
      return {
        ...prev,
        bidders: finalBidders,
        winnerBidderId: nextWinner,
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveSubmit.clearError();
    const errors: Record<string, string> = {};

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      errors.name = 'Podaj nazwę przetargu.';
    } else if (trimmedName.length > 200) {
      errors.name = 'Nazwa przetargu może mieć maksymalnie 200 znaków.';
    }

    const trimmedAuth = form.contractingAuthority.trim();
    if (!trimmedAuth) {
      errors.contractingAuthority = 'Podaj nazwę zamawiającego.';
    } else if (trimmedAuth.length > 200) {
      errors.contractingAuthority = 'Nazwa zamawiającego może mieć maksymalnie 200 znaków.';
    }

    if (!form.resolutionDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.resolutionDate)) {
      errors.resolutionDate = 'Podaj prawidłową datę rozstrzygnięcia (RRRR-MM-DD).';
    }

    if (form.url.trim() && !isValidTenderHttpUrl(form.url)) {
      errors.url = 'Adres URL musi zaczynać się od http:// lub https://.';
    }

    let authorityBudget: number | null = null;
    if (form.authorityBudgetText.trim()) {
      const parsed = parseMoney(form.authorityBudgetText);
      if (parsed === null || parsed > 999_999_999.99) {
        errors.authorityBudget = MONEY_PRECISION_ERROR;
      } else {
        authorityBudget = parsed;
      }
    }

    let scopeQuantity: number | null = null;
    if (form.scopeQuantityText.trim()) {
      const parsed = parseQuantity(form.scopeQuantityText);
      if (parsed === null) {
        errors.scopeQuantity = QUANTITY_PRECISION_ERROR;
      } else {
        scopeQuantity = parsed;
      }
    }

    const validatedBidders: Array<{
      id: string;
      name: string;
      price?: number;
      isOurs: boolean;
      companyId?: string;
      isDisqualified?: boolean;
      notes?: string;
    }> = [];

    for (let i = 0; i < form.bidders.length; i++) {
      const row = form.bidders[i];
      const bName = row.name.trim();
      if (!bName) {
        errors[`bidder_name_${row.id}`] = `Podaj nazwę oferenta nr ${i + 1}.`;
      } else if (bName.length > 200) {
        errors[`bidder_name_${row.id}`] = 'Nazwa oferenta może mieć maksymalnie 200 znaków.';
      }

      let price: number | undefined;
      if (row.priceText.trim()) {
        const parsed = parseMoney(row.priceText);
        if (parsed === null || parsed > 999_999_999.99) {
          errors[`bidder_price_${row.id}`] = MONEY_PRECISION_ERROR;
        } else {
          price = parsed;
        }
      }

      validatedBidders.push({
        id: row.id,
        name: bName,
        ...(price !== undefined ? { price } : {}),
        isOurs: row.isOurs,
        ...(row.isOurs && row.companyId ? { companyId: row.companyId } : {}),
        ...(row.isDisqualified ? { isDisqualified: true } : {}),
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
      });
    }

    const effectiveWinnerId =
      form.status === 'resolved' && form.winnerBidderId ? form.winnerBidderId : null;
    if (effectiveWinnerId) {
      const winnerRow = validatedBidders.find((b) => b.id === effectiveWinnerId);
      if (!winnerRow) {
        errors.winnerBidderId = 'Wskazany zwycięzca nie znajduje się na liście oferentów.';
      } else if (winnerRow.isDisqualified) {
        errors.winnerBidderId = 'Zdyskwalifikowany oferent nie może zostać zwycięzcą.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      saveSubmit.setValidationError(
        'Popraw zaznaczone błędy w formularzu przed zapisaniem.',
        Object.keys(errors)[0]
      );
      return;
    }

    setFieldErrors({});
    setConflictTender(null);

    await saveSubmit.submit(
      async () => {
        const payload = {
          name: trimmedName,
          contractingAuthority: trimmedAuth,
          referenceNumber: form.referenceNumber.trim() || null,
          description: form.description.trim() || null,
          url: form.url.trim() || null,
          announcementDate: form.announcementDate.trim() || null,
          submissionDeadline: form.submissionDeadline.trim() || null,
          resolutionDate: form.resolutionDate.trim(),
          status: form.status,
          priceBasis: form.priceBasis,
          authorityBudget,
          scopeQuantity,
          scopeUnit: form.scopeUnit.trim() || null,
          notes: form.notes.trim() || null,
          bidders: validatedBidders,
          winnerBidderId: effectiveWinnerId,
        };

        const endpoint = isEditing ? `/api/tenders/${initialTender!.id}` : '/api/tenders';
        const method = isEditing ? 'PATCH' : 'POST';
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (isEditing) {
          headers['If-Match'] = String(tenderRevision);
        }

        const res = await fetch(endpoint, {
          method,
          credentials: 'same-origin',
          headers,
          body: JSON.stringify(payload),
        });

        if (res.status === 409) {
          const clone = res.clone();
          const conflictData = await clone.json().catch(() => null);
          if (conflictData?.currentTender) {
            setConflictTender(conflictData.currentTender as TenderDetail);
            return {
              ok: false,
              status: 409,
              error:
                conflictData.error ||
                'Konflikt wersji przetargu: ktoś inny zapisał zmiany w tym czasie. Pobierz najnowsze dane.',
            };
          }
        }

        if (!res.ok) {
          const parsed = await parseApiErrorResponse(res, 'Nie udało się zapisać przetargu.');
          if (parsed.field) {
            setFieldErrors((prev) => ({ ...prev, [parsed.field!]: parsed.error }));
          }
          return { ok: false, status: res.status, ...parsed };
        }

        const data = await res.json().catch(() => null);
        if (!data?.tender) {
          return { ok: false, error: 'Nie udało się zapisać przetargu.' };
        }

        onSaved(data.tender as TenderDetail, !isEditing, data.revision);
        onClose();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się zapisać przetargu.' }
    );
  };

  return (
    <div
      className="fixed inset-0 z-60 bg-slate-950/65 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-5"
      {...backdropProps}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-w-4xl max-h-[92vh] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl flex flex-col overflow-hidden ${flashClassName}`}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100">
          <h2 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white">
            {isEditing ? 'Edycja przetargu' : 'Nowy przetarg'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Zamknij formularz przetargu"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {saveSubmit.submitError && (
            <div className="space-y-2">
              <FormError
                id={errorAlertId}
                error={saveSubmit.submitError}
                alertRef={saveSubmit.alertRef}
                onDismiss={saveSubmit.clearError}
              />
              {conflictTender && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleApplyConflictLatest}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Odśwież najnowsze dane</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Podstawowe dane */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="md:col-span-2">
              <label htmlFor={`${uid}-name`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Nazwa przetargu <span className="text-rose-600 dark:text-rose-400">*</span>
              </label>
              <input
                id={`${uid}-name`}
                type="text"
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                aria-invalid={Boolean(fieldErrors.name) || saveSubmit.errorField === 'name' || undefined}
                aria-describedby={fieldErrors.name || saveSubmit.errorField === 'name' ? errorAlertId : undefined}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="np. Przebudowa drogi powiatowej nr 1245..."
              />
              {fieldErrors.name && (
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor={`${uid}-authority`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Zamawiający <span className="text-rose-600 dark:text-rose-400">*</span>
              </label>
              <input
                id={`${uid}-authority`}
                type="text"
                list={authorityListId}
                maxLength={200}
                value={form.contractingAuthority}
                onChange={(e) => setForm((p) => ({ ...p, contractingAuthority: e.target.value }))}
                aria-invalid={Boolean(fieldErrors.contractingAuthority) || saveSubmit.errorField === 'contractingAuthority' || undefined}
                aria-describedby={fieldErrors.contractingAuthority || saveSubmit.errorField === 'contractingAuthority' ? errorAlertId : undefined}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="np. Gmina Miasto..."
              />
              <datalist id={authorityListId}>
                {authoritySuggestions.map((auth) => (
                  <option key={auth} value={auth} />
                ))}
              </datalist>
              {fieldErrors.contractingAuthority && (
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
                  {fieldErrors.contractingAuthority}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={`${uid}-ref`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Numer referencyjny
              </label>
              <input
                id={`${uid}-ref`}
                type="text"
                maxLength={100}
                value={form.referenceNumber}
                onChange={(e) => setForm((p) => ({ ...p, referenceNumber: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="np. ZP.271.14.2026"
              />
            </div>
          </div>

          {/* Status, podstawa cen i daty */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div>
              <label htmlFor={`${uid}-status`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Status postępowania
              </label>
              <select
                id={`${uid}-status`}
                value={form.status}
                onChange={(e) => {
                  const nextStatus = e.target.value as TenderStatus;
                  setForm((p) => ({
                    ...p,
                    status: nextStatus,
                    winnerBidderId: nextStatus === 'resolved' ? p.winnerBidderId : '',
                  }));
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="announced">{TENDER_STATUS_LABELS.announced}</option>
                <option value="resolved">{TENDER_STATUS_LABELS.resolved}</option>
                <option value="cancelled">{TENDER_STATUS_LABELS.cancelled}</option>
              </select>
            </div>

            <div>
              <span className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Podstawa cen
              </span>
              <div
                role="group"
                aria-label="Podstawa cen budżetu i ofert"
                className="grid grid-cols-2 rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden"
              >
                {(['gross', 'net'] as const).map((basis) => {
                  const active = form.priceBasis === basis;
                  return (
                    <button
                      key={basis}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setForm((p) => ({ ...p, priceBasis: basis }))}
                      className={`py-1.5 text-center font-semibold transition-colors ${
                        active
                          ? 'bg-sky-700 dark:bg-sky-700 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {TENDER_PRICE_BASIS_LABELS[basis]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor={`${uid}-annDate`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Data ogłoszenia
              </label>
              <input
                id={`${uid}-annDate`}
                type="date"
                value={form.announcementDate}
                onChange={(e) => setForm((p) => ({ ...p, announcementDate: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label htmlFor={`${uid}-subDate`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Termin składania ofert
              </label>
              <input
                id={`${uid}-subDate`}
                type="date"
                value={form.submissionDeadline}
                onChange={(e) => setForm((p) => ({ ...p, submissionDeadline: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label htmlFor={`${uid}-resDate`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Data rozstrzygnięcia <span className="text-rose-600 dark:text-rose-400">*</span>
              </label>
              <input
                id={`${uid}-resDate`}
                type="date"
                value={form.resolutionDate}
                onChange={(e) => setForm((p) => ({ ...p, resolutionDate: e.target.value }))}
                aria-invalid={Boolean(fieldErrors.resolutionDate) || saveSubmit.errorField === 'resolutionDate' || undefined}
                aria-describedby={fieldErrors.resolutionDate || saveSubmit.errorField === 'resolutionDate' ? errorAlertId : undefined}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {fieldErrors.resolutionDate && (
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
                  {fieldErrors.resolutionDate}
                </p>
              )}
            </div>
          </div>

          {/* Budżet, zakres i link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label htmlFor={`${uid}-budget`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Cena zamawiającego ({TENDER_PRICE_BASIS_LABELS[form.priceBasis].toLowerCase()}, zł)
              </label>
              <input
                id={`${uid}-budget`}
                type="text"
                inputMode="decimal"
                value={form.authorityBudgetText}
                onChange={(e) => setForm((p) => ({ ...p, authorityBudgetText: e.target.value }))}
                aria-invalid={Boolean(fieldErrors.authorityBudget) || saveSubmit.errorField === 'authorityBudget' || undefined}
                aria-describedby={fieldErrors.authorityBudget || saveSubmit.errorField === 'authorityBudget' ? errorAlertId : undefined}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="np. 250 000,00"
              />
              {fieldErrors.authorityBudget && (
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
                  {fieldErrors.authorityBudget}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={`${uid}-scopeQty`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Zakres (ilość)
              </label>
              <input
                id={`${uid}-scopeQty`}
                type="text"
                inputMode="decimal"
                value={form.scopeQuantityText}
                onChange={(e) => setForm((p) => ({ ...p, scopeQuantityText: e.target.value }))}
                aria-invalid={Boolean(fieldErrors.scopeQuantity) || saveSubmit.errorField === 'scopeQuantity' || undefined}
                aria-describedby={fieldErrors.scopeQuantity || saveSubmit.errorField === 'scopeQuantity' ? errorAlertId : undefined}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="np. 12,5"
              />
              {fieldErrors.scopeQuantity && (
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
                  {fieldErrors.scopeQuantity}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={`${uid}-scopeUnit`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Jednostka zakresu
              </label>
              <input
                id={`${uid}-scopeUnit`}
                type="text"
                list={unitListId}
                maxLength={20}
                value={form.scopeUnit}
                onChange={(e) => setForm((p) => ({ ...p, scopeUnit: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="np. km, m2, ha"
              />
              <datalist id={unitListId}>
                {COMMON_SCOPE_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor={`${uid}-url`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Link do ogłoszenia (http/https)
              </label>
              <input
                id={`${uid}-url`}
                type="url"
                maxLength={500}
                value={form.url}
                onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                aria-invalid={Boolean(fieldErrors.url) || saveSubmit.errorField === 'url' || undefined}
                aria-describedby={fieldErrors.url || saveSubmit.errorField === 'url' ? errorAlertId : undefined}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="https://ezamowienia.gov.pl/..."
              />
              {fieldErrors.url && (
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{fieldErrors.url}</p>
              )}
            </div>
          </div>

          {/* Oferenci dynamiczna lista */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Oferenci w przetargu ({form.bidders.length})
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Ceny oferentów wprowadzane są jako {TENDER_PRICE_BASIS_LABELS[form.priceBasis].toLowerCase()}.
                  {form.status !== 'resolved' &&
                    ' Wskazanie zwycięzcy jest dostępne po ustawieniu statusu „Rozstrzygnięty”.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {form.winnerBidderId && (
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, winnerBidderId: '' }))}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium"
                  >
                    Wyczyść zwycięzcę
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddBidder}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dodaj oferenta</span>
                </button>
              </div>
            </div>

            {fieldErrors.winnerBidderId && (
              <p className="text-[11px] text-rose-700 dark:text-rose-300">{fieldErrors.winnerBidderId}</p>
            )}

            {form.bidders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-slate-600 dark:text-slate-400">
                Brak dodanych oferentów. Kliknij „Dodaj oferenta”, aby zarejestrować złożone oferty.
              </div>
            ) : (
              <div className="space-y-2">
                {form.bidders.map((row, idx) => {
                  const parsedPrice = row.priceText.trim() ? parseMoney(row.priceText) : null;
                  const live = computeLiveBidderPreview(
                    parsedPrice,
                    parsedScopePreview,
                    parsedBudgetPreview
                  );
                  const isWinner = form.status === 'resolved' && form.winnerBidderId === row.id;

                  return (
                    <div
                      key={row.id}
                      className={`rounded-lg border p-3 space-y-2 ${
                        isWinner
                          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30 text-slate-900 dark:text-slate-100'
                          : row.isOurs
                            ? 'border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/25 text-slate-900 dark:text-slate-100'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-start">
                        <div className="md:col-span-5">
                          <label
                            htmlFor={`${uid}-bname-${row.id}`}
                            className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Oferent #{idx + 1} <span className="text-rose-600 dark:text-rose-400">*</span>
                          </label>
                          <input
                            id={`${uid}-bname-${row.id}`}
                            type="text"
                            maxLength={200}
                            value={row.name}
                            onChange={(e) =>
                              updateBidderRow(row.id, (r) => ({ ...r, name: e.target.value }))
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            placeholder="Nazwa wykonawcy"
                          />
                          {fieldErrors[`bidder_name_${row.id}`] && (
                            <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
                              {fieldErrors[`bidder_name_${row.id}`]}
                            </p>
                          )}
                        </div>

                        <div className="md:col-span-3">
                          <label
                            htmlFor={`${uid}-bprice-${row.id}`}
                            className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Cena oferty ({TENDER_PRICE_BASIS_LABELS[form.priceBasis].toLowerCase()}, zł)
                          </label>
                          <input
                            id={`${uid}-bprice-${row.id}`}
                            type="text"
                            inputMode="decimal"
                            value={row.priceText}
                            onChange={(e) =>
                              updateBidderRow(row.id, (r) => ({ ...r, priceText: e.target.value }))
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500"
                            placeholder="np. 215 000,00"
                          />
                          {fieldErrors[`bidder_price_${row.id}`] && (
                            <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
                              {fieldErrors[`bidder_price_${row.id}`]}
                            </p>
                          )}
                        </div>

                        <div className="md:col-span-4 flex flex-wrap items-center gap-3 md:pt-6">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.isOurs}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                updateBidderRow(row.id, (r) => ({
                                  ...r,
                                  isOurs: checked,
                                  companyId: checked ? r.companyId : '',
                                }));
                              }}
                              className="rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="text-[11px] font-medium">To nasza oferta</span>
                          </label>

                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.isDisqualified}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                updateBidderRow(row.id, (r) => ({ ...r, isDisqualified: checked }));
                              }}
                              className="rounded border-slate-300 dark:border-slate-600 text-rose-600 focus:ring-rose-500"
                            />
                            <span className="text-[11px] font-medium">Odrzucona</span>
                          </label>

                          <label
                            className={`inline-flex items-center gap-1 select-none ${
                              form.status === 'resolved' && !row.isDisqualified
                                ? 'cursor-pointer'
                                : 'opacity-50 cursor-not-allowed'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`${uid}-winner`}
                              checked={isWinner}
                              disabled={form.status !== 'resolved' || row.isDisqualified}
                              onChange={() =>
                                setForm((p) => ({ ...p, winnerBidderId: row.id }))
                              }
                              className="border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                            />
                            <Trophy className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                            <span className="text-[11px] font-semibold">Zwycięzca</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => handleRemoveBidder(row.id)}
                            aria-label={`Usuń oferenta ${idx + 1}`}
                            className="ml-auto p-1 rounded text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        {row.isOurs ? (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`${uid}-bcomp-${row.id}`} className="text-slate-700 dark:text-slate-300 font-medium">
                              Nasza firma:
                            </label>
                            <select
                              id={`${uid}-bcomp-${row.id}`}
                              value={row.companyId}
                              onChange={(e) => {
                                const nextCompId = e.target.value;
                                const selectedComp = selectableCompanies.find(
                                  (c) => c.id === nextCompId
                                );
                                updateBidderRow(row.id, (r) => ({
                                  ...r,
                                  companyId: nextCompId,
                                  name: !r.name.trim() && selectedComp ? selectedComp.name : r.name,
                                }));
                              }}
                              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500"
                            >
                              <option value="">— Wybierz firmę (opcjonalnie) —</option>
                              {selectableCompanies.map((c) => (
                                <option key={c.id} value={c.id}>
                                  [{c.letter}] {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span />
                        )}

                        <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                          <span>
                            Cena/jedn.:{' '}
                            <strong className="text-slate-800 dark:text-slate-200">
                              {formatTenderPricePerUnit(live.pricePerUnit, form.scopeUnit)}
                            </strong>
                          </span>
                          <span>
                            % budżetu:{' '}
                            <strong className="text-slate-800 dark:text-slate-200">
                              {formatTenderPercent(live.pctOfBudget)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Opis i notatki */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label htmlFor={`${uid}-desc`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Opis przedmiotu zamówienia
              </label>
              <textarea
                id={`${uid}-desc`}
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label htmlFor={`${uid}-notes`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Notatki wewnętrzne
              </label>
              <textarea
                id={`${uid}-notes`}
                rows={3}
                maxLength={2000}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              ref={cancelButtonRef}
              type="button"
              disabled={saveSubmit.isSubmitting}
              onClick={requestClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saveSubmit.isSubmitting}
              className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white font-semibold transition-colors"
            >
              {saveSubmit.isSubmitting ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>

      <DiscardChangesModal
        isOpen={isDiscardModalOpen}
        onCancel={cancelDiscard}
        onConfirm={confirmDiscard}
      />
    </div>
  );
};
