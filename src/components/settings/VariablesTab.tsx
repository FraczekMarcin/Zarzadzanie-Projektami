import React, { useState, useEffect } from 'react';
import {
  BellRing,
  Percent,
  RotateCcw,
  Trash2,
  Tag,
  Building2,
  AlertCircle,
  CheckCircle2,
  Lock,
  UploadCloud,
} from 'lucide-react';
import type { User } from '../../types';
import {
  VatRateOption,
  ClientRecord,
  DEFAULT_VAT_RATES,
  TaskTypeDefinition,
  DEFAULT_TASK_TYPES,
  VARIABLES_LIMITS,
  saveVariablesToServer,
  hasLegacyLocalVariables,
  readLegacyLocalVariables,
  clearLegacyLocalVariables,
} from '../../utils/variableSettings';
import { useVariables } from '../../hooks/useVariables';
import { useSettingsTabDirty } from './SettingsDirtyContext';

export interface VariablesTabProps {
  isOpen: boolean;
  currentUser: User | null;
}

export const VariablesTab: React.FC<VariablesTabProps> = ({
  isOpen,
  currentUser,
}) => {
  const reportTabDirty = useSettingsTabDirty();
  const serverVars = useVariables();
  const isAdmin = currentUser?.role === 'admin';
  const canViewClients = currentUser?.role === 'admin' || currentUser?.role === 'project_manager';

  const vatRates = serverVars.vatRates;
  const clients = serverVars.clients;
  const taskTypes = serverVars.taskTypes;

  const [warningDaysInput, setWarningDaysInput] = useState<string>(
    String(serverVars.deadlineWarningDays)
  );
  const [newVatRate, setNewVatRate] = useState<number>(23);
  const [newVatLabel, setNewVatLabel] = useState<string>('23% Podstawowa');
  const [newVatExempt, setNewVatExempt] = useState<boolean>(false);

  const [newClientName, setNewClientName] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientNip, setNewClientNip] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');

  const [newTaskTypeId, setNewTaskTypeId] = useState('');
  const [newTaskTypeLabel, setNewTaskTypeLabel] = useState('');
  const [newTaskTypeDesc, setNewTaskTypeDesc] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showMigrationBanner, setShowMigrationBanner] = useState<boolean>(false);

  useEffect(() => {
    setWarningDaysInput(String(serverVars.deadlineWarningDays));
  }, [serverVars.deadlineWarningDays, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSaveError(null);
      setSaveSuccess(null);
    }
    setShowMigrationBanner(Boolean(isAdmin && !serverVars.initialized && hasLegacyLocalVariables()));
  }, [isOpen, isAdmin, serverVars.initialized]);

  const isDirty = Boolean(
    isOpen &&
      isAdmin &&
      (warningDaysInput !== String(serverVars.deadlineWarningDays) ||
        newVatRate !== 23 ||
        (newVatLabel.trim() !== '' && newVatLabel !== '23% Podstawowa') ||
        newVatExempt !== false ||
        newClientName.trim() ||
        newClientContact.trim() ||
        newClientPhone.trim() ||
        newClientEmail.trim() ||
        newClientNip.trim() ||
        newClientAddress.trim() ||
        newTaskTypeId.trim() ||
        newTaskTypeLabel.trim() ||
        newTaskTypeDesc.trim())
  );

  useEffect(() => {
    reportTabDirty('variables', isDirty);
    return () => reportTabDirty('variables', false);
  }, [isDirty, reportTabDirty]);

  const persistPatch = async (
    patch: Parameters<typeof saveVariablesToServer>[0],
    successMsg: string
  ): Promise<boolean> => {
    if (!isAdmin) return false;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    const result = await saveVariablesToServer(patch);
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.error || 'Nie udało się zapisać zmian na serwerze.');
      return false;
    }
    setSaveSuccess(successMsg);
    return true;
  };

  const handleMigrateFromBrowser = async () => {
    if (!isAdmin) return;
    const legacyPatch = readLegacyLocalVariables();
    const patchToSave =
      Object.keys(legacyPatch).length > 0
        ? legacyPatch
        : { deadlineWarningDays: serverVars.deadlineWarningDays };

    const ok = await persistPatch(
      patchToSave,
      'Ustawienia z przeglądarki zostały zapisane na serwerze.'
    );
    if (ok) {
      clearLegacyLocalVariables();
      setShowMigrationBanner(false);
    }
  };

  const handleSkipMigration = () => {
    clearLegacyLocalVariables();
    setShowMigrationBanner(false);
  };

  const handleSaveWarningDays = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const parsed = Number(warningDaysInput.trim());
    if (
      warningDaysInput.trim() === '' ||
      !Number.isInteger(parsed) ||
      parsed < VARIABLES_LIMITS.deadlineWarningDaysMin ||
      parsed > VARIABLES_LIMITS.deadlineWarningDaysMax
    ) {
      setSaveError('Czas wyprzedzenia ostrzeżenia musi być liczbą całkowitą od 0 do 30 dni.');
      return;
    }
    await persistPatch({ deadlineWarningDays: parsed }, 'Zapisano liczbę dni ostrzeżenia o terminie.');
  };

  const handleAddVatRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newVatLabel.trim()) return;

    const rateVal = newVatExempt ? 0 : Number(newVatRate);
    const newItem: VatRateOption = {
      id: `vat-${Date.now()}`,
      value: rateVal,
      rate: rateVal,
      label: newVatLabel.trim(),
      ...(newVatExempt ? { isExempt: true } : {}),
      isDefault: vatRates.length === 0,
    };

    const updated = [...vatRates, newItem];
    const ok = await persistPatch({ vatRates: updated }, 'Dodano stawkę VAT.');
    if (ok) {
      setNewVatLabel('');
      setNewVatRate(23);
      setNewVatExempt(false);
    }
  };

  const handleDeleteVatRate = async (id: string) => {
    if (!isAdmin) return;
    const updated = vatRates.filter((v) => v.id !== id);
    await persistPatch({ vatRates: updated }, 'Usunięto stawkę VAT.');
  };

  const handleResetVatRates = async () => {
    if (!isAdmin) return;
    await persistPatch(
      { vatRates: DEFAULT_VAT_RATES.map((v) => ({ ...v })) },
      'Przywrócono domyślne stawki VAT.'
    );
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newClientName.trim()) return;

    const newRec: ClientRecord = {
      id: `cli-${Date.now()}`,
      name: newClientName.trim(),
      ...(newClientContact.trim() ? { contactPerson: newClientContact.trim() } : {}),
      ...(newClientPhone.trim() ? { phone: newClientPhone.trim() } : {}),
      ...(newClientEmail.trim() ? { email: newClientEmail.trim() } : {}),
      ...(newClientNip.trim() ? { nip: newClientNip.trim() } : {}),
      ...(newClientAddress.trim() ? { address: newClientAddress.trim() } : {}),
      createdAt: new Date().toISOString(),
    };

    const updated = [newRec, ...clients];
    const ok = await persistPatch({ clients: updated }, 'Zapisano inwestora w bazie serwera.');
    if (ok) {
      setNewClientName('');
      setNewClientContact('');
      setNewClientPhone('');
      setNewClientEmail('');
      setNewClientNip('');
      setNewClientAddress('');
    }
  };

  const handleDeleteClient = async (id: string) => {
    if (!isAdmin) return;
    const updated = clients.filter((c) => c.id !== id);
    await persistPatch({ clients: updated }, 'Usunięto inwestora z bazy serwera.');
  };

  const handleAddTaskType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newTaskTypeLabel.trim()) return;

    const id =
      newTaskTypeId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `typ-${Date.now()}`;
    const trimmedName = newTaskTypeLabel.trim();
    const newType: TaskTypeDefinition = {
      id,
      name: trimmedName,
      label: trimmedName,
      ...(newTaskTypeDesc.trim() ? { description: newTaskTypeDesc.trim() } : {}),
      color: 'sky',
      isDefault: false,
    };

    const updated = [...taskTypes, newType];
    const ok = await persistPatch({ taskTypes: updated }, 'Dodano nowy typ zadania.');
    if (ok) {
      setNewTaskTypeId('');
      setNewTaskTypeLabel('');
      setNewTaskTypeDesc('');
    }
  };

  const handleDeleteTaskType = async (id: string) => {
    if (!isAdmin) return;
    const updated = taskTypes.filter((t) => t.id !== id);
    await persistPatch({ taskTypes: updated }, 'Usunięto typ zadania.');
  };

  const handleResetTaskTypes = async () => {
    if (!isAdmin) return;
    await persistPatch(
      { taskTypes: DEFAULT_TASK_TYPES.map((t) => ({ ...t })) },
      'Przywrócono domyślne typy zadań.'
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* One-time migration banner from browser localStorage */}
      {showMigrationBanner && (
        <div
          role="region"
          aria-label="Migracja ustawień z przeglądarki"
          className="p-4 bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800 rounded-xl flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-sky-950 dark:text-sky-100">
            <UploadCloud className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>Znaleziono ustawienia z tej przeglądarki. Zapisać je na serwerze?</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleMigrateFromBrowser}
              className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              Zapisz na serwerze
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSkipMigration}
              className="px-3 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold transition-colors"
            >
              Pomiń
            </button>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div
          role="note"
          className="p-3 bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 text-xs flex items-center gap-2"
        >
          <Lock className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" aria-hidden="true" />
          <span>Podgląd tylko do odczytu. Zmiana zmiennych systemowych jest dostępna wyłącznie dla Administratora.</span>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{saveError}</span>
        </div>
      )}

      {saveSuccess && (
        <div
          role="status"
          className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {/* Section: Deadline Warning Threshold */}
      <form
        onSubmit={handleSaveWarningDays}
        className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
              <BellRing className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <span>Ostrzeżenia o zbliżającym się terminie zadania (Drzewo Zadań)</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-300 text-[11px]">
              W drzewie zadań zadania, których termin upływa za podaną liczbę dni, będą miały mrugającą obwiednię.
              Zadania przeterminowane mrugają na czerwono.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label htmlFor="settings-warning-days" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Czas wyprzedzenia ostrzeżenia:
          </label>
          <div className="flex items-center gap-2">
            <input
              id="settings-warning-days"
              type="number"
              min="0"
              max="30"
              disabled={!isAdmin || isSaving}
              value={warningDaysInput}
              onChange={(e) => setWarningDaysInput(e.target.value)}
              className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-center disabled:opacity-60"
            />
            <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">dni kalendarzowych</span>
            {isAdmin && (
              <button
                type="submit"
                disabled={isSaving}
                className="px-3 py-1 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors"
              >
                Zapisz
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Section: VAT Rates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Percent className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Definicja stawek podatku VAT</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              Stawki VAT wykorzystywane w wycenach ofertowych oraz kalkulacji kosztów branżowych.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleResetVatRates}
              className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              title="Przywróć domyślne stawki (23%, 8%, 5%, 0%, ZW)"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Domyślne</span>
            </button>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold w-24">Stawka %</th>
                <th scope="col" className="py-2 px-3 font-semibold">Nazwa / Opis stawki</th>
                <th scope="col" className="py-2 px-3 font-semibold w-28 text-center">Status</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {vatRates.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-white">
                    {v.isExempt ? 'ZW' : `${v.value ?? v.rate}%`}
                  </td>
                  <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">
                    {v.label}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {v.isDefault ? (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold">
                        Domyślna
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-600 dark:text-slate-400">Opcjonalna</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleDeleteVatRate(v.id)}
                        className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1 disabled:opacity-50"
                        aria-label={`Usuń stawkę VAT ${v.label}`}
                        title="Usuń stawkę VAT"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add new VAT rate */}
        {isAdmin && (
          <form onSubmit={handleAddVatRate} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-2 items-end">
            <div className="w-24">
              <label htmlFor="settings-new-vat-rate" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka %</label>
              <input
                id="settings-new-vat-rate"
                type="number"
                required
                step="0.01"
                min="0"
                max="100"
                disabled={isSaving || newVatExempt}
                value={newVatExempt ? 0 : newVatRate}
                onChange={(e) => setNewVatRate(Number(e.target.value))}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono disabled:opacity-60"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="settings-new-vat-label" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Etykieta stawki</label>
              <input
                id="settings-new-vat-label"
                type="text"
                required
                maxLength={VARIABLES_LIMITS.vatLabelMax}
                disabled={isSaving}
                value={newVatLabel}
                onChange={(e) => setNewVatLabel(e.target.value)}
                placeholder="np. 23% Podstawowa lub ZW (Zwolniony)"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 pb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newVatExempt}
                disabled={isSaving}
                onChange={(e) => setNewVatExempt(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700"
              />
              <span>ZW</span>
            </label>
            <button
              type="submit"
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj stawkę
            </button>
          </form>
        )}
      </div>

      {/* Section: Task Types (Typy zadań: Rysunek, Opis, Uzgodnienia, Czekanie na urząd) */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Definicja Typów Zadań ({taskTypes.length})</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              Kategoryzacja zadań w pracowni: Rysunek, Opis, Uzgodnienia, Czekanie na urząd oraz typy zdefiniowane przez biuro.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleResetTaskTypes}
              className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              title="Przywróć domyślne typy zadań (Rysunek, Opis, Uzgodnienia, Czekanie na urząd)"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Domyślne typy</span>
            </button>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold w-32">Identyfikator</th>
                <th scope="col" className="py-2 px-3 font-semibold">Nazwa typu zadania</th>
                <th scope="col" className="py-2 px-3 font-semibold">Opis / Zastosowanie</th>
                <th scope="col" className="py-2 px-3 font-semibold w-24 text-center">Status</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {taskTypes.map((tt) => (
                <tr key={tt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                    {tt.id}
                  </td>
                  <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                    {tt.name || tt.label}
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                    {tt.description || '—'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                      {tt.isDefault ? 'Standard' : 'Własny'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleDeleteTaskType(tt.id)}
                        className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1 disabled:opacity-50"
                        aria-label={`Usuń typ zadania ${tt.name || tt.label}`}
                        title="Usuń ten typ zadania"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add new task type form */}
        {isAdmin && (
          <form onSubmit={handleAddTaskType} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-2 items-end">
            <div className="w-28">
              <label htmlFor="settings-task-type-id" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kod / ID</label>
              <input
                id="settings-task-type-id"
                type="text"
                maxLength={VARIABLES_LIMITS.taskTypeIdMax}
                disabled={isSaving}
                value={newTaskTypeId}
                onChange={(e) => setNewTaskTypeId(e.target.value)}
                placeholder="np. nadzor"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label htmlFor="settings-task-type-label" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Nazwa typu *</label>
              <input
                id="settings-task-type-label"
                type="text"
                required
                maxLength={VARIABLES_LIMITS.taskTypeNameMax}
                disabled={isSaving}
                value={newTaskTypeLabel}
                onChange={(e) => setNewTaskTypeLabel(e.target.value)}
                placeholder="np. Nadzór autorski"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="settings-task-type-desc" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Opis / zastosowanie</label>
              <input
                id="settings-task-type-desc"
                type="text"
                maxLength={VARIABLES_LIMITS.taskTypeDescMax}
                disabled={isSaving}
                value={newTaskTypeDesc}
                onChange={(e) => setNewTaskTypeDesc(e.target.value)}
                placeholder="Zastosowanie w dokumentacji"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj typ
            </button>
          </form>
        )}
      </div>

      {/* Section: Clients list (visible only for admin and project_manager) */}
      {canViewClients && (
        <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Baza stałych Zamawiających / Inwestorów ({clients.length})</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              Lista stałych Zamawiających dostępna w formularzach projektów i wycenach.
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th scope="col" className="py-2 px-3 font-semibold">Nazwa Inwestora</th>
                  <th scope="col" className="py-2 px-3 font-semibold">Osoba kontaktowa</th>
                  <th scope="col" className="py-2 px-3 font-semibold">NIP</th>
                  <th scope="col" className="py-2 px-3 font-semibold">Kontakt</th>
                  {isAdmin && <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 5 : 4} className="py-4 text-center text-slate-600 dark:text-slate-400">
                      Brak stałych inwestorów w bazie.
                    </td>
                  </tr>
                ) : (
                  clients.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                        {c.name}
                        {c.address && <span className="block text-[10px] text-slate-600 dark:text-slate-400 font-normal">{c.address}</span>}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                        {c.contactPerson || '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {c.nip || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                        {c.phone && <div>{c.phone}</div>}
                        {c.email && <div className="text-sky-700 dark:text-sky-400">{c.email}</div>}
                        {!c.phone && !c.email && '—'}
                      </td>
                      {isAdmin && (
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleDeleteClient(c.id)}
                            className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1 disabled:opacity-50"
                            aria-label={`Usuń inwestora ${c.name}`}
                            title="Usuń inwestora z bazy"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Add new client form */}
          {isAdmin && (
            <form onSubmit={handleAddClient} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                + Dodaj nowego Inwestora do listy stałych klientów
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Nazwa firmy lub inwestora"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Nazwa firmy / Inwestora *"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Osoba kontaktowa"
                  value={newClientContact}
                  onChange={(e) => setNewClientContact(e.target.value)}
                  placeholder="Osoba kontaktowa"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  maxLength={VARIABLES_LIMITS.clientNipMax}
                  disabled={isSaving}
                  aria-label="NIP inwestora"
                  value={newClientNip}
                  onChange={(e) => setNewClientNip(e.target.value)}
                  placeholder="NIP"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Telefon inwestora"
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  placeholder="Telefon (+48 ...)"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="email"
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Adres e-mail inwestora"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="Adres E-mail"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={isSaving}
                  className="py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors shadow-xs"
                >
                  Zapisz Inwestora w bazie
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default VariablesTab;
