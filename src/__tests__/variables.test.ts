import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import { filterStateForUser } from '../utils/access.js';
import { normalizeStateStructure } from '../utils/stateStore.js';
import {
  DEFAULT_CLIENTS,
  DEFAULT_DEADLINE_WARNING_DAYS,
  DEFAULT_PROJECT_DEADLINE_SETTINGS,
  DEFAULT_PROJECT_PRIORITIES,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_TASK_TYPES,
  DEFAULT_VAT_RATES,
} from '../utils/variablesSchema.js';
import {
  clearLegacyLocalVariables,
  clearOphStorageOnLogout,
  getClients,
  getDeadlineWarningDays,
  getProjectDeadlineSettings,
  getTaskTypes,
  getVatRates,
  hasLegacyLocalVariables,
  readLegacyLocalVariables,
  resetServerVariables,
  setServerVariables,
} from '../utils/variableSettings.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Księżyc-Wiosna-2026!';
const USER_PASS = 'Jesień-Kwiaty-2026!';

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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-variables-'));
  const shouldCleanupDir = !overrides.dataDir;
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    setupToken: '',
    googleSyncDisableTimers: true,
    backupWatchDisableTimers: true,
    diskWatchDisableTimers: true,
    remindersDisableTimers: true,
    weeklySummaryDisableTimers: true,
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

async function setupAdmin(baseUrl: string, email = 'admin@pracownia.pl') {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Główny Administrator',
      email,
      password: ADMIN_PASS,
    }),
  });
  expect(res.status).toBe(200);
  return { cookie: extractSessionCookie(res), data: await res.json() };
}

async function createAndLoginUser(
  baseUrl: string,
  adminCookie: string,
  email: string,
  role: 'project_manager' | 'developer' | 'viewer'
): Promise<string> {
  const createRes = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      name: `User ${role}`,
      email,
      password: USER_PASS,
      role,
      department: 'Architektura',
    }),
  });
  expect(createRes.status).toBe(200);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: USER_PASS }),
  });
  expect(loginRes.status).toBe(200);
  return extractSessionCookie(loginRes);
}

