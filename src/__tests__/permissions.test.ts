import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp, CreateAppResult } from '../server/app.js';
import {
  ALL_PERMISSIONS,
  DEFAULT_COMPANY_MEMBER_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  can,
  canUserUseCompanyPermission,
  createDefaultPermissionConfig,
  extractResourceCompanyIds,
  getEffectiveGlobalPermissions,
  getEffectivePermissions,
  hasMatchingCompanyMembership,
  normalizePermissionConfig,
} from '../utils/permissions.js';
import {
  canAccessProject,
  canEditFinance,
  canViewFinance,
  filterCompaniesForUser,
  filterProjectForUser,
  filterStateForUser,
  pickAllowedProjectFields,
  pickAllowedTaskFields,
} from '../utils/access.js';
import { buildWeeklySummary } from '../utils/weeklySummary.js';
import { normalizeStateStructure } from '../utils/stateStore.js';
import type { PermissionConfig, User } from '../types/index.js';

function makeUser(overrides: Partial<User> & { role: User['role'] }): User {
  return {
    id: overrides.id || `usr-${overrides.role}`,
    name: overrides.name || `User ${overrides.role}`,
    email: overrides.email || `${overrides.role}@pracownia.pl`,
    department: 'Pracownia',
    initials: overrides.role.slice(0, 2).toUpperCase(),
    isApproved: true,
    emailReminders: true,
    weeklySummary: true,
    ...overrides,
  };
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
    if (raw.includes('zp_session=')) return raw.split(';')[0];
  }
  return '';
}

async function createTestServer(cleanups: Array<() => Promise<void>>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-perm-'));
  const created: CreateAppResult = await createApp({
    dataDir: tmpDir,
    appSecret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    port: 0,
    isProduction: true,
    googleSyncDisableTimers: true,
    backupWatchDisableTimers: true,
    diskWatchDisableTimers: true,
    trustedDevicesDisableTimers: true,
    trashCleanupDisableTimers: true,
    remindersDisableTimers: true,
    weeklySummaryDisableTimers: true,
  });

  const server = created.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await created.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  return { baseUrl, port, created, tmpDir };
}

