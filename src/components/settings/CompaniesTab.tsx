import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Plus,
  Edit3,
  Trash2,
  Check,
  X,
  CheckCircle2,
  Save,
  Lock,
  Power,
  AlertTriangle,
} from 'lucide-react';
import type {
  Company,
  Project,
  ProjectNumberingScope,
  ProjectNumberingSettings,
  User,
} from '../../types';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../../hooks/useDismissOnOutsideClick';
import { parseApiErrorResponse, useFormSubmit } from '../../hooks/useFormSubmit';
import {
  COMPANY_COLOR_PALETTE,
  getCompanyBadgeColors,
  getDefaultCompanyColor,
  isValidCompanyColor,
  normalizeCompanyColor,
  resolveCompanyColor,
  useIsDarkTheme,
} from '../../utils/colorContrast';
import { FormError } from '../FormError';
import { useSettingsTabDirty } from './SettingsDirtyContext';

const ALPHABET_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface CompaniesTabProps {
  isOpen: boolean;
  currentUser: User | null;
  companies: Company[];
  projects: Project[];
  projectNumbering: ProjectNumberingSettings;
  onRefreshState?: () => Promise<void> | void;
}

export const CompaniesTab: React.FC<CompaniesTabProps> = ({
  isOpen,
  currentUser,
  companies,
  projects,
  projectNumbering,
  onRefreshState,
}) => {
  const reportTabDirty = useSettingsTabDirty();
  const isAdmin = currentUser?.role === 'admin';

  // Formularz nowej firmy
  const usedLetters = useMemo(
    () => new Set(companies.map((c) => c.letter.toUpperCase())),
    [companies]
  );
  const availableLetters = useMemo(
    () => ALPHABET_LETTERS.filter((l) => !usedLetters.has(l)),
    [usedLetters]
  );

  const isDark = useIsDarkTheme();

  const [newName, setNewName] = useState('');
  const [newLetter, setNewLetter] = useState<string>('A');
  const [newColor, setNewColor] = useState<string>(() => getDefaultCompanyColor('A'));
  const [newColorTouched, setNewColorTouched] = useState(false);
  const [newNip, setNewNip] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newVatPayer, setNewVatPayer] = useState<boolean>(true);
  const [newVatBasis, setNewVatBasis] = useState('');

  // Ustawienia numeracji i domyślnej firmy
  const [numberingScope, setNumberingScope] = useState<ProjectNumberingScope>(
    projectNumbering?.scope === 'company' ? 'company' : 'year'
  );
  const [defaultCompanyId, setDefaultCompanyId] = useState<string>(
    projectNumbering?.defaultCompanyId || ''
  );

  // Edycja istniejcej firmy
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLetter, setEditLetter] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editNip, setEditNip] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editVatPayer, setEditVatPayer] = useState<boolean>(true);
  const [editVatBasis, setEditVatBasis] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingVatConfirm, setPendingVatConfirm] = useState<{
    company: Company;
    payload: Record<string, any>;
    affectedCount: number;
    nextVatPayer: boolean;
  } | null>(null);
  const vatConfirmRef = useRef<HTMLDivElement>(null);
  const vatCancelRef = useRef<HTMLButtonElement>(null);

  const companySubmit = useFormSubmit();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const {
    backdropProps: vatBackdropProps,
    flashClassName: vatFlashClassName,
  } = useDismissOnOutsideClick({
    isOpen: Boolean(pendingVatConfirm),
    mode: 'form',
    panelRef: vatConfirmRef,
    onDismiss: () => setPendingVatConfirm(null),
    disabled: companySubmit.isSubmitting,
    cancelButtonRef: vatCancelRef,
  });

  useFocusTrap({
    isOpen: Boolean(pendingVatConfirm),
    onClose: () => setPendingVatConfirm(null),
    containerRef: vatConfirmRef,
    disableEscape: companySubmit.isSubmitting,
  });

  useEffect(() => {
    setNumberingScope(projectNumbering?.scope === 'company' ? 'company' : 'year');
    setDefaultCompanyId(projectNumbering?.defaultCompanyId || '');
  }, [projectNumbering, isOpen]);

  useEffect(() => {
    if (availableLetters.length > 0 && !availableLetters.includes(newLetter)) {
      const next = availableLetters[0];
      setNewLetter(next);
      if (!newColorTouched) {
        setNewColor(getDefaultCompanyColor(next));
      }
    }
  }, [availableLetters, newLetter, newColorTouched]);

  useEffect(() => {
    if (!isOpen) {
      companySubmit.clearError();
      setSuccessMsg(null);
      setEditingId(null);
      setConfirmDeleteId(null);
      setPendingVatConfirm(null);
    }
  }, [isOpen, companySubmit.clearError]);

  const serverScope = projectNumbering?.scope === 'company' ? 'company' : 'year';
  const serverDefaultCompanyId = projectNumbering?.defaultCompanyId || '';
  const isDirty = Boolean(
    isOpen &&
      isAdmin &&
      (numberingScope !== serverScope ||
        defaultCompanyId !== serverDefaultCompanyId ||
        editingId !== null ||
        newName.trim() ||
        newColorTouched ||
        newNip.trim() ||
        newAddress.trim() ||
        !newVatPayer ||
        newVatBasis.trim())
  );

  useEffect(() => {
    reportTabDirty('companies', isDirty);
    return () => reportTabDirty('companies', false);
  }, [isDirty, reportTabDirty]);

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.isActive),
    [companies]
  );

  const projectCountByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      if (p.companyId) {
        map.set(p.companyId, (map.get(p.companyId) || 0) + 1);
      }
    }
    return map;
  }, [projects]);

  if (!isAdmin) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Zarządzanie firmami i numeracją projektów jest dostępne wyłącznie dla Administratora.</span>
      </div>
    );
  }

  const handleSaveNumberingSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    await companySubmit.submit(
      async () => {
        const res = await fetch('/api/companies/settings', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: numberingScope,
            defaultCompanyId: defaultCompanyId || null,
          }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            'Nie udało się zapisać ustawień numeracji.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        setSuccessMsg('Zapisano ustawienia numeracji i domyślnej firmy.');
        await onRefreshState?.();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się zapisać ustawień numeracji.' }
    );
  };

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName || !newLetter) {
      companySubmit.setValidationError('Podaj nazwę firmy i wybierz literę.', 'name');
      return;
    }

    const trimmedColor = newColor.trim();
    if (trimmedColor && !isValidCompanyColor(trimmedColor)) {
      companySubmit.setValidationError(
        'Kolor firmy musi być zapisany w formacie heksadecymalnym #RRGGBB (np. #1D4ED8).',
        'color'
      );
      return;
    }

    setSuccessMsg(null);
    await companySubmit.submit(
      async () => {
        const letterUpper = newLetter.trim().toUpperCase();
        const res = await fetch('/api/companies', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            letter: letterUpper,
            color: normalizeCompanyColor(trimmedColor) || getDefaultCompanyColor(letterUpper),
            nip: newNip.trim() || undefined,
            address: newAddress.trim() || undefined,
            isActive: true,
            vatPayer: newVatPayer,
            vatExemptionBasis: !newVatPayer && newVatBasis.trim() ? newVatBasis.trim() : undefined,
          }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(res, 'Nie udało się dodać firmy.');
          return { ok: false, status: res.status, ...parsed };
        }
        const data = await res.json().catch(() => ({}));
        setNewName('');
        setNewColor(getDefaultCompanyColor(letterUpper));
        setNewColorTouched(false);
        setNewNip('');
        setNewAddress('');
        setNewVatPayer(true);
        setNewVatBasis('');
        setSuccessMsg(`Dodano firmę ${data.company?.letter} - ${data.company?.name}.`);
        await onRefreshState?.();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się dodać firmy.' }
    );
  };

  const startEdit = (company: Company) => {
    setEditingId(company.id);
    setEditName(company.name);
    setEditLetter(company.letter);
    setEditColor(resolveCompanyColor(company));
    setEditNip(company.nip || '');
    setEditAddress(company.address || '');
    setEditIsActive(company.isActive);
    setEditVatPayer(company.vatPayer !== false);
    setEditVatBasis(company.vatExemptionBasis || '');
    setConfirmDeleteId(null);
    setPendingVatConfirm(null);
    companySubmit.clearError();
    setSuccessMsg(null);
  };

  const executeSaveEdit = async (company: Company, payload: Record<string, any>) => {
    setSuccessMsg(null);
    const result = await companySubmit.submit(
      async () => {
        const res = await fetch(`/api/companies/${company.id}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(res, 'Nie udało się zaktualizować firmy.');
          return { ok: false, status: res.status, ...parsed };
        }
        const data = await res.json().catch(() => ({}));
        setEditingId(null);
        setPendingVatConfirm(null);
        setSuccessMsg(`Zaktualizowano dane firmy ${data.company?.letter} - ${data.company?.name}.`);
        await onRefreshState?.();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się zaktualizować firmy.' }
    );
    if (!result.ok) {
      setPendingVatConfirm(null);
    }
  };

  const handleSaveEdit = async (company: Company) => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      companySubmit.setValidationError('Nazwa firmy nie może być pusta.', 'name');
      return;
    }

    const trimmedColor = editColor.trim();
    if (!isValidCompanyColor(trimmedColor)) {
      companySubmit.setValidationError(
        'Kolor firmy musi być zapisany w formacie heksadecymalnym #RRGGBB (np. #1D4ED8).',
        'color'
      );
      return;
    }

    const payload: Record<string, any> = {
      name: trimmedName,
      color: normalizeCompanyColor(trimmedColor),
      nip: editNip.trim(),
      address: editAddress.trim(),
      isActive: editIsActive,
      vatPayer: editVatPayer,
      vatExemptionBasis: !editVatPayer ? editVatBasis.trim() : null,
    };
    if (editLetter.trim().toUpperCase() !== company.letter.toUpperCase()) {
      payload.letter = editLetter.trim().toUpperCase();
    }

    const prevVatPayer = company.vatPayer !== false;
    const affectedCount = projectCountByCompany.get(company.id) || 0;
    if (editVatPayer !== prevVatPayer && affectedCount > 0) {
      setPendingVatConfirm({
        company,
        payload,
        affectedCount,
        nextVatPayer: editVatPayer,
      });
      return;
    }

    await executeSaveEdit(company, payload);
  };

  const handleToggleActive = async (company: Company) => {
    setSuccessMsg(null);
    await companySubmit.submit(
      async () => {
        const res = await fetch(`/api/companies/${company.id}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !company.isActive }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(res, 'Nie udało się zmienić statusu firmy.');
          return { ok: false, status: res.status, ...parsed };
        }
        setSuccessMsg(
          company.isActive
            ? `Dezaktywowano firmę ${company.letter} - ${company.name}.`
            : `Aktywowano firmę ${company.letter} - ${company.name}.`
        );
        await onRefreshState?.();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się zmienić statusu firmy.' }
    );
  };

  const handleDeleteCompany = async (company: Company) => {
    setSuccessMsg(null);
    await companySubmit.submit(
      async () => {
        const res = await fetch(`/api/companies/${company.id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(res, 'Nie udało się usunąć firmy.');
          return { ok: false, status: res.status, ...parsed };
        }
        setConfirmDeleteId(null);
        setSuccessMsg(`Usunięto firmę ${company.letter} - ${company.name}.`);
        await onRefreshState?.();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się usunąć firmy.' }
    );
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h4 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <Building2 className="w-4 h-4 text-indigo-700 dark:text-indigo-400" aria-hidden="true" />
          <span>Firmy i numeracja projektów (RRRR-X_L)</span>
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5">
          Rejestr firm prowadzących projekty (maks. 26 firm przypisanych do liter A–Z) oraz reguły automatycznego nadawania numerów projektów przez serwer.
        </p>
      </div>

      <FormError
        error={companySubmit.submitError}
        alertRef={companySubmit.alertRef}
        onDismiss={companySubmit.clearError}
      />

      {successMsg && (
        <div
          role="status"
          className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Sekcja 1: Ustawienia numeracji i domyślnej firmy */}
      <form
        onSubmit={handleSaveNumberingSettings}
        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-3"
      >
        <h5 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wide">
          Tryb numeracji i firma domyślna
        </h5>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="company-numbering-scope"
              className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Zakres numeracji w roku (RRRR-X_L)
            </label>
            <select
              id="company-numbering-scope"
              value={numberingScope}
              onChange={(e) => setNumberingScope(e.target.value === 'company' ? 'company' : 'year')}
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
            >
              <option value="year">Wspólna numeracja dla wszystkich firm w roku (domyślnie)</option>
              <option value="company">Osobna numeracja dla każdej litery firmy (A, B, C...)</option>
            </select>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {numberingScope === 'year'
                ? 'Przykład: 2026-1_A, 2026-2_B, 2026-3_A (licznik wspólny w roku).'
                : 'Przykład: 2026-1_A, 2026-1_B, 2026-2_A (każda litera ma własny licznik).'}
            </p>
          </div>

          <div>
            <label
              htmlFor="default-company-select"
              className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Domyślna firma przy tworzeniu projektu
            </label>
            <select
              id="default-company-select"
              value={defaultCompanyId}
              onChange={(e) => setDefaultCompanyId(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
            >
              <option value="">-- Brak domyślnej (wybór ręczny) --</option>
              {activeCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.letter} - {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={companySubmit.isSubmitting}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{companySubmit.isSubmitting ? 'Zapisywanie...' : 'Zapisz ustawienia numeracji'}</span>
          </button>
        </div>
      </form>

      {/* Sekcja 2: Dodawanie nowej firmy */}
      <form
        onSubmit={handleAddCompany}
        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h5 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wide flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Dodaj nową firmę</span>
          </h5>
          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
            Zarejestrowane: {companies.length} / 26
          </span>
        </div>

        {companies.length >= 26 ? (
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Osiągnięto maksymalny limit 26 firm (wszystkie litery A–Z są zajęte).
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="new-company-letter"
                  className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Litera *
                </label>
                <select
                  id="new-company-letter"
                  value={newLetter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setNewLetter(next);
                    if (!newColorTouched) {
                      setNewColor(getDefaultCompanyColor(next));
                    }
                  }}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
                >
                  {availableLetters.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-6">
                <label
                  htmlFor="new-company-name"
                  className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Nazwa firmy *
                </label>
                <input
                  id="new-company-name"
                  type="text"
                  required
                  maxLength={200}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="np. Pracownia Projektowa Alfa Sp. z o.o."
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="sm:col-span-4">
                <label
                  htmlFor="new-company-nip"
                  className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  NIP (opcjonalnie)
                </label>
                <input
                  id="new-company-nip"
                  type="text"
                  maxLength={50}
                  value={newNip}
                  onChange={(e) => setNewNip(e.target.value)}
                  placeholder="np. 525-000-00-00"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label
                  htmlFor="new-company-address"
                  className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Adres siedziby (opcjonalnie)
                </label>
                <input
                  id="new-company-address"
                  type="text"
                  maxLength={200}
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="np. ul. Przykładowa 10, 00-001 Warszawa"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="sm:col-span-4">
                <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Status VAT firmy
                </span>
                <div
                  role="group"
                  aria-label="Status VAT nowej firmy"
                  className="inline-flex w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={newVatPayer}
                    onClick={() => setNewVatPayer(true)}
                    className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      newVatPayer
                        ? 'bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Płatnik VAT
                  </button>
                  <button
                    type="button"
                    aria-pressed={!newVatPayer}
                    onClick={() => setNewVatPayer(false)}
                    className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      !newVatPayer
                        ? 'bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Zwolniona z VAT
                  </button>
                </div>
              </div>

              <div className="sm:col-span-3 flex justify-end">
                <button
                  type="submit"
                  disabled={companySubmit.isSubmitting || !newName.trim() || availableLetters.length === 0}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dodaj firmę</span>
                </button>
              </div>
            </div>

            {/* Kolor firmy (paleta 12 kolorów + hex #RRGGBB) */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="new-company-color-hex"
                  className="font-semibold text-slate-700 dark:text-slate-300 text-xs"
                >
                  Kolor firmy (paleta 12 kolorów lub kod #RRGGBB)
                </label>
                <span
                  style={getCompanyBadgeColors(
                    isValidCompanyColor(newColor) ? newColor : getDefaultCompanyColor(newLetter),
                    isDark ? 'dark' : 'light'
                  )}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border text-xs font-semibold"
                >
                  <span className="font-mono font-bold">{newLetter}</span>
                  <span>{newName.trim() || 'Podgląd plakietki'}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Paleta kolorów nowej firmy">
                  {COMPANY_COLOR_PALETTE.map((swatch) => {
                    const active = normalizeCompanyColor(newColor) === swatch.hex;
                    return (
                      <button
                        key={swatch.hex}
                        type="button"
                        onClick={() => {
                          setNewColor(swatch.hex);
                          setNewColorTouched(true);
                        }}
                        aria-label={`Kolor ${swatch.name} (${swatch.hex})`}
                        aria-pressed={active}
                        title={`${swatch.name} (${swatch.hex})`}
                        style={{ backgroundColor: swatch.hex }}
                        className={`w-6 h-6 rounded-md border flex items-center justify-center transition-transform ${
                          active
                            ? 'ring-2 ring-sky-600 ring-offset-1 dark:ring-offset-slate-900 border-slate-900 dark:border-white scale-110'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {active && (
                          <Check
                            className="w-3.5 h-3.5"
                            style={{ color: getCompanyBadgeColors(swatch.hex, isDark ? 'dark' : 'light').color }}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <input
                    type="color"
                    aria-label="Wybierz własny kolor nowej firmy"
                    value={isValidCompanyColor(newColor) ? newColor : getDefaultCompanyColor(newLetter)}
                    onChange={(e) => {
                      setNewColor(e.target.value.toUpperCase());
                      setNewColorTouched(true);
                    }}
                    className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer p-0"
                  />
                  <input
                    id="new-company-color-hex"
                    type="text"
                    maxLength={7}
                    value={newColor}
                    onChange={(e) => {
                      setNewColor(e.target.value);
                      setNewColorTouched(true);
                    }}
                    placeholder="#1D4ED8"
                    className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-mono uppercase text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {!newVatPayer && (
              <div>
                <label
                  htmlFor="new-company-vat-basis"
                  className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Podstawa zwolnienia (opcjonalnie)
                </label>
                <input
                  id="new-company-vat-basis"
                  type="text"
                  maxLength={200}
                  value={newVatBasis}
                  onChange={(e) => setNewVatBasis(e.target.value)}
                  placeholder="np. art. 113 ust. 1 ustawy o VAT"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            )}
          </>
        )}
      </form>

      {/* Sekcja 3: Lista firm */}
      <div className="space-y-2.5">
        <h5 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wide">
          Lista zarejestrowanych firm ({companies.length})
        </h5>

        {companies.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-600 dark:text-slate-400">
            Brak zdefiniowanych firm. Projekty bez firmy korzystają z dotychczasowej numeracji. Po dodaniu pierwszej aktywnej firmy wybór firmy przy tworzeniu projektu będzie wymagany.
          </div>
        ) : (
          <div className="space-y-2">
            {companies.map((company) => {
              const projCount = projectCountByCompany.get(company.id) || 0;
              const isEditing = editingId === company.id;
              const isDefault = projectNumbering?.defaultCompanyId === company.id;

              return (
                <div
                  key={company.id}
                  className={`p-3.5 rounded-xl border transition-colors ${
                    company.isActive
                      ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      : 'bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800/70 opacity-85'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                        <div className="sm:col-span-2">
                          <label
                            htmlFor={`edit-letter-${company.id}`}
                            className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Litera
                          </label>
                          <select
                            id={`edit-letter-${company.id}`}
                            value={editLetter}
                            disabled={projCount > 0}
                            onChange={(e) => setEditLetter(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 disabled:bg-slate-100 dark:disabled:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-xs font-mono font-bold text-slate-900 dark:text-white"
                          >
                            <option value={company.letter}>{company.letter}</option>
                            {availableLetters.map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-6">
                          <label
                            htmlFor={`edit-name-${company.id}`}
                            className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Nazwa firmy *
                          </label>
                          <input
                            id={`edit-name-${company.id}`}
                            type="text"
                            maxLength={200}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div className="sm:col-span-4">
                          <label
                            htmlFor={`edit-nip-${company.id}`}
                            className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            NIP
                          </label>
                          <input
                            id={`edit-nip-${company.id}`}
                            type="text"
                            maxLength={50}
                            value={editNip}
                            onChange={(e) => setEditNip(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                        <div className="sm:col-span-8">
                          <label
                            htmlFor={`edit-address-${company.id}`}
                            className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Adres
                          </label>
                          <input
                            id={`edit-address-${company.id}`}
                            type="text"
                            maxLength={200}
                            value={editAddress}
                            onChange={(e) => setEditAddress(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div className="sm:col-span-4 pt-4">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editIsActive}
                              onChange={(e) => setEditIsActive(e.target.checked)}
                              className="rounded border-slate-300 dark:border-slate-700"
                            />
                            <span>Firma aktywna</span>
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-5">
                          <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Status VAT
                          </span>
                          <div
                            role="group"
                            aria-label={`Status VAT firmy ${company.name}`}
                            className="inline-flex w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
                          >
                            <button
                              type="button"
                              aria-pressed={editVatPayer}
                              onClick={() => setEditVatPayer(true)}
                              className={`flex-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                                editVatPayer
                                  ? 'bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-300 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              Płatnik VAT
                            </button>
                            <button
                              type="button"
                              aria-pressed={!editVatPayer}
                              onClick={() => setEditVatPayer(false)}
                              className={`flex-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                                !editVatPayer
                                  ? 'bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              Zwolniona z VAT
                            </button>
                          </div>
                        </div>

                        {!editVatPayer && (
                          <div className="sm:col-span-7">
                            <label
                              htmlFor={`edit-vat-basis-${company.id}`}
                              className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                            >
                              Podstawa zwolnienia
                            </label>
                            <input
                              id={`edit-vat-basis-${company.id}`}
                              type="text"
                              maxLength={200}
                              value={editVatBasis}
                              onChange={(e) => setEditVatBasis(e.target.value)}
                              placeholder="np. art. 113 ust. 1 ustawy o VAT"
                              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label
                            htmlFor={`edit-color-${company.id}`}
                            className="font-semibold text-slate-700 dark:text-slate-300 text-xs"
                          >
                            Kolor firmy (#RRGGBB)
                          </label>
                          <span
                            style={getCompanyBadgeColors(
                              isValidCompanyColor(editColor) ? editColor : resolveCompanyColor(company),
                              isDark ? 'dark' : 'light'
                            )}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border text-xs font-semibold"
                          >
                            <span className="font-mono font-bold">{editLetter}</span>
                            <span>{editName.trim() || company.name}</span>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Paleta kolorów firmy ${company.name}`}>
                            {COMPANY_COLOR_PALETTE.map((swatch) => {
                              const active = normalizeCompanyColor(editColor) === swatch.hex;
                              return (
                                <button
                                  key={swatch.hex}
                                  type="button"
                                  onClick={() => setEditColor(swatch.hex)}
                                  aria-label={`Kolor ${swatch.name} (${swatch.hex})`}
                                  aria-pressed={active}
                                  title={`${swatch.name} (${swatch.hex})`}
                                  style={{ backgroundColor: swatch.hex }}
                                  className={`w-6 h-6 rounded-md border flex items-center justify-center transition-transform ${
                                    active
                                      ? 'ring-2 ring-sky-600 ring-offset-1 dark:ring-offset-slate-900 border-slate-900 dark:border-white scale-110'
                                      : 'border-slate-300 dark:border-slate-600'
                                  }`}
                                >
                                  {active && (
                                    <Check
                                      className="w-3.5 h-3.5"
                                      style={{ color: getCompanyBadgeColors(swatch.hex, isDark ? 'dark' : 'light').color }}
                                      aria-hidden="true"
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <input
                              type="color"
                              aria-label={`Wybierz własny kolor firmy ${company.name}`}
                              value={isValidCompanyColor(editColor) ? editColor : resolveCompanyColor(company)}
                              onChange={(e) => setEditColor(e.target.value.toUpperCase())}
                              className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer p-0"
                            />
                            <input
                              id={`edit-color-${company.id}`}
                              type="text"
                              maxLength={7}
                              value={editColor}
                              onChange={(e) => setEditColor(e.target.value)}
                              placeholder="#1D4ED8"
                              className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs font-mono uppercase text-slate-900 dark:text-white"
                            />
                          </div>
                        </div>
                      </div>

                      {projCount > 0 && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                          Litery firmy nie można zmienić, ponieważ posiada przypisane projekty ({projCount}).
                        </p>
                      )}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Anuluj</span>
                        </button>
                        <button
                          type="button"
                          disabled={companySubmit.isSubmitting}
                          onClick={() => handleSaveEdit(company)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold"
                        >
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Zapisz</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          style={getCompanyBadgeColors(company, isDark ? 'dark' : 'light')}
                          title={`Kolor firmy: ${resolveCompanyColor(company)}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg font-mono text-sm font-bold border shrink-0"
                        >
                          {company.letter}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">
                              {company.name}
                            </span>
                            {company.isActive ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                Aktywna
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                                Nieaktywna
                              </span>
                            )}
                            {company.vatPayer === false ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                Zwolniona z VAT
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                Płatnik VAT
                              </span>
                            )}
                            {isDefault && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                Domyślna
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                              Projekty: {projCount}
                            </span>
                          </div>
                          {(company.nip || company.address || (company.vatPayer === false && company.vatExemptionBasis)) && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap gap-3">
                              {company.nip && <span className="font-mono">NIP: {company.nip}</span>}
                              {company.address && <span>{company.address}</span>}
                              {company.vatPayer === false && company.vatExemptionBasis && (
                                <span className="text-amber-800 dark:text-amber-300">
                                  Podstawa ZW: {company.vatExemptionBasis}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(company)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                        >
                          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Edytuj</span>
                        </button>

                        <button
                          type="button"
                          disabled={companySubmit.isSubmitting}
                          onClick={() => handleToggleActive(company)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-medium"
                        >
                          <Power className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{company.isActive ? 'Dezaktywuj' : 'Aktywuj'}</span>
                        </button>

                        {confirmDeleteId === company.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={companySubmit.isSubmitting}
                              onClick={() => handleDeleteCompany(company)}
                              className="px-2.5 py-1 rounded bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-semibold"
                            >
                              Potwierdź
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs"
                            >
                              Anuluj
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={companySubmit.isSubmitting}
                            onClick={() => setConfirmDeleteId(company.id)}
                            aria-label={`Usuń firmę ${company.letter} - ${company.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 text-xs font-medium"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Usuń</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingVatConfirm && (
        <div
          onPointerDown={(e) => {
            vatBackdropProps.onPointerDown(e);
            e.stopPropagation();
          }}
          onClick={(e) => {
            vatBackdropProps.onClick(e);
            e.stopPropagation();
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            ref={vatConfirmRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vat-change-confirm-title"
            tabIndex={-1}
            className={`w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4 ${vatFlashClassName}`}
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <h6
                  id="vat-change-confirm-title"
                  className="text-sm font-bold text-slate-900 dark:text-white"
                >
                  Potwierdź zmianę statusu VAT firmy
                </h6>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Firma{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {pendingVatConfirm.company.letter} - {pendingVatConfirm.company.name}
                  </span>{' '}
                  ma przypisane projekty ({pendingVatConfirm.affectedCount}).
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              {pendingVatConfirm.nextVatPayer
                ? 'Po zmianie na „Płatnik VAT” bilans i koszty projektów będą rozliczane według kwot netto. Dotychczasowe dane zapisane w bazie projektów pozostaną nienaruszone.'
                : 'Po zmianie na „Zwolniona z VAT” przychody projektów będą liczone bez VAT (stawka ZW), a koszty według kwoty brutto (VAT nieodliczalny). Dotychczasowe kwoty zapisane w bazie projektów nie zostaną nadpisane.'}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                ref={vatCancelRef}
                type="button"
                disabled={companySubmit.isSubmitting}
                onClick={() => setPendingVatConfirm(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={companySubmit.isSubmitting}
                onClick={() => executeSaveEdit(pendingVatConfirm.company, pendingVatConfirm.payload)}
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Potwierdź zmianę
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
