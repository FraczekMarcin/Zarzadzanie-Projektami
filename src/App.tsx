import React, { useState, useEffect } from 'react';
import { Task, Project, User, Priority, TaskStatus, ActivityLog, Comment } from './types';
import { INITIAL_USERS, INITIAL_PROJECTS, INITIAL_TASKS, INITIAL_ACTIVITY } from './data/initialData';
import { GanttChart } from './components/GanttChart';
import { CalendarView } from './components/CalendarView';
import { TaskListView } from './components/TaskListView';
import { KanbanView } from './components/KanbanView';
import { ProjectsOverview } from './components/ProjectsOverview';
import { TaskModal } from './components/TaskModal';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { DockerDeploymentModal } from './components/DockerDeploymentModal';
import { UserAuthModal } from './components/UserAuthModal';
import { GoogleCalendarSyncModal } from './components/GoogleCalendarSyncModal';
import { TaskFilterModal } from './components/TaskFilterModal';
import { ArchiveBackupModal } from './components/ArchiveBackupModal';
import { getNextProjectCode } from './utils/projectCode';
import { downloadIcsFile } from './utils/calendar';
import { 
  FolderKanban, 
  Calendar as CalendarIcon, 
  ListTodo, 
  LayoutGrid, 
  Briefcase, 
  Server, 
  Download, 
  Plus, 
  User as UserIcon, 
  AlertCircle, 
  ChevronDown, 
  Search,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Unlock,
  GitMerge,
  Radio,
  Cloud
} from 'lucide-react';

type ActiveView = 'gantt' | 'calendar' | 'tasks' | 'kanban' | 'projects';

