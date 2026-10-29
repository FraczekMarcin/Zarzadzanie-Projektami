import React, { useState, useEffect } from 'react';
import { Task, Project, User, Priority, TaskType, TaskStatus } from '../types';
import { X, Calendar, UserCheck, AlertTriangle, Layers, Clock, Lock, GitMerge } from 'lucide-react';
import { getTaskTypes, TaskTypeDefinition } from '../utils/variableSettings';

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
  const [startDate, setStartDate] = useState(defaultDate || '2026-10-24');
  const [durationDays, setDurationDays] = useState<number>(7);
  const [dueDate, setDueDate] = useState(defaultDate || '2026-10-31');
  const [estimatedHours, setEstimatedHours] = useState(16);
  const [progress, setProgress] = useState(0);
  const [tagsInput, setTagsInput] = useState('');
  const [blockingTaskIds, setBlockingTaskIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState<string>('');
  const [isOfficialDeadline, setIsOfficialDeadline] = useState<boolean>(false);

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
      const sDate = defaultDate || '2026-10-24';
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
    if (blockingTaskIds.includes(taskId)) {
      setBlockingTaskIds(blockingTaskIds.filter((id) => id !== taskId));
    } else {
      setBlockingTaskIds([...blockingTaskIds, taskId]);
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
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {initialTask ? `Edycja zadania [${initialTask.code}]` : 'Nowe Zadanie'}
            </h3>
            <p className="text-[11px] text-slate-500">
              Zarządzanie terminami w dniach, drzewem zależności i zadaniami blokującymi.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Project & Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Projekt nadrzędny *</label>
              <select
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
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Typ zadania *</label>
              <select
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
            <label className="block font-semibold text-slate-700 mb-1">Tytuł zadania *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="np. Przygotowanie schematów PostgreSQL i procedury kopii zapasowej"
              className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Opis i kryteria ukończenia</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kryteria akceptacji lub szczegóły wykonania..."
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Priority & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Priorytet zadania (Domyślny: Normalny) *
              </label>
              <select
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
              <label className="block font-semibold text-slate-700 mb-1">Status wykonania</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
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

          {/* DURATION IN DAYS & DATES */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <span className="font-semibold text-slate-800 block text-[11px] uppercase tracking-wide">
              Harmonogram & Czas trwania w dniach
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Data rozpoczęcia</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Czas trwania (w dniach) *
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={durationDays}
                    onChange={(e) => handleDurationDaysChange(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono font-bold"
                  />
                  <span className="ml-2 font-mono text-slate-500">dni</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Termin końcowy (Due Date)</label>
                <input
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
                <label className="font-semibold text-slate-800 flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOfficialDeadline}
                    onChange={(e) => setIsOfficialDeadline(e.target.checked)}
                    className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
                  />
                  <span className="text-xs text-red-900 font-bold">Termin urzędowy (rygor prawny / administracyjny)</span>
                </label>
                <p className="text-[10px] text-slate-500 mt-0.5 ml-5.5">
                  Jeśli zaznaczysz tę opcję, zadanie będzie mrugać i alarmować zespół na 3 dni robocze (bez sobót i niedziel) przed upływem terminu.
                </p>
              </div>

              {isOfficialDeadline && (
                <span className="text-[10px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-200 animate-pulse">
                  Alarm 3 dni robocze
                </span>
              )}
            </div>
          </div>

          {/* BLOCKING TASKS SELECTOR (ZADANIA BLOKUJĄCE) */}
          <div className="p-3.5 bg-amber-50/50 border border-amber-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-amber-950 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span>Zadania blokujące to zadanie (Wymagane do wykonania wcześniej)</span>
              </label>
              <span className="text-[10px] text-amber-700">
                {blockingTaskIds.length} wybranych
              </span>
            </div>

            <p className="text-[11px] text-amber-900 leading-relaxed">
              Zadanie otrzyma status <strong>Zablokowane</strong> i jego realizacja będzie możliwa dopiero po ukończeniu poniżej zaznaczonych zadań. Czas tego zadania zostanie przesunięty na moment ukończenia poprzednika.
            </p>

            <div className="max-h-36 overflow-y-auto space-y-1 bg-white p-2 border border-amber-200 rounded">
              {availableBlockers.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-1 italic">
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
                        <span className="font-mono text-[11px] font-bold text-slate-500 shrink-0">
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
              <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <GitMerge className="w-3.5 h-3.5 text-slate-400" />
                <span>Zadanie nadrzędne (Drzewo zależności)</span>
              </label>
              <select
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
              <span className="text-[10px] text-slate-400 mt-1 block">
                Ukończenie wszystkich podzadań automatycznie zakończy zadanie nadrzędne.
              </span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Osoba przypisana</label>
              <select
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
            <label className="block font-semibold text-slate-700 mb-1">Etykiety / Tagi (oddzielone przecinkami)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="np. Backend, PostgreSQL, Pilne"
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
