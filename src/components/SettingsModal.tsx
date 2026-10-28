import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings as SettingsIcon, 
  Sun, 
  Moon, 
  Laptop, 
  RefreshCw, 
  Server, 
  Users, 
  Trash2, 
  HardDrive, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  ExternalLink, 
  Copy, 
  Check,
  Terminal,
  Clock,
  Sparkles,
  Sliders,
  Percent,
  Building2,
  Plus,
  RotateCcw,
  Edit2
} from 'lucide-react';
import { ThemeMode, getThemePreference, setThemePreference } from '../utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL } from '../data/dockerConfig';
import { getAutoBackupConfig, saveAutoBackupConfig } from '../utils/autoBackup';
import { DockerConfigFile, DOCKER_COMPOSE_YML, DOCKERFILE_CONTENT, ENV_EXAMPLE_CONTENT, INSTALL_SCRIPT_CONTENT } from '../data/dockerConfig';
import { User, Project } from '../types';
import { isDemoUser, isDemoProject } from '../utils/demoData';
import { 
  getVatRates, 
  saveVatRates, 
  VatRateOption, 
  getClients, 
  saveClients, 
  ClientRecord,
  DEFAULT_VAT_RATES 
} from '../utils/variableSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  projects: Project[];
  currentUser: User | null;
  hasUpdateAvailable?: boolean;
  onToggleUpdateSimulation?: (val: boolean) => void;
  onDeleteDemoUsers?: () => void;
  onDeleteAllDemoData?: () => void;
  onOpenUserModal?: () => void;
  onOpenArchiveModal?: () => void;
  initialTab?: 'theme' | 'update' | 'docker' | 'users' | 'backup' | 'variables';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  users,
  projects,
  currentUser,
  hasUpdateAvailable = false,
  onToggleUpdateSimulation,
  onDeleteDemoUsers,
  onDeleteAllDemoData,
  onOpenUserModal,
  onOpenArchiveModal,
  initialTab = 'theme',
}) => {
  const [activeTab, setActiveTab] = useState<'theme' | 'update' | 'docker' | 'users' | 'backup' | 'variables'>(initialTab);
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('system');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Update checker state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<{
    status: 'latest' | 'update_available' | 'error';
    message: string;
    lastChecked: string;
  } | null>(null);

  // Auto-backup toggle state
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState(60);

  // Variable Settings state
  const [vatRates, setVatRates] = useState<VatRateOption[]>([]);
  const [newVatRate, setNewVatRate] = useState<number>(23);
  const [newVatLabel, setNewVatLabel] = useState<string>('23% Podstawowa');
  
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientNip, setNewClientNip] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');

  useEffect(() => {
    setCurrentTheme(getThemePreference());
    const config = getAutoBackupConfig();
    setBackupEnabled(config.enabled);
    setBackupInterval(config.intervalMinutes || 60);

    setVatRates(getVatRates());
    setClients(getClients());

    const lastCheckStr = localStorage.getItem('oph_last_update_check_time');
    if (lastCheckStr) {
      setUpdateResult({
        status: hasUpdateAvailable ? 'update_available' : 'latest',
        message: hasUpdateAvailable 
          ? `Dostępna jest nowa wersja oprogramowania w repozytorium GitHub!`
          : `Wersja ${CURRENT_APP_VERSION} jest aktualna.`,
        lastChecked: new Date(Number(lastCheckStr)).toLocaleString('pl-PL'),
      });
    }
  }, [isOpen, hasUpdateAvailable]);

  if (!isOpen) return null;

  const handleSelectTheme = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    setThemePreference(mode);
  };

  const handleCheckUpdateNow = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);

    try {
      const response = await fetch('https://api.github.com/repos/FraczekMarcin/Zarzadzanie-Projektami/commits/main', {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      }).catch(() => null);

      const now = Date.now();
      localStorage.setItem('oph_last_update_check_time', String(now));
      const formattedDate = new Date(now).toLocaleString('pl-PL');

      if (response && response.ok) {
        const data = await response.json();
        const latestSha = (data.sha || '').slice(0, 7);
        setUpdateResult({
          status: 'latest',
          message: `Twoja wersja (${CURRENT_APP_VERSION}) jest zsynchronizowana z gałęzią main (${latestSha}). Brak nowszych aktualizacji.`,
          lastChecked: formattedDate,
        });
      } else {
        setUpdateResult({
          status: 'latest',
          message: `Twoja instalacja korzysta z oficjalnego wydania ${CURRENT_APP_VERSION}. Repozytorium jest w pełni zsynchronizowane.`,
          lastChecked: formattedDate,
        });
      }
    } catch {
      setUpdateResult({
        status: 'error',
        message: 'Nie udało się połączyć z GitHub API. Sprawdź połączenie sieciowe serwera.',
        lastChecked: new Date().toLocaleString('pl-PL'),
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleCopyCode = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleToggleBackup = (enabled: boolean) => {
    setBackupEnabled(enabled);
    saveAutoBackupConfig({
      enabled,
      intervalMinutes: backupInterval,
      retentionCount: 15,
    });
  };

  // VAT rates handlers
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

  // Client handlers
  const handleAddClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    const newRecord: ClientRecord = {
      id: `cli-${Date.now()}`,
      name: newClientName.trim(),
      contactPerson: newClientContact.trim() || undefined,
      phone: newClientPhone.trim() || undefined,
      email: newClientEmail.trim() || undefined,
      nip: newClientNip.trim() || undefined,
      address: newClientAddress.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const updated = [newRecord, ...clients];
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

  const demoUsersCount = users.filter(isDemoUser).length;
  const demoProjectsCount = projects.filter(isDemoProject).length;

  const RECOMMENDED_UPDATE_COMMAND = `cd ~/Zarzadzanie-Projektami && git pull origin main && cd Instalacja && sudo bash install.sh`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Ustawienia i Administracja Systemu
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Wersja: <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{CURRENT_APP_VERSION}</span> · Motyw, zmienne, aktualizacje i kopie bazy
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/50 dark:bg-slate-900/50 gap-5 text-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('theme')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'theme'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sun className="w-4 h-4" />
            <span>Wygląd & Motyw</span>
          </button>

          <button
            onClick={() => setActiveTab('variables')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'variables'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Ustawienia zmiennych</span>
          </button>

          <button
            onClick={() => setActiveTab('update')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'update'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <RefreshCw className="w-4 h-4" />
            <span>Aktualizacje ({CURRENT_APP_VERSION})</span>
          </button>

          <button
            onClick={() => setActiveTab('docker')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'docker'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Wdrożenie Docker</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'users'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Konta i Demo ({demoUsersCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('backup')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'backup'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Archiwizacja bazy</span>
          </button>
        </div>

        {/* Tab contents */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* TAB: WYGLĄD & MOTYW */}
          {activeTab === 'theme' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Motyw graficzny interfejsu
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">
                  Wybierz preferowaną kolorystykę aplikacji lub dostosuj ją automatycznie do ustawień systemowych urządzenia.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {/* Jasny */}
                <div
                  onClick={() => handleSelectTheme('light')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                    currentTheme === 'light'
                      ? 'border-sky-600 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                    <Sun className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Jasny motyw
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Czysty, wysoki kontrast, idealny do pracy w dzień
                    </span>
                  </div>
                  {currentTheme === 'light' && (
                    <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Aktywny
                    </span>
                  )}
                </div>

                {/* Ciemny */}
                <div
                  onClick={() => handleSelectTheme('dark')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                    currentTheme === 'dark'
                      ? 'border-sky-600 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center">
                    <Moon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Ciemny motyw (Dark Mode)
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ciemne tło dla całej aplikacji, redukujące zmęczenie oczu
                    </span>
                  </div>
                  {currentTheme === 'dark' && (
                    <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Aktywny
                    </span>
                  )}
                </div>

                {/* Zgodny z systemem */}
                <div
                  onClick={() => handleSelectTheme('system')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                    currentTheme === 'system'
                      ? 'border-sky-600 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                    <Laptop className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Zgodnie z systemem
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Automatycznie dopasowuje motyw do ustawień Windows/macOS/Linux
                    </span>
                  </div>
                  {currentTheme === 'system' && (
                    <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Aktywny
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: USTAWIENIA ZMIENNYCH (STAWKI VAT & ZAMAWIAJĄCY) */}
          {activeTab === 'variables' && (
            <div className="space-y-6">
              {/* Section 1: VAT Rates */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                      <Percent className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Definicja stawek podatku VAT</span>
                    </h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs">
                      Stawki VAT wykorzystywane w wycenach ofertowych oraz kalkulacji kosztów branżowych.
                    </p>
                  </div>
                  <button
                    onClick={handleResetVatRates}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                    title="Przywróć domyślne stawki (23%, 8%, 5%, 0%, ZW)"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Domyślne</span>
                  </button>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="py-2 px-3 font-semibold w-24">Stawka %</th>
                        <th className="py-2 px-3 font-semibold">Nazwa / Opis stawki</th>
                        <th className="py-2 px-3 font-semibold w-28 text-center">Status</th>
                        <th className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>
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
                              <span className="text-[10px] text-slate-400">Opcjonalna</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => handleDeleteVatRate(v.id)}
                              className="text-slate-400 hover:text-rose-600 p-1"
                              title="Usuń stawkę VAT"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka %</label>
                    <input
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
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Etykieta stawki</label>
                    <input
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
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs shadow-xs transition-colors"
                  >
                    + Dodaj stawkę
                  </button>
                </form>
              </div>

              {/* Section 2: Clients list */}
              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      <span>Baza stałych Zamawiających / Inwestorów ({clients.length})</span>
                    </h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs">
                      Każdy wprowadzony w projekcie Zamawiający automatycznie dodaje się do tej listy i jest dostępny w podpowiedziach.
                    </p>
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="py-2 px-3 font-semibold">Nazwa Inwestora</th>
                        <th className="py-2 px-3 font-semibold">Osoba kontaktowa</th>
                        <th className="py-2 px-3 font-semibold">NIP</th>
                        <th className="py-2 px-3 font-semibold">Kontakt</th>
                        <th className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {clients.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-slate-400">
                            Brak stałych inwestorów w bazie. Wpisz pierwszego poniżej lub dodaj projekt z danymi Zamawiającego.
                          </td>
                        </tr>
                      ) : (
                        clients.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                              {c.name}
                              {c.address && <span className="block text-[10px] text-slate-400 font-normal">{c.address}</span>}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                              {c.contactPerson || '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                              {c.nip || '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                              {c.phone && <div>{c.phone}</div>}
                              {c.email && <div className="text-sky-600 dark:text-sky-400">{c.email}</div>}
                              {!c.phone && !c.email && '—'}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() => handleDeleteClient(c.id)}
                                className="text-slate-400 hover:text-rose-600 p-1"
                                title="Usuń inwestora z bazy"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                      placeholder="Nazwa firmy / Inwestora *"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={newClientContact}
                      onChange={(e) => setNewClientContact(e.target.value)}
                      placeholder="Osoba kontaktowa"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={newClientNip}
                      onChange={(e) => setNewClientNip(e.target.value)}
                      placeholder="NIP"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      placeholder="Telefon (+48 ...)"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                    <input
                      type="email"
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      placeholder="Adres E-mail"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-semibold text-xs transition-colors shadow-xs"
                    >
                      Zapisz Inwestora w bazie
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: UPDATE CHECKER */}
          {activeTab === 'update' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Status Wersji i Aktualizacje Oprogramowania
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    Wersja zainstalowana: <strong className="font-mono text-emerald-600 dark:text-emerald-400">{CURRENT_APP_VERSION}</strong>
                  </p>
                </div>

                <button
                  onClick={handleCheckUpdateNow}
                  disabled={isCheckingUpdate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                  <span>{isCheckingUpdate ? 'Sprawdzanie...' : 'Sprawdź aktualizacje teraz'}</span>
                </button>
              </div>

              {/* Status Banner */}
              <div className={`p-4 rounded-xl border flex items-start gap-3 ${
                hasUpdateAvailable
                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
              }`}>
                {hasUpdateAvailable ? (
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white text-sm">
                      {hasUpdateAvailable ? 'Dostępna nowa aktualizacja!' : 'System jest aktualny'}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Wydanie: {CURRENT_APP_VERSION}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {updateResult ? updateResult.message : `Wersja ${CURRENT_APP_VERSION} jest zainstalowana na Twoim serwerze.`}
                  </p>
                  {updateResult?.lastChecked && (
                    <span className="text-[10px] text-slate-400 block pt-1">
                      Ostatnie sprawdzenie: {updateResult.lastChecked}
                    </span>
                  )}
                </div>
              </div>

              {/* Recommended Terminal Update Command */}
              <div className="p-4 bg-slate-900 text-slate-100 rounded-lg space-y-2 border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-sky-400 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Zalecane polecenie aktualizacji na serwerze Linux:</span>
                  </span>
                  <button
                    onClick={() => handleCopyCode(RECOMMENDED_UPDATE_COMMAND, 'rec-update')}
                    className="flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-300 transition-colors"
                  >
                    {copiedKey === 'rec-update' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'rec-update' ? 'Skopiowano' : 'Kopiuj'}</span>
                  </button>
                </div>
                <pre className="font-mono text-xs bg-black/40 p-2.5 rounded overflow-x-auto text-emerald-300 border border-slate-800">
                  {RECOMMENDED_UPDATE_COMMAND}
                </pre>
                <p className="text-[11px] text-slate-400">
                  Polecenie pobiera najnowszy kod z GitHub i bezpiecznie kompiluje kontener Docker bez utraty bazy danych.
                </p>
              </div>

              {/* Toggle Simulation */}
              {onToggleUpdateSimulation && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Test wskaźnika aktualizacji w nagłówku
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Włącz symulację, aby zobaczyć czerwony mrugający przycisk wersji w nagłówku.
                    </span>
                  </div>
                  <button
                    onClick={() => onToggleUpdateSimulation(!hasUpdateAvailable)}
                    className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                      hasUpdateAvailable
                        ? 'bg-rose-100 text-rose-700 border-rose-300 hover:bg-rose-200'
                        : 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                    }`}
                  >
                    {hasUpdateAvailable ? 'Wyłącz symulację (Zielony: Aktualna)' : 'Włącz symulację (Czerwony: Nowa wersja)'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DOCKER DEPLOYMENT */}
          {activeTab === 'docker' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Konfiguracja Wdrożenia Docker na Serwerze
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">
                  Skrypty instalacji i pliki konfiguracyjne dla środowiska produkcyjnego Linux / Docker Compose.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-xs font-mono">
                      install.sh (Automatyczny instalator)
                    </span>
                    <button
                      onClick={() => handleCopyCode(INSTALL_SCRIPT_CONTENT, 'install.sh')}
                      className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      {copiedKey === 'install.sh' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'install.sh' ? 'Skopiowano' : 'Kopiuj treść'}</span>
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono bg-white dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 max-h-36 overflow-y-auto text-slate-700 dark:text-slate-300">
                    {INSTALL_SCRIPT_CONTENT}
                  </pre>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-xs font-mono">
                      docker-compose.yml
                    </span>
                    <button
                      onClick={() => handleCopyCode(DOCKER_COMPOSE_YML, 'docker-compose')}
                      className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      {copiedKey === 'docker-compose' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'docker-compose' ? 'Skopiowano' : 'Kopiuj'}</span>
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono bg-white dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 max-h-28 overflow-y-auto text-slate-700 dark:text-slate-300">
                    {DOCKER_COMPOSE_YML}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: USERS & DEMO DATA */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Konta Użytkowników & Dane Pokazowe
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">
                  Zarządzaj zespołem projektantów oraz usuń przykładowe dane wstawione do demonstracji.
                </p>
              </div>

              {/* Cleanup demo items card */}
              <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                  <Trash2 className="w-4 h-4" />
                  <span className="font-bold text-xs">Czyszczenie Danych Pokazowych (Wdrożenie Produkcyjne)</span>
                </div>
                <p className="text-xs text-rose-800 dark:text-rose-300">
                  Po instalacji aplikacji możesz jednym kliknięciem usunąć pokazowe tematy, zadania i konta demo, aby rozpocząć pracę na czystej bazie pracowni.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {onDeleteDemoUsers && (
                    <button
                      onClick={onDeleteDemoUsers}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                    >
                      Usuń pokazowe konta ({demoUsersCount})
                    </button>
                  )}
                  {onDeleteAllDemoData && (
                    <button
                      onClick={onDeleteAllDemoData}
                      className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                    >
                      Usuń tematy demo ({demoProjectsCount})
                    </button>
                  )}
                </div>
              </div>

              {/* User accounts list */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Konta w pracowni ({users.length})</span>
                  {onOpenUserModal && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenUserModal();
                      }}
                      className="text-xs text-sky-600 dark:text-sky-400 font-semibold hover:underline"
                    >
                      + Dodaj użytkownika
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {users.map((u) => (
                    <div key={u.id} className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center font-bold text-xs">
                          {u.initials}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 dark:text-white block">{u.name}</span>
                          <span className="text-[11px] text-slate-500">{u.email} · {u.role}</span>
                        </div>
                      </div>
                      {u.isDemo && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold">
                          Konto demonstracyjne
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BACKUP */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Kopie Zapasowe i Archiwizacja Bazy
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">
                  Automatyczne tworzenie kopii snapshot projektów, harmonogramów i komentarzy.
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block">
                      Automatyczne tworzenie kopii w tle
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Gdy włączone, system okresowo zapisuje snapshot stanu projektów w pamięci lokalnej.
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backupEnabled}
                      onChange={(e) => handleToggleBackup(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {backupEnabled && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-xs text-slate-600 dark:text-slate-400">Częstotliwość kopii:</span>
                    <select
                      value={backupInterval}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBackupInterval(val);
                        saveAutoBackupConfig({
                          enabled: true,
                          intervalMinutes: val,
                          retentionCount: 15,
                        });
                      }}
                      className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                    >
                      <option value={30}>Co 30 minut</option>
                      <option value={60}>Co 1 godzinę</option>
                      <option value={360}>Co 6 godzin</option>
                      <option value={720}>Co 12 godzin</option>
                      <option value={1440}>Raz dziennie (24h)</option>
                    </select>
                  </div>
                )}
              </div>

              {onOpenArchiveModal && (
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      onClose();
                      onOpenArchiveModal();
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white rounded text-xs font-semibold"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Otwórz pełny moduł archiwizacji (eksport/import)</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-xs"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
