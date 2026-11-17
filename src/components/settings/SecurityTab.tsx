import React, { useState, useEffect } from 'react';
import { Shield, Filter, RefreshCw, AlertCircle } from 'lucide-react';
import type { User } from '../../types';
import type { SecurityEvent, SecurityEventType } from '../../utils/securityLog';

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
  google_sync_started: 'Rozpoczęcie synchronizacji Google Calendar',
  google_sync_completed: 'Zakończenie synchronizacji Google Calendar',
  google_sync_failed: 'Błąd synchronizacji Google Calendar',
  backup_stale: 'Brak świeżej kopii zapasowej',
  backup_recovered: 'Kopia zapasowa znów aktualna',
  settings_changed: 'Zmiana ustawień administratora',
  smtp_test_sent: 'Wysłano wiadomość testową SMTP',
  smtp_test_failed: 'Błąd wysyłki testowej SMTP',
  trash_restored: 'Przywrócenie elementu z kosza',
  trash_purged: 'Trwałe usunięcie elementu z kosza',
  trash_emptied: 'Opróżnienie kosza',
  reminders_sent: 'Wysłano dzienne przypomnienia o terminach',
  reminders_failed: 'Błąd wysyłki dziennych przypomnień o terminach',
  disk_low: 'Mało miejsca na dysku serwera',
  disk_recovered: 'Miejsce na dysku znów wystarczające',
  disk_write_failed: 'Błąd zapisu stanu (brak miejsca na dysku)',
};

export interface SecurityTabProps {
  isOpen: boolean;
  users: User[];
  currentUser: User | null;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({ isOpen, users, currentUser }) => {
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
    if (isOpen) {
      loadSecurityEvents();
    }
  }, [isOpen, securityFilterType]);

  return (
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
                  const isFailure =
                    ev.type === 'login_failure' ||
                    ev.type === 'origin_blocked' ||
                    ev.type === 'google_sync_failed' ||
                    ev.type === 'smtp_test_failed' ||
                    ev.type === 'disk_low' ||
                    ev.type === 'disk_write_failed';
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
                              : ev.type === 'login_success' ||
                                ev.type === 'twofa_enabled' ||
                                ev.type === 'user_approved' ||
                                ev.type === 'google_sync_completed' ||
                                ev.type === 'smtp_test_sent' ||
                                ev.type === 'disk_recovered'
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
  );
};

export default SecurityTab;
