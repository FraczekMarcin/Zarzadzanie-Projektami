import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { Task, Project, ActivityLog, Comment, ProjectTemplate } from './types';
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
import { useAuthSession, NotificationToast } from './hooks/useAuthSession';
import { useServerSync } from './hooks/useServerSync';
import { useTaskActions } from './hooks/useTaskActions';

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
import { instantiateTasksFromTemplate } from './utils/projectTemplates';
import { getNextProjectCode } from './utils/projectCode';
import { downloadIcsFile } from './utils/calendar';
import { getAutoBackupConfig, createAutoBackupSnapshot } from './utils/autoBackup';
import { ThemeMode, getThemePreference, setThemePreference, initThemeListener } from './utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL } from './data/dockerConfig';
import { isDemoProject } from './utils/demoData';
import { sortTasksByPriorityAndDueDate } from './utils/taskSorting';
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
  RotateCcw,
  Info
} from 'lucide-react';

type ActiveView = 'gantt' | 'calendar' | 'tasks' | 'tree' | 'kanban' | 'projects';

export default function App() {
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);

  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);

  // Universal task sorting: Priority (critical -> high -> normal -> low), then due date
  const sortedTasks = useMemo(() => sortTasksByPriorityAndDueDate(tasks), [tasks]);

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(INITIAL_ACTIVITY);

  const [comments, setComments] = useState<Comment[]>([]);

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
  const [settingsTab, setSettingsTab] = useState<'theme' | 'update' | 'docker' | 'users' | 'backup' | 'variables'>('theme');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getThemePreference());
  const [serverBackupStatus, setServerBackupStatus] = useState<{
    active: boolean;
    lastBackup: { filename: string; timestamp: string; ageHours: number; size: number } | null;
    maxAgeHours: number;
    message?: string;
  } | null>(null);
  const [isBackupActive, setIsBackupActive] = useState<boolean>(false);

  const closeEventSourceRef = useRef<() => void>(() => {});
  const logActivityRef = useRef<(action: string, taskId?: string, details?: string) => void>(() => {});

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
    setTasks,
    setActivityLogs,
    setComments,
    setNotificationToast,
    setIsUserModalOpen,
    closeEventSourceRef,
    logActivityRef,
  });

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
    applyRevision,
    fetchFreshState,
    createProjectOnServer,
    patchProjectOnServer,
    deleteProjectOnServer,
    createActivityOnServer,
  } = useServerSync({
    isAuthenticated,
    setIsAuthenticated,
    editingTaskRef,
    closeEventSourceRef,
    setUsers,
    setProjects,
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

  // Toast auto-dismiss
  useEffect(() => {
    if (notificationToast) {
      const timer = setTimeout(() => setNotificationToast(null), 5000);
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
    processDependencyRules,
    handleSelectTask,
    handleSaveTask,
    handleDeleteTask,
    handleUpdateStatus,
    handleUpdateProgress,
    handleAddComment,
  } = useTaskActions({
    tasks,
    setTasks,
    projects,
    currentUser,
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
            <option value="">Wszystkie projekty ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.key}] {p.name}
              </option>
            ))}
          </select>

          {activeProject && (
            <div className="hidden md:flex items-center gap-2 text-slate-600 dark:text-slate-400">
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
              className={`px-2 py-1 text-[11px] font-medium rounded ${
                activeView === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-xs font-bold text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Kanban
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleOpenNewTask()}
            className="flex items-center gap-1 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE VIEWPORT (ciemny motyw obejmuje cały obszar roboczy) */}
      <main id="main-content" tabIndex={-1} className="flex-1 py-3 px-2 sm:px-3 lg:px-4 w-full max-w-none bg-slate-50/50 dark:bg-slate-950 transition-colors focus:outline-none">
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

      {/* Archiving & Backup Modal (Google Drive, FTP/SFTP, Zrzuty SQL) */}
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
                message: `Aplikacja zaktualizowana do wersji ${CURRENT_APP_VERSION} (GitHub). Wszystkie dane w pliku bazy app_state.json zostały zachowane!`,
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
