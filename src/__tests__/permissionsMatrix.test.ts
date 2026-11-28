import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp, CreateAppResult } from '../server/app.js';
import {
  canAccessProject,
  canEditFinance,
  canViewFinance,
  canWrite,
  filterCompaniesForUser,
  filterProjectForUser,
  filterStateForUser,
  pickAllowedProjectFields,
  pickAllowedTaskFields,
} from '../utils/access.js';
import { canRestoreTrashEntry, canSeeTrashEntry, listTrashForUser } from '../server/trash.js';
import { buildWeeklySummary } from '../utils/weeklySummary.js';
import { buildDigests } from '../utils/reminders.js';

const ALL_ROLES = ['admin', 'project_manager', 'developer', 'tester', 'viewer'] as const;

function makeUser(role: (typeof ALL_ROLES)[number], id?: string) {
  return {
    id: id || `usr-${role}`,
    name: `User ${role}`,
    email: `${role}@pracownia.pl`,
    role,
    department: 'Pracownia',
    initials: role.slice(0, 2).toUpperCase(),
    isApproved: true,
    emailReminders: true,
    weeklySummary: true,
  };
}

describe('P79 Charakterystyka obecnego zachowania: macierz rola × operacja', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it('macierz funkcji access.ts dla wszystkich 5 ról (admin, project_manager, developer, tester, viewer)', () => {
    const foreignOwnedProject = {
      id: 'prj-foreign-owned',
      key: 'FO',
      name: 'Projekt cudzy z właścicielem',
      companyId: 'comp-a',
      ownerId: 'usr-other',
      memberIds: ['usr-other'],
      budget: '100 000 PLN',
      projectValue: 100000,
      clientName: 'Klient X',
    };
    const foreignUnownedProject = {
      id: 'prj-foreign-unowned',
      key: 'FU',
      name: 'Projekt cudzy bez właściciela',
      companyId: 'comp-a',
      memberIds: [],
      budget: '50 000 PLN',
    };

    const matrix = ALL_ROLES.map((role) => {
      const user = makeUser(role);
      const memberProject = {
        id: 'prj-member',
        key: 'MEM',
        name: 'Projekt członkowski',
        companyId: 'comp-a',
        ownerId: 'usr-other',
        memberIds: [user.id],
        budget: '80 000 PLN',
        clientName: 'Klient Member',
      };
      const ownedProject = {
        id: 'prj-owned',
        key: 'OWN',
        name: 'Projekt własny',
        companyId: 'comp-a',
        ownerId: user.id,
        memberIds: [user.id],
        budget: '120 000 PLN',
        clientName: 'Klient Own',
      };

      return {
        role,
        canWrite: canWrite(user),
        accessForeign: canAccessProject(user, foreignOwnedProject),
        accessMember: canAccessProject(user, memberProject),
        accessOwned: canAccessProject(user, ownedProject),
        viewFinForeign: canViewFinance(user, foreignOwnedProject),
        viewFinMember: canViewFinance(user, memberProject),
        viewFinOwned: canViewFinance(user, ownedProject),
        editFinForeignOwned: canEditFinance(user, foreignOwnedProject),
        editFinForeignUnowned: canEditFinance(user, foreignUnownedProject),
        editFinOwned: canEditFinance(user, ownedProject),
        pickTaskProjectId: 'projectId' in pickAllowedTaskFields({ projectId: 'p2', title: 'T' }, user),
        pickProjKey: 'key' in pickAllowedProjectFields({ key: 'X2', name: 'N' }, user),
        pickProjArchive: 'isArchived' in pickAllowedProjectFields({ isArchived: true }, user),
      };
    });

    expect(matrix).toEqual([
      {
        role: 'admin',
        canWrite: true,
        accessForeign: true,
        accessMember: true,
        accessOwned: true,
        viewFinForeign: true,
        viewFinMember: true,
        viewFinOwned: true,
        editFinForeignOwned: true,
        editFinForeignUnowned: true,
        editFinOwned: true,
        pickTaskProjectId: true,
        pickProjKey: true,
        pickProjArchive: true,
      },
      {
        role: 'project_manager',
        canWrite: true,
        accessForeign: true,
        accessMember: true,
        accessOwned: true,
        viewFinForeign: true,
        viewFinMember: true,
        viewFinOwned: true,
        editFinForeignOwned: false,
        editFinForeignUnowned: true,
        editFinOwned: true,
        pickTaskProjectId: true,
        pickProjKey: true,
        pickProjArchive: true,
      },
      {
        role: 'developer',
        canWrite: true,
        accessForeign: false,
        accessMember: true,
        accessOwned: true,
        viewFinForeign: false,
        viewFinMember: false,
        viewFinOwned: true,
        editFinForeignOwned: false,
        editFinForeignUnowned: false,
        editFinOwned: true,
        pickTaskProjectId: false,
        pickProjKey: false,
        pickProjArchive: false,
      },
      {
        role: 'tester',
        canWrite: true,
        accessForeign: false,
        accessMember: true,
        accessOwned: true,
        viewFinForeign: false,
        viewFinMember: false,
        viewFinOwned: true,
        editFinForeignOwned: false,
        editFinForeignUnowned: false,
        editFinOwned: true,
        pickTaskProjectId: false,
        pickProjKey: false,
        pickProjArchive: false,
      },
      {
        role: 'viewer',
        canWrite: false,
        accessForeign: false,
        accessMember: true,
        accessOwned: true,
        viewFinForeign: false,
        viewFinMember: false,
        viewFinOwned: false,
        editFinForeignOwned: false,
        editFinForeignUnowned: false,
        editFinOwned: false,
        pickTaskProjectId: false,
        pickProjKey: false,
        pickProjArchive: false,
      },
    ]);
  });

  it('macierz filterStateForUser i filterCompaniesForUser dla wszystkich 5 ról', () => {
    const devUser = makeUser('developer');
    const state = {
      revision: 3,
      variables: {
        clients: [{ id: 'cli-1', name: 'Klient 1' }],
        vatRates: [{ id: 'v23', label: '23%', value: 23, rate: 23 }],
      },
      companies: [
        { id: 'comp-a', name: 'Alfa', letter: 'A', nip: '111', address: 'Adres A', isActive: true, vatPayer: true },
      ],
      projects: [
        {
          id: 'prj-1',
          key: 'P1',
          name: 'Projekt 1',
          companyId: 'comp-a',
          ownerId: devUser.id,
          memberIds: [devUser.id],
          budget: '100',
          clientName: 'Klient 1',
        },
        {
          id: 'prj-2',
          key: 'P2',
          name: 'Projekt 2',
          companyId: 'comp-a',
          ownerId: 'usr-admin',
          memberIds: ['usr-admin'],
          budget: '200',
          clientName: 'Klient 2',
        },
      ],
      tasks: [
        { id: 't-1', projectId: 'prj-1', title: 'T1', assigneeId: devUser.id, reporterId: 'usr-admin' },
        { id: 't-2', projectId: 'prj-2', title: 'T2', assigneeId: 'usr-admin', reporterId: 'usr-admin' },
      ],
      comments: [
        { id: 'c-1', taskId: 't-1', userId: devUser.id, content: 'C1' },
        { id: 'c-2', taskId: 't-2', userId: 'usr-admin', content: 'C2' },
      ],
      activityLogs: [
        { id: 'a-1', projectId: 'prj-1', taskId: 't-1', userId: devUser.id, action: 'A1' },
        { id: 'a-2', projectId: 'prj-2', taskId: 't-2', userId: 'usr-admin', action: 'A2' },
      ],
    };

    for (const role of ALL_ROLES) {
      const user = makeUser(role);
      const filtered = filterStateForUser(state, user);
      const companies = filterCompaniesForUser(state.companies, user, state.projects);
      const proj1 = filterProjectForUser(state.projects[0], user);

      if (role === 'admin' || role === 'project_manager') {
        expect(filtered.projects).toHaveLength(2);
        expect(filtered.tasks).toHaveLength(2);
        expect(filtered.variables.clients).toHaveLength(1);
        expect(companies[0].nip).toBe('111');
        expect(companies[0].address).toBe('Adres A');
      } else if (role === 'developer') {
        expect(filtered.projects).toHaveLength(1);
        expect(filtered.projects[0].budget).toBe('100'); // ownerId === devUser.id
        expect(filtered.tasks).toHaveLength(1);
        expect(filtered.variables.clients).toBeUndefined();
        expect(companies[0].nip).toBeUndefined();
        expect(companies[0].vatPayer).toBe(true); // owner of prj-1 in comp-a
        expect(proj1.budget).toBe('100');
      } else {
        expect(filtered.projects).toHaveLength(0);
        expect(filtered.tasks).toHaveLength(0);
        expect(filtered.variables.clients).toBeUndefined();
        expect(companies[0].nip).toBeUndefined();
        expect(companies[0].vatPayer).toBeUndefined();
      }
    }
  });

  it('macierz kosza (canSeeTrashEntry, canRestoreTrashEntry, listTrashForUser) i powiadomień e-mail', () => {
    const appState = {
      projects: [
        { id: 'prj-1', key: 'P1', name: 'P1', memberIds: ['usr-developer', 'usr-tester', 'usr-viewer'] },
      ],
      trash: [
        {
          id: 'tr-1',
          type: 'task' as const,
          projectId: 'prj-1',
          title: 'Usunięte zadanie',
          code: 'P1-01',
          deletedAt: '2026-11-01T10:00:00.000Z',
          expiresAt: '2026-12-01T10:00:00.000Z',
          deletedBy: 'usr-developer',
          deletedByName: 'Dev',
          payload: {
            task: { id: 't-1', projectId: 'prj-1', title: 'Usunięte zadanie', assigneeId: 'usr-developer', reporterId: 'usr-admin' },
            comments: [],
          },
        },
      ],
    };

    const trashMatrix = ALL_ROLES.map((role) => {
      const user = makeUser(role);
      const list = listTrashForUser(appState, user, Date.parse('2026-11-10T10:00:00.000Z'));
      return {
        role,
        see: canSeeTrashEntry(appState, appState.trash[0] as any, user),
        restore: canRestoreTrashEntry(appState, appState.trash[0] as any, user),
        canPurge: list[0]?.canPurge ?? false,
      };
    });

    expect(trashMatrix).toEqual([
      { role: 'admin', see: true, restore: true, canPurge: true },
      { role: 'project_manager', see: true, restore: true, canPurge: true },
      { role: 'developer', see: true, restore: true, canPurge: false },
      { role: 'tester', see: false, restore: false, canPurge: false },
      { role: 'viewer', see: false, restore: false, canPurge: false },
    ]);

    const users = ALL_ROLES.map((r) => makeUser(r));
    const projects = [{ id: 'prj-1', key: 'P1', name: 'P1', status: 'active', dueDate: '2026-12-01', isArchived: false } as any];
    const tasks = users.map((u, idx) => ({
      id: `t-${idx}`,
      projectId: 'prj-1',
      title: `Zadanie ${u.role}`,
      dueDate: '2026-11-26',
      status: 'in_progress',
      priority: 'normal',
      assigneeId: u.id,
      reporterId: 'usr-admin',
      startDate: '2026-11-01',
      durationDays: 5,
      progress: 0,
    })) as any[];

    const weekly = buildWeeklySummary(
      tasks,
      projects,
      users as any,
      Date.parse('2026-11-27T08:00:00.000Z'),
      {
        enabled: true,
        dayOfWeek: 5,
        time: '08:00',
        timezone: 'Europe/Warsaw',
        windowDays: 7,
        includeAdmins: true,
        maxItemsPerProject: 10,
      }
    );
    expect(weekly.map((w) => w.user.role).sort()).toEqual(['admin', 'project_manager']);

    const digests = buildDigests(
      tasks,
      projects,
      users as any,
      Date.parse('2026-11-27T08:00:00.000Z'),
      {
        enabled: true,
        sendHour: 8,
        timezone: 'Europe/Warsaw',
        daysBefore: [0, 1, 3],
        notifyOverdue: true,
        appBaseUrl: '',
      }
    );
    expect(digests).toHaveLength(5);
  });

  it('macierz endpointów HTTP dla wszystkich 5 ról', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-matrix-'));
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

    const extractCookie = (res: Response): string => {
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
    };

    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await created.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Matrix',
        email: 'admin@pracownia.pl',
        password: 'SuperPassword123!',
      }),
    });
    expect(setupRes.status).toBe(200);
    const adminCookie = extractCookie(setupRes);

    const cookies: Record<string, string> = { admin: adminCookie };
    const userIds: Record<string, string> = { admin: (await setupRes.json()).user.id };

    for (const role of ['project_manager', 'developer', 'tester', 'viewer'] as const) {
      const email = `${role}@pracownia.pl`;
      const password = 'UserPassword123!';
      const createRes = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: `U ${role}`, email, role, password }),
      });
      expect(createRes.status).toBe(200);
      userIds[role] = (await createRes.json()).user.id;

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      expect(loginRes.status).toBe(200);
      cookies[role] = extractCookie(loginRes);
    }

    // Utwórz projekt należący do admina (cudzy dla reszty)
    const prjRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Bazowy Admina',
        ownerId: userIds.admin,
        budget: '100 000 PLN',
      }),
    });
    expect(prjRes.status).toBe(201);
    const baseProject = (await prjRes.json()).project;

    const results: Array<{
      role: string;
      createProj: number;
      patchForeignProj: number;
      patchForeignFin: number;
      deleteForeignProj: number;
      createTaskInForeignProj: number;
      tendersGet: number;
      tendersPost: number;
      templatesGet: number;
      templatesPost: number;
      companiesPost: number;
      trashEmpty: number;
    }> = [];

    for (const role of ALL_ROLES) {
      const c = cookies[role];
      const cp = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({ name: `Projekt ${role}` }),
      });
      const createdProjBody = cp.status === 201 ? await cp.json() : null;
      const pf = await fetch(`${baseUrl}/api/projects/${baseProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({ description: `Edit ${role}` }),
      });
      const pfin = await fetch(`${baseUrl}/api/projects/${baseProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({ budget: '999 PLN' }),
      });
      const dfp = await fetch(`${baseUrl}/api/projects/${createdProjBody?.project?.id || baseProject.id}`, {
        method: 'DELETE',
        headers: { Cookie: c },
      });
      const ctfp = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({ title: `T ${role}`, projectId: baseProject.id }),
      });
      const tg = await fetch(`${baseUrl}/api/tenders`, { headers: { Cookie: c } });
      const tp = await fetch(`${baseUrl}/api/tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({}),
      });
      const tlg = await fetch(`${baseUrl}/api/templates`, { headers: { Cookie: c } });
      const tlp = await fetch(`${baseUrl}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({}),
      });
      const compP = await fetch(`${baseUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({}),
      });
      const trE = await fetch(`${baseUrl}/api/trash`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: c },
        body: JSON.stringify({ confirm: true }),
      });

      results.push({
        role,
        createProj: cp.status,
        patchForeignProj: pf.status,
        patchForeignFin: pfin.status,
        deleteForeignProj: dfp.status,
        createTaskInForeignProj: ctfp.status,
        tendersGet: tg.status,
        tendersPost: tp.status,
        templatesGet: tlg.status,
        templatesPost: tlp.status,
        companiesPost: compP.status,
        trashEmpty: trE.status,
      });
    }

    expect(results).toEqual([
      {
        role: 'admin',
        createProj: 201,
        patchForeignProj: 200,
        patchForeignFin: 200,
        deleteForeignProj: 200,
        createTaskInForeignProj: 201,
        tendersGet: 200,
        tendersPost: 400, // przeszło autoryzację (400 walidacja pustego body)
        templatesGet: 200,
        templatesPost: 400, // przeszło autoryzację
        companiesPost: 400, // przeszło autoryzację
        trashEmpty: 200,
      },
      {
        role: 'project_manager',
        createProj: 201,
        patchForeignProj: 200,
        patchForeignFin: 403, // właścicielem jest admin
        deleteForeignProj: 200,
        createTaskInForeignProj: 201,
        tendersGet: 200,
        tendersPost: 400, // przeszło autoryzację
        templatesGet: 200,
        templatesPost: 403,
        companiesPost: 403,
        trashEmpty: 403,
      },
      {
        role: 'developer',
        createProj: 201,
        patchForeignProj: 403,
        patchForeignFin: 403,
        deleteForeignProj: 403,
        createTaskInForeignProj: 403,
        tendersGet: 403,
        tendersPost: 403,
        templatesGet: 200,
        templatesPost: 403,
        companiesPost: 403,
        trashEmpty: 403,
      },
      {
        role: 'tester',
        createProj: 201,
        patchForeignProj: 403,
        patchForeignFin: 403,
        deleteForeignProj: 403,
        createTaskInForeignProj: 403,
        tendersGet: 403,
        tendersPost: 403,
        templatesGet: 200,
        templatesPost: 403,
        companiesPost: 403,
        trashEmpty: 403,
      },
      {
        role: 'viewer',
        createProj: 403,
        patchForeignProj: 403,
        patchForeignFin: 403,
        deleteForeignProj: 403,
        createTaskInForeignProj: 403,
        tendersGet: 403,
        tendersPost: 403,
        templatesGet: 403,
        templatesPost: 403,
        companiesPost: 403,
        trashEmpty: 403,
      },
    ]);
  });
});
