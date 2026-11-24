import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import type { Project, Task, User } from '../types/index.js';
import { DEFAULT_PROJECT_TEMPLATES } from '../data/defaultTemplates.js';
import { instantiateTasksFromTemplate } from '../utils/projectTemplates.js';
import {
  MAX_CUSTOM_TEMPLATES,
  MAX_TEMPLATE_HIERARCHY_DEPTH,
  MAX_TEMPLATE_TASKS,
  TEMPLATE_LIMITS,
  buildTemplateFromProject,
  migrateLegacyTemplate,
  validateTemplateWritePayload,
} from '../utils/templateValidation.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
    if (/(?:__Host-zp_session|zp_session)=([^;]+)/.test(raw)) {
      return raw.split(';')[0];
    }
  }
  return '';
}

async function startTestServer(
  dataDirOverride?: string,
  overrides: Partial<CreateAppOptions> = {}
): Promise<TestServerContext> {
  const dataDir = dataDirOverride || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-templates-test-'));
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    allowSelfRegistration: true,
    setupToken: '',
    remindersDisableTimers: true,
    weeklySummaryDisableTimers: true,
    backupWatchDisableTimers: true,
    diskWatchDisableTimers: true,
    trashCleanupDisableTimers: true,
    googleSyncDisableTimers: true,
    trustedDevicesDisableTimers: true,
    ...overrides,
  });

  const httpServer = http.createServer(instance.app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await instance.close();
    throw new Error('Nie udało się odczytać portu testowego serwera');
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await instance.close();
  };

  return { baseUrl, dataDir, close };
}

async function setupAdmin(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Administrator Pracowni',
      email: 'szablony.admin@firma.pl',
      password: 'Księżyc-Wiosna-2026!',
    }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return { user: data.user as User, cookie: extractSessionCookie(res) };
}

async function createAndLoginUser(
  baseUrl: string,
  adminCookie: string,
  params: { name: string; email: string; role: 'project_manager' | 'developer' | 'viewer'; password: string }
) {
  const createRes = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify(params),
  });
  expect(createRes.status).toBe(200);
  const created = await createRes.json();

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });
  expect(loginRes.status).toBe(200);

  return {
    user: created.user as User,
    cookie: extractSessionCookie(loginRes),
  };
}

