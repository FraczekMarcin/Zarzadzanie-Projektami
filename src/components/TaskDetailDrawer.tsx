import React, { useState, useRef, useId, useEffect, useCallback } from 'react';
import { Task, Project, User, Priority, TaskStatus, Comment } from '../types';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { useFormSubmit, type FormSubmitResult } from '../hooks/useFormSubmit';
import { FormError } from './FormError';
import { FIELD_LIMITS } from '../utils/access';
import { getProjectDisplayName } from '../utils/projectMeta';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../utils/calendar';
import { ProjectNameLabel } from './ProjectNameLabel';
import { 
  X, 
  Calendar, 
  ExternalLink, 
  Download, 
  User as UserIcon, 
  CheckCircle2, 
  Edit3, 
  MessageSquare, 
  Send,
  AlertCircle,
  ArrowRight,
  Flame,
  GitMerge,
  Tag
} from 'lucide-react';
import { getBusinessDaysRemaining, isApproachingOfficialDeadline } from '../utils/businessDays';
import {
  DEFAULT_PROGRESS_WEIGHTING,
  getSubtaskProgressSummary,
  ProgressWeighting,
} from '../utils/progress';

interface TaskDetailDrawerProps {
  task: Task | null;
  projects?: Project[];
  users?: User[];
  allTasks?: Task[];
  progressWeighting?: ProgressWeighting;
  currentUser: User;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onNavigateToTask?: (task: Task) => void;
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateProgress: (taskId: string, progress: number) => void;
  onUpdateTaskFields?: (taskId: string, patch: Partial<Task>) => void;
  onAddComment: (
    taskId: string,
    text: string
  ) => Promise<FormSubmitResult<Comment> | void> | FormSubmitResult<Comment> | void;
  comments?: { id: string; taskId: string; userId: string; content: string; createdAt: string }[];
}

interface DraftFields {
  title: string;
  description: string;
  startDate: string;
  dueDate: string;
  priority: Priority;
  assigneeId: string;
}

