import React, { useState, useMemo } from 'react';
import { Task, Project, User, Priority, TaskStatus } from '../types';
import { 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  Layers, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Lock, 
  GitMerge, 
  GitBranch, 
  Search, 
  Folder, 
  Copy, 
  Check, 
  Building2,
  Calendar,
  ExternalLink,
  Filter,
  Flame,
  Hourglass
} from 'lucide-react';
import { getDeadlineWarningDays } from '../utils/variableSettings';

interface TaskTreeViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectTask: (task: Task) => void;
  onAddTask: (projectId: string, parentTaskId?: string) => void;
  onUpdateTaskStatus?: (taskId: string, status: TaskStatus) => void;
}

interface TreeNode {
  task: Task;
  children: TreeNode[];
  level: number;
}

export const TaskTreeView: React.FC<TaskTreeViewProps> = ({
  tasks,
  projects,
  users,
  selectedProjectId,
  onSelectProject,
  onSelectTask,
  onAddTask,
  onUpdateTaskStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => {
    // By default expand all root tasks
    return new Set(tasks.map((t) => t.id));
  });
  const [copiedDiskPath, setCopiedDiskPath] = useState(false);

  // Active project
  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  // Filter tasks belonging to current project (or all if none)
  const projectTasks = useMemo(() => {
    if (!currentProject) return tasks;
    return tasks.filter((t) => t.projectId === currentProject.id);
  }, [tasks, currentProject]);

  // Build tree structure
  const treeNodes = useMemo(() => {
    const taskMap = new Map<string, Task>();
    projectTasks.forEach((t) => taskMap.set(t.id, t));

    // Find roots: tasks with no parentId OR parentId not in this project
    const rootTasks: Task[] = [];
    const childrenMap = new Map<string, Task[]>();

    projectTasks.forEach((task) => {
      if (task.parentId && taskMap.has(task.parentId)) {
        const arr = childrenMap.get(task.parentId) || [];
        arr.push(task);
        childrenMap.set(task.parentId, arr);
      } else {
        rootTasks.push(task);
      }
    });

    const buildNode = (task: Task, level: number): TreeNode => {
      const childTasks = childrenMap.get(task.id) || [];
      return {
        task,
        children: childTasks.map((ct) => buildNode(ct, level + 1)),
        level,
      };
    };

    return rootTasks.map((rt) => buildNode(rt, 0));
  }, [projectTasks]);

  // Expand / collapse all
  const handleExpandAll = () => {
    setExpandedNodeIds(new Set(projectTasks.map((t) => t.id)));
  };

  const handleCollapseAll = () => {
    setExpandedNodeIds(new Set());
  };

  const toggleNode = (taskId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleCopyDiskPath = () => {
    if (!currentProject?.diskPath) return;
    navigator.clipboard.writeText(currentProject.diskPath);
    setCopiedDiskPath(true);
    setTimeout(() => setCopiedDiskPath(false), 2000);
  };

  const getPriorityBadge = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">Krytyczny</span>;
      case 'high':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">Wysoki</span>;
      case 'low':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">Niski</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800">Normalny</span>;
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'done':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Ukończone</span>;
      case 'in_progress':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">W toku</span>;
      case 'blocked':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">Zablokowane</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Do zrobienia</span>;
    }
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: TreeNode) => {
    const { task, children, level } = node;
    const isExpanded = expandedNodeIds.has(task.id);
    const hasChildren = children.length > 0;
    const assignee = users.find((u) => u.id === task.assigneeId);

    // Filter match test
    const matchesSearch = !searchQuery || 
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      task.code.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;

    if (!matchesSearch || !matchesStatus) {
      // If parent does not match, but children might, render matching children
      const matchingChildren = children.filter((c) => {
        return (
          (!searchQuery || c.task.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.task.code.toLowerCase().includes(searchQuery.toLowerCase())) &&
          (statusFilter === 'all' || c.task.status === statusFilter)
        );
      });

      if (matchingChildren.length === 0) return null;
    }

    const warningDays = getDeadlineWarningDays();
    const today = new Date().toISOString().slice(0, 10);
    const dueTime = new Date((task.dueDate || today) + 'T00:00:00').getTime();
    const nowTime = new Date(today + 'T00:00:00').getTime();
    const diffDays = Math.ceil((dueTime - nowTime) / (1000 * 60 * 60 * 24));

    const isOverdue = task.status !== 'done' && (task.dueDate ? task.dueDate < today : false);
    const isApproaching = task.status !== 'done' && !isOverdue && diffDays >= 0 && diffDays <= warningDays;

    let cardStyle = '';
    if (isOverdue) {
      // Zadania których termin minął: tło mruga na czerwono
      cardStyle = 'bg-rose-500/20 dark:bg-rose-950/70 border-rose-500 animate-pulse text-rose-950 dark:text-rose-100 ring-2 ring-rose-500/60 shadow-md';
    } else if (isApproaching) {
      // Zadania zbliżające się: obwiednia mruga
      cardStyle = 'border-2 border-amber-500 ring-2 ring-amber-400 animate-pulse bg-amber-50/50 dark:bg-amber-950/30';
    } else if (level === 0) {
      cardStyle = 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs hover:border-sky-400 dark:hover:border-sky-600';
    } else {
      cardStyle = 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800';
    }

    return (
      <div key={task.id} className="relative">
        {/* Node card */}
        <div 
          className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all mb-2 ${cardStyle}`}
          style={{ marginLeft: `${level * 24}px` }}
        >
          {/* Left Column: Branch Expander, Code, Title & Hierarchy info */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {/* Expand / Collapse Button */}
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleNode(task.id)}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors shrink-0"
                title={isExpanded ? 'Zwiń podgałęzie' : 'Rozwiń podgałęzie'}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                )}
              </button>
            ) : (
              <span className="w-6 h-6 flex items-center justify-center text-slate-300 dark:text-slate-700 shrink-0">
                •
              </span>
            )}

            {/* Task Code */}
            <span 
              onClick={() => onSelectTask(task)}
              className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer shrink-0"
            >
              [{task.code}]
            </span>

            {/* Official deadline flag */}
            {task.isOfficialDeadline && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800 shrink-0">
                🏛️ Urzędowy
              </span>
            )}

            {/* Title */}
            <span 
              onClick={() => onSelectTask(task)}
              className="text-xs font-semibold text-slate-900 dark:text-white truncate cursor-pointer hover:text-sky-600 dark:hover:text-sky-400"
            >
              {task.title}
            </span>

            {/* Overdue / Approaching Alarm Badges */}
            {isOverdue && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white shrink-0 flex items-center gap-1 shadow-xs animate-bounce">
                <Flame className="w-3 h-3" />
                <span>Przeterminowane ({Math.abs(diffDays)}d po terminie)</span>
              </span>
            )}

            {isApproaching && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white shrink-0 flex items-center gap-1 shadow-xs">
                <Hourglass className="w-3 h-3" />
                <span>Termin za {diffDays === 0 ? 'dzisiaj' : `${diffDays} dni`}</span>
              </span>
            )}

            {/* Subtasks Count Badge */}
            {hasChildren && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium shrink-0">
                {children.length} {children.length === 1 ? 'podzadanie' : children.length < 5 ? 'podzadania' : 'podzadań'}
              </span>
            )}

            {/* Dependency note if blocked */}
            {task.blockingTaskIds && task.blockingTaskIds.length > 0 && (
              <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                <Lock className="w-2.5 h-2.5" />
                <span>Zależne od {task.blockingTaskIds.length} zadań</span>
              </span>
            )}
          </div>

          {/* Right Column: Badges, Assignee, Dates & Branch Action Buttons */}
          <div className="flex items-center gap-3 shrink-0 text-xs">
            {/* Priority */}
            <div className="hidden sm:block">
              {getPriorityBadge(task.priority)}
            </div>

            {/* Status */}
            <div>
              {getStatusBadge(task.status)}
            </div>

            {/* Dates & duration */}
            <div className="hidden md:flex items-center gap-1 text-[11px] text-slate-500 font-mono">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>{task.startDate} · {task.dueDate}</span>
              <span className="font-bold text-slate-700 dark:text-slate-300">({task.durationDays || 7} dni)</span>
            </div>

            {/* Assignee Avatar */}
            {assignee && (
              <div 
                className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[10px] flex items-center justify-center"
                title={`Przypisany: ${assignee.name} (${assignee.role})`}
              >
                {assignee.initials}
              </div>
            )}

            {/* Progress bar */}
            <div className="hidden sm:flex items-center gap-1.5 w-16">
              <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full rounded-full transition-all"
                  style={{ width: `${task.progress || 0}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-500">{task.progress || 0}%</span>
            </div>

            {/* Action: Add subtask under this branch */}
            <button
              type="button"
              onClick={() => onAddTask(task.projectId, task.id)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-semibold text-[11px] border border-sky-200 dark:border-sky-800 transition-colors"
              title={`Dodaj podzadanie do [${task.code}] ${task.title}`}
            >
              <Plus className="w-3 h-3" />
              <span className="hidden sm:inline">Podzadanie</span>
            </button>

            {/* Open Drawer Details */}
            <button
              type="button"
              onClick={() => onSelectTask(task)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
              title="Otwórz szczegóły zadania"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Recursive Children Rendering */}
        {hasChildren && isExpanded && (
          <div className="border-l-2 border-slate-200 dark:border-slate-800 ml-5 pl-1 space-y-1">
            {children.map((childNode) => renderTreeNode(childNode))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Banner: Project Selector & Hierarchy Info */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400">
              <GitMerge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Rozwijane Drzewo Zadań i Gałęzi
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-700 dark:text-slate-300">
                  {projectTasks.length} zadań
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Hierarchiczny podgląd etapów, podzadań i relacji podrzędności w wybranym projekcie.
              </p>
            </div>
          </div>

          {/* Project selector dropdown & Add Main Task Button */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Projekt:</label>
              <select
                value={currentProject?.id || ''}
                onChange={(e) => onSelectProject(e.target.value)}
                className="text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-1.5 text-slate-900 dark:text-white"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.key}] {p.name}
                  </option>
                ))}
              </select>
            </div>

            {currentProject && (
              <button
                type="button"
                onClick={() => onAddTask(currentProject.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                title="Dodaj nowe główne zadanie (gałąź nadrzędną)"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Nowa gałąź zadania</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected Project Card Details */}
        {currentProject && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg">
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">Zamawiający:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {currentProject.clientName || 'Brak wpisu'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">Czas trwania:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">
                {currentProject.startDate} do {currentProject.dueDate} ({currentProject.durationDays || 30} dni)
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">Postęp projektu:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                {currentProject.progress}% ukończono
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">Lokalizacja na dysku:</span>
              {currentProject.diskPath ? (
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300 truncate" title={currentProject.diskPath}>
                    {currentProject.diskPath}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDiskPath}
                    className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded text-amber-700 dark:text-amber-300 shrink-0"
                    title="Kopiuj ścieżkę"
                  >
                    {copiedDiskPath ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              ) : (
                <span className="text-slate-400 italic">Nie zdefiniowano</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filter and Expand/Collapse Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj po tytule lub kodzie..."
              className="pl-8 pr-3 py-1.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs text-slate-900 dark:text-white w-48 sm:w-64"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="all">Wszystkie statusy</option>
              <option value="to_do">Do zrobienia</option>
              <option value="in_progress">W toku</option>
              <option value="blocked">Zablokowane</option>
              <option value="done">Ukończone</option>
            </select>
          </div>
        </div>

        {/* Tree Expand / Collapse Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExpandAll}
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
          >
            Rozwiń wszystkie gałęzie
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
          >
            Zwiń drzewko
          </button>
        </div>
      </div>

      {/* Main Hierarchical Tree Container */}
      <div className="p-4 bg-slate-50/50 dark:bg-slate-950/40 rounded-xl border border-slate-200 dark:border-slate-800 min-h-[350px]">
        {treeNodes.length === 0 ? (
          <div className="text-center py-12 text-slate-400 space-y-2">
            <GitBranch className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700" />
            <p className="text-xs">Brak zadań w wybranym projekcie.</p>
            {currentProject && (
              <button
                type="button"
                onClick={() => onAddTask(currentProject.id)}
                className="mt-2 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold"
              >
                + Dodaj pierwsze zadanie
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {treeNodes.map((node) => renderTreeNode(node))}
          </div>
        )}
      </div>
    </div>
  );
};
