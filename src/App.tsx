import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { Task, Project, User, Priority, TaskStatus, ActivityLog, Comment, ProjectTemplate } from './types';
import { INITIAL_PROJECTS, INITIAL_TASKS, INITIAL_ACTIVITY } from './data/initialData';
import { GanttChart } from './components/GanttChart';
import { CalendarView } from './components/CalendarView';
import { TaskListView } from './components/TaskListView';
import { KanbanView } from './components/KanbanView';
import { ProjectsOverview } from './components/ProjectsOverview';
import { TaskTreeView } from './components/TaskTreeView';
import { TaskModal } from './components/TaskModal';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { UserAuthModal } from './components/UserAuthModal';
import { TaskFilterModal } from './components/TaskFilterModal';
import { LoginGate } from './components/LoginGate';

// Lazy loading dla rzadziej otwieranych dużych modali (optymalizacja wielkości chunku)
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const ArchiveBackupModal = lazy(() =>
  import('./components/ArchiveBackupModal').then((m) => ({ default: m.ArchiveBackupModal }))
);
const DockerDeploymentModal = lazy(() =>
  import('./components/DockerDeploymentModal').then((m) => ({ default: m.DockerDeploymentModal }))
);
const GitHubUpdateModal = lazy(() =>
  import('./components/GitHubUpdateModal').then((m) => ({ default: m.GitHubUpdateModal }))
);
const GoogleCalendarSyncModal = lazy(() =>
  import('./components/GoogleCalendarSyncModal').then((m) => ({ default: m.GoogleCalendarSyncModal }))
);
import { getTodayIso, addDaysIso } from './utils/today';
import { instantiateTasksFromTemplate } from './utils/projectTemplates';
import { getNextProjectCode } from './utils/projectCode';
import { downloadIcsFile } from './utils/calendar';
import { getAutoBackupConfig, createAutoBackupSnapshot } from './utils/autoBackup';
import { ThemeMode, getThemePreference, setThemePreference, initThemeListener } from './utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL } from './data/dockerConfig';
import { isDemoUser, isDemoProject } from './utils/demoData';
import { sortTasksByPriorityAndDueDate } from './utils/taskSorting';
import { cascadeScheduleDates } from './utils/scheduleCascade';
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
  Cloud,
  GitBranch,
  Sparkles,
  X,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Laptop,
  UserCheck,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw
} from 'lucide-react';

type ActiveView = 'gantt' | 'calendar' | 'tasks' | 'tree' | 'kanban' | 'projects';

