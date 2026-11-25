import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import {
  X,
  Settings as SettingsIcon,
  Sun,
  RefreshCw,
  Server,
  Users,
  HardDrive,
  Sliders,
  Calendar as CalendarIcon,
  Shield,
  Mail,
  KeyRound,
  Bell,
  Building2,
  Layers,
} from 'lucide-react';
import { useFocusTrap } from '../utils/useFocusTrap';
import { ThemeMode, getThemePreference, setThemePreference } from '../utils/theme';
import { CURRENT_APP_VERSION } from '../data/dockerConfig';
import { getAutoBackupConfig, saveAutoBackupConfig } from '../utils/autoBackup';
import { User, Project, Task, Company, ProjectNumberingSettings } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { useVariables } from '../hooks/useVariables';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { DiscardChangesModal } from './DiscardChangesModal';
import { SettingsDirtyProvider, useSettingsAnyDirty } from './settings/SettingsDirtyContext';

const ThemeTab = lazy(() =>
  import('./settings/ThemeTab').then((m) => ({ default: m.ThemeTab }))
);
const VariablesTab = lazy(() =>
  import('./settings/VariablesTab').then((m) => ({ default: m.VariablesTab }))
);
const UsersTab = lazy(() =>
  import('./settings/UsersTab').then((m) => ({ default: m.UsersTab }))
);
const SecurityTab = lazy(() =>
  import('./settings/SecurityTab').then((m) => ({ default: m.SecurityTab }))
);
const CalendarTab = lazy(() =>
  import('./settings/CalendarTab').then((m) => ({ default: m.CalendarTab }))
);
const UpdateTab = lazy(() =>
  import('./settings/UpdateTab').then((m) => ({ default: m.UpdateTab }))
);
const DockerTab = lazy(() =>
  import('./settings/DockerTab').then((m) => ({ default: m.DockerTab }))
);
const BackupTab = lazy(() =>
  import('./settings/BackupTab').then((m) => ({ default: m.BackupTab }))
);
const SmtpTab = lazy(() =>
  import('./settings/SmtpTab').then((m) => ({ default: m.SmtpTab }))
);
const AccessSessionsTab = lazy(() =>
  import('./settings/AccessSessionsTab').then((m) => ({ default: m.AccessSessionsTab }))
);
const NotificationsTab = lazy(() =>
  import('./settings/NotificationsTab').then((m) => ({ default: m.NotificationsTab }))
);
const CompaniesTab = lazy(() =>
  import('./settings/CompaniesTab').then((m) => ({ default: m.CompaniesTab }))
);
const ProjectTemplatesTab = lazy(() =>
  import('./settings/ProjectTemplatesTab').then((m) => ({ default: m.ProjectTemplatesTab }))
);

export type SettingsTab =
  | 'theme'
  | 'variables'
  | 'companies'
  | 'templates'
  | 'users'
  | 'security'
  | 'smtp'
  | 'notifications'
  | 'access'
  | 'calendar'
  | 'update'
  | 'docker'
  | 'backup';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  projects: Project[];
  tasks?: Task[];
  companies?: Company[];
  projectNumbering?: ProjectNumberingSettings;
  onRefreshState?: () => Promise<void> | void;
  currentUser: User | null;
  hasUpdateAvailable?: boolean;
  onToggleUpdateSimulation?: (val: boolean) => void;
  onDeleteDemoUsers?: () => void;
  onDeleteAllDemoData?: () => void;
  onOpenUserModal?: () => void;
  onOpenArchiveModal?: () => void;
  onOpenCalendarSyncModal?: () => void;
  onApproveUser?: (userId: string) => void;
  onRejectUser?: (userId: string) => void;
  onUserUpdated?: (updated: Partial<User>) => void;
  onRefreshUsers?: () => void;
  onUpdateUserPassword?: (
    userId: string,
    newPass: string,
    currentPass?: string
  ) => Promise<import('../hooks/useFormSubmit').FormSubmitResult | boolean | void> | void;
  initialTab?: SettingsTab;
}

const SettingsTabLoader: React.FC = () => (
  <div role="status" className="flex items-center gap-2 py-8 text-slate-600 dark:text-slate-400 text-xs">
    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
    <span>Ładowanie sekcji...</span>
  </div>
);

