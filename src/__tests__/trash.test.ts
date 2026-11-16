import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import ical from 'node-ical';
import { createApp, CreateAppOptions } from '../../server.js';
import {
  TRASH_MAX_ENTRIES,
  enforceTrashLimit,
  moveProjectToTrash,
  moveTaskToTrash,
  purgeExpiredTrash,
  restoreTrashEntry,
} from '../server/trash.js';
import type { TrashEntry } from '../types/index.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Katedra-Kamień-2026!';
const USER_PASS = 'Jesień-Ogród-2026!';

interface TestServerContext {
  baseUrl: string;
  dataDir: string;
  instance: Awaited<ReturnType<typeof createApp>>;
  close: () => Promise<void>;
}

function extractSessionCookie(res: Response): string {
  const anyHeaders = res.headers as any;
  const setCookies: string[] =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie') as string]
      : [];
  for (const raw of setCookies) {
    if (raw.includes('zp_session=')) {
      return raw.split(';')[0];
    }
  }
  return '';
}

async function startServer(overrides: Partial<CreateAppOptions> = {}): Promise<TestServerContext> {
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-trash-'));
  const shouldCleanupDir = !overrides.dataDir;
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    setupToken: '',
    googleSyncDisableTimers: true,
    backupWatchDisableTimers: true,
    trashCleanupDisableTimers: true,
    ...overrides,
  });

  const httpServer = http.createServer(instance.app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await instance.close();
    throw new Error('Brak portu testowego');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    dataDir,
    instance,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await instance.close();
      if (shouldCleanupDir) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

async function setupAdmin(baseUrl: string, email = 'admin@pracownia.pl') {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Marek Nowak',
      email,
      password: ADMIN_PASS,
    }),
  });
  const data = await res.json();
  expect(res.status).toBe(200);
  return { res, data, cookie: extractSessionCookie(res) };
}

async function createUserAndLogin(
  baseUrl: string,
  adminCookie: string,
  userSpec: { name: string; email: string; role: 'project_manager' | 'developer' | 'viewer' }
) {
  const createRes = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      name: userSpec.name,
      email: userSpec.email,
      role: userSpec.role,
      password: USER_PASS,
      isApproved: true,
    }),
  });
  expect(createRes.status).toBe(200);
  const created = await createRes.json();

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userSpec.email, password: USER_PASS }),
  });
  expect(loginRes.status).toBe(200);
  return { user: created.user, cookie: extractSessionCookie(loginRes) };
}

