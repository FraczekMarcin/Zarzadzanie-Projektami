import type { Company, Priority, Project, Task, User } from '../../types';
import { canViewFinance } from '../../utils/access';

export const PROJECTS_VIEW_PREF_KEY = 'oph_pref_projects_view';

export type ProjectsViewMode = 'tiles' | 'list';

export type ProjectListSortKey =
  | 'key'
  | 'name'
  | 'company'
  | 'clientName'
  | 'status'
  | 'priority'
  | 'dueDate'
  | 'progress'
  | 'tasks'
  | 'owner';

export type ProjectListSortDirection = 'asc' | 'desc';

export function loadProjectsViewPref(): ProjectsViewMode {
  if (typeof window === 'undefined') return 'tiles';
  try {
    const raw = window.localStorage.getItem(PROJECTS_VIEW_PREF_KEY);
    return raw === 'list' ? 'list' : 'tiles';
  } catch {
    return 'tiles';
  }
}

export function saveProjectsViewPref(mode: ProjectsViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROJECTS_VIEW_PREF_KEY, mode);
  } catch {
    // Ignoruj błędy dostępu do localStorage
  }
}

export function getProjectStatusMeta(status: Project['status']): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'active':
      return {
        label: 'Aktywny',
        badgeClass:
          'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    case 'planning':
      return {
        label: 'Planowanie',
        badgeClass:
          'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
      };
    case 'on_hold':
      return {
        label: 'Wstrzymany',
        badgeClass:
          'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      };
    case 'completed':
      return {
        label: 'Ukończony',
        badgeClass:
          'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      };
    default:
      return {
        label: status,
        badgeClass:
          'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      };
  }
}

export function getProjectPriorityMeta(priority: Priority): {
  label: string;
  weight: number;
  className: string;
} {
  switch (priority) {
    case 'critical':
      return {
        label: 'Krytyczny',
        weight: 4,
        className: 'text-rose-700 dark:text-rose-400 font-bold',
      };
    case 'high':
      return {
        label: 'Wysoki',
        weight: 3,
        className: 'text-amber-700 dark:text-amber-400 font-semibold',
      };
    case 'normal':
      return {
        label: 'Normalny',
        weight: 2,
        className: 'text-sky-700 dark:text-sky-400 font-medium',
      };
    case 'low':
    default:
      return {
        label: 'Niski',
        weight: 1,
        className: 'text-slate-600 dark:text-slate-400 font-normal',
      };
  }
}

export interface ProjectTaskMetrics {
  projectTasks: Task[];
  totalCount: number;
  completedCount: number;
  openCount: number;
  overdueCount: number;
  criticalOpenCount: number;
}

export function getProjectTaskMetrics(
  tasks: Task[],
  projectId: string,
  todayIso: string
): ProjectTaskMetrics {
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  let completedCount = 0;
  let openCount = 0;
  let overdueCount = 0;
  let criticalOpenCount = 0;

  for (const t of projectTasks) {
    if (t.status === 'done') {
      completedCount += 1;
    } else {
      openCount += 1;
      if (t.dueDate && t.dueDate < todayIso) {
        overdueCount += 1;
      }
      if (t.priority === 'critical') {
        criticalOpenCount += 1;
      }
    }
  }

  return {
    projectTasks,
    totalCount: projectTasks.length,
    completedCount,
    openCount,
    overdueCount,
    criticalOpenCount,
  };
}

export interface SortProjectsListOptions {
  sortKey: ProjectListSortKey | null;
  sortDir: ProjectListSortDirection;
  companies: Company[];
  users: User[];
  tasks: Task[];
  currentUser: Pick<User, 'id' | 'role'> | null | undefined;
  todayIso: string;
}

export function sortProjectsList(
  projects: Project[],
  options: SortProjectsListOptions
): Project[] {
  const { sortKey, sortDir, companies, users, tasks, currentUser, todayIso } = options;
  if (!sortKey) return [...projects];

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const metricsByProjectId = new Map<string, ProjectTaskMetrics>();

  const getMetrics = (projectId: string): ProjectTaskMetrics => {
    let cached = metricsByProjectId.get(projectId);
    if (!cached) {
      cached = getProjectTaskMetrics(tasks, projectId, todayIso);
      metricsByProjectId.set(projectId, cached);
    }
    return cached;
  };

  const dir = sortDir === 'asc' ? 1 : -1;

  return [...projects].sort((a, b) => {
    let cmp = 0;

    switch (sortKey) {
      case 'key':
        cmp = (a.key || '').localeCompare(b.key || '', 'pl', {
          numeric: true,
          sensitivity: 'base',
        });
        break;
      case 'name':
        cmp = (a.name || '').localeCompare(b.name || '', 'pl', { sensitivity: 'base' });
        break;
      case 'company': {
        const compA = a.companyId ? companyById.get(a.companyId)?.letter || '' : '';
        const compB = b.companyId ? companyById.get(b.companyId)?.letter || '' : '';
        cmp = compA.localeCompare(compB, 'pl', { sensitivity: 'base' });
        break;
      }
      case 'clientName': {
        const clientA = canViewFinance(currentUser, a) ? a.clientName?.trim() || '' : '';
        const clientB = canViewFinance(currentUser, b) ? b.clientName?.trim() || '' : '';
        cmp = clientA.localeCompare(clientB, 'pl', { sensitivity: 'base' });
        break;
      }
      case 'status': {
        const labelA = getProjectStatusMeta(a.status).label;
        const labelB = getProjectStatusMeta(b.status).label;
        cmp = labelA.localeCompare(labelB, 'pl', { sensitivity: 'base' });
        break;
      }
      case 'priority': {
        const wA = getProjectPriorityMeta(a.priority).weight;
        const wB = getProjectPriorityMeta(b.priority).weight;
        cmp = wA - wB;
        break;
      }
      case 'dueDate':
        cmp = (a.dueDate || '').localeCompare(b.dueDate || '');
        break;
      case 'progress':
        cmp = (a.progress || 0) - (b.progress || 0);
        break;
      case 'tasks': {
        const mA = getMetrics(a.id);
        const mB = getMetrics(b.id);
        cmp = mA.openCount - mB.openCount || mA.overdueCount - mB.overdueCount;
        break;
      }
      case 'owner': {
        const ownerA = a.ownerId ? userById.get(a.ownerId)?.name || '' : '';
        const ownerB = b.ownerId ? userById.get(b.ownerId)?.name || '' : '';
        cmp = ownerA.localeCompare(ownerB, 'pl', { sensitivity: 'base' });
        break;
      }
    }

    if (cmp !== 0) {
      return cmp * dir;
    }

    return (a.key || '').localeCompare(b.key || '', 'pl', {
      numeric: true,
      sensitivity: 'base',
    });
  });
}
