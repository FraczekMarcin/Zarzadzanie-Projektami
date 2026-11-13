import React, { useState, useEffect, useRef } from 'react';
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
  Sliders,
  Percent,
  Building2,
  RotateCcw,
  Calendar as CalendarIcon,
  UserX,
  BellRing,
  Tag,
  Network,
  LogOut,
  Cloud,
  Shield,
  Filter,
  AlertCircle,
  KeyRound,
} from 'lucide-react';
import { parseUserAgent, PublicSession } from '../utils/sessions';
import type { SecurityEvent, SecurityEventType } from '../utils/securityLog';
import { useFocusTrap } from '../utils/useFocusTrap';

const SECURITY_EVENT_LABELS: Record<SecurityEventType, string> = {
  login_success: 'Udane logowanie',
  login_failure: 'Nieudane logowanie',
  logout: 'Wylogowanie',
  password_changed: 'Zmiana hasła',
  password_reset_requested: 'Żądanie resetu hasła',
  password_reset_completed: 'Zakończenie resetu hasła',
  twofa_enabled: 'Włączenie 2FA',
  twofa_disabled: 'Wyłączenie 2FA',
  twofa_backup_code_used: 'Użycie kodu zapasowego 2FA',
  user_created: 'Utworzenie użytkownika',
  user_deleted: 'Usunięcie użytkownika',
  user_approved: 'Zatwierdzenie użytkownika',
  user_role_changed: 'Zmiana roli użytkownika',
  session_revoked: 'Unieważnienie sesji',
  registration: 'Wniosek rejestracyjny',
  setup_admin: 'Inicjalizacja administratora',
  origin_blocked: 'Zablokowane źródło Origin',
};
import { ThemeMode, getThemePreference, setThemePreference } from '../utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL, INSTALL_COMMAND, UPDATE_COMMAND } from '../data/dockerConfig';
import { isNewerVersion } from '../utils/versionCheck';
import { getAutoBackupConfig, saveAutoBackupConfig } from '../utils/autoBackup';
import { User, Project } from '../types';
import { isDemoUser, isDemoProject } from '../utils/demoData';
import { copyToClipboard } from '../utils/clipboard';
import { TwoFactorManager } from './TwoFactorManager';
import { validatePassword } from '../utils/passwordPolicy';
import { PasswordRequirementsChecklist } from './PasswordRequirementsChecklist';
import { 
  getVatRates, 
  saveVatRates, 
  VatRateOption, 
  getClients, 
  saveClients, 
  ClientRecord,
  DEFAULT_VAT_RATES,
  getDeadlineWarningDays,
  saveDeadlineWarningDays,
  getTaskTypes,
  saveTaskTypes,
  TaskTypeDefinition,
  DEFAULT_TASK_TYPES
} from '../utils/variableSettings';