describe('P43: Kosz (Trash Bin)', () => {
  const contexts: TestServerContext[] = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      const ctx = contexts.pop()!;
      await ctx.close();
    }
  });

  it('jednostkowo: usuwa osierocone komentarze, zachowuje istniejące zależności i ignoruje brakujące przy przywracaniu', () => {
    const caller = { id: 'usr-admin', name: 'Admin', role: 'admin' };
    const appState: any = {
      projects: [{ id: 'prj-1', key: 'OSL', name: 'Osiedle', memberIds: ['usr-admin'] }],
      tasks: [
        { id: 'tsk-parent', projectId: 'prj-1', code: 'OSL-1', title: 'Rodzic', revision: 1 },
        { id: 'tsk-gone', projectId: 'prj-1', code: 'OSL-2', title: 'Brakujący bloker', revision: 1 },
        {
          id: 'tsk-target',
          projectId: 'prj-1',
          code: 'OSL-3',
          title: 'Cel',
          parentId: 'tsk-parent',
          blockingTaskIds: ['tsk-gone', 'tsk-parent'],
          dependencies: ['tsk-gone', 'tsk-parent'],
          revision: 3,
        },
        {
          id: 'tsk-child',
          projectId: 'prj-1',
          code: 'OSL-4',
          title: 'Dziecko',
          parentId: 'tsk-target',
          blockingTaskIds: ['tsk-target'],
          dependencies: ['tsk-target'],
          revision: 1,
        },
      ],
      comments: [
        { id: 'cmt-1', taskId: 'tsk-target', userId: 'usr-admin', content: 'Ważny komentarz' },
        { id: 'cmt-other', taskId: 'tsk-parent', userId: 'usr-admin', content: 'Komentarz rodzica' },
      ],
      activityLogs: [],
      trash: [],
    };

    const { trashEntry } = moveTaskToTrash(
      appState,
      appState.tasks.find((t: any) => t.id === 'tsk-target'),
      caller,
      30,
      Date.UTC(2026, 10, 10, 12, 0, 0)
    );

    expect(trashEntry.type).toBe('task');
    expect(appState.tasks.some((t: any) => t.id === 'tsk-target')).toBe(false);
    // Komentarz usuniętego zadania usunięty ze stanu, cudzy komentarz nienaruszony
    expect(appState.comments).toHaveLength(1);
    expect(appState.comments[0].id).toBe('cmt-other');
    // Wyczyszczone powiązania z istniejącego dziecka
    const childWhileDeleted = appState.tasks.find((t: any) => t.id === 'tsk-child');
    expect(childWhileDeleted.parentId).toBeUndefined();
    expect(childWhileDeleted.blockingTaskIds).toEqual([]);
    expect(childWhileDeleted.dependencies).toEqual([]);
    // Zapis w activityLogs
    expect(appState.activityLogs[0].action).toContain('przeniesiono do kosza');

    // Usuń całkowicie tsk-gone z aktywnych zadań zanim przywrócimy tsk-target
    appState.tasks = appState.tasks.filter((t: any) => t.id !== 'tsk-gone');

    const restored = restoreTrashEntry(
      appState,
      trashEntry.id,
      caller,
      Date.UTC(2026, 10, 11, 8, 0, 0)
    );
    expect(restored.ok).toBe(true);
    if (restored.ok && restored.type === 'task') {
      expect(restored.task.revision).toBe(4);
      expect(restored.task.parentId).toBe('tsk-parent');
      expect(restored.task.blockingTaskIds).toEqual(['tsk-parent']);
      expect(restored.task.dependencies).toEqual(['tsk-parent']);
      expect(restored.commentsRestored).toBe(1);
    }

    // Sprawdź brak duplikacji komentarzy i odtworzenie relacji w tsk-child
    expect(appState.comments.filter((c: any) => c.id === 'cmt-1')).toHaveLength(1);
    const childAfterRestore = appState.tasks.find((t: any) => t.id === 'tsk-child');
    expect(childAfterRestore.parentId).toBe('tsk-target');
    expect(childAfterRestore.blockingTaskIds).toContain('tsk-target');
    expect(childAfterRestore.dependencies).toContain('tsk-target');
    expect(appState.trash).toHaveLength(0);
  });

  it('jednostkowo: limit 2000 wpisów kosza (enforceTrashLimit) usuwa najstarsze oraz purgeExpiredTrash usuwa wygasłe', () => {
    const baseMs = Date.UTC(2026, 10, 1, 0, 0, 0);
    const entries: TrashEntry[] = [];
    for (let i = 0; i < TRASH_MAX_ENTRIES + 5; i++) {
      entries.push({
        id: `t-${i}`,
        type: 'task',
        deletedAt: new Date(baseMs + i * 1000).toISOString(),
        deletedBy: 'usr-1',
        deletedByName: 'Admin',
        expiresAt: new Date(baseMs + (i + 30) * 86400_000).toISOString(),
        projectId: 'prj-1',
        title: `Zadanie ${i}`,
        code: `PRJ-${i}`,
        payload: { task: { id: `tsk-${i}` } as any, comments: [], links: { blockingTaskIds: [], dependencies: [], childTaskIds: [], dependentTaskIds: [] } },
      });
    }

    const { entries: limited, removedCount } = enforceTrashLimit(entries, TRASH_MAX_ENTRIES);
    expect(removedCount).toBe(5);
    expect(limited).toHaveLength(TRASH_MAX_ENTRIES);
    expect(limited.some((e) => e.id === 't-0')).toBe(false);
    expect(limited.some((e) => e.id === 't-4')).toBe(false);
    expect(limited.some((e) => e.id === 't-5')).toBe(true);

    const appState: any = {
      trash: [
        { ...limited[0], id: 'expired-1', expiresAt: new Date(baseMs - 1000).toISOString() },
        { ...limited[1], id: 'valid-1', expiresAt: new Date(baseMs + 5000).toISOString() },
      ],
    };
    const purged = purgeExpiredTrash(appState, baseMs);
    expect(purged.removedCount).toBe(1);
    expect(appState.trash.map((e: TrashEntry) => e.id)).toEqual(['valid-1']);
  });

  it('HTTP: DELETE zadania przenosi do kosza, ukrywa w GET/409 POST /api/state, przywraca z GET/POST /api/trash oraz blokuje bez projektu', async () => {
    const ctx = await startServer();
    contexts.push(ctx);

    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // Utwórz projekt
    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Biurowiec Alfa', key: 'ALFA' }),
    });
    expect(projRes.status).toBe(201);
    const project = (await projRes.json()).project;

    // Utwórz zadanie + komentarz
    const taskRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Projekt wykonawczy elewacji',
        startDate: '2026-11-18',
        dueDate: '2026-11-22',
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()).task;

    const cmtRes = await fetch(`${ctx.baseUrl}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ taskId: task.id, content: 'Komentarz do usuniętego zadania' }),
    });
    expect(cmtRes.status).toBe(201);

    // DELETE /api/tasks/:id -> miękkie usunięcie
    const delRes = await fetch(`${ctx.baseUrl}/api/tasks/${task.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.success).toBe(true);
    expect(typeof delJson.trashId).toBe('string');

    // GET /api/state NIE zawiera trash ani usuniętego zadania ani osieroconego komentarza
    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } });
    const stateJson = await stateRes.json();
    expect(stateJson.state.trash).toBeUndefined();
    expect(stateJson.state.tasks.some((t: any) => t.id === task.id)).toBe(false);
    expect(stateJson.state.comments.some((c: any) => c.taskId === task.id)).toBe(false);
    expect(
      stateJson.state.activityLogs.some((a: any) => String(a.action).includes('przeniesiono do kosza'))
    ).toBe(true);

    // POST /api/state przy konflikcie 409 również nie zwraca trash w currentState
    const conflictRes = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': '"999999"',
      },
      body: JSON.stringify({ projects: [], tasks: [] }),
    });
    expect(conflictRes.status).toBe(409);
    const conflictJson = await conflictRes.json();
    expect(conflictJson.currentState.trash).toBeUndefined();

    // GET /api/trash pokazuje wpis bez pełnego payloadu
    const trashListRes = await fetch(`${ctx.baseUrl}/api/trash`, {
      headers: { Cookie: adminCookie },
    });
    expect(trashListRes.status).toBe(200);
    const trashList = await trashListRes.json();
    expect(trashList.retentionDays).toBe(30);
    expect(trashList.items).toHaveLength(1);
    expect(trashList.items[0].id).toBe(delJson.trashId);
    expect(trashList.items[0].type).toBe('task');
    expect(trashList.items[0].payload).toBeUndefined();
    expect(trashList.items[0].commentCount).toBe(1);

    // Usuń projekt nadrzędny -> próba przywrócenia zadania musi zwrócić 409 "Najpierw przywróć projekt."
    const delProjRes = await fetch(`${ctx.baseUrl}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delProjRes.status).toBe(200);
    const delProjJson = await delProjRes.json();

    const blockedRestoreRes = await fetch(`${ctx.baseUrl}/api/trash/${delJson.trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(blockedRestoreRes.status).toBe(409);
    const blockedRestoreJson = await blockedRestoreRes.json();
    expect(blockedRestoreJson.error).toBe('Najpierw przywróć projekt.');

    // Przywróć projekt -> potem przywróć zadanie
    const restoreProjRes = await fetch(`${ctx.baseUrl}/api/trash/${delProjJson.trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(restoreProjRes.status).toBe(200);

    const restoreTaskRes = await fetch(`${ctx.baseUrl}/api/trash/${delJson.trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(restoreTaskRes.status).toBe(200);

    // Zadanie i komentarz wróciły do stanu, kosz pusty
    const stateAfterRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    const stateAfter = (await stateAfterRes.json()).state;
    expect(stateAfter.tasks.some((t: any) => t.id === task.id)).toBe(true);
    expect(stateAfter.comments.some((c: any) => c.taskId === task.id)).toBe(true);

    // Dziennik bezpieczeństwa zawiera trash_restored z details: { count: 1 } bez tytułu
    const secRes = await fetch(`${ctx.baseUrl}/api/security/events?type=trash_restored`, {
      headers: { Cookie: adminCookie },
    });
    const secJson = await secRes.json();
    expect(secJson.events).toHaveLength(2);
    expect(secJson.events[0].details).toEqual({ count: 1 });
    expect(JSON.stringify(secJson.events)).not.toContain('Projekt wykonawczy elewacji');
  });

  it('HTTP: usunięcie i przywrócenie projektu wraz z zadaniami i komentarzami oraz konflikt klucza 409', async () => {
    const ctx = await startServer();
    contexts.push(ctx);
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Hala Sportowa', key: 'HALA' }),
    });
    const project = (await projRes.json()).project;

    const t1 = (
      await (
        await fetch(`${ctx.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ projectId: project.id, title: 'Konstrukcja dachu' }),
        })
      ).json()
    ).task;

    await fetch(`${ctx.baseUrl}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ taskId: t1.id, content: 'Uwaga statyczna' }),
    });

    const delRes = await fetch(`${ctx.baseUrl}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);
    const { trashId } = await delRes.json();

    // W stanie nie ma projektu ani zadania ani komentarza
    const stateMid = (
      await (await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })).json()
    ).state;
    expect(stateMid.projects).toHaveLength(0);
    expect(stateMid.tasks).toHaveLength(0);
    expect(stateMid.comments).toHaveLength(0);

    // Utwórz inny projekt z tym samym kluczem HALA -> próba przywrócenia musi zwrócić 409
    const dupRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Duplikat klucza', key: 'hala' }),
    });
    const dupProj = (await dupRes.json()).project;

    const conflictRestore = await fetch(`${ctx.baseUrl}/api/trash/${trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(conflictRestore.status).toBe(409);

    // Usuń duplikat -> zmień mu klucz lub opróżnij przez purge, albo usuń z kosza i przywróć oryginalny projekt
    await fetch(`${ctx.baseUrl}/api/projects/${dupProj.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });

    const okRestore = await fetch(`${ctx.baseUrl}/api/trash/${trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(okRestore.status).toBe(200);

    const stateEnd = (
      await (await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })).json()
    ).state;
    expect(stateEnd.projects.some((p: any) => p.id === project.id)).toBe(true);
    expect(stateEnd.tasks.some((t: any) => t.id === t1.id)).toBe(true);
    expect(stateEnd.comments.some((c: any) => c.taskId === t1.id)).toBe(true);
  });

  it('RBAC kosza: viewer (0 wpisów, 403), developer (widzi dostępne i przywraca tylko swoje, 403 purge), PM/admin + DELETE /api/trash', async () => {
    const ctx = await startServer();
    contexts.push(ctx);
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const pm = await createUserAndLogin(ctx.baseUrl, adminCookie, {
      name: 'Kierownik',
      email: 'pm@pracownia.pl',
      role: 'project_manager',
    });
    const devA = await createUserAndLogin(ctx.baseUrl, adminCookie, {
      name: 'Dev A',
      email: 'deva@pracownia.pl',
      role: 'developer',
    });
    const devB = await createUserAndLogin(ctx.baseUrl, adminCookie, {
      name: 'Dev B',
      email: 'devb@pracownia.pl',
      role: 'developer',
    });
    const viewer = await createUserAndLogin(ctx.baseUrl, adminCookie, {
      name: 'Gość',
      email: 'viewer@pracownia.pl',
      role: 'viewer',
    });

    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Wspólny',
        key: 'WSP',
        memberIds: [devA.user.id, devB.user.id],
      }),
    });
    const project = (await projRes.json()).project;

    // Zadanie usunięte przez Dev A i zadanie przypisane do Dev A, ale usunięte przez admina
    const tDevA = (
      await (
        await fetch(`${ctx.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: devA.cookie },
          body: JSON.stringify({ projectId: project.id, title: 'Zadanie DevA' }),
        })
      ).json()
    ).task;

    const tDevAAdminDel = (
      await (
        await fetch(`${ctx.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            projectId: project.id,
            title: 'Zadanie przypisane DevA ale usunięte przez admina',
            assigneeId: devA.user.id,
          }),
        })
      ).json()
    ).task;

    const delDevA = await (
      await fetch(`${ctx.baseUrl}/api/tasks/${tDevA.id}`, {
        method: 'DELETE',
        headers: { Cookie: devA.cookie },
      })
    ).json();

    const delAdmin = await (
      await fetch(`${ctx.baseUrl}/api/tasks/${tDevAAdminDel.id}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })
    ).json();

    // Viewer widzi 0 wpisów i dostaje 403 przy próbach mutacji
    const viewerList = await (
      await fetch(`${ctx.baseUrl}/api/trash`, { headers: { Cookie: viewer.cookie } })
    ).json();
    expect(viewerList.items).toEqual([]);

    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash/${delDevA.trashId}/restore`, {
          method: 'POST',
          headers: { Cookie: viewer.cookie },
        })
      ).status
    ).toBe(403);

    // Dev B nie widzi wpisu Dev A (ani jako deletedBy, ani assignee/reporter)
    const devBList = await (
      await fetch(`${ctx.baseUrl}/api/trash`, { headers: { Cookie: devB.cookie } })
    ).json();
    expect(devBList.items).toHaveLength(0);

    // Dev A widzi oba swoje/przypisane zadania, może przywrócić delDevA, NIE może przywrócić delAdmin ani usuwać trwale
    const devAList = await (
      await fetch(`${ctx.baseUrl}/api/trash`, { headers: { Cookie: devA.cookie } })
    ).json();
    expect(devAList.items).toHaveLength(2);
    const entryByAdmin = devAList.items.find((i: any) => i.id === delAdmin.trashId);
    const entryBySelf = devAList.items.find((i: any) => i.id === delDevA.trashId);
    expect(entryByAdmin.canRestore).toBe(false);
    expect(entryBySelf.canRestore).toBe(true);

    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash/${delAdmin.trashId}/restore`, {
          method: 'POST',
          headers: { Cookie: devA.cookie },
        })
      ).status
    ).toBe(403);

    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash/${delDevA.trashId}`, {
          method: 'DELETE',
          headers: { Cookie: devA.cookie },
        })
      ).status
    ).toBe(403);

    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash/${delDevA.trashId}/restore`, {
          method: 'POST',
          headers: { Cookie: devA.cookie },
        })
      ).status
    ).toBe(200);

    // PM może trwale usunąć pojedynczy wpis (trash_purged), ale NIE opróżnić całego kosza
    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash/${delAdmin.trashId}`, {
          method: 'DELETE',
          headers: { Cookie: pm.cookie },
        })
      ).status
    ).toBe(200);

    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Cookie: pm.cookie },
          body: JSON.stringify({ confirm: true }),
        })
      ).status
    ).toBe(403);

    // Admin bez confirm: true -> 400; z confirm: true -> 200 i zapisuje trash_emptied
    expect(
      (
        await fetch(`${ctx.baseUrl}/api/trash`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({}),
        })
      ).status
    ).toBe(400);

    const emptyRes = await fetch(`${ctx.baseUrl}/api/trash`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(emptyRes.status).toBe(200);

    const purgedEvents = await (
      await fetch(`${ctx.baseUrl}/api/security/events?type=trash_purged`, {
        headers: { Cookie: adminCookie },
      })
    ).json();
    expect(purgedEvents.events).toHaveLength(1);
    expect(purgedEvents.events[0].details).toEqual({ count: 1 });

    const emptiedEvents = await (
      await fetch(`${ctx.baseUrl}/api/security/events?type=trash_emptied`, {
        headers: { Cookie: adminCookie },
      })
    ).json();
    expect(emptiedEvents.events).toHaveLength(1);
    expect(emptiedEvents.events[0].details).toEqual({ count: 0 });
  });

  it('POST /api/state zachowuje appState.trash przy imporcie stanu oraz automatyczne czyszczenie usuwa przeterminowane wpisy przy starcie serwera', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-trash-persist-'));
    try {
      const ctx1 = await startServer({ dataDir });
      const { cookie: adminCookie } = await setupAdmin(ctx1.baseUrl);

      const project = (
        await (
          await fetch(`${ctx1.baseUrl}/api/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
            body: JSON.stringify({ name: 'Muzeum', key: 'MUZ' }),
          })
        ).json()
      ).project;

      const task = (
        await (
          await fetch(`${ctx1.baseUrl}/api/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
            body: JSON.stringify({ projectId: project.id, title: 'Makieta' }),
          })
        ).json()
      ).task;

      const { trashId } = await (
        await fetch(`${ctx1.baseUrl}/api/tasks/${task.id}`, {
          method: 'DELETE',
          headers: { Cookie: adminCookie },
        })
      ).json();

      // Import nowego stanu z fałszywym trash -> istniejący kosz jest zachowany, fałszywy ignorowany
      const importRes = await fetch(`${ctx1.baseUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          projects: [project],
          tasks: [],
          trash: [{ id: 'forged-trash-entry' }],
        }),
      });
      expect(importRes.status).toBe(200);

      const trashAfterImport = await (
        await fetch(`${ctx1.baseUrl}/api/trash`, { headers: { Cookie: adminCookie } })
      ).json();
      expect(trashAfterImport.items.map((i: any) => i.id)).toEqual([trashId]);

      await ctx1.close();

      // Wstrzyknij wygasły wpis bezpośrednio w app_state.json i uruchom serwer ponownie -> automatyczne czyszczenie na starcie
      const stateFile = path.join(dataDir, 'app_state.json');
      const diskState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      diskState.trash.push({
        id: 'trash-expired-startup',
        type: 'task',
        deletedAt: '2026-01-01T00:00:00.000Z',
        deletedBy: diskState.users[0].id,
        deletedByName: 'Marek Nowak',
        expiresAt: '2026-01-31T00:00:00.000Z',
        projectId: project.id,
        title: 'Przeterminowane zadanie',
        code: 'MUZ-99',
        payload: {
          task: { id: 'tsk-exp', projectId: project.id, title: 'Przeterminowane zadanie' },
          comments: [],
          links: { blockingTaskIds: [], dependencies: [], childTaskIds: [], dependentTaskIds: [] },
        },
      });
      fs.writeFileSync(stateFile, JSON.stringify(diskState, null, 2), 'utf-8');

      const ctx2 = await startServer({ dataDir });
      contexts.push(ctx2);

      const login2 = await fetch(`${ctx2.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@pracownia.pl', password: ADMIN_PASS }),
      });
      const cookie2 = extractSessionCookie(login2);

      const trashAfterRestart = await (
        await fetch(`${ctx2.baseUrl}/api/trash`, { headers: { Cookie: cookie2 } })
      ).json();
      expect(trashAfterRestart.items.map((i: any) => i.id)).toEqual([trashId]);
    } finally {
      if (contexts.length === 0) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });

  it('Ustawienia retencji kosza: walidacja 1-365 w UI, zapis przez PUT /api/admin/settings oraz blokada TRASH_RETENTION_DAYS (409)', async () => {
    const prevEnv = process.env.TRASH_RETENTION_DAYS;
    delete process.env.TRASH_RETENTION_DAYS;

    try {
      const ctx = await startServer();
      contexts.push(ctx);
      const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

      // Wartość spoza zakresu -> 400
      const badRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          trash: { retentionDays: 400 },
        }),
      });
      expect(badRes.status).toBe(400);

      // Poprawna wartość 45 -> 200 i widoczna w GET /api/admin/settings oraz GET /api/trash
      const okRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          trash: { retentionDays: 45 },
        }),
      });
      expect(okRes.status).toBe(200);
      const okJson = await okRes.json();
      expect(okJson.settings.trash.retentionDays).toEqual({
        value: 45,
        source: 'ui',
        locked: false,
      });

      const trashRes = await (
        await fetch(`${ctx.baseUrl}/api/trash`, { headers: { Cookie: adminCookie } })
      ).json();
      expect(trashRes.retentionDays).toBe(45);

      // Gdy ustawiono TRASH_RETENTION_DAYS w środowisku -> ma pierwszeństwo i zwraca 409 przy próbie zmiany z UI
      process.env.TRASH_RETENTION_DAYS = '14';
      const lockedGet = await (
        await fetch(`${ctx.baseUrl}/api/admin/settings`, { headers: { Cookie: adminCookie } })
      ).json();
      expect(lockedGet.trash.retentionDays).toEqual({
        value: 14,
        source: 'env',
        locked: true,
        envVar: 'TRASH_RETENTION_DAYS',
      });

      const lockedPut = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          trash: { retentionDays: 60 },
        }),
      });
      expect(lockedPut.status).toBe(409);
      const lockedPutJson = await lockedPut.json();
      expect(lockedPutJson.envVar).toBe('TRASH_RETENTION_DAYS');
    } finally {
      if (prevEnv !== undefined) {
        process.env.TRASH_RETENTION_DAYS = prevEnv;
      } else {
        delete process.env.TRASH_RETENTION_DAYS;
      }
    }
  });

  it('Kalendarz iCal: zadanie usunięte do kosza znika z feedu .ics, a po przywróceniu wraca z podbitą sekwencją', async () => {
    const ctx = await startServer();
    contexts.push(ctx);
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const tokenRes = await fetch(`${ctx.baseUrl}/api/calendar/token/generate`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(tokenRes.status).toBe(200);
    const { token } = await tokenRes.json();

    const project = (
      await (
        await fetch(`${ctx.baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'Szkoła Podstawowa', key: 'SZK' }),
        })
      ).json()
    ).project;

    const task = (
      await (
        await fetch(`${ctx.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            projectId: project.id,
            title: 'Odbiór techniczny',
            startDate: '2026-11-20',
            dueDate: '2026-11-24',
          }),
        })
      ).json()
    ).task;

    // 1. Przed usunięciem: zadanie jest w .ics (SEQUENCE: 0)
    const icsBefore = await (
      await fetch(`${ctx.baseUrl}/api/calendar/${token}/all.ics`)
    ).text();
    const eventsBefore = Object.values(ical.parseICS(icsBefore)).filter(
      (e: any) => e.type === 'VEVENT'
    ) as any[];
    expect(eventsBefore.some((e) => e.uid?.includes(task.id))).toBe(true);
    const evBefore = eventsBefore.find((e) => e.uid?.includes(task.id));
    expect(Number(evBefore.sequence || 0)).toBe(0);

    // 2. Po usunięciu do kosza: zadanie znika z .ics
    const delJson = await (
      await fetch(`${ctx.baseUrl}/api/tasks/${task.id}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })
    ).json();

    const icsWhileDeleted = await (
      await fetch(`${ctx.baseUrl}/api/calendar/${token}/all.ics`)
    ).text();
    const eventsWhileDeleted = Object.values(ical.parseICS(icsWhileDeleted)).filter(
      (e: any) => e.type === 'VEVENT'
    ) as any[];
    expect(eventsWhileDeleted.some((e) => e.uid?.includes(task.id))).toBe(false);

    // 3. Po przywróceniu z kosza: zadanie wraca do .ics z SEQUENCE >= 1
    await fetch(`${ctx.baseUrl}/api/trash/${delJson.trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });

    const icsAfterRestore = await (
      await fetch(`${ctx.baseUrl}/api/calendar/${token}/all.ics`)
    ).text();
    const eventsAfterRestore = Object.values(ical.parseICS(icsAfterRestore)).filter(
      (e: any) => e.type === 'VEVENT'
    ) as any[];
    const evAfter = eventsAfterRestore.find((e) => e.uid?.includes(task.id));
    expect(evAfter).toBeDefined();
    expect(Number(evAfter.sequence)).toBeGreaterThanOrEqual(1);
  });
});
