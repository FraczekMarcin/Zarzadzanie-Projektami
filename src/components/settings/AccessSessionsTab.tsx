import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Save,
  Lock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Info,
  HardDrive,
} from 'lucide-react';
import type { User } from '../../types';
import {
  AdminSettingsResponse,
  SESSION_IDLE_MAX,
  SESSION_IDLE_MIN,
  SESSION_MAX_HOURS_MAX,
  SESSION_MAX_HOURS_MIN,
  TRASH_RETENTION_MAX,
  TRASH_RETENTION_MIN,
  TRUSTED_DEVICE_DAYS_MAX,
  TRUSTED_DEVICE_DAYS_MIN,
} from '../../utils/settingsSchema';
import type { ProgressWeighting } from '../../utils/progress';
import { useSettingsTabDirty } from './SettingsDirtyContext';

interface AdminSystemResponse {
  version: string;
  mode: string;
  disk: {
    freeBytes: number;
    totalBytes: number;
    freePercent: number;
    level: 'ok' | 'warn' | 'critical';
  } | null;
  uptimeSeconds: number;
  backup: {
    active: boolean;
    lastBackup: { filename: string; timestamp: string; ageHours: number; size: number } | null;
    maxAgeHours: number;
    message?: string;
  };
}

function formatDiskSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}

