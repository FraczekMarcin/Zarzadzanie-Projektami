import React, { useState, useEffect } from 'react';
import { User, Task, Project } from '../types';
import { downloadIcsFile, generateGoogleCalendarSubscribeUrl } from '../utils/calendar';
import { copyToClipboard } from '../utils/clipboard';
import { 
  X, 
  Calendar as CalendarIcon, 
  ExternalLink, 
  Copy, 
  Check, 
  Download, 
  CheckCircle2, 
  ShieldCheck,
  Key,
  Trash2,
  AlertTriangle,
  Lock,
  RefreshCw
} from 'lucide-react';

interface GoogleCalendarSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  tasks: Task[];
  projects: Project[];
  onSwitchUser: (user: User) => void;
}

export const GoogleCalendarSyncModal: React.FC<GoogleCalendarSyncModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users,
  tasks,
  projects: _projects,
  onSwitchUser,
}) => {
  const [copied, setCopied] = useState(false);
  const [syncScope, setSyncScope] = useState<'my_tasks' | 'all_tasks'>('my_tasks');
  const [token, setToken] = useState<string | null>(null);
  const [hasServerToken, setHasServerToken] = useState<boolean>(Boolean(currentUser.hasCalendarToken));
  const [tokenCreatedAt, setTokenCreatedAt] = useState<string | null>(currentUser.calendarTokenCreatedAt || null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sprawdzanie tokenu po otwarciu modalu
  useEffect(() => {
    if (!isOpen) return;

    const storageKey = `oph_calendar_token_${currentUser.id}`;
    const savedToken = localStorage.getItem(storageKey);
    if (savedToken) {
      setToken(savedToken);
    }

    const checkServerToken = async () => {
      setIsLoadingToken(true);
      setError(null);
      try {
        const res = await fetch('/api/calendar/token', {
          headers: { credentials: 'include' },
        });
        if (res.ok) {
          const data = await res.json();
          setHasServerToken(Boolean(data.hasToken));
          setTokenCreatedAt(data.createdAt || null);
          if (!data.hasToken) {
            setToken(null);
            localStorage.removeItem(storageKey);
          }
        }
      } catch (err: any) {
        console.error('Błąd pobierania statusu tokenu kalendarza:', err);
      } finally {
        setIsLoadingToken(false);
      }
    };

    checkServerToken();
  }, [isOpen, currentUser.id]);

  if (!isOpen) return null;

  // Filtrowanie zadań
  const userTasks = syncScope === 'my_tasks'
    ? tasks.filter((t) => t.assigneeId === currentUser.id || !t.assigneeId)
    : tasks;

  const baseUrl = window.location.origin;
  const feedPath = token
    ? (syncScope === 'my_tasks'
        ? `/api/calendar/${token}/user/${currentUser.id}.ics`
        : `/api/calendar/${token}/all.ics`)
    : '';
  const fullFeedUrl = token ? `${baseUrl}${feedPath}` : '';
  const gCalSubscribeUrl = token ? generateGoogleCalendarSubscribeUrl(fullFeedUrl) : '';

  const handleCopyLink = async () => {
    if (!fullFeedUrl) return;
    const success = await copyToClipboard(fullFeedUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleGenerateToken = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/calendar/token/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nie udało się wygenerować tokenu kalendarza.');
      }
      setToken(data.token);
      setHasServerToken(true);
      setTokenCreatedAt(data.createdAt);
      localStorage.setItem(`oph_calendar_token_${currentUser.id}`, data.token);
    } catch (err: any) {
      setError(err.message || 'Błąd sieci podczas generowania tokenu');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!window.confirm('Czy na pewno chcesz odwołać token kalendarza? Subskrypcje w Kalendarzu Google przestaną działać do momentu wygenerowania nowego tokenu.')) {
      return;
    }
    setIsRevoking(true);
    setError(null);
    try {
      const res = await fetch('/api/calendar/token', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nie udało się odwołać tokenu.');
      }
      setToken(null);
      setHasServerToken(false);
      setTokenCreatedAt(null);
      localStorage.removeItem(`oph_calendar_token_${currentUser.id}`);
    } catch (err: any) {
      setError(err.message || 'Błąd sieci podczas odwoływania tokenu');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 text-xs">
        {/* Nagłówek */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
              <CalendarIcon className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Prywatna synchronizacja z Kalendarzem Google (RFC 5545)
              </h3>
              <p className="text-[11px] text-slate-500">
                Bezpieczny strumień iCal chroniony unikalnym tokenem kryptograficznym.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Zawartość */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-slate-800">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Przełącznik użytkownika i zakres */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">
                Synchronizacja dla użytkownika:
              </span>
              <select
                value={currentUser.id}
                onChange={(e) => {
                  const u = users.find((item) => item.id === e.target.value);
                  if (u) onSwitchUser(u);
                }}
                className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role}) — {u.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input
                  type="radio"
                  name="scope"
                  checked={syncScope === 'my_tasks'}
                  onChange={() => setSyncScope('my_tasks')}
                  className="text-sky-600 focus:ring-0"
                />
                <span className="font-medium">Tylko moje zadania ({userTasks.length})</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input
                  type="radio"
                  name="scope"
                  checked={syncScope === 'all_tasks'}
                  onChange={() => setSyncScope('all_tasks')}
                  className="text-sky-600 focus:ring-0"
                />
                <span className="font-medium">Wszystkie zadania ({tasks.length})</span>
              </label>
            </div>
          </div>

          {/* Sekcja Bezpieczeństwa / Tokenu */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="font-bold text-slate-900">Uwierzytelnianie feedu kalendarza</span>
              </div>
              {hasServerToken ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
                  <Check className="w-3 h-3" /> Token aktywny
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
                  <Lock className="w-3 h-3" /> Brak tokenu
                </span>
              )}
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Feedy kalendarza są chronione unikalnym tokenem URL. Serwer przechowuje wyłącznie skrót kryptograficzny (SHA-256) tokenu. 
              {tokenCreatedAt && ` Aktywny token utworzono: ${new Date(tokenCreatedAt).toLocaleString('pl-PL')}.`}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={handleGenerateToken}
                disabled={isGenerating}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm disabled:opacity-60"
              >
                {isGenerating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Key className="w-3.5 h-3.5" />
                )}
                <span>{hasServerToken ? 'Wygeneruj nowy token (zastąp obecny)' : 'Wygeneruj prywatny link subskrypcji'}</span>
              </button>

              {hasServerToken && (
                <button
                  onClick={handleRevokeToken}
                  disabled={isRevoking}
                  className="flex items-center gap-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Odwołaj token</span>
                </button>
              )}
            </div>
          </div>

          {/* Sekcja gdy token jest dostępny */}
          {token ? (
            <>
              {/* Przycisk 1-Click do Google Calendar */}
              <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sky-950 text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-600" />
                    <span>Dodaj jednym kliknięciem do Google Calendar</span>
                  </span>
                  <span className="text-[11px] font-mono text-sky-700 bg-sky-100/80 px-2 py-0.5 rounded font-bold">
                    1-Click Setup
                  </span>
                </div>

                <p className="text-sky-900 leading-relaxed text-xs">
                  Kliknij poniższy przycisk, aby otworzyć Kalendarz Google i dodać ten terminarz na stałe do listy <strong>"Inne kalendarze"</strong>. Kalendarz Google będzie automatycznie pobierać wszystkie aktualizacje i nowe terminy!
                </p>

                <div className="pt-1">
                  <a
                    href={gCalSubscribeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-sm transition-all hover:scale-[1.01]"
                  >
                    <CalendarIcon className="w-4 h-4" />
                    <span>Dodaj do Kalendarza Google</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-90" />
                  </a>
                </div>
              </div>

              {/* Pole z bezpośrednim URL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700">
                    Prywatny adres URL strumienia na żywo (RFC 5545 WebCal):
                  </label>
                  <span className="text-slate-400 text-[10px]">Częstotliwość odświeżania: co 15 minut</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={fullFeedUrl}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs font-mono text-slate-700 select-all focus:outline-none"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded text-xs font-medium transition-colors shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Skopiowano!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Kopiuj link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Instrukcja ręcznego dodania */}
              <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 space-y-2">
                <span className="font-bold text-slate-900 block text-xs">
                  Jak dodać ten link ręcznie w Kalendarzu Google na komputerze lub telefonie:
                </span>

                <ol className="list-decimal list-inside space-y-1.5 text-slate-600 text-[11px] leading-relaxed">
                  <li>
                    Wejdź na stronę <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline font-medium">calendar.google.com</a>.
                  </li>
                  <li>
                    W lewym panelu bocznym znajdź sekcję <strong>"Inne kalendarze"</strong> i kliknij znak <strong>+</strong>.
                  </li>
                  <li>
                    Wybierz opcję <strong>"Z adresu URL"</strong> (From URL).
                  </li>
                  <li>
                    Wklej powyższy skopiowany link i kliknij <strong>"Dodaj kalendarz"</strong>.
                  </li>
                  <li>
                    Kalendarz pojawi się na liście Twoich kalendarzy, również w aplikacji mobilnej Google Calendar na smartfonie z Androidem / iPhone!
                  </li>
                </ol>
              </div>
            </>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-900">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Wymagany unikalny token subskrypcji</span>
              </div>
              <p className="text-xs leading-relaxed text-amber-800">
                {hasServerToken
                  ? 'Posiadasz aktywny token na serwerze, ale nie jest on zapisany w pamięci tej przeglądarki. Kliknij przycisk „Wygeneruj nowy token”, aby utworzyć nowy unikalny adres URL.'
                  : 'Aby zsynchronizować terminarz z Kalendarzem Google lub Apple Calendar, wygeneruj swój prywatny token subskrypcji za pomocą powyższego przycisku.'}
              </p>
            </div>
          )}

          {/* Opcja pobrania pliku offline */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-slate-500">
            <span>Potrzebujesz jednorazowego pliku bez subskrypcji?</span>
            <button
              onClick={() =>
                downloadIcsFile(
                  userTasks,
                  `${currentUser.name.replace(/\s+/g, '_')}_zadania.ics`,
                  `Zadania: ${currentUser.name}`
                )
              }
              className="flex items-center gap-1 text-slate-700 hover:text-sky-600 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Pobierz plik .ics offline</span>
            </button>
          </div>
        </div>

        {/* Stopka */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-slate-500">
          <span>Strumień jest w 100% zgodny ze standardem RFC 5545 i Google Calendar.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors font-medium"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
