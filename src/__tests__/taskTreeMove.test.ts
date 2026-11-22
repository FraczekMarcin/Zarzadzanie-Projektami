import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Kasztan-Mural-2026!';
const VIEWER_PASS = 'Rzeka-Filar-2026!';

interface TestServerContext {
  baseUrl: string;
  dataDir: string;
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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-tree-move-'));
  const shouldCleanupDir = !overrides.dataDir;
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    setupToken: '',
    googleSyncDisableTimers: true,
    backupWatchDisableTimers: true,
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
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await instance.close();
      if (shouldCleanupDir) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

async function setupAdmin(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin Hierarchii',
      email: 'admin.tree@pracownia.pl',
      password: ADMIN_PASS,
    }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return { cookie: extractSessionCookie(res), user: data.user };
}

describe('P66: Integracja API przenoszenia zadań w drzewie (PATCH /api/tasks/:id)', () => {
  let ctx: TestServerContext;

  beforeEach(async () => {
    ctx = await startServer();
  });

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it('przenosi zadanie pod innego rodzica, przelicza postęp i dwukierunkowo zmienia statusy rodziców bez zmiany dat ani zależności', async () => {
    const { cookie, user } = await setupAdmin(ctx.baseUrl);

    const p1Res = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Projekt Drzewo 1',
        ownerId: user.id,
        status: 'active',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
      }),
    });
    expect(p1Res.status).toBe(201);
    const project1 = (await p1Res.json()).project;

    const createTask = async (payload: Record<string, any>) => {
      const res = await fetch(`${ctx.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          projectId: project1.id,
          startDate: '2026-06-02',
          dueDate: '2026-06-10',
          durationDays: 8,
          ...payload,
        }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).task;
    };

    const oldParent = await createTask({ title: 'Stary Rodzic', status: 'in_progress' });
    const oldSubDone = await createTask({
      title: 'Stare Podzadanie Done',
      parentId: oldParent.id,
      status: 'done',
      progress: 100,
      estimatedHours: 10,
    });
    const newParent = await createTask({
      title: 'Nowy Rodzic Done',
      status: 'done',
      progress: 100,
    });
    const newSubDone = await createTask({
      title: 'Nowe Podzadanie Done',
      parentId: newParent.id,
      status: 'done',
      progress: 100,
      estimatedHours: 10,
    });
    const movedTask = await createTask({
      title: 'Zadanie Przenoszone',
      parentId: oldParent.id,
      status: 'in_progress',
      progress: 20,
      estimatedHours: 10,
      startDate: '2026-06-04',
      dueDate: '2026-06-12',
      durationDays: 8,
      blockingTaskIds: [oldSubDone.id],
    });

    // Przenieś movedTask spod oldParent pod newParent z If-Match
    const patchRes = await fetch(`${ctx.baseUrl}/api/tasks/${movedTask.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(movedTask.revision),
      },
      body: JSON.stringify({ parentId: newParent.id }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();

    expect(patchBody.task.parentId).toBe(newParent.id);
    // Daty oraz zależności nie mogą się zmienić
    expect(patchBody.task.startDate).toBe('2026-06-04');
    expect(patchBody.task.dueDate).toBe('2026-06-12');
    expect(patchBody.task.durationDays).toBe(8);
    expect(patchBody.task.blockingTaskIds).toEqual([oldSubDone.id]);

    // Sprawdź stan po pobraniu z serwera
    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: cookie },
    });
    expect(stateRes.status).toBe(200);
    const stateJson = await stateRes.json();
    const byId = new Map<string, any>(stateJson.state.tasks.map((t: any) => [t.id, t]));

    expect(byId.get(oldParent.id)?.status).toBe('done');
    expect(byId.get(oldParent.id)?.progress).toBe(100);
    expect(byId.get(newParent.id)?.status).toBe('in_progress');
    // newSubDone (10h, 100%) + movedTask (10h, 20%) = 60%
    expect(byId.get(newParent.id)?.progress).toBe(60);
    expect(byId.get(newSubDone.id)?.progress).toBe(100);

    // Przenieś zadanie z powrotem na poziom główny (parentId: null)
    const rootPatchRes = await fetch(`${ctx.baseUrl}/api/tasks/${movedTask.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(patchBody.task.revision),
      },
      body: JSON.stringify({ parentId: null }),
    });
    expect(rootPatchRes.status).toBe(200);
    const rootPatchBody = await rootPatchRes.json();
    expect(rootPatchBody.task.parentId).toBeUndefined();

    const stateAfterRoot = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } })
    ).json();
    const afterRootById = new Map<string, any>(stateAfterRoot.state.tasks.map((t: any) => [t.id, t]));
    expect(afterRootById.get(newParent.id)?.status).toBe('done');
    expect(afterRootById.get(newParent.id)?.progress).toBe(100);
  });

  it('odrzuca cykl, self-parenting, inny projekt i głębokość > 6 kodem 400 oraz konflikt rewizji kodem 409', async () => {
    const { cookie, user } = await setupAdmin(ctx.baseUrl);

    const p1 = (
      await (
        await fetch(`${ctx.baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name: 'Projekt P1', ownerId: user.id }),
        })
      ).json()
    ).project;

    const p2 = (
      await (
        await fetch(`${ctx.baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name: 'Projekt P2', ownerId: user.id }),
        })
      ).json()
    ).project;

    const mk = async (projectId: string, title: string, parentId?: string) => {
      const r = await fetch(`${ctx.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ projectId, title, ...(parentId ? { parentId } : {}) }),
      });
      return (await r.json()).task;
    };

    const t1 = await mk(p1.id, 'L1');
    const t2 = await mk(p1.id, 'L2', t1.id);
    const t3 = await mk(p1.id, 'L3', t2.id);
    const t4 = await mk(p1.id, 'L4', t3.id);
    const t5 = await mk(p1.id, 'L5', t4.id);
    const t6 = await mk(p1.id, 'L6', t5.id);
    const otherTask = await mk(p2.id, 'Inny projekt');

    // Self-parent -> 400
    const selfRes = await fetch(`${ctx.baseUrl}/api/tasks/${t1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(t1.revision),
      },
      body: JSON.stringify({ parentId: t1.id }),
    });
    expect(selfRes.status).toBe(400);

    // Cykl -> 400
    const cycleRes = await fetch(`${ctx.baseUrl}/api/tasks/${t1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(t1.revision),
      },
      body: JSON.stringify({ parentId: t6.id }),
    });
    expect(cycleRes.status).toBe(400);

    // Inny projekt -> 400
    const crossProjRes = await fetch(`${ctx.baseUrl}/api/tasks/${t2.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(t2.revision),
      },
      body: JSON.stringify({ parentId: otherTask.id }),
    });
    expect(crossProjRes.status).toBe(400);

    // Głębokość > 6 -> 400
    const extraRoot = await mk(p1.id, 'Extra');
    const depthRes = await fetch(`${ctx.baseUrl}/api/tasks/${extraRoot.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(extraRoot.revision),
      },
      body: JSON.stringify({ parentId: t6.id }),
    });
    expect(depthRes.status).toBe(400);

    // Nieaktualna rewizja If-Match -> 409 i brak zmiany parentId
    const conflictRes = await fetch(`${ctx.baseUrl}/api/tasks/${extraRoot.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': '999',
      },
      body: JSON.stringify({ parentId: t1.id }),
    });
    expect(conflictRes.status).toBe(409);

    // Zezwolenie na przeniesienie zadania ze statusem 'done'
    const doneTask = await mk(p1.id, 'Done Task');
    await fetch(`${ctx.baseUrl}/api/tasks/${doneTask.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(doneTask.revision),
      },
      body: JSON.stringify({ status: 'done' }),
    });
    const stateMid = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } })
    ).json();
    const freshDone = stateMid.state.tasks.find((t: any) => t.id === doneTask.id);
    const moveDoneRes = await fetch(`${ctx.baseUrl}/api/tasks/${doneTask.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': String(freshDone.revision),
      },
      body: JSON.stringify({ parentId: t1.id }),
    });
    expect(moveDoneRes.status).toBe(200);
    expect((await moveDoneRes.json()).task.parentId).toBe(t1.id);
  });

  it('blokuje przenoszenie zadań użytkownikowi z rolą viewer (403)', async () => {
    const { cookie, user } = await setupAdmin(ctx.baseUrl);
    const p1 = (
      await (
        await fetch(`${ctx.baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name: 'Projekt Viewer', ownerId: user.id }),
        })
      ).json()
    ).project;
    const t1 = (
      await (
        await fetch(`${ctx.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ projectId: p1.id, title: 'Rodzic' }),
        })
      ).json()
    ).task;
    const t2 = (
      await (
        await fetch(`${ctx.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ projectId: p1.id, title: 'Dziecko' }),
        })
      ).json()
    ).task;

    const createViewerRes = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Obserwator Drzewa',
        email: 'viewer.tree@pracownia.pl',
        role: 'viewer',
        password: VIEWER_PASS,
      }),
    });
    expect(createViewerRes.status).toBe(200);

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'viewer.tree@pracownia.pl',
        password: VIEWER_PASS,
      }),
    });
    expect(loginRes.status).toBe(200);
    const viewerCookie = extractSessionCookie(loginRes);

    const patchRes = await fetch(`${ctx.baseUrl}/api/tasks/${t2.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: viewerCookie,
        'If-Match': String(t2.revision),
      },
      body: JSON.stringify({ parentId: t1.id }),
    });
    expect(patchRes.status).toBe(403);
  });
});
