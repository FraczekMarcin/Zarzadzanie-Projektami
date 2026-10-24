import React, { useState } from 'react';
import { Task, Project, User, Priority, TaskStatus } from '../types';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../utils/calendar';
import { 
  X, 
  Calendar, 
  ExternalLink, 
  Download, 
  Clock, 
  User as UserIcon, 
  CheckCircle2, 
  AlertTriangle, 
  Diamond, 
  Bug, 
  Sparkles, 
  Layers, 
  Edit3, 
  MessageSquare, 
  Send,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Flame,
  GitMerge,
  Tag,
  Lock,
  ShieldAlert
} from 'lucide-react';
import { getBusinessDaysRemaining, isApproachingOfficialDeadline } from '../utils/businessDays';

interface TaskDetailDrawerProps {
  task: Task | null;
  projects?: Project[];
  users?: User[];
  allTasks?: Task[];
  currentUser: User;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onNavigateToTask?: (task: Task) => void;
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateProgress: (taskId: string, progress: number) => void;
  onAddComment: (taskId: string, text: string) => void;
  comments?: { id: string; taskId: string; userId: string; content: string; createdAt: string }[];
}

export const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  projects = [],
  users = [],
  allTasks = [],
  currentUser,
  onClose,
  onEdit,
  onNavigateToTask,
  onUpdateStatus,
  onUpdateProgress,
  onAddComment,
  comments = [],
}) => {
  const [commentText, setCommentText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!task) return null;

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeUsers = Array.isArray(users) ? users : [];
  const safeAllTasks = Array.isArray(allTasks) ? allTasks : [];
  const safeComments = Array.isArray(comments) ? comments : [];

  const project = safeProjects.find((p) => p.id === task.projectId);
  const assignee = safeUsers.find((u) => u.id === task.assigneeId);
  const reporter = safeUsers.find((u) => u.id === task.reporterId);
  const taskComments = safeComments.filter((c) => c && c.taskId === task.id);
  const gCalUrl = generateGoogleCalendarUrl(task, project);

  // Blocker dependencies analysis
  const blockerIds = task.blockingTaskIds || task.dependencies || [];
  const blockingTasks = safeAllTasks.filter((t) => blockerIds.includes(t.id));
  const unfinishedBlockers = blockingTasks.filter((t) => t.status !== 'done');
  const isBlockedByDependencies = unfinishedBlockers.length > 0;

  // Tasks that this task blocks
  const tasksBlockedByThis = safeAllTasks.filter((t) => {
    const bIds = t.blockingTaskIds || t.dependencies || [];
    return bIds.includes(task.id);
  });

  // Parent and Subtasks (Drzewo zależności)
  const parentTask = task.parentId ? safeAllTasks.find((t) => t.id === task.parentId) : null;
  const subtasks = safeAllTasks.filter((t) => t.parentId === task.id);

  const handleStatusChange = (newStatus: TaskStatus) => {
    setErrorMessage(null);
    if ((newStatus === 'in_progress' || newStatus === 'done' || newStatus === 'review') && isBlockedByDependencies) {
      setErrorMessage(
        `Nie można zmienić statusu na "${newStatus}". To zadanie jest zablokowane przez: ${unfinishedBlockers
          .map((b) => b.code)
          .join(', ')}. Ukończ najpierw zadania blokujące!`
      );
      return;
    }
    onUpdateStatus(task.id, newStatus);
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    onAddComment(task.id, commentText);
    setCommentText('');
  };

  const getPriorityBadge = (priority?: Priority | string) => {
    switch (priority) {
      case 'critical':
        return <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">Krytyczny (P1)</span>;
      case 'high':
        return <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Wysoki (P2)</span>;
      case 'normal':
      case 'medium':
        return <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">Normalny (P3)</span>;
      case 'low':
        return <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">Niski (P4)</span>;
      default:
        return <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">Normalny</span>;
    }
  };

  const safeCreatedAtDate = task.createdAt && task.createdAt.length >= 10 ? task.createdAt.slice(0, 10) : 'Bieżący';

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-sky-700 bg-sky-100/80 px-2 py-0.5 rounded border border-sky-200">
              {task.code || 'ZAD'}
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-semibold text-slate-700 truncate max-w-[220px]">
              {project?.name || 'Zarządzanie Projektami'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(task)}
              className="flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 transition-colors font-medium"
            >
              <Edit3 className="w-3.5 h-3.5 text-slate-500" />
              <span>Edytuj</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs">
          {/* Error Banner when blocked */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Blokada zależności!</span>
                <p className="mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Title & Priority Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {getPriorityBadge(task.priority)}
              <span className="text-slate-500 uppercase tracking-wide font-medium">
                Typ: {task.type || 'zadanie'}
              </span>
              {parentTask && (
                <span className="text-slate-500 font-mono">
                  · Podzadanie w: <strong>{parentTask.code}</strong>
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-900 leading-snug">{task.title}</h2>
          </div>

          {/* OFFICIAL STATUTORY DEADLINE WARNING BANNER */}
          {task.isOfficialDeadline && (
            <div className={`p-3.5 rounded-lg border flex items-start gap-3 ${
              isApproachingOfficialDeadline(task)
                ? 'bg-rose-50 border-rose-300 text-rose-950 animate-official-deadline'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}>
              <div className="p-1.5 bg-rose-600 text-white rounded shrink-0">
                <Flame className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wide text-rose-900">
                    Termin urzędowy (rygor administracyjny / prawny)
                  </span>
                  <span className="font-mono font-bold text-[11px] bg-rose-200/80 px-2 py-0.5 rounded text-rose-950">
                    Pozostało: {getBusinessDaysRemaining(task.dueDate)} dni roboczych
                  </span>
                </div>
                <p className="text-[11px] text-rose-900/90 mt-1 leading-relaxed">
                  {isApproachingOfficialDeadline(task)
                    ? '⚠️ Uwaga! Do upływu terminu urzędowego pozostały mniej niż 3 dni robocze (bez sobót i niedziel). Całe zadanie mruga na listach i harmonogramie, aby zapobiec uchybieniu terminu!'
                    : `Zadanie oznaczone jako termin urzędowy. Mruganie rozpocznie się automatycznie na 3 dni robocze przed ${task.dueDate}.`}
                </p>
              </div>
            </div>
          )}

          {/* BLOCKER DEPENDENCY ALERT CARD WITH DIRECT JUMP */}
          {isBlockedByDependencies ? (
            <div className="bg-slate-100 border-2 border-rose-400 rounded-lg p-3.5 space-y-2.5 task-blocked-style">
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2 text-rose-900 font-bold">
                  <div className="p-1 bg-rose-600 text-white rounded">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <span className="text-sm">To zadanie jest obecnie ZABLOKOWANE</span>
                </div>
                <span className="text-[10px] bg-rose-100 text-rose-900 border border-rose-200 font-bold px-2 py-0.5 rounded">
                  Wymaga ukończenia {unfinishedBlockers.length} zadań
                </span>
              </div>

              <p className="text-slate-800 leading-relaxed text-[11px] relative z-10 font-medium bg-white/90 p-2 rounded border border-slate-200">
                Zgodnie z regułami zależności, realizacja tego zadania będzie możliwa dopiero po ukończeniu poniższych zadań blokujących. Kliknij zadanie, aby natychmiast do niego przejść:
              </p>

              <div className="space-y-1.5 pt-1 relative z-10">
                {blockingTasks.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-white/95 backdrop-blur-xs p-2.5 rounded-md border border-slate-300 shadow-xs hover:border-sky-400 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-100 text-[11px] shrink-0">
                        {b.code}
                      </span>
                      <span className="font-semibold text-slate-900 text-xs truncate" title={b.title}>
                        {b.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-mono text-[10px] px-2 py-0.5 rounded font-medium ${
                          b.status === 'done'
                            ? 'bg-emerald-100 text-emerald-800 font-bold'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {b.status === 'done' ? 'Ukończone ✓' : `Status: ${b.status}`}
                      </span>

                      {onNavigateToTask && (
                        <button
                          onClick={() => onNavigateToTask(b)}
                          className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 rounded text-[11px] font-semibold transition-colors"
                          title={`Przejdź do zadania [${b.code}]`}
                        >
                          <span>Przejdź</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : blockingTasks.length > 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Wszystkie zadania blokujące ({blockingTasks.length}) zostały ukończone. Zadanie odblokowane!</span>
            </div>
          ) : null}

          {/* GOOGLE CALENDAR & TIMELINE CARD */}
          <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sky-900 font-semibold">
                <Calendar className="w-4 h-4 text-sky-600" />
                <span>Terminarz & Kalendarz Google</span>
              </div>
              <div className="text-[11px] font-mono text-sky-800 tabular-nums font-semibold">
                Czas trwania: {task.durationDays || 1} dni ({task.startDate || 'Brak daty'} → {task.dueDate || 'Brak daty'})
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed">
              Dodaj to zadanie do Kalendarza Google lub pobierz uniwersalny plik terminów .ics.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={gCalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors shadow-xs"
              >
                <span>Dodaj do Kalendarza Google</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              <button
                onClick={() => downloadIcsFile([task], `${task.code || 'zadanie'}-termin.ics`, project?.name)}
                className="flex items-center gap-1.5 bg-white border border-sky-300 hover:bg-sky-100/60 text-sky-900 text-xs font-medium px-3 py-1.5 rounded transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-sky-600" />
                <span>Pobierz plik .ics</span>
              </button>
            </div>
          </div>

          {/* Status & Progress Selector */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Status zadania</label>
              <select
                value={task.status || 'to_do'}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:ring-1 focus:ring-sky-500"
              >
                <option value="to_do">Do zrobienia</option>
                <option value="in_progress">W toku</option>
                <option value="review">Do weryfikacji</option>
                <option value="blocked">Zablokowane</option>
                <option value="done">Ukończone</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="font-semibold text-slate-600">Postęp</label>
                <span className="font-mono tabular-nums font-bold text-slate-700">
                  {task.progress || 0}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={task.progress || 0}
                onChange={(e) => onUpdateProgress(task.id, Number(e.target.value))}
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>
          </div>

          {/* SUBTASKS HIERARCHY TREE (Drzewo podzadań) */}
          {subtasks.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <GitMerge className="w-3.5 h-3.5 text-sky-600" />
                  <span>Podzadania w drzewie zależności ({subtasks.length})</span>
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length} ukończone
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Ukończenie wszystkich podzadań automatycznie zakończy to zadanie nadrzędne.
              </p>
              <div className="space-y-1">
                {subtasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between bg-white px-3 py-1.5 rounded border border-slate-200"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-slate-500 font-bold">{st.code}</span>
                      <span className="truncate">{st.title}</span>
                    </div>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                        st.status === 'done'
                          ? 'bg-emerald-100 text-emerald-800 font-bold'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {st.status === 'done' ? 'Ukończone ✓' : st.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TASKS BLOCKED BY THIS TASK */}
          {tasksBlockedByThis.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-1.5">
              <span className="font-semibold text-slate-700 block text-[11px]">
                Zadania oczekujące na wykonanie tego zadania:
              </span>
              <div className="space-y-1">
                {tasksBlockedByThis.map((t) => (
                  <div key={t.id} className="flex items-center justify-between bg-white p-1.5 rounded border border-slate-200 text-[11px]">
                    <span className="font-mono font-medium text-slate-800">[{t.code}] {t.title}</span>
                    <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      Oczekuje na odblokowanie
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <h3 className="font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Opis i zakres</h3>
            <div className="text-slate-800 leading-relaxed bg-white border border-slate-200 p-3.5 rounded-md whitespace-pre-line">
              {task.description || 'Brak opisu dla tego zadania.'}
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
            <div>
              <span className="text-slate-400 block text-[11px]">Osoba przypisana:</span>
              <span className="font-medium text-slate-900">{assignee ? assignee.name : 'Brak'}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[11px]">Zgłaszający:</span>
              <span className="font-medium text-slate-900">{reporter ? reporter.name : 'System'}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[11px]">Czas trwania w dniach:</span>
              <span className="font-mono tabular-nums text-slate-900 font-bold">
                {task.durationDays || 1} dni ({task.estimatedHours || 0} h)
              </span>
            </div>

            <div>
              <span className="text-slate-400 block text-[11px]">Harmonogram:</span>
              <span className="font-mono tabular-nums text-slate-600">
                {task.startDate || '—'} do {task.dueDate || '—'}
              </span>
            </div>
          </div>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div>
              <h3 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                <span>Etykiety</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {task.tags.map((t, idx) => (
                  <span
                    key={idx}
                    className="text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Comments and Multi-user collaboration */}
          <div className="pt-4 border-t border-slate-200">
            <h3 className="font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-slate-500" />
              <span>Dyskusja zespołu ({taskComments.length})</span>
            </h3>

            <div className="space-y-3 mb-4">
              {taskComments.length === 0 ? (
                <div className="text-slate-400 italic py-2">Brak komentarzy. Dodaj pierwszy wpis!</div>
              ) : (
                taskComments.map((c) => {
                  const author = safeUsers.find((u) => u.id === c.userId);
                  const timeFormatted =
                    c.createdAt && c.createdAt.length >= 16 ? c.createdAt.slice(11, 16) : 'Teraz';
                  return (
                    <div key={c.id} className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-800">{author ? author.name : 'Użytkownik'}</span>
                        <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                          {timeFormatted}
                        </span>
                      </div>
                      <p className="text-slate-700 leading-relaxed">{c.content}</p>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleCommentSubmit} className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={`Napisz jako ${currentUser?.name || 'Użytkownik'}...`}
                className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                type="submit"
                className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1 shrink-0 font-medium"
              >
                <Send className="w-3 h-3" />
                <span>Wyślij</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
