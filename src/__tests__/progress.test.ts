import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import {
  computeProgressMap,
  computeProjectProgress,
  getSubtaskProgressSummary,
  getTaskWeight,
  hasDirectSubtasks,
  reconcileLeafTaskConsistency,
  reconcileLeafTasksConsistency,
  recomputeProjectProgress,
} from '../utils/progress.js';
import { validateAdminSettingsUpdate } from '../utils/settingsSchema.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Księżyc-Postęp-2026!';

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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-progress-'));
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
      name: 'Administrator Postępu',
      email: 'admin.progress@pracownia.pl',
      password: ADMIN_PASS,
    }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return { user: data.user, cookie: extractSessionCookie(res) };
}

describe('P65: Reguły wyliczania postępu zadań nadrzędnych i projektów (progress.ts)', () => {
  it('zadania liściowe zachowują własny postęp (0..100), a status done wymusza 100', () => {
    const map = computeProgressMap([
      { id: 't1', projectId: 'p1', status: 'in_progress', progress: 42 },
      { id: 't2', projectId: 'p1', status: 'done', progress: 10 },
      { id: 't3', projectId: 'p1', status: 'to_do', progress: -15 },
      { id: 't4', projectId: 'p1', status: 'review', progress: 150 },
    ]);

    expect(map.get('t1')).toBe(42);
    expect(map.get('t2')).toBe(100);
    expect(map.get('t3')).toBe(0);
    expect(map.get('t4')).toBe(100);
  });

  it('wylicza wagi zadań poprawnie dla trybu estimate i equal', () => {
    expect(getTaskWeight({ id: 'a', estimatedHours: 12, startDate: '2026-05-01', dueDate: '2026-05-10' }, 'estimate')).toBe(12);
    expect(getTaskWeight({ id: 'b', estimatedHours: 0, startDate: '2026-05-01', dueDate: '2026-05-05' }, 'estimate')).toBe(5);
    expect(getTaskWeight({ id: 'c' }, 'estimate')).toBe(1);
    expect(getTaskWeight({ id: 'd', estimatedHours: 24 }, 'equal')).toBe(1);
  });

  it('liczy średnią ważoną podzadań dla trybu estimate vs equal oraz ignoruje zadania cancelled', () => {
    const tasks = [
      { id: 'parent', projectId: 'p1', status: 'in_progress', progress: 0 },
      { id: 's1', projectId: 'p1', parentId: 'parent', status: 'done', progress: 100, estimatedHours: 30 },
      { id: 's2', projectId: 'p1', parentId: 'parent', status: 'to_do', progress: 0, estimatedHours: 10 },
      { id: 's3', projectId: 'p1', parentId: 'parent', status: 'cancelled', progress: 0, estimatedHours: 100 },
    ];

    const mapEstimate = computeProgressMap(tasks, { weighting: 'estimate' });
    // (100*30 + 0*10) / 40 = 75
    expect(mapEstimate.get('parent')).toBe(75);
    expect(mapEstimate.has('s3')).toBe(false);

    const mapEqual = computeProgressMap(tasks, { weighting: 'equal' });
    // (100 + 0) / 2 = 50
    expect(mapEqual.get('parent')).toBe(50);

    const summary = getSubtaskProgressSummary(tasks, 'parent', 'estimate');
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.tooltip).toBe('Podzadania: 2 (1 ukończone); wagi: godziny');
  });

  it('propaguje postęp rekurencyjnie od liści do korzeni przy wielopoziomowej hierarchii', () => {
    const tasks = [
      { id: 'root', projectId: 'p1', status: 'in_progress', progress: 0 },
      { id: 'mid1', projectId: 'p1', parentId: 'root', status: 'in_progress', progress: 0, estimatedHours: 20 },
      { id: 'mid2', projectId: 'p1', parentId: 'root', status: 'done', progress: 100, estimatedHours: 20 },
      { id: 'leaf1', projectId: 'p1', parentId: 'mid1', status: 'done', progress: 100, estimatedHours: 10 },
      { id: 'leaf2', projectId: 'p1', parentId: 'mid1', status: 'in_progress', progress: 50, estimatedHours: 10 },
    ];

    const map = computeProgressMap(tasks, { weighting: 'estimate' });
    // mid1 = (100*10 + 50*10)/20 = 75
    // root = (75*20 + 100*20)/40 = 87.5 -> 88
    expect(map.get('mid1')).toBe(75);
    expect(map.get('root')).toBe(88);
    expect(computeProjectProgress(tasks, { weighting: 'estimate' })).toBe(88);
  });

  it('zwraca 100 wyłącznie gdy wszystkie zliczane podzadania mają status done (zaokrąglenie 99.6 -> 99)', () => {
    const tasks = [
      { id: 'parent', projectId: 'p1', status: 'in_progress', progress: 0 },
      { id: 's1', projectId: 'p1', parentId: 'parent', status: 'done', progress: 100, estimatedHours: 996 },
      { id: 's2', projectId: 'p1', parentId: 'parent', status: 'in_progress', progress: 0, estimatedHours: 4 },
    ];

    const map = computeProgressMap(tasks, { weighting: 'estimate' });
    // 99600 / 1000 = 99.6 -> musi zostać przycięte do 99, bo s2 !== 'done'
    expect(map.get('parent')).toBe(99);
    expect(computeProjectProgress(tasks, { weighting: 'estimate' })).toBe(99);

    // Gdy s2 ma 99% i status 'in_progress', nadal nie może być 100
    tasks[2].progress = 99;
    expect(computeProgressMap(tasks, { weighting: 'estimate' }).get('parent')).toBe(99);

    // Dopiero gdy s2 ma status 'done' -> rodzic osiąga 100
    tasks[2].status = 'done';
    expect(computeProgressMap(tasks, { weighting: 'estimate' }).get('parent')).toBe(100);
    // Projekt ma wciąż parent ze statusem 'in_progress', więc nie może osiągnąć 100
    expect(computeProjectProgress(tasks, { weighting: 'estimate' })).toBe(99);
    // Po oznaczeniu zadania najwyższego poziomu jako 'done' -> projekt osiąga 100
    tasks[0].status = 'done';
    expect(computeProjectProgress(tasks, { weighting: 'estimate' })).toBe(100);
  });

  it('chroni przed cyklami i brakującymi rodzicami oraz obsługuje pusty/anulowany projekt', () => {
    expect(computeProjectProgress([])).toBe(0);
    expect(
      computeProjectProgress([{ id: 'c1', projectId: 'p1', status: 'cancelled', progress: 100 }])
    ).toBe(0);

    // Brakujący rodzic + cykl A <-> B
    const cyclicTasks = [
      { id: 'a', projectId: 'p1', parentId: 'b', status: 'in_progress', progress: 40, estimatedHours: 10 },
      { id: 'b', projectId: 'p1', parentId: 'a', status: 'in_progress', progress: 60, estimatedHours: 10 },
      { id: 'orphan', projectId: 'p1', parentId: 'missing-parent', status: 'done', progress: 100, estimatedHours: 20 },
    ];

    const map = computeProgressMap(cyclicTasks, { weighting: 'estimate' });
    expect(map.get('orphan')).toBe(100);
    expect(typeof map.get('a')).toBe('number');
    expect(typeof map.get('b')).toBe('number');
    expect(computeProjectProgress(cyclicTasks, { weighting: 'estimate' })).toBeGreaterThan(0);

    // Zadanie nadrzędne tylko z anulowanym podzadaniem traktowane jest jako liść
    const onlyCancelledChild = [
      { id: 'p', projectId: 'p1', status: 'in_progress', progress: 35 },
      { id: 'c', projectId: 'p1', parentId: 'p', status: 'cancelled', progress: 100 },
    ];
    expect(hasDirectSubtasks(onlyCancelledChild, 'p')).toBe(false);
    expect(computeProgressMap(onlyCancelledChild).get('p')).toBe(35);
  });

  it('recomputeProjectProgress aktualizuje postęp bez podbijania revision zadań', () => {
    const state = {
      projects: [{ id: 'p1', progress: 0, revision: 3 }],
      tasks: [
        { id: 'parent', projectId: 'p1', status: 'done', progress: 10, revision: 5 },
        { id: 'child', projectId: 'p1', parentId: 'parent', status: 'done', progress: 100, estimatedHours: 8, revision: 2 },
      ],
    };

    const res = recomputeProjectProgress(state, 'p1', { weighting: 'estimate' });
    expect(res.changed).toBe(true);
    expect(res.projectProgress).toBe(100);
    expect(state.tasks[0].progress).toBe(100);
    expect(state.tasks[0].revision).toBe(5);
    expect(state.projects[0].progress).toBe(100);
    expect(state.projects[0].revision).toBe(3);
  });
});

