import React, { useMemo } from 'react';
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
  ShieldAlert
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

const COLUMNS: { id: TaskStatus; label: string; headerColor: string }[] = [
  { id: 'to_do', label: 'Do zrobienia', headerColor: 'border-slate-300' },
  { id: 'in_progress', label: 'W toku', headerColor: 'border-sky-500' },
  { id: 'review', label: 'Do weryfikacji', headerColor: 'border-purple-500' },
  { id: 'done', label: 'Ukończone', headerColor: 'border-emerald-500' },
  { id: 'blocked', label: 'Zablokowane', headerColor: 'border-rose-500' },
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
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedProjectId && t.projectId !== selectedProjectId) return false;
      return true;
    });
  }, [tasks, selectedProjectId]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'milestone':
        return <Diamond className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />;
      case 'bug':
        return <Bug className="w-3.5 h-3.5 text-rose-500" />;
      case 'feature':
        return <Sparkles className="w-3.5 h-3.5 text-indigo-500" />;
      case 'phase':
        return <Layers className="w-3.5 h-3.5 text-slate-700" />;
      default:
        return <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />;
    }
  };

  const getPriorityLabel = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return <span className="text-rose-600 font-semibold text-[11px]">Krytyczny</span>;
      case 'high':
        return <span className="text-amber-600 font-medium text-[11px]">Wysoki</span>;
      case 'normal':
        return <span className="text-blue-600 font-medium text-[11px]">Normalny</span>;
      case 'low':
        return <span className="text-slate-500 text-[11px]">Niski</span>;
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
        `Zadanie [${task.code}] jest zablokowane! Aby je przenieść, najpierw ukończ zadania blokujące:\n- ` +
          unfinishedBlockers.map((b) => `[${b.code}] ${b.title}`).join('\n- ')
      );
      return;
    }

    onUpdateStatus(task.id, targetStatus);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
      {COLUMNS.map((col) => {
        const colTasks = filteredTasks.filter((t) => t.status === col.id);

        return (
          <div
            key={col.id}
            className="bg-slate-100/70 border border-slate-200/90 rounded-lg p-3 flex flex-col min-h-[450px]"
          >
            {/* Column Header */}
            <div className={`flex items-center justify-between pb-2 mb-2 border-b-2 ${col.headerColor}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">{col.label}</span>
                <span className="text-xs text-slate-500 font-mono tabular-nums bg-slate-200 px-1.5 py-0.2 rounded-full">
                  {colTasks.length}
                </span>
              </div>

              {col.id === 'to_do' && (
                <button
                  onClick={onOpenNewTask}
                  className="text-slate-500 hover:text-slate-900 p-0.5 rounded transition-colors"
                  title="Dodaj zadanie"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Cards in column */}
            <div className="space-y-2.5 flex-1 overflow-y-auto">
              {colTasks.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">Brak zadań</div>
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
                          ? 'task-blocked-style border-slate-300'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                    >
                      {/* Top metadata */}
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          {getTypeIcon(task.type)}
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums font-semibold">
                            {task.code}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isBlocked && (
                            <span className="text-rose-700 bg-rose-100 p-0.5 rounded border border-rose-300 font-bold flex items-center gap-0.5 text-[10px]" title="Zablokowane przez poprzednie zadanie">
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
                              ? 'bg-rose-100 text-rose-800 border-rose-300 shadow-xs'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}
                          title={`Termin urzędowy. Pozostało dni roboczych: ${businessDaysRemaining}`}
                        >
                          <ShieldAlert className={`w-3 h-3 ${isOfficialWarning ? 'text-rose-600 animate-bounce' : 'text-indigo-600'}`} />
                          <span>Termin urzędowy ({businessDaysRemaining} dni rob.)</span>
                        </div>
                      )}

                      {/* Title */}
                      <h4 className="text-xs font-semibold text-slate-900 line-clamp-2 mb-2 group-hover:text-sky-600 transition-colors">
                        {task.title}
                      </h4>

                      {/* Progress bar */}
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-2.5">
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
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="font-mono tabular-nums font-semibold text-slate-700">
                            {task.durationDays || 1}d
                          </span>
                          <span className="text-slate-300">·</span>
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
                            className="text-slate-400 hover:text-sky-600 p-0.5 rounded transition-colors"
                            title="Dodaj do Kalendarza Google"
                          >
                            <Calendar className="w-3.5 h-3.5 text-sky-600" />
                          </a>

                          {assignee && (
                            <div
                              className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center shrink-0"
                              title={assignee.name}
                            >
                              {assignee.initials}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Quick Move Buttons on hover */}
                      <div
                        className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {prevSt ? (
                          <button
                            onClick={() => onUpdateStatus(task.id, prevSt)}
                            className="flex items-center gap-0.5 hover:text-slate-700 p-0.5"
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
                            className="flex items-center gap-0.5 hover:text-slate-900 font-medium text-sky-700 p-0.5 ml-auto"
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
  );
};
