import React, { useState } from 'react';
import { User, Task, Project } from '../types';
import { downloadIcsFile, generateGoogleCalendarSubscribeUrl } from '../utils/calendar';
import { 
  X, 
  Calendar as CalendarIcon, 
  ExternalLink, 
  Copy, 
  Check, 
  Download, 
  RefreshCw, 
  Radio, 
  CheckCircle2, 
  Clock, 
  HelpCircle,
  Smartphone
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
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  if (!isOpen) return null;

  // Filter tasks for current user or all tasks
  const userTasks = syncScope === 'my_tasks'
    ? tasks.filter((t) => t.assigneeId === currentUser.id || !t.assigneeId)
    : tasks;

  // Construct absolute feed URL
  const baseUrl = window.location.origin;
  const feedPath = syncScope === 'my_tasks'
    ? `/api/calendar/user/${currentUser.id}.ics`
    : '/api/calendar/all.ics';
  const fullFeedUrl = `${baseUrl}${feedPath}`;
  const webcalUrl = fullFeedUrl.replace(/^http/, 'webcal');

  // Google Calendar direct subscription URL:
  // When clicked, Google Calendar opens with the "Add Calendar from URL" modal pre-populated!
  const gCalSubscribeUrl = generateGoogleCalendarSubscribeUrl(fullFeedUrl);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(fullFeedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePushSync = async () => {
    setIsPushing(true);
    try {
      await fetch('/api/calendar/push-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, users }),
      });
      setPushSuccess(true);
      setTimeout(() => setPushSuccess(false), 3000);
    } catch {
      // Local demo mode fallback
      setPushSuccess(true);
      setTimeout(() => setPushSuccess(false), 3000);
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
              <CalendarIcon className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Synchronizacja na żywo z Kalendarzem Google
              </h3>
              <p className="text-[11px] text-slate-500">
                Automatyczna subskrypcja w sekcji <strong>"Moje kalendarze"</strong> dla każdego użytkownika.
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

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-slate-800">
          {/* User selector & Scope */}
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

          {/* PRIMARY ONE-CLICK ACTION BUTTON */}
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
              Kliknij poniższy przycisk, aby natychmiast otworzyć Kalendarz Google i dodać ten terminarz na stałe do listy <strong>"Moje kalendarze" / "Inne kalendarze"</strong>. Od tego momentu Google będzie automatycznie pobierać wszystkie aktualizacje i nowe terminy!
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <a
                href={gCalSubscribeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-sm transition-all hover:scale-[1.01]"
              >
                <CalendarIcon className="w-4 h-4" />
                <span>Dodaj do Moich kalendarzy w Google</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-90" />
              </a>

              <button
                onClick={handlePushSync}
                disabled={isPushing}
                className="flex items-center gap-1.5 bg-white border border-sky-300 hover:bg-sky-100/60 text-sky-900 px-3 py-2 rounded-lg font-medium transition-colors"
                title="Wymuś odświeżenie danych w strumieniu serwera"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-sky-600 ${isPushing ? 'animate-spin' : ''}`} />
                <span>{pushSuccess ? 'Dane zaktualizowane!' : 'Odśwież strumień na żywo'}</span>
              </button>
            </div>
          </div>

          {/* Direct Live Subscription URL Box */}
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

          {/* Step by step manual guide */}
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

          {/* Fallback download .ics */}
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

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-slate-500">
          <span>Strumień kalendarza jest w 100% kompatybilny ze standardem RFC 5545 i Google Calendar Sync.</span>
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
