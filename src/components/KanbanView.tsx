import React, { useState, useMemo } from 'react';
import { Task, Project, User, TaskStatus, Priority } from '../types';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { 
  Plus, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Diamond, 
  Bug, 
  Sparkles, 
  Layers, 
  ArrowRight,
  ArrowLeft,
  Lock,
  ShieldAlert,
  RotateCcw,
  Check,
  Eye,
  Filter
} from 'lucide-react';
import { isApproachingOfficialDeadline, getBusinessDaysRemaining } from '../utils/businessDays';

interface KanbanViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  selectedProjectId: string | null;
  onSelectTask: (task: Task) => void;
  onOpenNewTask: () => void;
  onUpdateStatus: (taskId: string, newStatus: TaskStatus) => void;
}

const ALL_COLUMNS: { id: TaskStatus; label: string; headerColor: string; isCompletedCol?: boolean }[] = [
  { id: 'to_do', label: 'Do zrobienia', headerColor: 'border-slate-300 dark:border-slate-700' },
  { id: 'in_progress', label: 'W toku', headerColor: 'border-sky-500' },
  { id: 'review', label: 'Do weryfikacji', headerColor: 'border-purple-500' },
  { id: 'blocked', label: 'Zablokowane', headerColor: 'border-rose-500' },
  { id: 'done', label: 'Ukończone', headerColor: 'border-emerald-500', isCompletedCol: true },
];

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  projects,
  users,
  selectedProjectId,
  onSelectTask,
  onOpenNewTask,
  onUpdateStatus,
}) => {
  // Mode: 'active' (completed tasks removed from board), 'completed' (view dedicated to done tasks), 'all_columns' (include column 5)
  const [viewTab, setViewTab] = useState<'active' | 'completed'>('active');
  const [showDoneColumnOnBoard, setShowDoneColumnOnBoard] = useState(false);

  const projectTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedProjectId && t.projectId !== selectedProjectId) return false;
      return true;
    });
  }, [tasks, selectedProjectId]);

  const activeTasks = useMemo(() => projectTasks.filter((t) => t.status !== 'done'), [projectTasks]);
  const completedTasks = useMemo(() => projectTasks.filter((t) => t.status === 'done'), [projectTasks]);

  // Which columns to display on the board
  const activeColumns = useMemo(() => {
    if (showDoneColumnOnBoard) {
      return ALL_COLUMNS;
    }
    return ALL_COLUMNS.filter((c) => !c.isCompletedCol);
  }, [showDoneColumnOnBoard]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'milestone':
        return <Diamond className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />;
      case 'bug':
        return <Bug className="w-3.5 h-3.5 text-rose-500" />;
      case 'feature':
        return <Sparkles className="w-3.5 h-3.5 text-indigo-500" />;
      case 'phase':
        return <Layers className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />;
      default:
        return <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />;
    }
  };

  const getPriorityLabel = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return <span className="text-rose-600 dark:text-rose-400 font-semibold text-[11px]">Krytyczny</span>;
      case 'high':
        return <span className="text-amber-600 dark:text-amber-400 font-medium text-[11px]">Wysoki</span>;
      case 'normal':
        return <span className="text-blue-600 dark:text-blue-400 font-medium text-[11px]">Normalny</span>;
      case 'low':
        return <span className="text-slate-500 dark:text-slate-400 text-[11px]">Niski</span>;
    }
  };

  const getNextStatus = (current: TaskStatus): TaskStatus | null => {
    const order: TaskStatus[] = ['to_do', 'in_progress', 'review', 'done'];
    const idx = order.indexOf(current);
    if (idx >= 0 && idx < order.length - 1) return order[idx + 1];
    return null;
  };

  const getPrevStatus = (current: TaskStatus): TaskStatus | null => {
    const order: TaskStatus[] = ['to_do', 'in_progress', 'review', 'done'];
    const idx = order.indexOf(current);
    if (idx > 0) return order[idx - 1];
    return null;
  };

  const handleMoveStatus = (task: Task, targetStatus: TaskStatus) => {
    const blockerIds = task.blockingTaskIds || task.dependencies || [];
    const unfinishedBlockers = tasks.filter(
      (t) => blockerIds.includes(t.id) && t.status !== 'done'
    );

    if (unfinishedBlockers.length > 0 && (targetStatus === 'in_progress' || targetStatus === 'done')) {
      alert(
        `Nie można przesunąć zadania "${task.title}".\nJest ono zablokowane przez ${unfinishedBlockers.length} niezakończone zadania.`
      );
      return;
    }

    onUpdateStatus(task.id, targetStatus);
  };

  const handleRevertCompleted = (taskId: string) => {
    onUpdateStatus(taskId, 'in_progress');
  };

  return (
    <div className="space-y-4">
      {/* Top filter bar: Aktywne vs Wyróżnik Ukończone */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 px-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setViewTab('active')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
              viewTab === 'active'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Aktywne zadania</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              viewTab === 'active' ? 'bg-sky-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}>
              {activeTasks.length}
            </span>
          </button>

          <button
            onClick={() => setViewTab('completed')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
              viewTab === 'completed'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Wyróżnik: Ukończone</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              viewTab === 'completed' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
            }`}>
              {completedTasks.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {viewTab === 'active' && (
            <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-400 select-none">
              <input
                type="checkbox"
                checked={showDoneColumnOnBoard}
                onChange={(e) => setShowDoneColumnOnBoard(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>Pokaż kolumnę "Ukończone" na tablicy</span>
            </label>
          )}

          <button
            onClick={onOpenNewTask}
            className="flex items-center gap-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* VIEW TAB 1: KANBAN BOARD FOR ACTIVE TASKS */}
      {viewTab === 'active' && (
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${activeColumns.length} gap-4 items-start`}>
          {activeColumns.map((col) => {
            const colTasks = projectTasks.filter((t) => t.status === col.id);

            return (
              <div
                key={col.id}
                className="bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 rounded-lg p-3 flex flex-col min-h-[460px]"
              >
                {/* Column Header */}
                <div className={`flex items-center justify-between pb-2 mb-2 border-b-2 ${col.headerColor}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{col.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 rounded-full">
                      {colTasks.length}
                    </span>
                  </div>

                  {col.id === 'to_do' && (
                    <button
                      onClick={onOpenNewTask}
                      className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 p-0.5 rounded transition-colors"
                      title="Dodaj zadanie"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Cards in column */}
                <div className="space-y-2.5 flex-1 overflow-y-auto">
                  {colTasks.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      Brak zadań w tej kolumnie
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const assignee = users.find((u) => u.id === task.assigneeId);
                      const project = projects.find((p) => p.id === task.projectId);
                      const isOverdue = task.dueDate < '2026-10-24' && task.status !== 'done';
                      const isBlocked = task.status === 'blocked';
                      const isOfficialWarning = isApproachingOfficialDeadline(task);
                      const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);
                      const gCalUrl = generateGoogleCalendarUrl(task, project);

                      const nextSt = getNextStatus(task.status);
                      const prevSt = getPrevStatus(task.status);

                      return (
                        <div
                          key={task.id}
                          onClick={() => onSelectTask(task)}
                          className={`rounded-md p-3 shadow-xs hover:shadow-sm cursor-pointer transition-all group relative border ${
                            isBlocked
                              ? 'task-blocked-style border-slate-300 dark:border-slate-700'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                        >
                          {/* Top metadata */}
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              {getTypeIcon(task.type)}
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums font-semibold">
                                {task.code}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isBlocked && (
                                <span className="text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/60 p-0.5 rounded border border-rose-300 dark:border-rose-800 font-bold flex items-center gap-0.5 text-[10px]">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>Zablokowane</span>
                                </span>
                              )}
                              {getPriorityLabel(task.priority)}
                            </div>
                          </div>

                          {/* Official Deadline Alert Badge */}
                          {task.isOfficialDeadline && (
                            <div
                              className={`mb-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                isOfficialWarning
                                  ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800 shadow-xs'
                                  : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                              }`}
                              title={`Termin urzędowy. Pozostało dni roboczych: ${businessDaysRemaining}`}
                            >
                              <ShieldAlert className={`w-3 h-3 ${isOfficialWarning ? 'text-rose-600 animate-bounce' : 'text-indigo-600'}`} />
                              <span>Termin urzędowy ({businessDaysRemaining} dni rob.)</span>
                            </div>
                          )}

                          {/* Title */}
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2 mb-2 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                            {task.title}
                          </h4>

                          {/* Progress bar */}
                          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden mb-2.5">
                            <div
                              style={{ width: `${task.progress}%` }}
                              className={`h-full ${
                                task.status === 'done'
                                  ? 'bg-emerald-500'
                                  : isBlocked
                                  ? 'bg-rose-500'
                                  : task.priority === 'critical'
                                  ? 'bg-rose-500'
                                  : 'bg-sky-500'
                              }`}
                            />
                          </div>

                          {/* Bottom Footer: Duration in days, Dates, Google Calendar link, Assignee */}
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                                {task.durationDays || 1}d
                              </span>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className={`font-mono tabular-nums ${isOverdue ? 'text-rose-600 font-bold' : ''}`}>
                                {task.dueDate.slice(5)}
                              </span>
                              {isOverdue && (
                                <span title="Termin minął!">
                                  <AlertCircle className="w-3 h-3 text-rose-600 ml-0.5" />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <a
                                href={gCalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 p-0.5 rounded transition-colors"
                                title="Dodaj do Kalendarza Google"
                              >
                                <Calendar className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                              </a>

                              {assignee && (
                                <div
                                  className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center shrink-0"
                                  title={assignee.name}
                                >
                                  {assignee.initials}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Quick Move Buttons */}
                          <div
                            className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {prevSt ? (
                              <button
                                onClick={() => onUpdateStatus(task.id, prevSt)}
                                className="flex items-center gap-0.5 hover:text-slate-700 dark:hover:text-slate-200 p-0.5"
                                title="Cofnij status"
                              >
                                <ArrowLeft className="w-3 h-3" />
                                <span>Cofnij</span>
                              </button>
                            ) : (
                              <div />
                            )}

                            {nextSt && (
                              <button
                                onClick={() => handleMoveStatus(task, nextSt)}
                                className="flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white font-medium text-sky-700 dark:text-sky-400 p-0.5 ml-auto"
                                title="Przesuń dalej"
                              >
                                <span>Dalej</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW TAB 2: DEDICATED COMPLETED TASKS (WYRÓŻNIK: UKOŃCZONE) */}
      {viewTab === 'completed' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Wyróżnik Zadań Ukończonych</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-mono font-bold">
                  {completedTasks.length} pozycji
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ukończone zadania zostały przeniesione z podstawowego widoku, aby zapewnić czystość i czytelność aktywnej tablicy.
              </p>
            </div>
          </div>

          {completedTasks.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
              <p>Brak ukończonych zadań w tym widoku.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              {completedTasks.map((task) => {
                const assignee = users.find((u) => u.id === task.assigneeId);
                const project = projects.find((p) => p.id === task.projectId);

                return (
                  <div
                    key={task.id}
                    className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between gap-4 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                        <Check className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400">
                            {task.code}
                          </span>
                          <span
                            onClick={() => onSelectTask(task)}
                            className="text-xs font-bold text-slate-900 dark:text-white hover:text-sky-600 dark:hover:text-sky-400 cursor-pointer"
                          >
                            {task.title}
                          </span>
                          {project && (
                            <span className="text-[10px] text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                              {project.name.slice(0, 25)}...
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3 mt-1">
                          <span>Termin: {task.dueDate}</span>
                          <span>Czas: {task.durationDays} dni</span>
                          {assignee && <span>Wykonawca: {assignee.name}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRevertCompleted(task.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/50 border border-sky-200 dark:border-sky-800 rounded font-medium transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Przywróć do aktywnych</span>
                      </button>

                      <button
                        onClick={() => onSelectTask(task)}
                        className="px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                      >
                        Szczegóły
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
