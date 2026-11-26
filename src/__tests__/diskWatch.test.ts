import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import {
  DISK_ALERT_COOLDOWN_MS,
  DISK_WATCH_INITIAL_DELAY_MS,
  DISK_WATCH_INTERVAL_MS,
  DiskAlertEmailPayload,
  DiskStatus,
  classifyDiskLevel,
  createDiskWatchService,
  getDiskStatus,
  isDiskLowForAlert,
} from '../server/diskWatch.js';
import { resolveServerConfig } from '../server/config.js';
import {
  DISK_FULL_ERROR_MESSAGE,
  DISK_WRITE_FAILED_COOLDOWN_MS,
  StateStore,
} from '../server/state.js';
import {
  SecurityEvent,
  SecurityEventType,
  SecurityLog,
  buildSecurityEvent,
} from '../utils/securityLog.js';
import { createApp, CreateAppOptions } from '../../server.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createMemoryStateStore(users: any[]): StateStore & { recordedEvents: SecurityEvent[] } {
  const recordedEvents: SecurityEvent[] = [];
  const state: any = {
    projects: [],
    tasks: [],
    users,
    revision: 1,
    initialized: true,
  };

  const securityLogger = {
    record: async (type: SecurityEventType, input: any = {}) => {
      recordedEvents.push(buildSecurityEvent(type, input));
    },
    getRecentEvents: async (limit: number = 100, filterType?: SecurityEventType) => {
      const filtered = filterType
        ? recordedEvents.filter((e) => e.type === filterType)
        : recordedEvents;
      return filtered.slice(-limit).reverse();
    },
  } as unknown as SecurityLog;

  return {
    recordedEvents,
    getAppState: () => state,
    setAppState: (next: any) => {
      Object.assign(state, next);
    },
    getUsers: () => state.users,
    setUsers: (nextUsers: any[]) => {
      state.users = nextUsers;
    },
    ensureStateStructure: () => state,
    bumpStateRevision: () => {
      state.revision += 1;
      return state.revision;
    },
    onRevisionChange: () => () => {},
    saveStateAtomicAsync: async () => {},
    flushPendingStateSave: async () => {},
    securityLogger,
  };
}

function createDiskStateStore(dataDir: string, users: any[]): StateStore {
  const securityLogger = new SecurityLog(dataDir);
  const state: any = {
    projects: [],
    tasks: [],
    users,
    revision: 1,
    initialized: true,
  };

  return {
    getAppState: () => state,
    setAppState: (next: any) => {
      Object.assign(state, next);
    },
    getUsers: () => state.users,
    setUsers: (nextUsers: any[]) => {
      state.users = nextUsers;
    },
    ensureStateStructure: () => state,
    bumpStateRevision: () => {
      state.revision += 1;
      return state.revision;
    },
    onRevisionChange: () => () => {},
    saveStateAtomicAsync: async () => {},
    flushPendingStateSave: async () => {},
    securityLogger,
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
    const match = raw.match(/(?:__Host-zp_session|zp_session)=([^;]+)/);
    if (match) {
      return raw.split(';')[0];
    }
  }
  return '';
}

async function startTestServer(overrides: Partial<CreateAppOptions> = {}) {
  const dataDir = createTempDir('zp-disk-api-');
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    allowSelfRegistration: true,
    setupToken: '',
    diskWatchDisableTimers: true,
    backupWatchDisableTimers: true,
    googleSyncDisableTimers: true,
    trashCleanupDisableTimers: true,
    remindersDisableTimers: true,
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
  const close = async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await instance.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, dataDir, close };
}

