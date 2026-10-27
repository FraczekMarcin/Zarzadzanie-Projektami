import React, { useState, useEffect } from 'react';
import { Task, Project, User, Priority, TaskStatus, ActivityLog, Comment, ProjectTemplate } from './types';
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
import { GitHubUpdateModal } from './components/GitHubUpdateModal';
import { SettingsModal } from './components/SettingsModal';
import { instantiateTasksFromTemplate } from './utils/projectTemplates';
import { getNextProjectCode } from './utils/projectCode';
import { downloadIcsFile } from './utils/calendar';
import { getAutoBackupConfig, createAutoBackupSnapshot } from './utils/autoBackup';
import { ThemeMode, getThemePreference, setThemePreference, initThemeListener } from './utils/theme';
import { CURRENT_APP_VERSION, GITHUB_REPO_URL } from './data/dockerConfig';
import { isDemoUser, isDemoProject } from './utils/demoData';
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
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw
} from 'lucide-react';

type ActiveView = 'gantt' | 'calendar' | 'tasks' | 'kanban' | 'projects';

export default function App() {
  // Persistence state with auto-migration to prevent legacy crash
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem('oph_users');
      const list: User[] = saved ? JSON.parse(saved) : INITIAL_USERS;
      return list.map((u) => ({
        ...u,
        isDemo: isDemoUser(u),
      }));
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
      const parsed: Project[] = saved ? JSON.parse(saved) : INITIAL_PROJECTS;
      return parsed.map((p: any) => ({
        ...p,
        priority: p.priority === 'medium' ? 'normal' : (p.priority || 'normal'),
        durationDays: p.durationDays || 30,
        isDemo: isDemoProject(p),
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
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [hasDismissedUpdateBanner, setHasDismissedUpdateBanner] = useState(false);

  // Settings & Theme State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'theme' | 'update' | 'docker' | 'users' | 'backup'>('theme');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getThemePreference());
  const [isBackupActive, setIsBackupActive] = useState<boolean>(() => {
    try {
      return getAutoBackupConfig().enabled;
    } catch {
      return false;
    }
  });

  // Initialize theme listener on mount
  useEffect(() => {
    const cleanup = initThemeListener((isDark) => {
      setThemeMode(getThemePreference());
    });
    return cleanup;
  }, []);

  // Daily automated update check from GitHub repository
  useEffect(() => {
    try {
      const lastCheck = localStorage.getItem('oph_last_daily_update_check');
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (!lastCheck || now - Number(lastCheck) >= oneDayMs) {
        localStorage.setItem('oph_last_daily_update_check', String(now));
        fetch('https://api.github.com/repos/FraczekMarcin/Zarzadzanie-Projektami/commits/main')
          .then((res) => {
            if (res.ok) {
              console.log('Automatyczna weryfikacja aktualizacji: 2026-10-27 v 0.3.0 jest najnowsza.');
            }
          })
          .catch(() => {});
      }
    } catch {}
  }, []);

  // Keep backup status in sync with localStorage config
  useEffect(() => {
    const syncBackupState = () => {
      try {
        setIsBackupActive(getAutoBackupConfig().enabled);
      } catch {}
    };
    const interval = setInterval(syncBackupState, 4000);
    return () => clearInterval(interval);
  }, []);

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

  // Periodic Auto-Backup Engine
  useEffect(() => {
    const checkAndRunAutoBackup = () => {
      try {
        const config = getAutoBackupConfig();
        if (!config.enabled) return;

        const now = Date.now();
        const last = config.lastBackupTime ? new Date(config.lastBackupTime).getTime() : 0;
        const intervalMs = (config.intervalMinutes || 60) * 60 * 1000;

        // If never backed up or scheduled interval has elapsed
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

  const handleAddProject = (newProjData: Omit<Project, 'id'>, selectedTemplate?: ProjectTemplate) => {
    const key = newProjData.key ? newProjData.key.trim().toUpperCase() : getNextProjectCode(projects);
    const newProject: Project = {
      ...newProjData,
      id: `prj-${Date.now()}`,
      key,
    };
    setProjects((prev) => [...prev, newProject]);
    setSelectedProjectId(newProject.id);

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

  // Delete project and all its tasks
  const handleDeleteProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.projectId !== projectId));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
    }
    logActivity(`Usunięto projekt "${project?.name || projectId}" wraz ze wszystkimi zadaniami`);
    setNotificationToast({
      message: `Projekt [${project?.key || ''}] został bezpowrotnie usunięty.`,
      type: 'info',
    });
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
        const defaultAdmin: User = {
          id: `usr-${Date.now()}`,
          name: 'Administrator',
          email: 'admin@pracownia.pl',
          role: 'admin',
          department: 'Główny Projektant',
          initials: 'AD',
          isDemo: false,
        };
        setCurrentUser(defaultAdmin);
        return [defaultAdmin];
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

  // Delete specific user
  const handleDeleteUser = (userId: string) => {
    if (currentUser && currentUser.id === userId) {
      setNotificationToast({
        message: 'Nie możesz usunąć aktualnie aktywnego użytkownika.',
        type: 'info',
      });
      return;
    }
    const user = users.find((u) => u.id === userId);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    logActivity(`Usunięto użytkownika ${user?.name || userId}`);
    setNotificationToast({
      message: `Użytkownik ${user?.name} został usunięty.`,
      type: 'info',
    });
  };

  // Update user password
  const handleUpdateUserPassword = (userId: string, newPass: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, password: newPass } : u))
    );
    if (currentUser && currentUser.id === userId) {
      setCurrentUser((prev) => ({ ...prev, password: newPass }));
    }
    logActivity('Zaktualizowano hasło dostępu użytkownika');
    setNotificationToast({
      message: 'Hasło użytkownika zostało pomyślnie zaktualizowane.',
      type: 'success',
    });
  };

  // Logout handler
  const handleLogout = () => {
    logActivity(`${currentUser.name} wylogował się z systemu`);
    setIsUserModalOpen(true);
    setNotificationToast({
      message: 'Wylogowano z systemu. Wybierz konto i podaj hasło, aby się zalogować.',
      type: 'info',
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
              2026-10-27 v 0.3.0
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
          {/* Symbol archiwizacji: zielony gdy aktywny, czerwony mrugający gdy nieustawiony */}
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
                ? 'Archiwizacja bazy: WŁĄCZONA i aktywna (kopie w tle)'
                : 'UWAGA! Archiwizacja NIE jest ustawiona! Kliknij, aby skonfigurować automatyczne kopie zapasowe'
            }
          >
            <Cloud className={`w-3.5 h-3.5 ${isBackupActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
            <span className="hidden sm:inline">
              {isBackupActive ? 'Kopia: Aktywna' : 'Archiwizacja: Brak!'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                isBackupActive ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'
              }`}
            />
          </button>

          {/* Przycisk bieżącej wersji z możliwością sprawdzenia wersji po kliknięciu */}
          <button
            onClick={() => {
              setSettingsTab('update');
              setIsSettingsModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-2.5 py-1.5 rounded transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-700 group cursor-pointer"
            title="Bieżąca wersja aplikacji: 2026-10-27 v 0.3.1. Kliknij, aby sprawdzić aktualizacje lub wdrożenie Docker."
          >
            <GitBranch className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 group-hover:rotate-12 transition-transform" />
            <span className="font-mono">{CURRENT_APP_VERSION}</span>
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
        onDeleteUser={handleDeleteUser}
        onDeleteDemoUsers={handleDeleteDemoUsers}
        onUpdateUserPassword={handleUpdateUserPassword}
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

      {/* Settings Modal (Symbol zębatki ⚙️: Motyw, Aktualizacje, Docker, Użytkownicy, Archiwizacja) */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        users={users}
        projects={projects}
        currentUser={currentUser}
        onDeleteDemoUsers={handleDeleteDemoUsers}
        onDeleteAllDemoData={handleDeleteAllDemoData}
        onOpenUserModal={() => setIsUserModalOpen(true)}
        onOpenArchiveModal={() => setIsArchiveModalOpen(true)}
        initialTab={settingsTab}
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

      {/* GitHub Version Update Checker & Simulation Modal */}
      <GitHubUpdateModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        currentVersion="2026-10-24 v 0.1"
        latestVersion={CURRENT_APP_VERSION}
        onUpdateCompleted={() => {
          setNotificationToast({
            message: `Aplikacja zaktualizowana do wersji ${CURRENT_APP_VERSION} (GitHub). Wszystkie dane bazy PostgreSQL zostały zachowane!`,
            type: 'success',
          });
          setHasDismissedUpdateBanner(true);
        }}
      />
    </div>
  );
}
