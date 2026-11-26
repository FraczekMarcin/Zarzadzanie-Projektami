import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { Task, Project, ProjectDeliverable, ActivityLog, Comment, ProjectTemplate, Company, ProjectNumberingSettings } from './types';
import { INITIAL_PROJECTS, INITIAL_TASKS, INITIAL_ACTIVITY } from './data/initialData';
import type { SettingsTab } from './components/SettingsModal';
import { useAuthSession, NotificationToast } from './hooks/useAuthSession';
import { useServerSync } from './hooks/useServerSync';
import { useTaskActions } from './hooks/useTaskActions';
import { useDeepLink } from './hooks/useDeepLink';
import { useDismissOnOutsideClick } from './hooks/useDismissOnOutsideClick';
import type { FormSubmitResult } from './hooks/useFormSubmit';

// Leniwe ładowanie widoków oraz ciężkich modali/szuflad (optymalizacja początkowego rozmiaru paczki)
const loadLoginGate = () => import('./components/LoginGate').then((m) => ({ default: m.LoginGate }));
const loadGanttChart = () => import('./components/GanttChart').then((m) => ({ default: m.GanttChart }));
const loadCalendarView = () => import('./components/CalendarView').then((m) => ({ default: m.CalendarView }));
const loadTaskListView = () => import('./components/TaskListView').then((m) => ({ default: m.TaskListView }));
const loadTaskTreeView = () => import('./components/TaskTreeView').then((m) => ({ default: m.TaskTreeView }));
const loadKanbanView = () => import('./components/KanbanView').then((m) => ({ default: m.KanbanView }));
const loadProjectsOverview = () => import('./components/ProjectsOverview').then((m) => ({ default: m.ProjectsOverview }));
const loadEconomyView = () => import('./components/EconomyView').then((m) => ({ default: m.EconomyView }));
const loadTendersView = () => import('./components/TendersView').then((m) => ({ default: m.TendersView }));
const loadTrashView = () => import('./components/TrashView').then((m) => ({ default: m.TrashView }));
const loadTaskModal = () => import('./components/TaskModal').then((m) => ({ default: m.TaskModal }));
const loadTaskDetailDrawer = () => import('./components/TaskDetailDrawer').then((m) => ({ default: m.TaskDetailDrawer }));
const loadUserAuthModal = () => import('./components/UserAuthModal').then((m) => ({ default: m.UserAuthModal }));
const loadTaskFilterModal = () => import('./components/TaskFilterModal').then((m) => ({ default: m.TaskFilterModal }));
const loadSettingsModal = () => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }));
const loadArchiveBackupModal = () => import('./components/ArchiveBackupModal').then((m) => ({ default: m.ArchiveBackupModal }));
const loadDockerDeploymentModal = () => import('./components/DockerDeploymentModal').then((m) => ({ default: m.DockerDeploymentModal }));
const loadGitHubUpdateModal = () => import('./components/GitHubUpdateModal').then((m) => ({ default: m.GitHubUpdateModal }));
const loadGoogleCalendarSyncModal = () => import('./components/GoogleCalendarSyncModal').then((m) => ({ default: m.GoogleCalendarSyncModal }));

const LoginGate = lazy(loadLoginGate);
const GanttChart = lazy(loadGanttChart);
const CalendarView = lazy(loadCalendarView);
const TaskListView = lazy(loadTaskListView);
const TaskTreeView = lazy(loadTaskTreeView);
const KanbanView = lazy(loadKanbanView);
const ProjectsOverview = lazy(loadProjectsOverview);
const EconomyView = lazy(loadEconomyView);
const TendersView = lazy(loadTendersView);
const TrashView = lazy(loadTrashView);
const TaskModal = lazy(loadTaskModal);
const TaskDetailDrawer = lazy(loadTaskDetailDrawer);
const UserAuthModal = lazy(loadUserAuthModal);
const TaskFilterModal = lazy(loadTaskFilterModal);
const SettingsModal = lazy(loadSettingsModal);
const ArchiveBackupModal = lazy(loadArchiveBackupModal);
const DockerDeploymentModal = lazy(loadDockerDeploymentModal);
const GitHubUpdateModal = lazy(loadGitHubUpdateModal);
const GoogleCalendarSyncModal = lazy(loadGoogleCalendarSyncModal);
import { useFocusTrap } from './utils/useFocusTrap';
import { getNextProjectCode } from './utils/projectCode';
import { downloadIcsFile } from './utils/calendar';
import { getAutoBackupConfig, createAutoBackupSnapshot } from './utils/autoBackup';
import { ThemeMode, getThemePreference, setThemePreference, initThemeListener } from './utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL } from './data/dockerConfig';
import { isDemoProject } from './utils/demoData';
import { sortTasksByPriorityAndDueDate } from './utils/taskSorting';
import { canViewFinance } from './utils/access';
import { getProjectDisplayName } from './utils/projectMeta';
import {
  computeProgressMap,
  computeProjectProgress,
  DEFAULT_PROGRESS_WEIGHTING,
  ProgressWeighting,
} from './utils/progress';
import { 
  FolderKanban, 
  Calendar as CalendarIcon, 
  ListTodo, 
  LayoutGrid, 
  Briefcase, 
  Wallet,
  Gavel,
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
  RotateCcw,
  Info,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { canAccessTenders } from './utils/tenderUi';

type ActiveView = 'gantt' | 'calendar' | 'tasks' | 'tree' | 'kanban' | 'projects' | 'economy' | 'tenders' | 'trash';

const VIEW_PRELOADERS: Record<ActiveView, () => Promise<unknown>> = {
  gantt: loadGanttChart,
  calendar: loadCalendarView,
  tasks: loadTaskListView,
  tree: loadTaskTreeView,
  kanban: loadKanbanView,
  projects: loadProjectsOverview,
  economy: loadEconomyView,
  tenders: loadTendersView,
  trash: loadTrashView,
};

const preloadView = (view: ActiveView) => {
  VIEW_PRELOADERS[view]().catch(() => {});
};

const ViewLoadingFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="min-h-[60vh] w-full flex items-center justify-center rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/60"
  >
    <div className="flex items-center gap-2.5 text-xs font-medium text-slate-600 dark:text-slate-300">
      <RefreshCw className="w-4 h-4 animate-spin text-sky-700 dark:text-sky-400" aria-hidden="true" />
      <span>Ładowanie widoku...</span>
    </div>
  </div>
);

const LoginLoadingFallback: React.FC = () => (
  <main
    id="main-content"
    tabIndex={-1}
    className="min-h-screen bg-slate-900 flex items-center justify-center p-4 focus:outline-none"
  >
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 text-xs font-medium text-slate-300">
      <RefreshCw className="w-4 h-4 animate-spin text-sky-400" aria-hidden="true" />
      <span>Ładowanie panelu logowania...</span>
    </div>
  </main>
);

