import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  CheckCircle2,
  Clock,
  Check,
  UserX,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import type { User } from '../../types';
import { parseUserAgent, PublicSession } from '../../utils/sessions';
import { validatePassword } from '../../utils/passwordPolicy';
import { TwoFactorManager } from '../TwoFactorManager';
import { PasswordRequirementsChecklist } from '../PasswordRequirementsChecklist';
import { TrustedDevicesSection } from '../TrustedDevicesSection';
import { useSettingsTabDirty } from './SettingsDirtyContext';

export interface UsersTabProps {
  isOpen: boolean;
  currentUser: User | null;
  pendingUsers: User[];
  approvedUsers: User[];
  onClose: () => void;
  onOpenUserModal?: () => void;
  onApproveUser?: (userId: string) => void;
  onRejectUser?: (userId: string) => void;
  onUserUpdated?: (updated: Partial<User>) => void;
  onRefreshUsers?: () => void;
  onUpdateUserPassword?: (userId: string, newPass: string, currentPass?: string) => Promise<boolean | void> | void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  isOpen,
  currentUser,
  pendingUsers,
  approvedUsers,
  onClose,
  onOpenUserModal,
  onApproveUser,
  onRejectUser,
  onUserUpdated,
  onRefreshUsers,
  onUpdateUserPassword,
}) => {
  const reportTabDirty = useSettingsTabDirty();
  const [settingsCurrentPassword, setSettingsCurrentPassword] = useState('');
  const [settingsNewPassword, setSettingsNewPassword] = useState('');
  const [settingsConfirmPassword, setSettingsConfirmPassword] = useState('');
  const [settingsPwError, setSettingsPwError] = useState<string | null>(null);
  const [settingsPwSuccess, setSettingsPwSuccess] = useState(false);
  const [isChangingSettingsPassword, setIsChangingSettingsPassword] = useState(false);

  const [activeSessions, setActiveSessions] = useState<PublicSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [sessionActionSuccess, setSessionActionSuccess] = useState<string | null>(null);
  const [isRevokingOthers, setIsRevokingOthers] = useState(false);
  const [adminDevicesTarget, setAdminDevicesTarget] = useState<User | null>(null);

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

  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  const isDirty = Boolean(
    isOpen &&
      (settingsCurrentPassword.length > 0 ||
        settingsNewPassword.length > 0 ||
        settingsConfirmPassword.length > 0)
  );

  useEffect(() => {
    reportTabDirty('users', isDirty);
    return () => reportTabDirty('users', false);
  }, [isDirty, reportTabDirty]);

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

  return (
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
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setAdminDevicesTarget((prev) => (prev?.id === u.id ? null : u))
                      }
                      className="px-2 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60 rounded transition-colors"
                      title="Zarządzaj zaufanymi urządzeniami użytkownika"
                    >
                      Zaufane urządzenia
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAdminRevokeAllUserSessions(u.id, u.name)}
                      className="px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60 rounded transition-colors"
                      title="Wyloguj użytkownika ze wszystkich urządzeń"
                    >
                      Zakończ wszystkie sesje
                    </button>
                  </>
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

      {/* Admin panel zarządzania zaufanymi urządzeniami wybranego użytkownika */}
      {currentUser?.role === 'admin' && adminDevicesTarget && (
        <div className="space-y-2 p-3 rounded-lg border-2 border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              Podgląd administratora: zaufane urządzenia użytkownika {adminDevicesTarget.name}
            </span>
            <button
              type="button"
              onClick={() => setAdminDevicesTarget(null)}
              className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              Zamknij
            </button>
          </div>
          <TrustedDevicesSection
            isOpen={isOpen && Boolean(adminDevicesTarget)}
            targetUserId={adminDevicesTarget.id}
            targetUserName={adminDevicesTarget.name}
          />
        </div>
      )}

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

      {/* Trusted Devices Section for Current User */}
      {currentUser && <TrustedDevicesSection isOpen={isOpen} />}
    </div>
  );
};

export default UsersTab;
