import React, { useState, useMemo, useRef, useEffect, useId } from 'react';
import { Task, Project, User, Priority, TaskStatus, Company } from '../types';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Check,
  Search,
  GitMerge,
  GitBranch,
  Copy,
  Calendar,
  ExternalLink,
  Flame,
  Hourglass,
  Lock,
  GripVertical,
  MoveVertical,
  CornerLeftUp,
  X,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { useAppTimezone, useVariables } from '../hooks/useVariables';
import { getCompanyBadgeColors } from '../utils/colorContrast';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { evaluateProjectDeadline } from '../utils/deadlines';
import { copyToClipboard } from '../utils/clipboard';
import { canAccessProject } from '../utils/access';
import { canReparent } from '../utils/taskTree';
import { getProjectDisplayName, isProjectStatusClosed } from '../utils/projectMeta';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { ProjectNameLabel } from './ProjectNameLabel';

interface TaskTreeViewProps {
  tasks: Task[];
  projects: Project[];
  companies?: Company[];
  users: User[];
  currentUser?: User | null;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectTask: (task: Task) => void;
  onAddTask: (projectId: string, parentTaskId?: string) => void;
  onUpdateTaskStatus?: (taskId: string, status: TaskStatus) => void;
  onReparentTask?: (
    taskId: string,
    newParentId: string | null
  ) => Promise<{ ok: boolean; error?: string }> | void;
}

interface TreeNode {
  task: Task;
  children: TreeNode[];
  level: number;
}