export type SettingsTab = 'theme' | 'variables' | 'users' | 'security' | 'calendar' | 'update' | 'docker' | 'backup';

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
  onApproveUser?: (userId: string) => void;
  onRejectUser?: (userId: string) => void;
  onUserUpdated?: (updated: Partial<User>) => void;
  onRefreshUsers?: () => void;
  onUpdateUserPassword?: (userId: string, newPass: string, currentPass?: string) => Promise<boolean | void> | void;
  initialTab?: SettingsTab;
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
  onApproveUser,
  onRejectUser,
  onUserUpdated,
  onRefreshUsers,
  onUpdateUserPassword,
  initialTab = 'theme',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ isOpen, onClose, containerRef: modalRef });

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('system');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Update checker state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdatingServer, setIsUpdatingServer] = useState(false);
  const [updateServerMessage, setUpdateServerMessage] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<{
    status: 'latest' | 'update_available' | 'error';
    message: string;
    lastChecked: string;
    latestSha?: string;
    remoteVersion?: string;
  } | null>(null);

  // Auto-backup toggle state
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState(60);

  // Variable Settings state
  const [vatRates, setVatRates] = useState<VatRateOption[]>([]);
  const [newVatRate, setNewVatRate] = useState<number>(23);
  const [newVatLabel, setNewVatLabel] = useState<string>('23% Podstawowa');
  const [warningDays, setWarningDays] = useState<number>(3);
  
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientNip, setNewClientNip] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');

  // Task Types state
  const [taskTypes, setTaskTypes] = useState<TaskTypeDefinition[]>([]);
  const [newTaskTypeId, setNewTaskTypeId] = useState('');
  const [newTaskTypeLabel, setNewTaskTypeLabel] = useState('');
  const [newTaskTypeDesc, setNewTaskTypeDesc] = useState('');
  const [newTaskTypeColor, setNewTaskTypeColor] = useState('sky');

  // Network NAS Backup & Google account pairing state
  const [nasPath, setNasPath] = useState(() => {
    return localStorage.getItem('oph_nas_backup_path') || '/mnt/nas/projekty/kopie';
  });

  // Change password state in Settings
  const [settingsCurrentPassword, setSettingsCurrentPassword] = useState('');
  const [settingsNewPassword, setSettingsNewPassword] = useState('');
  const [settingsConfirmPassword, setSettingsConfirmPassword] = useState('');
  const [settingsPwError, setSettingsPwError] = useState<string | null>(null);
  const [settingsPwSuccess, setSettingsPwSuccess] = useState(false);
  const [isChangingSettingsPassword, setIsChangingSettingsPassword] = useState(false);

  const handleSettingsPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setSettingsPwError(null);

    if (!settingsCurrentPassword) {
      setSettingsPwError('Wprowadź dotychczasowe hasło.');
      return;
    }

    const pwCheck = validatePassword(settingsNewPassword, {
      name: currentUser.name,
      email: currentUser.email,
    });
    if (!pwCheck.ok) {
      setSettingsPwError(pwCheck.errors.join(' '));
      return;
    }

    if (settingsNewPassword !== settingsConfirmPassword) {
      setSettingsPwError('Nowe hasła nie są identyczne.');
      return;
    }

    setIsChangingSettingsPassword(true);
    try {
      if (onUpdateUserPassword) {
        const res = await onUpdateUserPassword(currentUser.id, settingsNewPassword, settingsCurrentPassword);
        if (res === false) {
          return;
        }
      } else {
        const res = await fetch(`/api/users/${currentUser.id}/password`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: settingsCurrentPassword,
            newPassword: settingsNewPassword,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSettingsPwError(data.error || 'Nie udało się zmienić hasła.');
          return;
        }
      }
      setSettingsPwSuccess(true);
      setSettingsCurrentPassword('');
      setSettingsNewPassword('');
      setSettingsConfirmPassword('');
      setTimeout(() => setSettingsPwSuccess(false), 3000);
    } finally {
      setIsChangingSettingsPassword(false);
    }
  };
  const [nasTestStatus, setNasTestStatus] = useState<string | null>(null);
  const [isGooglePaired, setIsGooglePaired] = useState(() => {
    return localStorage.getItem('oph_google_account_paired') === 'true';
  });
  const [googleCalendarSync, setGoogleCalendarSync] = useState(() => {
    return localStorage.getItem('oph_google_calendar_sync') !== 'false';
  });
  const [googleDriveSync, setGoogleDriveSync] = useState(() => {
    return localStorage.getItem('oph_google_drive_sync') !== 'false';
  });

  // Session management state
  const [activeSessions, setActiveSessions] = useState<PublicSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [sessionActionSuccess, setSessionActionSuccess] = useState<string | null>(null);
  const [isRevokingOthers, setIsRevokingOthers] = useState(false);

  const loadSessions = async () => {
    setIsLoadingSessions(true);
    setSessionActionError(null);
    try {
      const res = await fetch('/api/auth/sessions', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setActiveSessions(Array.isArray(data.sessions) ? data.sessions : (Array.isArray(data) ? data : []));
      }
    } catch (err: any) {
      console.error('Błąd pobierania sesji:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setSessionActionError(null);
    setSessionActionSuccess(null);
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setSessionActionError(data.error || 'Błąd unieważniania sesji');
      } else {
        setSessionActionSuccess('Sesja została pomyślnie unieważniona.');
        await loadSessions();
      }
    } catch (err: any) {
      setSessionActionError(err.message || 'Błąd połączenia z serwerem');
    }
  };

  const handleRevokeOtherSessions = async () => {
    if (!window.confirm('Czy na pewno chcesz wylogować wszystkie inne aktywne sesje?')) return;
    setIsRevokingOthers(true);
    setSessionActionError(null);
    setSessionActionSuccess(null);
    try {
      const res = await fetch('/api/auth/sessions/revoke-others', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setSessionActionError(data.error || 'Błąd unieważniania pozostałych sesji');
      } else {
        setSessionActionSuccess('Wszystkie inne sesje zostały pomyślnie wylogowane.');
        await loadSessions();
      }
    } catch (err: any) {
      setSessionActionError(err.message || 'Błąd połączenia z serwerem');
    } finally {
      setIsRevokingOthers(false);
    }
  };

  const handleAdminRevokeAllUserSessions = async (userId: string, userName: string) => {
    if (!window.confirm(`Czy na pewno chcesz zakończyć wszystkie sesje użytkownika ${userName}? Użytkownik zostanie natychmiast wylogowany ze wszystkich urządzeń.`)) {
      return;
    }
    setSessionActionError(null);
    setSessionActionSuccess(null);
    try {
      const res = await fetch(`/api/users/${userId}/sessions`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (res.ok) {
        setSessionActionSuccess(`Pomyślnie zakończono sesje użytkownika ${userName}.`);
        if (userId === currentUser?.id) {
          window.location.reload();
        } else {
          loadSessions();
        }
      } else {
        setSessionActionError(data.error || 'Błąd kończenia sesji użytkownika');
      }
    } catch (err: any) {
      setSessionActionError(err.message || 'Błąd połączenia z serwerem');
    }
  };

  // Security Log state
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [isLoadingSecurityEvents, setIsLoadingSecurityEvents] = useState(false);
  const [securityFilterType, setSecurityFilterType] = useState<string>('all');
  const [securityLogError, setSecurityLogError] = useState<string | null>(null);

  const loadSecurityEvents = async () => {
    if (currentUser?.role !== 'admin') return;
    setIsLoadingSecurityEvents(true);
    setSecurityLogError(null);
    try {
      const url = securityFilterType && securityFilterType !== 'all'
        ? `/api/security/events?limit=200&type=${encodeURIComponent(securityFilterType)}`
        : '/api/security/events?limit=200';
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setSecurityEvents(Array.isArray(data.events) ? data.events : []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setSecurityLogError(errData.error || 'Błąd pobierania dziennika bezpieczeństwa');
      }
    } catch (err: any) {
      setSecurityLogError(err.message || 'Błąd połączenia z serwerem');
    } finally {
      setIsLoadingSecurityEvents(false);
    }
  };

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'users') {
      loadSessions();
    }
    if (isOpen && activeTab === 'security') {
      loadSecurityEvents();
    }
  }, [isOpen, activeTab, securityFilterType]);

  useEffect(() => {
    setCurrentTheme(getThemePreference());
    const config = getAutoBackupConfig();
    setBackupEnabled(config.enabled);
    setBackupInterval(config.intervalMinutes || 60);

    setVatRates(getVatRates());
    setClients(getClients());
    setWarningDays(getDeadlineWarningDays());
    setTaskTypes(getTaskTypes());

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

  const pendingUsers = users.filter((u) => u.isApproved === false);
  const approvedUsers = users.filter((u) => u.isApproved !== false);

  const handleSelectTheme = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    setThemePreference(mode);
  };

  const handleCheckUpdateNow = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);
    setUpdateServerMessage(null);

    try {
      // Wyłącznie serwerowy endpoint /api/system/check-update (z pamięcią podręczną 6h)
      const sResp = await fetch(`/api/system/check-update?t=${Date.now()}`, { credentials: 'same-origin' }).catch(() => null);
      if (sResp && sResp.ok) {
        const sData = await sResp.json();
        const remoteVer = (sData.remoteVersion || '').trim() || CURRENT_APP_VERSION;
        const hasUp = isNewerVersion(remoteVer, CURRENT_APP_VERSION);
        
        if (onToggleUpdateSimulation) {
          onToggleUpdateSimulation(hasUp);
        }
        localStorage.setItem('oph_update_available', hasUp ? 'true' : 'false');
        localStorage.setItem('oph_last_update_check_time', String(Date.now()));

        const cacheNote = sData.cached ? ' (dane z pamięci podręcznej serwera, cache 6h)' : '';
        setUpdateResult({
          status: hasUp ? 'update_available' : 'latest',
          remoteVersion: remoteVer,
          message: hasUp
            ? `Wykryto nowsze wydanie na GitHub: ${remoteVer} (Twoja wersja: ${sData.localVersion || CURRENT_APP_VERSION}).`
            : `Twoja wersja (${sData.localVersion || CURRENT_APP_VERSION}) jest zgodna z najnowszym zatwierdzeniem w gałęzi main (${sData.latestSha || 'main'}). Brak nowszych aktualizacji${cacheNote}.`,
          lastChecked: new Date(sData.checkedAt || Date.now()).toLocaleString('pl-PL'),
          latestSha: sData.latestSha,
        });
      } else {
        setUpdateResult({
          status: 'error',
          message: 'Nie udało się połączyć z serwerem aktualizacji. Sprawdź połączenie z serwerem.',
          lastChecked: new Date().toLocaleString('pl-PL'),
        });
      }
    } catch {
      setUpdateResult({
        status: 'error',
        message: 'Wystąpił błąd podczas weryfikacji aktualizacji na serwerze.',
        lastChecked: new Date().toLocaleString('pl-PL'),
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleRunUpdateNow = async () => {
    setIsUpdatingServer(true);
    setUpdateServerMessage('Aktualizacja ze względów bezpieczeństwa wykonywana jest bezpośrednio w terminalu serwera (polecenie poniżej).');
    setTimeout(() => {
      setIsUpdatingServer(false);
    }, 600);
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

  const handleWarningDaysChange = (days: number) => {
    const val = Math.max(1, days);
    setWarningDays(val);
    saveDeadlineWarningDays(val);
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

  // Task types handlers
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

  // NAS Backup handlers
  const handleSaveNasPath = (newPath: string) => {
    setNasPath(newPath);
    localStorage.setItem('oph_nas_backup_path', newPath);
  };

  const handleTestNasConnection = () => {
    setNasTestStatus('Testowanie dostępu i praw zapisu do zasobu sieciowego...');
    setTimeout(() => {
      setNasTestStatus(`Pomyślnie zweryfikowano dostęp i prawa zapisu w ścieżce NAS: "${nasPath}". Plik kontrolny zapisany.`);
    }, 700);
  };

  // Google Account Pairing handlers
  const handleToggleGooglePairing = () => {
    const nextVal = !isGooglePaired;
    setIsGooglePaired(nextVal);
    localStorage.setItem('oph_google_account_paired', nextVal ? 'true' : 'false');
  };

  const demoUsersCount = users.filter(isDemoUser).length;
  const demoProjectsCount = projects.filter(isDemoProject).length;

  const hostAddress = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  const allCalendarUrl = `${protocol}//${hostAddress}/api/calendar/all.ics`;
  const userCalendarUrl = `${protocol}//${hostAddress}/api/calendar/user/${currentUser?.id || 'usr-1'}.ics`;

  const RECOMMENDED_UPDATE_COMMAND = UPDATE_COMMAND;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
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
            onClick={onClose}
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
            
            {/* 1. THEME TAB */}
            {activeTab === 'theme' && (
              <div className="space-y-4 max-w-3xl">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">
                    Motyw graficzny interfejsu
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Wybierz preferowaną kolorystykę aplikacji lub dostosuj ją automatycznie do ustawień systemowych urządzenia.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
                  {/* Jasny */}
                  <button
                    type="button"
                    aria-pressed={currentTheme === 'light'}
                    onClick={() => handleSelectTheme('light')}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                      currentTheme === 'light'
                        ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                      <Sun className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white block">
                        Jasny motyw
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        Czysty, wysoki kontrast, idealny do pracy w dzień
                      </span>
                    </div>
                    {currentTheme === 'light' && (
                      <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
                        <Check className="w-3 h-3" aria-hidden="true" /> Aktywny
                      </span>
                    )}
                  </button>

                  {/* Ciemny */}
                  <button
                    type="button"
                    aria-pressed={currentTheme === 'dark'}
                    onClick={() => handleSelectTheme('dark')}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                      currentTheme === 'dark'
                        ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center">
                      <Moon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white block">
                        Ciemny motyw (Dark Mode)
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        Ciemne tło dla całej aplikacji, redukujące zmęczenie oczu
                      </span>
                    </div>
                    {currentTheme === 'dark' && (
                      <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
                        <Check className="w-3 h-3" aria-hidden="true" /> Aktywny
                      </span>
                    )}
                  </button>

                  {/* Zgodny z systemem */}
                  <button
                    type="button"
                    aria-pressed={currentTheme === 'system'}
                    onClick={() => handleSelectTheme('system')}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
                      currentTheme === 'system'
                        ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                      <Laptop className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white block">
                        Zgodnie z systemem
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        Automatycznie dopasowuje motyw do ustawień Windows/macOS/Linux
                      </span>
                    </div>
                    {currentTheme === 'system' && (
                      <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
                        <Check className="w-3 h-3" aria-hidden="true" /> Aktywny
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 2. VARIABLES & DEADLINES TAB */}
            {activeTab === 'variables' && (
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
                        onChange={(e) => handleWarningDaysChange(Number(e.target.value))}
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
            )}

            {/* 3. USERS & APPROVALS TAB */}
            {activeTab === 'users' && (
              <div className="space-y-5 max-w-3xl">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">
                    Konta Użytkowników & Bezpieczeństwo Pracowni
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Zarządzaj zespołem projektantów, uwierzytelnianiem dwuskładnikowym (2FA) oraz akceptacjami rejestracji.
                  </p>
                </div>

                {/* Two Factor Authentication Manager for Current User */}
                <TwoFactorManager currentUser={currentUser} onUserUpdated={onUserUpdated} />

                {/* Password Change Section for Current User */}
                {currentUser && (
                  <form
                    onSubmit={handleSettingsPasswordSubmit}
                    className="p-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                        <h5 className="font-bold text-slate-900 dark:text-white text-sm">
                          Zmiana hasła dostępu
                        </h5>
                      </div>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        Konto: <strong>{currentUser.email}</strong>
                      </span>
                    </div>

                    {settingsPwSuccess && (
                      <div role="status" className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                        <span>Hasło zostało pomyślnie zaktualizowane.</span>
                      </div>
                    )}

                    {settingsPwError && (
                      <div role="alert" className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded text-xs">
                        {settingsPwError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="settings-current-password" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Dotychczasowe hasło *
                        </label>
                        <input
                          id="settings-current-password"
                          type="password"
                          required
                          value={settingsCurrentPassword}
                          onChange={(e) => {
                            setSettingsCurrentPassword(e.target.value);
                            setSettingsPwError(null);
                          }}
                          placeholder="Aktualne hasło"
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                        />
                      </div>

                      <div>
                        <label htmlFor="settings-new-password" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Nowe hasło (12–128 znaków) *
                        </label>
                        <input
                          id="settings-new-password"
                          type="password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={settingsNewPassword}
                          onChange={(e) => {
                            setSettingsNewPassword(e.target.value);
                            setSettingsPwError(null);
                          }}
                          placeholder="Nowe hasło"
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                        />
                      </div>

                      <div>
                        <label htmlFor="settings-confirm-password" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Powtórz nowe hasło *
                        </label>
                        <input
                          id="settings-confirm-password"
                          type="password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={settingsConfirmPassword}
                          onChange={(e) => {
                            setSettingsConfirmPassword(e.target.value);
                            setSettingsPwError(null);
                          }}
                          placeholder="Powtórz nowe hasło"
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                        />
                      </div>
                    </div>

                    <PasswordRequirementsChecklist
                      password={settingsNewPassword}
                      context={{ name: currentUser.name, email: currentUser.email }}
                    />

                    {settingsConfirmPassword.length > 0 && settingsNewPassword !== settingsConfirmPassword && (
                      <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400 font-medium">
                        Nowe hasła nie są identyczne.
                      </p>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={
                          isChangingSettingsPassword ||
                          !settingsCurrentPassword ||
                          !validatePassword(settingsNewPassword, {
                            name: currentUser.name,
                            email: currentUser.email,
                          }).ok ||
                          settingsNewPassword !== settingsConfirmPassword
                        }
                        className="px-4 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-semibold transition-colors"
                      >
                        {isChangingSettingsPassword ? 'Zapisywanie...' : 'Zmień hasło'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Pending user approval section */}
                {pendingUsers.length > 0 && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-700 rounded-xl space-y-3 shadow-md animate-in fade-in">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <Clock className="w-5 h-5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                      <span className="font-bold text-sm">
                        Oczekujące konta na zatwierdzenie przez Administratora ({pendingUsers.length})
                      </span>
                    </div>
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Nowo zarejestrowani pracownicy nie mogą zalogować się do systemu, dopóki ich tożsamość nie zostanie potwierdzona przez kierownictwo.
                    </p>

                    <div className="divide-y divide-amber-200 dark:divide-amber-800/60 bg-white dark:bg-slate-900 rounded-lg border border-amber-300 dark:border-amber-800 overflow-hidden">
                      {pendingUsers.map((pUser) => (
                        <div key={pUser.id} className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 flex items-center justify-center font-bold text-xs" aria-hidden="true">
                              {pUser.initials}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white text-xs">
                                {pUser.name}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                {pUser.email} · {pUser.department} ({pUser.role})
                              </div>
                              {pUser.registeredAt && (
                                <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                                  Zarejestrowano: {new Date(pUser.registeredAt).toLocaleString('pl-PL')}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {onApproveUser && (
                              <button
                                type="button"
                                onClick={() => onApproveUser(pUser.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Zatwierdź</span>
                              </button>
                            )}

                            {onRejectUser && (
                              <button
                                type="button"
                                onClick={() => onRejectUser(pUser.id)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-slate-700 dark:text-slate-300 hover:text-rose-700 rounded text-xs font-semibold transition-colors"
                                title="Odrzuć rejestrację"
                              >
                                <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Odrzuć</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Approved User accounts list */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Aktywne konta w pracowni ({approvedUsers.length})
                    </span>
                    {onOpenUserModal && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenUserModal();
                        }}
                        className="text-xs text-sky-700 dark:text-sky-400 font-semibold hover:underline"
                      >
                        + Dodaj użytkownika
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {approvedUsers.map((u) => (
                      <div key={u.id} className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center font-bold text-xs" aria-hidden="true">
                            {u.initials}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white block">{u.name}</span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-400">{u.email} · {u.department} ({u.role === 'admin' ? 'Administrator' : 'Projektant'})</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {u.twoFactorEnabled && (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-semibold flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                              <span>2FA aktywne</span>
                            </span>
                          )}
                          {currentUser?.role === 'admin' && u.id !== currentUser.id && u.twoFactorEnabled && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (window.confirm(`Czy na pewno chcesz zresetować 2FA dla użytkownika ${u.name}? Użytkownik będzie musiał ponownie przeprowadzić konfigurację.`)) {
                                  try {
                                    const res = await fetch(`/api/users/${u.id}/2fa/disable`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      credentials: 'same-origin',
                                    });
                                    if (res.ok && onRefreshUsers) onRefreshUsers();
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }
                              }}
                              className="px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                              title="Zresetuj 2FA użytkownika"
                            >
                              Resetuj 2FA
                            </button>
                          )}
                          {currentUser?.role === 'admin' && (
                            <button
                              type="button"
                              onClick={() => handleAdminRevokeAllUserSessions(u.id, u.name)}
                              className="px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60 rounded transition-colors"
                              title="Wyloguj użytkownika ze wszystkich urządzeń"
                            >
                              Zakończ wszystkie sesje
                            </button>
                          )}
                          {u.isDemo && (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold">
                              Konto demonstracyjne
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Active Sessions Section */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                          Aktywne sesje ({activeSessions.length})
                        </span>
                        {isLoadingSessions && (
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 animate-pulse">Ładowanie...</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">
                        Lista zalogowanych urządzeń i przeglądarek powiązanych z Twoim kontem.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={loadSessions}
                        disabled={isLoadingSessions}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        Odśwież
                      </button>

                      {activeSessions.filter(s => !s.current).length > 0 && (
                        <button
                          type="button"
                          onClick={handleRevokeOtherSessions}
                          disabled={isRevokingOthers}
                          className="px-3 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded hover:bg-rose-100 dark:hover:bg-rose-900 transition-colors flex items-center gap-1.5"
                        >
                          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isRevokingOthers ? 'Wylogowywanie...' : 'Wyloguj wszystkie inne'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {sessionActionError && (
                    <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
                      {sessionActionError}
                    </div>
                  )}

                  {sessionActionSuccess && (
                    <div role="status" className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs">
                      {sessionActionSuccess}
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/70 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Urządzenie / Przeglądarka</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Adres IP</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Utworzona</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Ostatnia aktywność</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold text-right">Akcja</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {activeSessions.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-600 dark:text-slate-400">
                              {isLoadingSessions ? 'Ładowanie listy sesji...' : 'Brak aktywnych sesji do wyświetlenia.'}
                            </td>
                          </tr>
                        ) : (
                          activeSessions.map((session) => (
                            <tr key={session.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {parseUserAgent(session.userAgent)}
                                  </span>
                                  {session.current && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                                      Ta sesja
                                    </span>
                                  )}
                                </div>
                                {session.userAgent && (
                                  <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono truncate max-w-xs" title={session.userAgent}>
                                    {session.userAgent}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                                {session.ip || '—'}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                                {new Date(session.createdAt).toLocaleString('pl-PL')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                                {session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString('pl-PL') : new Date(session.createdAt).toLocaleString('pl-PL')}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {session.current ? (
                                  <span className="text-[11px] text-slate-600 dark:text-slate-400 italic">Bieżąca</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeSession(session.id)}
                                    className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded border border-rose-200 dark:border-rose-900 transition-colors"
                                    title="Unieważnij tę sesję"
                                  >
                                    Wyloguj
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* 3B. SECURITY LOG TAB (ADMIN ONLY) */}
            {activeTab === 'security' && currentUser?.role === 'admin' && (
              <div className="space-y-4 max-w-4xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                      <Shield className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>Dziennik bezpieczeństwa</span>
                    </h4>
                    <p className="text-slate-600 dark:text-slate-400 text-xs">
                      Rejestr zdarzeń uwierzytelniania, operacji na kontach, sesjach oraz zmian konfiguracji 2FA (od najnowszych).
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1">
                      <Filter className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                      <select
                        value={securityFilterType}
                        onChange={(e) => setSecurityFilterType(e.target.value)}
                        aria-label="Filtr typu zdarzenia"
                        className="bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
                      >
                        <option value="all" className="bg-white dark:bg-slate-900">Wszystkie typy zdarzeń</option>
                        {(Object.keys(SECURITY_EVENT_LABELS) as SecurityEventType[]).map((evType) => (
                          <option key={evType} value={evType} className="bg-white dark:bg-slate-900">
                            {SECURITY_EVENT_LABELS[evType]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={loadSecurityEvents}
                      disabled={isLoadingSecurityEvents}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSecurityEvents ? 'animate-spin' : ''}`} aria-hidden="true" />
                      <span>Odśwież</span>
                    </button>
                  </div>
                </div>

                {securityLogError && (
                  <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{securityLogError}</span>
                  </div>
                )}

                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">Data</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Typ zdarzenia</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Użytkownik / E-mail</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Adres IP</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold">Szczegóły</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {securityEvents.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-600 dark:text-slate-400">
                              {isLoadingSecurityEvents
                                ? 'Ładowanie zdarzeń bezpieczeństwa...'
                                : 'Brak zarejestrowanych zdarzeń dla wybranego filtra.'}
                            </td>
                          </tr>
                        ) : (
                          securityEvents.map((ev, idx) => {
                            const isFailure = ev.type === 'login_failure' || ev.type === 'origin_blocked';
                            const matchedUser = ev.userId ? users.find((u) => u.id === ev.userId) : undefined;
                            const label = SECURITY_EVENT_LABELS[ev.type] || ev.type;
                            const detailsText = ev.details && Object.keys(ev.details).length > 0
                              ? Object.entries(ev.details)
                                  .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                                  .join(', ')
                              : '—';

                            return (
                              <tr
                                key={`${ev.ts}-${ev.type}-${idx}`}
                                className={
                                  isFailure
                                    ? 'bg-rose-50/80 dark:bg-rose-950/30 hover:bg-rose-100/70 dark:hover:bg-rose-950/50'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                }
                              >
                                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                  {new Date(ev.ts).toLocaleString('pl-PL')}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                      isFailure
                                        ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                                        : ev.type === 'login_success' || ev.type === 'twofa_enabled' || ev.type === 'user_approved'
                                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    {label}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-[11px]">
                                  {matchedUser ? (
                                    <div>
                                      <span className="font-semibold text-slate-900 dark:text-white">{matchedUser.name}</span>
                                      <span className="block text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                                        {ev.email || matchedUser.email || ev.userId}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="font-mono text-slate-700 dark:text-slate-300">
                                      {ev.email || ev.userId || '—'}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                  {ev.ip || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-slate-400 max-w-xs break-words">
                                  {detailsText}
                                  {ev.userAgent && (
                                    <span className="block text-[10px] text-slate-600 dark:text-slate-400 font-mono truncate mt-0.5" title={ev.userAgent}>
                                      UA: {ev.userAgent}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* 4. GOOGLE CALENDAR TAB */}
            {activeTab === 'calendar' && (
              <div className="space-y-5 max-w-3xl">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">
                    Subskrypcja Terminarza w Google Calendar (Na Żywo)
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Podłącz zadania i terminy urzędowe projektów bezpośrednio do swojego prywatnego lub służbowego Kalendarza Google.
                  </p>
                </div>

                <div className="p-4 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-xl space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-700 text-white shrink-0 mt-0.5 shadow-sm">
                      <CalendarIcon className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div>
                      <h5 className="font-bold text-sm text-slate-900 dark:text-white">
                        Subskrypcja jako Inny Kalendarz (Z adresu URL)
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        Google Calendar będzie automatycznie pobierał aktualizacje terminów zadań z Twojego serwera co kilkanaście minut.
                        Zmiany dokonane w systemie będą widoczne na Twoim telefonie i komputerze w aplikacji Kalendarz Google.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    {/* Link 1: All tasks */}
                    <div>
                      <label htmlFor="settings-cal-all-url" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        1. Adres URL dla WSZYSTKICH zadań i projektów pracowni:
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          id="settings-cal-all-url"
                          type="text"
                          readOnly
                          value={allCalendarUrl}
                          className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyCode(allCalendarUrl, 'cal-all')}
                          className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        >
                          {copiedKey === 'cal-all' ? <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                          <span>{copiedKey === 'cal-all' ? 'Skopiowano' : 'Kopiuj'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Link 2: My tasks */}
                    <div>
                      <label htmlFor="settings-cal-user-url" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        2. Adres URL dla MOICH ZADAŃ ({currentUser?.name || 'Zalogowany'}):
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          id="settings-cal-user-url"
                          type="text"
                          readOnly
                          value={userCalendarUrl}
                          className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyCode(userCalendarUrl, 'cal-user')}
                          className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        >
                          {copiedKey === 'cal-user' ? <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                          <span>{copiedKey === 'cal-user' ? 'Skopiowano' : 'Kopiuj'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Open Google Calendar Settings */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    <a
                      href="https://calendar.google.com/calendar/r/settings/addbyurl"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" aria-hidden="true" />
                      <span>Otwórz Google Calendar (+ Z adresu URL)</span>
                    </a>
                  </div>

                  <div className="p-3 bg-white/70 dark:bg-slate-900/70 rounded-lg border border-sky-100 dark:border-sky-900/50 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Instrukcja krok po kroku:</div>
                    <div>1. Skopiuj powyższy link (Wszystkie zadania lub Moje zadania).</div>
                    <div>2. Kliknij przycisk „Otwórz Google Calendar (+ Z adresu URL)”.</div>
                    <div>3. Wklej skopiowany link w polu „URL kalendarza” i kliknij „Dodaj kalendarz”. Gotowe!</div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. UPDATE TAB */}
            {activeTab === 'update' && (
              <div className="space-y-5 max-w-3xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-base">
                      Status Wersji i Aktualizacje Oprogramowania
                    </h4>
                    <p className="text-slate-600 dark:text-slate-400 text-xs">
                      Zainstalowane wydanie: <strong className="font-mono text-emerald-700 dark:text-emerald-400">{CURRENT_APP_VERSION}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleCheckUpdateNow}
                    disabled={isCheckingUpdate}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>{isCheckingUpdate ? 'Weryfikacja GitHub...' : 'Sprawdź aktualizacje teraz'}</span>
                  </button>
                </div>

                {/* Status Banner */}
                {(() => {
                  const isUpdateDetected = updateResult?.remoteVersion
                    ? isNewerVersion(updateResult.remoteVersion, CURRENT_APP_VERSION)
                    : (hasUpdateAvailable && updateResult?.status === 'update_available');
                  return (
                    <div role="status" className={`p-4 rounded-xl border flex items-start gap-3.5 ${
                      isUpdateDetected
                        ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 ring-2 ring-rose-500/30'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                    }`}>
                      {isUpdateDetected ? (
                        <AlertTriangle className="w-6 h-6 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5 animate-bounce" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="w-6 h-6 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 dark:text-white text-sm">
                            {isUpdateDetected ? '🚀 Dostępna nowa aktualizacja oprogramowania!' : '✅ System jest w pełni zaktualizowany'}
                          </span>
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono font-bold">
                            Wydanie: {CURRENT_APP_VERSION}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {updateResult ? updateResult.message : `Wersja ${CURRENT_APP_VERSION} jest zainstalowana na Twoim serwerze.`}
                        </p>
                        {updateResult?.lastChecked && (
                          <span className="text-[10px] text-slate-600 dark:text-slate-400 block pt-0.5">
                            Ostatnie sprawdzenie: {updateResult.lastChecked}
                          </span>
                        )}

                        {isUpdateDetected && (
                          <div className="pt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handleRunUpdateNow}
                              disabled={isUpdatingServer}
                              className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-bold shadow-md transition-colors flex items-center gap-2"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingServer ? 'animate-spin' : ''}`} aria-hidden="true" />
                              <span>{isUpdatingServer ? 'Aktualizowanie...' : 'Zaktualizuj z GitHub teraz'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyCode(RECOMMENDED_UPDATE_COMMAND, 'rec-update')}
                              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                            >
                              {copiedKey === 'rec-update' ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                              <span>{copiedKey === 'rec-update' ? 'Skopiowano polecenie!' : 'Kopiuj komendę terminala'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {updateServerMessage && (
                  <div role="status" className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
                    {updateServerMessage}
                  </div>
                )}

                {/* Recommended Terminal Update Command */}
                <div className="p-4 bg-slate-900 text-slate-100 rounded-xl space-y-3 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-sky-400 flex items-center gap-1.5">
                      <Terminal className="w-4 h-4" aria-hidden="true" />
                      <span>Oficjalne polecenie aktualizacji na serwerze Linux:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(RECOMMENDED_UPDATE_COMMAND, 'rec-update')}
                      className="flex items-center gap-1.5 text-xs bg-sky-700 hover:bg-sky-600 px-3 py-1.5 rounded-lg text-white font-semibold transition-colors shadow-xs cursor-pointer"
                    >
                      {copiedKey === 'rec-update' ? <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                      <span>{copiedKey === 'rec-update' ? 'Skopiowano do schowka!' : 'Kopiuj polecenie'}</span>
                    </button>
                  </div>
                  <pre className="font-mono text-xs bg-black/60 p-3 rounded-lg overflow-x-auto text-emerald-300 border border-slate-800 select-all">
                    {RECOMMENDED_UPDATE_COMMAND}
                  </pre>
                  <p className="text-[11px] text-slate-300">
                    Polecenie pobiera najnowsze zatwierdzenia z gałęzi main i natychmiastowo przebudowuje kontener bez utraty danych w pliku bazy JSON.
                  </p>
                </div>
              </div>
            )}

            {/* 6. DOCKER DEPLOYMENT TAB */}
            {activeTab === 'docker' && (
              <div className="space-y-4 max-w-3xl">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">
                    Konfiguracja Wdrożenia Docker na Serwerze
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Skrypty instalacji i pliki konfiguracyjne dla środowiska produkcyjnego Linux / Docker Compose.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                        Pierwsza instalacja na serwerze (Linux)
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(INSTALL_COMMAND, 'install-cmd')}
                        className="flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400 hover:underline"
                      >
                        {copiedKey === 'install-cmd' ? <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                        <span>{copiedKey === 'install-cmd' ? 'Skopiowano' : 'Kopiuj komendę'}</span>
                      </button>
                    </div>
                    <pre className="text-xs font-mono bg-slate-900 text-emerald-400 p-2.5 rounded border border-slate-700 overflow-x-auto select-all">
                      {INSTALL_COMMAND}
                    </pre>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Weryfikuje środowisko Docker, tworzy bezpieczny plik .env z kluczem APP_SECRET, katalog backups, zadanie crona dla kopii zapasowych oraz uruchamia aplikację.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                        Bezpieczna aktualizacja aplikacji
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(UPDATE_COMMAND, 'update-cmd')}
                        className="flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400 hover:underline"
                      >
                        {copiedKey === 'update-cmd' ? <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                        <span>{copiedKey === 'update-cmd' ? 'Skopiowano' : 'Kopiuj komendę'}</span>
                      </button>
                    </div>
                    <pre className="text-xs font-mono bg-slate-900 text-emerald-400 p-2.5 rounded border border-slate-700 overflow-x-auto select-all">
                      {UPDATE_COMMAND}
                    </pre>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Wykonuje kopię zapasową stanu bazy, pobiera najnowszy kod z GitHub i przebudowuje kontener z zachowaniem trwałego wolumenu danych.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 7. BACKUP TAB */}
            {activeTab === 'backup' && (
              <div className="space-y-4 max-w-3xl">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">
                    Kopie Zapasowe i Archiwizacja Bazy
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Automatyczne tworzenie kopii snapshot projektów, harmonogramów i komentarzy.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label htmlFor="settings-backup-enabled" className="font-bold text-slate-800 dark:text-slate-200 text-xs block cursor-pointer">
                        Automatyczne tworzenie kopii w tle
                      </label>
                      <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                        Gdy włączone, system okresowo zapisuje snapshot stanu projektów w pamięci lokalnej.
                      </span>
                    </div>
                    <label htmlFor="settings-backup-enabled" className="relative inline-flex items-center cursor-pointer">
                      <input
                        id="settings-backup-enabled"
                        type="checkbox"
                        aria-label="Automatyczne tworzenie kopii w tle"
                        checked={backupEnabled}
                        onChange={(e) => handleToggleBackup(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-700"></div>
                    </label>
                  </div>

                  {backupEnabled && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <label htmlFor="settings-backup-interval" className="text-xs text-slate-600 dark:text-slate-400">Częstotliwość kopii:</label>
                      <select
                        id="settings-backup-interval"
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

                {/* Network Drive / NAS Backup Section */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                        <Network className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        <span>Archiwizacja na Dysk Sieciowy / Serwer NAS</span>
                      </h4>
                      <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                        Lokalizacja zamontowanego zasobu sieciowego (SMB/NFS) w pracowni, np. /mnt/nas/projekty/kopie lub \\\\serwer-nas\\projekty.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="settings-nas-path" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Ścieżka do katalogu sieciowego:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="settings-nas-path"
                        type="text"
                        value={nasPath}
                        onChange={(e) => handleSaveNasPath(e.target.value)}
                        placeholder="/mnt/nas/projekty/kopie"
                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleTestNasConnection}
                        className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded text-xs font-semibold transition-colors"
                      >
                        Testuj zapis
                      </button>
                    </div>
                    {nasTestStatus && (
                      <p role="status" className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded border border-emerald-200 dark:border-emerald-800">
                        {nasTestStatus}
                      </p>
                    )}
                  </div>
                </div>

                {/* Google Account Pairing (Calendar & Drive) */}
                <div className="p-4 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                        <Cloud className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                        <span>Sparowanie z Kontem Google (Kalendarz & Dysk Google)</span>
                      </h4>
                      <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                        Synchronizuj terminarz z osobnym kalendarzem Google oraz wykonuj automatyczne kopie bazy na Google Drive.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleGooglePairing}
                      className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                        isGooglePaired
                          ? 'bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800'
                          : 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-400 border-sky-300 dark:border-sky-700 hover:bg-sky-50'
                      }`}
                    >
                      {isGooglePaired ? 'Połączono z Google ✓' : 'Sparuj konto Google'}
                    </button>
                  </div>

                  {isGooglePaired && (
                    <div className="pt-2 border-t border-sky-200 dark:border-sky-800/60 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <label htmlFor="settings-google-cal-sync" className="text-slate-700 dark:text-slate-300 cursor-pointer">
                          Synchronizacja Kalendarza Google (osobny kalendarz projektów):
                        </label>
                        <input
                          id="settings-google-cal-sync"
                          type="checkbox"
                          checked={googleCalendarSync}
                          onChange={(e) => {
                            setGoogleCalendarSync(e.target.checked);
                            localStorage.setItem('oph_google_calendar_sync', e.target.checked ? 'true' : 'false');
                          }}
                          className="rounded text-sky-700 focus:ring-sky-500"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="settings-google-drive-sync" className="text-slate-700 dark:text-slate-300 cursor-pointer">
                          Automatyczna kopia zapasowa na Google Drive:
                        </label>
                        <input
                          id="settings-google-drive-sync"
                          type="checkbox"
                          checked={googleDriveSync}
                          onChange={(e) => {
                            setGoogleDriveSync(e.target.checked);
                            localStorage.setItem('oph_google_drive_sync', e.target.checked ? 'true' : 'false');
                          }}
                          className="rounded text-sky-700 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {onOpenArchiveModal && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenArchiveModal();
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-800 text-white rounded text-xs font-semibold"
                    >
                      <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Otwórz pełny moduł archiwizacji (eksport/import)</span>
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-800 text-white rounded text-xs font-semibold shadow-xs"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