export default function App() {
  // Authentication session gate: requires login on first visit or after logout
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return localStorage.getItem('oph_is_authenticated') === 'true';
    } catch {
      return false;
    }
  });

  // Setup required state (detected from server /api/auth/setup-status)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  // Persistence state with users loaded strictly from server
  const [users, setUsers] = useState<User[]>([]);

  const [currentUser, setCurrentUser] = useState<User>({
    id: '',
    name: '',
    email: '',
    role: 'admin',
    department: '',
    initials: '',
  });

  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);

  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);

  // Universal task sorting: Priority (critical -> high -> normal -> low), then due date
  const sortedTasks = useMemo(() => sortTasksByPriorityAndDueDate(tasks), [tasks]);

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(INITIAL_ACTIVITY);

  const [comments, setComments] = useState<Comment[]>([]);

  // UI state
  const [activeView, setActiveView] = useState<ActiveView>('gantt');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Modals & Drawers
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultTaskDate, setDefaultTaskDate] = useState<string | undefined>(undefined);
  const [defaultParentId, setDefaultParentId] = useState<string | undefined>(undefined);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<Task | null>(null);
  const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isCalendarSyncModalOpen, setIsCalendarSyncModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isTaskFilterModalOpen, setIsTaskFilterModalOpen] = useState(false);
  const [taskFilterModalType, setTaskFilterModalType] = useState<'blocked' | 'critical'>('blocked');
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [hasDismissedUpdateBanner, setHasDismissedUpdateBanner] = useState(false);
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(() => {
    return localStorage.getItem('oph_update_available') === 'true';
  });

  // Settings & Theme State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'theme' | 'update' | 'docker' | 'users' | 'backup' | 'variables'>('theme');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getThemePreference());
  const [serverBackupStatus, setServerBackupStatus] = useState<{
    active: boolean;
    lastBackup: { filename: string; timestamp: string; ageHours: number; size: number } | null;
    maxAgeHours: number;
    message?: string;
  } | null>(null);
  const [isBackupActive, setIsBackupActive] = useState<boolean>(false);

  // Initialize theme listener on mount
  useEffect(() => {
    const cleanup = initThemeListener((isDark) => {
      setThemeMode(getThemePreference());
    });
    return cleanup;
  }, []);

  // Automatyczna weryfikacja aktualizacji przez serwerowy endpoint /api/system/check-update
  useEffect(() => {
    try {
      const lastCheck = localStorage.getItem('oph_last_daily_update_check');
      const now = Date.now();
      const sixHoursMs = 6 * 60 * 60 * 1000;
      if (!lastCheck || now - Number(lastCheck) >= sixHoursMs) {
        localStorage.setItem('oph_last_daily_update_check', String(now));
        fetch('/api/system/check-update', { credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.hasUpdate) {
              setHasUpdateAvailable(true);
              localStorage.setItem('oph_update_available', 'true');
            }
          })
          .catch(() => {});
      }
    } catch {}
  }, []);

  // Weryfikacja aktywnej sesji HTTP w ciasteczku na starcie aplikacji
  useEffect(() => {
    let isMounted = true;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data && data.authenticated && data.user) {
          setIsAuthenticated(true);
          setCurrentUser(data.user);
          localStorage.setItem('oph_is_authenticated', 'true');
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem('oph_is_authenticated');
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setIsAuthenticated(false);
        localStorage.removeItem('oph_is_authenticated');
      });

    // Pobierz status konfiguracji oraz publiczną listę profili dla ekranu logowania (bez hashy haseł)
    fetch('/api/auth/setup-status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data) return;
        if (typeof data.setupRequired === 'boolean') {
          setSetupRequired(data.setupRequired);
        }
        if (Array.isArray(data.users)) {
          setUsers(data.users);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  // Odpytuj endpoint /api/backup/status - co 5 minut, pomijaj gdy document.hidden
  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    const fetchBackupStatus = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/backup/status', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setServerBackupStatus(data);
            setIsBackupActive(Boolean(data.active));
          }
        } else {
          if (isMounted) {
            setIsBackupActive(false);
          }
        }
      } catch {
        if (isMounted) {
          setIsBackupActive(false);
        }
      }
    };

    fetchBackupStatus();
    const interval = setInterval(fetchBackupStatus, 300000); // 5 minut (300 000 ms)
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  // Rewizja stanu na serwerze i referencje dla współbieżnej synchronizacji
  const [stateRevision, setStateRevision] = useState<number>(0);
  const stateRevisionRef = useRef<number>(0);
  stateRevisionRef.current = stateRevision;
  const editingTaskRef = useRef<Task | null>(null);
  editingTaskRef.current = editingTask;

  // Kolejka debouncingu 500 ms dla aktualizacji wielu pól jednego zadania
  const taskPatchDebounceTimers = useRef<Map<string, { timer: any; patch: Partial<Task>; baseRevision: number }>>(new Map());

  // Pobranie świeżego stanu z serwera (z zachowaniem otwartego formularza edycji)
  const fetchFreshState = async (showNotification = false) => {
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      if (res.status === 401) {
        setIsAuthenticated(false);
        localStorage.removeItem('oph_is_authenticated');
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.initialized && data.state) {
        const s = data.state;
        if (typeof s.revision === 'number') {
          setStateRevision(s.revision);
          stateRevisionRef.current = s.revision;
        }
        if (Array.isArray(s.users) && s.users.length > 0) {
          setUsers(s.users);
        }
        if (Array.isArray(s.projects)) {
          setProjects(s.projects);
        }
        if (Array.isArray(s.tasks)) {
          const currentEditingId = editingTaskRef.current?.id;
          setTasks((prevTasks) => {
            if (!currentEditingId) return s.tasks;
            // Nie nadpisuj pól zadania edytowanego obecnie w otwartym formularzu
            return s.tasks.map((incomingTask: Task) => {
              if (incomingTask.id === currentEditingId) {
                const localTask = prevTasks.find((t) => t.id === currentEditingId);
                return localTask || incomingTask;
              }
              return incomingTask;
            });
          });
        }
        if (Array.isArray(s.activityLogs)) {
          setActivityLogs(s.activityLogs);
        }
        if (Array.isArray(s.comments)) {
          setComments(s.comments);
        }
        if (showNotification) {
          setNotificationToast({
            message: 'Zmiany od innych użytkowników zostały pobrane',
            type: 'info',
          });
        }
      }
    } catch (err) {
      console.warn('Błąd odświeżania stanu z serwera:', err);
    }
  };

  // Inicjalne pobranie stanu przy starcie sesji
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchFreshState(false);
  }, [isAuthenticated]);

  // Odświeżanie: klient co 15 s odpytuje lekki endpoint GET /api/state/revision
  // Zatrzymanie odpytywania gdy karta w tle (document.hidden)
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/state/revision', { credentials: 'same-origin' });
        if (res.status === 401) {
          setIsAuthenticated(false);
          localStorage.removeItem('oph_is_authenticated');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.revision === 'number' && data.revision > stateRevisionRef.current) {
          await fetchFreshState(true);
        }
      } catch (err) {
        console.warn('Błąd odpytywania rewizji:', err);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Periodic Auto-Backup Engine
  useEffect(() => {
    const checkAndRunAutoBackup = () => {
      try {
        const config = getAutoBackupConfig();
        if (!config.enabled) return;

        const now = Date.now();
        const last = config.lastBackupTime ? new Date(config.lastBackupTime).getTime() : 0;
        const intervalMs = (config.intervalMinutes || 60) * 60 * 1000;

        if (!last || now - last >= intervalMs) {
          const snapshot = createAutoBackupSnapshot({
            projects,
            tasks,
            users,
            comments,
            activityLogs,
          });
          setNotificationToast({
            message: `Automatyczna kopia zapasowa zapisana: ${snapshot.filename}`,
            type: 'success',
          });
        }
      } catch (err) {
        console.warn('Auto backup engine error:', err);
      }
    };

    const initialTimer = setTimeout(checkAndRunAutoBackup, 4000);
    const intervalTimer = setInterval(checkAndRunAutoBackup, 60000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [projects, tasks, users, comments, activityLogs]);

  // ============================================================================
  // OPERACJE NA ZASOBACH (POST / PATCH / DELETE) Z OBSŁUGĄ 409 I DEBOUNCEM 500MS
  // ============================================================================

  const saveTaskPatchToServer = async (taskId: string, patch: Partial<Task>, baseRevision?: number, retryCount = 0): Promise<void> => {
    try {
      const targetRev = baseRevision !== undefined ? baseRevision : 1;
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(targetRev),
        },
        body: JSON.stringify(patch),
      });

      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }

      if (res.status === 409) {
        // Obsługa 409 Conflict: pobranie aktualnego zasobu, scalenie lokalnych zmian i ponowienie
        const conflictData = await res.json();
        const currentTask: Task = conflictData.currentTask;
        if (currentTask && retryCount < 3) {
          // Last-write-wins dla edytowanego pola
          const mergedPatch: Partial<Task> = { ...patch };
          setNotificationToast({
            message: 'Zadanie zostało zmienione przez innego użytkownika, zastosowano Twoją wersję',
            type: 'info',
          });
          await saveTaskPatchToServer(taskId, mergedPatch, currentTask.revision || 1, retryCount + 1);
          return;
        }
      }

      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          setStateRevision(data.revision);
          stateRevisionRef.current = data.revision;
        }
        if (data.task) {
          setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...data.task } : t)));
        }
      }
    } catch (err) {
      console.warn('Błąd zapisu zadania do API:', err);
    }
  };

  const queueTaskPatch = (taskId: string, patch: Partial<Task>, baseRevision?: number) => {
    const existing = taskPatchDebounceTimers.current.get(taskId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.patch = { ...existing.patch, ...patch };
    } else {
      taskPatchDebounceTimers.current.set(taskId, {
        timer: null,
        patch,
        baseRevision: baseRevision || 1,
      });
    }

    const record = taskPatchDebounceTimers.current.get(taskId)!;
    record.timer = setTimeout(() => {
      const queued = taskPatchDebounceTimers.current.get(taskId);
      taskPatchDebounceTimers.current.delete(taskId);
      if (queued) {
        saveTaskPatchToServer(taskId, queued.patch, queued.baseRevision);
      }
    }, 500);
  };

  const createTaskOnServer = async (task: Task) => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          setStateRevision(data.revision);
          stateRevisionRef.current = data.revision;
        }
        if (data.task) {
          setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...data.task } : t)));
        }
      }
    } catch (err) {
      console.warn('Błąd tworzenia zadania na serwerze:', err);
    }
  };

  const deleteTaskOnServer = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (!res.ok) {
        const errData = await res.json();
        setNotificationToast({
          message: errData.error || 'Nie udało się usunąć zadania',
          type: 'info',
        });
        await fetchFreshState(false);
        return;
      }
      const data = await res.json();
      if (typeof data.revision === 'number') {
        setStateRevision(data.revision);
        stateRevisionRef.current = data.revision;
      }
    } catch (err) {
      console.warn('Błąd usuwania zadania z serwera:', err);
    }
  };

  const createProjectOnServer = async (project: Project) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          setStateRevision(data.revision);
          stateRevisionRef.current = data.revision;
        }
        if (data.project) {
          setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...data.project } : p)));
        }
      }
    } catch (err) {
      console.warn('Błąd tworzenia projektu na serwerze:', err);
    }
  };

  const patchProjectOnServer = async (projectId: string, patch: Partial<Project>, expectedRevision?: number) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(expectedRevision || 1),
        },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.status === 409) {
        const conflict = await res.json();
        if (conflict.currentProject) {
          setNotificationToast({
            message: 'Projekt został zmieniony przez innego użytkownika, zastosowano Twoją wersję',
            type: 'info',
          });
          await patchProjectOnServer(projectId, patch, conflict.currentProject.revision || 1);
          return;
        }
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          setStateRevision(data.revision);
          stateRevisionRef.current = data.revision;
        }
      }
    } catch (err) {
      console.warn('Błąd aktualizacji projektu na serwerze:', err);
    }
  };

  const deleteProjectOnServer = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (!res.ok) {
        const errData = await res.json();
        setNotificationToast({
          message: errData.error || 'Brak uprawnień do usunięcia projektu',
          type: 'info',
        });
        await fetchFreshState(false);
        return;
      }
      const data = await res.json();
      if (typeof data.revision === 'number') {
        setStateRevision(data.revision);
        stateRevisionRef.current = data.revision;
      }
    } catch (err) {
      console.warn('Błąd usuwania projektu na serwerze:', err);
    }
  };

  const createCommentOnServer = async (comment: Comment) => {
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(comment),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          setStateRevision(data.revision);
          stateRevisionRef.current = data.revision;
        }
      }
    } catch (err) {
      console.warn('Błąd dodawania komentarza na serwerze:', err);
    }
  };

  const createActivityOnServer = async (log: ActivityLog) => {
    try {
      const res = await fetch('/api/activity', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          setStateRevision(data.revision);
          stateRevisionRef.current = data.revision;
        }
      }
    } catch {}
  };

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
      id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      projectId: selectedProjectId || projects[0]?.id || 'prj-1',
      taskId,
      userId: currentUser.id,
      action,
      timestamp: new Date().toISOString(),
      details,
    };
    setActivityLogs((prev) => [newLog, ...prev]);
    createActivityOnServer(newLog);
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
      startDate: task.startDate || getTodayIso(),
      dueDate: task.dueDate || addDaysIso(getTodayIso(), 7),
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
    // Krok 0: Kaskadowe dostosowanie dat kolejnych etapów (w dzień zakończenia poprzedzającego zadania)
    const { updatedTasks: cascadedTasks, cascadedEvents } = cascadeScheduleDates(currentTasks);
    let tasksCopy = [...cascadedTasks];
    const events: string[] = [...cascadedEvents];

    // Step 1: Check all tasks with blockingTaskIds
    tasksCopy = tasksCopy.map((task) => {
      const blockerIds = task.blockingTaskIds || task.dependencies || [];
      if (blockerIds.length === 0) return task;

      const blockers = tasksCopy.filter((t) => blockerIds.includes(t.id));
      const allBlockersDone = blockers.length > 0 && blockers.every((b) => b.status === 'done');

      // Rule: If all blockers are done, unlock task (transition from 'blocked' to 'in_progress')
      // and adjust start date to the latest finish date of blockers!
      if (allBlockersDone && task.status === 'blocked') {
        let latestBlockerDueDate = task.startDate || getTodayIso();
        blockers.forEach((b) => {
          if (b.dueDate && b.dueDate > latestBlockerDueDate) {
            latestBlockerDueDate = b.dueDate;
          }
        });

        const newStartDate = latestBlockerDueDate;
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
      if (!allBlockersDone && task.status !== 'done') {
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
      queueTaskPatch(editingTask.id, taskData, editingTask.revision || 1);
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
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      newTaskList = [newTask, ...tasks];
      createTaskOnServer(newTask);
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
      deleteTaskOnServer(taskId);
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

    queueTaskPatch(taskId, { status: newStatus, progress }, task.revision || 1);
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

    queueTaskPatch(taskId, { progress, status }, task.revision || 1);

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
    createCommentOnServer(newComment);
    logActivity(`${currentUser.name} dodał komentarz do zadania`, taskId, content);
  };

  const handleAddProject = (newProjData: Omit<Project, 'id'>, selectedTemplate?: ProjectTemplate) => {
    const key = newProjData.key ? newProjData.key.trim().toUpperCase() : getNextProjectCode(projects);
    const newProject: Project = {
      ...newProjData,
      id: `prj-${Date.now()}`,
      key,
      revision: 1,
    };
    setProjects((prev) => [...prev, newProject]);
    setSelectedProjectId(newProject.id);
    createProjectOnServer(newProject);

    // If template was selected, instantiate blueprint tasks
    if (selectedTemplate && selectedTemplate.tasks && selectedTemplate.tasks.length > 0) {
      const templateTasks = instantiateTasksFromTemplate(
        selectedTemplate,
        newProject.id,
        newProject.startDate,
        currentUser
      );
      const { updatedTasks } = processDependencyRules([...tasks, ...templateTasks]);
      setTasks(updatedTasks);
      templateTasks.forEach((tt) => createTaskOnServer(tt));
      logActivity(
        `${currentUser.name} zarejestrował projekt [${newProject.key}] z szablonu "${selectedTemplate.name}" (${templateTasks.length} etapów)`,
        undefined,
        `Wygenerowano ${templateTasks.length} etapów w tym ${templateTasks.filter((t) => t.isOfficialDeadline).length} terminów urzędowych.`
      );
      setNotificationToast({
        message: `Utworzono projekt [${newProject.key}] z ${templateTasks.length} etapami z szablonu "${selectedTemplate.name}"!`,
        type: 'success',
      });
    } else {
      logActivity(`${currentUser.name} zarejestrował nowy projekt [${newProject.key}]: ${newProject.name} (Czas: ${newProject.durationDays} dni)`);
    }
  };

  const handleUpdateProject = (updatedProject: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
    patchProjectOnServer(updatedProject.id, updatedProject, updatedProject.revision || 1);
    logActivity(`${currentUser.name} zaktualizował projekt [${updatedProject.key}]: ${updatedProject.name}`);
  };

  const handleDeleteProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.projectId !== projectId));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
    }
    deleteProjectOnServer(projectId);
    logActivity(`Usunięto projekt "${project?.name || projectId}" wraz ze wszystkimi zadaniami`);
    setNotificationToast({
      message: `Projekt [${project?.key || ''}] został bezpowrotnie usunięty.`,
      type: 'info',
    });
  };

  const handleNavigateToTaskAndProject = (projectId: string, task: Task) => {
    setSelectedProjectId(projectId);
    setActiveView('tasks');
    handleSelectTask(task);
  };

  const handleAddUser = async (newUserData: Omit<User, 'id' | 'initials'>) => {
    if (!newUserData.password || !newUserData.password.trim()) {
      setNotificationToast({
        message: 'Hasło jest wymagane do utworzenia konta użytkownika.',
        type: 'info',
      });
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserData.name,
          email: newUserData.email,
          role: newUserData.role,
          department: newUserData.department,
          password: newUserData.password.trim(),
          twoFactorEnabled: newUserData.twoFactorEnabled,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setNotificationToast({
          message: err.error || 'Nie udało się dodać użytkownika.',
          type: 'info',
        });
        return;
      }

      const data = await res.json();
      setUsers((prev) => [...prev, data.user]);
      logActivity(`Utworzono nowe konto użytkownika: ${data.user.name} (${data.user.role})`);
      setNotificationToast({
        message: `Użytkownik ${data.user.name} został pomyślnie dodany i zabezpieczony scrypt.`,
        type: 'success',
      });
    } catch {
      setNotificationToast({
        message: 'Błąd połączenia z serwerem podczas dodawania użytkownika.',
        type: 'info',
      });
    }
  };


  // Delete all demo data (projects and their tasks)
  const handleDeleteAllDemoData = () => {
    const demoProjectIds = projects.filter(isDemoProject).map((p) => p.id);
    setProjects((prev) => prev.filter((p) => !isDemoProject(p)));
    setTasks((prev) => prev.filter((t) => !demoProjectIds.includes(t.projectId)));
    if (selectedProjectId && demoProjectIds.includes(selectedProjectId)) {
      setSelectedProjectId(null);
    }
    logActivity('Wyczyszczono wszystkie tematy i zadania demonstracyjne');
    setNotificationToast({
      message: 'Usunięto wszystkie tematy demonstracyjne. Baza projektów jest czysta.',
      type: 'success',
    });
  };

  // Delete demo users
  const handleDeleteDemoUsers = () => {
    setUsers((prev) => {
      const nonDemo = prev.filter((u) => !isDemoUser(u));
      if (nonDemo.length === 0) {
        return prev;
      }
      if (isDemoUser(currentUser)) {
        setCurrentUser(nonDemo[0]);
      }
      return nonDemo;
    });
    logActivity('Usunięto konta demonstracyjne użytkowników');
    setNotificationToast({
      message: 'Konta demonstracyjne zostały usunięte z bazy.',
      type: 'success',
    });
  };

  // Delete specific user via server endpoint
  const handleDeleteUser = async (userId: string) => {
    if (currentUser && currentUser.id === userId) {
      setNotificationToast({
        message: 'Nie możesz usunąć aktualnie aktywnego użytkownika.',
        type: 'info',
      });
      return;
    }
    const user = users.find((u) => u.id === userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        logActivity(`Usunięto użytkownika ${user?.name || userId}`);
        setNotificationToast({
          message: `Użytkownik ${user?.name || userId} został usunięty.`,
          type: 'info',
        });
      } else {
        const err = await res.json();
        setNotificationToast({
          message: err.error || 'Błąd usuwania użytkownika.',
          type: 'info',
        });
      }
    } catch {
      setNotificationToast({
        message: 'Błąd połączenia z serwerem.',
        type: 'info',
      });
    }
  };

  // Update user password via server scrypt endpoint
  const handleUpdateUserPassword = async (userId: string, newPass: string, currentPass?: string) => {
    try {
      const res = await fetch(`/api/users/${userId}/password`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPass, currentPassword: currentPass }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Błąd podczas zmiany hasła');
      }
      logActivity('Zaktualizowano hasło dostępu użytkownika (zabezpieczone scrypt)');
      setNotificationToast({
        message: 'Hasło użytkownika zostało pomyślnie zaktualizowane na serwerze (scrypt).',
        type: 'success',
      });
    } catch (e: any) {
      setNotificationToast({
        message: e.message || 'Nie udało się zmienić hasła.',
        type: 'info',
      });
    }
  };

  // Logout handler - calls logActivity first, then server logout, cleans localStorage and React state
  const handleLogout = async () => {
    // 1. Najpierw wywołaj logActivity
    logActivity(`${currentUser?.name || 'Użytkownik'} wylogował się z systemu`);

    // 2. Potem /api/auth/logout
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}

    // 3. Po wylogowaniu usuń z localStorage wszystkie klucze zaczynające się od 'oph_' z wyjątkiem preferencji wyglądu (motyw: oph_theme_mode)
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('oph_') && k !== 'oph_theme_mode') {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch {}

    // 4. Wyczyść stan React (projects, tasks, comments, activityLogs, currentUser) do wartości początkowych
    setProjects(INITIAL_PROJECTS);
    setTasks(INITIAL_TASKS);
    setComments([]);
    setActivityLogs(INITIAL_ACTIVITY);
    setCurrentUser({
      id: '',
      name: '',
      email: '',
      role: 'admin',
      department: '',
      initials: '',
    });

    setIsAuthenticated(false);
    setIsUserModalOpen(false);
    setNotificationToast({
      message: 'Wylogowano z systemu. Ekran logowania jest aktywny.',
      type: 'info',
    });
  };

  // Helper to refresh public user profiles
  const refreshUsersList = async () => {
    try {
      const res = await fetch('/api/auth/setup-status', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setUsers(data.users);
        }
      }
    } catch {}
  };

  // Login handler
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    try {
      localStorage.setItem('oph_is_authenticated', 'true');
    } catch {}

    // Synchronize latest state immediately
    fetch('/api/state', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.state) {
          if (Array.isArray(data.state.projects)) setProjects(data.state.projects);
          if (Array.isArray(data.state.tasks)) setTasks(data.state.tasks);
          if (Array.isArray(data.state.users)) setUsers(data.state.users);
          if (Array.isArray(data.state.activityLogs)) setActivityLogs(data.state.activityLogs);
          if (Array.isArray(data.state.comments)) setComments(data.state.comments);
        }
      })
      .catch(() => {});

    logActivity(`${user.name} zalogował się do systemu`);
    setNotificationToast({
      message: `Zalogowano jako ${user.name}. Dobrej pracy w pracowni!`,
      type: 'success',
    });
  };

  // Registration handler via server endpoint
  const handleRegisterUser = async (newUserData: Omit<User, 'id' | 'initials'>) => {
    if (!newUserData.password || !newUserData.password.trim()) {
      setNotificationToast({
        message: 'Hasło jest wymagane do rejestracji konta.',
        type: 'info',
      });
      return;
    }
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserData.name,
          email: newUserData.email,
          role: newUserData.role,
          department: newUserData.department,
          password: newUserData.password.trim(),
          twoFactorEnabled: newUserData.twoFactorEnabled,
        }),
      });

      if (res.ok) {
        await refreshUsersList();
        logActivity(`Nowa rejestracja konta: ${newUserData.name} (${newUserData.email}) - oczekuje na zatwierdzenie przez Administratora`);
        setNotificationToast({
          message: `Wniosek rejestracji użytkownika ${newUserData.name} został zarejestrowany. Administrator musi zatwierdzić konto przed pierwszym logowaniem.`,
          type: 'info',
        });
      }
    } catch {}
  };

  // Administrator approval handlers via dedicated endpoints
  const handleApproveUser = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    try {
      const res = await fetch(`/api/users/${userId}/approve`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isApproved: true } : u)));
        logActivity(`Administrator zatwierdził konto użytkownika: ${user?.name || userId}`);
        setNotificationToast({
          message: `Konto ${user?.name || userId} zostało pomyślnie zatwierdzone. Użytkownik ma teraz dostęp do systemu.`,
          type: 'success',
        });
      } else {
        const err = await res.json();
        setNotificationToast({
          message: err.error || 'Błąd zatwierdzania konta.',
          type: 'info',
        });
      }
    } catch {}
  };

  const handleRejectUser = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        logActivity(`Administrator odrzucił wniosek rejestracji użytkownika: ${user?.name || userId}`);
        setNotificationToast({
          message: `Wniosek rejestracyjny ${user?.name || userId} został odrzucony i usunięty.`,
          type: 'info',
        });
      }
    } catch {}
  };

  // Quick theme toggle
  const toggleThemeQuick = () => {
    const isDark = document.documentElement.classList.contains('dark');
    const newMode: ThemeMode = isDark ? 'light' : 'dark';
    setThemePreference(newMode);
    setThemeMode(newMode);
  };

  // Open modal handlers
  const handleOpenNewTask = (dateStr?: string, parentTaskId?: string, projectId?: string) => {
    setEditingTask(null);
    setDefaultTaskDate(dateStr);
    setDefaultParentId(parentTaskId);
    if (projectId) {
      setSelectedProjectId(projectId);
    }
    setIsTaskModalOpen(true);
  };

  const handleOpenEditTask = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  // Selected project info & Pending users
  const activeProject = projects.find((p) => p.id === selectedProjectId);
  const activeTasks = tasks.filter((t) => (!selectedProjectId ? true : t.projectId === selectedProjectId));
  const criticalTasksCount = activeTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
  const blockedTasksCount = activeTasks.filter((t) => t.status === 'blocked').length;
  const pendingUsersCount = users.filter((u) => u.isApproved === false).length;

  // Gate: If user is not authenticated, show full-screen LoginGate
  if (!isAuthenticated) {
    return (
      <LoginGate
        users={users}
        setupRequired={setupRequired !== null ? setupRequired : undefined}
        onLogin={handleLoginSuccess}
        onRegister={handleRegisterUser}
        onUpdateUserPassword={handleUpdateUserPassword}
        onRefreshUsers={refreshUsersList}
      />
    );
  }

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
      <header className="flex items-center justify-between gap-6 px-4 sm:px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-xs">
        {/* Zone 1: Brand title wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-sky-700 dark:bg-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
            ZP
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap leading-tight">
              Zarządzanie Projektami
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {CURRENT_APP_VERSION}
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden lg:flex items-center gap-5 text-xs font-semibold text-slate-600 dark:text-slate-400">
          <button
            onClick={() => setActiveView('gantt')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'gantt'
                ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Harmonogram Gantta</span>
          </button>

          <button
            onClick={() => setActiveView('calendar')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'calendar'
                ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>Terminarz</span>
          </button>

          <button
            onClick={() => setActiveView('tasks')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'tasks'
                ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span>Zadania</span>
          </button>

          <button
            onClick={() => setActiveView('tree')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'tree'
                ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>Drzewo zadań</span>
          </button>

          <button
            onClick={() => setActiveView('kanban')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'kanban'
                ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Tablica Kanban</span>
          </button>

          <button
            onClick={() => setActiveView('projects')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'projects'
                ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Projekty</span>
          </button>
        </nav>

        {/* Zone 3: Primary Actions & User Auth */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Symbol archiwizacji: zielony gdy kopia na serwerze <= 36h, czerwony gdy brak lub przeterminowana */}
          <button
            onClick={() => {
              setSettingsTab('backup');
              setIsSettingsModalOpen(true);
            }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap border ${
              isBackupActive
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-400 dark:border-rose-800 hover:bg-rose-100 animate-pulse'
            }`}
            title={
              isBackupActive
                ? `Kopia zapasowa na serwerze: Aktywna (ostatnia: ${serverBackupStatus?.lastBackup ? `${serverBackupStatus.lastBackup.ageHours}h temu, ${serverBackupStatus.lastBackup.filename}` : 'w ciągu 36h'})`
                : serverBackupStatus?.lastBackup
                ? `UWAGA! Ostatnia kopia na serwerze ma ${serverBackupStatus.lastBackup.ageHours}h (przekroczono limit 36h)! Kliknij, aby sprawdzić.`
                : 'UWAGA! Brak aktualnej kopii zapasowej na serwerze (w ciągu ostatnich 36h)! Kliknij, aby skonfigurować.'
            }
          >
            <Cloud className={`w-3.5 h-3.5 ${isBackupActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
            <span className="hidden sm:inline">
              {isBackupActive ? 'Kopia: Aktywna' : 'Kopia: Brak (<36h)'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                isBackupActive ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'
              }`}
            />
          </button>

          {/* Przycisk bieżącej wersji: zielony gdy aktualna, czerwony gdy nowa wersja */}
          <button
            onClick={() => {
              setSettingsTab('update');
              setIsSettingsModalOpen(true);
            }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap border cursor-pointer ${
              hasUpdateAvailable
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-400 dark:border-rose-800 hover:bg-rose-100 animate-pulse'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
            }`}
            title={
              hasUpdateAvailable
                ? `Dostępna jest nowa wersja oprogramowania! Kliknij, aby sprawdzić i zaktualizować (Obecnie: ${CURRENT_APP_VERSION})`
                : `Wersja oprogramowania: ${CURRENT_APP_VERSION} (Wersja aktualna)`
            }
          >
            <GitBranch className={`w-3.5 h-3.5 ${hasUpdateAvailable ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`} />
            <span className="font-mono">{CURRENT_APP_VERSION}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                hasUpdateAvailable ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'
              }`}
            />
          </button>

          {/* Menu Ustawień - Symbol Zębatki ⚙️ */}
          <button
            onClick={() => {
              setSettingsTab('theme');
              setIsSettingsModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold px-2.5 py-1.5 rounded transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-700"
            title="Ustawienia systemu: Motyw ciemny/jasny, Aktualizacje, Wdrożenie Docker, Użytkownicy i Kopie"
          >
            <SettingsIcon className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
            <span className="hidden md:inline">Ustawienia</span>
          </button>

          {/* Quick Theme Switch (Sun / Moon) */}
          <button
            onClick={toggleThemeQuick}
            className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Przełącz motyw (Jasny / Ciemny)"
          >
            {themeMode === 'dark' || document.documentElement.classList.contains('dark') ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-600" />
            )}
          </button>

          {/* User Switcher / Current User Badge (Wymaga logowania) */}
          <button
            onClick={() => setIsUserModalOpen(true)}
            className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-md transition-colors text-left"
            title="Kliknij, aby przełączyć użytkownika (wymaga hasła) lub wylogować"
          >
            <div className="w-6 h-6 rounded-full bg-slate-900 dark:bg-sky-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
              {currentUser?.initials || '??'}
            </div>
            <div className="hidden xl:flex flex-col">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                {currentUser?.name || 'Zaloguj się'}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-medium">
                {currentUser?.role || 'Brak sesji'}
              </span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {/* Pending Users Notification Badge for Administrator */}
          {pendingUsersCount > 0 && currentUser?.role === 'admin' && (
            <button
              onClick={() => {
                setSettingsTab('users');
                setIsSettingsModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 animate-pulse"
              title="Nowi użytkownicy oczekują na zatwierdzenie przez Administratora"
            >
              <UserCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Oczekujące ({pendingUsersCount})</span>
            </button>
          )}

          {/* Dedykowany Przycisk Wylogowania - powrót do ekranu logowania */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/40 cursor-pointer shadow-2xs"
            title="Wyloguj się z systemu i przejdź do ekranu logowania"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Wyloguj</span>
          </button>
        </div>
      </header>

      {/* 2. SUB-HEADER WORKSPACE TOOLBAR */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors">
        {/* Left: Project selector & Duration in days */}
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px]">Projekt:</span>
          <select
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value ? e.target.value : null)}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500 transition-colors"
          >
            <option value="">Wszystkie projekty ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.key}] {p.name}
              </option>
            ))}
          </select>

          {activeProject && (
            <div className="hidden md:flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <span>·</span>
              <span>Czas trwania: <strong className="text-slate-800 dark:text-slate-200 font-mono">{activeProject.durationDays || 30} dni</strong></span>
              <span>·</span>
              <span>Termin: <strong className="text-slate-700 dark:text-slate-300 font-mono">{activeProject.dueDate}</strong></span>
              <span>·</span>
              <span>Postęp: <strong className="text-slate-700 dark:text-slate-300 font-mono">{activeProject.progress}%</strong></span>
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
              className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200 font-bold text-xs bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 transition-all cursor-pointer shadow-2xs hover:scale-102"
              title="Kliknij, aby wyświetlić listę zablokowanych zadań i przejść do konkretnego projektu"
            >
              <Lock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
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
              className="flex items-center gap-1.5 text-rose-800 dark:text-rose-200 font-bold text-xs bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 transition-all cursor-pointer shadow-2xs hover:scale-102"
              title="Kliknij, aby wyświetlić listę krytycznych zadań i przejść do konkretnego projektu"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>{criticalTasksCount} krytycznych</span>
            </button>
          )}

          {/* Mobile view switch buttons */}
          <div className="flex lg:hidden items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setActiveView('gantt')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'gantt' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Gantt
            </button>
            <button
              onClick={() => setActiveView('calendar')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'calendar' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Terminarz
            </button>
            <button
              onClick={() => setActiveView('tasks')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'tasks' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Zadania
            </button>
            <button
              onClick={() => setActiveView('tree')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'tree' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Drzewo
            </button>
            <button
              onClick={() => setActiveView('kanban')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Kanban
            </button>
          </div>

          <button
            onClick={() => handleOpenNewTask()}
            className="flex items-center gap-1 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE VIEWPORT (ciemny motyw obejmuje cały obszar roboczy) */}
      <main className="flex-1 py-3 px-2 sm:px-3 lg:px-4 w-full max-w-none bg-slate-50/50 dark:bg-slate-950 transition-colors">
        {activeView === 'gantt' && (
          <GanttChart
            tasks={sortedTasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTask={() => handleOpenNewTask()}
          />
        )}

        {activeView === 'calendar' && (
          <CalendarView
            tasks={sortedTasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTaskWithDate={(dateStr) => handleOpenNewTask(dateStr)}
          />
        )}

        {activeView === 'tasks' && (
          <TaskListView
            tasks={sortedTasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectTask={handleSelectTask}
            onOpenNewTask={() => handleOpenNewTask()}
            onDeleteTask={handleDeleteTask}
            onUpdateStatus={handleUpdateStatus}
          />
        )}

        {activeView === 'tree' && (
          <TaskTreeView
            tasks={sortedTasks}
            projects={projects}
            users={users}
            selectedProjectId={selectedProjectId}
            onSelectProject={(projId) => setSelectedProjectId(projId)}
            onSelectTask={handleSelectTask}
            onAddTask={(projId, parentTaskId) => handleOpenNewTask(undefined, parentTaskId, projId)}
            onUpdateTaskStatus={handleUpdateStatus}
          />
        )}

        {activeView === 'kanban' && (
          <KanbanView
            tasks={sortedTasks}
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
            tasks={sortedTasks}
            users={users}
            currentUser={currentUser}
            onSelectProject={(projId) => {
              setSelectedProjectId(projId);
              setActiveView('gantt');
            }}
            onAddProject={handleAddProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onDeleteAllDemoData={handleDeleteAllDemoData}
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
        allTasks={sortedTasks}
        defaultProjectId={selectedProjectId}
        defaultDate={defaultTaskDate}
        defaultParentId={defaultParentId}
        initialTask={editingTask}
      />

      <TaskDetailDrawer
        task={selectedTaskDetail}
        projects={projects}
        users={users}
        allTasks={sortedTasks}
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

      {isCalendarSyncModalOpen && (
        <Suspense fallback={null}>
          <GoogleCalendarSyncModal
            isOpen={isCalendarSyncModalOpen}
            onClose={() => setIsCalendarSyncModalOpen(false)}
            currentUser={currentUser}
            users={users}
            tasks={sortedTasks}
            projects={projects}
            onSwitchUser={(user) => {
              setCurrentUser(user);
              logActivity(`${user.name} przełączył profil synchronizacji`);
            }}
          />
        </Suspense>
      )}

      {isDockerModalOpen && (
        <Suspense fallback={null}>
          <DockerDeploymentModal
            isOpen={isDockerModalOpen}
            onClose={() => setIsDockerModalOpen(false)}
          />
        </Suspense>
      )}

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
        onDeleteUser={handleDeleteUser}
        onDeleteDemoUsers={handleDeleteDemoUsers}
        onUpdateUserPassword={handleUpdateUserPassword}
        onUserUpdated={(updated) => {
          if (currentUser) {
            const next = { ...currentUser, ...updated };
            setCurrentUser(next);
            setUsers((prev) => prev.map((u) => (u.id === next.id ? { ...u, ...updated } : u)));
          }
        }}
        onLogout={handleLogout}
        activityLogs={activityLogs}
        onOpenTemplateManager={() => {
          setActiveView('projects');
          setNotificationToast({
            message: 'Otwarto widok projektów. Kliknij "Szablony projektów (Admin)", aby zarządzać szablonami pracowni.',
            type: 'info',
          });
        }}
      />

      {/* Settings Modal (Symbol zębatki ⚙️: Motyw, Zmienne VAT & Inwestorzy, Aktualizacje, Docker, Użytkownicy, Archiwizacja) */}
      {isSettingsModalOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            users={users}
            projects={projects}
            currentUser={currentUser}
            hasUpdateAvailable={hasUpdateAvailable}
            onToggleUpdateSimulation={(val) => {
              setHasUpdateAvailable(val);
              localStorage.setItem('oph_update_available', String(val));
            }}
            onDeleteDemoUsers={handleDeleteDemoUsers}
            onDeleteAllDemoData={handleDeleteAllDemoData}
            onOpenUserModal={() => setIsUserModalOpen(true)}
            onOpenArchiveModal={() => setIsArchiveModalOpen(true)}
            onApproveUser={handleApproveUser}
            onRejectUser={handleRejectUser}
            onUserUpdated={(updated) => {
              if (currentUser) {
                const next = { ...currentUser, ...updated };
                setCurrentUser(next);
                setUsers((prev) => prev.map((u) => (u.id === next.id ? { ...u, ...updated } : u)));
              }
            }}
            onRefreshUsers={refreshUsersList}
            initialTab={settingsTab}
          />
        </Suspense>
      )}

      {/* Task Filter Modal for Clickable Blocked & Critical Badges */}
      <TaskFilterModal
        isOpen={isTaskFilterModalOpen}
        onClose={() => setIsTaskFilterModalOpen(false)}
        activeFilter={taskFilterModalType}
        onChangeFilter={(f) => setTaskFilterModalType(f)}
        tasks={sortedTasks}
        projects={projects}
        users={users}
        onNavigateToTaskAndProject={handleNavigateToTaskAndProject}
      />

      {/* Archiving & Backup Modal (Google Drive, FTP/SFTP, PostgreSQL) */}
      {isArchiveModalOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* GitHub Version Update Checker & Simulation Modal */}
      {isGitHubModalOpen && (
        <Suspense fallback={null}>
          <GitHubUpdateModal
            isOpen={isGitHubModalOpen}
            onClose={() => setIsGitHubModalOpen(false)}
            currentVersion={CURRENT_APP_VERSION}
            latestVersion={CURRENT_APP_VERSION}
            onUpdateCompleted={() => {
              setNotificationToast({
                message: `Aplikacja zaktualizowana do wersji ${CURRENT_APP_VERSION} (GitHub). Wszystkie dane bazy PostgreSQL zostały zachowane!`,
                type: 'success',
              });
              setHasDismissedUpdateBanner(true);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