export default function App() {
  // Persistence state with auto-migration to prevent legacy crash
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem('oph_users');
      return saved ? JSON.parse(saved) : INITIAL_USERS;
    } catch {
      return INITIAL_USERS;
    }
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    try {
      const saved = localStorage.getItem('oph_current_user');
      return saved ? JSON.parse(saved) : INITIAL_USERS[0];
    } catch {
      return INITIAL_USERS[0];
    }
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem('oph_projects');
      if (!saved) return INITIAL_PROJECTS;
      const parsed = JSON.parse(saved);
      return parsed.map((p: any) => ({
        ...p,
        priority: p.priority === 'medium' ? 'normal' : (p.priority || 'normal'),
        durationDays: p.durationDays || 30,
      }));
    } catch {
      return INITIAL_PROJECTS;
    }
  });

  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem('oph_tasks');
      if (!saved) return INITIAL_TASKS;
      const parsed = JSON.parse(saved);
      return parsed.map((t: any) => ({
        ...t,
        priority: t.priority === 'medium' ? 'normal' : (t.priority || 'normal'),
        durationDays: t.durationDays || 7,
        blockingTaskIds: t.blockingTaskIds || t.dependencies || [],
        dependencies: t.dependencies || t.blockingTaskIds || [],
      }));
    } catch {
      return INITIAL_TASKS;
    }
  });

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() => {
    try {
      const saved = localStorage.getItem('oph_activity');
      return saved ? JSON.parse(saved) : INITIAL_ACTIVITY;
    } catch {
      return INITIAL_ACTIVITY;
    }
  });

  const [comments, setComments] = useState<Comment[]>(() => {
    try {
      const saved = localStorage.getItem('oph_comments');
      return saved
        ? JSON.parse(saved)
        : [
            {
              id: 'c-1',
              taskId: 'tsk-103',
              userId: 'usr-3',
              content: 'Podpiąłem walidację tokenów JWT i role. Czekam na weryfikację QA.',
              createdAt: '2026-10-23T11:20:00Z',
            },
            {
              id: 'c-2',
              taskId: 'tsk-105',
              userId: 'usr-4',
              content: 'Problem występuje przy zamówieniach powyżej 10 pozycji w walucie EUR.',
              createdAt: '2026-10-24T08:15:00Z',
            },
          ];
    } catch {
      return [];
    }
  });

  // UI state
  const [activeView, setActiveView] = useState<ActiveView>('gantt');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Modals & Drawers
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultTaskDate, setDefaultTaskDate] = useState<string | undefined>(undefined);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<Task | null>(null);
  const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isCalendarSyncModalOpen, setIsCalendarSyncModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isTaskFilterModalOpen, setIsTaskFilterModalOpen] = useState(false);
  const [taskFilterModalType, setTaskFilterModalType] = useState<'blocked' | 'critical'>('blocked');

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('oph_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('oph_current_user', JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('oph_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('oph_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('oph_activity', JSON.stringify(activityLogs));
  }, [activityLogs]);

  useEffect(() => {
    localStorage.setItem('oph_comments', JSON.stringify(comments));
  }, [comments]);

  // Push tasks to server endpoint for live Google Calendar subscription feed polling
  useEffect(() => {
    try {
      fetch('/api/calendar/push-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, users }),
      }).catch(() => {});
    } catch {}
  }, [tasks, users]);

  // Toast auto-dismiss
  useEffect(() => {
    if (notificationToast) {
      const timer = setTimeout(() => setNotificationToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notificationToast]);

  // Activity logger helper
  const logActivity = (action: string, taskId?: string, details?: string) => {
    const newLog: ActivityLog = {
      id: `act-${Date.now()}`,
      projectId: selectedProjectId || projects[0]?.id || 'prj-1',
      taskId,
      userId: currentUser.id,
      action,
      timestamp: new Date().toISOString(),
      details,
    };
    setActivityLogs((prev) => [newLog, ...prev]);
  };

  /**
   * Helper to add days to a date string 'YYYY-MM-DD'
   */
  const addDaysToDate = (dateStr: string, daysToAdd: number): string => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + daysToAdd);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return dateStr;
    }
  };

  /**
   * Safe task selection handler: normalizes all fields to prevent any drawer crash
   */
  const handleSelectTask = (task: Task) => {
    if (!task) return;
    const priority = (task.priority as any) === 'medium' ? 'normal' : (task.priority || 'normal');
    const safeTask: Task = {
      ...task,
      title: task.title || 'Zadanie',
      code: task.code || 'ZAD',
      priority,
      status: task.status || 'to_do',
      durationDays: task.durationDays || 7,
      startDate: task.startDate || '2026-10-24',
      dueDate: task.dueDate || '2026-10-31',
      progress: task.progress !== undefined ? task.progress : 0,
      blockingTaskIds: Array.isArray(task.blockingTaskIds) ? task.blockingTaskIds : (task.dependencies || []),
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : (task.blockingTaskIds || []),
      tags: Array.isArray(task.tags) ? task.tags : [],
    };
    setSelectedTaskDetail(safeTask);
  };

  /**
   * DEPENDENCY & TREE HIERARCHY ENGINE
   */
  const processDependencyRules = (currentTasks: Task[]): { updatedTasks: Task[]; triggeredEvents: string[] } => {
    let tasksCopy = [...currentTasks];
    const events: string[] = [];

    // Step 1: Check all tasks with blockingTaskIds
    tasksCopy = tasksCopy.map((task) => {
      const blockerIds = task.blockingTaskIds || task.dependencies || [];
      if (blockerIds.length === 0) return task;

      const blockers = tasksCopy.filter((t) => blockerIds.includes(t.id));
      const allBlockersDone = blockers.length > 0 && blockers.every((b) => b.status === 'done');

      // Rule: If all blockers are done, unlock task (transition from 'blocked' to 'in_progress')
      // and adjust start date to the latest finish date of blockers!
      if (allBlockersDone && task.status === 'blocked') {
        let latestBlockerDueDate = task.startDate || '2026-10-24';
        blockers.forEach((b) => {
          if (b.dueDate && b.dueDate > latestBlockerDueDate) {
            latestBlockerDueDate = b.dueDate;
          }
        });

        const newStartDate = addDaysToDate(latestBlockerDueDate, 1);
        const taskDuration = task.durationDays || 7;
        const newDueDate = addDaysToDate(newStartDate, taskDuration - 1);

        events.push(
          `Odblokowano zadanie [${task.code}]: po ukończeniu poprzedników przeszło w stan "W toku", a czas trwania (${taskDuration} dni) liczony jest od ${newStartDate}.`
        );

        return {
          ...task,
          status: 'in_progress',
          startDate: newStartDate,
          dueDate: newDueDate,
          updatedAt: new Date().toISOString(),
        };
      }

      // Rule: If any blocker is NOT done and task was not marked as done, ensure it stays blocked
      if (!allBlockersDone && (task.status === 'in_progress' || task.status === 'to_do')) {
        return {
          ...task,
          status: 'blocked',
          updatedAt: new Date().toISOString(),
        };
      }

      return task;
    });

    // Step 2: Parent-Subtask Tree Hierarchy Rule
    const parentIds = Array.from(new Set(tasksCopy.map((t) => t.parentId).filter(Boolean))) as string[];

    parentIds.forEach((parentId) => {
      const subtasks = tasksCopy.filter((t) => t.parentId === parentId);
      const allSubtasksDone = subtasks.length > 0 && subtasks.every((s) => s.status === 'done');
      const parentTask = tasksCopy.find((t) => t.id === parentId);

      if (parentTask && allSubtasksDone && parentTask.status !== 'done') {
        tasksCopy = tasksCopy.map((t) =>
          t.id === parentId
            ? {
                ...t,
                status: 'done',
                progress: 100,
                updatedAt: new Date().toISOString(),
              }
            : t
        );
        events.push(
          `Wszystkie podzadania zostały ukończone! Zadanie nadrzędne [${parentTask.code}] "${parentTask.title}" zostało automatycznie zakończone.`
        );
      } else if (parentTask && subtasks.length > 0) {
        const avgProgress = Math.round(
          subtasks.reduce((acc, s) => acc + (s.progress || 0), 0) / subtasks.length
        );
        if (parentTask.progress !== avgProgress && parentTask.status !== 'done') {
          tasksCopy = tasksCopy.map((t) =>
            t.id === parentId ? { ...t, progress: avgProgress } : t
          );
        }
      }
    });

    return { updatedTasks: tasksCopy, triggeredEvents: events };
  };

  // Task actions
  const handleSaveTask = (taskData: Omit<Task, 'id' | 'code' | 'createdAt' | 'updatedAt'>) => {
    let newTaskList: Task[];

    if (editingTask) {
      const updated: Task = {
        ...editingTask,
        ...taskData,
        updatedAt: new Date().toISOString(),
      };
      newTaskList = tasks.map((t) => (t.id === editingTask.id ? updated : t));
      logActivity(
        `${currentUser.name} zaktualizował zadanie [${editingTask.code}]: ${updated.title}`,
        editingTask.id,
        `Status: ${updated.status}, Czas trwania: ${updated.durationDays} dni, Priorytet: ${updated.priority}`
      );
    } else {
      const targetProject = projects.find((p) => p.id === taskData.projectId) || projects[0];
      const count = tasks.filter((t) => t.projectId === targetProject.id).length + 1;
      const code = `${targetProject.key}-${String(count).padStart(2, '0')}`;

      const newTask: Task = {
        ...taskData,
        id: `tsk-${Date.now()}`,
        code,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      newTaskList = [newTask, ...tasks];
      logActivity(
        `${currentUser.name} utworzył nowe zadanie [${code}]: ${newTask.title}`,
        newTask.id,
        `Czas: ${newTask.durationDays} dni, Priorytet: ${newTask.priority}`
      );
    }

    const { updatedTasks, triggeredEvents } = processDependencyRules(newTaskList);
    setTasks(updatedTasks);

    if (triggeredEvents.length > 0) {
      triggeredEvents.forEach((evt) => logActivity(evt));
      setNotificationToast({ message: triggeredEvents[0], type: 'success' });
    }

    if (selectedTaskDetail) {
      const refreshed = updatedTasks.find((t) => t.id === selectedTaskDetail.id);
      if (refreshed) handleSelectTask(refreshed);
    }

    setEditingTask(null);
  };

  const handleDeleteTask = (taskId: string) => {
    const taskToDelete = tasks.find((t) => t.id === taskId);
    if (!taskToDelete) return;
    if (confirm(`Czy na pewno usunąć zadanie [${taskToDelete.code}] "${taskToDelete.title}"?`)) {
      const filtered = tasks.filter((t) => t.id !== taskId);
      const { updatedTasks } = processDependencyRules(filtered);
      setTasks(updatedTasks);
      if (selectedTaskDetail?.id === taskId) {
        setSelectedTaskDetail(null);
      }
      logActivity(`${currentUser.name} usunął zadanie [${taskToDelete.code}]`, taskId);
    }
  };

  const handleUpdateStatus = (taskId: string, newStatus: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const blockerIds = task.blockingTaskIds || task.dependencies || [];
    const unfinishedBlockers = tasks.filter((t) => blockerIds.includes(t.id) && t.status !== 'done');

    if (unfinishedBlockers.length > 0 && (newStatus === 'in_progress' || newStatus === 'done')) {
      alert(
        `Nie można przenieść zadania [${task.code}] do "${newStatus}"!\nNajpierw ukończ zadania blokujące:\n- ` +
          unfinishedBlockers.map((b) => `[${b.code}] ${b.title}`).join('\n- ')
      );
      return;
    }

    const progress = newStatus === 'done' ? 100 : task.progress;
    const updated: Task = {
      ...task,
      status: newStatus,
      progress,
      updatedAt: new Date().toISOString(),
    };

    const newTaskList = tasks.map((t) => (t.id === taskId ? updated : t));
    const { updatedTasks, triggeredEvents } = processDependencyRules(newTaskList);
    setTasks(updatedTasks);

    logActivity(`${currentUser.name} zmienił status [${task.code}] na "${newStatus}"`, taskId);

    if (triggeredEvents.length > 0) {
      triggeredEvents.forEach((evt) => logActivity(evt));
      setNotificationToast({ message: triggeredEvents[0], type: 'success' });
    }

    if (selectedTaskDetail?.id === taskId) {
      const refreshed = updatedTasks.find((t) => t.id === taskId);
      if (refreshed) handleSelectTask(refreshed);
    }
  };

  const handleUpdateProgress = (taskId: string, progress: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const status: TaskStatus = progress === 100 ? 'done' : task.status;
    const updated: Task = {
      ...task,
      progress,
      status,
      updatedAt: new Date().toISOString(),
    };

    const newTaskList = tasks.map((t) => (t.id === taskId ? updated : t));
    const { updatedTasks, triggeredEvents } = processDependencyRules(newTaskList);
    setTasks(updatedTasks);

    if (triggeredEvents.length > 0) {
      triggeredEvents.forEach((evt) => logActivity(evt));
      setNotificationToast({ message: triggeredEvents[0], type: 'success' });
    }

    if (selectedTaskDetail?.id === taskId) {
      const refreshed = updatedTasks.find((t) => t.id === taskId);
      if (refreshed) handleSelectTask(refreshed);
    }
  };

  const handleAddComment = (taskId: string, content: string) => {
    const newComment: Comment = {
      id: `com-${Date.now()}`,
      taskId,
      userId: currentUser.id,
      content,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...prev, newComment]);
    logActivity(`${currentUser.name} dodał komentarz do zadania`, taskId, content);
  };

  const handleAddProject = (newProjData: Omit<Project, 'id'>) => {
    const key = newProjData.key ? newProjData.key.trim().toUpperCase() : getNextProjectCode(projects);
    const newProject: Project = {
      ...newProjData,
      id: `prj-${Date.now()}`,
      key,
    };
    setProjects((prev) => [...prev, newProject]);
    setSelectedProjectId(newProject.id);
    logActivity(`${currentUser.name} zarejestrował nowy projekt [${newProject.key}]: ${newProject.name} (Czas: ${newProject.durationDays} dni)`);
  };

  const handleUpdateProject = (updatedProject: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
    logActivity(`${currentUser.name} zaktualizował projekt [${updatedProject.key}]: ${updatedProject.name}`);
  };

  const handleNavigateToTaskAndProject = (projectId: string, task: Task) => {
    setSelectedProjectId(projectId);
    setActiveView('tasks');
    handleSelectTask(task);
  };

  const handleAddUser = (newUserData: Omit<User, 'id' | 'initials'>) => {
    const initials = newUserData.name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const newUser: User = {
      ...newUserData,
      id: `usr-${Date.now()}`,
      initials,
    };
    setUsers((prev) => [...prev, newUser]);
    setCurrentUser(newUser);
    logActivity(`Utworzono nowe konto użytkownika: ${newUser.name} (${newUser.role})`);
  };

  // Open modal handlers
  const handleOpenNewTask = (dateStr?: string) => {
    setEditingTask(null);
    setDefaultTaskDate(dateStr);
    setIsTaskModalOpen(true);
  };

  const handleOpenEditTask = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  // Selected project info
  const activeProject = projects.find((p) => p.id === selectedProjectId);
  const activeTasks = tasks.filter((t) => (!selectedProjectId ? true : t.projectId === selectedProjectId));
  const criticalTasksCount = activeTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
  const blockedTasksCount = activeTasks.filter((t) => t.status === 'blocked').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      {/* Dynamic Toast Notification for Auto-Unlock and Hierarchy Completion */}
      {notificationToast && (
        <div className="fixed top-16 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border border-slate-700 max-w-md animate-in slide-in-from-top-4 flex items-start gap-2.5 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block text-emerald-400">Automatyczna aktualizacja zależności</span>
            <p className="mt-0.5 leading-relaxed text-slate-200">{notificationToast.message}</p>
          </div>
          <button
            onClick={() => setNotificationToast(null)}
            className="text-slate-400 hover:text-white p-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        {/* Zone 1: Brand title wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-sky-700 text-white flex items-center justify-center font-bold text-sm shadow-xs">
            ZP
          </div>
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Zarządzanie Projektami
          </span>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-semibold text-slate-600">
          <button
            onClick={() => setActiveView('gantt')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'gantt'
                ? 'text-sky-700 border-b-2 border-sky-600'
                : 'hover:text-slate-900'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Harmonogram Gantta</span>
          </button>

          <button
            onClick={() => setActiveView('calendar')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'calendar'
                ? 'text-sky-700 border-b-2 border-sky-600'
                : 'hover:text-slate-900'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>Terminarz</span>
          </button>

          <button
            onClick={() => setActiveView('tasks')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'tasks'
                ? 'text-sky-700 border-b-2 border-sky-600'
                : 'hover:text-slate-900'
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span>Zadania</span>
          </button>

          <button
            onClick={() => setActiveView('kanban')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'kanban'
                ? 'text-sky-700 border-b-2 border-sky-600'
                : 'hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Tablica Kanban</span>
          </button>

          <button
            onClick={() => setActiveView('projects')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'projects'
                ? 'text-sky-700 border-b-2 border-sky-600'
                : 'hover:text-slate-900'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Projekty</span>
          </button>
        </nav>

        {/* Zone 3: Primary Actions & User Auth */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Archiwizacja i Kopie Zapasowe (Google Drive / FTP) */}
          <button
            onClick={() => setIsArchiveModalOpen(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded transition-all whitespace-nowrap shadow-xs"
            title="Kopie zapasowe i archiwizacja: Google Drive, serwer FTP/SFTP oraz zrzuty bazy PostgreSQL"
          >
            <Cloud className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Archiwizacja & Kopie</span>
            <span className="sm:hidden">Kopie</span>
          </button>

          {/* Live Google Calendar Sync Modal Trigger */}
          <button
            onClick={() => setIsCalendarSyncModalOpen(true)}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3 py-1.5 rounded transition-all whitespace-nowrap shadow-xs"
            title="Konfiguracja automatycznej synchronizacji na żywo z Kalendarzem Google"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse text-sky-200" />
            <span className="hidden md:inline">Google Calendar na żywo</span>
            <span className="md:hidden">Kalendarz</span>
          </button>

          {/* Docker & PostgreSQL Modal Trigger */}
          <button
            onClick={() => setIsDockerModalOpen(true)}
            className="hidden sm:flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap border border-slate-200"
            title="Konfiguracja wdrożenia lokalnego: Docker Compose & PostgreSQL 16"
          >
            <Server className="w-3.5 h-3.5 text-sky-700" />
            <span>Wdrożenie Docker</span>
          </button>

          {/* User Switcher / Current User Badge */}
          <button
            onClick={() => setIsUserModalOpen(true)}
            className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md transition-colors text-left"
            title="Kliknij, aby zmienić aktywnego użytkownika lub podejrzeć historię audytu"
          >
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
              {currentUser.initials}
            </div>
            <div className="hidden xl:flex flex-col">
              <span className="text-xs font-bold text-slate-800 leading-tight">{currentUser.name}</span>
              <span className="text-[10px] text-slate-500 uppercase font-medium">{currentUser.role}</span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
        </div>
      </header>

      {/* 2. SUB-HEADER WORKSPACE TOOLBAR */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Project selector & Duration in days */}
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-500 uppercase tracking-wider text-[11px]">Projekt:</span>
          <select
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value ? e.target.value : null)}
            className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="">Wszystkie projekty ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.key}] {p.name}
              </option>
            ))}
          </select>

          {activeProject && (
            <div className="hidden md:flex items-center gap-2 text-slate-500">
              <span>·</span>
              <span>Czas trwania: <strong className="text-slate-800 font-mono">{activeProject.durationDays || 30} dni</strong></span>
              <span>·</span>
              <span>Termin: <strong className="text-slate-700 font-mono">{activeProject.dueDate}</strong></span>
              <span>·</span>
              <span>Postęp: <strong className="text-slate-700 font-mono">{activeProject.progress}%</strong></span>
            </div>
          )}
        </div>

        {/* Right: Interactive Quick stats & New Task */}
        <div className="flex items-center gap-2.5">
          {/* Clickable Blocked Tasks Badge */}
          {blockedTasksCount > 0 && (
            <button
              onClick={() => {
                setTaskFilterModalType('blocked');
                setIsTaskFilterModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-amber-900 hover:text-amber-950 font-bold text-xs bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded border border-amber-300 transition-all cursor-pointer shadow-2xs hover:scale-102"
              title="Kliknij, aby wyświetlić listę zablokowanych zadań i przejść do konkretnego projektu"
            >
              <Lock className="w-3.5 h-3.5 text-amber-700" />
              <span>{blockedTasksCount} zablokowanych</span>
            </button>
          )}

          {/* Clickable Critical Tasks Badge */}
          {criticalTasksCount > 0 && (
            <button
              onClick={() => {
                setTaskFilterModalType('critical');
                setIsTaskFilterModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-rose-800 hover:text-rose-950 font-bold text-xs bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded border border-rose-300 transition-all cursor-pointer shadow-2xs hover:scale-102"
              title="Kliknij, aby wyświetlić listę krytycznych zadań i przejść do konkretnego projektu"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>{criticalTasksCount} krytycznych</span>
            </button>
          )}

          {/* Mobile view switch buttons */}
          <div className="flex lg:hidden items-center gap-1 bg-slate-100 p-0.5 rounded">
            <button
              onClick={() => setActiveView('gantt')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'gantt' ? 'bg-white shadow-xs font-bold text-sky-700' : 'text-slate-600'
              }`}
            >
              Gantt
            </button>
            <button
              onClick={() => setActiveView('calendar')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'calendar' ? 'bg-white shadow-xs font-bold text-sky-700' : 'text-slate-600'
              }`}
            >
              Terminarz
            </button>
            <button
              onClick={() => setActiveView('tasks')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'tasks' ? 'bg-white shadow-xs font-bold text-sky-700' : 'text-slate-600'
              }`}
            >
              Zadania
            </button>
            <button
              onClick={() => setActiveView('kanban')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'kanban' ? 'bg-white shadow-xs font-bold text-sky-700' : 'text-slate-600'
              }`}
            >
              Kanban
            </button>
          </div>

          <button
            onClick={() => handleOpenNewTask()}
            className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE VIEWPORT (maksymalna szerokość - 100% ekranu) */}
      <main className="flex-1 py-3 px-2 sm:px-3 lg:px-4 w-full max-w-none">
        {activeView === 'gantt' && (
          <GanttChart
            tasks={tasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTask={() => handleOpenNewTask()}
          />
        )}

        {activeView === 'calendar' && (
          <CalendarView
            tasks={tasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTaskWithDate={(dateStr) => handleOpenNewTask(dateStr)}
          />
        )}

        {activeView === 'tasks' && (
          <TaskListView
            tasks={tasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTask={() => handleOpenNewTask()}
            onDeleteTask={handleDeleteTask}
            onUpdateStatus={handleUpdateStatus}
          />
        )}

        {activeView === 'kanban' && (
          <KanbanView
            tasks={tasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTask={() => handleOpenNewTask()}
            onUpdateStatus={handleUpdateStatus}
          />
        )}

        {activeView === 'projects' && (
          <ProjectsOverview
            projects={projects}
            tasks={tasks}
            users={users}
            onSelectProject={(projId) => {
              setSelectedProjectId(projId);
              setActiveView('gantt');
            }}
            onAddProject={handleAddProject}
            onUpdateProject={handleUpdateProject}
          />
        )}
      </main>

      {/* 4. MODALS & DRAWERS */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
        }}
        onSave={handleSaveTask}
        projects={projects}
        users={users}
        allTasks={tasks}
        defaultProjectId={selectedProjectId}
        defaultDate={defaultTaskDate}
        initialTask={editingTask}
      />

      <TaskDetailDrawer
        task={selectedTaskDetail}
        projects={projects}
        users={users}
        allTasks={tasks}
        currentUser={currentUser}
        onClose={() => setSelectedTaskDetail(null)}
        onEdit={(task) => {
          setSelectedTaskDetail(null);
          handleOpenEditTask(task);
        }}
        onUpdateStatus={handleUpdateStatus}
        onUpdateProgress={handleUpdateProgress}
        onAddComment={handleAddComment}
        comments={comments}
        onNavigateToTask={handleSelectTask}
      />

      <GoogleCalendarSyncModal
        isOpen={isCalendarSyncModalOpen}
        onClose={() => setIsCalendarSyncModalOpen(false)}
        currentUser={currentUser}
        users={users}
        tasks={tasks}
        projects={projects}
        onSwitchUser={(user) => {
          setCurrentUser(user);
          logActivity(`${user.name} przełączył profil synchronizacji`);
        }}
      />

      <DockerDeploymentModal
        isOpen={isDockerModalOpen}
        onClose={() => setIsDockerModalOpen(false)}
      />

      <UserAuthModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        currentUser={currentUser}
        users={users}
        onSwitchUser={(user) => {
          setCurrentUser(user);
          logActivity(`${user.name} zalogował się do systemu`);
        }}
        onAddUser={handleAddUser}
        activityLogs={activityLogs}
      />

      {/* Task Filter Modal for Clickable Blocked & Critical Badges */}
      <TaskFilterModal
        isOpen={isTaskFilterModalOpen}
        onClose={() => setIsTaskFilterModalOpen(false)}
        activeFilter={taskFilterModalType}
        onChangeFilter={(f) => setTaskFilterModalType(f)}
        tasks={tasks}
        projects={projects}
        users={users}
        onNavigateToTaskAndProject={handleNavigateToTaskAndProject}
      />

      {/* Archiving & Backup Modal (Google Drive, FTP/SFTP, PostgreSQL) */}
      <ArchiveBackupModal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        projects={projects}
        tasks={tasks}
        users={users}
        comments={comments}
        activityLogs={activityLogs}
        onRestoreData={({ projects: p, tasks: t, users: u, comments: c }) => {
          if (p) setProjects(p);
          if (t) setTasks(t);
          if (u) setUsers(u);
          if (c) setComments(c);
        }}
        onLogActivity={(action, entityId, details) => logActivity(action, entityId, details)}
      />
    </div>
  );
}