describe('P79 System uprawnień — testy jednostkowe i integracyjne', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it('katalog uprawnień obejmuje 17 uprawnień z opisami i domyślna macierz odwzorowuje 5 ról', () => {
    expect(ALL_PERMISSIONS).toHaveLength(17);
    expect(PERMISSION_CATALOG).toHaveLength(17);
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }

    const defaults = createDefaultPermissionConfig();
    expect(defaults.rolePermissions.admin).toEqual([...ALL_PERMISSIONS]);
    expect(defaults.rolePermissions.project_manager).toEqual(DEFAULT_ROLE_PERMISSIONS.project_manager);
    expect(defaults.rolePermissions.project_manager).not.toContain('clients.edit');
    expect(defaults.rolePermissions.project_manager).not.toContain('templates.manage');
    expect(defaults.rolePermissions.developer).toEqual(['projects.create']);
    expect(defaults.rolePermissions.tester).toEqual(['projects.create']);
    expect(defaults.rolePermissions.viewer).toEqual([]);
    expect(defaults.companyMemberPermissions).toEqual(DEFAULT_COMPANY_MEMBER_PERMISSIONS);

    // Zgodność ze starym app_state.json bez pola permissionConfig
    const normalized = normalizeStateStructure({ projects: [], tasks: [] } as any);
    expect(normalized.permissionConfig).toEqual(defaults);
  });

  it('grupy uprawnień, granty indywidualne i wyłączenia (denials zawsze wygrywają)', () => {
    const config: PermissionConfig = {
      ...createDefaultPermissionConfig(),
      permissionGroups: [
        {
          id: 'grp-tenders',
          name: 'Przetargi i Szablony',
          description: 'Dostęp do przetargów oraz szablonów',
          permissions: ['tenders.view', 'templates.manage'],
        },
        {
          id: 'grp-clients',
          name: 'Baza klientów',
          description: 'Edycja klientów',
          permissions: ['clients.edit'],
        },
      ],
    };

    const devWithGroups = makeUser({
      id: 'u-dev',
      role: 'developer',
      groupIds: ['grp-tenders', 'grp-clients'],
      permissionGrants: ['reports.view', 'projects.delete'],
      permissionDenials: ['clients.edit', 'projects.create'],
    });

    const effective = getEffectiveGlobalPermissions(devWithGroups, config);
    expect(effective).toContain('tenders.view');
    expect(effective).toContain('templates.manage');
    expect(effective).toContain('reports.view');
    expect(effective).toContain('projects.delete');
    // Wyłączenia indywidualne wygrywają nad rolą (projects.create) i grupą (clients.edit)
    expect(effective).not.toContain('clients.edit');
    expect(effective).not.toContain('projects.create');

    // Wyłączenie indywidualne blokuje nawet project_managera i właściciela projektu
    const pmDenied = makeUser({
      id: 'u-pm',
      role: 'project_manager',
      groupIds: ['grp-tenders'],
      permissionGrants: ['finance.edit', 'tasks.edit'],
      permissionDenials: ['finance.edit', 'projects.edit', 'tasks.edit'],
      companyIds: ['comp-a'],
    });
    const ownProject = {
      id: 'prj-own',
      companyId: 'comp-a',
      ownerId: 'u-pm',
      memberIds: ['u-pm'],
    };
    const ownTask = {
      id: 'tsk-1',
      projectId: 'prj-own',
      assigneeId: 'u-pm',
      reporterId: 'u-pm',
    };

    expect(can(pmDenied, 'finance.edit', ownProject, config)).toBe(false);
    expect(can(pmDenied, 'projects.edit', ownProject, config)).toBe(false);
    expect(can(pmDenied, 'tasks.edit', { type: 'task', task: ownTask, project: ownProject }, config)).toBe(false);
    expect(canEditFinance(pmDenied, ownProject, config)).toBe(false);
    expect(canViewFinance(pmDenied, ownProject, config)).toBe(true);
    expect(can(pmDenied, 'tenders.view', undefined, config)).toBe(true);
    expect(can(pmDenied, 'templates.manage', undefined, config)).toBe(true);

    // Rola admin nigdy nie podlega ograniczeniom denials i normalizePermissionConfig zawsze przywraca pełne uprawnienia admina
    const normalizedBad = normalizePermissionConfig({
      rolePermissions: { admin: ['projects.view'] },
      permissionGroups: [],
      companyMemberPermissions: [],
    });
    expect(normalizedBad.rolePermissions.admin).toEqual([...ALL_PERMISSIONS]);
  });

  it('zakres firmowy działa dla projektów, przetargów (tylko isOurs) i wykonawców, bez wycieku na inne firmy', () => {
    const config = createDefaultPermissionConfig();
    const companyUser = makeUser({
      id: 'u-comp-a',
      role: 'developer',
      companyIds: ['comp-a'],
    });

    const projectA = { id: 'p-a', companyId: 'comp-a', ownerId: 'usr-other', memberIds: [] };
    const projectB = { id: 'p-b', companyId: 'comp-b', ownerId: 'usr-other', memberIds: [] };
    const projectNone = { id: 'p-none', ownerId: 'usr-other', memberIds: [] };

    expect(can(companyUser, 'projects.view', projectA, config)).toBe(true);
    expect(can(companyUser, 'projects.edit', projectA, config)).toBe(true);
    expect(can(companyUser, 'finance.view', projectA, config)).toBe(true);
    expect(can(companyUser, 'finance.edit', projectA, config)).toBe(true);
    expect(can(companyUser, 'tasks.edit', { type: 'task', project: projectA }, config)).toBe(true);
    expect(can(companyUser, 'projects.delete', projectA, config)).toBe(false); // brak w DEFAULT_COMPANY_MEMBER_PERMISSIONS

    expect(can(companyUser, 'projects.view', projectB, config)).toBe(false);
    expect(can(companyUser, 'finance.edit', projectB, config)).toBe(false);
    expect(can(companyUser, 'projects.view', projectNone, config)).toBe(false);

    // Przetargi: wyłącznie bidder z isOurs: true i matching companyId
    const tenderA = {
      type: 'tender' as const,
      bidders: [
        { isOurs: false, companyId: 'comp-b' },
        { isOurs: true, companyId: 'comp-a' },
      ],
    };
    const tenderOnlyCompetitorA = {
      type: 'tender' as const,
      bidders: [{ isOurs: false, companyId: 'comp-a' }],
    };
    const tenderB = {
      type: 'tender' as const,
      bidders: [{ isOurs: true, companyId: 'comp-b' }],
    };

    expect(extractResourceCompanyIds(tenderA)).toEqual(['comp-a']);
    expect(extractResourceCompanyIds(tenderOnlyCompetitorA)).toEqual([]);
    expect(hasMatchingCompanyMembership(companyUser, tenderA)).toBe(true);
    expect(hasMatchingCompanyMembership(companyUser, tenderOnlyCompetitorA)).toBe(false);
    expect(can(companyUser, 'tenders.view', tenderA, config)).toBe(true);
    expect(can(companyUser, 'tenders.edit', tenderA, config)).toBe(true);
    expect(can(companyUser, 'tenders.view', tenderOnlyCompetitorA, config)).toBe(false);
    expect(can(companyUser, 'tenders.view', tenderB, config)).toBe(false);

    // Wykonawcy: companyId / companyIds / projectCompanyIds
    expect(can(companyUser, 'contractors.view', { type: 'contractor', companyId: 'comp-a' }, config)).toBe(true);
    expect(can(companyUser, 'contractors.edit', { type: 'contractor', projectCompanyIds: ['comp-a'] }, config)).toBe(true);
    expect(can(companyUser, 'contractors.view', { type: 'contractor', companyId: 'comp-b' }, config)).toBe(false);

    // Efektywne uprawnienia dla konkretnego zasobu zawierają uprawnienia firmowe dla comp-a, a nie dla comp-b
    expect(getEffectivePermissions(companyUser, config, projectA)).toContain('finance.edit');
    expect(getEffectivePermissions(companyUser, config, projectB)).not.toContain('finance.edit');
  });

  it('filterStateForUser ukrywa permissionConfig i filtruje projekty, klientów i firmy zgodnie z uprawnieniami', () => {
    const config = createDefaultPermissionConfig();
    const state = {
      revision: 5,
      permissionConfig: config,
      variables: {
        clients: [{ id: 'c1', name: 'Inwestor 1' }],
      },
      companies: [
        { id: 'comp-a', name: 'Alfa', nip: '111', address: 'ul. A', vatPayer: true },
        { id: 'comp-b', name: 'Beta', nip: '222', address: 'ul. B', vatPayer: false },
      ],
      projects: [
        { id: 'p-a', key: 'A1', name: 'Alfa 1', companyId: 'comp-a', ownerId: 'other', memberIds: [], budget: '100' },
        { id: 'p-b', key: 'B1', name: 'Beta 1', companyId: 'comp-b', ownerId: 'other', memberIds: [], budget: '200' },
      ],
      tasks: [
        { id: 't-a', projectId: 'p-a', title: 'Task A' },
        { id: 't-b', projectId: 'p-b', title: 'Task B' },
      ],
      comments: [],
      activityLogs: [],
    };

    const compAUser = makeUser({ id: 'u-a', role: 'developer', companyIds: ['comp-a'] });
    const filteredA = filterStateForUser(state, compAUser);
    expect((filteredA as any).permissionConfig).toBeUndefined();
    expect(filteredA.projects.map((p: any) => p.id)).toEqual(['p-a']);
    expect(filteredA.projects[0].budget).toBe('100');
    expect(filteredA.tasks.map((t: any) => t.id)).toEqual(['t-a']);
    expect(filteredA.variables.clients).toBeUndefined(); // globalne finance.view / clients.edit wymagane dla bazy klientów

    const compsA = filterCompaniesForUser(state.companies, compAUser, state.projects, config);
    expect(compsA.find((c) => c.id === 'comp-a')?.vatPayer).toBe(true);
    expect(compsA.find((c) => c.id === 'comp-a')?.nip).toBeUndefined();
    expect(compsA.find((c) => c.id === 'comp-b')?.vatPayer).toBeUndefined();
    expect(compsA.find((c) => c.id === 'comp-b')?.nip).toBeUndefined();

    // Użytkownik z grantem clients.edit widzi variables.clients nawet bez finance.view
    const clientsEditor = makeUser({
      id: 'u-cli',
      role: 'developer',
      permissionGrants: ['clients.edit'],
    });
    const filteredCli = filterStateForUser(state, clientsEditor);
    expect(filteredCli.variables.clients).toHaveLength(1);

    // pickAllowedProjectFields / pickAllowedTaskFields honoruje globalne vs firmowe uprawnienia oraz wyłączenia
    const projFieldsA = pickAllowedProjectFields(
      { key: 'NEW', memberIds: ['u-a'], name: 'Zmiana', budget: '999', isArchived: true },
      compAUser,
      { project: state.projects[0], permissionConfig: config }
    );
    expect(projFieldsA.name).toBe('Zmiana');
    expect(projFieldsA.budget).toBe('999');
    expect('key' in projFieldsA).toBe(false); // klucz/memberIds tylko przy globalnym projects.edit
    expect('isArchived' in projFieldsA).toBe(false);

    const taskFieldsDenied = pickAllowedTaskFields(
      { projectId: 'p-b', title: 'T2' },
      makeUser({ id: 'pm2', role: 'project_manager', permissionDenials: ['tasks.edit'] }),
      { permissionConfig: config }
    );
    expect('projectId' in taskFieldsDenied).toBe(false);

    // filterProjectForUser dla admina nie mutuje ani nie ujawnia niepowiązanych danych, dla companyUser zostawia finanse comp-a
    expect(filterProjectForUser(state.projects[0], compAUser, config).budget).toBe('100');
    expect(canAccessProject(compAUser, state.projects[1], config)).toBe(false);
  });

  it('buildWeeklySummary respektuje reports.view z roli, grupy, grantu oraz denial', () => {
    const config: PermissionConfig = {
      ...createDefaultPermissionConfig(),
      permissionGroups: [
        { id: 'grp-rep', name: 'Raporty', description: '', permissions: ['reports.view'] },
      ],
    };
    const pmNoReport = makeUser({
      id: 'pm-no',
      role: 'project_manager',
      permissionDenials: ['reports.view'],
    });
    const devGroupReport = makeUser({
      id: 'dev-grp',
      role: 'developer',
      groupIds: ['grp-rep'],
    });
    const testerGrantReport = makeUser({
      id: 'tst-grant',
      role: 'tester',
      permissionGrants: ['reports.view'],
    });
    const adminUser = makeUser({ id: 'adm-1', role: 'admin' });

    const projects = [{ id: 'p1', key: 'P1', name: 'P1', status: 'active', isArchived: false } as any];
    const tasks = [
      { id: 't1', projectId: 'p1', title: 'T1', dueDate: '2026-11-26', status: 'in_progress', priority: 'normal', assigneeId: 'dev-grp', reporterId: 'adm-1', startDate: '2026-11-01', durationDays: 5, progress: 0 },
      { id: 't2', projectId: 'p1', title: 'T2', dueDate: '2026-11-26', status: 'in_progress', priority: 'normal', assigneeId: 'tst-grant', reporterId: 'adm-1', startDate: '2026-11-01', durationDays: 5, progress: 0 },
    ] as any[];

    const summaries = buildWeeklySummary(
      tasks,
      projects,
      [adminUser, pmNoReport, devGroupReport, testerGrantReport],
      Date.parse('2026-11-27T08:00:00.000Z'),
      {
        enabled: true,
        dayOfWeek: 5,
        time: '08:00',
        timezone: 'Europe/Warsaw',
        windowDays: 7,
        includeAdmins: true,
        maxItemsPerProject: 10,
      },
      undefined,
      config
    );

    const recipients = summaries.map((s) => s.user.id).sort();
    expect(recipients).toEqual(['adm-1', 'dev-grp', 'tst-grant']);
    expect(recipients).not.toContain('pm-no');
  });

  it('HTTP: natychmiastowy efekt grup/grantów/deniali bez ponownego logowania, zakres firmowy, SSE i ochrona ostatniego admina', async () => {
    const { baseUrl } = await createTestServer(cleanups);

    // 1. Setup admina
    const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Główny',
        email: 'admin@pracownia.pl',
        password: 'SuperPassword123!',
      }),
    });
    expect(setupRes.status).toBe(200);
    const adminCookie = extractSessionCookie(setupRes);
    const adminId = (await setupRes.json()).user.id;

    // 2. Dodaj 2 firmy: Alfa i Beta
    const compARes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa', letter: 'A', nip: '1111111111', isActive: true }),
    });
    expect(compARes.status).toBe(201);
    const compAId = (await compARes.json()).company.id;

    const compBRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Beta', letter: 'B', nip: '2222222222', isActive: true }),
    });
    expect(compBRes.status).toBe(201);
    const compBId = (await compBRes.json()).company.id;

    // 3. Utwórz użytkownika developer oraz project_manager
    const devCreateRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Dev Test',
        email: 'dev@pracownia.pl',
        role: 'developer',
        password: 'UserPassword123!',
      }),
    });
    expect(devCreateRes.status).toBe(200);
    const devId = (await devCreateRes.json()).user.id;

    const pmCreateRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'PM Test',
        email: 'pm@pracownia.pl',
        role: 'project_manager',
        password: 'UserPassword123!',
      }),
    });
    expect(pmCreateRes.status).toBe(200);
    const pmId = (await pmCreateRes.json()).user.id;

    const devLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@pracownia.pl', password: 'UserPassword123!' }),
    });
    const devCookie = extractSessionCookie(devLogin);

    const pmLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pm@pracownia.pl', password: 'UserPassword123!' }),
    });
    const pmCookie = extractSessionCookie(pmLogin);

    // Non-admin nie ma dostępu do /api/admin/permissions*
    expect((await fetch(`${baseUrl}/api/admin/permissions`, { headers: { Cookie: pmCookie } })).status).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: devCookie },
          body: JSON.stringify({ rolePermissions: { viewer: ['projects.view'] } }),
        })
      ).status
    ).toBe(403);

    // GET /api/state nigdy nie zwraca permissionConfig
    const initialStateBody = await (await fetch(`${baseUrl}/api/state`, { headers: { Cookie: adminCookie } })).json();
    expect(initialStateBody.state.permissionConfig).toBeUndefined();

    // Utwórz po projekcie w firmie Alfa i Beta (właściciel: admin)
    const prjARes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Projekt Alfa', companyId: compAId, budget: '10 000 PLN', ownerId: adminId }),
    });
    expect(prjARes.status).toBe(201);
    const prjA = (await prjARes.json()).project;

    const prjBRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Projekt Beta', companyId: compBId, budget: '20 000 PLN', ownerId: adminId }),
    });
    expect(prjBRes.status).toBe(201);
    const prjB = (await prjBRes.json()).project;

    // Utwórz 2 przetargi: dla Alfa (isOurs) i dla Beta (isOurs)
    const tenderARes = await fetch(`${baseUrl}/api/tenders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Przetarg Alfa',
        contractingAuthority: 'GDDKiA',
        submissionDeadline: '2026-10-01',
        resolutionDate: '2026-10-15',
        status: 'announced',
        bidders: [{ name: 'Alfa', companyId: compAId, isOurs: true, price: 100000 }],
      }),
    });
    expect(tenderARes.status).toBe(201);
    const tenderA = (await tenderARes.json()).tender;

    const tenderBRes = await fetch(`${baseUrl}/api/tenders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Przetarg Beta',
        contractingAuthority: 'ZDW',
        submissionDeadline: '2026-10-02',
        resolutionDate: '2026-10-16',
        status: 'announced',
        bidders: [{ name: 'Beta', companyId: compBId, isOurs: true, price: 200000 }],
      }),
    });
    expect(tenderBRes.status).toBe(201);
    const tenderB = (await tenderBRes.json()).tender;

    // Przed nadaniem: dev NIE może zobaczyć przetargów ani edytować Projektu Alfa
    expect((await fetch(`${baseUrl}/api/tenders`, { headers: { Cookie: devCookie } })).status).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/projects/${prjA.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: devCookie },
          body: JSON.stringify({ description: 'Nie powinno się udać' }),
        })
      ).status
    ).toBe(403);

    // Połącz SSE dla dewelopera i nasłuchuj zdarzenia permissions
    const sseAbort = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/events`, {
      headers: { Cookie: devCookie },
      signal: sseAbort.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    const readUntilContains = async (needle: string, timeoutMs = 2500): Promise<string> => {
      const deadline = Date.now() + timeoutMs;
      while (!sseBuffer.includes(needle)) {
        if (Date.now() > deadline) {
          throw new Error(`Timeout waiting for SSE event "${needle}". Got:\n${sseBuffer}`);
        }
        const chunkPromise = reader.read();
        const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
          setTimeout(() => resolve({ done: false, value: undefined }), Math.max(20, deadline - Date.now()))
        );
        const { value } = await Promise.race([chunkPromise, timeoutPromise]);
        if (value) sseBuffer += decoder.decode(value, { stream: true });
      }
      return sseBuffer;
    };
    await readUntilContains('event: revision');

    // Utwórz grupę dającą templates.manage i przypisz dewelopera do grupy + firmy Alfa + grantu clients.edit
    const grpRes = await fetch(`${baseUrl}/api/admin/permission-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Szablony',
        description: 'Zarządzanie szablonami',
        permissions: ['templates.manage'],
      }),
    });
    expect(grpRes.status).toBe(201);
    const groupId = (await grpRes.json()).group.id;

    const accessRes = await fetch(`${baseUrl}/api/admin/users/${devId}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        groupIds: [groupId],
        companyIds: [compAId],
        permissionGrants: ['clients.edit'],
      }),
    });
    expect(accessRes.status).toBe(200);

    // Deweloper otrzymał event: permissions w aktywnym SSE bez relogowania
    await readUntilContains('event: permissions');
    sseAbort.abort();

    // /api/auth/me zwraca zaktualizowane companyIds, effectivePermissions i companyMemberPermissions natychmiast
    const devMe = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: devCookie } })).json();
    expect(devMe.companyIds).toEqual([compAId]);
    expect(devMe.effectivePermissions).toContain('templates.manage');
    expect(devMe.effectivePermissions).toContain('clients.edit');
    expect(devMe.user.effectivePermissions).toContain('templates.manage');
    expect(Array.isArray(devMe.companyMemberPermissions)).toBe(true);
    expect(devMe.companyMemberPermissions).toContain('projects.edit');

    // Deweloper może teraz tworzyć szablony dzięki grupie (bez ponownego logowania)
    const tplCreate = await fetch(`${baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ name: 'Szablon z grupy' }),
    });
    expect(tplCreate.status).toBe(201);

    // Deweloper widzi w /api/state wyłącznie Projekt Alfa oraz ma dostęp do edycji i finansów Projektu Alfa
    const devStateBody = await (await fetch(`${baseUrl}/api/state`, { headers: { Cookie: devCookie } })).json();
    expect(devStateBody.state.projects.map((p: any) => p.id)).toEqual([prjA.id]);
    expect(devStateBody.state.variables.clients).toBeDefined(); // przez grant clients.edit

    const patchA = await fetch(`${baseUrl}/api/projects/${prjA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ description: 'Edycja z firmy Alfa', budget: '15 000 PLN' }),
    });
    expect(patchA.status).toBe(200);

    const patchB = await fetch(`${baseUrl}/api/projects/${prjB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ description: 'Nie powinno działać dla Bety' }),
    });
    expect(patchB.status).toBe(403);

    // Deweloper widzi w /api/tenders wyłącznie przetarg Alfa, a przetarg Beta zwraca 403
    const devTendersRes = await fetch(`${baseUrl}/api/tenders`, { headers: { Cookie: devCookie } });
    expect(devTendersRes.status).toBe(200);
    const devTendersJson = await devTendersRes.json();
    expect(devTendersJson.items.map((t: any) => t.id)).toEqual([tenderA.id]);
    expect((await fetch(`${baseUrl}/api/tenders/${tenderB.id}`, { headers: { Cookie: devCookie } })).status).toBe(403);

    // Wyłączenie indywidualne (denial) na PM blokuje akcję natychmiast (nawet na dotychczas dozwolonej operacji)
    const denyPm = await fetch(`${baseUrl}/api/admin/users/${pmId}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        permissionDenials: ['projects.edit', 'tenders.edit'],
      }),
    });
    expect(denyPm.status).toBe(200);

    expect(
      (
        await fetch(`${baseUrl}/api/projects/${prjA.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: pmCookie },
          body: JSON.stringify({ description: 'Zablokowane wyłączeniem' }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/tenders/${tenderA.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: pmCookie },
          body: JSON.stringify({ name: 'Zablokowany przetarg' }),
        })
      ).status
    ).toBe(403);

    // POST /api/state nie może nadpisać ani wyczyścić permissionConfig
    const saveStateRes = await fetch(`${baseUrl}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        permissionConfig: {
          rolePermissions: {
            admin: [],
            project_manager: [],
            developer: [],
            tester: [],
            viewer: [],
          },
          permissionGroups: [],
          companyMemberPermissions: [],
        },
        projects: [prjA, prjB],
        tasks: [],
      }),
    });
    expect(saveStateRes.status).toBe(200);
    const permAfterPostState = await (
      await fetch(`${baseUrl}/api/admin/permissions`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(permAfterPostState.permissionConfig.permissionGroups.some((g: any) => g.id === groupId)).toBe(true);

    // Potwierdzenie hasła wymagane przy zapisie uprawnień ról (400 brak hasła, 401 błędne hasło)
    const missingPwAttempt = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ rolePermissions: { viewer: ['projects.view'] } }),
    });
    expect(missingPwAttempt.status).toBe(400);

    const wrongPwAttempt = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        rolePermissions: { viewer: ['projects.view'] },
        currentPassword: 'WrongPassword999!',
      }),
    });
    expect(wrongPwAttempt.status).toBe(401);

    // Ochrona ostatniego administratora (409) oraz nieedytowalność roli admin (400)
    const adminEditAttempt = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        rolePermissions: { admin: ['projects.view'] },
        currentPassword: 'SuperPassword123!',
      }),
    });
    expect(adminEditAttempt.status).toBe(400);

    const demoteLastAdmin = await fetch(`${baseUrl}/api/admin/users/${adminId}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ role: 'project_manager' }),
    });
    expect(demoteLastAdmin.status).toBe(409);

    const deleteLastAdmin = await fetch(`${baseUrl}/api/users/${adminId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(deleteLastAdmin.status).toBe(409);

    // Walidacje wejścia: nieznane uprawnienie, nieznana grupa/firma, duplikat nazwy grupy, CSRF Origin
    expect(
      (
        await fetch(`${baseUrl}/api/admin/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            rolePermissions: { developer: ['unknown.perm'] },
            currentPassword: 'SuperPassword123!',
          }),
        })
      ).status
    ).toBe(400);

    expect(
      (
        await fetch(`${baseUrl}/api/admin/users/${devId}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ groupIds: ['grp-missing'] }),
        })
      ).status
    ).toBe(400);

    expect(
      (
        await fetch(`${baseUrl}/api/admin/users/${devId}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ companyIds: ['comp-missing'] }),
        })
      ).status
    ).toBe(400);

    expect(
      (
        await fetch(`${baseUrl}/api/admin/permission-groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'szablony', permissions: [] }),
        })
      ).status
    ).toBe(409);

    expect(
      (
        await fetch(`${baseUrl}/api/admin/permissions`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: adminCookie,
            Origin: 'https://evil.example.com',
          },
          body: JSON.stringify({
            rolePermissions: { viewer: [] },
            currentPassword: 'SuperPassword123!',
          }),
        })
      ).status
    ).toBe(403);

    // Usunięcie grupy czyści user.groupIds u użytkowników
    const delGrpRes = await fetch(`${baseUrl}/api/admin/permission-groups/${groupId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delGrpRes.status).toBe(200);
    const devMeAfterDelGrp = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: devCookie } })).json();
    expect(devMeAfterDelGrp.effectivePermissions).not.toContain('templates.manage');

    // Dziennik bezpieczeństwa zawiera wpisy permission_changed
    const secEventsRes = await fetch(`${baseUrl}/api/security/events?type=permission_changed`, {
      headers: { Cookie: adminCookie },
    });
    expect(secEventsRes.status).toBe(200);
    const secEvents = await secEventsRes.json();
    expect(secEvents.events.length).toBeGreaterThanOrEqual(4);
  });

  it('HTTP: limit maksymalnie 50 grup uprawnień zwraca 400 przy 51. grupie', async () => {
    const { baseUrl } = await createTestServer(cleanups);

    const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Limit',
        email: 'admin-limit@pracownia.pl',
        password: 'SuperPassword123!',
      }),
    });
    const adminCookie = extractSessionCookie(setupRes);

    for (let i = 1; i <= 50; i++) {
      const res = await fetch(`${baseUrl}/api/admin/permission-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: `Grupa ${i}`, permissions: ['projects.view'] }),
      });
      expect(res.status).toBe(201);
    }

    const overflowRes = await fetch(`${baseUrl}/api/admin/permission-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Grupa 51', permissions: ['projects.view'] }),
    });
    expect(overflowRes.status).toBe(400);
  });
});
