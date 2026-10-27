import React, { useState, useMemo } from 'react';
import { Task, Project, User, Priority, TaskStatus } from '../types';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { 
  Search, 
  Calendar, 
  ExternalLink, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Diamond, 
  Bug, 
  Sparkles, 
  Layers, 
  Trash2, 
  Edit3, 
  Plus,
  ArrowUpDown,
  Filter,
  Lock,
  RotateCcw,
  ShieldAlert
} from 'lucide-react';
import { isApproachingOfficialDeadline, getBusinessDaysRemaining } from '../utils/businessDays';

interface TaskListViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  selectedProjectId: string | null;
  onSelectTask: (task: Task) => void;
  onOpenNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateStatus: (taskId: string, newStatus: TaskStatus) => void;
}

export const TaskListView: React.FC<TaskListViewProps> = ({
  tasks,
  projects,
  users,
  selectedProjectId,
  onSelectTask,
  onOpenNewTask,
  onDeleteTask,
  onUpdateStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'progress' | 'code' | 'durationDays'>('dueDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Counts
  const projectTasks = useMemo(() => {
    return tasks.filter((t) => !selectedProjectId || t.projectId === selectedProjectId);
  }, [tasks, selectedProjectId]);

  const activeCount = useMemo(() => projectTasks.filter((t) => t.status !== 'done').length, [projectTasks]);
  const completedCount = useMemo(() => projectTasks.filter((t) => t.status === 'done').length, [projectTasks]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return projectTasks
      .filter((t) => {
        // Separation of completed tasks:
        if (viewFilter === 'active' && t.status === 'done') return false;
        if (viewFilter === 'completed' && t.status !== 'done') return false;

        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesTitle = t.title.toLowerCase().includes(q);
          const matchesCode = t.code.toLowerCase().includes(q);
          const matchesDesc = t.description?.toLowerCase().includes(q);
          if (!matchesTitle && !matchesCode && !matchesDesc) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA: any = a[sortBy];
        let valB: any = b[sortBy];

        if (sortBy === 'priority') {
          const weights: Record<Priority, number> = { critical: 4, high: 3, normal: 2, low: 1 };
          valA = weights[a.priority];
          valB = weights[b.priority];
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [projectTasks, viewFilter, statusFilter, priorityFilter, searchQuery, sortBy, sortOrder]);

  const toggleSort = (field: 'dueDate' | 'priority' | 'progress' | 'code' | 'durationDays') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'milestone':
        return <Diamond className="w-4 h-4 text-amber-500 fill-amber-500" />;
      case 'bug':
        return <Bug className="w-4 h-4 text-rose-500" />;
      case 'feature':
        return <Sparkles className="w-4 h-4 text-indigo-500" />;
      case 'phase':
        return <Layers className="w-4 h-4 text-slate-700 dark:text-slate-300" />;
      default:
        return <CheckCircle2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />;
    }
  };

  const getPriorityStyle = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return { label: 'Krytyczny', color: 'text-rose-700 dark:text-rose-400 font-semibold' };
      case 'high':
        return { label: 'Wysoki', color: 'text-amber-700 dark:text-amber-400 font-medium' };
      case 'normal':
        return { label: 'Normalny', color: 'text-blue-700 dark:text-blue-400 font-medium' };
      case 'low':
        return { label: 'Niski', color: 'text-slate-500 dark:text-slate-400' };
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'to_do':
        return <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-200 dark:border-slate-700">Do zrobienia</span>;
      case 'in_progress':
        return <span className="bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded text-[11px] font-medium border border-sky-200 dark:border-sky-800">W toku</span>;
      case 'review':
        return <span className="bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded text-[11px] font-medium border border-purple-200 dark:border-purple-800">Do weryfikacji</span>;
      case 'done':
        return <span className="bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded text-[11px] font-medium border border-emerald-200 dark:border-emerald-800">Ukończone</span>;
      case 'blocked':
        return <span className="bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded text-[11px] font-medium border border-rose-200 dark:border-rose-800">Zablokowane</span>;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden">
      {/* Top Segmented Tabs: Aktywne vs Ukończone */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setViewFilter('active')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors ${
              viewFilter === 'active'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <span>Aktywne zadania</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              viewFilter === 'active' ? 'bg-sky-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}>
              {activeCount}
            </span>
          </button>

          <button
            onClick={() => setViewFilter('completed')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors ${
              viewFilter === 'completed'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Wyróżnik: Ukończone</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              viewFilter === 'completed' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
            }`}>
              {completedCount}
            </span>
          </button>

          <button
            onClick={() => setViewFilter('all')}
            className={`px-2.5 py-1.5 rounded text-xs transition-colors ${
              viewFilter === 'all'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            Wszystkie ({projectTasks.length})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj zadania lub kodu..."
            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Status Filter */}
          {viewFilter === 'all' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300"
            >
              <option value="all">Wszystkie statusy</option>
              <option value="to_do">Do zrobienia</option>
              <option value="in_progress">W toku</option>
              <option value="review">Do weryfikacji</option>
              <option value="blocked">Zablokowane</option>
              <option value="done">Ukończone</option>
            </select>
          )}

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300"
          >
            <option value="all">Wszystkie priorytety</option>
            <option value="critical">Krytyczny (P1)</option>
            <option value="high">Wysoki (P2)</option>
            <option value="normal">Normalny (P3)</option>
            <option value="low">Niski (P4)</option>
          </select>

          <button
            onClick={onOpenNewTask}
            className="flex items-center gap-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* High Density Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">Typ</th>
              <th
                onClick={() => toggleSort('code')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-24"
              >
                <div className="flex items-center gap-1">
                  <span>Kod</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-4 min-w-[220px]">Tytuł zadania</th>
              <th
                onClick={() => toggleSort('priority')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-28"
              >
                <div className="flex items-center gap-1">
                  <span>Priorytet</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3 w-36">Status</th>
              <th
                onClick={() => toggleSort('durationDays')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-24"
              >
                <div className="flex items-center gap-1">
                  <span>Czas (dni)</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3 w-36">Przypisany</th>
              <th
                onClick={() => toggleSort('dueDate')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-28"
              >
                <div className="flex items-center gap-1">
                  <span>Termin</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th
                onClick={() => toggleSort('progress')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-28 text-right"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Postęp</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-4 text-right w-36">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  {viewFilter === 'completed'
                    ? 'Brak ukończonych zadań w tym widoku.'
                    : 'Brak aktywnych zadań spełniających kryteria wyszukiwania.'}
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => {
                const assignee = users.find((u) => u.id === task.assigneeId);
                const project = projects.find((p) => p.id === task.projectId);
                const priorityMeta = getPriorityStyle(task.priority);
                const isOverdue = task.dueDate < '2026-10-24' && task.status !== 'done';
                const isBlocked = task.status === 'blocked';
                const isOfficialWarning = isApproachingOfficialDeadline(task);
                const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);
                const gCalUrl = generateGoogleCalendarUrl(task, project);

                return (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task)}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${
                      isBlocked ? 'task-blocked-style' : ''
                    } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                  >
                    <td className="py-2.5 px-4 text-center">
                      <div className="flex items-center justify-center">
                        {getTypeIcon(task.type)}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-600 dark:text-slate-400">
                      {task.code}
                    </td>

                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <span>{task.title}</span>
                        {task.isOfficialDeadline && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                              isOfficialWarning
                                ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800'
                                : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                            }`}
                            title={`Termin urzędowy. Pozostało ${businessDaysRemaining} dni roboczych`}
                          >
                            Urzędowy ({businessDaysRemaining}d)
                          </span>
                        )}
                        {isBlocked && (
                          <span className="text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 px-1 py-0.2 rounded flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Blokada</span>
                          </span>
                        )}
                      </div>
                      {project && (
                        <div className="text-[11px] text-slate-400">
                          {project.key} · {project.name}
                        </div>
                      )}
                    </td>

                    <td className={`py-2.5 px-3 ${priorityMeta.color}`}>
                      {priorityMeta.label}
                    </td>

                    <td className="py-2.5 px-3">
                      {getStatusBadge(task.status)}
                    </td>

                    <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300 font-bold">
                      {task.durationDays || 1} dni
                    </td>

                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {assignee ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center">
                            {assignee.initials}
                          </div>
                          <span className="truncate max-w-[100px]">{assignee.name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Nieprzypisane</span>
                      )}
                    </td>

                    <td className={`py-2.5 px-3 font-mono ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                      {task.dueDate}
                    </td>

                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono text-slate-700 dark:text-slate-300">{task.progress}%</span>
                        <div className="w-12 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            style={{ width: `${task.progress}%` }}
                            className={`h-full ${
                              task.status === 'done'
                                ? 'bg-emerald-500'
                                : isBlocked
                                ? 'bg-rose-500'
                                : 'bg-sky-500'
                            }`}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {task.status === 'done' ? (
                          <button
                            onClick={() => onUpdateStatus(task.id, 'in_progress')}
                            className="p-1 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded transition-colors"
                            title="Przywróć zadanie do aktywnych"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => onUpdateStatus(task.id, 'done')}
                            className="p-1 text-slate-400 hover:text-emerald-600 rounded transition-colors"
                            title="Oznacz jako ukończone"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <a
                          href={gCalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-400 hover:text-sky-600 rounded transition-colors"
                          title="Eksportuj do Google Calendar"
                        >
                          <Calendar className="w-3.5 h-3.5 text-sky-600" />
                        </a>

                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                          title="Usuń zadanie"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
