import React, { useState, useEffect, useId, useRef } from 'react';
import { User, Task, Project } from '../types';
import { downloadIcsFile, generateGoogleCalendarSubscribeUrl, isPrivateOrLocalUrl } from '../utils/calendar';
import { copyToClipboard } from '../utils/clipboard';
import { useFocusTrap } from '../utils/useFocusTrap';
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
  projects,
  onSwitchUser,
}) => {
  const [copied, setCopied] = useState(false);
  const [syncScope, setSyncScope] = useState<'my_tasks' | 'all_tasks'>('my_tasks');
  const [token, setToken] = useState<string | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState<string | null>(null);
  const [hasServerToken, setHasServerToken] = useState<boolean>(Boolean(currentUser.hasCalendarToken));
  const [tokenCreatedAt, setTokenCreatedAt] = useState<string | null>(currentUser.calendarTokenCreatedAt || null);
  const [_isLoadingToken, setIsLoadingToken] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const userSelectId = useId();
  const feedUrlInputId = useId();

  useFocusTrap({ isOpen, onClose, containerRef });

  // Sprawdzanie tokenu po otwarciu modalu
  useEffect(() => {
    if (!isOpen) return;

    const checkServerToken = async () => {
      setIsLoadingToken(true);
      setError(null);
      try {
        const res = await fetch('/api/calendar/token', {
          credentials: 'same-origin',
        });
        if (res.ok) {
          const data = await res.json();
          setHasServerToken(Boolean(data.hasToken));
          setTokenCreatedAt(data.createdAt || null);
          setPublicBaseUrl(data.publicBaseUrl || null);
          if (!data.hasToken) {
            setToken(null);
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

  const baseUrl = (publicBaseUrl || window.location.origin).replace(/\/+$/, '');
  const isLocalOnly = isPrivateOrLocalUrl(baseUrl);
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
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nie udało się wygenerować tokenu kalendarza.');
      }
      setToken(data.token);
      setHasServerToken(true);
      setTokenCreatedAt(data.createdAt);
      if (data.publicBaseUrl !== undefined) {
        setPublicBaseUrl(data.publicBaseUrl || null);
      }
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
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nie udało się odwołać tokenu.');
      }
      setToken(null);
      setHasServerToken(false);
      setTokenCreatedAt(null);
    } catch (err: any) {
      setError(err.message || 'Błąd sieci podczas odwoływania tokenu');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 text-xs"
      >
        {/* Nagłówek */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
              <CalendarIcon className="w-5 h-5 text-sky-700" aria-hidden="true" />
            </div>
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900">
                Prywatna synchronizacja z kalendarzami (RFC 5545)
              </h3>
              <p className="text-[11px] text-slate-600">
                Prywatny feed iCalendar chroniony unikalnym tokenem kryptograficznym.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno synchronizacji z Kalendarzem Google"
            className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Zawartość */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-slate-800">
          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Przełącznik użytkownika i zakres */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <div>
              <label htmlFor={userSelectId} className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide block mb-1">
                Synchronizacja dla użytkownika:
              </label>
              <select
                id={userSelectId}
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

            <div className="flex items-center gap-3" role="radiogroup" aria-label="Zakres synchronizacji zadań">
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
                <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span className="font-bold text-slate-900">Uwierzytelnianie feedu kalendarza</span>
              </div>
              {hasServerToken ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
                  <Check className="w-3 h-3" aria-hidden="true" /> Token aktywny
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
                  <Lock className="w-3 h-3" aria-hidden="true" /> Brak tokenu
                </span>
              )}
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Feedy kalendarza są chronione unikalnym tokenem URL. Serwer przechowuje wyłącznie skrót kryptograficzny (SHA-256) tokenu. 
              {tokenCreatedAt && ` Aktywny token utworzono: ${new Date(tokenCreatedAt).toLocaleString('pl-PL')}.`}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleGenerateToken}
                disabled={isGenerating}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm disabled:opacity-60"
              >
                {isGenerating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Key className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{hasServerToken ? 'Wygeneruj nowy token (zastąp obecny)' : 'Wygeneruj prywatny link subskrypcji'}</span>
              </button>

              {hasServerToken && (
                <button
                  type="button"
                  onClick={handleRevokeToken}
                  disabled={isRevoking}
                  className="flex items-center gap-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Odwołaj token</span>
                </button>
              )}
            </div>
          </div>

          {/* Sekcja gdy token jest dostępny */}
          {token ? (
            <>
              {isLocalOnly && (
                <div role="alert" className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                    <span>Adres niedostępny z internetu</span>
                  </div>
                  <p className="text-xs leading-relaxed text-amber-900">
                    Ten adres jest dostępny tylko w Twojej sieci. Kalendarz Google pobiera dane z własnych serwerów i go nie otworzy. Użyj subskrypcji w Apple Calendar, Outlooku lub Thunderbirdzie albo jednorazowo pobierz plik .ics i zaimportuj go w Kalendarzu Google.
                  </p>
                </div>
              )}

              {/* Przycisk 1-Click do Google Calendar */}
              <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sky-950 text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-700" aria-hidden="true" />
                    <span>Dodaj jednym kliknięciem do Google Calendar</span>
                  </span>
                  <span className="text-[11px] font-mono text-sky-800 bg-sky-100/80 px-2 py-0.5 rounded font-bold">
                    1-Click Setup
                  </span>
                </div>

                <p className="text-sky-900 leading-relaxed text-xs">
                  Kliknij poniższy przycisk (wymaga publicznego adresu HTTPS), aby otworzyć Kalendarz Google i dodać terminarz na stałe do listy <strong>„Inne kalendarze”</strong>.
                </p>

                <div className="pt-1">
                  {isLocalOnly ? (
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title="Niedostępne dla adresów lokalnych lub HTTP — Kalendarz Google wymaga publicznego adresu HTTPS"
                      className="inline-flex items-center gap-2 bg-slate-300 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-lg cursor-not-allowed"
                    >
                      <CalendarIcon className="w-4 h-4" aria-hidden="true" />
                      <span>Dodaj do Kalendarza Google</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                    </button>
                  ) : (
                    <a
                      href={gCalSubscribeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-sm transition-all hover:scale-[1.01]"
                    >
                      <CalendarIcon className="w-4 h-4" aria-hidden="true" />
                      <span>Dodaj do Kalendarza Google</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-90" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>

              {/* Pole z bezpośrednim URL */}
              <div className="space-y-1.5">
                <label htmlFor={feedUrlInputId} className="font-semibold text-slate-700 block">
                  Prywatny adres URL feedu iCalendar (RFC 5545):
                </label>

                <div className="flex items-center gap-2">
                  <input
                    id={feedUrlInputId}
                    type="text"
                    readOnly
                    value={fullFeedUrl}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs font-mono text-slate-700 select-all focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded text-xs font-medium transition-colors shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                        <span className="text-emerald-400">Skopiowano!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Kopiuj link</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Kalendarz Google odświeża subskrybowane kalendarze samodzielnie, zwykle co kilka do kilkunastu godzin; Apple Calendar, Outlook i Thunderbird odświeżają co kilkanaście minut.
                </p>
              </div>

              {/* Instrukcje subskrypcji w klientach kalendarza */}
              <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 space-y-3">
                <div>
                  <span className="font-bold text-slate-900 block text-xs mb-1.5">
                    Jak zasubskrybować link w programach kalendarza:
                  </span>
                  <ul className="space-y-1.5 text-slate-700 text-[11px] leading-relaxed">
                    <li>
                      <strong>Apple Calendar (macOS):</strong>{' '}
                      <strong>Plik &gt; Nowa subskrypcja kalendarza</strong>, wklej skopiowany adres URL i ustaw częstotliwość automatycznego odświeżania (np. co 15 minut).
                    </li>
                    <li>
                      <strong>Microsoft Outlook:</strong>{' '}
                      W Outlooku wybierz <strong>Dodaj kalendarz &gt; Subskrybuj z internetu</strong> (Outlook Web / Nowy Outlook) lub{' '}
                      <strong>Plik &gt; Ustawienia kont &gt; Kalendarze internetowe &gt; Nowy</strong> (klasyczny Outlook) i wklej link.
                    </li>
                    <li>
                      <strong>Mozilla Thunderbird:</strong>{' '}
                      Otwórz zakładkę <strong>Kalendarz &gt; Nowy kalendarz &gt; W sieci</strong>, wybierz format <strong>iCalendar (ICS)</strong> i wklej adres URL w polu Położenie.
                    </li>
                    {!isLocalOnly && (
                      <li>
                        <strong>Kalendarz Google (ręcznie):</strong>{' '}
                        Na <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-sky-700 underline font-medium">calendar.google.com</a> w sekcji <strong>„Inne kalendarze”</strong> kliknij <strong>+ &gt; Z adresu URL</strong> i wklej link.
                      </li>
                    )}
                  </ul>
                </div>

                <p className="text-[11px] text-slate-600 border-t border-slate-200 pt-2 leading-relaxed">
                  <strong>Uwaga dotycząca HTTPS z certyfikatem lokalnym:</strong> gdy serwer działa przez HTTPS z lokalnym certyfikatem (np. Caddy w sieci wewnętrznej), Apple Calendar i Outlook wymagają zainstalowania certyfikatu głównego (Root CA) na tym urządzeniu.
                </p>
              </div>
            </>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-900">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden="true" />
                <span>Wymagany unikalny token subskrypcji</span>
              </div>
              <p className="text-xs leading-relaxed text-amber-800">
                {hasServerToken
                  ? 'Posiadasz aktywny token na serwerze, ale nie jest on zapisany w pamięci tej przeglądarki. Kliknij przycisk „Wygeneruj nowy token”, aby utworzyć nowy unikalny adres URL.'
                  : 'Aby zasubskrybować terminarz w Apple Calendar, Outlooku, Thunderbirdzie lub Kalendarzu Google, wygeneruj swój prywatny token subskrypcji za pomocą powyższego przycisku.'}
              </p>
            </div>
          )}

          {/* Opcja pobrania i jednorazowego importu pliku .ics */}
          <div className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/70 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-700">
              <span className="font-semibold text-xs">Jednorazowy eksport i import pliku .ics (bez subskrypcji):</span>
              <button
                type="button"
                onClick={() =>
                  downloadIcsFile(
                    userTasks,
                    `${currentUser.name.replace(/\s+/g, '_')}_zadania.ics`,
                    `Zadania: ${currentUser.name}`,
                    projects
                  )
                }
                className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-sky-400 text-slate-800 hover:text-sky-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Pobierz plik .ics offline</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              <strong>Import pliku .ics w Kalendarzu Google:</strong> pobierz plik powyżej, otwórz <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-sky-700 underline font-medium">calendar.google.com</a>, przejdź do <strong>Ustawienia &gt; Importuj i eksportuj</strong>, wybierz pobrany plik <code>.ics</code> oraz kalendarz docelowy i kliknij <strong>Importuj</strong>.
            </p>
          </div>
        </div>

        {/* Stopka */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-slate-600">
          <span>Format iCalendar zgodny ze standardem RFC 5545.</span>
          <button
            type="button"
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