describe('Szablony projektów — walidacja, migracja i instancjonowanie', () => {
  it('odrzuca cykle w blockerKeys oraz parentKey', () => {
    const blockerCycleRes = validateTemplateWritePayload({
      name: 'Szablon z cyklem zależności',
      category: 'kubaturowe',
      tasks: [
        { key: 'a', title: 'Zadanie A', durationDays: 5, offsetDays: 0, blockerKeys: ['b'] },
        { key: 'b', title: 'Zadanie B', durationDays: 5, offsetDays: 5, blockerKeys: ['a'] },
      ],
    });
    expect(blockerCycleRes.ok).toBe(false);
    if (!blockerCycleRes.ok) {
      expect(blockerCycleRes.error).toMatch(/cykl/i);
    }

    const parentCycleRes = validateTemplateWritePayload({
      name: 'Szablon z cyklem hierarchii',
      category: 'kubaturowe',
      tasks: [
        { key: 'p1', title: 'Rodzic 1', durationDays: 5, offsetDays: 0, parentKey: 'p2' },
        { key: 'p2', title: 'Rodzic 2', durationDays: 5, offsetDays: 0, parentKey: 'p1' },
      ],
    });
    expect(parentCycleRes.ok).toBe(false);
    if (!parentCycleRes.ok) {
      expect(parentCycleRes.error).toMatch(/cykl/i);
    }
  });

  it(`egzekwuje maksymalną głębokość hierarchii (${MAX_TEMPLATE_HIERARCHY_DEPTH}) i limit zadań (${MAX_TEMPLATE_TASKS})`, () => {
    // 6 poziomów (głębokość 6 — dozwolona)
    const okTasks = Array.from({ length: MAX_TEMPLATE_HIERARCHY_DEPTH }, (_, i) => ({
      key: `k-${i + 1}`,
      title: `Poziom ${i + 1}`,
      durationDays: 2,
      offsetDays: i,
      ...(i > 0 ? { parentKey: `k-${i}` } : {}),
    }));
    const okRes = validateTemplateWritePayload({
      name: 'Hierarchia 6 poziomów',
      category: 'ogolne',
      tasks: okTasks,
    });
    expect(okRes.ok).toBe(true);

    // 7 poziomów — odrzucone
    const tooDeepTasks = [
      ...okTasks,
      {
        key: `k-${MAX_TEMPLATE_HIERARCHY_DEPTH + 1}`,
        title: 'Za głęboko',
        durationDays: 2,
        offsetDays: 6,
        parentKey: `k-${MAX_TEMPLATE_HIERARCHY_DEPTH}`,
      },
    ];
    const deepRes = validateTemplateWritePayload({
      name: 'Hierarchia 7 poziomów',
      category: 'ogolne',
      tasks: tooDeepTasks,
    });
    expect(deepRes.ok).toBe(false);

    // Ponad 200 zadań — odrzucone
    const tooManyTasks = Array.from({ length: MAX_TEMPLATE_TASKS + 1 }, (_, i) => ({
      key: `t-${i + 1}`,
      title: `Etap ${i + 1}`,
      durationDays: 1,
      offsetDays: 0,
    }));
    const countRes = validateTemplateWritePayload({
      name: 'Za dużo zadań',
      category: 'ogolne',
      tasks: tooManyTasks,
    });
    expect(countRes.ok).toBe(false);
  });

  it('odrzuca przekroczone limity długości tekstu, nieprawidłowe dni oraz klucze prototypu', () => {
    const longName = validateTemplateWritePayload({
      name: 'x'.repeat(TEMPLATE_LIMITS.name + 1),
      tasks: [],
    });
    expect(longName.ok).toBe(false);

    const longDesc = validateTemplateWritePayload({
      name: 'Poprawna nazwa',
      description: 'y'.repeat(TEMPLATE_LIMITS.description + 1),
      tasks: [],
    });
    expect(longDesc.ok).toBe(false);

    const badDuration = validateTemplateWritePayload({
      name: 'Poprawna nazwa',
      tasks: [{ key: 'k1', title: 'Etap', durationDays: 0, offsetDays: 0 }],
    });
    expect(badDuration.ok).toBe(false);

    const badOffset = validateTemplateWritePayload({
      name: 'Poprawna nazwa',
      tasks: [{ key: 'k1', title: 'Etap', durationDays: 5, offsetDays: -1 }],
    });
    expect(badOffset.ok).toBe(false);

    const protoObj = JSON.parse('{"name":"Test","__proto__":{"polluted":true},"tasks":[]}');
    const protoRes = validateTemplateWritePayload(protoObj);
    expect(protoRes.ok).toBe(false);
  });

  it('migruje stare szablony z blockerIndices na stabilne klucze i zachowuje wbudowane szablony', () => {
    expect(DEFAULT_PROJECT_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const tpl of DEFAULT_PROJECT_TEMPLATES) {
      expect(tpl.builtIn).toBe(true);
      const keys = new Set(tpl.tasks.map((t) => t.key));
      expect(keys.size).toBe(tpl.tasks.length);
      for (const task of tpl.tasks) {
        expect((task as any).blockerIndices).toBeUndefined();
        for (const bk of task.blockerKeys || []) {
          expect(keys.has(bk)).toBe(true);
        }
      }
    }

    const migrated = migrateLegacyTemplate(
      {
        id: 'custom-legacy-1',
        name: 'Szablon z localStorage',
        category: 'mieszkaniowe',
        tasks: [
          { title: 'Krok 1', durationDays: 5, offsetDays: 0 },
          { title: 'Krok 2', durationDays: 3, offsetDays: 5, blockerIndices: [0] },
        ],
        isCustom: true,
      },
      { builtIn: false }
    );
    expect(migrated.builtIn).toBe(false);
    expect(migrated.isCustom).toBe(true);
    expect(migrated.tasks[0].key).toBe('t-1');
    expect(migrated.tasks[1].key).toBe('t-2');
    expect(migrated.tasks[1].blockerKeys).toEqual(['t-1']);
  });

  it('buildTemplateFromProject zachowuje hierarchię i zależności, pomija podzadania odznaczonego rodzica oraz usuwa postęp i finanse', () => {
    const project: Project = {
      id: 'prj-src',
      key: '2026-1_A',
      name: 'Biuro Testowe',
      description: 'Opis poufny',
      status: 'active',
      priority: 'high',
      startDate: '2026-05-01',
      dueDate: '2026-06-30',
      durationDays: 61,
      progress: 45,
      budget: '500 000 PLN',
      projectValue: 500000,
      ownerId: 'usr-owner',
      spentHours: 120,
      memberIds: ['usr-owner', 'usr-rep', 'usr-dev'],
      color: '#0284c7',
    };

    const tasks: Task[] = [
      {
        id: 't-parent-kept',
        projectId: project.id,
        code: '2026-1_A-01',
        title: 'Etap PZT',
        description: 'Projekt zagospodarowania',
        type: 'task',
        priority: 'high',
        status: 'done',
        reporterId: 'usr-rep',
        assigneeId: 'usr-owner',
        startDate: '2026-05-04',
        dueDate: '2026-05-10',
        durationDays: 7,
        spentHours: 14,
        progress: 100,
        blockingTaskIds: [],
        dependencies: [],
        tags: ['PZT'],
        createdAt: '2026-05-01T08:00:00.000Z',
        updatedAt: '2026-05-10T10:00:00.000Z',
      },
      {
        id: 't-child-kept',
        projectId: project.id,
        code: '2026-1_A-02',
        title: 'Mapa do celów projektowych',
        description: 'Podzadanie PZT',
        type: 'task',
        priority: 'normal',
        status: 'in_progress',
        reporterId: 'usr-rep',
        assigneeId: 'usr-rep',
        parentId: 't-parent-kept',
        startDate: '2026-05-05',
        dueDate: '2026-05-08',
        durationDays: 4,
        spentHours: 6,
        progress: 50,
        blockingTaskIds: [],
        dependencies: [],
        tags: [],
        createdAt: '2026-05-01T08:00:00.000Z',
        updatedAt: '2026-05-06T10:00:00.000Z',
      },
      {
        id: 't-next',
        projectId: project.id,
        code: '2026-1_A-03',
        title: 'Wniosek PnB',
        description: 'Po PZT',
        type: 'milestone',
        priority: 'critical',
        status: 'blocked',
        reporterId: 'usr-rep',
        assigneeId: 'usr-dev',
        isOfficialDeadline: true,
        startDate: '2026-05-11',
        dueDate: '2026-05-11',
        durationDays: 1,
        spentHours: 0,
        progress: 0,
        blockingTaskIds: ['t-parent-kept', 't-parent-unselected'],
        dependencies: ['t-parent-kept', 't-parent-unselected'],
        tags: ['KPA'],
        createdAt: '2026-05-01T08:00:00.000Z',
        updatedAt: '2026-05-01T08:00:00.000Z',
      },
      {
        id: 't-parent-unselected',
        projectId: project.id,
        code: '2026-1_A-04',
        title: 'Etap pominięty',
        description: '',
        type: 'task',
        priority: 'low',
        status: 'to_do',
        reporterId: 'usr-rep',
        startDate: '2026-05-02',
        dueDate: '2026-05-03',
        durationDays: 2,
        spentHours: 0,
        progress: 0,
        blockingTaskIds: [],
        dependencies: [],
        tags: [],
        createdAt: '2026-05-01T08:00:00.000Z',
        updatedAt: '2026-05-01T08:00:00.000Z',
      },
      {
        id: 't-child-of-unselected',
        projectId: project.id,
        code: '2026-1_A-05',
        title: 'Podzadanie pominiętego rodzica',
        description: '',
        type: 'task',
        priority: 'low',
        status: 'to_do',
        reporterId: 'usr-rep',
        parentId: 't-parent-unselected',
        startDate: '2026-05-02',
        dueDate: '2026-05-03',
        durationDays: 2,
        spentHours: 0,
        progress: 0,
        blockingTaskIds: [],
        dependencies: [],
        tags: [],
        createdAt: '2026-05-01T08:00:00.000Z',
        updatedAt: '2026-05-01T08:00:00.000Z',
      },
    ];

    const res = buildTemplateFromProject({
      project,
      projectTasks: tasks,
      body: {
        name: 'Szablon Biura',
        category: 'kubaturowe',
        selectedTaskIds: ['t-parent-kept', 't-child-kept', 't-next', 't-child-of-unselected'],
        skipCompleted: false,
        preserveAssigneeRoles: true,
      },
      callerId: 'usr-admin',
      templateId: 'tpl-1',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const tpl = res.template;
    // t-child-of-unselected pominięte, bo jego rodzic t-parent-unselected nie był zaznaczony
    expect(tpl.tasks).toHaveLength(3);
    expect(tpl.defaultBudget).toBeUndefined();
    expect((tpl as any).projectValue).toBeUndefined();

    const pzt = tpl.tasks.find((t) => t.title === 'Etap PZT')!;
    const mapa = tpl.tasks.find((t) => t.title === 'Mapa do celów projektowych')!;
    const pnb = tpl.tasks.find((t) => t.title === 'Wniosek PnB')!;

    // Najwcześniejszy startDate w projekcie to 2026-05-02 (t-parent-unselected)
    expect(pzt.offsetDays).toBe(2);
    expect(pzt.durationDays).toBe(7);
    expect(pzt.assigneeRole).toBe('owner');
    expect((pzt as any).status).toBeUndefined();
    expect((pzt as any).progress).toBeUndefined();
    expect((pzt as any).spentHours).toBeUndefined();

    expect(mapa.parentKey).toBe(pzt.key);
    expect(mapa.offsetDays).toBe(3);
    expect(mapa.durationDays).toBe(4);
    expect(mapa.assigneeRole).toBe('reporter');

    // blockerKeys zachowuje tylko relacje w obrębie wybranych zadań
    expect(pnb.blockerKeys).toEqual([pzt.key]);
    expect(pnb.assigneeRole).toBe('none');

    // Test skipCompleted: true
    const skipRes = buildTemplateFromProject({
      project,
      projectTasks: tasks,
      body: {
        name: 'Bez ukończonych',
        category: 'kubaturowe',
        skipCompleted: true,
        preserveAssigneeRoles: false,
      },
      callerId: 'usr-admin',
      templateId: 'tpl-2',
    });
    expect(skipRes.ok).toBe(true);
    if (skipRes.ok) {
      expect(skipRes.template.tasks.some((t) => t.title === 'Etap PZT')).toBe(false);
      expect(skipRes.template.tasks.every((t) => t.assigneeRole === 'none')).toBe(true);
    }
  });

  it('instantiateTasksFromTemplate używa numeru projektu, buduje hierarchię (rodzice przed dziećmi) i przypisuje role', () => {
    const reporter: User = {
      id: 'usr-rep',
      name: 'Jan Zgłaszający',
      email: 'jan@firma.pl',
      initials: 'JZ',
      role: 'project_manager',
      department: 'Projektowanie',
    };
    const project: Pick<Project, 'id' | 'key' | 'startDate' | 'ownerId'> = {
      id: 'prj-new',
      key: '2026-7_B',
      startDate: '2026-06-01',
      ownerId: 'usr-owner',
    };

    const templateTasks = instantiateTasksFromTemplate(
      {
        id: 'tpl-hier',
        name: 'Szablon hierarchiczny',
        category: 'kubaturowe',
        description: '',
        defaultDurationDays: 30,
        defaultPriority: 'normal',
        builtIn: false,
        isCustom: true,
        tasks: [
          // Celowo podzadanie przed rodzicem w tablicy źródłowej
          {
            key: 'sub',
            title: 'Podzadanie',
            description: '',
            type: 'task',
            priority: 'normal',
            durationDays: 3,
            offsetDays: 1,
            parentKey: 'root',
            blockerKeys: ['root'],
            assigneeRole: 'reporter',
          },
          {
            key: 'root',
            title: 'Zadanie główne',
            description: '',
            type: 'task',
            priority: 'high',
            durationDays: 5,
            offsetDays: 0,
            assigneeRole: 'owner',
          },
        ],
      },
      project,
      reporter
    );

    expect(templateTasks).toHaveLength(2);
    // Rodzic musi znaleźć się przed podzadaniem
    expect(templateTasks[0].title).toBe('Zadanie główne');
    expect(templateTasks[1].title).toBe('Podzadanie');

    expect(templateTasks[0].code.startsWith('2026-7_B-')).toBe(true);
    expect(templateTasks[1].code.startsWith('2026-7_B-')).toBe(true);
    expect(templateTasks[0].assigneeId).toBe('usr-owner');
    expect(templateTasks[1].assigneeId).toBe('usr-rep');
    expect(templateTasks[1].parentId).toBe(templateTasks[0].id);
    expect(templateTasks[1].blockingTaskIds).toEqual([templateTasks[0].id]);
    expect(templateTasks[0].status).toBe('to_do');
    expect(templateTasks[1].status).toBe('blocked');
  });
});

describe('Szablony projektów — API serwera, uprawnienia i trwałość', () => {
  let ctx: TestServerContext | null = null;
  let extraDataDir: string | null = null;

  beforeEach(async () => {
    ctx = await startTestServer();
  });

  afterEach(async () => {
    if (ctx) {
      const dir = ctx.dataDir;
      await ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
      ctx = null;
    }
    if (extraDataDir && fs.existsSync(extraDataDir)) {
      fs.rmSync(extraDataDir, { recursive: true, force: true });
      extraDataDir = null;
    }
  });

  it('egzekwuje uprawnienia ról (viewer 403 na odczyt, dev/PM odczyt 200 i 403 na zapis, admin pełny CRUD)', async () => {
    const server = ctx!;
    const { cookie: adminCookie } = await setupAdmin(server.baseUrl);
    const { cookie: pmCookie } = await createAndLoginUser(server.baseUrl, adminCookie, {
      name: 'Kierownik Pracowni',
      email: 'kierownik@firma.pl',
      role: 'project_manager',
      password: 'Most-Żelbet-2026!',
    });
    const { cookie: devCookie } = await createAndLoginUser(server.baseUrl, adminCookie, {
      name: 'Projektant Branżowy',
      email: 'projektant@firma.pl',
      role: 'developer',
      password: 'Stalowy-Szkielet-2026!',
    });
    const { cookie: viewerCookie } = await createAndLoginUser(server.baseUrl, adminCookie, {
      name: 'Obserwator Zewnętrzny',
      email: 'obserwator@firma.pl',
      role: 'viewer',
      password: 'Betonowy-Fundament-2026!',
    });

    // Viewer otrzymuje 403 na listę i szczegóły
    const vList = await fetch(`${server.baseUrl}/api/templates`, {
      headers: { Cookie: viewerCookie },
    });
    expect(vList.status).toBe(403);

    const builtInId = DEFAULT_PROJECT_TEMPLATES[0].id;
    const vDetail = await fetch(`${server.baseUrl}/api/templates/${builtInId}`, {
      headers: { Cookie: viewerCookie },
    });
    expect(vDetail.status).toBe(403);

    // Developer i PM mogą czytać listę oraz szczegóły
    for (const c of [devCookie, pmCookie]) {
      const listRes = await fetch(`${server.baseUrl}/api/templates`, { headers: { Cookie: c } });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.templates.length).toBe(DEFAULT_PROJECT_TEMPLATES.length);

      const detRes = await fetch(`${server.baseUrl}/api/templates/${builtInId}`, {
        headers: { Cookie: c },
      });
      expect(detRes.status).toBe(200);
      const detData = await detRes.json();
      expect(detData.template.id).toBe(builtInId);
      expect(detData.template.tasks.length).toBeGreaterThan(0);

      // Próba utworzenia/duplikacji zwraca 403
      const postRes = await fetch(`${server.baseUrl}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({ name: 'Nielegalny', tasks: [] }),
      });
      expect(postRes.status).toBe(403);

      const dupRes = await fetch(`${server.baseUrl}/api/templates/${builtInId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({}),
      });
      expect(dupRes.status).toBe(403);
    }

    // Wbudowany szablon jest tylko do odczytu nawet dla admina
    const putBuiltIn = await fetch(`${server.baseUrl}/api/templates/${builtInId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Zmiana', tasks: [] }),
    });
    expect(putBuiltIn.status).toBe(403);

    const delBuiltIn = await fetch(`${server.baseUrl}/api/templates/${builtInId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delBuiltIn.status).toBe(403);

    // Admin duplikuje wbudowany szablon -> 201 i staje się własnym
    const dupBuiltIn = await fetch(`${server.baseUrl}/api/templates/${builtInId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Kopia Szablonu Bazowego' }),
    });
    expect(dupBuiltIn.status).toBe(201);
    const dupData = await dupBuiltIn.json();
    expect(dupData.template.builtIn).toBe(false);
    expect(dupData.template.name).toBe('Kopia Szablonu Bazowego');

    const customId = dupData.template.id;

    // Admin edytuje własny szablon -> 200
    const putCustom = await fetch(`${server.baseUrl}/api/templates/${customId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Zmieniona Kopia',
        category: 'mieszkaniowe',
        description: 'Nowy opis',
        defaultDurationDays: 45,
        defaultPriority: 'high',
        tasks: [
          { key: 'e1', title: 'Etap 1', durationDays: 10, offsetDays: 0 },
          { key: 'e2', title: 'Podetap 1.1', durationDays: 4, offsetDays: 2, parentKey: 'e1' },
        ],
      }),
    });
    expect(putCustom.status).toBe(200);
    const putData = await putCustom.json();
    expect(putData.template.name).toBe('Zmieniona Kopia');
    expect(putData.template.tasks).toHaveLength(2);

    // Admin usuwa własny szablon -> 200
    const delCustom = await fetch(`${server.baseUrl}/api/templates/${customId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delCustom.status).toBe(200);

    // Sprawdzenie wpisów w dzienniku bezpieczeństwa
    const secRes = await fetch(`${server.baseUrl}/api/security/events?limit=200`, {
      headers: { Cookie: adminCookie },
    });
    expect(secRes.status).toBe(200);
    const secData = await secRes.json();
    const events = (secData.events || []).map((e: any) => e.type);
    expect(events).toContain('template_created');
    expect(events).toContain('template_updated');
    expect(events).toContain('template_deleted');
  });

  it('tworzy szablon z projektu przez /api/templates/from-project/:projectId, nie ujawnia projectTemplates w /api/state i przetrwa restart', async () => {
    const server = ctx!;
    const { user: admin, cookie: adminCookie } = await setupAdmin(server.baseUrl);

    // Utwórz projekt z zadaniami hierarchicznymi
    const prjRes = await fetch(`${server.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Osiedle Słoneczne',
        startDate: '2026-04-01',
        dueDate: '2026-06-01',
        durationDays: 62,
        ownerId: admin.id,
        budget: '999 000 PLN',
        projectValue: 999000,
      }),
    });
    expect(prjRes.status).toBe(201);
    const prjData = await prjRes.json();
    const project = prjData.project as Project;

    const rootTaskRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Koncepcja architektoniczna',
        startDate: '2026-04-01',
        dueDate: '2026-04-10',
        durationDays: 10,
        assigneeId: admin.id,
      }),
    });
    expect(rootTaskRes.status).toBe(201);
    const rootTask = (await rootTaskRes.json()).task as Task;

    const subTaskRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        parentId: rootTask.id,
        title: 'Analiza chłonności terenu',
        startDate: '2026-04-02',
        dueDate: '2026-04-05',
        durationDays: 4,
      }),
    });
    expect(subTaskRes.status).toBe(201);

    // Utwórz szablon z projektu
    const fromProjRes = await fetch(`${server.baseUrl}/api/templates/from-project/${project.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Standard Osiedla',
        category: 'mieszkaniowe',
        preserveAssigneeRoles: true,
      }),
    });
    expect(fromProjRes.status).toBe(201);
    const fromProjData = await fromProjRes.json();
    const tpl = fromProjData.template;
    expect(tpl.tasks).toHaveLength(2);
    expect(tpl.sourceProjectId).toBe(project.id);
    expect(tpl.defaultBudget).toBeUndefined();

    const childBp = tpl.tasks.find((t: any) => t.title === 'Analiza chłonności terenu');
    const rootBp = tpl.tasks.find((t: any) => t.title === 'Koncepcja architektoniczna');
    expect(childBp.parentKey).toBe(rootBp.key);
    expect(rootBp.assigneeRole).toBe('owner');

    // GET /api/state nie ujawnia projectTemplates
    const stateRes = await fetch(`${server.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    expect(stateRes.status).toBe(200);
    const stateData = await stateRes.json();
    expect(stateData.state.projectTemplates).toBeUndefined();

    // Konflikt 409 także nie ujawnia projectTemplates
    const conflictRes = await fetch(`${server.baseUrl}/api/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': '999999',
      },
      body: JSON.stringify({
        projects: stateData.state.projects,
        tasks: stateData.state.tasks,
      }),
    });
    expect(conflictRes.status).toBe(409);
    const conflictData = await conflictRes.json();
    expect(conflictData.currentState?.projectTemplates).toBeUndefined();

    // POST /api/state ignoruje nadchodzące projectTemplates i nie nadpisuje zapisanych szablonów
    const syncRes = await fetch(`${server.baseUrl}/api/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': String(stateData.state.revision),
      },
      body: JSON.stringify({
        projects: stateData.state.projects,
        tasks: stateData.state.tasks,
        projectTemplates: [{ id: 'fake', name: 'Nadpisany', tasks: [] }],
      }),
    });
    expect(syncRes.status).toBe(200);

    // Restart serwera na tym samym katalogu danych — szablon powinien być nadal obecny
    const persistedDir = server.dataDir;
    await server.close();
    ctx = null;
    extraDataDir = persistedDir;

    const restarted = await startTestServer(persistedDir);
    ctx = restarted;

    const loginRes = await fetch(`${restarted.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'szablony.admin@firma.pl',
        password: 'Księżyc-Wiosna-2026!',
      }),
    });
    expect(loginRes.status).toBe(200);
    const reLoginCookie = extractSessionCookie(loginRes);

    const listAfterRestart = await fetch(`${restarted.baseUrl}/api/templates`, {
      headers: { Cookie: reLoginCookie },
    });
    expect(listAfterRestart.status).toBe(200);
    const afterData = await listAfterRestart.json();
    expect(afterData.templates.some((t: any) => t.id === tpl.id && t.name === 'Standard Osiedla')).toBe(true);
  });

  it(`egzekwuje limit ${MAX_CUSTOM_TEMPLATES} własnych szablonów`, async () => {
    const server = ctx!;
    const { cookie: adminCookie } = await setupAdmin(server.baseUrl);

    for (let i = 0; i < MAX_CUSTOM_TEMPLATES; i += 1) {
      const res = await fetch(`${server.baseUrl}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: `Szablon limitowy ${i + 1}`,
          category: 'ogolne',
          tasks: [{ key: 't1', title: 'Zadanie', durationDays: 1, offsetDays: 0 }],
        }),
      });
      expect(res.status).toBe(201);
    }

    const overflowRes = await fetch(`${server.baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Szablon ponad limit',
        category: 'ogolne',
        tasks: [{ key: 't1', title: 'Zadanie', durationDays: 1, offsetDays: 0 }],
      }),
    });
    expect(overflowRes.status).toBe(400);
  });
});
