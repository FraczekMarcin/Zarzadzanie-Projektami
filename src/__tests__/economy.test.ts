import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import type { Company, Project, Task, User } from '../types/index.js';
import { canEditFinance, canViewFinance, filterProjectForUser } from '../utils/access.js';
import { parseDeepLink, buildUrlWithoutDeepLinkParams } from '../utils/deepLink.js';
import {
  buildEconomyRows,
  computeEconomyTotals,
  exportEconomyCsv,
  extractProjectYear,
  filterEconomyRows,
  getUpcomingUnscheduledPayments,
  sanitizeCsvFormula,
  schedulePaymentItemOnServer,
  sortEconomyRows,
} from '../utils/economy.js';

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

async function startTestServer(overrides: Partial<CreateAppOptions> = {}): Promise<TestServerContext> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-economy-test-'));
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    allowSelfRegistration: true,
    setupToken: '',
    ...overrides,
  });

  const httpServer = http.createServer(instance.app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await instance.close();
    throw new Error('Nie udało się odczytać portu serwera testowego');
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    dataDir,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function setupAdmin(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin Ekonomia',
      email: 'admin.ekonomia@pracownia.pl',
      password: 'Katedra-Finanse-2026!',
    }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return { user: data.user as User, cookie: extractSessionCookie(res) };
}

const ADMIN_USER: User = {
  id: 'usr-admin',
  name: 'Admin',
  email: 'admin@pracownia.pl',
  department: 'Zarząd',
  role: 'admin',
  initials: 'AD',
};
const PM_USER: User = {
  id: 'usr-pm',
  name: 'Kierownik',
  email: 'pm@pracownia.pl',
  department: 'Architektura',
  role: 'project_manager',
  initials: 'KI',
};
const DEV_USER: User = {
  id: 'usr-dev',
  name: 'Projektant',
  email: 'dev@pracownia.pl',
  department: 'Konstrukcja',
  role: 'developer',
  initials: 'PR',
};
const VIEWER_USER: User = {
  id: 'usr-view',
  name: 'Podgląd',
  email: 'viewer@pracownia.pl',
  department: 'Gość',
  role: 'viewer',
  initials: 'PO',
};

const COMPANIES: Company[] = [
  { id: 'cmp-a', name: 'Alfa Studio', letter: 'A', isActive: true },
  { id: 'cmp-b', name: 'Beta Projekt', letter: 'B', isActive: true },
];

const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'prj-1',
    key: '2026-1_A',
    name: 'Biurowiec Alfa',
    companyId: 'cmp-a',
    ownerId: 'usr-dev',
    memberIds: ['usr-dev'],
    clientName: 'Inwestor Alfa Sp. z o.o.',
    description: '',
    priority: 'normal',
    status: 'active',
    startDate: '2026-01-10',
    dueDate: '2026-12-31',
    durationDays: 355,
    progress: 30,
    color: '#0284c7',
    projectValue: 10000,
    projectVatRate: 23,
    isBaseContractPaid: false,
    costs: [
      {
        id: 'cost-1',
        projectId: 'prj-1',
        title: 'Mapa MDCP',
        amountNet: 2000,
        amountGross: 2460,
        category: 'mapa',
        date: '2026-04-01',
        status: 'planned',
        isPaid: false,
        dueDate: '2026-05-15',
      },
    ],
    paymentTranches: [
      {
        id: 'tr-1',
        title: 'Transza 1',
        amountNet: 4000,
        amountGross: 4920,
        dueDate: '2026-06-01',
        isPaid: false,
      },
    ],
    quotations: [],
  },
  {
    id: 'prj-2',
    key: '2025-4_B',
    name: 'Hala Beta',
    companyId: 'cmp-b',
    ownerId: 'usr-pm',
    memberIds: ['usr-pm'],
    clientName: 'Beta Logistic',
    description: '',
    priority: 'normal',
    status: 'completed',
    startDate: '2025-03-01',
    dueDate: '2025-11-30',
    durationDays: 274,
    progress: 100,
    color: '#10b981',
    isArchived: true,
    projectValue: 5000,
    projectVatRate: 23,
    isBaseContractPaid: true,
    costs: [
      {
        id: 'cost-2',
        projectId: 'prj-2',
        title: 'Ekspertyza',
        amountNet: 6500,
        amountGross: 7995,
        category: 'inne',
        date: '2025-07-01',
        status: 'paid',
        isPaid: true,
        dueDate: '2025-08-01',
      },
    ],
    quotations: [],
  },
  {
    id: 'prj-3',
    key: 'PRO-NO-CMP',
    name: 'Projekt bez firmy',
    ownerId: 'usr-pm',
    memberIds: [],
    clientName: 'Klient Indywidualny',
    description: '',
    priority: 'normal',
    status: 'planning',
    startDate: '2026-02-15',
    dueDate: '2026-09-01',
    durationDays: 198,
    progress: 10,
    color: '#6366f1',
    projectValue: 3000,
    projectVatRate: 23,
    costs: [],
    quotations: [],
  },
];

