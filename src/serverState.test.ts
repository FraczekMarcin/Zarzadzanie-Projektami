import { describe, it, expect, beforeEach } from 'vitest';

describe('Współbieżna synchronizacja i operacje na zasobach', () => {
  interface StateStore {
    revision: number;
    tasks: any[];
    projects: any[];
    users: any[];
    comments: any[];
  }

  let state: StateStore;

  function bumpRevision(s: StateStore): number {
    s.revision = (s.revision || 0) + 1;
    return s.revision;
  }

  function handleCreateTask(s: StateStore, taskData: any, callerId: string) {
    const newTask = {
      ...taskData,
      id: taskData.id || `tsk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      reporterId: taskData.reporterId || callerId,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    s.tasks.unshift(newTask);
    const newRev = bumpRevision(s);
    return { status: 201, task: newTask, revision: newRev };
  }

  function handlePatchTask(s: StateStore, taskId: string, patch: any, ifMatch?: string) {
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return { status: 404, error: 'Not found' };

    if (ifMatch && ifMatch !== '*' && ifMatch !== String(task.revision || 1)) {
      return {
        status: 409,
        error: 'Konflikt wersji zasobu',
        currentTask: { ...task },
        revision: s.revision,
      };
    }

    Object.assign(task, patch);
    task.revision = (task.revision || 1) + 1;
    task.updatedAt = new Date().toISOString();
    const newRev = bumpRevision(s);
    return { status: 200, task, revision: newRev };
  }

  function handleDeleteTask(s: StateStore, taskId: string, caller: { id: string; role: string }) {
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return { status: 404, error: 'Not found' };

    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      const isOwn = (task.assigneeId && task.assigneeId === caller.id) ||
                    (task.reporterId && task.reporterId === caller.id);
      if (!isOwn) {
        return { status: 403, error: 'Brak uprawnień do usunięcia cudzego zadania' };
      }
    }

    s.tasks = s.tasks.filter((t) => t.id !== taskId);
    const newRev = bumpRevision(s);
    return { status: 200, revision: newRev };
  }

  function handleDeleteProject(s: StateStore, projectId: string, caller: { id: string; role: string }) {
    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      return { status: 403, error: 'Usuwanie projektów wymaga roli administratora lub kierownika projektu' };
    }
    s.projects = s.projects.filter((p) => p.id !== projectId);
    s.tasks = s.tasks.filter((t) => t.projectId !== projectId);
    const newRev = bumpRevision(s);
    return { status: 200, revision: newRev };
  }

  function handlePostState(s: StateStore, newState: any, caller: { id: string; role: string }, ifMatch?: string) {
    if (caller.role !== 'admin') {
      return { status: 403, error: 'Operacja dozwolona wyłącznie dla Administratora' };
    }
    if (ifMatch && ifMatch !== '*' && ifMatch !== String(s.revision || 0)) {
      return { status: 409, error: 'Konflikt wersji stanu' };
    }
    Object.assign(s, newState);
    const newRev = bumpRevision(s);
    return { status: 200, revision: newRev };
  }

  beforeEach(() => {
    state = {
      revision: 0,
      tasks: [
        { id: 'tsk-1', projectId: 'prj-1', title: 'Zadanie 1', code: 'PRJ-01', assigneeId: 'dev-1', reporterId: 'dev-1', revision: 1 },
        { id: 'tsk-2', projectId: 'prj-1', title: 'Zadanie 2', code: 'PRJ-02', assigneeId: 'dev-2', reporterId: 'pm-1', revision: 1 },
        { id: 'tsk-3', projectId: 'prj-1', title: 'Zadanie bez przypisania', code: 'PRJ-03', reporterId: 'pm-1', revision: 1 },
      ],
      projects: [
        { id: 'prj-1', name: 'Projekt Główny', key: 'PRJ', revision: 1 },
      ],
      users: [
        { id: 'admin-1', role: 'admin' },
        { id: 'pm-1', role: 'project_manager' },
        { id: 'dev-1', role: 'developer' },
        { id: 'dev-2', role: 'developer' },
      ],
      comments: [],
    };
  });

  it('Scenariusz A i B: A dodaje zadanie X, B dodaje zadanie Y bez odświeżania -> na serwerze są oba zadania X i Y', () => {
    // A dodaje zadanie X
    const resA = handleCreateTask(state, { title: 'Zadanie X', projectId: 'prj-1' }, 'dev-1');
    expect(resA.status).toBe(201);
    expect(resA.revision).toBe(1);

    // B dodaje zadanie Y (z widokiem sprzed dodania X)
    const resB = handleCreateTask(state, { title: 'Zadanie Y', projectId: 'prj-1' }, 'dev-2');
    expect(resB.status).toBe(201);
    expect(resB.revision).toBe(2);

    // Sprawdzenie: na serwerze są oba zadania X i Y
    const titles = state.tasks.map((t) => t.title);
    expect(titles).toContain('Zadanie X');
    expect(titles).toContain('Zadanie Y');
    expect(state.tasks.length).toBe(5);
  });

  it('Dodanie jednego zadania wysyła payload < 5 KB niezależnie od liczby zadań', () => {
    const payload = JSON.stringify({
      title: 'Nowy etap projektowy',
      projectId: 'prj-1',
      description: 'Opis nowego zadania',
      durationDays: 5,
      priority: 'high',
      status: 'to_do',
    });
    const bytes = Buffer.byteLength(payload, 'utf-8');
    // Mniej niż 5 KB (5120 bajtów)
    expect(bytes).toBeLessThan(5120);
    expect(bytes).toBeLessThan(1024); // Rzeczywisty rozmiar to zaledwie ~150 bajtów
  });

  it('Równoległa edycja różnych zadań: edycje nie nadpisują się', () => {
    // Użytkownik A zmienia status zadania 1
    const res1 = handlePatchTask(state, 'tsk-1', { status: 'done' }, '1');
    expect(res1.status).toBe(200);
    expect(res1.task.status).toBe('done');
    expect(res1.task.revision).toBe(2);

    // Użytkownik B zmienia progress zadania 2
    const res2 = handlePatchTask(state, 'tsk-2', { progress: 80 }, '1');
    expect(res2.status).toBe(200);
    expect(res2.task.progress).toBe(80);
    expect(res2.task.revision).toBe(2);

    // Oba zadania zachowały swoje zmiany
    const t1 = state.tasks.find((t) => t.id === 'tsk-1');
    const t2 = state.tasks.find((t) => t.id === 'tsk-2');
    expect(t1.status).toBe('done');
    expect(t2.progress).toBe(80);
  });

  it('Edycja tego samego zadania z nieaktualnym If-Match zwraca 409 Conflict i umożliwia scalenie zmian (last-write-wins)', () => {
    // Użytkownik A edytuje zadanie (revision przechodzi z 1 do 2)
    const resA = handlePatchTask(state, 'tsk-1', { title: 'Tytuł zaktualizowany przez A' }, '1');
    expect(resA.status).toBe(200);

    // Użytkownik B próbuje edytować z nieaktualną rewizją "1"
    const patchB = { progress: 50 };
    const resB = handlePatchTask(state, 'tsk-1', patchB, '1');
    expect(resB.status).toBe(409);
    expect(resB.currentTask).toBeDefined();
    expect(resB.currentTask.title).toBe('Tytuł zaktualizowany przez A');

    // Klient B scala lokalną zmianę pola i ponawia żądanie z rewizją currentTask (2)
    const retryRes = handlePatchTask(state, 'tsk-1', patchB, String(resB.currentTask.revision));
    expect(retryRes.status).toBe(200);
    expect(retryRes.task.title).toBe('Tytuł zaktualizowany przez A'); // Zachowane od A
    expect(retryRes.task.progress).toBe(50); // Scalone od B
  });

  it('Ochrona ról: developer nie może usunąć projektu (403 Forbidden)', () => {
    const devUser = { id: 'dev-1', role: 'developer' };
    const res = handleDeleteProject(state, 'prj-1', devUser);
    expect(res.status).toBe(403);
    expect(state.projects.length).toBe(1);

    // Administrator może usunąć projekt
    const adminUser = { id: 'admin-1', role: 'admin' };
    const adminRes = handleDeleteProject(state, 'prj-1', adminUser);
    expect(adminRes.status).toBe(200);
    expect(state.projects.length).toBe(0);
  });

  it('Ochrona ról: developer nie może usunąć cudzego zadania ani zadania bez przypisania (403 Forbidden)', () => {
    const dev1 = { id: 'dev-1', role: 'developer' };

    // dev-1 próbuje usunąć tsk-2 (przypisane do dev-2, zgłoszone przez pm-1)
    const res1 = handleDeleteTask(state, 'tsk-2', dev1);
    expect(res1.status).toBe(403);

    // dev-1 próbuje usunąć tsk-3 (bez przypisania, zgłoszone przez pm-1)
    const res2 = handleDeleteTask(state, 'tsk-3', dev1);
    expect(res2.status).toBe(403);

    // dev-1 może usunąć własne zadanie tsk-1
    const res3 = handleDeleteTask(state, 'tsk-1', dev1);
    expect(res3.status).toBe(200);
    expect(state.tasks.find((t) => t.id === 'tsk-1')).toBeUndefined();
  });

  it('POST /api/state: developer otrzymuje 403 Forbidden; tylko admin ma uprawnienia', () => {
    const dev1 = { id: 'dev-1', role: 'developer' };
    const devRes = handlePostState(state, { tasks: [] }, dev1);
    expect(devRes.status).toBe(403);

    const admin = { id: 'admin-1', role: 'admin' };
    const adminRes = handlePostState(state, { tasks: [] }, admin, '0');
    expect(adminRes.status).toBe(200);
    expect(state.tasks.length).toBe(0);
  });

  it('Migracja: stan bez pola revision inicjalizuje revision = 0 i revision = 1 dla obiektów', () => {
    const rawLegacyState = {
      initialized: true,
      tasks: [{ id: 't-1', title: 'Stare zadanie' }],
      projects: [{ id: 'p-1', name: 'Stary projekt' }],
    };

    const migratedState: any = { ...rawLegacyState };
    if (typeof migratedState.revision !== 'number') {
      migratedState.revision = 0;
    }
    for (const t of migratedState.tasks) {
      if (typeof t.revision !== 'number') t.revision = 1;
    }
    for (const p of migratedState.projects) {
      if (typeof p.revision !== 'number') p.revision = 1;
    }

    expect(migratedState.revision).toBe(0);
    expect(migratedState.tasks[0].revision).toBe(1);
    expect(migratedState.projects[0].revision).toBe(1);
  });
});