export default function App() {
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);

  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [progressWeighting, setProgressWeighting] = useState<ProgressWeighting>(
    DEFAULT_PROGRESS_WEIGHTING
  );

  const progressMap = useMemo(
    () => computeProgressMap(tasks, { weighting: progressWeighting }),
    [tasks, progressWeighting]
  );

  const tasksWithProgress = useMemo(
    () =>
      tasks.map((t) => {
        const computed = progressMap.get(t.id);
        return computed !== undefined && computed !== t.progress
          ? { ...t, progress: computed }
          : t;
      }),
    [tasks, progressMap]
  );

  // Universal task sorting: Priority (critical -> high -> normal -> low), then due date
  const sortedTasks = useMemo(
    () => sortTasksByPriorityAndDueDate(tasksWithProgress),
    [tasksWithProgress]
  );

  const projectsWithProgress = useMemo(() => {
    const byProject = new Map<string, Task[]>();
    for (const t of tasksWithProgress) {
      const list = byProject.get(t.projectId);
      if (list) list.push(t);
      else byProject.set(t.projectId, [t]);
    }
    return projects.map((p) => {
      const computed = computeProjectProgress(byProject.get(p.id) || [], {
        weighting: progressWeighting,
      });
      return computed !== p.progress ? { ...p, progress: computed } : p;
    });
  }, [projects, tasksWithProgress, progressWeighting]);

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(INITIAL_ACTIVITY);

  const [comments, setComments] = useState<Comment[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projectNumbering, setProjectNumbering] = useState<ProjectNumberingSettings>({ scope: 'year' });

  // UI state
  const [activeView, setActiveView] = useState<ActiveView>('gantt');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<NotificationToast | null>(null);

  // Modals & Drawers
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const editingTaskRef = useRef<Task | null>(null);
  editingTaskRef.current = editingTask;
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('theme');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getThemePreference());
  const [serverBackupStatus, setServerBackupStatus] = useState<{
    active: boolean;
    lastBackup: { filename: string; timestamp: string; ageHours: number; size: number } | null;
    maxAgeHours: number;
    message?: string;
  } | null>(null);
  const [isBackupActive, setIsBackupActive] = useState<boolean>(false);
  const [systemDiskStatus, setSystemDiskStatus] = useState<{
    freeBytes: number;
    totalBytes: number;
    freePercent: number;
    level: 'ok' | 'warn' | 'critical';
  } | null>(null);
  const [trashRetentionDays, setTrashRetentionDays] = useState<number>(30);
  const [pendingDetailProjectId, setPendingDetailProjectId] = useState<string | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [isSmtpBannerDismissed, setIsSmtpBannerDismissed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('zp_smtp_banner_dismissed_until');
      if (!raw) return false;
      const until = Number(raw);
      if (Number.isFinite(until) && until > Date.now()) {
        return true;
      }
      localStorage.removeItem('zp_smtp_banner_dismissed_until');
    } catch {}
    return false;
  });

  const closeEventSourceRef = useRef<() => void>(() => {});
  const logActivityRef = useRef<(action: string, taskId?: string, details?: string) => void>(() => {});
  const taskDeleteModalRef = useRef<HTMLDivElement>(null);

  // Initialize theme listener on mount
  useEffect(() => {
    const cleanup = initThemeListener((isDark) => {
      setThemeMode(getThemePreference());
    });
    return cleanup;
  }, []);

  const {
    isAuthenticated,
    setIsAuthenticated,
    setupRequired,
    users,
    setUsers,
    currentUser,
    setCurrentUser,
    refreshUsersList,
    handleLoginSuccess,
    handleLogout,
    handleRegisterUser,
    handleApproveUser,
    handleRejectUser,
    handleAddUser,
    handleDeleteUser,
    handleDeleteDemoUsers,
    handleUpdateUserPassword,
  } = useAuthSession({
    setProjects,
    setCompanies,
    setProjectNumbering,
    setProgressWeighting,
    setTasks,
    setActivityLogs,
    setComments,
    setNotificationToast,
    setIsUserModalOpen,
    closeEventSourceRef,
    logActivityRef,
  });

  const canViewEconomy = useMemo(
    () => projects.some((p) => canViewFinance(currentUser, p)),
    [projects, currentUser]
  );

  const canViewTenders = useMemo(
    () => canAccessTenders(currentUser),
    [currentUser]
  );

  // Natychmiastowe ładowanie domyślnego widoku po zalogowaniu oraz doładowanie pozostałych w bezczynności
  useEffect(() => {
    if (!isAuthenticated) return;

    preloadView('gantt');

    const preloadRemainingViews = () => {
      preloadView('tasks');
      preloadView('kanban');
      preloadView('projects');
      preloadView('calendar');
      preloadView('tree');
      preloadView('trash');
      if (canViewEconomy) {
        preloadView('economy');
      }
      if (canViewTenders) {
        preloadView('tenders');
      }
      loadTaskDetailDrawer().catch(() => {});
      loadTaskModal().catch(() => {});
    };

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof win.requestIdleCallback === 'function') {
      const idleId = win.requestIdleCallback(preloadRemainingViews, { timeout: 2000 });
      return () => {
        if (typeof win.cancelIdleCallback === 'function') {
          win.cancelIdleCallback(idleId);
        }
      };
    }

    const timerId = window.setTimeout(preloadRemainingViews, 1500);
    return () => window.clearTimeout(timerId);
  }, [isAuthenticated, canViewEconomy, canViewTenders]);

  // Automatyczna weryfikacja aktualizacji przez serwerowy endpoint /api/system/check-update (wyłącznie po zalogowaniu)
  useEffect(() => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated]);

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

  const {
    hasLoadedState,
    applyRevision,
    fetchFreshState,
    createProjectOnServer,
    patchProjectOnServer,
    patchProjectFinanceOnServer,
    deleteProjectOnServer,
    createActivityOnServer,
  } = useServerSync({
    isAuthenticated,
    setIsAuthenticated,
    editingTaskRef,
    closeEventSourceRef,
    setUsers,
    setProjects,
    setCompanies,
    setProjectNumbering,
    setProgressWeighting,
    setTasks,
    setActivityLogs,
    setComments,
    setSelectedProjectId,
    setNotificationToast,
  });

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

  // Pobierz konfigurację retencji kosza po zalogowaniu i po zamknięciu ustawień
  useEffect(() => {
    if (!isAuthenticated) return;
    let mounted = true;
    fetch('/api/trash', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data && typeof data.retentionDays === 'number' && data.retentionDays > 0) {
          setTrashRetentionDays(data.retentionDays);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isAuthenticated, isSettingsModalOpen]);

  // Dla administratora sprawdź czy poczta SMTP jest skonfigurowana (odśwież po zamknięciu ustawień)
  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'admin') {
      setSmtpConfigured(null);
      return;
    }
    let mounted = true;
    fetch('/api/admin/settings', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!mounted || !data?.smtp) return;
        setSmtpConfigured(Boolean(data.smtp.configured));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isAuthenticated, currentUser?.role, isSettingsModalOpen]);

  // Dla administratora monitoruj status dysku serwera przez /api/admin/system (co 5 min, pomijaj gdy document.hidden)
  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'admin') {
      setSystemDiskStatus(null);
      return;
    }
    let mounted = true;
    const fetchSystemDisk = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/admin/system', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (mounted && data) {
          setSystemDiskStatus(data.disk ?? null);
        }
      } catch {}
    };
    fetchSystemDisk();
    const interval = setInterval(fetchSystemDisk, 300000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated, currentUser?.role, isSettingsModalOpen]);

  // Toast auto-dismiss (domyślnie 5s, np. 8s dla „Cofnij”)
  useEffect(() => {
    if (notificationToast) {
      const duration = notificationToast.durationMs ?? 5000;
      const timer = setTimeout(() => setNotificationToast(null), duration);
      return () => clearTimeout(timer);
    }
  }, [notificationToast]);

  // Activity logger helper
  const logActivity = (action: string, taskId?: string, details?: string) => {
    const validProject =
      (selectedProjectId ? projects.find((p) => p.id === selectedProjectId && !isDemoProject(p)) : undefined) ||
      projects.find((p) => !isDemoProject(p));

    const newLog: ActivityLog = {
      id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      projectId: validProject?.id || selectedProjectId || projects[0]?.id || 'prj-1',
      taskId,
      userId: currentUser.id,
      action,
      timestamp: new Date().toISOString(),
      details,
    };
    setActivityLogs((prev) => [newLog, ...prev]);
    if (validProject) {
      createActivityOnServer(newLog);
    }
  };
  logActivityRef.current = logActivity;

  const {
    createTaskOnServer,
    saveTaskPatchToServer,
    restoreFromTrashById,
    processDependencyRules,
    handleSelectTask,
    handleSaveTask,
    handleDeleteTask,
    taskToDelete,
    setTaskToDelete,
    confirmDeleteTask,
    handleUpdateStatus,
    handleUpdateProgress,
    handleUpdateTaskFields,
    handleReparentTask,
    handleAddComment,
  } = useTaskActions({
    tasks,
    setTasks,
    projects,
    currentUser,
    progressWeighting,
    editingTask,
    setEditingTask,
    selectedTaskDetail,
    setSelectedTaskDetail,
    setComments,
    setIsAuthenticated,
    setNotificationToast,
    applyRevision,
    fetchFreshState,
    logActivity,
  });

  const { backdropProps: deleteTaskBackdropProps } = useDismissOnOutsideClick({
    isOpen: Boolean(taskToDelete),
    mode: 'form',
    panelRef: taskDeleteModalRef,
    onDismiss: () => setTaskToDelete(null),
  });

  useFocusTrap({
    isOpen: Boolean(taskToDelete),
    containerRef: taskDeleteModalRef,
    onClose: () => setTaskToDelete(null),
  });

  useEffect(() => {
    if (hasLoadedState && activeView === 'economy' && !canViewEconomy) {
      setActiveView('gantt');
    }
    if (hasLoadedState && activeView === 'tenders' && !canViewTenders) {
      setActiveView('gantt');
    }
  }, [hasLoadedState, activeView, canViewEconomy, canViewTenders]);

  useDeepLink({
    isAuthenticated,
    hasLoadedState,
    tasks: tasksWithProgress,
    projects: projectsWithProgress,
    onOpenTask: handleSelectTask,
    onOpenProject: (project) => {
      setSelectedProjectId(project.id);
      setActiveView('projects');
      setPendingDetailProjectId(project.id);
    },
    onOpenEconomy: () => {
      if (canViewEconomy) {
        setActiveView('economy');
      } else {
        setNotificationToast({
          message: 'Brak uprawnień do widoku Ekonomia lub brak projektów z dostępem do finansów.',
          type: 'error',
        });
      }
    },
    onOpenTenders: () => {
      if (canViewTenders) {
        setActiveView('tenders');
      } else {
        setNotificationToast({
          message: 'Dostęp do przetargów wymaga roli administratora lub kierownika projektu.',
          type: 'error',
        });
      }
    },
    onNotifyMissing: (message) => {
      setNotificationToast({ message, type: 'error' });
    },
  });

  const handleAddProject = async (
    newProjData: Omit<Project, 'id' | 'key'> & {
      key?: string;
      templateId?: string;
      templateTaskKeys?: string[];
    },
    selectedTemplate?: ProjectTemplate
  ): Promise<FormSubmitResult<{ project: Project; tasks?: Task[] }>> => {
    const trimmedKey = newProjData.key ? newProjData.key.trim().toUpperCase() : '';
    const tempId = `prj-${Date.now()}`;
    const previewKey =
      trimmedKey ||
      getNextProjectCode(
        projects,
        [],
        companies,
        newProjData.companyId,
        new Date().getFullYear(),
        projectNumbering.scope
      );

    const payload: Omit<Project, 'id' | 'key'> & {
      id?: string;
      key?: string;
      templateId?: string;
      templateTaskKeys?: string[];
    } = {
      ...newProjData,
      id: tempId,
      ...(trimmedKey ? { key: trimmedKey } : {}),
    };

    const result = await createProjectOnServer(payload);
    if (!result.ok || !result.project) {
      return {
        ok: false,
        status: result.status,
        error: result.error || 'Nie udało się zapisać nowego projektu na serwerze.',
        field: result.field,
      };
    }

    const finalProject: Project = {
      ...result.project,
      key: result.project.key || previewKey,
    };
    setSelectedProjectId(finalProject.id);

    const createdTasksCount = Array.isArray(result.tasks) ? result.tasks.length : 0;
    if (selectedTemplate || newProjData.templateId) {
      await fetchFreshState(false);
      setNotificationToast({
        message: `Utworzono projekt [${finalProject.key}] z ${createdTasksCount} zadaniami z szablonu "${selectedTemplate?.name || newProjData.templateId}"!`,
        type: 'success',
      });
    } else {
      logActivity(`${currentUser.name} zarejestrował nowy projekt [${finalProject.key}]: ${finalProject.name} (Czas: ${finalProject.durationDays} dni)`);
      setNotificationToast({
        message: `Utworzono projekt [${finalProject.key}]: ${getProjectDisplayName(finalProject)}`,
        type: 'success',
      });
    }
    return {
      ok: true,
      status: result.status,
      data: { project: finalProject, ...(result.tasks ? { tasks: result.tasks } : {}) },
    };
  };

  const handleUpdateProject = async (updatedProject: Project): Promise<FormSubmitResult<Project>> => {
    const result = await patchProjectOnServer(
      updatedProject.id,
      updatedProject,
      updatedProject.revision || 1
    );
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.error || 'Nie udało się zapisać zmian projektu na serwerze.',
        field: result.field,
      };
    }
    const saved = result.project || updatedProject;
    logActivity(`${currentUser.name} zaktualizował projekt [${saved.key}]: ${saved.name}`);
    return { ok: true, status: result.status, data: saved };
  };

  const handleUpdateProjectDeliverables = async (
    projectId: string,
    deliverables: ProjectDeliverable[],
    expectedRevision?: number
  ): Promise<FormSubmitResult<Project>> => {
    const result = await patchProjectOnServer(
      projectId,
      { deliverables },
      expectedRevision || 1
    );
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.error || 'Nie udało się zapisać elementów do odbioru na serwerze.',
        field: result.field,
      };
    }
    return {
      ok: true,
      status: result.status,
      ...(result.project ? { data: result.project } : {}),
    };
  };

  const handleUpdateProjectFinance = async (
    projectId: string,
    patch: Partial<Project>,
    expectedRevision?: number
  ) => {
    const result = await patchProjectFinanceOnServer(projectId, patch, expectedRevision);
    if (result.ok && result.project) {
      logActivity(`${currentUser.name} zaktualizował finanse projektu [${result.project.key}]: ${result.project.name}`);
    }
    return result;
  };

  const handleApplyFreshProject = (freshProject: Project, revision?: number) => {
    if (typeof revision === 'number') {
      applyRevision(revision);
    }
    setProjects((prev) => prev.map((p) => (p.id === freshProject.id ? freshProject : p)));
  };

  const handleTaskCreatedFromEconomy = (createdTask: Task, revision?: number) => {
    if (typeof revision === 'number') {
      applyRevision(revision);
    }
    setTasks((prev) =>
      prev.some((t) => t.id === createdTask.id)
        ? prev.map((t) => (t.id === createdTask.id ? createdTask : t))
        : [...prev, createdTask]
    );
    logActivity(
      `${currentUser.name} dodał płatność do harmonogramu jako zadanie [${createdTask.code}]: ${createdTask.title}`,
      createdTask.id
    );
  };

  const handleProjectCreatedFromTender = async ({
    project,
    tasks: createdTasksFromServer,
    revision,
  }: {
    project: Project;
    tasks?: Task[];
    revision?: number;
  }) => {
    if (typeof revision === 'number') {
      applyRevision(revision);
    }
    setProjects((prev) =>
      prev.some((p) => p.id === project.id)
        ? prev.map((p) => (p.id === project.id ? project : p))
        : [...prev, project]
    );
    if (Array.isArray(createdTasksFromServer) && createdTasksFromServer.length > 0) {
      const createdIds = new Set(createdTasksFromServer.map((t) => t.id));
      setTasks((prev) => [...createdTasksFromServer, ...prev.filter((t) => !createdIds.has(t.id))]);
      await fetchFreshState(false);
    }
    setSelectedProjectId(project.id);

    if (Array.isArray(createdTasksFromServer) && createdTasksFromServer.length > 0) {
      setNotificationToast({
        message: `Utworzono projekt [${project.key}] z przetargu (${createdTasksFromServer.length} zadań z szablonu).`,
        type: 'success',
      });
    } else {
      logActivity(`${currentUser.name} utworzył projekt [${project.key}] z wygranego przetargu: ${project.name}`);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.projectId !== projectId));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
    }
    const result = await deleteProjectOnServer(projectId);
    if (result.ok) {
      setNotificationToast({
        message: 'Przeniesiono do kosza',
        type: 'info',
        durationMs: 8000,
        action: result.trashId
          ? {
              label: 'Cofnij',
              onClick: () => restoreFromTrashById(result.trashId!),
            }
          : undefined,
      });
    }
  };

  const handleNavigateToTaskAndProject = (projectId: string, task: Task) => {
    setSelectedProjectId(projectId);
    setActiveView('tasks');
    handleSelectTask(task);
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
  const activeProject = projectsWithProgress.find((p) => p.id === selectedProjectId);
  const activeTasks = tasksWithProgress.filter((t) =>
    !selectedProjectId ? true : t.projectId === selectedProjectId
  );
  const activeTaskDetail = useMemo(() => {
    if (!selectedTaskDetail) return null;
    return tasksWithProgress.find((t) => t.id === selectedTaskDetail.id) ?? selectedTaskDetail;
  }, [selectedTaskDetail, tasksWithProgress]);
  const criticalTasksCount = activeTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
  const blockedTasksCount = activeTasks.filter((t) => t.status === 'blocked').length;
  const pendingUsersCount = users.filter((u) => u.isApproved === false).length;

  // Gate: If user is not authenticated, show full-screen LoginGate
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoginLoadingFallback />}>
        <LoginGate
          users={users}
          setupRequired={setupRequired !== null ? setupRequired : undefined}
          onLogin={handleLoginSuccess}
          onRegister={handleRegisterUser}
          onUpdateUserPassword={handleUpdateUserPassword}
          onRefreshUsers={refreshUsersList}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      {/* Dynamic Toast Notification for Auto-Unlock, Hierarchy Completion & Errors */}
      {notificationToast && (
        <div
          role={notificationToast.type === 'error' ? 'alert' : 'status'}
          aria-live={notificationToast.type === 'error' ? 'assertive' : 'polite'}
          className={`fixed top-16 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border max-w-md animate-in slide-in-from-top-4 flex items-start gap-2.5 text-xs ${
            notificationToast.type === 'error'
              ? 'border-rose-600'
              : notificationToast.type === 'info'
              ? 'border-sky-600'
              : 'border-slate-700'
          }`}
        >
          {notificationToast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          ) : notificationToast.type === 'info' ? (
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <div className="flex-1">
            <span
              className={`font-bold block ${
                notificationToast.type === 'error'
                  ? 'text-rose-300'
                  : notificationToast.type === 'info'
                  ? 'text-sky-300'
                  : 'text-emerald-300'
              }`}
            >
              {notificationToast.type === 'error'
                ? 'Błąd operacji'
                : notificationToast.type === 'info'
                ? 'Informacja systemowa'
                : 'Automatyczna aktualizacja zależności'}
            </span>
            <p className="mt-0.5 leading-relaxed text-slate-200">{notificationToast.message}</p>
            {notificationToast.action && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    const fn = notificationToast.action?.onClick;
                    setNotificationToast(null);
                    fn?.();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-colors"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>{notificationToast.action.label}</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNotificationToast(null)}
            aria-label="Zamknij powiadomienie"
            className="text-slate-300 hover:text-white p-0.5 rounded"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {/* 1. TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-6 px-4 sm:px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-xs">
        {/* Zone 1: Brand title wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-sky-700 dark:bg-sky-700 text-white flex items-center justify-center font-bold text-sm shadow-xs" aria-hidden="true">
            ZP
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap leading-tight">
              Zarządzanie Projektami
            </span>
            <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
              {CURRENT_APP_VERSION}
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav aria-label="Główna nawigacja" className="hidden lg:flex items-center gap-5 text-xs font-semibold text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => setActiveView('gantt')}
            onMouseEnter={() => preloadView('gantt')}
            onFocus={() => preloadView('gantt')}
            aria-current={activeView === 'gantt' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'gantt'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Harmonogram Gantta</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('calendar')}
            onMouseEnter={() => preloadView('calendar')}
            onFocus={() => preloadView('calendar')}
            aria-current={activeView === 'calendar' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'calendar'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Terminarz</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('tasks')}
            onMouseEnter={() => preloadView('tasks')}
            onFocus={() => preloadView('tasks')}
            aria-current={activeView === 'tasks' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'tasks'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Zadania</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('tree')}
            onMouseEnter={() => preloadView('tree')}
            onFocus={() => preloadView('tree')}
            aria-current={activeView === 'tree' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'tree'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Drzewo zadań</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('kanban')}
            onMouseEnter={() => preloadView('kanban')}
            onFocus={() => preloadView('kanban')}
            aria-current={activeView === 'kanban' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'kanban'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Tablica Kanban</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('projects')}
            onMouseEnter={() => preloadView('projects')}
            onFocus={() => preloadView('projects')}
            aria-current={activeView === 'projects' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'projects'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Projekty</span>
          </button>

          {canViewEconomy && (
            <button
              type="button"
              onClick={() => setActiveView('economy')}
              onMouseEnter={() => preloadView('economy')}
              onFocus={() => preloadView('economy')}
              aria-current={activeView === 'economy' ? 'page' : undefined}
              className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
                activeView === 'economy'
                  ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                  : 'hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Ekonomia</span>
            </button>
          )}

          {canViewTenders && (
            <button
              type="button"
              onClick={() => setActiveView('tenders')}
              onMouseEnter={() => preloadView('tenders')}
              onFocus={() => preloadView('tenders')}
              aria-current={activeView === 'tenders' ? 'page' : undefined}
              className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
                activeView === 'tenders'
                  ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                  : 'hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Gavel className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Przetargi</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveView('trash')}
            onMouseEnter={() => preloadView('trash')}
            onFocus={() => preloadView('trash')}
            aria-current={activeView === 'trash' ? 'page' : undefined}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap py-1 ${
              activeView === 'trash'
                ? 'text-sky-700 dark:text-sky-400 border-b-2 border-sky-700 dark:border-sky-400 font-bold'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Kosz</span>
          </button>
        </nav>

        {/* Zone 3: Primary Actions & User Auth */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Symbol archiwizacji: zielony gdy kopia na serwerze <= maxAgeHours, czerwony gdy brak lub przeterminowana */}
          {(() => {
            const maxAgeHours = serverBackupStatus?.maxAgeHours ?? 36;
            const isAdminStale = !isBackupActive && currentUser?.role === 'admin';
            const adminStaleLabel = isAdminStale
              ? serverBackupStatus?.lastBackup
                ? `Brak świeżej kopii zapasowej (ostatnia: ${serverBackupStatus.lastBackup.ageHours} h temu)`
                : 'Brak świeżej kopii zapasowej (ostatnia: brak)'
              : null;

            return (
              <button
                type="button"
                onClick={() => {
                  setSettingsTab('backup');
                  setIsSettingsModalOpen(true);
                }}
                aria-label={
                  isBackupActive
                    ? 'Status kopii zapasowej na serwerze: Aktywna'
                    : adminStaleLabel || `Uwaga: Brak aktualnej kopii zapasowej na serwerze poniżej ${maxAgeHours} godzin`
                }
                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap border ${
                  isBackupActive
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-400 dark:border-rose-800 hover:bg-rose-100 animate-pulse'
                }`}
                title={
                  isBackupActive
                    ? `Kopia zapasowa na serwerze: Aktywna (ostatnia: ${serverBackupStatus?.lastBackup ? `${serverBackupStatus.lastBackup.ageHours}h temu, ${serverBackupStatus.lastBackup.filename}` : `w ciągu ${maxAgeHours}h`})`
                    : serverBackupStatus?.lastBackup
                    ? `UWAGA! Ostatnia kopia na serwerze ma ${serverBackupStatus.lastBackup.ageHours}h (przekroczono limit ${maxAgeHours}h)! Kliknij, aby sprawdzić.`
                    : `UWAGA! Brak aktualnej kopii zapasowej na serwerze (w ciągu ostatnich ${maxAgeHours}h)! Kliknij, aby skonfigurować.`
                }
              >
                <Cloud className={`w-3.5 h-3.5 ${isBackupActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`} aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isBackupActive ? 'Kopia: Aktywna' : adminStaleLabel || 'Kopia: Brak (<36h)'}
                </span>
                <span className="sr-only sm:hidden">
                  {isBackupActive ? 'Kopia: Aktywna' : adminStaleLabel || 'Uwaga: Kopia brak lub przeterminowana'}
                </span>
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full ${
                    isBackupActive ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'
                  }`}
                />
              </button>
            );
          })()}

          {/* Przycisk bieżącej wersji: zielony gdy aktualna, czerwony gdy nowa wersja */}
          <button
            type="button"
            onClick={() => {
              setSettingsTab('update');
              setIsSettingsModalOpen(true);
            }}
            aria-label={
              hasUpdateAvailable
                ? `Wersja ${CURRENT_APP_VERSION}: Dostępna nowa aktualizacja`
                : `Wersja ${CURRENT_APP_VERSION}: System aktualny`
            }
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap border cursor-pointer ${
              hasUpdateAvailable
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-400 dark:border-rose-800 hover:bg-rose-100 animate-pulse'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
            }`}
            title={
              hasUpdateAvailable
                ? `Dostępna jest nowa wersja oprogramowania! Kliknij, aby sprawdzić i zaktualizować (Obecnie: ${CURRENT_APP_VERSION})`
                : `Wersja oprogramowania: ${CURRENT_APP_VERSION} (Wersja aktualna)`
            }
          >
            <GitBranch className={`w-3.5 h-3.5 ${hasUpdateAvailable ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`} aria-hidden="true" />
            <span className="font-mono">{CURRENT_APP_VERSION}</span>
            <span className="sr-only">
              {hasUpdateAvailable ? ' (Dostępna aktualizacja)' : ' (Aktualna wersja)'}
            </span>
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full ${
                hasUpdateAvailable ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'
              }`}
            />
          </button>

          {/* Menu Ustawień - Symbol Zębatki ⚙️ */}
          <button
            type="button"
            onClick={() => {
              setSettingsTab('theme');
              setIsSettingsModalOpen(true);
            }}
            onMouseEnter={() => {
              loadSettingsModal().catch(() => {});
            }}
            onFocus={() => {
              loadSettingsModal().catch(() => {});
            }}
            aria-label="Ustawienia systemu"
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold px-2.5 py-1.5 rounded transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-700"
            title="Ustawienia systemu: Motyw ciemny/jasny, Aktualizacje, Wdrożenie Docker, Użytkownicy i Kopie"
          >
            <SettingsIcon className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" aria-hidden="true" />
            <span className="hidden md:inline">Ustawienia</span>
          </button>

          {/* Quick Theme Switch (Sun / Moon) */}
          <button
            type="button"
            onClick={toggleThemeQuick}
            aria-label={
              themeMode === 'dark' || document.documentElement.classList.contains('dark')
                ? 'Przełącz na motyw jasny'
                : 'Przełącz na motyw ciemny'
            }
            className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Przełącz motyw (Jasny / Ciemny)"
          >
            {themeMode === 'dark' || document.documentElement.classList.contains('dark') ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
            )}
          </button>

          {/* User Switcher / Current User Badge (Wymaga logowania) */}
          <button
            type="button"
            onClick={() => setIsUserModalOpen(true)}
            onMouseEnter={() => {
              loadUserAuthModal().catch(() => {});
            }}
            onFocus={() => {
              loadUserAuthModal().catch(() => {});
            }}
            aria-label={`Konto użytkownika: ${currentUser?.name || 'Zaloguj się'}, kliknij aby otworzyć panel konta`}
            className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-md transition-colors text-left"
            title="Kliknij, aby przełączyć użytkownika (wymaga hasła) lub wylogować"
          >
            <div className="w-6 h-6 rounded-full bg-slate-900 dark:bg-sky-700 text-white font-bold text-[11px] flex items-center justify-center shrink-0" aria-hidden="true">
              {currentUser?.initials || '??'}
            </div>
            <div className="hidden xl:flex flex-col">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                {currentUser?.name || 'Zaloguj się'}
              </span>
              <span className="text-[10px] text-slate-600 dark:text-slate-400 uppercase font-medium">
                {currentUser?.role || 'Brak sesji'}
              </span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-600 dark:text-slate-400" aria-hidden="true" />
          </button>

          {/* Pending Users Notification Badge for Administrator */}
          {pendingUsersCount > 0 && currentUser?.role === 'admin' && (
            <button
              type="button"
              onClick={() => {
                setSettingsTab('users');
                setIsSettingsModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 animate-pulse"
              title="Nowi użytkownicy oczekują na zatwierdzenie przez Administratora"
            >
              <UserCheck className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <span>Oczekujące ({pendingUsersCount})</span>
            </button>
          )}

          {/* Low Server Disk Warning Badge for Administrator */}
          {currentUser?.role === 'admin' &&
            (systemDiskStatus?.level === 'warn' || systemDiskStatus?.level === 'critical') && (
              <button
                type="button"
                onClick={() => {
                  setSettingsTab('access');
                  setIsSettingsModalOpen(true);
                }}
                aria-label="Mało miejsca na dysku serwera"
                title={`Mało miejsca na dysku serwera (wolne ${systemDiskStatus.freePercent}%). Kliknij, aby sprawdzić szczegóły.`}
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap border bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-400 dark:border-rose-800 hover:bg-rose-100 animate-pulse"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                <span>Mało miejsca na dysku serwera</span>
              </button>
            )}

          {/* Dedykowany Przycisk Wylogowania - powrót do ekranu logowania */}
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Wyloguj się z systemu"
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded transition-all whitespace-nowrap bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/40 cursor-pointer shadow-2xs"
            title="Wyloguj się z systemu i przejdź do ekranu logowania"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Wyloguj</span>
          </button>
        </div>
      </header>

      {/* 2. SUB-HEADER WORKSPACE TOOLBAR */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors">
        {/* Left: Project selector & Duration in days */}
        <div className="flex items-center gap-3">
          <label htmlFor="workspace-project-select" className="font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider text-[11px]">Projekt:</label>
          <select
            id="workspace-project-select"
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value ? e.target.value : null)}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500 transition-colors"
          >
            <option value="">Wszystkie projekty ({projectsWithProgress.length})</option>
            {projectsWithProgress.map((p) => {
              const comp = p.companyId ? companies.find((c) => c.id === p.companyId) : undefined;
              return (
                <option key={p.id} value={p.id}>
                  [{p.key}]{comp ? ` (${comp.letter})` : ''} {getProjectDisplayName(p)}
                </option>
              );
            })}
          </select>

          {activeProject && (
            <div className="hidden md:flex items-center gap-2 text-slate-600 dark:text-slate-400">
              {(() => {
                const activeComp = activeProject.companyId
                  ? companies.find((c) => c.id === activeProject.companyId)
                  : undefined;
                return activeComp ? (
                  <span
                    title={activeComp.name}
                    className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                  >
                    {activeComp.letter}
                  </span>
                ) : null;
              })()}
              <span aria-hidden="true">·</span>
              <span>Czas trwania: <strong className="text-slate-800 dark:text-slate-200 font-mono">{activeProject.durationDays || 30} dni</strong></span>
              <span aria-hidden="true">·</span>
              <span>Termin: <strong className="text-slate-700 dark:text-slate-300 font-mono">{activeProject.dueDate}</strong></span>
              <span aria-hidden="true">·</span>
              <span>Postęp: <strong className="text-slate-700 dark:text-slate-300 font-mono">{activeProject.progress}%</strong></span>
            </div>
          )}
        </div>

        {/* Right: Interactive Quick stats & New Task */}
        <div className="flex items-center gap-2.5">
          {/* Clickable Blocked Tasks Badge */}
          {blockedTasksCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setTaskFilterModalType('blocked');
                setIsTaskFilterModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200 font-bold text-xs bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 transition-all cursor-pointer shadow-2xs hover:scale-102"
              title="Kliknij, aby wyświetlić listę zablokowanych zadań i przejść do konkretnego projektu"
            >
              <Lock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <span>{blockedTasksCount} zablokowanych</span>
            </button>
          )}

          {/* Clickable Critical Tasks Badge */}
          {criticalTasksCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setTaskFilterModalType('critical');
                setIsTaskFilterModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-rose-800 dark:text-rose-200 font-bold text-xs bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 transition-all cursor-pointer shadow-2xs hover:scale-102"
              title="Kliknij, aby wyświetlić listę krytycznych zadań i przejść do konkretnego projektu"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
              <span>{criticalTasksCount} krytycznych</span>
            </button>
          )}

          {/* Mobile view switch buttons */}
          <div role="group" aria-label="Widoki aplikacji" className="flex lg:hidden items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              aria-pressed={activeView === 'gantt'}
              onClick={() => setActiveView('gantt')}
              onMouseEnter={() => preloadView('gantt')}
              onFocus={() => preloadView('gantt')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'gantt' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Gantt
            </button>
            <button
              type="button"
              aria-pressed={activeView === 'calendar'}
              onClick={() => setActiveView('calendar')}
              onMouseEnter={() => preloadView('calendar')}
              onFocus={() => preloadView('calendar')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'calendar' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Terminarz
            </button>
            <button
              type="button"
              aria-pressed={activeView === 'tasks'}
              onClick={() => setActiveView('tasks')}
              onMouseEnter={() => preloadView('tasks')}
              onFocus={() => preloadView('tasks')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'tasks' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Zadania
            </button>
            <button
              type="button"
              aria-pressed={activeView === 'tree'}
              onClick={() => setActiveView('tree')}
              onMouseEnter={() => preloadView('tree')}
              onFocus={() => preloadView('tree')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'tree' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Drzewo
            </button>
            <button
              type="button"
              aria-pressed={activeView === 'kanban'}
              onClick={() => setActiveView('kanban')}
              onMouseEnter={() => preloadView('kanban')}
              onFocus={() => preloadView('kanban')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Kanban
            </button>
            {canViewEconomy && (
              <button
                type="button"
                aria-pressed={activeView === 'economy'}
                onClick={() => setActiveView('economy')}
                onMouseEnter={() => preloadView('economy')}
                onFocus={() => preloadView('economy')}
                className={`px-2 py-1 text-[11px] font-medium rounded ${
                  activeView === 'economy' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Ekonomia
              </button>
            )}
            {canViewTenders && (
              <button
                type="button"
                aria-pressed={activeView === 'tenders'}
                onClick={() => setActiveView('tenders')}
                onMouseEnter={() => preloadView('tenders')}
                onFocus={() => preloadView('tenders')}
                className={`px-2 py-1 text-[11px] font-medium rounded ${
                  activeView === 'tenders' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Przetargi
              </button>
            )}
            <button
              type="button"
              aria-pressed={activeView === 'trash'}
              onClick={() => setActiveView('trash')}
              onMouseEnter={() => preloadView('trash')}
              onFocus={() => preloadView('trash')}
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'trash' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Kosz
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleOpenNewTask()}
            onMouseEnter={() => {
              loadTaskModal().catch(() => {});
            }}
            onFocus={() => {
              loadTaskModal().catch(() => {});
            }}
            className="flex items-center gap-1 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE VIEWPORT (ciemny motyw obejmuje cały obszar roboczy) */}
      <main id="main-content" tabIndex={-1} className="flex-1 py-3 px-2 sm:px-3 lg:px-4 w-full max-w-none bg-slate-50/50 dark:bg-slate-950 transition-colors focus:outline-none">
        {currentUser?.role === 'admin' && smtpConfigured === false && !isSmtpBannerDismissed && (
          <div
            role="region"
            aria-label="Podpowiedź konfiguracji poczty SMTP"
            className="mb-3 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span>
                Poczta nie jest skonfigurowana. Przypomnienia i odzyskiwanie hasła nie działają. Skonfiguruj ją w Ustawienia &gt; Poczta (SMTP).
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSettingsTab('smtp');
                  setIsSettingsModalOpen(true);
                }}
                className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-semibold transition-colors"
              >
                Skonfiguruj pocztę SMTP
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                    localStorage.setItem('zp_smtp_banner_dismissed_until', String(Date.now() + sevenDaysMs));
                  } catch {}
                  setIsSmtpBannerDismissed(true);
                }}
                aria-label="Zamknij podpowiedź o konfiguracji poczty na 7 dni"
                className="p-1 rounded text-amber-800 dark:text-amber-200 hover:bg-amber-200/60 dark:hover:bg-amber-900/60 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        <Suspense fallback={<ViewLoadingFallback />}>
          {activeView === 'gantt' && (
            <GanttChart
              tasks={sortedTasks}
              projects={projectsWithProgress}
              companies={companies}
              users={users}
              selectedProjectId={selectedProjectId}
              onSelectTask={handleSelectTask}
              onOpenNewTask={() => handleOpenNewTask()}
            />
          )}

          {activeView === 'calendar' && (
            <CalendarView
              tasks={sortedTasks}
              projects={projectsWithProgress}
              companies={companies}
              users={users}
              selectedProjectId={selectedProjectId}
              onSelectTask={handleSelectTask}
              onOpenNewTaskWithDate={(dateStr) => handleOpenNewTask(dateStr)}
            />
          )}

          {activeView === 'tasks' && (
            <TaskListView
              tasks={sortedTasks}
              projects={projectsWithProgress}
              companies={companies}
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
              projects={projectsWithProgress}
              companies={companies}
              users={users}
              currentUser={currentUser}
              selectedProjectId={selectedProjectId}
              onSelectProject={(projId) => setSelectedProjectId(projId)}
              onSelectTask={handleSelectTask}
              onAddTask={(projId, parentTaskId) => handleOpenNewTask(undefined, parentTaskId, projId)}
              onUpdateTaskStatus={handleUpdateStatus}
              onReparentTask={handleReparentTask}
            />
          )}

          {activeView === 'kanban' && (
            <KanbanView
              tasks={sortedTasks}
              projects={projectsWithProgress}
              companies={companies}
              users={users}
              selectedProjectId={selectedProjectId}
              onSelectTask={handleSelectTask}
              onOpenNewTask={() => handleOpenNewTask()}
              onUpdateStatus={handleUpdateStatus}
            />
          )}

          {activeView === 'projects' && (
            <ProjectsOverview
              projects={projectsWithProgress}
              companies={companies}
              projectNumbering={projectNumbering}
              tasks={sortedTasks}
              users={users}
              currentUser={currentUser}
              onSelectProject={(projId) => {
                setSelectedProjectId(projId);
                setActiveView('gantt');
              }}
              onAddProject={handleAddProject}
              onUpdateProject={handleUpdateProject}
              onUpdateProjectDeliverables={handleUpdateProjectDeliverables}
              onUpdateProjectFinance={handleUpdateProjectFinance}
              onApplyFreshProject={handleApplyFreshProject}
              onDeleteProject={handleDeleteProject}
              onDeleteAllDemoData={handleDeleteAllDemoData}
              trashRetentionDays={trashRetentionDays}
              pendingDetailProjectId={pendingDetailProjectId}
              onConsumePendingDetailProject={() => setPendingDetailProjectId(null)}
            />
          )}

          {activeView === 'economy' && canViewEconomy && (
            <EconomyView
              projects={projectsWithProgress}
              companies={companies}
              tasks={sortedTasks}
              users={users}
              currentUser={currentUser}
              onUpdateProjectFinance={handleUpdateProjectFinance}
              onApplyFreshProject={handleApplyFreshProject}
              onUpdateProject={handleUpdateProject}
              onTaskCreatedFromEconomy={handleTaskCreatedFromEconomy}
              onUpdateTaskStatus={(taskId, newStatus) =>
                handleUpdateStatus(taskId, newStatus, true)
              }
              onOpenTask={handleSelectTask}
              onNotify={(msg, type = 'info') =>
                setNotificationToast({ message: msg, type })
              }
            />
          )}

          {activeView === 'tenders' && canViewTenders && (
            <TendersView
              companies={companies}
              projects={projectsWithProgress}
              currentUser={currentUser}
              onProjectCreated={handleProjectCreatedFromTender}
              onOpenProject={(projectId) => {
                setSelectedProjectId(projectId);
                setActiveView('projects');
                setPendingDetailProjectId(projectId);
              }}
              onNotify={(msg, type = 'info', action) =>
                setNotificationToast({
                  message: msg,
                  type,
                  ...(action ? { action } : {}),
                })
              }
            />
          )}

          {activeView === 'trash' && (
            <TrashView
              currentUser={currentUser}
              onRestored={() => fetchFreshState(false)}
              onRetentionDaysLoaded={(days) => setTrashRetentionDays(days)}
              onNotify={(msg, type = 'info') =>
                setNotificationToast({ message: msg, type })
              }
            />
          )}
        </Suspense>
      </main>

      {/* 4. MODALS & DRAWERS */}
      {isTaskModalOpen && (
        <Suspense fallback={null}>
          <TaskModal
            isOpen={isTaskModalOpen}
            onClose={() => {
              setIsTaskModalOpen(false);
              setEditingTask(null);
            }}
            onSave={handleSaveTask}
            projects={projectsWithProgress}
            users={users}
            allTasks={sortedTasks}
            defaultProjectId={selectedProjectId}
            defaultDate={defaultTaskDate}
            defaultParentId={defaultParentId}
            initialTask={editingTask}
          />
        </Suspense>
      )}

      {activeTaskDetail && (
        <Suspense fallback={null}>
          <TaskDetailDrawer
            task={activeTaskDetail}
            projects={projectsWithProgress}
            users={users}
            allTasks={sortedTasks}
            currentUser={currentUser}
            progressWeighting={progressWeighting}
            onClose={() => setSelectedTaskDetail(null)}
            onEdit={(task) => {
              setSelectedTaskDetail(null);
              handleOpenEditTask(task);
            }}
            onUpdateStatus={handleUpdateStatus}
            onUpdateProgress={handleUpdateProgress}
            onUpdateTaskFields={handleUpdateTaskFields}
            onAddComment={handleAddComment}
            comments={comments}
            onNavigateToTask={handleSelectTask}
          />
        </Suspense>
      )}

      {isCalendarSyncModalOpen && (
        <Suspense fallback={null}>
          <GoogleCalendarSyncModal
            isOpen={isCalendarSyncModalOpen}
            onClose={() => setIsCalendarSyncModalOpen(false)}
            currentUser={currentUser}
            users={users}
            tasks={sortedTasks}
            projects={projectsWithProgress}
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

      {isUserModalOpen && (
        <Suspense fallback={null}>
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
              setIsUserModalOpen(false);
              if (currentUser?.role === 'admin') {
                setSettingsTab('templates');
                setIsSettingsModalOpen(true);
              } else {
                setNotificationToast({
                  message: 'Zarządzanie szablonami projektów jest dostępne wyłącznie dla Administratora w Ustawieniach.',
                  type: 'info',
                });
              }
            }}
          />
        </Suspense>
      )}

      {/* Settings Modal (Symbol zębatki ⚙️: Motyw, Zmienne VAT & Inwestorzy, Aktualizacje, Docker, Użytkownicy, Archiwizacja) */}
      {isSettingsModalOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            users={users}
            projects={projectsWithProgress}
            tasks={sortedTasks}
            companies={companies}
            projectNumbering={projectNumbering}
            onRefreshState={() => fetchFreshState(false)}
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
            onOpenCalendarSyncModal={() => setIsCalendarSyncModalOpen(true)}
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
            onUpdateUserPassword={handleUpdateUserPassword}
            initialTab={settingsTab}
          />
        </Suspense>
      )}

      {/* Task Filter Modal for Clickable Blocked & Critical Badges */}
      {isTaskFilterModalOpen && (
        <Suspense fallback={null}>
          <TaskFilterModal
            isOpen={isTaskFilterModalOpen}
            onClose={() => setIsTaskFilterModalOpen(false)}
            activeFilter={taskFilterModalType}
            onChangeFilter={(f) => setTaskFilterModalType(f)}
            tasks={sortedTasks}
            projects={projectsWithProgress}
            users={users}
            onNavigateToTaskAndProject={handleNavigateToTaskAndProject}
          />
        </Suspense>
      )}

      {/* Archiving & Backup Modal (Google Drive, FTP/SFTP, Zrzuty SQL) */}
      {isArchiveModalOpen && (
        <Suspense fallback={null}>
          <ArchiveBackupModal
            isOpen={isArchiveModalOpen}
            onClose={() => setIsArchiveModalOpen(false)}
            projects={projectsWithProgress}
            tasks={tasksWithProgress}
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
                message: `Aplikacja zaktualizowana do wersji ${CURRENT_APP_VERSION} (GitHub). Wszystkie dane w pliku bazy app_state.json zostały zachowane!`,
                type: 'success',
              });
              setHasDismissedUpdateBanner(true);
            }}
          />
        </Suspense>
      )}

      {/* Accessible Task Delete Confirmation Modal */}
      {taskToDelete && (
        <div
          className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-task-modal-title"
          {...deleteTaskBackdropProps}
        >
          <div
            ref={taskDeleteModalRef}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-3"
          >
            <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3 id="delete-task-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Usuń zadanie
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Czy na pewno chcesz usunąć zadanie <strong>[{taskToDelete.code}] {taskToDelete.title}</strong>? Element trafi do kosza i będzie można go przywrócić przez {trashRetentionDays} dni.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTaskToDelete(null)}
                className="px-3 py-1.5 rounded text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={confirmDeleteTask}
                className="px-3.5 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold shadow-xs"
              >
                Tak, przenieś do kosza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
