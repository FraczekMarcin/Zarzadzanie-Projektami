import React, { useState, useEffect } from 'react';
import {
  BellRing,
  Percent,
  RotateCcw,
  Trash2,
  Tag,
  Building2,
} from 'lucide-react';
import {
  getVatRates,
  saveVatRates,
  VatRateOption,
  getClients,
  saveClients,
  ClientRecord,
  DEFAULT_VAT_RATES,
  getTaskTypes,
  saveTaskTypes,
  TaskTypeDefinition,
  DEFAULT_TASK_TYPES,
} from '../../utils/variableSettings';

export interface VariablesTabProps {
  isOpen: boolean;
  warningDays: number;
  onWarningDaysChange: (days: number) => void;
}

export const VariablesTab: React.FC<VariablesTabProps> = ({
  isOpen,
  warningDays,
  onWarningDaysChange,
}) => {
  const [vatRates, setVatRates] = useState<VatRateOption[]>(() => getVatRates());
  const [newVatRate, setNewVatRate] = useState<number>(23);
  const [newVatLabel, setNewVatLabel] = useState<string>('23% Podstawowa');

  const [clients, setClients] = useState<ClientRecord[]>(() => getClients());
  const [newClientName, setNewClientName] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientNip, setNewClientNip] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');

  const [taskTypes, setTaskTypes] = useState<TaskTypeDefinition[]>(() => getTaskTypes());
  const [newTaskTypeId, setNewTaskTypeId] = useState('');
  const [newTaskTypeLabel, setNewTaskTypeLabel] = useState('');
  const [newTaskTypeDesc, setNewTaskTypeDesc] = useState('');
  const [newTaskTypeColor] = useState('sky');

  useEffect(() => {
    setVatRates(getVatRates());
    setClients(getClients());
    setTaskTypes(getTaskTypes());
  }, [isOpen]);

  const handleAddVatRate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVatLabel.trim()) return;

    const updated: VatRateOption[] = [
      ...vatRates,
      {
        id: `vat-${Date.now()}`,
        value: Number(newVatRate),
        rate: Number(newVatRate),
        label: newVatLabel.trim(),
        isDefault: vatRates.length === 0,
      },
    ];

    setVatRates(updated);
    saveVatRates(updated);
    setNewVatLabel('');
    setNewVatRate(23);
  };

  const handleDeleteVatRate = (id: string) => {
    const updated = vatRates.filter((v) => v.id !== id);
    setVatRates(updated);
    saveVatRates(updated);
  };

  const handleResetVatRates = () => {
    setVatRates(DEFAULT_VAT_RATES);
    saveVatRates(DEFAULT_VAT_RATES);
  };

  const handleAddClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    const newRec: ClientRecord = {
      id: `cli-${Date.now()}`,
      name: newClientName.trim(),
      contactPerson: newClientContact.trim() || undefined,
      phone: newClientPhone.trim() || undefined,
      email: newClientEmail.trim() || undefined,
      nip: newClientNip.trim() || undefined,
      address: newClientAddress.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const updated = [newRec, ...clients];
    setClients(updated);
    saveClients(updated);

    setNewClientName('');
    setNewClientContact('');
    setNewClientPhone('');
    setNewClientEmail('');
    setNewClientNip('');
    setNewClientAddress('');
  };

  const handleDeleteClient = (id: string) => {
    const updated = clients.filter((c) => c.id !== id);
    setClients(updated);
    saveClients(updated);
  };

  const handleAddTaskType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTypeLabel.trim()) return;

    const id = newTaskTypeId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `typ-${Date.now()}`;
    const newType: TaskTypeDefinition = {
      id,
      name: newTaskTypeLabel.trim(),
      label: newTaskTypeLabel.trim(),
      description: newTaskTypeDesc.trim() || undefined,
      color: 'sky',
      badgeColor: newTaskTypeColor,
      isDefault: false,
    };

    const updated = [...taskTypes, newType];
    setTaskTypes(updated);
    saveTaskTypes(updated);

    setNewTaskTypeId('');
    setNewTaskTypeLabel('');
    setNewTaskTypeDesc('');
  };

  const handleDeleteTaskType = (id: string) => {
    const updated = taskTypes.filter((t) => t.id !== id);
    setTaskTypes(updated);
    saveTaskTypes(updated);
  };

  const handleResetTaskTypes = () => {
    setTaskTypes(DEFAULT_TASK_TYPES);
    saveTaskTypes(DEFAULT_TASK_TYPES);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Section: Deadline Warning Threshold */}
      <div className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-3">
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

        <div className="flex items-center gap-3 pt-1">
          <label htmlFor="settings-warning-days" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Czas wyprzedzenia ostrzeżenia:
          </label>
          <div className="flex items-center gap-2">
            <input
              id="settings-warning-days"
              type="number"
              min="1"
              max="30"
              value={warningDays}
              onChange={(e) => onWarningDaysChange(Number(e.target.value))}
              className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-center"
            />
            <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">dni kalendarzowych</span>
          </div>
        </div>
      </div>

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
          <button
            type="button"
            onClick={handleResetVatRates}
            className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            title="Przywróć domyślne stawki (23%, 8%, 5%, 0%, ZW)"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Domyślne</span>
          </button>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold w-24">Stawka %</th>
                <th scope="col" className="py-2 px-3 font-semibold">Nazwa / Opis stawki</th>
                <th scope="col" className="py-2 px-3 font-semibold w-28 text-center">Status</th>
                <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {vatRates.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-white">
                    {v.value ?? v.rate}%
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
                  <td className="py-2 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteVatRate(v.id)}
                      className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1"
                      aria-label={`Usuń stawkę VAT ${v.label}`}
                      title="Usuń stawkę VAT"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add new VAT rate */}
        <form onSubmit={handleAddVatRate} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-2 items-end">
          <div className="w-24">
            <label htmlFor="settings-new-vat-rate" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka %</label>
            <input
              id="settings-new-vat-rate"
              type="number"
              required
              min="0"
              max="100"
              value={newVatRate}
              onChange={(e) => setNewVatRate(Number(e.target.value))}
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="settings-new-vat-label" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Etykieta stawki</label>
            <input
              id="settings-new-vat-label"
              type="text"
              required
              value={newVatLabel}
              onChange={(e) => setNewVatLabel(e.target.value)}
              placeholder="np. 23% Podstawowa lub ZW (Zwolniony)"
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-semibold text-xs shadow-xs transition-colors"
          >
            + Dodaj stawkę
          </button>
        </form>
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
          <button
            type="button"
            onClick={handleResetTaskTypes}
            className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            title="Przywróć domyślne typy zadań (Rysunek, Opis, Uzgodnienia, Czekanie na urząd)"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Domyślne typy</span>
          </button>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold w-32">Identyfikator</th>
                <th scope="col" className="py-2 px-3 font-semibold">Nazwa typu zadania</th>
                <th scope="col" className="py-2 px-3 font-semibold">Opis / Zastosowanie</th>
                <th scope="col" className="py-2 px-3 font-semibold w-24 text-center">Status</th>
                <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {taskTypes.map((tt) => (
                <tr key={tt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                    {tt.id}
                  </td>
                  <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                    {tt.label}
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                    {tt.description || '—'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                      {tt.isDefault ? 'Standard' : 'Własny'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteTaskType(tt.id)}
                      className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1"
                      aria-label={`Usuń typ zadania ${tt.label}`}
                      title="Usuń ten typ zadania"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add new task type form */}
        <form onSubmit={handleAddTaskType} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-2 items-end">
          <div className="w-28">
            <label htmlFor="settings-task-type-id" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kod / ID</label>
            <input
              id="settings-task-type-id"
              type="text"
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
              value={newTaskTypeDesc}
              onChange={(e) => setNewTaskTypeDesc(e.target.value)}
              placeholder="Zastosowanie w dokumentacji"
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded font-semibold text-xs shadow-xs transition-colors"
          >
            + Dodaj typ
          </button>
        </form>
      </div>

      {/* Section: Clients list */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Baza stałych Zamawiających / Inwestorów ({clients.length})</span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Każdy wprowadzony w projekcie Zamawiający automatycznie dodaje się do tej listy i jest dostępny w podpowiedziach.
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
                <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-600 dark:text-slate-400">
                    Brak stałych inwestorów w bazie. Wpisz pierwszego poniżej lub dodaj projekt z danymi Zamawiającego.
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
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteClient(c.id)}
                        className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1"
                        aria-label={`Usuń inwestora ${c.name}`}
                        title="Usuń inwestora z bazy"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Add new client form */}
        <form onSubmit={handleAddClient} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
          <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
            + Dodaj nowego Inwestora do listy stałych klientów
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              aria-label="Nazwa firmy lub inwestora"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="Nazwa firmy / Inwestora *"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
            <input
              type="text"
              aria-label="Osoba kontaktowa"
              value={newClientContact}
              onChange={(e) => setNewClientContact(e.target.value)}
              placeholder="Osoba kontaktowa"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
            <input
              type="text"
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
              aria-label="Telefon inwestora"
              value={newClientPhone}
              onChange={(e) => setNewClientPhone(e.target.value)}
              placeholder="Telefon (+48 ...)"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
            <input
              type="email"
              aria-label="Adres e-mail inwestora"
              value={newClientEmail}
              onChange={(e) => setNewClientEmail(e.target.value)}
              placeholder="Adres E-mail"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            />
            <button
              type="submit"
              className="py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded font-semibold text-xs transition-colors shadow-xs"
            >
              Zapisz Inwestora w bazie
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VariablesTab;