export const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  projects = [],
  users = [],
  allTasks = [],
  progressWeighting = DEFAULT_PROGRESS_WEIGHTING,
  currentUser,
  onClose,
  onEdit,
  onNavigateToTask,
  onUpdateStatus,
  onUpdateProgress,
  onUpdateTaskFields,
  onAddComment,
  comments = [],
}) => {
  const [commentText, setCommentText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [datesError, setDatesError] = useState<string | null>(null);
  const commentSubmit = useFormSubmit<Comment>();

  const normalizePriority = (p?: Priority | string): Priority => {
    if (p === 'medium') return 'normal';
    if (p === 'low' || p === 'normal' || p === 'high' || p === 'critical') return p;
    return 'normal';
  };

  const [titleDraft, setTitleDraft] = useState(task?.title || '');
  const [descriptionDraft, setDescriptionDraft] = useState(task?.description || '');
  const [startDateDraft, setStartDateDraft] = useState(task?.startDate || '');
  const [dueDateDraft, setDueDateDraft] = useState(task?.dueDate || '');
  const [priorityDraft, setPriorityDraft] = useState<Priority>(normalizePriority(task?.priority));
  const [assigneeIdDraft, setAssigneeIdDraft] = useState(task?.assigneeId || '');

  const draftRef = useRef<DraftFields>({
    title: task?.title || '',
    description: task?.description || '',
    startDate: task?.startDate || '',
    dueDate: task?.dueDate || '',
    priority: normalizePriority(task?.priority),
    assigneeId: task?.assigneeId || '',
  });

  const drawerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const startDateInputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;

  const isReadOnly = currentUser?.role === 'viewer' || !onUpdateTaskFields;

  useEffect(() => {
    if (!task) return;
    const nextDraft: DraftFields = {
      title: task.title || '',
      description: task.description || '',
      startDate: task.startDate || '',
      dueDate: task.dueDate || '',
      priority: normalizePriority(task.priority),
      assigneeId: task.assigneeId || '',
    };
    setTitleDraft(nextDraft.title);
    setDescriptionDraft(nextDraft.description);
    setStartDateDraft(nextDraft.startDate);
    setDueDateDraft(nextDraft.dueDate);
    setPriorityDraft(nextDraft.priority);
    setAssigneeIdDraft(nextDraft.assigneeId);
    draftRef.current = nextDraft;
    setTitleError(null);
    setDatesError(null);
    setErrorMessage(null);
    commentSubmit.clearError();
  }, [task?.id]);

  const validateAndCommit = useCallback((): boolean => {
    if (!task) return true;
    const current = draftRef.current;
    const trimmedTitle = current.title.trim();

    if (!trimmedTitle) {
      setTitleError('Tytuł zadania nie może być pusty.');
      titleInputRef.current?.focus({ preventScroll: true });
      return false;
    }

    if (current.startDate && current.dueDate && current.startDate > current.dueDate) {
      setDatesError('Data rozpoczęcia nie może być późniejsza niż termin końcowy.');
      startDateInputRef.current?.focus({ preventScroll: true });
      return false;
    }

    setTitleError(null);
    setDatesError(null);

    if (isReadOnly || !onUpdateTaskFields) return true;

    const patch: Partial<Task> = {};
    if (trimmedTitle !== (task.title || '').trim()) {
      patch.title = trimmedTitle;
    }
    if (current.description !== (task.description || '')) {
      patch.description = current.description;
    }
    if (current.startDate && current.startDate !== task.startDate) {
      patch.startDate = current.startDate;
    }
    if (current.dueDate && current.dueDate !== task.dueDate) {
      patch.dueDate = current.dueDate;
    }
    if (current.priority !== normalizePriority(task.priority)) {
      patch.priority = current.priority;
    }
    const prevAssignee = task.assigneeId || '';
    if (current.assigneeId !== prevAssignee) {
      patch.assigneeId = current.assigneeId || undefined;
    }

    if (Object.keys(patch).length > 0) {
      onUpdateTaskFields(task.id, patch);
    }

    return true;
  }, [isReadOnly, onUpdateTaskFields, task]);

  const { backdropProps, requestClose } = useDismissOnOutsideClick({
    isOpen: Boolean(task),
    mode: 'dismiss',
    panelRef: drawerRef,
    onDismiss: onClose,
    onBeforeDismiss: validateAndCommit,
  });

  useFocusTrap({
    isOpen: Boolean(task),
    onClose: requestClose,
    containerRef: drawerRef,
  });

  if (!task) return null;

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeUsers = Array.isArray(users) ? users : [];
  const safeAllTasks = Array.isArray(allTasks) ? allTasks : [];
  const safeComments = Array.isArray(comments) ? comments : [];

  const project = safeProjects.find((p) => p.id === task.projectId);
  const assignee = safeUsers.find((u) => u.id === (assigneeIdDraft || task.assigneeId));
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
  const subtaskProgressSummary = getSubtaskProgressSummary(safeAllTasks, task.id, progressWeighting);
  const hasDerivedProgress = subtaskProgressSummary.total > 0;

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

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed) return;
    const res = await commentSubmit.submit(
      () => Promise.resolve(onAddComment(task.id, trimmed)),
      { fallbackError: 'Nie udało się zapisać komentarza na serwerze.' }
    );
    if (res.ok) {
      setCommentText('');
    }
  };

  const handleEditButtonClick = () => {
    if (!validateAndCommit()) return;
    const latestTask: Task = {
      ...task,
      title: draftRef.current.title.trim() || task.title,
      description: draftRef.current.description,
      startDate: draftRef.current.startDate || task.startDate,
      dueDate: draftRef.current.dueDate || task.dueDate,
      priority: draftRef.current.priority,
      assigneeId: draftRef.current.assigneeId || undefined,
    };
    onEdit(latestTask);
  };

  const getPriorityBadge = (priority?: Priority | string) => {
    switch (priority) {
      case 'critical':
        return <span className="text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800">Krytyczny (P1)</span>;
      case 'high':
        return <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">Wysoki (P2)</span>;
      case 'normal':
      case 'medium':
        return <span className="text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">Normalny (P3)</span>;
      case 'low':
        return <span className="text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Niski (P4)</span>;
      default:
        return <span className="text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">Normalny</span>;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs flex justify-end"
      {...backdropProps}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-200"
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-sky-700 dark:text-sky-300 bg-sky-100/80 dark:bg-sky-950/60 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
              {task.code || 'ZAD'}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-400" aria-hidden="true">·</span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[220px]">
              {project ? <ProjectNameLabel project={project} /> : 'Zarządzanie Projektami'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEditButtonClick}
              className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-medium"
            >
              <Edit3 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" aria-hidden="true" />
              <span>Edytuj</span>
            </button>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Zamknij szczegóły zadania"
              className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs">
          {/* Error Banner when blocked */}
          {errorMessage && (
            <div role="alert" aria-live="assertive" className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-800 dark:text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-bold block">Blokada zależności!</span>
                <p className="mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Title & Priority Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {getPriorityBadge(priorityDraft)}
              <span className="text-slate-600 dark:text-slate-400 uppercase tracking-wide font-medium">
                Typ: {task.type || 'zadanie'}
              </span>
              {parentTask && (
                <span className="text-slate-600 dark:text-slate-400 font-mono">
                  · Podzadanie w: <strong className="text-slate-800 dark:text-slate-200">{parentTask.code}</strong>
                </span>
              )}
            </div>
            <h2 id={titleId} className="sr-only">
              {task.title}
            </h2>
            {isReadOnly ? (
              <p className="text-base font-bold text-slate-900 dark:text-white leading-snug">{task.title}</p>
            ) : (
              <div>
                <label htmlFor={`${baseId}-title-input`} className="sr-only">
                  Tytuł zadania
                </label>
                <input
                  ref={titleInputRef}
                  id={`${baseId}-title-input`}
                  type="text"
                  maxLength={FIELD_LIMITS.title}
                  aria-invalid={Boolean(titleError)}
                  aria-describedby={titleError ? `${baseId}-title-error` : undefined}
                  value={titleDraft}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setTitleDraft(nextVal);
                    draftRef.current.title = nextVal;
                    if (titleError && nextVal.trim()) {
                      setTitleError(null);
                    }
                  }}
                  onBlur={() => {
                    if (!draftRef.current.title.trim()) {
                      setTitleError('Tytuł zadania nie może być pusty.');
                      return;
                    }
                    validateAndCommit();
                  }}
                  className={`w-full text-base font-bold bg-transparent border rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white leading-snug transition-colors ${
                    titleError
                      ? 'border-rose-500 dark:border-rose-500 bg-rose-50/40 dark:bg-rose-950/30'
                      : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500'
                  }`}
                />
                {titleError && (
                  <p id={`${baseId}-title-error`} role="alert" className="mt-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                    {titleError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* OFFICIAL STATUTORY DEADLINE WARNING BANNER */}
          {task.isOfficialDeadline && (
            <div className={`p-3.5 rounded-lg border flex items-start gap-3 ${
              isApproachingOfficialDeadline(task)
                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-100 animate-official-deadline'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-100'
            }`}>
              <div className="p-1.5 bg-rose-700 text-white rounded shrink-0">
                <Flame className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wide text-rose-900 dark:text-rose-200">
                    Termin urzędowy (rygor administracyjny / prawny)
                  </span>
                  <span className="font-mono font-bold text-[11px] bg-rose-200/80 dark:bg-rose-900/70 px-2 py-0.5 rounded text-rose-950 dark:text-rose-100">
                    Pozostało: {getBusinessDaysRemaining(dueDateDraft || task.dueDate)} dni roboczych
                  </span>
                </div>
                <p className="text-[11px] text-rose-900/90 dark:text-rose-200 mt-1 leading-relaxed">
                  {isApproachingOfficialDeadline(task)
                    ? '⚠️ Uwaga! Do upływu terminu urzędowego pozostały 3 dni robocze lub mniej (z wyłączeniem sobót, niedziel i polskich świąt ustawowych). Całe zadanie mruga na listach i harmonogramie, aby zapobiec uchybieniu terminu!'
                    : `Zadanie oznaczone jako termin urzędowy. Mruganie rozpocznie się automatycznie na 3 dni robocze przed ${dueDateDraft || task.dueDate} (dni robocze z pominięciem świąt).`}
                </p>
              </div>
            </div>
          )}

          {/* BLOCKER DEPENDENCY ALERT CARD WITH DIRECT JUMP */}
          {isBlockedByDependencies ? (
            <div className="bg-slate-100 dark:bg-slate-800 border-2 border-rose-400 dark:border-rose-700 rounded-lg p-3.5 space-y-2.5 task-blocked-style">
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-bold">
                  <div className="p-1 bg-rose-700 text-white rounded">
                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <span className="text-sm">To zadanie jest obecnie ZABLOKOWANE</span>
                </div>
                <span className="text-[10px] bg-rose-100 dark:bg-rose-950/80 text-rose-900 dark:text-rose-200 border border-rose-200 dark:border-rose-800 font-bold px-2 py-0.5 rounded">
                  Wymaga ukończenia {unfinishedBlockers.length} zadań
                </span>
              </div>

              <p className="text-slate-800 dark:text-slate-200 leading-relaxed text-[11px] relative z-10 font-medium bg-white/90 dark:bg-slate-900/90 p-2 rounded border border-slate-200 dark:border-slate-700">
                Zgodnie z regułami zależności, realizacja tego zadania będzie możliwa dopiero po ukończeniu poniższych zadań blokujących. Kliknij zadanie, aby natychmiast do niego przejść:
              </p>

              <div className="space-y-1.5 pt-1 relative z-10">
                {blockingTasks.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs p-2.5 rounded-md border border-slate-300 dark:border-slate-700 shadow-xs hover:border-sky-400 dark:hover:border-sky-500 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-100 dark:border-sky-800 text-[11px] shrink-0">
                        {b.code}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white text-xs truncate" title={b.title}>
                        {b.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-mono text-[10px] px-2 py-0.5 rounded font-medium ${
                          b.status === 'done'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold'
                            : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                        }`}
                      >
                        {b.status === 'done' ? 'Ukończone ✓' : `Status: ${b.status}`}
                      </span>

                      {onNavigateToTask && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTask(b)}
                          className="flex items-center gap-1 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white px-2.5 py-1 rounded text-[11px] font-semibold transition-colors"
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
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Wszystkie zadania blokujące ({blockingTasks.length}) zostały ukończone. Zadanie odblokowane!</span>
            </div>
          ) : null}

          {/* GOOGLE CALENDAR & TIMELINE CARD */}
          <div className="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sky-900 dark:text-sky-200 font-semibold">
                <Calendar className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                <span>Terminarz & Kalendarz Google</span>
              </div>
              <div className="text-[11px] font-mono text-sky-800 dark:text-sky-300 tabular-nums font-semibold">
                Czas trwania: {task.durationDays || 1} dni ({startDateDraft || task.startDate || 'Brak daty'} → {dueDateDraft || task.dueDate || 'Brak daty'})
              </div>
            </div>

            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Dodaj to zadanie do Kalendarza Google lub pobierz uniwersalny plik terminów .ics.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={gCalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-sky-700 hover:bg-sky-600 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors shadow-xs"
              >
                <span>Dodaj do Kalendarza Google</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>

              <button
                type="button"
                onClick={() => downloadIcsFile([task], `${task.code || 'zadanie'}-termin.ics`, project ? getProjectDisplayName(project) : undefined)}
                className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-700 hover:bg-sky-100/60 dark:hover:bg-slate-700 text-sky-900 dark:text-sky-200 text-xs font-medium px-3 py-1.5 rounded transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                <span>Pobierz plik .ics</span>
              </button>
            </div>
          </div>

          {/* Status & Progress Selector */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <div>
              <label htmlFor={`${baseId}-status`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Status zadania</label>
              <select
                id={`${baseId}-status`}
                value={task.status || 'to_do'}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-medium focus:ring-1 focus:ring-sky-500"
              >
                <option value="to_do">Do zrobienia</option>
                <option value="in_progress">W toku</option>
                <option value="review">Do weryfikacji</option>
                <option value="blocked">Zablokowane</option>
                <option value="done">Ukończone</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1 gap-2">
                <label htmlFor={`${baseId}-progress`} className="font-semibold text-slate-700 dark:text-slate-200">Postęp</label>
                <span className="font-mono tabular-nums font-bold text-slate-700 dark:text-slate-200">
                  {task.progress || 0}%
                </span>
              </div>
              <input
                id={`${baseId}-progress`}
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={hasDerivedProgress}
                title={hasDerivedProgress ? subtaskProgressSummary.tooltip : undefined}
                value={task.progress || 0}
                onChange={(e) => {
                  if (hasDerivedProgress) return;
                  onUpdateProgress(task.id, Number(e.target.value));
                }}
                className={`w-full accent-sky-600 ${hasDerivedProgress ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              />
              {hasDerivedProgress && (
                <div
                  title={subtaskProgressSummary.tooltip}
                  className="mt-1 flex items-center justify-between gap-2 text-[11px] text-sky-700 dark:text-sky-300 font-medium"
                >
                  <span>Wyliczany z podzadań</span>
                  <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                    {subtaskProgressSummary.done}/{subtaskProgressSummary.total} · {subtaskProgressSummary.weightLabel}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* SUBTASKS HIERARCHY TREE (Drzewo podzadań) */}
          {subtasks.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3.5 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <GitMerge className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  <span>Podzadania w drzewie zależności ({subtasks.length})</span>
                </span>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length} ukończone
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Ukończenie wszystkich podzadań automatycznie zakończy to zadanie nadrzędne.
              </p>
              <div className="space-y-1">
                {subtasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between bg-white dark:bg-slate-900 px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-slate-600 dark:text-slate-400 font-bold">{st.code}</span>
                      <span className="truncate text-slate-900 dark:text-slate-100">{st.title}</span>
                    </div>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                        st.status === 'done'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
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
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-slate-800/40 space-y-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">
                Zadania oczekujące na wykonanie tego zadania:
              </span>
              <div className="space-y-1">
                {tasksBlockedByThis.map((t) => (
                  <div key={t.id} className="flex items-center justify-between bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200 dark:border-slate-700 text-[11px]">
                    <span className="font-mono font-medium text-slate-800 dark:text-slate-200">[{t.code}] {t.title}</span>
                    <span className="text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                      Oczekuje na odblokowanie
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label htmlFor={`${baseId}-desc-input`} className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Opis i zakres
            </label>
            {isReadOnly ? (
              <div className="text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3.5 rounded-md whitespace-pre-line">
                {task.description || 'Brak opisu dla tego zadania.'}
              </div>
            ) : (
              <textarea
                id={`${baseId}-desc-input`}
                rows={3}
                maxLength={FIELD_LIMITS.description}
                value={descriptionDraft}
                placeholder="Dodaj opis i zakres prac dla tego zadania..."
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setDescriptionDraft(nextVal);
                  draftRef.current.description = nextVal;
                }}
                onBlur={() => {
                  validateAndCommit();
                }}
                className="w-full text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            )}
          </div>

          {/* Metadata & Live Scheduling Grid */}
          <div className="grid grid-cols-2 gap-3 border border-slate-200 dark:border-slate-700 rounded-lg p-3.5 bg-slate-50/50 dark:bg-slate-800/40">
            <div>
              <label htmlFor={`${baseId}-assignee-input`} className="text-slate-600 dark:text-slate-400 block text-[11px] mb-1">
                Osoba przypisana
              </label>
              {isReadOnly ? (
                <span className="font-medium text-slate-900 dark:text-white flex items-center gap-1">
                  <UserIcon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                  <span>{assignee ? assignee.name : 'Brak'}</span>
                </span>
              ) : (
                <select
                  id={`${baseId}-assignee-input`}
                  value={assigneeIdDraft}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setAssigneeIdDraft(nextVal);
                    draftRef.current.assigneeId = nextVal;
                    validateAndCommit();
                  }}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="">Brak przypisania</option>
                  {safeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor={`${baseId}-priority-input`} className="text-slate-600 dark:text-slate-400 block text-[11px] mb-1">
                Priorytet
              </label>
              {isReadOnly ? (
                <span className="font-medium text-slate-900 dark:text-white">{priorityDraft}</span>
              ) : (
                <select
                  id={`${baseId}-priority-input`}
                  value={priorityDraft}
                  onChange={(e) => {
                    const nextVal = e.target.value as Priority;
                    setPriorityDraft(nextVal);
                    draftRef.current.priority = nextVal;
                    validateAndCommit();
                  }}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="low">Niski (P4)</option>
                  <option value="normal">Normalny (P3)</option>
                  <option value="high">Wysoki (P2)</option>
                  <option value="critical">Krytyczny (P1)</option>
                </select>
              )}
            </div>

            <div>
              <label htmlFor={`${baseId}-start-date`} className="text-slate-600 dark:text-slate-400 block text-[11px] mb-1">
                Data rozpoczęcia
              </label>
              {isReadOnly ? (
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {task.startDate || '—'}
                </span>
              ) : (
                <input
                  ref={startDateInputRef}
                  id={`${baseId}-start-date`}
                  type="date"
                  value={startDateDraft}
                  aria-invalid={Boolean(datesError)}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setStartDateDraft(nextVal);
                    draftRef.current.startDate = nextVal;
                    if (datesError && (!nextVal || !draftRef.current.dueDate || nextVal <= draftRef.current.dueDate)) {
                      setDatesError(null);
                    }
                  }}
                  onBlur={() => {
                    validateAndCommit();
                  }}
                  className={`w-full bg-white dark:bg-slate-800 border rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 ${
                    datesError ? 'border-rose-500 dark:border-rose-500' : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
              )}
            </div>

            <div>
              <label htmlFor={`${baseId}-due-date`} className="text-slate-600 dark:text-slate-400 block text-[11px] mb-1">
                Termin końcowy
              </label>
              {isReadOnly ? (
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {task.dueDate || '—'}
                </span>
              ) : (
                <input
                  id={`${baseId}-due-date`}
                  type="date"
                  value={dueDateDraft}
                  aria-invalid={Boolean(datesError)}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setDueDateDraft(nextVal);
                    draftRef.current.dueDate = nextVal;
                    if (datesError && (!draftRef.current.startDate || !nextVal || draftRef.current.startDate <= nextVal)) {
                      setDatesError(null);
                    }
                  }}
                  onBlur={() => {
                    validateAndCommit();
                  }}
                  className={`w-full bg-white dark:bg-slate-800 border rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 ${
                    datesError ? 'border-rose-500 dark:border-rose-500' : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
              )}
            </div>

            {datesError && (
              <p id={`${baseId}-dates-error`} role="alert" className="col-span-2 text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                {datesError}
              </p>
            )}

            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Zgłaszający:</span>
              <span className="font-medium text-slate-900 dark:text-white">{reporter ? reporter.name : 'System'}</span>
            </div>

            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Czas trwania:</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-white font-bold">
                {task.durationDays || 1} dni ({task.estimatedHours || 0} h)
              </span>
            </div>
          </div>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div>
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                <span>Etykiety</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {task.tags.map((t, idx) => (
                  <span
                    key={idx}
                    className="text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Comments and Multi-user collaboration */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />
              <span>Dyskusja zespołu ({taskComments.length})</span>
            </h3>

            <div className="space-y-3 mb-4">
              {taskComments.length === 0 ? (
                <div className="text-slate-600 dark:text-slate-400 italic py-2">Brak komentarzy. Dodaj pierwszy wpis!</div>
              ) : (
                taskComments.map((c) => {
                  const author = safeUsers.find((u) => u.id === c.userId);
                  const timeFormatted =
                    c.createdAt && c.createdAt.length >= 16 ? c.createdAt.slice(11, 16) : 'Teraz';
                  return (
                    <div key={c.id} className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{author ? author.name : 'Użytkownik'}</span>
                        <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                          {timeFormatted}
                        </span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{c.content}</p>
                    </div>
                  );
                })
              )}
            </div>

            <FormError
              id={`${baseId}-comment-error`}
              error={commentSubmit.submitError}
              alertRef={commentSubmit.alertRef}
              onDismiss={commentSubmit.clearError}
              className="mb-3"
            />

            <form onSubmit={handleCommentSubmit} className="flex gap-2">
              <input
                id={`${baseId}-comment`}
                type="text"
                aria-label="Treść komentarza"
                value={commentText}
                disabled={commentSubmit.isSubmitting}
                onChange={(e) => setCommentText(e.target.value)}
                {...commentSubmit.getFieldA11yProps('content', `${baseId}-comment-error`)}
                placeholder={`Napisz jako ${currentUser?.name || 'Użytkownik'}...`}
                className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={commentSubmit.isSubmitting}
                className="bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 disabled:opacity-60 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1 shrink-0 font-medium"
              >
                <Send className="w-3 h-3" aria-hidden="true" />
                <span>{commentSubmit.isSubmitting ? 'Wysyłanie...' : 'Wyślij'}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