describe('diskWatch & ENOSPC handling', () => {
  const tempDirs: string[] = [];
  const origEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T10:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...origEnv };
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getDiskStatus oblicza wolne miejsce z statfs i zwraca null przy błędzie lub niepoprawnych danych', async () => {
    const ok = await getDiskStatus('/tmp/fake-data', async () => ({
      bsize: 4096,
      blocks: 1_000_000,
      bavail: 123_456,
    }));
    expect(ok).toEqual({
      totalBytes: 4_096_000_000,
      freeBytes: 505_675_776,
      freePercent: 12.3,
    });

    const failed = await getDiskStatus('/tmp/fake-data', async () => {
      throw new Error('EACCES');
    });
    expect(failed).toBeNull();

    const zeroBlocks = await getDiskStatus('/tmp/fake-data', async () => ({
      bsize: 4096,
      blocks: 0,
      bavail: 0,
    }));
    expect(zeroBlocks).toBeNull();
  });

  it('classifyDiskLevel i isDiskLowForAlert stosują progi warn, critical i alertu', () => {
    expect(
      classifyDiskLevel({ freeBytes: 5_000 * 1024 * 1024, totalBytes: 20_000 * 1024 * 1024, freePercent: 25 })
    ).toBe('ok');
    expect(
      classifyDiskLevel({ freeBytes: 2_000 * 1024 * 1024, totalBytes: 20_000 * 1024 * 1024, freePercent: 12.5 })
    ).toBe('warn');
    expect(
      classifyDiskLevel({ freeBytes: 800 * 1024 * 1024, totalBytes: 20_000 * 1024 * 1024, freePercent: 4.0 })
    ).toBe('critical');
    expect(
      classifyDiskLevel({ freeBytes: 150 * 1024 * 1024, totalBytes: 500 * 1024 * 1024, freePercent: 30 })
    ).toBe('critical');

    expect(
      isDiskLowForAlert({ freeBytes: 600 * 1024 * 1024, totalBytes: 10_000 * 1024 * 1024, freePercent: 6 }, 10, 500)
    ).toBe(true);
    expect(
      isDiskLowForAlert({ freeBytes: 400 * 1024 * 1024, totalBytes: 1_000 * 1024 * 1024, freePercent: 40 }, 10, 500)
    ).toBe(true);
    expect(
      isDiskLowForAlert({ freeBytes: 1_000 * 1024 * 1024, totalBytes: 5_000 * 1024 * 1024, freePercent: 20 }, 10, 500)
    ).toBe(false);
  });

  it('diskWatch wysyła alert po 2 min, dławi powtórki przez 24h i wysyła mail o powrocie do normy', async () => {
    process.env.SMTP_HOST = 'smtp.test.local';

    const stateStore = createMemoryStateStore([
      { id: 'u1', role: 'admin', isApproved: true, email: 'admin@pracownia.pl' },
      { id: 'u2', role: 'member', isApproved: true, email: 'user@pracownia.pl' },
    ]);
    const config = resolveServerConfig({
      dataDir: '/tmp/unused-disk-watch',
      diskAlertPercent: 10,
      diskAlertMinMb: 500,
    });

    let currentStatus: DiskStatus = {
      freeBytes: 300 * 1024 * 1024,
      totalBytes: 10_000 * 1024 * 1024,
      freePercent: 3.0,
    };
    const sentEmails: DiskAlertEmailPayload[] = [];

    const service = createDiskWatchService({
      config,
      stateStore,
      checkStatusOverride: async () => currentStatus,
      mailerOverride: async (mail) => {
        sentEmails.push(mail);
      },
    });

    await vi.advanceTimersByTimeAsync(DISK_WATCH_INITIAL_DELAY_MS - 1000);
    expect(sentEmails).toHaveLength(0);

    // Po 2 minutach pierwszy alert
    await vi.advanceTimersByTimeAsync(1000);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual(['admin@pracownia.pl']);
    expect(sentEmails[0].text).toContain('3%');
    expect(sentEmails[0].text).toContain('300 MB');

    // 3 kolejne sprawdzenia co 6h (6h, 12h, 18h) -> bez powtórki
    await vi.advanceTimersByTimeAsync(DISK_WATCH_INTERVAL_MS * 3);
    expect(sentEmails).toHaveLength(1);

    // Po 24h kolejny alert
    await vi.advanceTimersByTimeAsync(DISK_WATCH_INTERVAL_MS);
    expect(sentEmails).toHaveLength(2);

    // Miejsce wraca do normy -> jedno powiadomienie "miejsca znów wystarcza"
    currentStatus = {
      freeBytes: 4_000 * 1024 * 1024,
      totalBytes: 10_000 * 1024 * 1024,
      freePercent: 40.0,
    };
    await vi.advanceTimersByTimeAsync(DISK_WATCH_INTERVAL_MS);
    expect(sentEmails).toHaveLength(3);
    expect(sentEmails[2].text.toLowerCase()).toContain('miejsca znów wystarcza');

    // Kolejne sprawdzenie przy dobrym stanie nie wysyła kolejnego maila
    await vi.advanceTimersByTimeAsync(DISK_WATCH_INTERVAL_MS);
    expect(sentEmails).toHaveLength(3);

    const lowEvents = stateStore.recordedEvents.filter((e) => e.type === 'disk_low');
    const recoveredEvents = stateStore.recordedEvents.filter((e) => e.type === 'disk_recovered');
    expect(lowEvents).toHaveLength(2);
    expect(recoveredEvents).toHaveLength(1);
    expect(lowEvents[0].details).toEqual({ freePercent: 3, freeMb: 300 });
    expect(recoveredEvents[0].details).toEqual({ freePercent: 40, freeMb: 4000 });

    service.stop();
    expect(DISK_ALERT_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('bez SMTP zapisuje wyłącznie zdarzenie disk_low w security_log.jsonl bez ścieżek systemowych', async () => {
    vi.useRealTimers();
    const dataDir = createTempDir('zp-disk-nosmtp-');
    tempDirs.push(dataDir);
    delete process.env.SMTP_HOST;

    const stateStore = createDiskStateStore(dataDir, [
      { id: 'u1', role: 'admin', isApproved: true, email: 'admin@pracownia.pl' },
    ]);
    const config = resolveServerConfig({
      dataDir,
      diskAlertPercent: 10,
      diskAlertMinMb: 500,
    });
    const mailerSpy = vi.fn(async () => {});

    let isLow = true;
    const service = createDiskWatchService({
      config,
      stateStore,
      disableTimers: true,
      checkStatusOverride: async () =>
        isLow
          ? { freeBytes: 256 * 1024 * 1024, totalBytes: 8_000 * 1024 * 1024, freePercent: 3.2 }
          : { freeBytes: 4_000 * 1024 * 1024, totalBytes: 8_000 * 1024 * 1024, freePercent: 50.0 },
      mailerOverride: mailerSpy,
    });

    await service.runCheck();
    isLow = false;
    await service.runCheck();

    expect(mailerSpy).not.toHaveBeenCalled();

    const lowEvents = await stateStore.securityLogger.getRecentEvents(10, 'disk_low');
    const recEvents = await stateStore.securityLogger.getRecentEvents(10, 'disk_recovered');
    expect(lowEvents).toHaveLength(1);
    expect(recEvents).toHaveLength(1);
    expect(lowEvents[0].details).toEqual({ freePercent: 3.2, freeMb: 256 });
    expect(recEvents[0].details).toEqual({ freePercent: 50, freeMb: 4000 });

    const rawLog = fs.readFileSync(path.join(dataDir, 'security_log.jsonl'), 'utf-8');
    expect(rawLog).not.toContain(dataDir);
    expect(rawLog).not.toContain('/tmp/');

    service.stop();
  });

  it('stop() anuluje zaplanowane timery diskWatch', async () => {
    const stateStore = createMemoryStateStore([]);
    const config = resolveServerConfig({ dataDir: '/tmp/unused-disk-stop' });
    const checkSpy = vi.fn(async () => ({
      freeBytes: 5_000 * 1024 * 1024,
      totalBytes: 10_000 * 1024 * 1024,
      freePercent: 50,
    }));

    const service = createDiskWatchService({
      config,
      stateStore,
      checkStatusOverride: checkSpy,
    });
    service.stop();

    await vi.advanceTimersByTimeAsync(DISK_WATCH_INITIAL_DELAY_MS + DISK_WATCH_INTERVAL_MS);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('GET /api/admin/system wymaga roli admin, klasyfikuje dysk i nie ujawnia ścieżek systemowych', async () => {
    vi.useRealTimers();
    let mockDisk: DiskStatus | null = {
      freeBytes: 1_200 * 1024 * 1024,
      totalBytes: 10_000 * 1024 * 1024,
      freePercent: 12.0,
    };

    const server = await startTestServer({
      diskStatusCheckOverride: async () => mockDisk,
    });
    activeClose = server.close;

    // 1. Niezalogowany -> 401
    const unauthRes = await fetch(`${server.baseUrl}/api/admin/system`);
    expect(unauthRes.status).toBe(401);

    // 2. Setup admina
    const setupRes = await fetch(`${server.baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Systemowy',
        email: 'admin@pracownia.pl',
        password: 'Bezpieczne-Haslo-2026!',
      }),
    });
    expect(setupRes.status).toBe(200);
    const adminCookie = extractSessionCookie(setupRes);

    // 3. Utwórz zwykłego użytkownika -> 403 na /api/admin/system
    const createUserRes = await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: 'Zwykły Użytkownik',
        email: 'member@pracownia.pl',
        password: 'Kosmos-Zima-2026!xyz',
        role: 'developer',
      }),
    });
    expect(createUserRes.status).toBe(200);

    const loginMemberRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member@pracownia.pl',
        password: 'Kosmos-Zima-2026!xyz',
      }),
    });
    expect(loginMemberRes.status).toBe(200);
    const memberCookie = extractSessionCookie(loginMemberRes);

    const memberSysRes = await fetch(`${server.baseUrl}/api/admin/system`, {
      headers: { Cookie: memberCookie },
    });
    expect(memberSysRes.status).toBe(403);

    // 4. Admin dostaje pełny JSON bez ścieżek systemowych
    const adminSysRes = await fetch(`${server.baseUrl}/api/admin/system`, {
      headers: { Cookie: adminCookie },
    });
    expect(adminSysRes.status).toBe(200);
    const bodyText = await adminSysRes.text();
    expect(bodyText).not.toContain(server.dataDir);
    expect(bodyText).not.toContain('/tmp/');

    const sysJson = JSON.parse(bodyText);
    expect(sysJson.mode).toBe('production');
    expect(typeof sysJson.version).toBe('string');
    expect(typeof sysJson.uptimeSeconds).toBe('number');
    expect(sysJson.disk).toEqual({
      freeBytes: 1_200 * 1024 * 1024,
      totalBytes: 10_000 * 1024 * 1024,
      freePercent: 12.0,
      level: 'warn',
    });
    expect(sysJson.backup).toBeDefined();
    expect(typeof sysJson.backup.active).toBe('boolean');

    // 5. Gdy odczyt dysku niedostępny -> disk: null
    mockDisk = null;
    const nullSysRes = await fetch(`${server.baseUrl}/api/admin/system`, {
      headers: { Cookie: adminCookie },
    });
    expect(nullSysRes.status).toBe(200);
    const nullSysJson = await nullSysRes.json();
    expect(nullSysJson.disk).toBeNull();
  });

  it('ENOSPC przy zapisie stanu zwraca HTTP 507, zapisuje disk_write_failed maks. raz na 10 min i pozwala na kolejny zapis po odzyskaniu miejsca', async () => {
    vi.useRealTimers();
    const server = await startTestServer();
    activeClose = server.close;

    const setupRes = await fetch(`${server.baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin ENOSPC',
        email: 'admin@pracownia.pl',
        password: 'Bezpieczne-Haslo-2026!',
      }),
    });
    expect(setupRes.status).toBe(200);
    const adminCookie = extractSessionCookie(setupRes);

    // Utwórz projekt zanim dysk "się zapełni"
    const projRes = await fetch(`${server.baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        id: 'prj-disk-1',
        key: 'DSK-01',
        name: 'Projekt Testowy Dysku',
        priority: 'normal',
        status: 'active',
        startDate: '2026-11-17',
        dueDate: '2026-11-30',
        durationDays: 14,
        progress: 0,
      }),
    });
    expect(projRes.status).toBe(201);
    const createdProj = await projRes.json();
    const projectId = createdProj.project.id;

    // Symuluj ENOSPC przy atomowym zapisie app_state.json
    const origRename = fs.promises.rename.bind(fs.promises);
    let simulateEnospc = true;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (simulateEnospc && String(newPath).endsWith('app_state.json')) {
        const err = new Error('No space left on device') as NodeJS.ErrnoException;
        err.code = 'ENOSPC';
        throw err;
      }
      return origRename(oldPath, newPath);
    });

    let currentTime = Date.UTC(2026, 10, 17, 12, 0, 0);
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    // 1. Zapis przy braku miejsca -> 507 + zdarzenie disk_write_failed
    const failRes1 = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        id: 'tsk-enospc-1',
        projectId,
        code: 'DSK-01-01',
        title: 'Zadanie przy pełnym dysku',
        priority: 'normal',
        status: 'to_do',
        startDate: '2026-11-17',
        dueDate: '2026-11-20',
        durationDays: 4,
        progress: 0,
      }),
    });
    expect(failRes1.status).toBe(507);
    const failJson1 = await failRes1.json();
    expect(failJson1.error).toBe(DISK_FULL_ERROR_MESSAGE);

    // 2. Kolejny błąd w ciągu 10 min -> 507, ale bez duplikatu zdarzenia w security_log
    currentTime += 5 * 60 * 1000;
    const failRes2 = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        id: 'tsk-enospc-2',
        projectId,
        code: 'DSK-01-02',
        title: 'Drugie zadanie w oknie 10 min',
        priority: 'normal',
        status: 'to_do',
        startDate: '2026-11-17',
        dueDate: '2026-11-21',
        durationDays: 5,
        progress: 0,
      }),
    });
    expect(failRes2.status).toBe(507);

    // 3. Po ponad 10 min kolejne ENOSPC rejestruje drugie zdarzenie
    currentTime += DISK_WRITE_FAILED_COOLDOWN_MS + 1000;
    const failRes3 = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        id: 'tsk-enospc-3',
        projectId,
        code: 'DSK-01-03',
        title: 'Trzecie zadanie po 10 min',
        priority: 'normal',
        status: 'to_do',
        startDate: '2026-11-17',
        dueDate: '2026-11-22',
        durationDays: 6,
        progress: 0,
      }),
    });
    expect(failRes3.status).toBe(507);

    const eventsRes = await fetch(`${server.baseUrl}/api/security/events?type=disk_write_failed`, {
      headers: { Cookie: adminCookie },
    });
    expect(eventsRes.status).toBe(200);
    const eventsJson = await eventsRes.json();
    expect(eventsJson.events).toHaveLength(2);

    // 4. Po zwolnieniu miejsca kolejny zapis przechodzi poprawnie i utrwala najnowszy stan na dysku
    dateSpy.mockRestore();
    simulateEnospc = false;
    const okRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        id: 'tsk-recovered-1',
        projectId,
        code: 'DSK-01-04',
        title: 'Zadanie po odzyskaniu miejsca',
        priority: 'normal',
        status: 'to_do',
        startDate: '2026-11-17',
        dueDate: '2026-11-25',
        durationDays: 8,
        progress: 0,
      }),
    });
    expect(okRes.status).toBe(201);
    const okJson = await okRes.json();
    expect(okJson.success).toBe(true);
    expect(okJson.task.title).toBe('Zadanie po odzyskaniu miejsca');

    // Weryfikacja, że plik na dysku istnieje i ma zapisany stan
    const diskStateRaw = fs.readFileSync(path.join(server.dataDir, 'app_state.json'), 'utf-8');
    const diskState = JSON.parse(diskStateRaw);
    expect(diskState.tasks.some((t: any) => t.title === 'Zadanie po odzyskaniu miejsca')).toBe(true);
  });
});