describe('Ekonomia — testy jednostkowe', () => {
  it('uprawnienia canViewFinance vs canEditFinance oraz filtrowanie API projektu', () => {
    const ownedByDev = SAMPLE_PROJECTS[0];
    const notOwnedByDev = SAMPLE_PROJECTS[1];

    expect(canViewFinance(ADMIN_USER, notOwnedByDev)).toBe(true);
    expect(canViewFinance(PM_USER, notOwnedByDev)).toBe(true);
    expect(canViewFinance(DEV_USER, ownedByDev)).toBe(true);
    expect(canViewFinance(DEV_USER, notOwnedByDev)).toBe(false);
    expect(canViewFinance(VIEWER_USER, ownedByDev)).toBe(false);

    expect(canEditFinance(DEV_USER, ownedByDev)).toBe(false);
    expect(canEditFinance(PM_USER, ownedByDev)).toBe(false);
    expect(canEditFinance(PM_USER, notOwnedByDev)).toBe(true);
    expect(canEditFinance(ADMIN_USER, ownedByDev)).toBe(true);

    const filteredForOwnerDev = filterProjectForUser(ownedByDev, DEV_USER);
    expect(filteredForOwnerDev.projectValue).toBe(10000);
    expect(filteredForOwnerDev.costs).toHaveLength(1);

    const filteredForOtherDev = filterProjectForUser(notOwnedByDev, DEV_USER);
    expect(filteredForOtherDev.projectValue).toBeUndefined();
    expect(filteredForOtherDev.costs).toBeUndefined();
  });

  it('obsługuje deep link ?view=economy oraz czyszczenie parametrów URL', () => {
    expect(parseDeepLink('?view=economy')).toEqual({ type: 'view', id: 'economy' });
    expect(parseDeepLink('?task=t-1&view=economy')).toEqual({ type: 'task', id: 't-1' });
    expect(buildUrlWithoutDeepLinkParams('https://example.pl/app/?view=economy&foo=1')).toBe('/app/?foo=1');
  });

  it('wyciąga rok z numeru RRRR-X_L lub z startDate', () => {
    expect(extractProjectYear({ key: '2026-1_A', startDate: '2024-01-01' })).toBe(2026);
    expect(extractProjectYear({ key: 'PRO-1', startDate: '2025-07-12' })).toBe(2025);
    expect(extractProjectYear({ key: 'PRO-1', startDate: '' })).toBeNull();
  });

  it('filtruje według firm (Wszystkie, firma, Bez firmy), roku, archiwum i wyszukiwania oraz wylicza sumy netto/brutto', () => {
    const allRows = buildEconomyRows(SAMPLE_PROJECTS, COMPANIES, ADMIN_USER, '2026-05-01');
    expect(allRows).toHaveLength(3);

    const activeOnly = filterEconomyRows(allRows, {
      companyFilter: 'all',
      year: 'all',
      status: 'all',
      showArchived: false,
      search: '',
    });
    expect(activeOnly.map((r) => r.project.id)).toEqual(['prj-1', 'prj-3']);

    const compBArchived = filterEconomyRows(allRows, {
      companyFilter: 'cmp-b',
      year: 2025,
      status: 'all',
      showArchived: true,
      search: 'hala',
    });
    expect(compBArchived.map((r) => r.project.id)).toEqual(['prj-2']);
    expect(compBArchived[0].balanceNet).toBe(-1500);
    expect(compBArchived[0].balanceGross).toBe(-1845);

    const noCompany = filterEconomyRows(allRows, {
      companyFilter: 'none',
      year: 'all',
      status: 'all',
      showArchived: true,
      search: '',
    });
    expect(noCompany.map((r) => r.project.id)).toEqual(['prj-3']);

    const totals = computeEconomyTotals(filterEconomyRows(allRows, {
      companyFilter: 'all',
      year: 'all',
      status: 'all',
      showArchived: true,
      search: '',
    }));
    expect(totals.count).toBe(3);
    expect(totals.valueNet).toBe(18000);
    expect(totals.valueGross).toBe(22140);
    expect(totals.costsNet).toBe(8500);
    expect(totals.costsGross).toBe(10455);
    expect(totals.balanceNet).toBe(9500);
    expect(totals.balanceGross).toBe(11685);
  });

  it('sortuje projekty po kolumnach w trybie netto i brutto', () => {
    const rows = buildEconomyRows(SAMPLE_PROJECTS, COMPANIES, ADMIN_USER, '2026-05-01');
    const byBalanceAsc = sortEconomyRows(rows, 'balance', 'asc', 'net');
    expect(byBalanceAsc.map((r) => r.project.id)).toEqual(['prj-2', 'prj-3', 'prj-1']);

    const byValueDesc = sortEconomyRows(rows, 'value', 'desc', 'gross');
    expect(byValueDesc.map((r) => r.project.id)).toEqual(['prj-1', 'prj-2', 'prj-3']);
  });

  it('eksportuje CSV z BOM, średnikiem, przecinkiem dziesiętnym i ochroną formuł (= + - @)', () => {
    expect(sanitizeCsvFormula('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeCsvFormula('+100')).toBe("'+100");
    expect(sanitizeCsvFormula('-500,00')).toBe("'-500,00");
    expect(sanitizeCsvFormula('@cmd')).toBe("'@cmd");

    const customProject: Project = {
      ...SAMPLE_PROJECTS[1],
      name: '=cmd|calc',
      clientName: '+Inwestor; Test',
    };
    const rows = buildEconomyRows([customProject], COMPANIES, ADMIN_USER, '2026-05-01');
    const csv = exportEconomyCsv(rows, 'net');

    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toContain('Numer;Nazwa;Firma;Zamawiający;Wartość projektu (netto)');
    expect(lines[1]).toContain("'=cmd|calc");
    expect(lines[1]).toContain('"\'+Inwestor; Test"');
    expect(lines[1]).toContain("'-1500,00");
  });

  it('wybiera nadchodzące nieopłacone i niepowiązane płatności dla uprawnionych projektów', () => {
    const upcoming = getUpcomingUnscheduledPayments(
      SAMPLE_PROJECTS,
      new Map<string, Task>(),
      ADMIN_USER,
      '2026-05-01'
    );
    expect(upcoming.map((u) => u.itemId)).toEqual(['cost-1', 'tr-1']);

    const upcomingForDev = getUpcomingUnscheduledPayments(
      SAMPLE_PROJECTS,
      new Map<string, Task>(),
      DEV_USER,
      '2026-05-01'
    );
    expect(upcomingForDev).toEqual([]);
  });
});

describe('Ekonomia — testy integracyjne API i synchronizacji z harmonogramem', () => {
  let ctx: TestServerContext | null = null;

  beforeEach(() => {
    ctx = null;
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
  });

  it('dodaje płatność do harmonogramu (1 POST + 1 PATCH), zapisuje scheduledTaskId i zapobiega duplikatom', async () => {
    ctx = await startTestServer();
    const { user: admin, cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const createProjRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        key: '2026-1_A',
        name: 'Projekt Harmonogram Płatności',
        ownerId: admin.id,
        projectValue: 12000,
        projectVatRate: 23,
        costs: [
          {
            id: 'cost-sched-1',
            title: 'Geologia gruntu',
            amountNet: 1500,
            amountGross: 1845,
            category: 'geologia',
            status: 'planned',
            isPaid: false,
            dueDate: '2026-07-15',
          },
        ],
      }),
    });
    expect(createProjRes.status).toBe(201);
    const createdProjJson = await createProjRes.json();
    const project = createdProjJson.project as Project;

    const candidates = getUpcomingUnscheduledPayments([project], new Map(), admin, '2026-01-01');
    expect(candidates).toHaveLength(1);

    const firstSchedule = await schedulePaymentItemOnServer({
      project,
      candidate: candidates[0],
      existingTasks: [],
      defaultTaskType: 'rysunek',
      amountMode: 'net',
      baseUrl: ctx.baseUrl,
      headers: { Cookie: adminCookie },
    });

    expect(firstSchedule.ok).toBe(true);
    expect(firstSchedule.alreadyScheduled).toBeUndefined();
    expect(firstSchedule.task).toBeDefined();
    expect(firstSchedule.task!.title).toBe('Płatność: Geologia gruntu (1 500,00 zł, wydatek)');
    expect(firstSchedule.task!.startDate).toBe('2026-07-15');
    expect(firstSchedule.task!.dueDate).toBe('2026-07-15');
    expect(firstSchedule.task!.assigneeId).toBe(admin.id);
    expect(firstSchedule.task!.tags).toEqual(['płatność']);
    expect(firstSchedule.task!.costIds).toEqual(['cost-sched-1']);
    expect(firstSchedule.project?.costs?.[0]?.scheduledTaskId).toBe(firstSchedule.task!.id);

    // Ponowne wywołanie nie tworzy duplikatu
    const updatedProject = firstSchedule.project!;
    const createdTask = firstSchedule.task!;
    const secondSchedule = await schedulePaymentItemOnServer({
      project: updatedProject,
      candidate: { ...candidates[0], scheduledTaskId: createdTask.id },
      existingTasks: [createdTask],
      defaultTaskType: 'rysunek',
      amountMode: 'net',
      baseUrl: ctx.baseUrl,
      headers: { Cookie: adminCookie },
    });
    expect(secondSchedule.ok).toBe(true);
    expect(secondSchedule.alreadyScheduled).toBe(true);

    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    expect(stateRes.status).toBe(200);
    const stateData = await stateRes.json();
    const matchingTasks = (stateData.state.tasks as Task[]).filter((t) =>
      t.title.includes('Geologia gruntu')
    );
    expect(matchingTasks).toHaveLength(1);
  });

  it('wycofuje nowo utworzone zadanie (rollback DELETE), jeśli PATCH projektu nie powiedzie się (np. 409)', async () => {
    ctx = await startTestServer();
    const { user: admin, cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const createProjRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        key: '2026-2_A',
        name: 'Projekt Rollback',
        ownerId: admin.id,
        costs: [
          {
            id: 'cost-rb-1',
            projectId: 'tmp',
            title: 'Usługa rollback',
            amountNet: 800,
            amountGross: 984,
            category: 'inne',
            date: '2026-08-01',
            status: 'planned',
            isPaid: false,
            dueDate: '2026-08-20',
          },
        ],
      }),
    });
    expect(createProjRes.status).toBe(201);
    const project = (await createProjRes.json()).project as Project;

    // Podbij rewizję projektu na serwerze, zostawiając stary numer rewizji w przekazanym obiekcie
    const bumpRes = await fetch(`${ctx.baseUrl}/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': String(project.revision || 1),
        Cookie: adminCookie,
      },
      body: JSON.stringify({ description: 'Zmiana rewizji przed kolizją' }),
    });
    expect(bumpRes.status).toBe(200);

    const candidates = getUpcomingUnscheduledPayments([project], new Map(), admin, '2026-01-01');
    const staleResult = await schedulePaymentItemOnServer({
      project,
      candidate: candidates[0],
      existingTasks: [],
      defaultTaskType: 'rysunek',
      amountMode: 'net',
      baseUrl: ctx.baseUrl,
      headers: { Cookie: adminCookie },
    });

    expect(staleResult.ok).toBe(false);
    expect(staleResult.rolledBack).toBe(true);

    // W bazie nie powinno pozostać osierocone zadanie
    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    const stateData = await stateRes.json();
    expect((stateData.state.tasks as Task[]).some((t) => t.title.includes('Usługa rollback'))).toBe(false);
  });

  it('egzekwuje RBAC w /api/state i PATCH finansów dla właściciela (developer) vs obcego użytkownika', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const createDevOwner = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Developer Właściciel',
        email: 'dev.owner@pracownia.pl',
        role: 'developer',
        password: 'Projekt-Stalowy-2026!',
      }),
    });
    const devOwner = (await createDevOwner.json()).user as User;

    const createDevOther = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Developer Obcy',
        email: 'dev.other@pracownia.pl',
        role: 'developer',
        password: 'Projekt-Stalowy-2026!',
      }),
    });
    expect(createDevOther.status).toBe(200);
    const devOther = (await createDevOther.json()).user as User;

    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        key: '2026-1_A',
        name: 'Projekt Właściciela',
        ownerId: devOwner.id,
        memberIds: [devOwner.id, devOther.id],
        projectValue: 15000,
        costs: [
          {
            id: 'c1',
            projectId: 'tmp',
            title: 'Koszt tajny',
            amountNet: 2500,
            amountGross: 3075,
            category: 'inne',
            date: '2026-05-01',
            status: 'planned',
          },
        ],
      }),
    });
    expect(projRes.status).toBe(201);
    const createdProj = (await projRes.json()).project as Project;

    const loginOther = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev.other@pracownia.pl', password: 'Projekt-Stalowy-2026!' }),
    });
    const otherCookie = extractSessionCookie(loginOther);

    const otherState = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: otherCookie } })
    ).json();
    const otherProj = (otherState.state.projects as Project[]).find((p) => p.id === createdProj.id)!;
    expect(otherProj).toBeDefined();
    expect(otherProj.projectValue).toBeUndefined();
    expect(otherProj.costs).toBeUndefined();

    const loginOwner = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev.owner@pracownia.pl', password: 'Projekt-Stalowy-2026!' }),
    });
    const ownerCookie = extractSessionCookie(loginOwner);

    const ownerState = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: ownerCookie } })
    ).json();
    const ownerProj = (ownerState.state.projects as Project[]).find((p) => p.id === createdProj.id)!;
    expect(ownerProj.projectValue).toBe(15000);
    expect(ownerProj.costs).toHaveLength(1);

    // Developer (nawet jako właściciel) nie może modyfikować finansów przez PATCH
    const patchRes = await fetch(`${ctx.baseUrl}/api/projects/${encodeURIComponent(createdProj.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ projectValue: 99999 }),
    });
    expect(patchRes.status).toBe(403);
  });
});
