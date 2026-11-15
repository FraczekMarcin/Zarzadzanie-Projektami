import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Cloud,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { User } from '../../types';

export interface CalendarTabProps {
  isOpen: boolean;
  currentUser: User | null;
  copiedKey: string | null;
  onCopyCode: (text: string, key: string) => void;
  onClose: () => void;
  onOpenCalendarSyncModal?: () => void;
}

export const CalendarTab: React.FC<CalendarTabProps> = ({
  isOpen,
  currentUser,
  copiedKey,
  onCopyCode,
  onClose,
  onOpenCalendarSyncModal,
}) => {
  const [googleSyncStatus, setGoogleSyncStatus] = useState<{
    enabled: boolean;
    running: boolean;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    counts: { created: number; updated: number; deleted: number } | null;
    lastError: string | null;
  } | null>(null);
  const [isLoadingGoogleSync, setIsLoadingGoogleSync] = useState(false);
  const [isTriggeringGoogleSync, setIsTriggeringGoogleSync] = useState(false);
  const [googleSyncActionMessage, setGoogleSyncActionMessage] = useState<string | null>(null);
  const [googleSyncActionError, setGoogleSyncActionError] = useState<string | null>(null);

  const loadGoogleSyncStatus = async () => {
    if (currentUser?.role !== 'admin') return;
    setIsLoadingGoogleSync(true);
    try {
      const res = await fetch('/api/google-sync/status', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setGoogleSyncStatus(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setGoogleSyncActionError(errData.error || 'Błąd pobierania statusu synchronizacji Google Calendar');
      }
    } catch (err: any) {
      setGoogleSyncActionError(err.message || 'Błąd połączenia z serwerem');
    } finally {
      setIsLoadingGoogleSync(false);
    }
  };

  const handleTriggerGoogleSync = async () => {
    if (currentUser?.role !== 'admin') return;
    setIsTriggeringGoogleSync(true);
    setGoogleSyncActionMessage(null);
    setGoogleSyncActionError(null);
    try {
      const res = await fetch('/api/google-sync/run', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleSyncActionError(data.error || 'Nie udało się uruchomić synchronizacji.');
      } else {
        if (data.status) {
          setGoogleSyncStatus(data.status);
        }
        setGoogleSyncActionMessage(data.message || 'Uruchomiono synchronizację z Kalendarzem Google.');
        setTimeout(() => {
          void loadGoogleSyncStatus();
        }, 700);
      }
    } catch (err: any) {
      setGoogleSyncActionError(err.message || 'Błąd połączenia z serwerem');
    } finally {
      setIsTriggeringGoogleSync(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentUser?.role === 'admin') {
      void loadGoogleSyncStatus();
    }
  }, [isOpen]);

  const hostAddress = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  const allCalendarUrl = `${protocol}//${hostAddress}/api/calendar/all.ics`;
  const userCalendarUrl = `${protocol}//${hostAddress}/api/calendar/user/${currentUser?.id || 'usr-1'}.ics`;

  return (
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
                onClick={() => onCopyCode(allCalendarUrl, 'cal-all')}
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
                onClick={() => onCopyCode(userCalendarUrl, 'cal-user')}
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
          {onOpenCalendarSyncModal && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCalendarSyncModal();
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <CalendarIcon className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Konfiguracja subskrypcji iCal i tokenu</span>
            </button>
          )}
        </div>

        <div className="p-3 bg-white/70 dark:bg-slate-900/70 rounded-lg border border-sky-100 dark:border-sky-900/50 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
          <div className="font-semibold text-slate-800 dark:text-slate-200">Instrukcja krok po kroku:</div>
          <div>1. Skopiuj powyższy link (Wszystkie zadania lub Moje zadania).</div>
          <div>2. Kliknij przycisk „Otwórz Google Calendar (+ Z adresu URL)”.</div>
          <div>3. Wklej skopiowany link w polu „URL kalendarza” i kliknij „Dodaj kalendarz”. Gotowe!</div>
        </div>
      </div>

      {currentUser?.role === 'admin' && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h5 className="font-bold text-sm text-slate-900 dark:text-white">
                  Synchronizacja z Kalendarzem Google
                </h5>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    googleSyncStatus?.enabled
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {isLoadingGoogleSync && !googleSyncStatus
                    ? 'Sprawdzanie...'
                    : googleSyncStatus?.enabled
                    ? googleSyncStatus.running
                      ? 'Włączona (trwa synchronizacja)'
                      : 'Włączona'
                    : 'Wyłączona'}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Opcjonalna, jednokierunkowa synchronizacja zadań (aplikacja ➔ wspólny Kalendarz Google) przez konto usługi (Service Account).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadGoogleSyncStatus()}
                disabled={isLoadingGoogleSync}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGoogleSync ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Odśwież status</span>
              </button>
              <button
                type="button"
                onClick={() => void handleTriggerGoogleSync()}
                disabled={!googleSyncStatus?.enabled || googleSyncStatus?.running || isTriggeringGoogleSync}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isTriggeringGoogleSync || googleSyncStatus?.running ? 'Synchronizowanie...' : 'Synchronizuj teraz'}</span>
              </button>
            </div>
          </div>

          {googleSyncActionMessage && (
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{googleSyncActionMessage}</span>
            </div>
          )}

          {(googleSyncActionError || googleSyncStatus?.lastError) && (
            <div role="alert" className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{googleSyncActionError || googleSyncStatus?.lastError}</span>
            </div>
          )}

          {googleSyncStatus?.enabled ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Ostatnia synchronizacja</div>
                <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
                  {googleSyncStatus.lastSyncAt
                    ? new Date(googleSyncStatus.lastSyncAt).toLocaleString('pl-PL')
                    : 'Jeszcze nie uruchomiono'}
                </div>
                {googleSyncStatus.lastSuccessAt && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Ostatni sukces: {new Date(googleSyncStatus.lastSuccessAt).toLocaleString('pl-PL')}
                  </div>
                )}
              </div>

              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Liczniki ostatniego przebiegu</div>
                {googleSyncStatus.counts ? (
                  <div className="flex flex-wrap gap-3 mt-1 font-semibold text-slate-900 dark:text-white">
                    <span>Utworzone: {googleSyncStatus.counts.created}</span>
                    <span>Zmienione: {googleSyncStatus.counts.updated}</span>
                    <span>Usunięte: {googleSyncStatus.counts.deleted}</span>
                  </div>
                ) : (
                  <div className="text-slate-600 dark:text-slate-400 mt-1">Brak danych z przebiegu</div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
              <div className="font-semibold text-slate-800 dark:text-slate-100">
                Jak włączyć synchronizację po stronie serwera:
              </div>
              <div>1. W Google Cloud Console utwórz projekt, włącz API <strong className="font-mono">Google Calendar API</strong> oraz utwórz konto usługi (Service Account) z kluczem JSON.</div>
              <div>2. Zapisz pobrany klucz w <code className="font-mono">secrets/google_sa.json</code> na serwerze (<code className="font-mono">chmod 600</code>).</div>
              <div>3. Udostępnij wybrany Kalendarz Google adresowi e-mail konta usługi z uprawnieniem <strong className="font-semibold">Wprowadzanie zmian w wydarzeniach</strong>.</div>
              <div>4. Ustaw w <code className="font-mono">.env</code> zmienne <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_FILE=/run/secrets/google_sa.json</code>, <code className="font-mono">GOOGLE_CALENDAR_ID</code> oraz <code className="font-mono">COMPOSE_FILE=docker-compose.yml:docker-compose.google.yml</code>, a następnie wykonaj <code className="font-mono">docker compose up -d</code>.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CalendarTab;
