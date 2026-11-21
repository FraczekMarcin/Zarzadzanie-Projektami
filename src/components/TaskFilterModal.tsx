import React, { useId, useRef } from 'react';
import { Task, Project, User } from '../types';
import { 
  X, 
  Lock, 
  AlertCircle, 
  ArrowRight, 
  Briefcase, 
  Clock, 
  CheckCircle2, 
  Calendar 
} from 'lucide-react';
import { isApproachingOfficialDeadline, getBusinessDaysRemaining } from '../utils/businessDays';
import { useFocusTrap } from '../utils/useFocusTrap';

interface TaskFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeFilter: 'blocked' | 'critical';
  onChangeFilter: (filter: 'blocked' | 'critical') => void;
  tasks: Task[];
  projects: Project[];
  users: User[];
  onNavigateToTaskAndProject: (projectId: string, task: Task) => void;
}

export const TaskFilterModal: React.FC<TaskFilterModalProps> = ({
  isOpen,
  onClose,
  activeFilter,
  onChangeFilter,
  tasks,
  projects,
  users,
  onNavigateToTaskAndProject,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap({ isOpen, onClose, containerRef });

  if (!isOpen) return null;

  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const criticalTasks = tasks.filter((t) => t.priority === 'critical' && t.status !== 'done');

  const currentList = activeFilter === 'blocked' ? blockedTasks : criticalTasks;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              activeFilter === 'blocked'
                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
            }`}>
              {activeFilter === 'blocked' ? (
                <Lock className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">
                {activeFilter === 'blocked' ? 'Zadania Zablokowane' : 'Zadania o Priorytecie Krytycznym'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Wybierz zadanie, aby natychmiast przejść do jego projektu i otworzyć szczegóły.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno filtrowanych zadań"
            className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Filter Toggle Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-white dark:bg-slate-900 gap-4 text-xs font-semibold" role="tablist" aria-label="Kategoria zadań">
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'blocked'}
            onClick={() => onChangeFilter('blocked')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
              activeFilter === 'blocked'
                ? 'border-amber-600 dark:border-amber-500 text-amber-900 dark:text-amber-300 font-bold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            <span>Zablokowane ({blockedTasks.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'critical'}
            onClick={() => onChangeFilter('critical')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
              activeFilter === 'critical'
                ? 'border-rose-600 dark:border-rose-500 text-rose-900 dark:text-rose-300 font-bold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
            <span>Krytyczne ({criticalTasks.length})</span>
          </button>
        </div>

        {/* Task List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {currentList.length === 0 ? (
            <div className="text-center py-12 text-slate-600 dark:text-slate-400 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-2 opacity-90" aria-hidden="true" />
              <span>Brak zadań w wybranej kategorii. Wszystko przebiega zgodnie z planem!</span>
            </div>
          ) : (
            currentList.map((task) => {
              const project = projects.find((p) => p.id === task.projectId);
              const assignee = users.find((u) => u.id === task.assigneeId);
              const blockerIds = task.blockingTaskIds || task.dependencies || [];
              const unfinishedBlockers = tasks.filter(
                (t) => blockerIds.includes(t.id) && t.status !== 'done'
              );
              const isOfficialWarning = isApproachingOfficialDeadline(task);
              const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);

              return (
                <div
                  key={task.id}
                  className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-500 rounded-lg p-4 shadow-xs hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      {/* Project Link Badge */}
                      {project && (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-sky-800 dark:text-sky-200 bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                          <Briefcase className="w-3 h-3 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                          <span>[{project.key}] {project.name}</span>
                        </span>
                      )}

                      {/* Task Code */}
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 font-semibold">
                        {task.code}
                      </span>

                      {/* Status / Blocker Badge */}
                      {task.status === 'blocked' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-200 dark:border-rose-800">
                          <Lock className="w-2.5 h-2.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                          <span>Zablokowane</span>
                        </span>
                      )}

                      {task.priority === 'critical' && (
                        <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-200 dark:border-rose-800">
                          Krytyczny
                        </span>
                      )}

                      {task.isOfficialDeadline && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                          isOfficialWarning
                            ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700 animate-pulse'
                            : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                        }`}>
                          Termin urzędowy ({businessDaysRemaining} dni rob.)
                        </span>
                      )}
                    </div>

                    {/* Task Title */}
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                      {task.title}
                    </h4>

                    {/* Additional info */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 mt-2">
                      <div className="flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                        <span>{task.durationDays || 1} dni</span>
                      </div>
                      <div className="flex items-center gap-1 font-mono">
                        <Calendar className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                        <span>Termin: {task.dueDate}</span>
                      </div>
                      {assignee && (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-600 dark:text-slate-400">Przypisany:</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">{assignee.name}</span>
                        </div>
                      )}
                    </div>

                    {/* Blocked by explanation */}
                    {task.status === 'blocked' && unfinishedBlockers.length > 0 && (
                      <div className="mt-2 text-[11px] text-rose-800 dark:text-rose-200 bg-rose-50/70 dark:bg-rose-950/40 p-2 rounded border border-rose-100 dark:border-rose-800">
                        <span className="font-bold">Oczekuje na ukończenie poprzedników: </span>
                        {unfinishedBlockers.map((b) => `[${b.code}] ${b.title}`).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Navigation Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (project) {
                        onNavigateToTaskAndProject(project.id, task);
                        onClose();
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 bg-slate-900 dark:bg-sky-700 hover:bg-sky-600 dark:hover:bg-sky-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0 shadow-xs"
                  >
                    <span>Przejdź do projektu</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>Łącznie zadań: {currentList.length}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
