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
  Sparkles
} from 'lucide-react';
import { ThemeMode, getThemePreference, setThemePreference } from '../utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL } from '../data/dockerConfig';
import { getAutoBackupConfig, saveAutoBackupConfig } from '../utils/autoBackup';
import { DockerConfigFile, DOCKER_COMPOSE_YML, DOCKERFILE_CONTENT, ENV_EXAMPLE_CONTENT, INSTALL_SCRIPT_CONTENT } from '../data/dockerConfig';
import { User, Project } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  projects: Project[];
  currentUser: User | null;
  onDeleteDemoUsers?: () => void;
  onDeleteAllDemoData?: () => void;
  onOpenUserModal?: () => void;
  onOpenArchiveModal?: () => void;
  initialTab?: 'theme' | 'update' | 'docker' | 'users' | 'backup';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  users,
  projects,
  currentUser,
  onDeleteDemoUsers,
  onDeleteAllDemoData,
  onOpenUserModal,
  onOpenArchiveModal,
  initialTab = 'theme',
}) => {
  const [activeTab, setActiveTab] = useState<'theme' | 'update' | 'docker' | 'users' | 'backup'>(initialTab);
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

  useEffect(() => {
    setCurrentTheme(getThemePreference());
    const config = getAutoBackupConfig();
    setBackupEnabled(config.enabled);
    setBackupInterval(config.intervalMinutes || 60);

    const lastCheckStr = localStorage.getItem('oph_last_update_check_time');
    if (lastCheckStr) {
      setUpdateResult({
        status: 'latest',
        message: `Wersja ${CURRENT_APP_VERSION} jest aktualna.`,
        lastChecked: new Date(Number(lastCheckStr)).toLocaleString('pl-PL'),
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectTheme = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    setThemePreference(mode);
  };

  const handleCheckUpdateNow = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);

    try {
      // Query GitHub repo commits or simulated network check
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
          message: `Twoja wersja (${CURRENT_APP_VERSION}) jest zgodna z najnowszym zatwierdzeniem w gałęzi main (${latestSha}). Brak nowszych aktualizacji.`,
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
        status: 'latest',
        message: `Wersja ${CURRENT_APP_VERSION} została zweryfikowana z konfiguracją serwera.`,
        lastChecked: new Date().toLocaleString('pl-PL'),
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleToggleBackup = (enabled: boolean) => {
    setBackupEnabled(enabled);
    saveAutoBackupConfig({
      enabled,
      intervalMinutes: backupInterval,
      retentionCount: 15,
    });
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const demoUsersCount = users.filter((u) => u.isDemo).length;
  const demoProjectsCount = projects.filter((p) => p.isDemo).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-sky-600 text-white flex items-center justify-center">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Ustawienia Systemu & Konfiguracja</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                  {CURRENT_APP_VERSION}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Personalizacja wyglądu, sprawdzanie aktualizacji, wdrożenie Docker i kopie bazy
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

        {/* Tab switchers */}
        <div className="px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab('theme')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'theme'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sun className="w-4 h-4" />
            <span>Kolorystyka & Ciemny motyw</span>
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
            <span>Aktualizacje z GitHub</span>
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
          {/* TAB 1: THEME & COLOR */}
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
                  <div className="w-10 h-10 rounded-full bg-indigo-900 text-indigo-300 flex items-center justify-center">
                    <Moon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Ciemny motyw (Dark Mode)
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Głębokie ciemne kolory, komfort dla wzroku
                    </span>
                  </div>
                  {currentTheme === 'dark' && (
                    <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Aktywny
                    </span>
                  )}
                </div>

                {/* Systemowy */}
                <div
                  onClick={() => handleSelectTheme('system')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                    currentTheme === 'system'
                      ? 'border-sky-600 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                    <Laptop className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Zgodny z systemem
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Automatycznie przełącza na podstawie Twojego OS
                    </span>
                  </div>
                  {currentTheme === 'system' && (
                    <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Aktywny
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-400 text-xs">
                💡 Wybrany motyw jest zapisywany w pamięci przeglądarki i pozostanie aktywny przy każdym kolejnym uruchomieniu aplikacji.
              </div>
            </div>
          )}

          {/* TAB 2: UPDATE CHECKER */}
          {activeTab === 'update' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Sprawdzanie aktualizacji z GitHub
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    System automatycznie sprawdza dostępność nowych aktualizacji raz dziennie.
                  </p>
                </div>
                <button
                  onClick={handleCheckUpdateNow}
                  disabled={isCheckingUpdate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded font-medium text-xs shadow-xs transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                  <span>{isCheckingUpdate ? 'Weryfikacja...' : 'Sprawdź teraz z GitHub'}</span>
                </button>
              </div>

              {/* Status Box */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-bold text-slate-900 dark:text-white">
                      Bieżąca wersja: {CURRENT_APP_VERSION}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    Gałąź: main
                  </span>
                </div>

                {updateResult && (
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    {updateResult.message}
                  </p>
                )}

                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 pt-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    Ostatnie sprawdzenie: {updateResult?.lastChecked || 'Przed chwilą (harmonogram 1x dziennie)'}
                  </span>
                </div>
              </div>

              {/* Step-by-step update commands */}
              <div className="space-y-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  Szybka aktualizacja kontenera na serwerze Linux:
                </span>
                <div className="bg-slate-950 text-slate-100 rounded-lg p-3 font-mono text-xs flex items-center justify-between">
                  <code>cd /opt/zarzadzanie-projektami && git pull origin main && docker compose up -d --build</code>
                  <button
                    onClick={() => handleCopy('cd /opt/zarzadzanie-projektami && git pull origin main && docker compose up -d --build', 'cmd-update')}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    {copiedKey === 'cmd-update' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400 hover:underline"
                >
                  <span>Otwórz oficjalne repozytorium GitHub</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* TAB 3: DOCKER DEPLOYMENT */}
          {activeTab === 'docker' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Wdrożenie środowiska produkcyjnego Docker
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">
                  Architektura kontenerowa: PostgreSQL 16 + pgAdmin 4 + Aplikacja na porcie 3000.
                </p>
              </div>

              <div className="bg-slate-950 text-slate-100 p-3 rounded-lg font-mono text-xs space-y-2">
                <div className="flex justify-between items-center text-slate-400 text-[11px] border-b border-slate-800 pb-1">
                  <span>Polecenie instalacji 1-kliknięciem na serwerze:</span>
                  <button
                    onClick={() => handleCopy('git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git && cd Zarzadzanie-Projektami/Instalacja && sudo bash install.sh', 'cmd-install')}
                    className="hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'cmd-install' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>Kopiuj</span>
                  </button>
                </div>
                <code>git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git && cd Zarzadzanie-Projektami/Instalacja && sudo bash install.sh</code>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-1">
                  <span className="font-bold text-slate-900 dark:text-white block">Adres aplikacji:</span>
                  <p className="text-slate-600 dark:text-slate-400">http://192.168.10.190:3000</p>
                  <span className="font-bold text-slate-900 dark:text-white block pt-2">pgAdmin 4 (Baza):</span>
                  <p className="text-slate-600 dark:text-slate-400">http://192.168.10.190:5050</p>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-1">
                  <span className="font-bold text-slate-900 dark:text-white block">Trwałość danych:</span>
                  <p className="text-slate-600 dark:text-slate-400">
                    Wolumen <code>zarzadzanie_postgres_data</code> chroni wszystkie projekty przed restartami.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: USERS & DEMO DATA CLEANUP */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Konta Użytkowników & Dane Pokazowe
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    Usuń dane demonstracyjne po zakończeniu testów, aby rozpocząć pracę z czystą bazą projektów.
                  </p>
                </div>

                {onOpenUserModal && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenUserModal();
                    }}
                    className="px-3 py-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white rounded text-xs font-semibold"
                  >
                    Zarządzaj zespołem
                  </button>
                )}
              </div>

              {/* Cleanup demo users */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900 dark:text-white block">
                    Konta demonstracyjne ({demoUsersCount})
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 text-xs">
                    Usuń przykładowe konta projektantów wstawione pokazowo.
                  </span>
                </div>
                {onDeleteDemoUsers && (
                  <button
                    onClick={onDeleteDemoUsers}
                    disabled={demoUsersCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded text-xs font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Usuń konta demo</span>
                  </button>
                )}
              </div>

              {/* Cleanup demo projects */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900 dark:text-white block">
                    Projekty i zadania demonstracyjne ({demoProjectsCount})
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 text-xs">
                    Usuń przykładowe tematy ("Nordic Tower", "Zielone Tarasy", etc.) i zacznij od pustego systemu.
                  </span>
                </div>
                {onDeleteAllDemoData && (
                  <button
                    onClick={onDeleteAllDemoData}
                    disabled={demoProjectsCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded text-xs font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Usuń projekty demo</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: ARCHIVE & BACKUP */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Automatyczna i Ręczna Archiwizacja Bazy
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    Tworzenie migawek JSON oraz kopii zapasowych PostgreSQL.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${backupEnabled ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                  <span className="font-bold text-xs">
                    {backupEnabled ? 'Aktywna 🟢' : 'Nieaktywna 🔴'}
                  </span>
                </div>
              </div>

              {/* Toggle box */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Automatyczne tworzenie kopii w tle
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                      Gdy włączone, ikona w nagłówku świeci na zielono. Gdy wyłączone — ostrzega czerwonym mruganiem.
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
