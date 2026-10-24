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
  GitMerge,
  AlertCircle,
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
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'progress' | 'code' | 'durationDays'>('dueDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (selectedProjectId && t.projectId !== selectedProjectId) return false;
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
  }, [tasks, selectedProjectId, statusFilter, priorityFilter, searchQuery, sortBy, sortOrder]);

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
        return (
          <span title="Kamień milowy">
            <Diamond className="w-4 h-4 text-amber-500 fill-amber-500" />
          </span>
        );
      case 'bug':
        return (
          <span title="Błąd">
            <Bug className="w-4 h-4 text-rose-500" />
          </span>
        );
      case 'feature':
        return (
          <span title="Funkcjonalność">
            <Sparkles className="w-4 h-4 text-indigo-500" />
          </span>
        );
      case 'phase':
        return (
          <span title="Faza">
            <Layers className="w-4 h-4 text-slate-700" />
          </span>
        );
      default:
        return (
          <span title="Zadanie">
            <CheckCircle2 className="w-4 h-4 text-sky-600" />
          </span>
        );
    }
  };

  const getPriorityStyle = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return { label: 'Krytyczny', color: 'text-rose-700 font-semibold' };
      case 'high':
        return { label: 'Wysoki', color: 'text-amber-700 font-medium' };
      case 'normal':
        return { label: 'Normalny', color: 'text-blue-700 font-medium' };
      case 'low':
        return { label: 'Niski', color: 'text-slate-500' };
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col overflow-hidden">
      {/* Filtering Toolbar */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-[240px] flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Szukaj zadań po tytule, kodzie lub opisie..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}
            className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="to_do">Do zrobienia</option>
            <option value="in_progress">W toku</option>
            <option value="review">Do weryfikacji</option>
            <option value="blocked">Zablokowane (Blokada)</option>
            <option value="done">Ukończone</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
            className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="all">Wszystkie priorytety</option>
            <option value="critical">Krytyczny (P1)</option>
            <option value="high">Wysoki (P2)</option>
            <option value="normal">Normalny (P3 - Domyślny)</option>
            <option value="low">Niski (P4)</option>
          </select>

          <button
            onClick={onOpenNewTask}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors shadow-xs"
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
            <tr className="border-b border-slate-200 bg-slate-100/80 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">Typ</th>
              <th
                onClick={() => toggleSort('code')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 transition-colors w-24"
              >
                <div className="flex items-center gap-1">
                  <span>Kod</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-4 min-w-[220px]">Tytuł zadania</th>
              <th
                onClick={() => toggleSort('priority')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 transition-colors w-28"
              >
                <div className="flex items-center gap-1">
                  <span>Priorytet</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3 w-36">Status</th>
              <th
                onClick={() => toggleSort('durationDays')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 transition-colors w-24"
              >
                <div className="flex items-center gap-1">
                  <span>Czas (dni)</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3 w-36">Przypisany</th>
              <th
                onClick={() => toggleSort('dueDate')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 transition-colors w-28"
              >
                <div className="flex items-center gap-1">
                  <span>Termin</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th
                onClick={() => toggleSort('progress')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 transition-colors w-28 text-right"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Postęp</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-4 text-right w-36">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-500">
                  Brak zadań spełniających kryteria wyszukiwania.
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => {
                const assignee = users.find((u) => u.id === task.assigneeId);
                const project = projects.find((p) => p.id === task.projectId);
                const priorityInfo = getPriorityStyle(task.priority);
                const gCalUrl = generateGoogleCalendarUrl(task, project);
                const isOverdue = task.dueDate < '2026-10-24' && task.status !== 'done';
                const isBlocked = task.status === 'blocked';
                const isOfficialWarning = isApproachingOfficialDeadline(task);
                const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);

                // Check unfinished blockers
                const blockerIds = task.blockingTaskIds || task.dependencies || [];
                const unfinishedBlockers = tasks.filter(
                  (t) => blockerIds.includes(t.id) && t.status !== 'done'
                );

                return (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task)}
                    className={`cursor-pointer transition-all relative ${
                      isBlocked
                        ? 'task-blocked-style'
                        : 'hover:bg-slate-50/80 bg-white'
                    } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                  >
                    <td className="py-2.5 px-4 text-center">
                      <div className="flex justify-center">{getTypeIcon(task.type)}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 tabular-nums font-medium">
                      <div className="flex items-center gap-1">
                        {task.parentId && <GitMerge className="w-3 h-3 text-slate-400 rotate-90" />}
                        <span>{task.code}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      <div className="flex flex-col">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={isBlocked ? 'text-slate-700 font-semibold' : ''}>{task.title}</span>
                          
                          {/* Official Statutory Deadline Warning */}
                          {task.isOfficialDeadline && (
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${
                                isOfficialWarning
                                  ? 'bg-rose-100 text-rose-800 border-rose-300 shadow-xs'
                                  : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              }`}
                              title={`Termin urzędowy (rygor prawny). Pozostało dni roboczych: ${businessDaysRemaining}`}
                            >
                              <ShieldAlert className={`w-3 h-3 ${isOfficialWarning ? 'text-rose-600 animate-bounce' : 'text-indigo-600'}`} />
                              <span>Termin urzędowy ({businessDaysRemaining} dni roboczych)</span>
                            </span>
                          )}

                          {isBlocked && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 bg-rose-100/90 px-1.5 py-0.5 rounded border border-rose-300 shadow-xs"
                              title={`Zablokowane przez: ${unfinishedBlockers.map((b) => b.code).join(', ')}`}
                            >
                              <Lock className="w-2.5 h-2.5 text-rose-700" />
                              <span>Zablokowane</span>
                            </span>
                          )}
                        </div>
                        {task.tags && task.tags.length > 0 && (
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                            {task.tags.map((tag, i) => (
                              <span key={i}>
                                {i > 0 && <span className="mr-1.5">·</span>}
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={priorityInfo.color}>{priorityInfo.label}</span>
                    </td>
                    <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={task.status}
                        onChange={(e) => {
                          const newSt = e.target.value as TaskStatus;
                          if ((newSt === 'in_progress' || newSt === 'done') && unfinishedBlockers.length > 0) {
                            alert(
                              `Nie można odblokować zadania ${task.code}! Najpierw ukończ zadania blokujące: ${unfinishedBlockers
                                .map((b) => b.code)
                                .join(', ')}`
                            );
                            return;
                          }
                          onUpdateStatus(task.id, newSt);
                        }}
                        className={`text-[11px] font-medium rounded px-2 py-1 border focus:outline-none ${
                          task.status === 'done'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : task.status === 'in_progress'
                            ? 'bg-sky-50 text-sky-800 border-sky-200'
                            : task.status === 'review'
                            ? 'bg-purple-50 text-purple-800 border-purple-200'
                            : task.status === 'blocked'
                            ? 'bg-rose-50 text-rose-800 border-rose-200 font-bold'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        <option value="to_do">Do zrobienia</option>
                        <option value="in_progress">W toku</option>
                        <option value="review">Do weryfikacji</option>
                        <option value="blocked">Zablokowane</option>
                        <option value="done">Ukończone</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 font-medium">
                      {task.durationDays || 1} dni
                    </td>
                    <td className="py-2.5 px-3">
                      {assignee ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {assignee.initials}
                          </div>
                          <span className="truncate text-slate-700">{assignee.name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Nieprzypisany</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] tabular-nums text-slate-600">
                      <span className={isOverdue ? 'text-rose-600 font-bold' : ''}>{task.dueDate}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            style={{ width: `${task.progress}%` }}
                            className={`h-full ${
                              task.status === 'done'
                                ? 'bg-emerald-500'
                                : task.priority === 'critical'
                                ? 'bg-rose-500'
                                : 'bg-sky-500'
                            }`}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-slate-600 w-7">
                          {task.progress}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <a
                          href={gCalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                          title="Dodaj termin do Kalendarza Google"
                        >
                          <Calendar className="w-4 h-4 text-sky-600" />
                        </a>
                        <button
                          onClick={() => onSelectTask(task)}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                          title="Szczegóły / Edycja"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title="Usuń zadanie"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Table Footer Count */}
      <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
        <span className="font-mono tabular-nums">
          Wyświetlanie {filteredTasks.length} z {tasks.length} zadań
        </span>
        <span>Zarządzanie Projektami · Moduł zadań i zależności</span>
      </div>
    </div>
  );
};