const SettingsModalContent: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  users,
  projects,
  tasks = [],
  companies = [],
  projectNumbering = { scope: 'year' },
  onRefreshState,
  currentUser,
  hasUpdateAvailable = false,
  onToggleUpdateSimulation,
  onDeleteDemoUsers: _onDeleteDemoUsers,
  onDeleteAllDemoData: _onDeleteAllDemoData,
  onOpenUserModal,
  onOpenArchiveModal,
  onOpenCalendarSyncModal,
  onApproveUser,
  onRejectUser,
  onUserUpdated,
  onRefreshUsers,
  onUpdateUserPassword,
  initialTab = 'theme',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isAnyTabDirty = useSettingsAnyDirty();

  const {
    backdropProps,
    flashClassName,
    requestClose,
    isDiscardModalOpen,
    confirmDiscard,
    cancelDiscard,
  } = useDismissOnOutsideClick({
    isOpen,
    mode: 'conditional',
    panelRef: modalRef,
    onDismiss: onClose,
    isDirty: isAnyTabDirty,
    cancelButtonRef: closeButtonRef,
  });

  useFocusTrap({ isOpen, onClose: requestClose, containerRef: modalRef });

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('system');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState(60);
  const { deadlineWarningDays: warningDays } = useVariables();

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    setCurrentTheme(getThemePreference());
    const config = getAutoBackupConfig();
    setBackupEnabled(config.enabled);
    setBackupInterval(config.intervalMinutes || 60);
  }, [isOpen, hasUpdateAvailable]);

  if (!isOpen) return null;

  const pendingUsers = users.filter((u) => u.isApproved === false);
  const approvedUsers = users.filter((u) => u.isApproved !== false);

  const handleSelectTheme = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    setThemePreference(mode);
  };

  const handleCopyCode = async (text: string, key: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
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

  const handleChangeBackupInterval = (intervalMinutes: number) => {
    setBackupInterval(intervalMinutes);
    saveAutoBackupConfig({
      enabled: true,
      intervalMinutes,
      retentionCount: 15,
    });
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className={`bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 ${flashClassName}`}
      >
        {/* Modal Top Header */}
        <div className="px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800">
              <SettingsIcon className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="settings-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  Ustawienia Pracowni i Administracja Systemu
                </h3>
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {CURRENT_APP_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Konfiguracja motywu, zmiennych, akceptacji kont, integracji kalendarza oraz aktualizacji z GitHub
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={requestClose}
            aria-label="Zamknij ustawienia"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* 2-COLUMN SIDEBAR & CONTENT CONTAINER */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Vertical Navigation Sidebar */}
          <div className="w-64 shrink-0 bg-slate-50/70 dark:bg-slate-950/50 border-r border-slate-200 dark:border-slate-800 p-3 flex flex-col justify-between overflow-y-auto">
            <div role="tablist" aria-orientation="vertical" aria-label="Sekcje ustawień" className="space-y-1">
              <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 tracking-wider">
                Personalizacja & Parametry
              </div>

              {/* Theme Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'theme'}
                onClick={() => setActiveTab('theme')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'theme'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Sun className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Wygląd & Motyw</span>
                </div>
                <span className={`text-[10px] font-mono capitalize ${activeTab === 'theme' ? 'text-sky-100' : 'text-slate-600 dark:text-slate-400'}`}>
                  {currentTheme}
                </span>
              </button>

              {/* Variables Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'variables'}
                onClick={() => setActiveTab('variables')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'variables'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Sliders className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Zmienne & Terminy</span>
                </div>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${activeTab === 'variables' ? 'bg-sky-800 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                  {warningDays}d
                </span>
              </button>

              <div className="px-3 pt-3 py-1.5 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 tracking-wider">
                Organizacja & Zespół
              </div>

              {/* Companies Tab (Admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'companies'}
                  onClick={() => setActiveTab('companies')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    activeTab === 'companies'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Building2 className={`w-4 h-4 shrink-0 ${activeTab === 'companies' ? 'text-white' : 'text-indigo-700 dark:text-indigo-400'}`} aria-hidden="true" />
                    <span>Firmy</span>
                  </div>
                  <span className={`text-[10px] font-mono ${activeTab === 'companies' ? 'text-sky-100' : 'text-slate-600 dark:text-slate-400'}`}>
                    {companies.length}
                  </span>
                </button>
              )}

              {/* Project Templates Tab (Admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'templates'}
                  onClick={() => setActiveTab('templates')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    activeTab === 'templates'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Layers className={`w-4 h-4 shrink-0 ${activeTab === 'templates' ? 'text-white' : 'text-purple-700 dark:text-purple-400'}`} aria-hidden="true" />
                    <span>Szablony projektów</span>
                  </div>
                </button>
              )}

              {/* Users Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'users'}
                onClick={() => setActiveTab('users')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'users'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Użytkownicy & Zgody</span>
                </div>
                {pendingUsers.length > 0 ? (
                  <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-amber-700 text-white animate-pulse">
                    +{pendingUsers.length}
                  </span>
                ) : (
                  <span className={`text-[10px] ${activeTab === 'users' ? 'text-sky-100' : 'text-slate-600 dark:text-slate-400'}`}>
                    {approvedUsers.length}
                  </span>
                )}
              </button>

              {/* Security Log Tab (Admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'security'}
                  onClick={() => setActiveTab('security')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    activeTab === 'security'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Shield className={`w-4 h-4 shrink-0 ${activeTab === 'security' ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'}`} aria-hidden="true" />
                    <span>Dziennik bezpieczeństwa</span>
                  </div>
                  <span className={`text-[10px] font-mono ${activeTab === 'security' ? 'text-sky-100' : 'text-slate-600 dark:text-slate-400'}`}>JSONL</span>
                </button>
              )}

              {/* SMTP Tab (Admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'smtp'}
                  onClick={() => setActiveTab('smtp')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    activeTab === 'smtp'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Mail className={`w-4 h-4 shrink-0 ${activeTab === 'smtp' ? 'text-white' : 'text-sky-700 dark:text-sky-400'}`} aria-hidden="true" />
                    <span>Poczta (SMTP)</span>
                  </div>
                </button>
              )}

              {/* Notifications Tab (Admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'notifications'}
                  onClick={() => setActiveTab('notifications')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    activeTab === 'notifications'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Bell className={`w-4 h-4 shrink-0 ${activeTab === 'notifications' ? 'text-white' : 'text-sky-700 dark:text-sky-400'}`} aria-hidden="true" />
                    <span>Powiadomienia</span>
                  </div>
                </button>
              )}

              {/* Access & Sessions Tab (Admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'access'}
                  onClick={() => setActiveTab('access')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    activeTab === 'access'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <KeyRound className={`w-4 h-4 shrink-0 ${activeTab === 'access' ? 'text-white' : 'text-sky-700 dark:text-sky-400'}`} aria-hidden="true" />
                    <span>Dostęp i sesje</span>
                  </div>
                </button>
              )}

              {/* Google Calendar Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'calendar'}
                onClick={() => setActiveTab('calendar')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'calendar'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CalendarIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Kalendarz Google</span>
                </div>
                <span className={`text-[10px] font-mono ${activeTab === 'calendar' ? 'text-sky-100' : 'text-sky-700 dark:text-sky-400'}`}>Live</span>
              </button>

              <div className="px-3 pt-3 py-1.5 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 tracking-wider">
                Infrastruktura & DevOps
              </div>

              {/* Update Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'update'}
                onClick={() => setActiveTab('update')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'update'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Aktualizacje</span>
                </div>
                {hasUpdateAvailable ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" aria-hidden="true" />
                    <span className="sr-only">(Dostępna aktualizacja)</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="sr-only">(Aktualne)</span>
                  </>
                )}
              </button>

              {/* Docker Deployment Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'docker'}
                onClick={() => setActiveTab('docker')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'docker'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Server className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Wdrożenie Docker</span>
                </div>
              </button>

              {/* Backup Tab */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'backup'}
                onClick={() => setActiveTab('backup')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  activeTab === 'backup'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <HardDrive className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Kopie Zapasowe</span>
                </div>
                <span className={`w-2 h-2 rounded-full ${backupEnabled ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden="true" />
                <span className="sr-only">{backupEnabled ? '(Włączone)' : '(Wyłączone)'}</span>
              </button>
            </div>

            {/* Bottom info in sidebar */}
            <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-400 space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-300">Zarządzanie Projektami</div>
              <div>Środowisko: Docker (dane w pliku JSON)</div>
              <div className="font-mono text-emerald-700 dark:text-emerald-400 font-bold">{CURRENT_APP_VERSION}</div>
            </div>
          </div>

          {/* Right Main Content Panel */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6 text-xs bg-white dark:bg-slate-900">
            <Suspense fallback={<SettingsTabLoader />}>
              {activeTab === 'theme' && (
                <ThemeTab
                  currentTheme={currentTheme}
                  onSelectTheme={handleSelectTheme}
                />
              )}

              {activeTab === 'variables' && (
                <VariablesTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  projects={projects}
                />
              )}

              {activeTab === 'companies' && currentUser?.role === 'admin' && (
                <CompaniesTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  companies={companies}
                  projects={projects}
                  projectNumbering={projectNumbering}
                  onRefreshState={onRefreshState}
                />
              )}

              {activeTab === 'templates' && currentUser?.role === 'admin' && (
                <ProjectTemplatesTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  projects={projects}
                  tasks={tasks}
                  onRefreshState={onRefreshState}
                />
              )}

              {activeTab === 'users' && (
                <UsersTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  pendingUsers={pendingUsers}
                  approvedUsers={approvedUsers}
                  onClose={onClose}
                  onOpenUserModal={onOpenUserModal}
                  onApproveUser={onApproveUser}
                  onRejectUser={onRejectUser}
                  onUserUpdated={onUserUpdated}
                  onRefreshUsers={onRefreshUsers}
                  onUpdateUserPassword={onUpdateUserPassword}
                />
              )}

              {activeTab === 'security' && currentUser?.role === 'admin' && (
                <SecurityTab
                  isOpen={isOpen}
                  users={users}
                  currentUser={currentUser}
                />
              )}

              {activeTab === 'smtp' && currentUser?.role === 'admin' && (
                <SmtpTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                />
              )}

              {activeTab === 'notifications' && currentUser?.role === 'admin' && (
                <NotificationsTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  onOpenSmtpTab={() => setActiveTab('smtp')}
                />
              )}

              {activeTab === 'access' && currentUser?.role === 'admin' && (
                <AccessSessionsTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  onRefreshState={onRefreshState}
                />
              )}

              {activeTab === 'calendar' && (
                <CalendarTab
                  isOpen={isOpen}
                  currentUser={currentUser}
                  copiedKey={copiedKey}
                  onCopyCode={handleCopyCode}
                  onClose={onClose}
                  onOpenCalendarSyncModal={onOpenCalendarSyncModal}
                />
              )}

              {activeTab === 'update' && (
                <UpdateTab
                  isOpen={isOpen}
                  hasUpdateAvailable={hasUpdateAvailable}
                  onToggleUpdateSimulation={onToggleUpdateSimulation}
                  copiedKey={copiedKey}
                  onCopyCode={handleCopyCode}
                />
              )}

              {activeTab === 'docker' && (
                <DockerTab
                  copiedKey={copiedKey}
                  onCopyCode={handleCopyCode}
                />
              )}

              {activeTab === 'backup' && (
                <BackupTab
                  backupEnabled={backupEnabled}
                  backupInterval={backupInterval}
                  onToggleBackup={handleToggleBackup}
                  onChangeBackupInterval={handleChangeBackupInterval}
                  onClose={onClose}
                  onOpenArchiveModal={onOpenArchiveModal}
                />
              )}
            </Suspense>
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-end shrink-0">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-800 text-white rounded text-xs font-semibold shadow-xs"
          >
            Zamknij
          </button>
        </div>
      </div>
      <DiscardChangesModal
        isOpen={isDiscardModalOpen}
        onCancel={cancelDiscard}
        onConfirm={confirmDiscard}
      />
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = (props) => (
  <SettingsDirtyProvider>
    <SettingsModalContent {...props} />
  </SettingsDirtyProvider>
);