describe('P54: Zmienne systemowe na serwerze, RBAC, walidacja, migracja i czyszczenie przy wylogowaniu', () => {
  let ctx: TestServerContext | null = null;

  afterEach(async () => {
    resetServerVariables();
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
  });

  it('ensureStateStructure (normalizeStateStructure) uzupełnia domyślne pole variables dla starszego stanu app_state.json', () => {
    const legacyState = normalizeStateStructure({
      initialized: true,
      revision: 5,
      projects: [],
      tasks: [],
      users: [],
      comments: [],
      activityLogs: [],
    });

    expect(legacyState.variables).toBeDefined();
    expect(legacyState.variables?.initialized).toBe(false);
    expect(legacyState.variables?.deadlineWarningDays).toBe(DEFAULT_DEADLINE_WARNING_DAYS);
    expect(legacyState.variables?.vatRates).toEqual(DEFAULT_VAT_RATES);
    expect(legacyState.variables?.clients).toEqual(DEFAULT_CLIENTS);
    expect(legacyState.variables?.taskTypes).toEqual(DEFAULT_TASK_TYPES);
    expect(legacyState.variables?.projectStatuses).toEqual(DEFAULT_PROJECT_STATUSES);
    expect(legacyState.variables?.projectPriorities).toEqual(DEFAULT_PROJECT_PRIORITIES);
    expect(legacyState.variables?.projectDeadline).toEqual(DEFAULT_PROJECT_DEADLINE_SETTINGS);
  });

  it('filterStateForUser ukrywa listę klientów dla ról innych niż admin i project_manager oraz usuwa variables dla niezalogowanych', () => {
    const baseState = normalizeStateStructure({
      revision: 1,
      projects: [],
      tasks: [],
      users: [],
      comments: [],
      activityLogs: [],
    });

    const unauth = filterStateForUser(baseState, null);
    expect(unauth.variables).toBeUndefined();

    const adminFiltered = filterStateForUser(baseState, { id: 'u1', role: 'admin' });
    expect(adminFiltered.variables.clients).toHaveLength(DEFAULT_CLIENTS.length);
    expect(adminFiltered.variables.vatRates).toHaveLength(DEFAULT_VAT_RATES.length);
    expect(adminFiltered.variables.taskTypes).toHaveLength(DEFAULT_TASK_TYPES.length);
    expect(adminFiltered.variables.projectStatuses).toHaveLength(DEFAULT_PROJECT_STATUSES.length);
    expect(adminFiltered.variables.projectPriorities).toHaveLength(DEFAULT_PROJECT_PRIORITIES.length);
    expect(adminFiltered.variables.deadlineWarningDays).toBe(3);

    const pmFiltered = filterStateForUser(baseState, { id: 'u2', role: 'project_manager' });
    expect(pmFiltered.variables.clients).toHaveLength(DEFAULT_CLIENTS.length);
    expect(pmFiltered.variables.vatRates).toHaveLength(DEFAULT_VAT_RATES.length);
    expect(pmFiltered.variables.projectStatuses).toHaveLength(DEFAULT_PROJECT_STATUSES.length);

    const devFiltered = filterStateForUser(baseState, { id: 'u3', role: 'developer' });
    expect(devFiltered.variables).toBeDefined();
    expect('clients' in devFiltered.variables).toBe(false);
    expect(devFiltered.variables.clients).toBeUndefined();
    expect(devFiltered.variables.vatRates).toHaveLength(DEFAULT_VAT_RATES.length);
    expect(devFiltered.variables.taskTypes).toHaveLength(DEFAULT_TASK_TYPES.length);
    expect(devFiltered.variables.projectStatuses).toHaveLength(DEFAULT_PROJECT_STATUSES.length);
    expect(devFiltered.variables.projectPriorities).toHaveLength(DEFAULT_PROJECT_PRIORITIES.length);
    expect(devFiltered.variables.deadlineWarningDays).toBe(3);

    const viewerFiltered = filterStateForUser(baseState, { id: 'u4', role: 'viewer' });
    expect('clients' in viewerFiltered.variables).toBe(false);
    expect(viewerFiltered.variables.vatRates).toHaveLength(DEFAULT_VAT_RATES.length);
    expect(viewerFiltered.variables.projectStatuses).toHaveLength(DEFAULT_PROJECT_STATUSES.length);
  });

  it('GET /api/state i PUT /api/admin/variables egzekwują RBAC, kontrolę Origin oraz zachowują variables przy POST /api/state', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const pmCookie = await createAndLoginUser(ctx.baseUrl, adminCookie, 'pm@pracownia.pl', 'project_manager');
    const devCookie = await createAndLoginUser(ctx.baseUrl, adminCookie, 'dev@pracownia.pl', 'developer');

    // Niezalogowany -> 401
    const unauthPut = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadlineWarningDays: 5 }),
    });
    expect(unauthPut.status).toBe(401);

    // PM i developer -> 403 przy próbie zapisu
    for (const cookie of [pmCookie, devCookie]) {
      const forbiddenPut = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deadlineWarningDays: 5 }),
      });
      expect(forbiddenPut.status).toBe(403);
    }

    // Obcy Origin -> 403
    const badOriginPut = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ deadlineWarningDays: 5 }),
    });
    expect(badOriginPut.status).toBe(403);

    // Zapis przez admina ustawia initialized = true, zwiększa rewizję i loguje variables_changed bez wartości
    const secretClientName = 'Tajny Inwestor Sp. z o.o.';
    const stateBefore = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })
    ).json();
    const revBefore = stateBefore.state.revision;
    expect(stateBefore.state.variables.initialized).toBe(false);

    const okPut = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        deadlineWarningDays: 7,
        clients: [
          {
            id: 'cli-tajny',
            name: secretClientName,
            nip: '1234567890',
            createdAt: '2026-11-18T10:00:00Z',
          },
        ],
      }),
    });
    expect(okPut.status).toBe(200);
    const okData = await okPut.json();
    expect(okData.revision).toBe(revBefore + 1);
    expect(okData.variables.initialized).toBe(true);
    expect(okData.variables.deadlineWarningDays).toBe(7);
    expect(okData.changedSections).toEqual(['clients', 'deadlineWarningDays']);

    // GET /api/state: PM widzi clients, developer nie widzi clients
    const pmState = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: pmCookie } })
    ).json();
    expect(pmState.state.variables.clients).toHaveLength(1);
    expect(pmState.state.variables.clients[0].name).toBe(secretClientName);

    const devState = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: devCookie } })
    ).json();
    expect(devState.state.variables.clients).toBeUndefined();
    expect(devState.state.variables.deadlineWarningDays).toBe(7);
    expect(devState.state.variables.vatRates).toHaveLength(DEFAULT_VAT_RATES.length);

    // Dziennik bezpieczeństwa zawiera variables_changed wyłącznie z nazwami sekcji (bez PII)
    const secEventsRes = await fetch(`${ctx.baseUrl}/api/security/events?type=variables_changed`, {
      headers: { Cookie: adminCookie },
    });
    const secEventsData = await secEventsRes.json();
    expect(secEventsData.events).toHaveLength(1);
    expect(secEventsData.events[0].details).toEqual({
      sections: ['clients', 'deadlineWarningDays'],
    });
    const rawSecLog = fs.readFileSync(path.join(ctx.dataDir, 'security_log.jsonl'), 'utf-8');
    expect(rawSecLog).not.toContain(secretClientName);
    expect(rawSecLog).not.toContain('1234567890');

    // Import stanu POST /api/state zachowuje variables na serwerze
    const importRes = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projects: [],
        tasks: [],
        variables: {
          vatRates: [],
          clients: [],
          taskTypes: [],
          deadlineWarningDays: 1,
          initialized: false,
        },
      }),
    });
    expect(importRes.status).toBe(200);

    const stateAfterImport = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(stateAfterImport.state.variables.initialized).toBe(true);
    expect(stateAfterImport.state.variables.deadlineWarningDays).toBe(7);
    expect(stateAfterImport.state.variables.clients[0].name).toBe(secretClientName);
  });

  it('PUT /api/admin/variables odrzuca nieprawidłowe dane wg wszystkich limitów walidacji', async () => {
    ctx = await startServer();
    const baseUrl = ctx.baseUrl;
    const { cookie: adminCookie } = await setupAdmin(baseUrl);

    const expectBad = async (payload: unknown) => {
      const res = await fetch(`${baseUrl}/api/admin/variables`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
    };

    // VAT: zakres 0-100, maks. 2 miejsca po przecinku, unikalność z uwzględnieniem isExempt, maks. 20
    await expectBad({ vatRates: [{ id: 'v1', value: -1, label: 'Ujemny' }] });
    await expectBad({ vatRates: [{ id: 'v1', value: 101, label: 'Za duży' }] });
    await expectBad({ vatRates: [{ id: 'v1', value: 12.345, label: '3 miejsca' }] });
    await expectBad({
      vatRates: [
        { id: 'v1', value: 23, label: '23% A' },
        { id: 'v2', value: 23, label: '23% B' },
      ],
    });
    await expectBad({
      vatRates: [
        { id: 'z1', value: 0, label: 'ZW 1', isExempt: true },
        { id: 'z2', value: 0, label: 'ZW 2', isExempt: true },
      ],
    });
    await expectBad({
      vatRates: Array.from({ length: 21 }, (_, i) => ({ id: `v${i}`, value: i, label: `${i}%` })),
    });

    // Natomiast 0% oraz ZW (0% z isExempt: true) i 19.99 są poprawne
    const okVatRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        vatRates: [
          { id: 'v0', value: 0, label: '0% Eksport' },
          { id: 'vzw', value: 0, label: 'ZW', isExempt: true },
          { id: 'v19', value: 19.99, label: '19.99%' },
        ],
      }),
    });
    expect(okVatRes.status).toBe(200);

    // Klienci: maks. 500, pola do 200 znaków, NIP do 20
    await expectBad({
      clients: Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, name: `Klient ${i}` })),
    });
    await expectBad({ clients: [{ id: 'c1', name: 'X'.repeat(201) }] });
    await expectBad({ clients: [{ id: 'c1', name: 'Firma', email: 'a'.repeat(201) }] });
    await expectBad({ clients: [{ id: 'c1', name: 'Firma', nip: '1'.repeat(21) }] });

    // Typy zadań: maks. 30, nazwa niepusta do 50 znaków
    await expectBad({
      taskTypes: Array.from({ length: 31 }, (_, i) => ({ id: `t${i}`, name: `Typ ${i}` })),
    });
    await expectBad({ taskTypes: [{ id: 't1', name: '   ' }] });
    await expectBad({ taskTypes: [{ id: 't1', name: 'N'.repeat(51) }] });

    // deadlineWarningDays: 0-30 całkowita
    await expectBad({ deadlineWarningDays: -1 });
    await expectBad({ deadlineWarningDays: 31 });
    await expectBad({ deadlineWarningDays: 3.5 });

    const okZeroDays = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ deadlineWarningDays: 0 }),
    });
    expect(okZeroDays.status).toBe(200);
    expect((await okZeroDays.json()).variables.deadlineWarningDays).toBe(0);
  });

  it('klient: wylogowanie zachowuje oph_theme_mode oraz oph_pref_* i usuwa pozostałe klucze oph_*', () => {
    const store = new Map<string, string>([
      ['oph_theme_mode', 'dark'],
      ['oph_pref_sidebar_collapsed', 'true'],
      ['oph_pref_default_view', 'kanban'],
      ['oph_is_authenticated', 'true'],
      ['oph_vat_rates', '[]'],
      ['oph_clients', '[]'],
      ['oph_task_types', '[]'],
      ['oph_deadline_warning_days', '5'],
      ['oph_update_available', 'true'],
      ['custom_key', 'stay'],
    ]);

    const mockStorage: Pick<Storage, 'length' | 'key' | 'removeItem' | 'getItem'> = {
      get length() {
        return store.size;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
    };

    expect(hasLegacyLocalVariables(mockStorage)).toBe(true);
    const legacy = readLegacyLocalVariables(mockStorage);
    expect(legacy.deadlineWarningDays).toBe(5);
    expect(legacy.vatRates).toEqual([]);

    clearLegacyLocalVariables(mockStorage);
    expect(hasLegacyLocalVariables(mockStorage)).toBe(false);
    expect(store.has('oph_is_authenticated')).toBe(true);

    clearOphStorageOnLogout(mockStorage);
    expect(store.get('oph_theme_mode')).toBe('dark');
    expect(store.get('oph_pref_sidebar_collapsed')).toBe('true');
    expect(store.get('oph_pref_default_view')).toBe('kanban');
    expect(store.get('custom_key')).toBe('stay');
    expect(store.has('oph_is_authenticated')).toBe(false);
    expect(store.has('oph_update_available')).toBe(false);
  });

  it('klient: gettery variableSettings odczytują zsynchronizowany stan serwera zamiast localStorage', () => {
    setServerVariables({
      vatRates: [{ id: 'v1', value: 19, rate: 19, label: '19% Test' }],
      taskTypes: [{ id: 'tt1', name: 'Nadzór', label: 'Nadzór', color: 'sky' }],
      deadlineWarningDays: 9,
      initialized: true,
      // celowo bez clients (jak dla roli developer)
    });

    expect(getVatRates()).toHaveLength(1);
    expect(getVatRates()[0].value).toBe(19);
    expect(getTaskTypes()).toHaveLength(1);
    expect(getTaskTypes()[0].name).toBe('Nadzór');
    expect(getDeadlineWarningDays()).toBe(9);
    expect(getProjectDeadlineSettings()).toEqual(DEFAULT_PROJECT_DEADLINE_SETTINGS);
    expect(getClients()).toEqual([]);
  });

  it('P76: PUT /api/admin/variables waliduje projectStatuses i projectPriorities oraz zwraca 409 przy próbie usunięcia używanej pozycji', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const expectBadVars = async (payload: unknown) => {
      const res = await fetch(`${ctx!.baseUrl}/api/admin/variables`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
    };

    // Pusta lista, przekroczony limit 20, etykieta > 40 znaków, duplikat etykiety, zły kolor, brak domyślnego, usunięcie pozycji systemowej
    await expectBadVars({ projectStatuses: [] });
    await expectBadVars({
      projectStatuses: Array.from({ length: 21 }, (_, i) => ({
        id: `s${i}`,
        label: `Stan ${i}`,
        color: 'sky',
        order: i + 1,
        isDefault: i === 0,
      })),
    });
    await expectBadVars({
      projectStatuses: [
        ...DEFAULT_PROJECT_STATUSES.slice(0, 3),
        {
          id: 'completed',
          label: 'X'.repeat(41),
          color: 'slate',
          order: 4,
          isDefault: false,
          isClosed: true,
        },
      ],
    });
    await expectBadVars({
      projectStatuses: [
        ...DEFAULT_PROJECT_STATUSES,
        { id: 'dup', label: 'aktywny', color: 'sky', order: 5, isDefault: false, isClosed: false },
      ],
    });
    await expectBadVars({
      projectStatuses: [
        ...DEFAULT_PROJECT_STATUSES,
        { id: 'bad_col', label: 'Zły kolor', color: 'neon', order: 5, isDefault: false, isClosed: false },
      ],
    });
    await expectBadVars({
      projectStatuses: DEFAULT_PROJECT_STATUSES.map((s) => ({ ...s, isDefault: false })),
    });
    // Usunięcie systemowego stanu 'planning'
    await expectBadVars({
      projectStatuses: DEFAULT_PROJECT_STATUSES.filter((s) => s.id !== 'planning').map((s, idx) => ({
        ...s,
        isDefault: idx === 0,
      })),
    });

    // Priorytety: brak domyślnego, duplikat nazwy bez względu na wielkość liter, brak systemowego
    await expectBadVars({ projectPriorities: [] });
    await expectBadVars({
      projectPriorities: [
        ...DEFAULT_PROJECT_PRIORITIES,
        { id: 'dup_p', label: 'WYSOKI', color: 'amber', order: 5, isDefault: false },
      ],
    });
    await expectBadVars({
      projectPriorities: DEFAULT_PROJECT_PRIORITIES.filter((p) => p.id !== 'low'),
    });

    // Dodaj niestandardowy stan i priorytet
    const customStatus = {
      id: 'cancelled',
      label: 'Anulowany',
      color: 'rose',
      order: 5,
      isDefault: false,
      isClosed: true,
    };
    const customPriority = {
      id: 'strategic',
      label: 'Strategiczny',
      color: 'purple',
      order: 5,
      isDefault: false,
    };
    const addRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectStatuses: [...DEFAULT_PROJECT_STATUSES, customStatus],
        projectPriorities: [...DEFAULT_PROJECT_PRIORITIES, customPriority],
      }),
    });
    expect(addRes.status).toBe(200);

    // Utwórz projekt korzystający z obu niestandardowych pozycji
    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        key: '2026-1_A',
        name: 'Projekt na niestandardowych słownikach',
        status: 'cancelled',
        priority: 'strategic',
      }),
    });
    expect(projRes.status).toBe(201);

    // Próba usunięcia używanego stanu -> 409
    const delUsedStatusRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectStatuses: DEFAULT_PROJECT_STATUSES,
      }),
    });
    expect(delUsedStatusRes.status).toBe(409);
    const delUsedStatusJson = await delUsedStatusRes.json();
    expect(delUsedStatusJson.field).toBe('projectStatuses');
    expect(delUsedStatusJson.inUseProjects.length).toBeGreaterThanOrEqual(1);

    // Próba usunięcia używanego priorytetu -> 409
    const delUsedPriorityRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectPriorities: DEFAULT_PROJECT_PRIORITIES,
      }),
    });
    expect(delUsedPriorityRes.status).toBe(409);
    const delUsedPriorityJson = await delUsedPriorityRes.json();
    expect(delUsedPriorityJson.field).toBe('projectPriorities');
    expect(delUsedPriorityJson.inUseProjects.length).toBeGreaterThanOrEqual(1);
  });

  it('P78: PUT /api/admin/variables waliduje progi ostrzeżeń i mrugania terminów projektów (projectDeadline)', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const expectBadVars = async (payload: unknown) => {
      const res = await fetch(`${ctx!.baseUrl}/api/admin/variables`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
    };

    // Nieprawidłowe typy i zakresy (1-365, liczby całkowite, criticalDays < warnDays, blinkEnabled boolean)
    await expectBadVars({ projectDeadline: 'invalid' });
    await expectBadVars({ projectDeadline: { warnDays: 0, criticalDays: 7, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 366, criticalDays: 7, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 30, criticalDays: 0, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 30, criticalDays: 366, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 10.5, criticalDays: 3, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 10, criticalDays: 10, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 10, criticalDays: 12, blinkEnabled: true } });
    await expectBadVars({ projectDeadline: { warnDays: 30, criticalDays: 7, blinkEnabled: 'yes' } });

    // Poprawny zapis aktualizuje stan i raportuje changedSections = ['projectDeadline']
    const okRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectDeadline: { warnDays: 45, criticalDays: 10, blinkEnabled: false },
      }),
    });
    expect(okRes.status).toBe(200);
    const okJson = await okRes.json();
    expect(okJson.changedSections).toEqual(['projectDeadline']);
    expect(okJson.variables.projectDeadline).toEqual({
      warnDays: 45,
      criticalDays: 10,
      blinkEnabled: false,
    });

    // Stan po odczycie GET /api/state zachowuje zapisane progi i udostępnia appTimezone
    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    expect(stateRes.status).toBe(200);
    const stateJson = await stateRes.json();
    expect(stateJson.state.variables.projectDeadline).toEqual({
      warnDays: 45,
      criticalDays: 10,
      blinkEnabled: false,
    });
    expect(typeof stateJson.state.appTimezone).toBe('string');
  });
});
