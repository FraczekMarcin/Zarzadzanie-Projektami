import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Company, Project, ProjectTemplate } from '../types';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useVariables } from '../hooks/useVariables';
import { loadAllProjectTemplates } from '../utils/projectTemplates';
import { getTodayIso } from '../utils/today';
import { formatMoney } from '../utils/money';
import {
  formatTenderPln,
  TENDER_PRICE_BASIS_LABELS,
  TenderDetail,
} from '../utils/tenderUi';
import { AlertTriangle, Building2, FolderPlus, X } from 'lucide-react';

interface TenderCopyToProjectModalProps {
  isOpen: boolean;
  tender: TenderDetail | null;
  companies: Company[];
  projects: Project[];
  onClose: () => void;
  onProjectCreated: (result: {
    project: Project;
    tender: TenderDetail;
    revision?: number;
    selectedTemplate?: ProjectTemplate;
  }) => void;
}

export const TenderCopyToProjectModal: React.FC<TenderCopyToProjectModalProps> = ({
  isOpen,
  tender,
  companies,
  projects,
  onClose,
  onProjectCreated,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const uid = useId();
  const { vatRates } = useVariables();

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.isActive).sort((a, b) => a.letter.localeCompare(b.letter, 'pl')),
    [companies]
  );

  const defaultVatRate = useMemo(() => {
    const defNonExempt = vatRates.find((v) => v && v.isDefault && !v.isExempt);
    if (defNonExempt) {
      const rate = typeof defNonExempt.value === 'number' ? defNonExempt.value : defNonExempt.rate;
      if (typeof rate === 'number' && Number.isFinite(rate)) return rate;
    }
    const anyDef = vatRates.find((v) => v && v.isDefault && !v.isExempt);
    if (anyDef) {
      const rate = typeof anyDef.value === 'number' ? anyDef.value : anyDef.rate;
      if (typeof rate === 'number' && Number.isFinite(rate)) return rate;
    }
    return 23;
  }, [vatRates]);

  const templates = useMemo(() => (isOpen ? loadAllProjectTemplates() : []), [isOpen]);

  const [companyId, setCompanyId] = useState<string>('');
  const [vatRate, setVatRate] = useState<string>('23');
  const [startDate, setStartDate] = useState<string>(() => getTodayIso());
  const [dueDate, setDueDate] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    message: string;
    existingProjectKey?: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !tender) return;
    const winningBidder = tender.winnerBidderId
      ? tender.bidders.find((b) => b.id === tender.winnerBidderId)
      : tender.bidders.find((b) => b.isOurs);
    const defaultCompId =
      winningBidder?.companyId || activeCompanies[0]?.id || '';
    setCompanyId(defaultCompId);
    setVatRate(String(defaultVatRate));
    setStartDate(getTodayIso());
    setDueDate('');
    setTemplateId('none');
    setErrorMsg(null);
    setDuplicateConflict(null);
  }, [isOpen, tender, activeCompanies, defaultVatRate]);

  const { backdropProps, flashClassName } = useDismissOnOutsideClick({
    isOpen: isOpen && Boolean(tender),
    mode: 'form',
    panelRef,
    onDismiss: () => {
      if (!isSubmitting) onClose();
    },
    disabled: isSubmitting,
    cancelButtonRef: cancelRef,
  });

  useFocusTrap({
    isOpen: isOpen && Boolean(tender),
    containerRef: panelRef,
    onClose: () => {
      if (!isSubmitting) onClose();
    },
    disableEscape: isSubmitting,
  });

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId) || null,
    [companies, companyId]
  );

  const isVatExempt = selectedCompany?.vatPayer === false;

  const existingLinkedProject = useMemo(() => {
    if (!tender?.linkedProjectId) return null;
    return projects.find((p) => p.id === tender.linkedProjectId) || null;
  }, [projects, tender?.linkedProjectId]);

  if (!isOpen || !tender) return null;

  const vatOptions = vatRates.filter((v) => !v.isExempt);

  const submitCreateProject = async (force: boolean) => {
    setErrorMsg(null);

    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setErrorMsg('Podaj prawidłową datę rozpoczęcia projektu (RRRR-MM-DD).');
      return;
    }

    if (dueDate.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
        setErrorMsg('Podaj prawidłowy termin zakończenia (RRRR-MM-DD).');
        return;
      }
      if (dueDate.trim() < startDate) {
        setErrorMsg('Termin zakończenia nie może być wcześniejszy niż data rozpoczęcia.');
        return;
      }
    }

    let numericVat: number | undefined;
    if (!isVatExempt) {
      const normalizedVat = Number(vatRate.replace(',', '.').trim());
      if (!Number.isFinite(normalizedVat) || normalizedVat < 0 || normalizedVat > 100) {
        setErrorMsg('Podaj prawidłową stawkę VAT z zakresu 0–100%.');
        return;
      }
      numericVat = Math.round(normalizedVat * 100) / 100;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        startDate,
        ...(dueDate.trim() ? { dueDate: dueDate.trim() } : {}),
        ...(companyId ? { companyId } : {}),
        ...(numericVat !== undefined ? { vatRate: numericVat } : {}),
        ...(templateId !== 'none' ? { templateId } : {}),
        ...(force ? { force: true } : {}),
      };

      const res = await fetch(`/api/tenders/${tender.id}/create-project`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && !force && data?.existingProjectId) {
        setDuplicateConflict({
          message:
            data.error ||
            `Z tego przetargu utworzono już projekt ${data.existingProjectKey || ''}.`,
          existingProjectKey: data.existingProjectKey,
        });
        return;
      }

      if (!res.ok || !data?.project) {
        setErrorMsg(data?.error || 'Nie udało się utworzyć projektu z przetargu.');
        return;
      }

      const chosenTemplate =
        templateId !== 'none'
          ? templates.find((t) => t.id === templateId)
          : undefined;

      onProjectCreated({
        project: data.project as Project,
        tender: (data.tender as TenderDetail) || tender,
        revision: typeof data.revision === 'number' ? data.revision : undefined,
        selectedTemplate: chosenTemplate,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Błąd połączenia z serwerem podczas tworzenia projektu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCreateProject(false);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-4"
      {...backdropProps}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl overflow-hidden text-xs ${flashClassName}`}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <h2 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white">
              Kopiuj przetarg jako projekt
            </h2>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Zamknij okno kopiowania do projektu"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 p-3 space-y-1">
            <div className="font-bold text-slate-900 dark:text-white">{tender.name}</div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              Zamawiający: {tender.contractingAuthority}
            </div>
            <div className="text-[11px] text-slate-700 dark:text-slate-200 font-mono tabular-nums">
              Nasza wygrana oferta: <strong>{formatTenderPln(tender.winnerPrice)}</strong> (
              {TENDER_PRICE_BASIS_LABELS[tender.priceBasis].toLowerCase()})
            </div>
          </div>

          {existingLinkedProject && !duplicateConflict && (
            <div
              role="status"
              className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 px-3 py-2 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <span>
                Z tym przetargiem powiązano już projekt{' '}
                <strong className="font-mono">{existingLinkedProject.key}</strong>. Próba zapisu poprosi o potwierdzenie utworzenia kolejnego projektu.
              </span>
            </div>
          )}

          {duplicateConflict && (
            <div
              role="alert"
              className="rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 p-3 space-y-2.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="font-bold">Istnieje już projekt z tego przetargu</p>
                  <p className="mt-0.5 leading-relaxed">{duplicateConflict.message}</p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitCreateProject(true)}
                  className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold transition-colors"
                >
                  {isSubmitting ? 'Tworzenie...' : 'Potwierdź utworzenie kolejnego projektu'}
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 px-3 py-2 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-3">
            {activeCompanies.length > 0 && (
              <div>
                <label htmlFor={`${uid}-company`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Firma realizująca projekt (numeracja RRRR-X_L)
                </label>
                <div className="relative">
                  <select
                    id={`${uid}-company`}
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">— Bez przypisanej firmy (numeracja RRRR-NN) —</option>
                    {activeCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.letter}] {c.name} ({c.vatPayer === false ? 'ZW z VAT' : 'Płatnik VAT'})
                      </option>
                    ))}
                  </select>
                </div>
                {selectedCompany && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                    <Building2 className="w-3 h-3" aria-hidden="true" />
                    <span>
                      Numer kolejnego projektu zostanie wygenerowany automatycznie z kodem litery{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">{selectedCompany.letter}</strong>.
                    </span>
                  </p>
                )}
              </div>
            )}

            {isVatExempt ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 px-3 py-2 text-[11px]">
                Wybrana firma jest zwolniona z VAT — stawka VAT projektu wyniesie <strong>0%</strong> (netto = brutto ={' '}
                {tender.winnerPrice !== null ? `${formatMoney(tender.winnerPrice)} zł` : '—'}).
              </div>
            ) : (
              <div>
                <label htmlFor={`${uid}-vat`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Stawka VAT projektu (%)
                </label>
                {vatOptions.length > 0 ? (
                  <select
                    id={`${uid}-vat`}
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {vatOptions.map((opt) => {
                      const val = typeof opt.value === 'number' ? opt.value : opt.rate;
                      return (
                        <option key={opt.id || String(val)} value={String(val)}>
                          {opt.label || `${val}%`}
                        </option>
                      );
                    })}
                    {!vatOptions.some(
                      (o) => String(typeof o.value === 'number' ? o.value : o.rate) === vatRate
                    ) && <option value={vatRate}>{vatRate}%</option>}
                  </select>
                ) : (
                  <input
                    id={`${uid}-vat`}
                    type="text"
                    inputMode="decimal"
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-start`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Data rozpoczęcia <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  id={`${uid}-start`}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label htmlFor={`${uid}-due`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Termin zakończenia (opcjonalnie)
                </label>
                <input
                  id={`${uid}-due`}
                  type="date"
                  value={dueDate}
                  min={startDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {templates.length > 0 && (
              <div>
                <label htmlFor={`${uid}-tpl`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Szablon projektu (opcjonalnie)
                </label>
                <select
                  id={`${uid}-tpl`}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="none">— Bez szablonu (sam projekt) —</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} ({tpl.tasks.length} etapów)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white font-semibold transition-colors"
            >
              {isSubmitting ? 'Tworzenie...' : 'Utwórz projekt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
