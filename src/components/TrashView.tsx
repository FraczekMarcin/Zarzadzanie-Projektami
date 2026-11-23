import React, { useEffect, useState, useRef } from 'react';
import {
  Trash2,
  RotateCcw,
  RefreshCw,
  CheckSquare,
  Briefcase,
  AlertCircle,
  AlertTriangle,
  MessageSquare,
  FolderKanban,
  Clock,
} from 'lucide-react';
import type { TrashEntrySummary, User } from '../types';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';

interface TrashViewProps {
  currentUser: User;
  onRestored: () => Promise<void> | void;
  onRetentionDaysLoaded?: (days: number) => void;
  onNotify: (msg: string, type?: 'success' | 'info' | 'error') => void;
}

export const TrashView: React.FC<TrashViewProps> = ({
  currentUser,
  onRestored,
  onRetentionDaysLoaded,
  onNotify,
}) => {
  const [items, setItems] = useState<TrashEntrySummary[]>([]);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState<boolean>(false);

  const [purgeTarget, setPurgeTarget] = useState<TrashEntrySummary | null>(null);
  const [isEmptyModalOpen, setIsEmptyModalOpen] = useState<boolean>(false);

  const purgeModalRef = useRef<HTMLDivElement>(null);
  const emptyModalRef = useRef<HTMLDivElement>(null);

  const { backdropProps: purgeBackdropProps } = useDismissOnOutsideClick({
    isOpen: Boolean(purgeTarget),
    mode: 'form',
    panelRef: purgeModalRef,
    onDismiss: () => setPurgeTarget(null),
  });

  const { backdropProps: emptyBackdropProps } = useDismissOnOutsideClick({
    isOpen: isEmptyModalOpen,
    mode: 'form',
    panelRef: emptyModalRef,
    onDismiss: () => setIsEmptyModalOpen(false),
    disabled: isEmptying,
  });

  useFocusTrap({
    isOpen: Boolean(purgeTarget),
    containerRef: purgeModalRef,
    onClose: () => setPurgeTarget(null),
  });

  useFocusTrap({
    isOpen: isEmptyModalOpen,
    containerRef: emptyModalRef,
    onClose: () => setIsEmptyModalOpen(false),
    disableEscape: isEmptying,
  });

  const loadTrash = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trash', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Nie udało się pobrać zawartości kosza.');
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      if (typeof data.retentionDays === 'number' && data.retentionDays > 0) {
        setRetentionDays(data.retentionDays);
        onRetentionDaysLoaded?.(data.retentionDays);
      }
    } catch (err: any) {
      setError(err?.message || 'Błąd połączenia z serwerem podczas pobierania kosza.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTrash();
  }, []);

  const handleRestore = async (item: TrashEntrySummary) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(item.id)}/restore`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || 'Nie udało się przywrócić elementu z kosza.';
        setError(msg);
        onNotify(msg, 'error');
        return;
      }
      onNotify(
        item.type === 'project'
          ? `Przywrócono projekt [${item.code}] "${item.title}" z kosza.`
          : `Przywrócono zadanie [${item.code}] "${item.title}" z kosza.`,
        'success'
      );
      await Promise.all([loadTrash(), Promise.resolve(onRestored())]);
    } catch (err: any) {
      const msg = err?.message || 'Błąd połączenia z serwerem podczas przywracania.';
      setError(msg);
      onNotify(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmPurge = async () => {
    if (!purgeTarget) return;
    const target = purgeTarget;
    setPurgeTarget(null);
    setBusyId(target.id);
    setError(null);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || 'Nie udało się trwale usunąć elementu z kosza.';
        setError(msg);
        onNotify(msg, 'error');
        return;
      }
      onNotify(`Trwale usunięto element [${target.code}] z kosza.`, 'info');
      await loadTrash();
    } catch (err: any) {
      const msg = err?.message || 'Błąd połączenia z serwerem.';
      setError(msg);
      onNotify(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmEmpty = async () => {
    setIsEmptyModalOpen(false);
    setIsEmptying(true);
    setError(null);
    try {
      const res = await fetch('/api/trash', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || 'Nie udało się opróżnić kosza.';
        setError(msg);
        onNotify(msg, 'error');
        return;
      }
      onNotify(
        `Opróżniono kosz (usunięto trwale ${typeof data.count === 'number' ? data.count : items.length} elementów).`,
        'info'
      );
      await loadTrash();
    } catch (err: any) {
      const msg = err?.message || 'Błąd połączenia z serwerem.';
      setError(msg);
      onNotify(msg, 'error');
    } finally {
      setIsEmptying(false);
    }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-slate-700 dark:text-slate-300" aria-hidden="true" />
            <span>Kosz usuniętych zadań i projektów</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold">
              {items.length}
            </span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Usunięte elementy pozostają w koszu przez <strong>{retentionDays} dni</strong> od momentu usunięcia i mogą zostać przywrócone wraz z komentarzami oraz zachowanymi zależnościami.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadTrash}
            disabled={isLoading || isEmptying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Odśwież</span>
          </button>

          {isAdmin && items.length > 0 && (
            <button
              type="button"
              onClick={() => setIsEmptyModalOpen(true)}
              disabled={isEmptying}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-600 disabled:opacity-60 rounded transition-colors shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Opróżnij kosz</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="p-12 bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl text-center space-y-2.5">
          <Trash2 className="w-9 h-9 text-slate-400 dark:text-slate-500 mx-auto" aria-hidden="true" />
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
            {isLoading ? 'Ładowanie kosza...' : 'Kosz jest pusty'}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            {currentUser?.role === 'viewer'
              ? 'Rola viewer (tylko do odczytu) nie ma dostępu do zawartości kosza ani jego przywracania.'
              : `Brak usuniętych zadań ani projektów możliwych do przywrócenia. Usunięte elementy są przechowywane przez ${retentionDays} dni.`}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Typ</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Tytuł i kod</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Projekt</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Usunął / Data</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold whitespace-nowrap">Pozostało</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((item) => {
                  const isBusy = busyId === item.id;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.type === 'project' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-semibold">
                            <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Projekt</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 font-semibold">
                            <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Zadanie</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            {item.code || '—'}
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {item.title}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                          {item.type === 'project' && (
                            <span className="inline-flex items-center gap-1">
                              <FolderKanban className="w-3 h-3" aria-hidden="true" />
                              <span>Zadań: {item.taskCount}</span>
                            </span>
                          )}
                          {item.commentCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" aria-hidden="true" />
                              <span>Komentarzy: {item.commentCount}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                        <span className="font-mono font-semibold text-slate-600 dark:text-slate-400 mr-1">
                          [{item.projectKey}]
                        </span>
                        <span>{item.projectName}</span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {item.deletedByName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {new Date(item.deletedAt).toLocaleString('pl-PL')}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-mono font-semibold ${
                            item.daysRemaining <= 3
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{item.daysRemaining} dni</span>
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {item.canRestore && (
                            <button
                              type="button"
                              onClick={() => handleRestore(item)}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white font-semibold transition-colors shadow-2xs"
                            >
                              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{isBusy ? 'Przetwarzanie...' : 'Przywróć'}</span>
                            </button>
                          )}

                          {item.canPurge && (
                            <button
                              type="button"
                              onClick={() => setPurgeTarget(item)}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-semibold transition-colors disabled:opacity-60"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Usuń trwale</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal potwierdzenia trwałego usunięcia pojedynczego elementu */}
      {purgeTarget && (
        <div
          className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purge-trash-modal-title"
          {...purgeBackdropProps}
        >
          <div
            ref={purgeModalRef}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-3"
          >
            <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3 id="purge-trash-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Trwałe usunięcie z kosza
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Czy na pewno chcesz trwale i bezpowrotnie usunąć element{' '}
              <strong>
                [{purgeTarget.code}] {purgeTarget.title}
              </strong>{' '}
              z kosza? Tej operacji nie można cofnąć.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPurgeTarget(null)}
                className="px-3 py-1.5 rounded text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleConfirmPurge}
                className="px-3.5 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold shadow-xs"
              >
                Tak, usuń trwale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal potwierdzenia opróżnienia całego kosza */}
      {isEmptyModalOpen && (
        <div
          className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="empty-trash-modal-title"
          {...emptyBackdropProps}
        >
          <div
            ref={emptyModalRef}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-3"
          >
            <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3 id="empty-trash-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Opróżnienie całego kosza
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Czy na pewno chcesz trwale usunąć wszystkie elementy znajdujące się obecnie w koszu ({items.length})? Wszystkie zapisane zadania, projekty i komentarze zostaną bezpowrotnie usunięte.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEmptyModalOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleConfirmEmpty}
                className="px-3.5 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold shadow-xs"
              >
                Tak, opróżnij kosz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrashView;