export const TaskTreeView: React.FC<TaskTreeViewProps> = ({
  tasks,
  projects,
  companies = [],
  users,
  currentUser,
  selectedProjectId,
  onSelectProject,
  onSelectTask,
  onAddTask,
  onReparentTask,
}) => {
  const { deadlineWarningDays: warningDays, projectStatuses, projectDeadline } = useVariables();
  const appTimezone = useAppTimezone();
  const isDark = useIsDarkTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => {
    return new Set(tasks.map((t) => t.id));
  });
  const [copiedDiskPath, setCopiedDiskPath] = useState(false);

  // Stan przeciągania (HTML5 Drag & Drop oraz obsługa dotyku przez Pointer Events)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const draggedTaskIdRef = useRef<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null); // 'root' lub task.id
  const dragOverTargetIdRef = useRef<string | null>(null);
  const hoverExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDragActiveRef = useRef<{
    pointerId: number;
    taskId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  // Okno dialogowe przenoszenia z klawiatury / dla czytników ekranu
  const [moveModalTaskId, setMoveModalTaskId] = useState<string | null>(null);
  const [moveTargetSearch, setMoveTargetSearch] = useState('');
  const [isMoveSubmitting, setIsMoveSubmitting] = useState(false);
  const moveModalRef = useRef<HTMLDivElement>(null);
  const moveModalTitleId = useId();
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  // Aktywny projekt
  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  // Zadania w aktywnym projekcie
  const projectTasks = useMemo(() => {
    if (!currentProject) return tasks;
    return tasks.filter((t) => t.projectId === currentProject.id);
  }, [tasks, currentProject]);

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const canMoveTask = (task: Task): boolean => {
    if (!onReparentTask) return false;
    if (!currentUser) return true;
    if (currentUser.role === 'viewer') return false;
    if (currentUser.role === 'admin' || currentUser.role === 'project_manager') return true;
    const proj = projectById.get(task.projectId);
    if (proj && canAccessProject(currentUser, proj)) return true;
    return task.assigneeId === currentUser.id || task.reporterId === currentUser.id;
  };

  const hasAnyMovableTask = useMemo(
    () => Boolean(onReparentTask) && projectTasks.some((t) => canMoveTask(t)),
    [onReparentTask, projectTasks, currentUser, projectById]
  );

  // Budowa drzewa
  const treeNodes = useMemo(() => {
    const taskMap = new Map<string, Task>();
    projectTasks.forEach((t) => taskMap.set(t.id, t));

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

  const hasChildrenSet = useMemo(() => {
    const set = new Set<string>();
    const byId = new Set(projectTasks.map((t) => t.id));
    for (const t of projectTasks) {
      if (t.parentId && byId.has(t.parentId)) {
        set.add(t.parentId);
      }
    }
    return set;
  }, [projectTasks]);

  const clearHoverExpandTimer = () => {
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearHoverExpandTimer();
    };
  }, []);

  const updateDragOverTarget = (nextTargetId: string | null) => {
    if (dragOverTargetIdRef.current === nextTargetId) return;
    dragOverTargetIdRef.current = nextTargetId;
    setDragOverTargetId(nextTargetId);
    clearHoverExpandTimer();

    if (
      nextTargetId &&
      nextTargetId !== 'root' &&
      hasChildrenSet.has(nextTargetId) &&
      !expandedNodeIds.has(nextTargetId)
    ) {
      hoverExpandTimerRef.current = setTimeout(() => {
        setExpandedNodeIds((prev) => {
          if (prev.has(nextTargetId)) return prev;
          const next = new Set(prev);
          next.add(nextTargetId);
          return next;
        });
      }, 600);
    }
  };

  const resetDragState = () => {
    clearHoverExpandTimer();
    draggedTaskIdRef.current = null;
    dragOverTargetIdRef.current = null;
    touchDragActiveRef.current = null;
    setDraggedTaskId(null);
    setDragOverTargetId(null);
  };

  const closeMoveModal = () => {
    setMoveModalTaskId(null);
    setMoveTargetSearch('');
  };

  const isMoveModalDisabled = isMoveSubmitting || Boolean(draggedTaskId);
  const { backdropProps: moveBackdropProps, requestClose: requestCloseMoveModal } =
    useDismissOnOutsideClick({
      isOpen: Boolean(moveModalTaskId),
      mode: 'dismiss',
      panelRef: moveModalRef,
      onDismiss: closeMoveModal,
      disabled: isMoveModalDisabled,
    });

  useFocusTrap({
    isOpen: Boolean(moveModalTaskId),
    containerRef: moveModalRef,
    onClose: requestCloseMoveModal,
    disableEscape: isMoveModalDisabled,
  });

  const performReparent = async (sourceId: string, newParentId: string | null) => {
    if (!onReparentTask) return;
    const sourceTask = tasks.find((t) => t.id === sourceId);
    if (!sourceTask) return;
    const currentParent = sourceTask.parentId || null;
    if (currentParent === newParentId) return;

    const validation = canReparent(tasks, sourceId, newParentId, sourceTask.projectId);
    if (!validation.ok) return;

    const targetTask = newParentId ? tasks.find((t) => t.id === newParentId) : undefined;
    setIsMoveSubmitting(true);
    try {
      const result = await onReparentTask(sourceId, newParentId);
      if (!result || result.ok !== false) {
        if (newParentId) {
          setExpandedNodeIds((prev) => {
            if (prev.has(newParentId)) return prev;
            const next = new Set(prev);
            next.add(newParentId);
            return next;
          });
        }
        setLiveAnnouncement(
          newParentId && targetTask
            ? `Przeniesiono zadanie ${sourceTask.code} pod ${targetTask.code}`
            : `Przeniesiono zadanie ${sourceTask.code} na poziom główny`
        );
      }
    } finally {
      setIsMoveSubmitting(false);
    }
  };

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

  const handleCopyDiskPath = async () => {
    if (!currentProject?.diskPath) return;
    await copyToClipboard(currentProject.diskPath);
    setCopiedDiskPath(true);
    setTimeout(() => setCopiedDiskPath(false), 2000);
  };

  const getPriorityBadge = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            Krytyczny
          </span>
        );
      case 'high':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            Wysoki
          </span>
        );
      case 'low':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Niski
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
            Normalny
          </span>
        );
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'done':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Ukończone
          </span>
        );
      case 'in_progress':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
            W toku
          </span>
        );
      case 'blocked':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            Zablokowane
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Do zrobienia
          </span>
        );
    }
  };

  const draggedTask = useMemo(
    () => (draggedTaskId ? tasks.find((t) => t.id === draggedTaskId) || null : null),
    [draggedTaskId, tasks]
  );

  const rootDropValid = Boolean(draggedTask && draggedTask.parentId);
  const rootDropReason = draggedTask && !draggedTask.parentId ? 'Zadanie jest już na poziomie głównym' : undefined;

  // Kandydaci do okna przenoszenia
  const moveModalTask = useMemo(
    () => (moveModalTaskId ? tasks.find((t) => t.id === moveModalTaskId) || null : null),
    [moveModalTaskId, tasks]
  );

  const allowedModalTargets = useMemo(() => {
    if (!moveModalTask) return [];
    const query = moveTargetSearch.trim().toLowerCase();
    return projectTasks.filter((candidate) => {
      if (candidate.projectId !== moveModalTask.projectId) return false;
      const check = canReparent(tasks, moveModalTask.id, candidate.id, moveModalTask.projectId);
      if (!check.ok) return false;
      if (!query) return true;
      return (
        candidate.code.toLowerCase().includes(query) ||
        candidate.title.toLowerCase().includes(query)
      );
    });
  }, [moveModalTask, moveTargetSearch, projectTasks, tasks]);

  // Obsługa HTML5 DnD oraz dotykowego przeciągania Pointer Events na uchwycie
  const handleTouchPointerDown = (e: React.PointerEvent<HTMLButtonElement>, task: Task) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (!canMoveTask(task)) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    touchDragActiveRef.current = {
      pointerId: e.pointerId,
      taskId: task.id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  };

  const handleTouchPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const active = touchDragActiveRef.current;
    if (!active || active.pointerId !== e.pointerId) return;

    const dx = Math.abs(e.clientX - active.startX);
    const dy = Math.abs(e.clientY - active.startY);
    if (!active.moved && dx + dy >= 6) {
      active.moved = true;
      draggedTaskIdRef.current = active.taskId;
      setDraggedTaskId(active.taskId);
    }

    if (!active.moved) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dropEl = el?.closest('[data-tree-drop-target]') as HTMLElement | null;
    const targetId = dropEl?.getAttribute('data-tree-drop-target') || null;
    updateDragOverTarget(targetId);
  };

  const handleTouchPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const active = touchDragActiveRef.current;
    if (!active || active.pointerId !== e.pointerId) return;

    if (active.moved) {
      const targetId = dragOverTargetIdRef.current;
      const sourceId = active.taskId;
      resetDragState();

      if (targetId === 'root') {
        const source = tasks.find((t) => t.id === sourceId);
        if (source?.parentId) {
          void performReparent(sourceId, null);
        }
      } else if (targetId && targetId !== sourceId) {
        const source = tasks.find((t) => t.id === sourceId);
        if (source) {
          const check = canReparent(tasks, sourceId, targetId, source.projectId);
          if (check.ok) {
            void performReparent(sourceId, targetId);
          }
        }
      }
      return;
    }

    resetDragState();
  };

  const handleTouchPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const active = touchDragActiveRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    resetDragState();
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: TreeNode) => {
    const { task, children, level } = node;
    const isExpanded = expandedNodeIds.has(task.id);
    const hasChildren = children.length > 0;
    const assignee = users.find((u) => u.id === task.assigneeId);
    const movable = canMoveTask(task);

    // Filter match test
    const matchesSearch =
      !searchQuery ||
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.code.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;

    if (!matchesSearch || !matchesStatus) {
      const matchingChildren = children.filter((c) => {
        return (
          (!searchQuery ||
            c.task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.task.code.toLowerCase().includes(searchQuery.toLowerCase())) &&
          (statusFilter === 'all' || c.task.status === statusFilter)
        );
      });

      if (matchingChildren.length === 0) return null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const dueTime = new Date((task.dueDate || today) + 'T00:00:00').getTime();
    const nowTime = new Date(today + 'T00:00:00').getTime();
    const diffDays = Math.ceil((dueTime - nowTime) / (1000 * 60 * 60 * 24));

    const isOverdue = task.status !== 'done' && (task.dueDate ? task.dueDate < today : false);
    const isApproaching = task.status !== 'done' && !isOverdue && diffDays >= 0 && diffDays <= warningDays;

    // Ocena czy ten wiersz jest prawidłowym celem podczas trwającego przeciągania
    const isDraggingThis = draggedTaskId === task.id;
    const isDragActive = Boolean(draggedTaskId);
    const dropValidation =
      isDragActive && draggedTask && !isDraggingThis
        ? canReparent(tasks, draggedTask.id, task.id, draggedTask.projectId)
        : null;
    const isDropValid = Boolean(dropValidation?.ok);
    const isDropInvalid = Boolean(isDragActive && !isDraggingThis && dropValidation && !dropValidation.ok);
    const isHoveredDropTarget = dragOverTargetId === task.id;

    let cardStyle = '';
    if (isDraggingThis) {
      cardStyle = 'opacity-50 bg-slate-100 dark:bg-slate-800 border-dashed border-slate-400 dark:border-slate-600';
    } else if (isHoveredDropTarget && isDropValid) {
      cardStyle =
        'bg-sky-50 dark:bg-sky-950/60 border-2 border-sky-500 ring-2 ring-sky-400/70 shadow-sm';
    } else if (isHoveredDropTarget && isDropInvalid) {
      cardStyle =
        'bg-rose-50 dark:bg-rose-950/50 border-2 border-rose-400 dark:border-rose-700 opacity-75 cursor-not-allowed';
    } else if (isDropInvalid) {
      cardStyle =
        'opacity-60 cursor-not-allowed bg-slate-100/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800';
    } else if (isOverdue) {
      cardStyle =
        'bg-rose-500/20 dark:bg-rose-950/70 border-rose-500 animate-pulse text-rose-950 dark:text-rose-100 ring-2 ring-rose-500/60 shadow-md';
    } else if (isApproaching) {
      cardStyle =
        'border-2 border-amber-500 ring-2 ring-amber-400 animate-pulse bg-amber-50/50 dark:bg-amber-950/30';
    } else if (isDragActive && isDropValid) {
      cardStyle =
        level === 0
          ? 'bg-white dark:bg-slate-900 border-sky-300 dark:border-sky-700 shadow-2xs'
          : 'bg-slate-50/70 dark:bg-slate-900/60 border-sky-300/80 dark:border-sky-800';
    } else if (level === 0) {
      cardStyle =
        'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs hover:border-sky-400 dark:hover:border-sky-600';
    } else {
      cardStyle =
        'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800';
    }

    return (
      <div key={task.id} className="relative">
        {/* Wiersz węzła drzewa */}
        <div
          tabIndex={0}
          data-tree-row-id={task.id}
          data-tree-drop-target={task.id}
          data-drop-invalid={isDropInvalid ? 'true' : undefined}
          aria-disabled={isDropInvalid ? 'true' : undefined}
          title={isDropInvalid ? dropValidation?.error : undefined}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'm' || e.key === 'M') && movable) {
              e.preventDefault();
              setMoveTargetSearch('');
              setMoveModalTaskId(task.id);
            }
          }}
          onDragOver={(e) => {
            const activeSourceId = draggedTaskIdRef.current;
            if (!activeSourceId) return;
            e.preventDefault();
            const source = tasks.find((t) => t.id === activeSourceId);
            const res = source
              ? canReparent(tasks, activeSourceId, task.id, source.projectId)
              : { ok: false };
            e.dataTransfer.dropEffect = res.ok ? 'move' : 'none';
            updateDragOverTarget(task.id);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              if (dragOverTargetIdRef.current === task.id) {
                updateDragOverTarget(null);
              }
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const sourceId =
              draggedTaskIdRef.current || e.dataTransfer?.getData('text/plain') || '';
            resetDragState();
            if (!sourceId || sourceId === task.id) return;
            const source = tasks.find((t) => t.id === sourceId);
            if (!source) return;
            const check = canReparent(tasks, sourceId, task.id, source.projectId);
            if (!check.ok) return;
            void performReparent(sourceId, task.id);
          }}
          className={`group flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 p-2.5 rounded-lg border transition-all mb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${cardStyle}`}
          style={{ marginLeft: `${level * 24}px` }}
        >
          {/* Left Column: Drag Handle, Branch Expander, Code, Title & Hierarchy info */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {movable && (
              <button
                type="button"
                draggable
                data-testid={`tree-drag-handle-${task.id}`}
                aria-label={`Przeciągnij zadanie ${task.code} (${task.title})`}
                title="Przeciągnij, aby zmienić zadanie nadrzędne"
                onDragStart={(e) => {
                  draggedTaskIdRef.current = task.id;
                  setDraggedTaskId(task.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', task.id);
                }}
                onDragEnd={() => {
                  resetDragState();
                }}
                onPointerDown={(e) => handleTouchPointerDown(e, task)}
                onPointerMove={handleTouchPointerMove}
                onPointerUp={handleTouchPointerUp}
                onPointerCancel={handleTouchPointerCancel}
                className="touch-none p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}

            {/* Expand / Collapse Button */}
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleNode(task.id)}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors shrink-0"
                title={isExpanded ? 'Zwiń podgałęzie' : 'Rozwiń podgałęzie'}
                aria-label={
                  isExpanded
                    ? `Zwiń podgałęzie zadania ${task.code}`
                    : `Rozwiń podgałęzie zadania ${task.code}`
                }
                aria-expanded={isExpanded}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span
                className="w-6 h-6 flex items-center justify-center text-slate-500 dark:text-slate-500 shrink-0"
                aria-hidden="true"
              >
                •
              </span>
            )}

            {/* Task Code */}
            <button
              type="button"
              onClick={() => onSelectTask(task)}
              className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer shrink-0"
              aria-label={`Otwórz zadanie ${task.code}: ${task.title}`}
            >
              [{task.code}]
            </button>

            {/* Official deadline flag */}
            {task.isOfficialDeadline && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800 shrink-0">
                <span aria-hidden="true">🏛️ </span>Urzędowy
              </span>
            )}

            {/* Title */}
            <button
              type="button"
              onClick={() => onSelectTask(task)}
              className="text-left text-xs font-semibold text-slate-900 dark:text-white truncate cursor-pointer hover:text-sky-700 dark:hover:text-sky-400"
            >
              {task.title}
            </button>

            {/* Drop target indicators during drag */}
            {isHoveredDropTarget && isDropValid && (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-700 text-white dark:bg-sky-600 dark:text-white shrink-0">
                Jako podzadanie: {task.code}
              </span>
            )}

            {isHoveredDropTarget && isDropInvalid && (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200 border border-rose-300 dark:border-rose-700 shrink-0 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" aria-hidden="true" />
                <span>Niedostępne: {dropValidation?.error}</span>
              </span>
            )}

            {/* Overdue / Approaching Alarm Badges */}
            {isOverdue && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-700 text-white shrink-0 flex items-center gap-1 shadow-xs animate-bounce">
                <Flame className="w-3 h-3" aria-hidden="true" />
                <span>Przeterminowane ({Math.abs(diffDays)}d po terminie)</span>
              </span>
            )}

            {isApproaching && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-700 text-white shrink-0 flex items-center gap-1 shadow-xs">
                <Hourglass className="w-3 h-3" aria-hidden="true" />
                <span>Termin za {diffDays === 0 ? 'dzisiaj' : `${diffDays} dni`}</span>
              </span>
            )}

            {/* Subtasks Count Badge */}
            {hasChildren && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium shrink-0">
                {children.length}{' '}
                {children.length === 1
                  ? 'podzadanie'
                  : children.length < 5
                  ? 'podzadania'
                  : 'podzadań'}
              </span>
            )}

            {/* Dependency note if blocked */}
            {task.blockingTaskIds && task.blockingTaskIds.length > 0 && (
              <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                <span>Zależne od {task.blockingTaskIds.length} zadań</span>
              </span>
            )}
          </div>

          {/* Right Column: Badges, Assignee, Dates & Branch Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0 text-xs">
            {/* Priority */}
            <div className="hidden sm:block">{getPriorityBadge(task.priority)}</div>

            {/* Status */}
            <div>{getStatusBadge(task.status)}</div>

            {/* Dates & duration */}
            <div className="hidden md:flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
              <Calendar className="w-3 h-3 text-slate-600 dark:text-slate-400" aria-hidden="true" />
              <span>
                {task.startDate} · {task.dueDate}
              </span>
              <span className="font-bold text-slate-700 dark:text-slate-200">
                ({task.durationDays || 7} dni)
              </span>
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
              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                {task.progress || 0}%
              </span>
            </div>

            {/* Przenieś w drzewie (klawiatura / czytnik ekranu, Alt+M) */}
            {movable && (
              <button
                type="button"
                onClick={() => {
                  setMoveTargetSearch('');
                  setMoveModalTaskId(task.id);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-[11px] border border-slate-300 dark:border-slate-700 transition-colors"
                title={`Przenieś zadanie [${task.code}] w hierarchii (Alt+M)`}
                aria-label={`Przenieś zadanie ${task.code}`}
              >
                <MoveVertical className="w-3 h-3" aria-hidden="true" />
                <span className="hidden sm:inline">Przenieś</span>
              </button>
            )}

            {/* Action: Add subtask under this branch */}
            <button
              type="button"
              onClick={() => onAddTask(task.projectId, task.id)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-semibold text-[11px] border border-sky-200 dark:border-sky-800 transition-colors"
              title={`Dodaj podzadanie do [${task.code}] ${task.title}`}
              aria-label={`Dodaj podzadanie do ${task.code}`}
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              <span className="hidden sm:inline">Podzadanie</span>
            </button>

            {/* Open Drawer Details */}
            <button
              type="button"
              onClick={() => onSelectTask(task)}
              className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
              title="Otwórz szczegóły zadania"
              aria-label={`Otwórz szczegóły zadania ${task.code}`}
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
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
      {/* Live region dla czytników ekranu */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* Top Banner: Project Selector & Hierarchy Info */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-400">
              <GitMerge className="w-5 h-5" aria-hidden="true" />
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
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Hierarchiczny podgląd etapów, podzadań i relacji podrzędności w wybranym projekcie.
              </p>
            </div>
          </div>

          {/* Project selector dropdown & Add Main Task Button */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="tree-project-select" className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Projekt:
              </label>
              <select
                id="tree-project-select"
                value={currentProject?.id || ''}
                onChange={(e) => onSelectProject(e.target.value)}
                className="text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-1.5 text-slate-900 dark:text-white"
              >
                {projects.map((p) => {
                  const comp = p.companyId ? companies.find((c) => c.id === p.companyId) : undefined;
                  return (
                    <option key={p.id} value={p.id}>
                      [{p.key}]{comp ? ` (${comp.letter})` : ''} {getProjectDisplayName(p)}
                    </option>
                  );
                })}
              </select>
              {currentProject?.companyId &&
                (() => {
                  const comp = companies.find((c) => c.id === currentProject.companyId);
                  return comp ? (
                    <span
                      style={getCompanyBadgeColors(comp, isDark ? 'dark' : 'light')}
                      title={`Firma prowadząca: ${comp.name}`}
                      className="font-mono text-xs font-bold px-2 py-1 rounded border"
                    >
                      {comp.letter}
                    </span>
                  ) : null;
                })()}
            </div>

            {currentProject && (
              <button
                type="button"
                onClick={() => onAddTask(currentProject.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                title="Dodaj nowe główne zadanie (gałąź nadrzędną)"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>+ Nowa gałąź zadania</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected Project Card Details */}
        {currentProject && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-slate-600 dark:text-slate-400">
                Wybrany projekt:
              </span>
              <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                [{currentProject.key}]
              </span>
              <span className="font-bold text-slate-900 dark:text-white">
                <ProjectNameLabel project={currentProject} />
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-600 dark:text-slate-400 block">
                Zamawiający:
              </span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {currentProject.clientName || 'Brak wpisu'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-600 dark:text-slate-400 block">
                Czas trwania:
              </span>
              {(() => {
                const projDeadlineEval = evaluateProjectDeadline(currentProject.dueDate, projectDeadline, {
                  isClosed: isProjectStatusClosed(currentProject.status, projectStatuses),
                  isArchived: currentProject.isArchived,
                  timezone: appTimezone,
                });
                return (
                  <span className="font-mono text-slate-800 dark:text-slate-200 inline-flex flex-wrap items-center gap-1">
                    <span>{currentProject.startDate} do</span>
                    <span
                      className={
                        projDeadlineEval.isRed
                          ? 'text-rose-700 dark:text-rose-400 font-bold inline-flex items-center gap-0.5'
                          : ''
                      }
                    >
                      {projDeadlineEval.isRed && (
                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                      )}
                      <span>{currentProject.dueDate}</span>
                    </span>
                    {projDeadlineEval.showCounter && projDeadlineEval.text && (
                      <span
                        data-testid="project-deadline-counter"
                        className={`font-sans text-[11px] ${
                          projDeadlineEval.isRed
                            ? 'text-rose-700 dark:text-rose-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        ({projDeadlineEval.text})
                      </span>
                    )}
                    <span>({currentProject.durationDays || 30} dni)</span>
                  </span>
                );
              })()}
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-600 dark:text-slate-400 block">
                Postęp projektu:
              </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                {currentProject.progress}% ukończono
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-600 dark:text-slate-400 block">
                Lokalizacja na dysku:
              </span>
              {currentProject.diskPath ? (
                <div className="flex items-center gap-1">
                  <span
                    className="font-mono text-[11px] text-amber-700 dark:text-amber-300 truncate"
                    title={currentProject.diskPath}
                  >
                    {currentProject.diskPath}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDiskPath}
                    className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded text-amber-700 dark:text-amber-300 shrink-0"
                    title="Kopiuj ścieżkę"
                    aria-label="Kopiuj ścieżkę projektu na dysku"
                  >
                    {copiedDiskPath ? (
                      <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3 h-3" aria-hidden="true" />
                    )}
                  </button>
                </div>
              ) : (
                <span className="text-slate-600 dark:text-slate-400 italic">Nie zdefiniowano</span>
              )}
            </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter and Expand/Collapse Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj po tytule lub kodzie..."
              aria-label="Szukaj zadania po tytule lub kodzie"
              className="pl-8 pr-3 py-1.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs text-slate-900 dark:text-white w-48 sm:w-64"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1">
            <label htmlFor="tree-status-filter" className="text-slate-600 dark:text-slate-400">
              Status:
            </label>
            <select
              id="tree-status-filter"
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
          <div className="text-center py-12 text-slate-600 dark:text-slate-400 space-y-2">
            <GitBranch className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600" aria-hidden="true" />
            <p className="text-xs">Brak zadań w wybranym projekcie.</p>
            {currentProject && (
              <button
                type="button"
                onClick={() => onAddTask(currentProject.id)}
                className="mt-2 px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white rounded text-xs font-semibold"
              >
                + Dodaj pierwsze zadanie
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Strefa upuszczenia: Poziom główny (renderowana stale, aby nie przesuwać układu przy starcie DnD) */}
            {hasAnyMovableTask && (
              <div
                data-testid="tree-root-dropzone"
                data-tree-drop-target="root"
                aria-disabled={draggedTask && !rootDropValid ? 'true' : undefined}
                title={rootDropReason}
                onDragOver={(e) => {
                  const activeSourceId = draggedTaskIdRef.current;
                  if (!activeSourceId) return;
                  e.preventDefault();
                  const source = tasks.find((t) => t.id === activeSourceId);
                  const canRoot = Boolean(source && source.parentId);
                  e.dataTransfer.dropEffect = canRoot ? 'move' : 'none';
                  updateDragOverTarget('root');
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    if (dragOverTargetIdRef.current === 'root') {
                      updateDragOverTarget(null);
                    }
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const sourceId =
                    draggedTaskIdRef.current || e.dataTransfer?.getData('text/plain') || '';
                  resetDragState();
                  if (!sourceId) return;
                  const source = tasks.find((t) => t.id === sourceId);
                  if (!source || !source.parentId) return;
                  void performReparent(sourceId, null);
                }}
                className={`mb-3 px-3 py-2 rounded-lg border-2 border-dashed text-xs flex items-center justify-between gap-2 transition-colors ${
                  dragOverTargetId === 'root' && rootDropValid
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 font-bold ring-2 ring-sky-400/60'
                    : dragOverTargetId === 'root' && draggedTask && !rootDropValid
                    ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 cursor-not-allowed'
                    : draggedTaskId && rootDropValid
                    ? 'border-sky-300 dark:border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                    : 'border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CornerLeftUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {dragOverTargetId === 'root' && rootDropValid
                      ? 'Upuść tutaj: Poziom główny (usuń zadanie nadrzędne)'
                      : dragOverTargetId === 'root' && draggedTask && !rootDropValid
                      ? `Niedostępne: ${rootDropReason}`
                      : 'Poziom główny — upuść tutaj podzadanie, aby przenieść je na poziom główny projektu'}
                  </span>
                </div>
                {draggedTask && (
                  <span className="text-[11px] font-mono shrink-0">[{draggedTask.code}]</span>
                )}
              </div>
            )}

            {treeNodes.map((node) => renderTreeNode(node))}
          </div>
        )}
      </div>

      {/* Okno wyboru celu przeniesienia (klawiatura / czytnik ekranu / Alt+M) */}
      {moveModalTask && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/75 flex items-center justify-center p-4"
          {...moveBackdropProps}
        >
          <div
            ref={moveModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={moveModalTitleId}
            className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
              <div>
                <h3 id={moveModalTitleId} className="text-sm font-bold text-slate-900 dark:text-white">
                  Przenieś zadanie [{moveModalTask.code}]
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate max-w-md">
                  {moveModalTask.title}
                </p>
              </div>
              <button
                type="button"
                onClick={closeMoveModal}
                aria-label="Zamknij okno przenoszenia zadania"
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="move-task-target-search" className="sr-only">
                  Szukaj zadania docelowego w projekcie
                </label>
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="move-task-target-search"
                    type="text"
                    autoFocus
                    value={moveTargetSearch}
                    onChange={(e) => setMoveTargetSearch(e.target.value)}
                    placeholder="Szukaj zadania docelowego po kodzie lub tytule..."
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {/* Poziom główny */}
                <button
                  type="button"
                  disabled={!moveModalTask.parentId || isMoveSubmitting}
                  onClick={() => {
                    const sourceId = moveModalTask.id;
                    closeMoveModal();
                    void performReparent(sourceId, null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:border-sky-400 dark:hover:border-sky-600 text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <CornerLeftUp className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                    <span>Poziom główny</span>
                  </span>
                  {!moveModalTask.parentId && (
                    <span className="text-[11px] font-normal text-slate-600 dark:text-slate-400">
                      Obecna pozycja
                    </span>
                  )}
                </button>

                {allowedModalTargets.length === 0 ? (
                  <p className="text-xs text-slate-600 dark:text-slate-400 text-center py-4">
                    Brak innych dozwolonych zadań docelowych pasujących do filtra.
                  </p>
                ) : (
                  allowedModalTargets.map((candidate) => {
                    const isCurrentParent = moveModalTask.parentId === candidate.id;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        disabled={isCurrentParent || isMoveSubmitting}
                        onClick={() => {
                          const sourceId = moveModalTask.id;
                          closeMoveModal();
                          void performReparent(sourceId, candidate.id);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:border-sky-400 dark:hover:border-sky-600 text-xs text-slate-900 dark:text-white flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-400 shrink-0">
                            [{candidate.code}]
                          </span>
                          <span className="truncate font-medium">{candidate.title}</span>
                        </span>
                        {isCurrentParent && (
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 shrink-0">
                            Obecny rodzic
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
              <span>Lista pokazuje wyłącznie dozwolone cele w tym projekcie.</span>
              <button
                type="button"
                onClick={closeMoveModal}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