describe('P65: Walidacja settingsSchema oraz pełna integracja API po stronie serwera', () => {
  let ctx: TestServerContext | null = null;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
  });

  it('waliduje progress.weighting w validateAdminSettingsUpdate', () => {
    const valid = validateAdminSettingsUpdate(
      { progress: { weighting: 'equal' } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(valid.ok).toBe(true);
    expect(valid.patch.progress?.weighting).toBe('equal');

    const invalid = validateAdminSettingsUpdate(
      { progress: { weighting: 'invalid_mode' } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('przelicza przestarzałe wartości postępu w istniejącym app_state.json już przy starcie serwera', async () => {
    const preDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-progress-boot-'));
    try {
      const seedState = {
        initialized: true,
        revision: 7,
        users: [
          {
            id: 'usr-1',
            name: 'Admin',
            email: 'admin@pracownia.pl',
            role: 'admin',
            initials: 'AD',
            department: 'Biuro',
            isApproved: true,
            passwordHash: 'scrypt:salt:hash',
          },
        ],
        companies: [],
        projects: [
          {
            id: 'prj-boot',
            key: 'P-01',
            name: 'Projekt startowy',
            status: 'active',
            startDate: '2026-05-01',
            dueDate: '2026-05-30',
            durationDays: 30,
            progress: 99,
            revision: 1,
          },
        ],
        tasks: [
          {
            id: 'tsk-parent',
            projectId: 'prj-boot',
            code: 'P-01-1',
            title: 'Etap główny',
            type: 'rysunek',
            priority: 'normal',
            status: 'in_progress',
            startDate: '2026-05-01',
            dueDate: '2026-05-10',
            durationDays: 10,
            estimatedHours: 10,
            progress: 5,
            revision: 4,
          },
          {
            id: 'tsk-sub1',
            projectId: 'prj-boot',
            parentId: 'tsk-parent',
            code: 'P-01-2',
            title: 'Podzadanie A',
            type: 'rysunek',
            priority: 'normal',
            status: 'done',
            startDate: '2026-05-01',
            dueDate: '2026-05-05',
            durationDays: 5,
            estimatedHours: 30,
            progress: 100,
            revision: 2,
          },
          {
            id: 'tsk-sub2',
            projectId: 'prj-boot',
            parentId: 'tsk-parent',
            code: 'P-01-3',
            title: 'Podzadanie B',
            type: 'rysunek',
            priority: 'normal',
            status: 'to_do',
            startDate: '2026-05-06',
            dueDate: '2026-05-10',
            durationDays: 5,
            estimatedHours: 10,
            progress: 0,
            revision: 1,
          },
        ],
        comments: [],
        activityLogs: [],
        trash: [],
      };
      fs.writeFileSync(path.join(preDataDir, 'app_state.json'), JSON.stringify(seedState, null, 2), 'utf8');

      ctx = await startServer({ dataDir: preDataDir });
      const diskState = JSON.parse(fs.readFileSync(path.join(preDataDir, 'app_state.json'), 'utf8'));
      const parentOnDisk = diskState.tasks.find((t: any) => t.id === 'tsk-parent');
      const projectOnDisk = diskState.projects.find((p: any) => p.id === 'prj-boot');

      expect(parentOnDisk.progress).toBe(75);
      expect(parentOnDisk.revision).toBe(4);
      expect(projectOnDisk.progress).toBe(75);
    } finally {
      if (ctx) {
        await ctx.close();
        ctx = null;
      }
      fs.rmSync(preDataDir, { recursive: true, force: true });
    }
  });

  it('przelicza postęp przy CRUD zadań/projektów, odrzuca ręczną edycję postępu rodzica, obsługuje kosz i zmianę wagi', async () => {
    ctx = await startServer();
    const { user, cookie } = await setupAdmin(ctx.baseUrl);

    // 1. POST /api/projects ignoruje przesłany progress (np. 80 -> 0)
    const createProjRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Projekt A',
        ownerId: user.id,
        status: 'active',
        startDate: '2026-05-01',
        dueDate: '2026-05-30',
        progress: 80,
      }),
    });
    expect(createProjRes.status).toBe(201);
    const projA = (await createProjRes.json()).project;
    expect(projA.progress).toBe(0);

    const createProjBRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Projekt B',
        ownerId: user.id,
        status: 'active',
        startDate: '2026-05-01',
        dueDate: '2026-05-30',
      }),
    });
    expect(createProjBRes.status).toBe(201);
    const projB = (await createProjBRes.json()).project;

    // 2. Tworzymy zadanie nadrzędne i 2 podzadania z różnymi estymacjami (30h i 10h)
    const parentRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        projectId: projA.id,
        title: 'Zadanie nadrzędne',
        startDate: '2026-05-01',
        dueDate: '2026-05-10',
        progress: 0,
      }),
    });
    expect(parentRes.status).toBe(201);
    const parentTask = (await parentRes.json()).task;
    const initialParentRev = parentTask.revision || 1;

    const sub1Res = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        projectId: projA.id,
        parentId: parentTask.id,
        title: 'Podzadanie 1 (30h)',
        status: 'done',
        progress: 100,
        estimatedHours: 30,
        startDate: '2026-05-01',
        dueDate: '2026-05-05',
      }),
    });
    expect(sub1Res.status).toBe(201);
    const sub1 = (await sub1Res.json()).task;

    const sub2Res = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        projectId: projA.id,
        parentId: parentTask.id,
        title: 'Podzadanie 2 (10h)',
        status: 'in_progress',
        progress: 20,
        estimatedHours: 10,
        startDate: '2026-05-06',
        dueDate: '2026-05-10',
      }),
    });
    expect(sub2Res.status).toBe(201);
    const sub2 = (await sub2Res.json()).task;

    // Sprawdź GET /api/state: parent = (100*30 + 20*10)/40 = 80, projA = 80, parent revision bez zmian
    let stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    expect(stateRes.status).toBe(200);
    let stateJson = await stateRes.json();
    expect(stateJson.state.progressWeighting).toBe('estimate');
    expect(stateJson.state.serverSettings).toBeUndefined();
    expect(stateJson.state.tasks.find((t: any) => t.id === parentTask.id).progress).toBe(80);
    expect(stateJson.state.tasks.find((t: any) => t.id === parentTask.id).revision).toBe(initialParentRev);
    expect(stateJson.state.projects.find((p: any) => p.id === projA.id).progress).toBe(80);

    // 3. Próba ręcznej zmiany postępu zadania nadrzędnego przez PATCH zwraca 400
    const forbiddenParentProgress = await fetch(`${ctx.baseUrl}/api/tasks/${parentTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ progress: 15 }),
    });
    expect(forbiddenParentProgress.status).toBe(400);
    const errJson = await forbiddenParentProgress.json();
    expect(errJson.error).toBe('Postęp zadania nadrzędnego wynika z podzadań');

    // 4. PATCH /api/projects/:id ignoruje client progress
    const patchProjRes = await fetch(`${ctx.baseUrl}/api/projects/${projA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Projekt A+', progress: 12 }),
    });
    expect(patchProjRes.status).toBe(200);
    const patchedProj = (await patchProjRes.json()).project;
    expect(patchedProj.name).toBe('Projekt A+');
    expect(patchedProj.progress).toBe(80);

    // 5. Przełączenie wagi na 'equal' w PUT /api/admin/settings przelicza wszystkie projekty
    const putSettingsRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        progress: { weighting: 'equal' },
      }),
    });
    expect(putSettingsRes.status).toBe(200);
    const settingsJson = await putSettingsRes.json();
    expect(settingsJson.changedFields).toContain('progress.weighting');

    stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    stateJson = await stateRes.json();
    // W trybie equal: (100 + 20)/2 = 60
    expect(stateJson.state.progressWeighting).toBe('equal');
    expect(stateJson.state.tasks.find((t: any) => t.id === parentTask.id).progress).toBe(60);
    expect(stateJson.state.projects.find((p: any) => p.id === projA.id).progress).toBe(60);

    // 6. Usunięcie sub2 do kosza -> zostaje tylko sub1 (done, 100%) -> parent i projA = 100
    const delSub2Res = await fetch(`${ctx.baseUrl}/api/tasks/${sub2.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(delSub2Res.status).toBe(200);
    const trashId = (await delSub2Res.json()).trashId;

    stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    stateJson = await stateRes.json();
    // Wszystkie zliczane podzadania są done -> parent = 100, ale parent ma wciąż status != 'done', więc projA = 99
    expect(stateJson.state.tasks.find((t: any) => t.id === parentTask.id).progress).toBe(100);
    expect(stateJson.state.projects.find((p: any) => p.id === projA.id).progress).toBe(99);

    // 7. Przywrócenie sub2 z kosza -> parent i projA wracają do 60
    const restoreRes = await fetch(`${ctx.baseUrl}/api/trash/${trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(restoreRes.status).toBe(200);

    stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    stateJson = await stateRes.json();
    expect(stateJson.state.tasks.find((t: any) => t.id === parentTask.id).progress).toBe(60);
    expect(stateJson.state.projects.find((p: any) => p.id === projA.id).progress).toBe(60);

    // 8. Przeniesienie sub1 do Projektu B (odpięcie rodzica i zmiana projectId) -> oba projekty przeliczone
    const moveRes = await fetch(`${ctx.baseUrl}/api/tasks/${sub1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ projectId: projB.id, parentId: '' }),
    });
    expect(moveRes.status).toBe(200);

    stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    stateJson = await stateRes.json();
    // Projekt A ma teraz tylko parent -> sub2 (20%) => 20
    expect(stateJson.state.tasks.find((t: any) => t.id === parentTask.id).progress).toBe(20);
    expect(stateJson.state.projects.find((p: any) => p.id === projA.id).progress).toBe(20);
    // Projekt B ma teraz sub1 (done, 100%) => 100
    expect(stateJson.state.projects.find((p: any) => p.id === projB.id).progress).toBe(100);
  });
});

describe('P69: Spójność postępu i statusu zadania (serwer, migracja, import, kosz)', () => {
  let ctx: TestServerContext | null = null;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
  });

  it('jednostkowo: egzekwuje reguły dla liści, pomija cancelled oraz zadania nadrzędne', () => {
    const tProgress100: any = { id: 'l1', status: 'to_do', progress: 100 };
    const r1 = reconcileLeafTaskConsistency(tProgress100, { previousStatus: 'to_do', hasSubtasks: false });
    expect(r1).toEqual({ changed: true, statusChangedToDone: true });
    expect(tProgress100.status).toBe('done');

    const tStatusDone: any = { id: 'l2', status: 'done', progress: 35 };
    const r2 = reconcileLeafTaskConsistency(tStatusDone, { previousStatus: 'in_progress', hasSubtasks: false });
    expect(r2).toEqual({ changed: true, statusChangedToDone: false });
    expect(tProgress100.progress).toBe(100);
    expect(tStatusDone.progress).toBe(100);

    const tReopen: any = { id: 'l3', status: 'in_progress', progress: 100 };
    const r3 = reconcileLeafTaskConsistency(tReopen, { previousStatus: 'done', hasSubtasks: false });
    expect(r3).toEqual({ changed: true, statusChangedToDone: false });
    expect(tReopen.status).toBe('in_progress');
    expect(tReopen.progress).toBe(99);

    const tCancelled: any = { id: 'l4', status: 'cancelled', progress: 100 };
    const r4 = reconcileLeafTaskConsistency(tCancelled, { previousStatus: 'cancelled', hasSubtasks: false });
    expect(r4).toEqual({ changed: false, statusChangedToDone: false });
    expect(tCancelled.status).toBe('cancelled');

    const tParent: any = { id: 'p1', status: 'in_progress', progress: 100 };
    const r5 = reconcileLeafTaskConsistency(tParent, { previousStatus: 'in_progress', hasSubtasks: true });
    expect(r5).toEqual({ changed: false, statusChangedToDone: false });
    expect(tParent.status).toBe('in_progress');

    const batch: any[] = [
      { id: 'parent', projectId: 'p1', status: 'in_progress', progress: 0 },
      { id: 'c1', projectId: 'p1', parentId: 'parent', status: 'to_do', progress: 100 },
      { id: 'c2', projectId: 'p1', parentId: 'parent', status: 'done', progress: 20 },
      { id: 'c3', projectId: 'p1', parentId: 'parent', status: 'cancelled', progress: 100 },
    ];
    const batchRes = reconcileLeafTasksConsistency(batch);
    expect(batchRes.fixedCount).toBe(2);
    expect(batch[0].status).toBe('in_progress');
    expect(batch[1].status).toBe('done');
    expect(batch[2].progress).toBe(100);
    expect(batch[3].status).toBe('cancelled');
  });

  it('PATCH progress=100 ustawia done + wpis aktywności + 100 u rodzica, status done daje 100, done->in_progress daje 99, cancelled bez zmian', async () => {
    const server = await startServer();
    ctx = server;
    const { user, cookie } = await setupAdmin(server.baseUrl);

    const projRes = await fetch(`${server.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Projekt Spójność P69',
        ownerId: user.id,
        status: 'active',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
      }),
    });
    expect(projRes.status).toBe(201);
    const project = (await projRes.json()).project;

    const createTask = async (payload: Record<string, unknown>) => {
      const res = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          projectId: project.id,
          startDate: '2026-06-01',
          dueDate: '2026-06-05',
          ...payload,
        }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).task;
    };

    const parent = await createTask({ title: 'Etap nadrzędny', status: 'in_progress' });
    const sub1 = await createTask({ title: 'Podzadanie A', parentId: parent.id, status: 'in_progress', progress: 40 });
    const sub2 = await createTask({ title: 'Podzadanie B', parentId: parent.id, status: 'to_do', progress: 20 });
    const cancelledTask = await createTask({ title: 'Anulowane', status: 'cancelled', progress: 30 });

    // 1. status: 'done' bez podania progress ustawia progress: 100
    const doneRes = await fetch(`${ctx.baseUrl}/api/tasks/${sub1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(doneRes.status).toBe(200);
    const doneTask = (await doneRes.json()).task;
    expect(doneTask.status).toBe('done');
    expect(doneTask.progress).toBe(100);

    // 2. PATCH samym progress: 100 na sub2 ustawia status: 'done', dodaje wpis w activityLogs i ustawia 100 u rodzica
    const p100Res = await fetch(`${ctx.baseUrl}/api/tasks/${sub2.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ progress: 100 }),
    });
    expect(p100Res.status).toBe(200);
    const p100Task = (await p100Res.json()).task;
    expect(p100Task.status).toBe('done');
    expect(p100Task.progress).toBe(100);

    let stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    let stateJson = await stateRes.json();
    expect(stateJson.state.tasks.find((t: any) => t.id === parent.id).progress).toBe(100);
    expect(
      stateJson.state.activityLogs.some(
        (log: any) => log.taskId === sub2.id && String(log.action).includes('"done"')
      )
    ).toBe(true);

    // 3. Zmiana statusu z 'done' na 'in_progress' (przy progress=100) ustawia progress: 99 i obniża postęp rodzica
    const reopenRes = await fetch(`${ctx.baseUrl}/api/tasks/${sub2.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(reopenRes.status).toBe(200);
    const reopenedTask = (await reopenRes.json()).task;
    expect(reopenedTask.status).toBe('in_progress');
    expect(reopenedTask.progress).toBe(99);

    stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    stateJson = await stateRes.json();
    expect(stateJson.state.tasks.find((t: any) => t.id === parent.id).progress).toBeLessThan(100);

    // 4. Zadanie 'cancelled' z progress=100 pozostaje 'cancelled'
    const cancelPatchRes = await fetch(`${ctx.baseUrl}/api/tasks/${cancelledTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ progress: 100 }),
    });
    expect(cancelPatchRes.status).toBe(200);
    const cancelledAfter = (await cancelPatchRes.json()).task;
    expect(cancelledAfter.status).toBe('cancelled');
  });

  it('naprawia niespójne zadania liściowe podczas migracji startowej z jednym wpisem w logu', async () => {
    const preDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-p69-boot-'));
    const stdoutChunks: string[] = [];
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return origStdoutWrite(chunk);
    }) as any;

    try {
      const seedState = {
        initialized: true,
        revision: 3,
        users: [
          {
            id: 'usr-1',
            name: 'Admin',
            email: 'admin@pracownia.pl',
            role: 'admin',
            initials: 'AD',
            department: 'Biuro',
            isApproved: true,
            passwordHash: 'scrypt:salt:hash',
          },
        ],
        companies: [],
        projects: [
          {
            id: 'prj-m',
            key: 'P-9',
            name: 'Projekt Migracja',
            status: 'active',
            startDate: '2026-06-01',
            dueDate: '2026-06-30',
            durationDays: 30,
            progress: 10,
            revision: 1,
          },
        ],
        tasks: [
          {
            id: 't-parent',
            projectId: 'prj-m',
            code: 'P-9-1',
            title: 'Rodzic',
            type: 'rysunek',
            priority: 'normal',
            status: 'done',
            startDate: '2026-06-01',
            dueDate: '2026-06-10',
            durationDays: 10,
            estimatedHours: 20,
            progress: 10,
            revision: 1,
          },
          {
            id: 't-leaf-100',
            projectId: 'prj-m',
            parentId: 't-parent',
            code: 'P-9-2',
            title: 'Liść 100 bez done',
            type: 'rysunek',
            priority: 'normal',
            status: 'in_progress',
            startDate: '2026-06-01',
            dueDate: '2026-06-05',
            durationDays: 5,
            estimatedHours: 10,
            progress: 100,
            revision: 1,
          },
          {
            id: 't-leaf-done-low',
            projectId: 'prj-m',
            parentId: 't-parent',
            code: 'P-9-3',
            title: 'Liść done z niskim progress',
            type: 'rysunek',
            priority: 'normal',
            status: 'done',
            startDate: '2026-06-06',
            dueDate: '2026-06-10',
            durationDays: 5,
            estimatedHours: 10,
            progress: 40,
            revision: 1,
          },
          {
            id: 't-cancelled',
            projectId: 'prj-m',
            parentId: 't-parent',
            code: 'P-9-4',
            title: 'Anulowane 100',
            type: 'rysunek',
            priority: 'normal',
            status: 'cancelled',
            startDate: '2026-06-06',
            dueDate: '2026-06-10',
            durationDays: 5,
            estimatedHours: 10,
            progress: 100,
            revision: 1,
          },
        ],
        comments: [],
        activityLogs: [],
        trash: [],
      };
      fs.writeFileSync(path.join(preDataDir, 'app_state.json'), JSON.stringify(seedState, null, 2), 'utf8');

      ctx = await startServer({ dataDir: preDataDir });

      const diskState = JSON.parse(fs.readFileSync(path.join(preDataDir, 'app_state.json'), 'utf8'));
      const leaf100 = diskState.tasks.find((t: any) => t.id === 't-leaf-100');
      const leafDoneLow = diskState.tasks.find((t: any) => t.id === 't-leaf-done-low');
      const cancelled = diskState.tasks.find((t: any) => t.id === 't-cancelled');
      const parent = diskState.tasks.find((t: any) => t.id === 't-parent');
      const proj = diskState.projects.find((p: any) => p.id === 'prj-m');

      expect(leaf100.status).toBe('done');
      expect(leaf100.progress).toBe(100);
      expect(leafDoneLow.status).toBe('done');
      expect(leafDoneLow.progress).toBe(100);
      expect(cancelled.status).toBe('cancelled');
      expect(parent.progress).toBe(100);
      expect(proj.progress).toBe(100);

      const migrationLogs = stdoutChunks.filter((line) =>
        line.includes('Migracja spójności postępu i statusu zadań')
      );
      expect(migrationLogs).toHaveLength(1);
      expect(migrationLogs[0]).toContain('2');
    } finally {
      process.stdout.write = origStdoutWrite;
      if (ctx) {
        await ctx.close();
        ctx = null;
      }
      fs.rmSync(preDataDir, { recursive: true, force: true });
    }
  });

  it('naprawia niespójne zadania podczas importu stanu (POST /api/state) oraz przywracania z kosza', async () => {
    ctx = await startServer();
    const { user, cookie } = await setupAdmin(ctx.baseUrl);

    const importRes = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'If-Match': '*',
      },
      body: JSON.stringify({
        projects: [
          {
            id: 'prj-imp',
            key: 'IMP',
            name: 'Import P69',
            ownerId: user.id,
            status: 'active',
            startDate: '2026-06-01',
            dueDate: '2026-06-30',
            durationDays: 30,
            progress: 0,
            revision: 1,
          },
        ],
        tasks: [
          {
            id: 'imp-parent',
            projectId: 'prj-imp',
            code: 'IMP-1',
            title: 'Rodzic importu',
            type: 'task',
            priority: 'normal',
            status: 'done',
            startDate: '2026-06-01',
            dueDate: '2026-06-10',
            durationDays: 10,
            progress: 0,
            revision: 1,
          },
          {
            id: 'imp-c1',
            projectId: 'prj-imp',
            parentId: 'imp-parent',
            code: 'IMP-2',
            title: 'Dziecko progress 100 / to_do',
            type: 'task',
            priority: 'normal',
            status: 'to_do',
            startDate: '2026-06-01',
            dueDate: '2026-06-05',
            durationDays: 5,
            progress: 100,
            revision: 1,
          },
          {
            id: 'imp-c2',
            projectId: 'prj-imp',
            parentId: 'imp-parent',
            code: 'IMP-3',
            title: 'Dziecko done / progress 15',
            type: 'task',
            priority: 'normal',
            status: 'done',
            startDate: '2026-06-06',
            dueDate: '2026-06-10',
            durationDays: 5,
            progress: 15,
            revision: 1,
          },
          {
            id: 'imp-cancelled',
            projectId: 'prj-imp',
            code: 'IMP-4',
            title: 'Anulowane z importu',
            type: 'task',
            priority: 'normal',
            status: 'cancelled',
            startDate: '2026-06-01',
            dueDate: '2026-06-02',
            durationDays: 2,
            progress: 100,
            revision: 1,
          },
        ],
      }),
    });
    expect(importRes.status).toBe(200);

    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: cookie } });
    expect(stateRes.status).toBe(200);
    const stateJson = await stateRes.json();

    expect(stateJson.state.tasks.find((t: any) => t.id === 'imp-c1').status).toBe('done');
    expect(stateJson.state.tasks.find((t: any) => t.id === 'imp-c2').progress).toBe(100);
    expect(stateJson.state.tasks.find((t: any) => t.id === 'imp-cancelled').status).toBe('cancelled');
    expect(stateJson.state.tasks.find((t: any) => t.id === 'imp-parent').progress).toBe(100);
    expect(stateJson.state.projects.find((p: any) => p.id === 'prj-imp').progress).toBe(100);

    // Weryfikacja przywracania z kosza
    const delRes = await fetch(`${ctx.baseUrl}/api/tasks/imp-c1`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(delRes.status).toBe(200);
    const trashId = (await delRes.json()).trashId;

    const restoreRes = await fetch(`${ctx.baseUrl}/api/trash/${trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(restoreRes.status).toBe(200);
    const restoredJson = await restoreRes.json();
    expect(restoredJson.restored.task.status).toBe('done');
    expect(restoredJson.restored.task.progress).toBe(100);
  });
});