function formatServerUptime(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} d`);
  if (hours > 0 || days > 0) parts.push(`${hours} godz.`);
  parts.push(`${minutes} min`);
  return parts.join(' ');
}

export interface AccessSessionsTabProps {
  isOpen: boolean;
  currentUser: User | null;
  onRefreshState?: () => Promise<void> | void;
}

export const AccessSessionsTab: React.FC<AccessSessionsTabProps> = ({
  isOpen,
  currentUser,
  onRefreshState,
}) => {
  const reportTabDirty = useSettingsTabDirty();
  const [data, setData] = useState<AdminSettingsResponse | null>(null);
  const [systemStatus, setSystemStatus] = useState<AdminSystemResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pola edytowalne
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(true);
  const [idleMinutes, setIdleMinutes] = useState<string>('120');
  const [maxHours, setMaxHours] = useState<string>('12');
  const [trashRetentionDays, setTrashRetentionDays] = useState<string>('30');
  const [trustedDevicesEnabled, setTrustedDevicesEnabled] = useState(true);
  const [trustedDeviceDays, setTrustedDeviceDays] = useState<string>('30');
  const [trustedAllowForAdmins, setTrustedAllowForAdmins] = useState(true);
  const [progressWeighting, setProgressWeighting] = useState<ProgressWeighting>('estimate');
  const [currentPassword, setCurrentPassword] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const applyResponseToForm = (payload: AdminSettingsResponse) => {
    setData(payload);
    setAllowSelfRegistration(payload.access.allowSelfRegistration.value);
    setIdleMinutes(String(payload.sessions.idleMinutes.value));
    setMaxHours(String(payload.sessions.maxHours.value));
    if (payload.trash?.retentionDays) {
      setTrashRetentionDays(String(payload.trash.retentionDays.value));
    }
    if (payload.trustedDevices) {
      setTrustedDevicesEnabled(payload.trustedDevices.enabled.value);
      setTrustedDeviceDays(String(payload.trustedDevices.days.value));
      setTrustedAllowForAdmins(payload.trustedDevices.allowForAdmins.value);
    }
    if (payload.progress?.weighting) {
      setProgressWeighting(payload.progress.weighting.value);
    }
  };

  const fetchSettings = async () => {
    if (currentUser?.role !== 'admin') return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [settingsRes, systemRes] = await Promise.all([
        fetch('/api/admin/settings', { credentials: 'same-origin' }),
        fetch('/api/admin/system', { credentials: 'same-origin' }).catch(() => null),
      ]);
      const json = await settingsRes.json().catch(() => ({}));
      if (!settingsRes.ok) {
        setLoadError(json.error || 'Nie udało się pobrać ustawień dostępu i sesji.');
      } else {
        applyResponseToForm(json as AdminSettingsResponse);
      }
      if (systemRes && systemRes.ok) {
        const sysJson = await systemRes.json().catch(() => null);
        if (sysJson) {
          setSystemStatus(sysJson as AdminSystemResponse);
        }
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentUser?.role === 'admin') {
      fetchSettings();
    }
  }, [isOpen]);

  const isDirty = Boolean(
    isOpen &&
      data &&
      (allowSelfRegistration !== data.access.allowSelfRegistration.value ||
        idleMinutes !== String(data.sessions.idleMinutes.value) ||
        maxHours !== String(data.sessions.maxHours.value) ||
        (data.trash?.retentionDays &&
          trashRetentionDays !== String(data.trash.retentionDays.value)) ||
        (data.trustedDevices &&
          (trustedDevicesEnabled !== data.trustedDevices.enabled.value ||
            trustedDeviceDays !== String(data.trustedDevices.days.value) ||
            trustedAllowForAdmins !== data.trustedDevices.allowForAdmins.value)) ||
        (data.progress?.weighting &&
          progressWeighting !== data.progress.weighting.value) ||
        currentPassword.length > 0)
  );

  useEffect(() => {
    reportTabDirty('access', isDirty);
    return () => reportTabDirty('access', false);
  }, [isDirty, reportTabDirty]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;

    setSaveError(null);
    setSaveSuccess(null);

    if (!currentPassword) {
      setSaveError('Podaj aktualne hasło administratora, aby zapisać ustawienia.');
      return;
    }

    const body: Record<string, any> = { currentPassword };

    if (!data.access.allowSelfRegistration.locked) {
      body.access = { allowSelfRegistration };
    }

    const sessionsPatch: Record<string, any> = {};
    let effectiveIdle = data.sessions.idleMinutes.value;
    let effectiveMax = data.sessions.maxHours.value;

    if (!data.sessions.idleMinutes.locked) {
      const parsedIdle = Number(idleMinutes.trim());
      if (!Number.isInteger(parsedIdle) || parsedIdle < SESSION_IDLE_MIN || parsedIdle > SESSION_IDLE_MAX) {
        setSaveError(
          `Czas bezczynności sesji musi być liczbą całkowitą z zakresu od ${SESSION_IDLE_MIN} do ${SESSION_IDLE_MAX} minut.`
        );
        return;
      }
      sessionsPatch.idleMinutes = parsedIdle;
      effectiveIdle = parsedIdle;
    }

    if (!data.sessions.maxHours.locked) {
      const parsedMax = Number(maxHours.trim());
      if (
        !Number.isInteger(parsedMax) ||
        parsedMax < SESSION_MAX_HOURS_MIN ||
        parsedMax > SESSION_MAX_HOURS_MAX
      ) {
        setSaveError(
          `Maksymalny czas trwania sesji musi być liczbą całkowitą z zakresu od ${SESSION_MAX_HOURS_MIN} do ${SESSION_MAX_HOURS_MAX} godzin.`
        );
        return;
      }
      sessionsPatch.maxHours = parsedMax;
      effectiveMax = parsedMax;
    }

    if (effectiveIdle > effectiveMax * 60) {
      setSaveError(
        'Czas bezczynności sesji (w minutach) nie może przekraczać maksymalnego czasu trwania sesji.'
      );
      return;
    }

    if (Object.keys(sessionsPatch).length > 0) {
      body.sessions = sessionsPatch;
    }

    if (data.trash?.retentionDays && !data.trash.retentionDays.locked) {
      const parsedRetention = Number(trashRetentionDays.trim());
      if (
        !Number.isInteger(parsedRetention) ||
        parsedRetention < TRASH_RETENTION_MIN ||
        parsedRetention > TRASH_RETENTION_MAX
      ) {
        setSaveError(
          `Okres przechowywania w koszu musi być liczbą całkowitą z zakresu od ${TRASH_RETENTION_MIN} do ${TRASH_RETENTION_MAX} dni.`
        );
        return;
      }
      body.trash = { retentionDays: parsedRetention };
    }

    if (data.trustedDevices) {
      const tdPatch: Record<string, any> = {};
      if (!data.trustedDevices.enabled.locked) {
        tdPatch.enabled = trustedDevicesEnabled;
      }
      if (!data.trustedDevices.days.locked) {
        const parsedDays = Number(trustedDeviceDays.trim());
        if (
          !Number.isInteger(parsedDays) ||
          parsedDays < TRUSTED_DEVICE_DAYS_MIN ||
          parsedDays > TRUSTED_DEVICE_DAYS_MAX
        ) {
          setSaveError(
            `Okres zaufania urządzenia musi być liczbą całkowitą z zakresu od ${TRUSTED_DEVICE_DAYS_MIN} do ${TRUSTED_DEVICE_DAYS_MAX} dni.`
          );
          return;
        }
        tdPatch.days = parsedDays;
      }
      if (!data.trustedDevices.allowForAdmins.locked) {
        tdPatch.allowForAdmins = trustedAllowForAdmins;
      }
      if (Object.keys(tdPatch).length > 0) {
        body.trustedDevices = tdPatch;
      }
    }

    if (data.progress?.weighting && !data.progress.weighting.locked) {
      body.progress = { weighting: progressWeighting };
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(json.error || 'Nie udało się zapisać ustawień dostępu i sesji.');
        return;
      }
      if (json.settings) {
        applyResponseToForm(json.settings as AdminSettingsResponse);
      }
      if (Array.isArray(json.changedFields) && json.changedFields.includes('progress.weighting')) {
        await onRefreshState?.();
      }
      setCurrentPassword('');
      setSaveSuccess(
        Array.isArray(json.changedFields) && json.changedFields.length > 0
          ? 'Ustawienia dostępu i sesji zostały zapisane i obowiązują natychmiast.'
          : 'Brak nowych zmian do zapisania.'
      );
    } catch (err: any) {
      setSaveError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderEnvLockNote = (envVar?: string) => (
    <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1">
      <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>Ustawione zmienną środowiskową {envVar}</span>
    </p>
  );

  const trustProxyMisconfigured = Boolean(
    data &&
      !data.readOnly.trustProxy.value &&
      (data.readOnly.trustProxy.httpsDetected || data.readOnly.trustProxy.requestViaProxy)
  );

  const formatAppSecretStatus = () => {
    if (!data) return '—';
    const { configured, lengthOk, source } = data.readOnly.appSecret;
    if (!configured) return 'Nieustawiony';
    if (source === 'dev_file') {
      return lengthOk
        ? 'Wygenerowany lokalnie (dev, .dev_app_secret), długość poprawna'
        : 'Wygenerowany lokalnie (dev), nieprawidłowa długość';
    }
    return lengthOk
      ? 'Ustawiony, długość poprawna'
      : 'Ustawiony, zbyt krótki (wymagane min. 32 znaki)';
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Dostęp i sesje</span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5">
            Kontrola samodzielnej rejestracji, limitów wygasania sesji oraz podgląd parametrów startowych środowiska.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchSettings}
          disabled={isLoading}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Odśwież</span>
        </button>
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      {data && (
        <>
          <form onSubmit={handleSave} className="space-y-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
            <div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  id="access-allow-self-reg"
                  type="checkbox"
                  checked={allowSelfRegistration}
                  onChange={(e) => setAllowSelfRegistration(e.target.checked)}
                  disabled={data.access.allowSelfRegistration.locked}
                  className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Samodzielna rejestracja użytkowników
                  </span>
                  <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                    Pozwala nowym osobom składać wnioski o konto na ekranie logowania (każde konto nadal wymaga zatwierdzenia przez administratora).
                  </span>
                </span>
              </label>
              {data.access.allowSelfRegistration.locked &&
                renderEnvLockNote(data.access.allowSelfRegistration.envVar)}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label htmlFor="sessions-idle-minutes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Limit bezczynności sesji (minuty)
                </label>
                <input
                  id="sessions-idle-minutes"
                  type="number"
                  min={SESSION_IDLE_MIN}
                  max={SESSION_IDLE_MAX}
                  value={idleMinutes}
                  onChange={(e) => setIdleMinutes(e.target.value)}
                  disabled={data.sessions.idleMinutes.locked}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                  Zakres: {SESSION_IDLE_MIN}–{SESSION_IDLE_MAX} minut (domyślnie 120).
                </p>
                {data.sessions.idleMinutes.locked &&
                  renderEnvLockNote(data.sessions.idleMinutes.envVar)}
              </div>

              <div>
                <label htmlFor="sessions-max-hours" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Maksymalny czas trwania sesji (godziny)
                </label>
                <input
                  id="sessions-max-hours"
                  type="number"
                  min={SESSION_MAX_HOURS_MIN}
                  max={SESSION_MAX_HOURS_MAX}
                  value={maxHours}
                  onChange={(e) => setMaxHours(e.target.value)}
                  disabled={data.sessions.maxHours.locked}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                  Zakres: {SESSION_MAX_HOURS_MIN}–{SESSION_MAX_HOURS_MAX} godzin (domyślnie 12). Musi być ≥ limitu bezczynności.
                </p>
                {data.sessions.maxHours.locked && renderEnvLockNote(data.sessions.maxHours.envVar)}
              </div>

              {data.trash?.retentionDays && (
                <div>
                  <label htmlFor="trash-retention-days" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Przechowywanie usuniętych w koszu (dni)
                  </label>
                  <input
                    id="trash-retention-days"
                    type="number"
                    min={TRASH_RETENTION_MIN}
                    max={TRASH_RETENTION_MAX}
                    value={trashRetentionDays}
                    onChange={(e) => setTrashRetentionDays(e.target.value)}
                    disabled={data.trash.retentionDays.locked}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                  />
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                    Zakres: {TRASH_RETENTION_MIN}–{TRASH_RETENTION_MAX} dni (domyślnie 30). Po tym czasie wpisy z kosza są automatycznie usuwane.
                  </p>
                  {data.trash.retentionDays.locked && renderEnvLockNote(data.trash.retentionDays.envVar)}
                </div>
              )}
            </div>

            {data.trustedDevices && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div>
                  <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                    Zaufane urządzenia („Ufaj temu urządzeniu”)
                  </h5>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Pozwala użytkownikom zapamiętać przeglądarkę bezpiecznym ciasteczkiem HttpOnly z rotowanym tokenem.
                  </p>
                </div>

                <div>
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      id="trusted-devices-enabled"
                      type="checkbox"
                      checked={trustedDevicesEnabled}
                      onChange={(e) => setTrustedDevicesEnabled(e.target.checked)}
                      disabled={data.trustedDevices.enabled.locked}
                      className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Włącz funkcję zaufanych urządzeń przy logowaniu
                      </span>
                      <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                        Wyłączenie tej opcji natychmiast unieważnia wszystkie istniejące zaufane urządzenia w systemie.
                      </span>
                    </span>
                  </label>
                  {data.trustedDevices.enabled.locked &&
                    renderEnvLockNote(data.trustedDevices.enabled.envVar)}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div>
                    <label htmlFor="trusted-device-days" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Czas ważności zaufania (dni)
                    </label>
                    <input
                      id="trusted-device-days"
                      type="number"
                      min={TRUSTED_DEVICE_DAYS_MIN}
                      max={TRUSTED_DEVICE_DAYS_MAX}
                      value={trustedDeviceDays}
                      onChange={(e) => setTrustedDeviceDays(e.target.value)}
                      disabled={data.trustedDevices.days.locked}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                    />
                    <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                      Zakres: {TRUSTED_DEVICE_DAYS_MIN}–{TRUSTED_DEVICE_DAYS_MAX} dni (domyślnie 30).
                    </p>
                    {data.trustedDevices.days.locked &&
                      renderEnvLockNote(data.trustedDevices.days.envVar)}
                  </div>

                  <div className="pt-1 sm:pt-5">
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        id="trusted-devices-allow-admins"
                        type="checkbox"
                        checked={trustedAllowForAdmins}
                        onChange={(e) => setTrustedAllowForAdmins(e.target.checked)}
                        disabled={data.trustedDevices.allowForAdmins.locked}
                        className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                      />
                      <span>
                        <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Zezwalaj administratorom na zaufane urządzenia
                        </span>
                        <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                          Po odznaczeniu administratorzy muszą każdorazowo logować się hasłem (i 2FA).
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {data.progress?.weighting && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div>
                  <label
                    htmlFor="progress-weighting"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Sposób ważenia postępu zadań nadrzędnych i projektów
                  </label>
                  <select
                    id="progress-weighting"
                    value={progressWeighting}
                    onChange={(e) => setProgressWeighting(e.target.value as ProgressWeighting)}
                    disabled={data.progress.weighting.locked}
                    className="w-full sm:max-w-md px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                  >
                    <option value="estimate">Wg estymacji godzinowej / czasu trwania</option>
                    <option value="equal">Równe wagi podzadań</option>
                  </select>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                    Określa, czy postęp zadań nadrzędnych i projektów ważyć estymacją godzinową (z zapasowym czasem trwania w dniach), czy traktować każde nieanulowane podzadanie z jednakową wagą.
                  </p>
                  {data.progress.weighting.locked &&
                    renderEnvLockNote(data.progress.weighting.envVar)}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div>
                <label htmlFor="access-admin-current-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Aktualne hasło administratora (wymagane do zapisu zmian)
                </label>
                <input
                  id="access-admin-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Wpisz swoje aktualne hasło logowania"
                  className="w-full sm:max-w-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                />
              </div>

              {saveError && (
                <div role="alert" className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccess && (
                <div role="status" className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{saveSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  <Save className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSaving ? 'Zapisywanie...' : 'Zapisz'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Sekcja ustawień środowiska tylko do odczytu */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                  Ustawienia środowiska (tylko do odczytu)
                </h5>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Poniższe parametry są konfigurowane w pliku <code className="font-mono">.env</code> na serwerze, ponieważ muszą być znane przed startem aplikacji lub odpowiadają za kryptograficzną izolację danych.
                </p>
              </div>
            </div>

            {trustProxyMisconfigured && (
              <div role="alert" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <div className="font-bold">Wykryto ruch przez proxy / HTTPS przy wyłączonym TRUST_PROXY</div>
                  <p className="mt-0.5">
                    Nagłówki żądania wskazują połączenie przez reverse proxy lub HTTPS (<code className="font-mono">X-Forwarded-*</code>), ale <code className="font-mono">TRUST_PROXY</code> ma wartość <code className="font-mono">false</code>. Dopisz <code className="font-mono">TRUST_PROXY=1</code> w pliku <code className="font-mono">.env</code> na serwerze i zrestartuj kontener (<code className="font-mono">docker compose up -d</code>), aby poprawnie działały bezpieczne ciasteczka <code className="font-mono">__Host-zp_session</code> i logowanie adresów IP.
                  </p>
                </div>
              </div>
            )}

            <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              <div className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                <dt className="font-semibold text-slate-700 dark:text-slate-300">
                  Katalog danych (DATA_DIR)
                  <span className="block font-normal text-[11px] text-slate-600 dark:text-slate-400">
                    Określa lokalizację pliku app_state.json przed startem serwera (konfiguracja w .env).
                  </span>
                </dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 break-all sm:text-right">
                  {data.readOnly.dataDir}
                </dd>
              </div>

              <div className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                <dt className="font-semibold text-slate-700 dark:text-slate-300">
                  Zaufane proxy (TRUST_PROXY)
                  <span className="block font-normal text-[11px] text-slate-600 dark:text-slate-400">
                    Wymagane przed warstwą sieciową Express dla X-Forwarded-Proto/For (konfiguracja w .env).
                  </span>
                </dt>
                <dd className="sm:text-right space-y-0.5">
                  <div className="font-mono text-slate-900 dark:text-slate-100">
                    {String(data.readOnly.trustProxy.value)}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Połączenie przez proxy: {data.readOnly.trustProxy.requestViaProxy ? 'tak' : 'nie'} · HTTPS: {data.readOnly.trustProxy.httpsDetected ? 'tak' : 'nie'}
                  </div>
                </dd>
              </div>

              <div className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                <dt className="font-semibold text-slate-700 dark:text-slate-300">
                  Klucz szyfrowania (APP_SECRET)
                  <span className="block font-normal text-[11px] text-slate-600 dark:text-slate-400">
                    Musi być oddzielony od bazy danych, aby wykradzenie app_state.json nie ujawniło sekretów (konfiguracja w .env).
                  </span>
                </dt>
                <dd className="text-slate-900 dark:text-slate-100 sm:text-right font-medium">
                  {formatAppSecretStatus()}
                </dd>
              </div>

              <div className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                <dt className="font-semibold text-slate-700 dark:text-slate-300">
                  Tryb uruchomienia (NODE_ENV)
                </dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 sm:text-right">
                  {data.readOnly.mode}
                </dd>
              </div>

              <div className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                <dt className="font-semibold text-slate-700 dark:text-slate-300">
                  Wersja aplikacji
                </dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 sm:text-right">
                  {data.readOnly.version}
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}

      {systemStatus && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
              <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                Stan serwera i zajętość dysku
              </h5>
            </div>
            {systemStatus.disk ? (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                  systemStatus.disk.level === 'critical'
                    ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800'
                    : systemStatus.disk.level === 'warn'
                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800'
                    : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
                }`}
              >
                {systemStatus.disk.level === 'critical'
                  ? 'Krytyczny (brak miejsca)'
                  : systemStatus.disk.level === 'warn'
                  ? 'Ostrzeżenie (mało miejsca)'
                  : 'OK'}
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Brak danych
              </span>
            )}
          </div>

          {systemStatus.disk ? (
            <div className="space-y-1.5">
              {(() => {
                const usedPercent = Math.min(100, Math.max(0, Math.round((100 - systemStatus.disk.freePercent) * 10) / 10));
                return (
                  <>
                    <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                      <span>
                        Wolne miejsce:{' '}
                        <strong className="font-mono text-slate-900 dark:text-white">
                          {formatDiskSize(systemStatus.disk.freeBytes)}
                        </strong>{' '}
                        z{' '}
                        <span className="font-mono">
                          {formatDiskSize(systemStatus.disk.totalBytes)}
                        </span>{' '}
                        ({systemStatus.disk.freePercent}%)
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        Zajęto: {usedPercent}%
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Zajętość dysku serwera"
                      aria-valuenow={Math.round(usedPercent)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
                    >
                      <div
                        className={`h-full transition-all ${
                          systemStatus.disk.level === 'critical'
                            ? 'bg-rose-600 dark:bg-rose-500'
                            : systemStatus.disk.level === 'warn'
                            ? 'bg-amber-600 dark:bg-amber-500'
                            : 'bg-emerald-600 dark:bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(2, usedPercent))}%` }}
                      />
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Nie udało się odczytać statystyk wolnego miejsca na dysku serwera.
            </p>
          )}

          <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-xs pt-1">
            <div className="py-2 flex flex-col sm:flex-row sm:justify-between gap-1">
              <dt className="font-semibold text-slate-700 dark:text-slate-300">
                Czas pracy serwera (uptime)
              </dt>
              <dd className="font-mono text-slate-900 dark:text-slate-100 sm:text-right">
                {formatServerUptime(systemStatus.uptimeSeconds)}
              </dd>
            </div>
            <div className="py-2 flex flex-col sm:flex-row sm:justify-between gap-1">
              <dt className="font-semibold text-slate-700 dark:text-slate-300">
                Status kopii zapasowej
              </dt>
              <dd className="sm:text-right text-slate-900 dark:text-slate-100">
                <span
                  className={`font-semibold ${
                    systemStatus.backup.active
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {systemStatus.backup.active ? 'Aktywna' : 'Nieaktualna / brak'}
                </span>
                {systemStatus.backup.message && (
                  <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                    {systemStatus.backup.message}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
};

export default AccessSessionsTab;
