import React, { useState, useEffect, useRef, useId } from 'react';
import { Task, Project, User, Priority, TaskType, TaskStatus } from '../types';
import { X, Calendar, UserCheck, AlertTriangle, Layers, Clock, Lock, GitMerge } from 'lucide-react';
import { getTaskTypes, TaskTypeDefinition } from '../utils/variableSettings';
import { FIELD_LIMITS } from '../utils/access';
import { useFocusTrap } from '../utils/useFocusTrap';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskData: Omit<Task, 'id' | 'code' | 'createdAt' | 'updatedAt'>) => void;
  projects: Project[];
  users: User[];
  allTasks: Task[];
  defaultProjectId?: string | null;
  defaultDate?: string;
  defaultParentId?: string;
  initialTask?: Task | null;
}

// Helper to get today's date in YYYY-MM-DD
const getTodayIsoDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSave,
  projects,
  users,
  allTasks,
  defaultProjectId,
  defaultDate,
  defaultParentId,
  initialTask,
}) => {
  const [taskTypes, setTaskTypes] = useState<TaskTypeDefinition[]>(() => getTaskTypes());
  const [projectId, setProjectId] = useState(defaultProjectId || (projects[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>('rysunek');
  const [priority, setPriority] = useState<Priority>('normal'); // Default Normalny as requested!
  const [status, setStatus] = useState<TaskStatus>('to_do');
  const [assigneeId, setAssigneeId] = useState<string>(users[0]?.id || '');
  const [startDate, setStartDate] = useState(defaultDate || getTodayIsoDate());
  const [durationDays, setDurationDays] = useState<number>(7);
  const [dueDate, setDueDate] = useState(defaultDate || getTodayIsoDate());
  const [estimatedHours, setEstimatedHours] = useState(16);
  const [progress, setProgress] = useState(0);
  const [tagsInput, setTagsInput] = useState('');
  const [blockingTaskIds, setBlockingTaskIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState<string>('');
  const [isOfficialDeadline, setIsOfficialDeadline] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;

  useFocusTrap({ isOpen, onClose, containerRef: modalRef });

  // Helper to calculate due date from start date and duration days
  const calculateDueDate = (start: string, days: number): string => {
    try {
      const d = new Date(start + 'T00:00:00');
      d.setDate(d.getDate() + Math.max(1, days) - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return start;
    }
  };

  // Helper to calculate days between dates
  const calculateDays = (start: string, end: string): number => {
    try {
      const d1 = new Date(start + 'T00:00:00').getTime();
      const d2 = new Date(end + 'T00:00:00').getTime();
      const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
      return Math.max(1, diff);
    } catch {
      return 1;
    }
  };

  useEffect(() => {
    setStatusError(null);
    const currentTypes = getTaskTypes();
    setTaskTypes(currentTypes);
    if (initialTask) {
      setProjectId(initialTask.projectId);
      setTitle(initialTask.title);
      setDescription(initialTask.description || '');
      setType(initialTask.type);
      setPriority(initialTask.priority || 'normal');
      setStatus(initialTask.status);
      setAssigneeId(initialTask.assigneeId || '');
      setStartDate(initialTask.startDate);
      setDueDate(initialTask.dueDate);
      const days = initialTask.durationDays || calculateDays(initialTask.startDate, initialTask.dueDate);
      setDurationDays(days);
      setIsOfficialDeadline(!!initialTask.isOfficialDeadline);
      setEstimatedHours(initialTask.estimatedHours || 0);
      setProgress(initialTask.progress || 0);
      setTagsInput(initialTask.tags ? initialTask.tags.join(', ') : '');
      setBlockingTaskIds(initialTask.blockingTaskIds || initialTask.dependencies || []);
      setParentId(initialTask.parentId || '');
    } else {
      setProjectId(defaultProjectId || (projects[0]?.id ?? ''));
      setTitle('');
      setDescription('');
      setType(currentTypes[0]?.id || 'rysunek');
      setPriority('normal'); // Default Normalny
      setStatus('to_do');
      setAssigneeId(users[0]?.id || '');
      const sDate = defaultDate || getTodayIsoDate();
      setStartDate(sDate);
      setDurationDays(7);
      setDueDate(calculateDueDate(sDate, 7));
      setIsOfficialDeadline(false);
      setEstimatedHours(16);
      setProgress(0);
      setTagsInput('');
      setBlockingTaskIds([]);
      setParentId(defaultParentId || '');
    }
  }, [initialTask, defaultProjectId, defaultDate, defaultParentId, projects, users]);

  // When start date changes, recompute due date from duration
  const handleStartDateChange = (newStart: string) => {
    setStartDate(newStart);
    setDueDate(calculateDueDate(newStart, durationDays));
  };

  // When duration in days changes, recompute due date
  const handleDurationDaysChange = (days: number) => {
    const val = Math.max(1, days);
    setDurationDays(val);
    setDueDate(calculateDueDate(startDate, val));
  };

  // When due date is manually changed, update duration in days
  const handleDueDateChange = (newEnd: string) => {
    setDueDate(newEnd);
    setDurationDays(calculateDays(startDate, newEnd));
  };

  const toggleBlockingTask = (taskId: string) => {
    let nextBlocking: string[];
    if (blockingTaskIds.includes(taskId)) {
      nextBlocking = blockingTaskIds.filter((id) => id !== taskId);
    } else {
      nextBlocking = [...blockingTaskIds, taskId];
    }
    setBlockingTaskIds(nextBlocking);

    // Zgodnie z wymaganiem: jeśli zadanie jest blokowane przez inne zmień status wykonania na zablokowane
    const hasUnfinished = nextBlocking.some((id) => {
      const b = allTasks.find((t) => t.id === id);
      return b && b.status !== 'done';
    });
    if (hasUnfinished && status !== 'done') {
      setStatus('blocked');
    } else if (!hasUnfinished && status === 'blocked') {
      setStatus('to_do');
    }
    setStatusError(null);

    // Zgodnie z wymaganiem: przy dodawaniu zadania blokowanego przez inne dostosuj datę
    // poprzez propozycję daty w dzień zakończenia poprzedzającego zadania
    if (nextBlocking.length > 0) {
      const blockers = allTasks.filter((t) => nextBlocking.includes(t.id));
      let maxBlockerDueDate = '';
      for (const b of blockers) {
        if (b.dueDate && (!maxBlockerDueDate || b.dueDate > maxBlockerDueDate)) {
          maxBlockerDueDate = b.dueDate;
        }
      }
      if (maxBlockerDueDate) {
        setStartDate(maxBlockerDueDate);
        setDueDate(calculateDueDate(maxBlockerDueDate, durationDays));
      }
    }
  };

  if (!isOpen) return null;

  // Other tasks in the same project available to block this task (prevent self-selection)
  const availableBlockers = allTasks.filter(
    (t) => t.projectId === projectId && (!initialTask || t.id !== initialTask.id)
  );

  // Available parent tasks
  const availableParents = allTasks.filter(
    (t) => t.projectId === projectId && (!initialTask || t.id !== initialTask.id) && !t.parentId
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    // If there are blocking tasks that are NOT done yet, status should be blocked
    let finalStatus = status;
    const hasUnfinishedBlockers = blockingTaskIds.some((id) => {
      const blocker = allTasks.find((t) => t.id === id);
      return blocker && blocker.status !== 'done';
    });

    if (hasUnfinishedBlockers && finalStatus !== 'done') {
      finalStatus = 'blocked';
    }

    onSave({
      projectId,
      title,
      description,
      type,
      priority,
      status: finalStatus,
      assigneeId: assigneeId || undefined,
      reporterId: 'usr-1',
      startDate,
      dueDate,
      durationDays: Number(durationDays) || 1,
      isOfficialDeadline,
      estimatedHours: Number(estimatedHours) || 0,
      spentHours: initialTask?.spentHours || 0,
      progress: Number(progress) || 0,
      blockingTaskIds,
      dependencies: blockingTaskIds,
      parentId: parentId || undefined,
      tags,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h3 id={titleId} className="text-sm font-bold text-slate-900">
              {initialTask ? `Edycja zadania [${initialTask.code}]` : 'Nowe Zadanie'}
            </h3>
            <p className="text-[11px] text-slate-600">
              Zarządzanie terminami w dniach, drzewem zależności i zadaniami blokującymi.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno zadania"
            className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Project & Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${baseId}-project`} className="block font-semibold text-slate-700 mb-1">Projekt nadrzędny *</label>
              <select
                id={`${baseId}-project`}
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.key}] {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${baseId}-type`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Typ zadania *</label>
              <select
                id={`${baseId}-type`}
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
                className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {taskTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor={`${baseId}-title`} className="block font-semibold text-slate-700 mb-1">Tytuł zadania *</label>
            <input
              id={`${baseId}-title`}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={FIELD_LIMITS.title}
              placeholder="np. Projekt wykonawczy konstrukcji żelbetowej lub uzgodnienia z rzeczoznawcą ds. PPOŻ"
              className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor={`${baseId}-desc`} className="block font-semibold text-slate-700 mb-1">Opis i kryteria ukończenia</label>
            <textarea
              id={`${baseId}-desc`}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={FIELD_LIMITS.description}
              placeholder="Kryteria akceptacji lub szczegóły wykonania..."
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Priority & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${baseId}-priority`} className="block font-semibold text-slate-700 mb-1">
                Priorytet zadania (Domyślny: Normalny) *
              </label>
              <select
                id={`${baseId}-priority`}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="critical">🔴 Krytyczny (P1 - Blokujący)</option>
                <option value="high">🟠 Wysoki (P2)</option>
                <option value="normal">🔵 Normalny (P3 - Domyślny)</option>
                <option value="low">⚪ Niski (P4)</option>
              </select>
            </div>

            <div>
              <label htmlFor={`${baseId}-status`} className="block font-semibold text-slate-700 mb-1">Status wykonania</label>
              <select
                id={`${baseId}-status`}
                value={status}
                onChange={(e) => {
                  const val = e.target.value as TaskStatus;
                  const hasUnfinished = blockingTaskIds.some((id) => {
                    const b = allTasks.find((t) => t.id === id);
                    return b && b.status !== 'done';
                  });
                  if (hasUnfinished && val !== 'blocked' && val !== 'done') {
                    setStatusError('To zadanie ma nieukończone zadania blokujące. Status wykonania musi pozostać: "Zablokowane", dopóki poprzedzające zadania nie zostaną zakończone.');
                    setStatus('blocked');
                    return;
                  }
                  setStatusError(null);
                  setStatus(val);
                }}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="to_do">Do zrobienia</option>
                <option value="in_progress">W toku</option>
                <option value="review">Do weryfikacji</option>
                <option value="blocked">Zablokowane (Oczekuje na inne zadanie)</option>
                <option value="done">Ukończone</option>
              </select>
            </div>
          </div>

          {statusError && (
            <div role="alert" aria-live="assertive" className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{statusError}</span>
            </div>
          )}

          {/* DURATION IN DAYS & DATES */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <span className="font-semibold text-slate-800 block text-[11px] uppercase tracking-wide">
              Harmonogram & Czas trwania w dniach
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor={`${baseId}-start`} className="block text-[11px] font-semibold text-slate-600 mb-1">Data rozpoczęcia</label>
                <input
                  id={`${baseId}-start`}
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                />
              </div>

              <div>
                <label htmlFor={`${baseId}-duration`} className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Czas trwania (w dniach) *
                </label>
                <div className="flex items-center">
                  <input
                    id={`${baseId}-duration`}
                    type="number"
                    min={1}
                    max={3650}
                    required
                    value={durationDays}
                    onChange={(e) => handleDurationDaysChange(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono font-bold"
                  />
                  <span className="ml-2 font-mono text-slate-600">dni</span>
                </div>
              </div>

              <div>
                <label htmlFor={`${baseId}-due`} className="block text-[11px] font-semibold text-slate-600 mb-1">Termin końcowy (Due Date)</label>
                <input
                  id={`${baseId}-due`}
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => handleDueDateChange(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                />
              </div>
            </div>

            {/* Official Deadline Toggle */}
            <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between">
              <div>
                <label htmlFor={`${baseId}-official`} className="font-semibold text-slate-800 flex items-center gap-1.5 cursor-pointer">
                  <input
                    id={`${baseId}-official`}
                    type="checkbox"
                    checked={isOfficialDeadline}
                    onChange={(e) => setIsOfficialDeadline(e.target.checked)}
                    className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
                  />
                  <span className="text-xs text-red-900 font-bold">Termin urzędowy (rygor prawny / administracyjny)</span>
                </label>
                <p className="text-[10px] text-slate-600 mt-0.5 ml-5.5">
                  Jeśli zaznaczysz tę opcję, zadanie będzie mrugać i alarmować zespół na 3 dni robocze (bez sobót i niedziel) przed upływem terminu.
                </p>
              </div>

              {isOfficialDeadline && (
                <span className="text-[10px] font-bold text-red-800 bg-red-100 px-2 py-0.5 rounded border border-red-200 animate-pulse">
                  Alarm 3 dni robocze
                </span>
              )}
            </div>
          </div>

          {/* BLOCKING TASKS SELECTOR (ZADANIA BLOKUJĄCE) */}
          <div className="p-3.5 bg-amber-50/50 border border-amber-200 rounded-lg space-y-2" role="group" aria-labelledby={`${baseId}-blockers-label`}>
            <div className="flex items-center justify-between">
              <span id={`${baseId}-blockers-label`} className="font-semibold text-amber-950 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                <span>Zadania blokujące to zadanie (Wymagane do wykonania wcześniej)</span>
              </span>
              <span className="text-[10px] text-amber-800 font-semibold">
                {blockingTaskIds.length} wybranych
              </span>
            </div>

            <p className="text-[11px] text-amber-900 leading-relaxed">
              Zadanie otrzyma status <strong>Zablokowane</strong> i jego realizacja będzie możliwa dopiero po ukończeniu poniżej zaznaczonych zadań. Czas tego zadania zostanie przesunięty na moment ukończenia poprzednika.
            </p>

            <div className="max-h-36 overflow-y-auto space-y-1 bg-white p-2 border border-amber-200 rounded">
              {availableBlockers.length === 0 ? (
                <div className="text-[11px] text-slate-600 py-1 italic">
                  Brak innych zadań w tym projekcie do ustawienia jako blokujące.
                </div>
              ) : (
                availableBlockers.map((bTask) => {
                  const isChecked = blockingTaskIds.includes(bTask.id);
                  const isDone = bTask.status === 'done';

                  return (
                    <label
                      key={bTask.id}
                      className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors ${
                        isChecked ? 'bg-amber-100/70 text-amber-950' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleBlockingTask(bTask.id)}
                          className="rounded text-amber-600 focus:ring-0 shrink-0"
                        />
                        <span className="font-mono text-[11px] font-bold text-slate-600 shrink-0">
                          {bTask.code}
                        </span>
                        <span className="truncate">{bTask.title}</span>
                      </div>

                      <span
                        className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                          isDone
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {isDone ? 'Ukończone ✓' : bTask.status}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* PARENT TASK / DRZEWO ZALEŻNOŚCI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${baseId}-parent`} className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <GitMerge className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                <span>Zadanie nadrzędne (Drzewo zależności)</span>
              </label>
              <select
                id={`${baseId}-parent`}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Brak (Zadanie głównego poziomu)</option>
                {availableParents.map((pTask) => (
                  <option key={pTask.id} value={pTask.id}>
                    [{pTask.code}] {pTask.title}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-600 mt-1 block">
                Ukończenie wszystkich podzadań automatycznie zakończy zadanie nadrzędne.
              </span>
            </div>

            <div>
              <label htmlFor={`${baseId}-assignee`} className="block font-semibold text-slate-700 mb-1">Osoba przypisana</label>
              <select
                id={`${baseId}-assignee`}
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Brak przypisania</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label htmlFor={`${baseId}-tags`} className="block font-semibold text-slate-700 mb-1">Etykiety / Tagi (oddzielone przecinkami)</label>
            <input
              id={`${baseId}-tags`}
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="np. Architektura, Konstrukcja, PPOŻ, Pilne"
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors"
            >
              {initialTask ? 'Zapisz zmiany' : 'Utwórz zadanie'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
