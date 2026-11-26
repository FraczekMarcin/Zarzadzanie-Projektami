import type {
  Company,
  Priority,
  Project,
  ProjectPriorityOption,
  ProjectStatusOption,
  ProjectTypeOption,
  Task,
  User,
} from '../../types';
import { canViewFinance } from '../../utils/access';
import {
  compareProjectDisplayNames,
  resolveProjectPriority,
  resolveProjectStatus,
  resolveProjectSubtype,
  resolveProjectType,
} from '../../utils/projectMeta';

export const PROJECTS_VIEW_PREF_KEY = 'oph_pref_projects_view';

export type ProjectsViewMode = 'tiles' | 'list';

export type ProjectListSortKey =
  | 'key'
  | 'name'
  | 'type'
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

export function getProjectStatusMeta(
  status: Project['status'],
  projectStatuses?: ProjectStatusOption[] | null
): {
  label: string;
  badgeClass: string;
  isClosed: boolean;
} {
  const resolved = resolveProjectStatus(status, projectStatuses);
  return {
    label: resolved.label,
    badgeClass: resolved.badgeClass,
    isClosed: resolved.isClosed,
  };
}

export function getProjectPriorityMeta(
  priority: Project['priority'],
  projectPriorities?: ProjectPriorityOption[] | null
): {
  label: string;
  weight: number;
  className: string;
} {
  const resolved = resolveProjectPriority(priority, projectPriorities);
  return {
    label: resolved.label,
    weight: resolved.order,
    className: resolved.textClass,
  };
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
  projectStatuses?: ProjectStatusOption[] | null;
  projectPriorities?: ProjectPriorityOption[] | null;
  projectTypes?: ProjectTypeOption[] | null;
}

export function sortProjectsList(
  projects: Project[],
  options: SortProjectsListOptions
): Project[] {
  const {
    sortKey,
    sortDir,
    companies,
    users,
    tasks,
    currentUser,
    todayIso,
    projectStatuses,
    projectPriorities,
    projectTypes,
  } = options;
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
        cmp = compareProjectDisplayNames(a, b);
        break;
      case 'type': {
        const typeA = resolveProjectType(a.typeId, projectTypes);
        const subA = resolveProjectSubtype(a.typeId, a.subtypeId, projectTypes);
        const typeB = resolveProjectType(b.typeId, projectTypes);
        const subB = resolveProjectSubtype(b.typeId, b.subtypeId, projectTypes);
        const labelA = typeA.hasType ? (subA ? `${typeA.label} ${subA.label}` : typeA.label) : '';
        const labelB = typeB.hasType ? (subB ? `${typeB.label} ${subB.label}` : typeB.label) : '';
        cmp = labelA.localeCompare(labelB, 'pl', { sensitivity: 'base' });
        break;
      }
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
        const labelA = getProjectStatusMeta(a.status, projectStatuses).label;
        const labelB = getProjectStatusMeta(b.status, projectStatuses).label;
        cmp = labelA.localeCompare(labelB, 'pl', { sensitivity: 'base' });
        break;
      }
      case 'priority': {
        const wA = getProjectPriorityMeta(a.priority, projectPriorities).weight;
        const wB = getProjectPriorityMeta(b.priority, projectPriorities).weight;
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
