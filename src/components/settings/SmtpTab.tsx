import React, { useEffect, useState } from 'react';
import {
  Mail,
  Send,
  Save,
  Lock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import type { User } from '../../types';
import type { AdminSettingsResponse, SmtpEncryption } from '../../utils/settingsSchema';
import { useSettingsTabDirty } from './SettingsDirtyContext';

export interface SmtpTabProps {
  isOpen: boolean;
  currentUser: User | null;
}

export const SmtpTab: React.FC<SmtpTabProps> = ({ isOpen, currentUser }) => {
  const reportTabDirty = useSettingsTabDirty();
  const [data, setData] = useState<AdminSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pola formularza
  const [host, setHost] = useState('');
  const [port, setPort] = useState<string>('587');
  const [encryption, setEncryption] = useState<SmtpEncryption>('starttls');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [allowSelfSigned, setAllowSelfSigned] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Test wysyłki SMTP
  const [testRecipient, setTestRecipient] = useState(currentUser?.email || '');
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  const applyResponseToForm = (payload: AdminSettingsResponse) => {
    setData(payload);
    setHost(payload.smtp.host.value);
    setPort(String(payload.smtp.port.value));
    setEncryption(payload.smtp.encryption.value);
    setUser(payload.smtp.user.value);
    setFromName(payload.smtp.fromName.value);
    setFromAddress(payload.smtp.fromAddress.value);
    setAllowSelfSigned(payload.smtp.allowSelfSigned.value);
    setPassword('');
    setClearPassword(false);
  };

  const fetchSettings = async () => {
    if (currentUser?.role !== 'admin') return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/settings', { credentials: 'same-origin' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || 'Nie udało się pobrać ustawień poczty SMTP.');
        return;
      }
      applyResponseToForm(json as AdminSettingsResponse);
    } catch (err: any) {
      setLoadError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentUser?.role === 'admin') {
      fetchSettings();
      if (!testRecipient && currentUser?.email) {
        setTestRecipient(currentUser.email);
      }
    }
  }, [isOpen]);

  const isDirty = Boolean(
    isOpen &&
      data &&
      (host !== data.smtp.host.value ||
        port !== String(data.smtp.port.value) ||
        encryption !== data.smtp.encryption.value ||
        user !== data.smtp.user.value ||
        fromName !== data.smtp.fromName.value ||
        fromAddress !== data.smtp.fromAddress.value ||
        allowSelfSigned !== data.smtp.allowSelfSigned.value ||
        password.length > 0 ||
        clearPassword ||
        currentPassword.length > 0)
  );

  useEffect(() => {
    reportTabDirty('smtp', isDirty);
    return () => reportTabDirty('smtp', false);
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

    const smtpPatch: Record<string, any> = {};
    if (!data.smtp.host.locked) smtpPatch.host = host.trim();
    if (!data.smtp.port.locked) {
      const parsedPort = Number(port.trim());
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        setSaveError('Port SMTP musi być liczbą całkowitą z zakresu od 1 do 65535.');
        return;
      }
      smtpPatch.port = parsedPort;
    }
    if (!data.smtp.encryption.locked) smtpPatch.encryption = encryption;
    if (!data.smtp.user.locked) smtpPatch.user = user.trim();
    if (!data.smtp.passwordSet.locked) {
      if (clearPassword) {
        smtpPatch.clearPassword = true;
      } else if (password.length > 0) {
        smtpPatch.password = password;
      }
    }
    if (!data.smtp.fromName.locked) smtpPatch.fromName = fromName.trim();
    if (!data.smtp.fromAddress.locked) smtpPatch.fromAddress = fromAddress.trim();
    if (!data.smtp.allowSelfSigned.locked) smtpPatch.allowSelfSigned = allowSelfSigned;

    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          smtp: smtpPatch,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(json.error || 'Nie udało się zapisać konfiguracji SMTP.');
        return;
      }
      if (json.settings) {
        applyResponseToForm(json.settings as AdminSettingsResponse);
      }
      setCurrentPassword('');
      setSaveSuccess(
        Array.isArray(json.changedFields) && json.changedFields.length > 0
          ? 'Konfiguracja poczty SMTP została zapisana i obowiązuje natychmiast.'
          : 'Brak nowych zmian do zapisania.'
      );
    } catch (err: any) {
      setSaveError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTestMail = async () => {
    setTestError(null);
    setTestSuccess(null);
    setIsTesting(true);
    try {
      const res = await fetch('/api/admin/settings/smtp-test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testRecipient.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestError(json.error || 'Nie udało się wysłać wiadomości testowej SMTP.');
        return;
      }
      setTestSuccess(json.message || 'Wiadomość testowa została pomyślnie wysłana.');
    } catch (err: any) {
      setTestError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsTesting(false);
    }
  };

  const renderEnvLockNote = (envVar?: string) => (
    <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1">
      <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>Ustawione zmienną środowiskową {envVar}</span>
    </p>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Poczta (SMTP)</span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5">
            Konfiguracja serwera pocztowego używanego do resetowania haseł przez e-mail i alertów kopii zapasowych. Zmiany działają bez restartu serwera.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                data.smtp.configured
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
              }`}
            >
              {data.smtp.configured ? 'Poczta skonfigurowana' : 'Poczta nie jest skonfigurowana'}
            </span>
          )}
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
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      {encryption === 'none' && (
        <div role="alert" className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <div>
            <div className="font-bold">Uwaga: połączenie SMTP bez szyfrowania</div>
            <p className="mt-0.5">
              Wybrano tryb „Brak szyfrowania”. Dane logowania SMTP oraz jednorazowe kody resetowania hasła będą przesyłane w sieci otwartym tekstem. W środowisku produkcyjnym zalecane jest STARTTLS lub TLS.
            </p>
          </div>
        </div>
      )}

      {allowSelfSigned && encryption !== 'none' && (
        <div role="alert" className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <div>
            <div className="font-bold">Uwaga: wyłączona weryfikacja certyfikatu TLS</div>
            <p className="mt-0.5">
              Akceptowanie samopodpisanych certyfikatów obniża ochronę przed atakami typu Man-in-the-Middle. Stosuj tę opcję wyłącznie dla zaufanych lokalnych serwerów pocztowych.
            </p>
          </div>
        </div>
      )}

      {data && (
        <>
          <form onSubmit={handleSave} className="space-y-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="smtp-host" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Serwer SMTP (host)
                </label>
                <input
                  id="smtp-host"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={data.smtp.host.locked}
                  placeholder="np. smtp.twojadomena.pl"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                {data.smtp.host.locked && renderEnvLockNote(data.smtp.host.envVar)}
              </div>

              <div>
                <label htmlFor="smtp-port" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Port SMTP
                </label>
                <input
                  id="smtp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={data.smtp.port.locked}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                {data.smtp.port.locked && renderEnvLockNote(data.smtp.port.envVar)}
              </div>

              <div>
                <label htmlFor="smtp-encryption" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Szyfrowanie połączenia
                </label>
                <select
                  id="smtp-encryption"
                  value={encryption}
                  onChange={(e) => setEncryption(e.target.value as SmtpEncryption)}
                  disabled={data.smtp.encryption.locked}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                >
                  <option value="starttls">STARTTLS (zalecane, zwykle port 587)</option>
                  <option value="tls">SSL / TLS (SMTPS, zwykle port 465)</option>
                  <option value="none">Brak szyfrowania (niezalecane)</option>
                </select>
                {data.smtp.encryption.locked && renderEnvLockNote(data.smtp.encryption.envVar)}
              </div>

              <div>
                <label htmlFor="smtp-user" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Użytkownik SMTP
                </label>
                <input
                  id="smtp-user"
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  disabled={data.smtp.user.locked}
                  autoComplete="off"
                  placeholder="np. powiadomienia@twojadomena.pl"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                {data.smtp.user.locked && renderEnvLockNote(data.smtp.user.envVar)}
              </div>

              <div className="sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label htmlFor="smtp-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Hasło SMTP
                  </label>
                  <div className="flex items-center gap-2">
                    {data.smtp.passwordSet.value && !clearPassword && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Hasło zapisane
                      </span>
                    )}
                    {clearPassword && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                        Zostanie usunięte po zapisaniu
                      </span>
                    )}
                    {data.smtp.passwordSet.value && !data.smtp.passwordSet.locked && (
                      <button
                        type="button"
                        onClick={() => {
                          setClearPassword((prev) => !prev);
                          setPassword('');
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-800 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                        <span>{clearPassword ? 'Cofnij usunięcie' : 'Usuń hasło'}</span>
                      </button>
                    )}
                  </div>
                </div>
                <input
                  id="smtp-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (e.target.value.length > 0 && clearPassword) {
                      setClearPassword(false);
                    }
                  }}
                  disabled={data.smtp.passwordSet.locked || clearPassword}
                  autoComplete="new-password"
                  placeholder={
                    data.smtp.passwordSet.value
                      ? 'Pozostaw puste, aby zachować zapisane hasło'
                      : 'Wpisz hasło SMTP (opcjonalne dla serwerów bez autoryzacji)'
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                {data.smtp.passwordSet.locked && renderEnvLockNote(data.smtp.passwordSet.envVar)}
              </div>

              <div>
                <label htmlFor="smtp-from-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nazwa nadawcy
                </label>
                <input
                  id="smtp-from-name"
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  disabled={data.smtp.fromName.locked}
                  placeholder="Zarządzanie Projektami"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                {data.smtp.fromName.locked && renderEnvLockNote(data.smtp.fromName.envVar)}
              </div>

              <div>
                <label htmlFor="smtp-from-address" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Adres e-mail nadawcy
                </label>
                <input
                  id="smtp-from-address"
                  type="email"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  disabled={data.smtp.fromAddress.locked}
                  placeholder="noreply@pracownia.pl"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
                {data.smtp.fromAddress.locked && renderEnvLockNote(data.smtp.fromAddress.envVar)}
              </div>
            </div>

            <div className="pt-1">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  id="smtp-allow-self-signed"
                  type="checkbox"
                  checked={allowSelfSigned}
                  onChange={(e) => setAllowSelfSigned(e.target.checked)}
                  disabled={data.smtp.allowSelfSigned.locked}
                  className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-sky-700 focus:ring-sky-600"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  Zezwalaj na samopodpisane certyfikaty TLS (np. wewnętrzny serwer pocztowy w sieci lokalnej)
                </span>
              </label>
              {data.smtp.allowSelfSigned.locked && renderEnvLockNote(data.smtp.allowSelfSigned.envVar)}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div>
                <label htmlFor="smtp-admin-current-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Aktualne hasło administratora (wymagane do zapisu zmian)
                </label>
                <input
                  id="smtp-admin-current-password"
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

          {/* Sekcja testowej wiadomości SMTP */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div>
              <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                Test połączenia SMTP
              </h5>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Wysyła testową wiadomość używając aktualnie zapisanej konfiguracji SMTP (przed testem zapisz ewentualne zmiany powyżej).
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
              <div className="flex-1">
                <label htmlFor="smtp-test-recipient" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Adres e-mail odbiorcy testu
                </label>
                <input
                  id="smtp-test-recipient"
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  placeholder={currentUser?.email || 'admin@pracownia.pl'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                />
              </div>

              <button
                type="button"
                onClick={handleSendTestMail}
                disabled={isTesting || !data.smtp.configured}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-semibold border border-slate-700 transition-colors"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isTesting ? 'Wysyłanie...' : 'Wyślij wiadomość testową'}</span>
              </button>
            </div>

            {testError && (
              <div role="alert" className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{testError}</span>
              </div>
            )}

            {testSuccess && (
              <div role="status" className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{testSuccess}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SmtpTab;
