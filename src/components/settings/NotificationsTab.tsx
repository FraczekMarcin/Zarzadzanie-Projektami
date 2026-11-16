import React, { useEffect, useState } from 'react';
import {
  Bell,
  Save,
  Send,
  Play,
  Lock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type { User } from '../../types';
import type { AdminSettingsResponse } from '../../utils/settingsSchema';
import { POPULAR_TIMEZONES } from '../../utils/reminders';

export interface ReminderStatusResponse {
  enabled: boolean;
  lastRunDate: string | null;
  lastRunAt: string | null;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
  nextScheduledAt: string | null;
  smtpConfigured: boolean;
}

export interface NotificationsTabProps {
  isOpen: boolean;
  currentUser: User | null;
  onOpenSmtpTab?: () => void;
}

const DAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 7, label: '7 dni przed terminem' },
  { value: 3, label: '3 dni przed terminem' },
  { value: 2, label: '2 dni przed terminem' },
  { value: 1, label: '1 dzień przed terminem (jutro)' },
  { value: 0, label: 'W dniu terminu (0 dni)' },
];

export const NotificationsTab: React.FC<NotificationsTabProps> = ({
  isOpen,
  currentUser,
  onOpenSmtpTab,
}) => {
  const [data, setData] = useState<AdminSettingsResponse | null>(null);
  const [status, setStatus] = useState<ReminderStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pola formularza
  const [enabled, setEnabled] = useState(false);
  const [sendHour, setSendHour] = useState<number>(8);
  const [timezone, setTimezone] = useState<string>('Europe/Warsaw');
  const [useCustomTimezone, setUseCustomTimezone] = useState(false);
  const [daysBefore, setDaysBefore] = useState<number[]>([1, 0]);
  const [notifyOverdue, setNotifyOverdue] = useState(true);
  const [appBaseUrl, setAppBaseUrl] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Podgląd i ręczne uruchomienie
  const [isSendingPreview, setIsSendingPreview] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [forceRun, setForceRun] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const applyResponseToForm = (payload: AdminSettingsResponse) => {
    setData(payload);
    setEnabled(payload.reminders.enabled.value);
    setSendHour(payload.reminders.sendHour.value);
    const tz = payload.reminders.timezone.value || 'Europe/Warsaw';
    setTimezone(tz);
    setUseCustomTimezone(!POPULAR_TIMEZONES.includes(tz));
    setDaysBefore([...payload.reminders.daysBefore.value]);
    setNotifyOverdue(payload.reminders.notifyOverdue.value);
    setAppBaseUrl(payload.reminders.appBaseUrl.value || '');
  };

  const fetchAll = async () => {
    if (currentUser?.role !== 'admin') return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch('/api/admin/settings', { credentials: 'same-origin' }),
        fetch('/api/admin/reminders/status', { credentials: 'same-origin' }),
      ]);
      const settingsJson = await settingsRes.json().catch(() => ({}));
      const statusJson = await statusRes.json().catch(() => ({}));

      if (!settingsRes.ok) {
        setLoadError(settingsJson.error || 'Nie udało się pobrać ustawień powiadomień.');
        return;
      }
      applyResponseToForm(settingsJson as AdminSettingsResponse);
      if (statusRes.ok) {
        setStatus(statusJson as ReminderStatusResponse);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentUser?.role === 'admin') {
      fetchAll();
    }
  }, [isOpen]);

  const toggleDay = (day: number) => {
    setDaysBefore((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => b - a)
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;

    setSaveError(null);
    setSaveSuccess(null);

    if (!currentPassword) {
      setSaveError('Podaj aktualne hasło administratora, aby zapisać ustawienia.');
      return;
    }

    const remindersPatch: Record<string, any> = {
      daysBefore,
      notifyOverdue,
      appBaseUrl: appBaseUrl.trim(),
    };
    if (!data.reminders.enabled.locked) remindersPatch.enabled = enabled;
    if (!data.reminders.sendHour.locked) remindersPatch.sendHour = sendHour;
    if (!data.reminders.timezone.locked) remindersPatch.timezone = timezone.trim();

    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          reminders: remindersPatch,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(json.error || 'Nie udało się zapisać ustawień powiadomień.');
        return;
      }
      if (json.settings) {
        applyResponseToForm(json.settings as AdminSettingsResponse);
      }
      setCurrentPassword('');
      setSaveSuccess(
        Array.isArray(json.changedFields) && json.changedFields.length > 0
          ? 'Ustawienia powiadomień zostały zapisane i obowiązują natychmiast.'
          : 'Brak nowych zmian do zapisania.'
      );
      // Odśwież status harmonogramu (np. nextScheduledAt)
      const statusRes = await fetch('/api/admin/reminders/status', { credentials: 'same-origin' });
      if (statusRes.ok) {
        const statusJson = await statusRes.json().catch(() => null);
        if (statusJson) setStatus(statusJson);
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendPreview = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsSendingPreview(true);
    try {
      const res = await fetch('/api/admin/reminders/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || 'Nie udało się wysłać wiadomości podglądu.');
        return;
      }
      setActionSuccess(json.message || 'Wiadomość podglądu została wysłana na Twój adres e-mail.');
    } catch (err: any) {
      setActionError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsSendingPreview(false);
    }
  };

  const handleRunNow = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsRunningNow(true);
    try {
      const res = await fetch('/api/admin/reminders/run-now', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: forceRun }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || 'Nie udało się uruchomić wysyłki przypomnień.');
        return;
      }
      if (json.status) {
        setStatus(json.status as ReminderStatusResponse);
      }
      setActionSuccess(
        `Przebieg przypomnień zakończony: wysłano ${json.sentCount ?? 0}, pominięto ${json.skippedCount ?? 0}, błędy ${json.errorCount ?? 0}.`
      );
    } catch (err: any) {
      setActionError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsRunningNow(false);
    }
  };

  const renderEnvLockNote = (envVar?: string) => (
    <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1">
      <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>Ustawione zmienną środowiskową {envVar}</span>
    </p>
  );

  const smtpConfigured = status ? status.smtpConfigured : Boolean(data?.smtp.configured);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Powiadomienia</span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5">
            Dzienne zbiorcze przypomnienia e-mail o zbliżających się i zaległych terminach zadań (maksymalnie jedna wiadomość dziennie na osobę).
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAll}
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

      {data && !smtpConfigured && (
        <div role="alert" className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-[220px]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            <div>
              <div className="font-bold">Poczta SMTP nie jest skonfigurowana</div>
              <p className="mt-0.5">
                Wysyłka przypomnień e-mail wymaga skonfigurowania serwera pocztowego w zakładce Poczta (SMTP).
              </p>
            </div>
          </div>
          {onOpenSmtpTab && (
            <button
              type="button"
              onClick={onOpenSmtpTab}
              className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold shrink-0 transition-colors"
            >
              Przejdź do Poczta (SMTP)
            </button>
          )}
        </div>
      )}

      {data && (
        <>
          <form onSubmit={handleSave} className="space-y-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
            <div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  id="reminders-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  disabled={data.reminders.enabled.locked}
                  className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                    Włącz codzienne przypomnienia e-mail o terminach zadań
                  </span>
                  <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                    Każdy aktywny użytkownik z przypisanymi zadaniami otrzyma co najwyżej jedno zbiorcze zestawienie dziennie.
                  </span>
                </span>
              </label>
              {data.reminders.enabled.locked && renderEnvLockNote(data.reminders.enabled.envVar)}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="reminders-send-hour" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Godzina wysyłki (0–23)
                </label>
                <select
                  id="reminders-send-hour"
                  value={sendHour}
                  onChange={(e) => setSendHour(Number(e.target.value))}
                  disabled={data.reminders.sendHour.locked}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
                {data.reminders.sendHour.locked && renderEnvLockNote(data.reminders.sendHour.envVar)}
              </div>

              <div>
                <label htmlFor="reminders-timezone-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Strefa czasowa (IANA)
                </label>
                <select
                  id="reminders-timezone-select"
                  value={useCustomTimezone ? '__custom__' : timezone}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__custom__') {
                      setUseCustomTimezone(true);
                    } else {
                      setUseCustomTimezone(false);
                      setTimezone(val);
                    }
                  }}
                  disabled={data.reminders.timezone.locked}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                >
                  {POPULAR_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                  <option value="__custom__">Inna strefa IANA (wpisz ręcznie)</option>
                </select>
                {useCustomTimezone && (
                  <input
                    id="reminders-timezone-custom"
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    disabled={data.reminders.timezone.locked}
                    aria-label="Własna strefa czasowa IANA"
                    placeholder="np. Europe/Zurich"
                    className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                  />
                )}
                {data.reminders.timezone.locked && renderEnvLockNote(data.reminders.timezone.envVar)}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Kiedy uwzględniać zbliżające się zadania
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DAY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={daysBefore.includes(opt.value)}
                      onChange={() => toggleDay(opt.value)}
                      className="rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                    />
                    <span className="text-xs text-slate-800 dark:text-slate-200">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  id="reminders-notify-overdue"
                  type="checkbox"
                  checked={notifyOverdue}
                  onChange={(e) => setNotifyOverdue(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Dołącz zadania po terminie (maksymalnie przez 3 dni po upływie terminu)
                  </span>
                </span>
              </label>
            </div>

            <div>
              <label htmlFor="reminders-app-base-url" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Adres bazowy aplikacji w linkach (appBaseUrl)
              </label>
              <input
                id="reminders-app-base-url"
                type="url"
                value={appBaseUrl}
                onChange={(e) => setAppBaseUrl(e.target.value)}
                placeholder="https://projekty.twojadomena.pl"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
              />
              <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                Gdy pusty, wiadomości e-mail nie będą zawierać linków klikalnych do zadań (domyślnie używa PUBLIC_BASE_URL lub https://APP_HOST w trybie HTTPS).
              </p>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div>
                <label htmlFor="reminders-admin-current-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Aktualne hasło administratora (wymagane do zapisu zmian)
                </label>
                <input
                  id="reminders-admin-current-password"
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

          {/* Status harmonogramu i ręczne akcje */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                Status harmonogramu i test wysyłki
              </h5>
              {status && (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    status.enabled
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {status.enabled ? 'Harmonogram aktywny' : 'Harmonogram wyłączony'}
                </span>
              )}
            </div>

            {status && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs p-3 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                <div>
                  <dt className="text-[11px] text-slate-600 dark:text-slate-400">Ostatnie uruchomienie</dt>
                  <dd className="font-mono text-slate-900 dark:text-slate-100">
                    {status.lastRunAt ? status.lastRunAt.replace('T', ' ').slice(0, 19) + ' UTC' : 'Brak'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-600 dark:text-slate-400">Następne planowane</dt>
                  <dd className="font-mono text-slate-900 dark:text-slate-100">
                    {status.nextScheduledAt ? status.nextScheduledAt.replace('T', ' ').slice(0, 19) + ' UTC' : 'Nie zaplanowano'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-600 dark:text-slate-400">Wynik ostatniego przebiegu</dt>
                  <dd className="text-slate-900 dark:text-slate-100">
                    Wysłano: <strong>{status.sentCount}</strong> · Pominięto: <strong>{status.skippedCount}</strong> · Błędy: <strong>{status.errorCount}</strong>
                  </dd>
                </div>
                {status.lastError && (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] text-rose-700 dark:text-rose-400">Ostatni błąd</dt>
                    <dd className="text-rose-700 dark:text-rose-300">{status.lastError}</dd>
                  </div>
                )}
              </dl>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceRun}
                  onChange={(e) => setForceRun(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                />
                <span>Wymuś ponowną wysyłkę przy ręcznym uruchomieniu (force)</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendPreview}
                  disabled={isSendingPreview || !smtpConfigured}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-800 dark:text-slate-100 text-xs font-semibold border border-slate-300 dark:border-slate-700 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSendingPreview ? 'Wysyłanie...' : 'Wyślij podgląd do mnie'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRunNow}
                  disabled={isRunningNow || !smtpConfigured}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isRunningNow ? 'Wysyłanie...' : 'Uruchom teraz'}</span>
                </button>
              </div>
            </div>

            {actionError && (
              <div role="alert" className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{actionError}</span>
              </div>
            )}

            {actionSuccess && (
              <div role="status" className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{actionSuccess}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationsTab;
