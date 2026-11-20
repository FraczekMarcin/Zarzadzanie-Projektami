import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Company, Project, Task, User } from '../types';
import {
  PROJECTS_VIEW_PREF_KEY,
  getProjectTaskMetrics,
  loadProjectsViewPref,
  saveProjectsViewPref,
  sortProjectsList,
} from '../components/projects/projectsViewUtils';
import { clearOphStorageOnLogout } from '../utils/variableSettings';

const USERS: User[] = [
  {
    id: 'usr-admin',
    name: 'Anna Admin',
    email: 'admin@example.pl',
    role: 'admin',
    department: 'Zarząd',
    initials: 'AA',
  },
  {
    id: 'usr-pm',
    name: 'Marek Kierownik',
    email: 'pm@example.pl',
    role: 'project_manager',
    department: 'Architektura',
    initials: 'MK',
  },
  {
    id: 'usr-dev',
    name: 'Tomasz Projektant',
    email: 'dev@example.pl',
    role: 'developer',
    department: 'Konstrukcja',
    initials: 'TP',
  },
];

const COMPANIES: Company[] = [
  { id: 'c-a', name: 'Alfa Sp. z o.o.', letter: 'A', isActive: true },
  { id: 'c-b', name: 'Beta Studio', letter: 'B', isActive: true },
];

const PROJECTS: Project[] = [
  {
    id: 'p-1',
    key: '2026-10_B',
    companyId: 'c-b',
    name: 'Osiedle Zielone',
    description: 'Opis',
    priority: 'normal',
    status: 'active',
    startDate: '2026-01-10',
    dueDate: '2026-09-30',
    durationDays: 120,
    progress: 75,
    ownerId: 'usr-pm',
    clientName: 'Zielony Deweloper',
    memberIds: ['usr-pm', 'usr-dev'],
    color: '#0284c7',
  },
  {
    id: 'p-2',
    key: '2026-2_A',
    companyId: 'c-a',
    name: 'Biurowiec Alfa',
    description: 'Opis',
    priority: 'critical',
    status: 'planning',
    startDate: '2026-02-01',
    dueDate: '2026-06-15',
    durationDays: 90,
    progress: 20,
    ownerId: 'usr-admin',
    clientName: 'Alfa Inwestycje',
    memberIds: ['usr-admin', 'usr-dev'],
    color: '#0284c7',
  },
];

const TASKS: Task[] = [
  {
    id: 't-1',
    projectId: 'p-1',
    code: 'T1',
    title: 'Zaległe zadanie',
    description: '',
    type: 'rysunek',
    priority: 'high',
    status: 'in_progress',
    reporterId: 'usr-admin',
    startDate: '2026-01-10',
    dueDate: '2026-04-01',
    durationDays: 10,
    progress: 50,
    createdAt: '2026-01-10T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
  },
  {
    id: 't-2',
    projectId: 'p-1',
    code: 'T2',
    title: 'Otwarte przyszłe',
    description: '',
    type: 'rysunek',
    priority: 'normal',
    status: 'to_do',
    reporterId: 'usr-admin',
    startDate: '2026-05-01',
    dueDate: '2026-06-10',
    durationDays: 5,
    progress: 0,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 't-3',
    projectId: 'p-1',
    code: 'T3',
    title: 'Ukończone wcześniej',
    description: '',
    type: 'opis',
    priority: 'low',
    status: 'done',
    reporterId: 'usr-admin',
    startDate: '2026-01-10',
    dueDate: '2026-02-01',
    durationDays: 5,
    progress: 100,
    createdAt: '2026-01-10T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
];

describe('projectsViewUtils (widok kafelków i listy projektów)', () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    const store = new Map<string, string>();
    const fakeStorage = {
      get length() {
        return store.size;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      getItem(k: string) {
        return store.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        store.set(k, v);
      },
      removeItem(k: string) {
        store.delete(k);
      },
    };
    (globalThis as any).window = { localStorage: fakeStorage };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it('domyślnie zwraca tiles i zapisuje wybór w oph_pref_projects_view', () => {
    expect(loadProjectsViewPref()).toBe('tiles');
    saveProjectsViewPref('list');
    expect(window.localStorage.getItem(PROJECTS_VIEW_PREF_KEY)).toBe('list');
    expect(loadProjectsViewPref()).toBe('list');
  });

  it('zachowuje oph_pref_projects_view po wylogowaniu (clearOphStorageOnLogout)', () => {
    saveProjectsViewPref('list');
    window.localStorage.setItem('oph_temp_session_flag', '1');
    clearOphStorageOnLogout(window.localStorage);

    expect(window.localStorage.getItem('oph_temp_session_flag')).toBeNull();
    expect(window.localStorage.getItem(PROJECTS_VIEW_PREF_KEY)).toBe('list');
  });

  it('poprawnie liczy otwarte i zaległe zadania projektu', () => {
    const metrics = getProjectTaskMetrics(TASKS, 'p-1', '2026-05-15');
    expect(metrics.totalCount).toBe(3);
    expect(metrics.completedCount).toBe(1);
    expect(metrics.openCount).toBe(2);
    expect(metrics.overdueCount).toBe(1);
  });

  it('sortuje listę projektów numerycznie po numerze i po pozostałych kolumnach', () => {
    const byKeyAsc = sortProjectsList(PROJECTS, {
      sortKey: 'key',
      sortDir: 'asc',
      companies: COMPANIES,
      users: USERS,
      tasks: TASKS,
      currentUser: USERS[0],
      todayIso: '2026-05-15',
    });
    expect(byKeyAsc.map((p) => p.key)).toEqual(['2026-2_A', '2026-10_B']);

    const byPriorityDesc = sortProjectsList(PROJECTS, {
      sortKey: 'priority',
      sortDir: 'desc',
      companies: COMPANIES,
      users: USERS,
      tasks: TASKS,
      currentUser: USERS[0],
      todayIso: '2026-05-15',
    });
    expect(byPriorityDesc.map((p) => p.id)).toEqual(['p-2', 'p-1']);

    const byProgressAsc = sortProjectsList(PROJECTS, {
      sortKey: 'progress',
      sortDir: 'asc',
      companies: COMPANIES,
      users: USERS,
      tasks: TASKS,
      currentUser: USERS[0],
      todayIso: '2026-05-15',
    });
    expect(byProgressAsc.map((p) => p.id)).toEqual(['p-2', 'p-1']);
  });
});
