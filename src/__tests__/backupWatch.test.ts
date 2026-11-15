import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nodemailer from 'nodemailer';
import { computeBackupStatus } from '../server/backupStatus.js';
import {
  BACKUP_ALERT_COOLDOWN_MS,
  BACKUP_WATCH_INITIAL_DELAY_MS,
  BACKUP_WATCH_INTERVAL_MS,
  BackupAlertEmailPayload,
  createBackupWatchService,
  resolveBackupAlertRecipients,
} from '../server/backupWatch.js';
import { resolveServerConfig } from '../server/config.js';
import { StateStore } from '../server/state.js';
import { SecurityEvent, SecurityEventType, SecurityLog, buildSecurityEvent } from '../utils/securityLog.js';

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

describe('backupStatus & backupWatch', () => {
  const tempDirs: string[] = [];
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...origEnv };
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('computeBackupStatus wykrywa brak kopii, świeżą kopię i przeterminowaną kopię wg BACKUP_MAX_AGE_HOURS', async () => {
    const rootDir = createTempDir('zp-backup-status-');
    tempDirs.push(rootDir);
    const dataDir = path.join(rootDir, 'data');
    const backupDir = path.join(rootDir, 'backups');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    const empty = await computeBackupStatus({
      dataDir,
      backupDir,
      maxAgeHours: 36,
      nowMs: Date.now(),
    });
    expect(empty.active).toBe(false);
    expect(empty.lastBackup).toBeNull();
    expect(empty.maxAgeHours).toBe(36);

    const backupFile = path.join(backupDir, 'app_state_2026-11-15_020000.json.gz');
    fs.writeFileSync(backupFile, Buffer.from('test-backup'));

    const freshTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    fs.utimesSync(backupFile, freshTime, freshTime);

    const fresh = await computeBackupStatus({
      dataDir,
      backupDir,
      maxAgeHours: 36,
      nowMs: Date.now(),
    });
    expect(fresh.active).toBe(true);
    expect(fresh.lastBackup?.ageHours).toBe(4);
    expect(fresh.lastBackup?.filename).toBe('app_state_2026-11-15_020000.json.gz');

    const staleTime = new Date(Date.now() - 40 * 60 * 60 * 1000);
    fs.utimesSync(backupFile, staleTime, staleTime);

    const stale = await computeBackupStatus({
      dataDir,
      backupDir,
      maxAgeHours: 36,
      nowMs: Date.now(),
    });
    expect(stale.active).toBe(false);
    expect(stale.lastBackup?.ageHours).toBe(40);
  });

  it('resolveBackupAlertRecipients wybiera BACKUP_ALERT_EMAILS lub aktywnych administratorów', () => {
    const users = [
      { role: 'admin', isApproved: true, email: 'admin1@pracownia.pl' },
      { role: 'admin', isApproved: false, email: 'pending@pracownia.pl' },
      { role: 'admin', isApproved: true, email: '' },
      { role: 'member', isApproved: true, email: 'member@pracownia.pl' },
      { role: 'admin', isApproved: true, email: 'admin2@pracownia.pl' },
    ];

    expect(resolveBackupAlertRecipients(['ops@pracownia.pl', 'admin1@pracownia.pl', 'ops@pracownia.pl'], users)).toEqual([
      'ops@pracownia.pl',
      'admin1@pracownia.pl',
    ]);

    expect(resolveBackupAlertRecipients([], users)).toEqual([
      'admin1@pracownia.pl',
      'admin2@pracownia.pl',
    ]);
  });

  it('wysyła alert po 2 min od startu, dławi powtórki przez 24h i wysyła powiadomienie o powrocie do normy', async () => {
    process.env.SMTP_HOST = 'smtp.test.local';

    const stateStore = createMemoryStateStore([
      { id: 'u1', role: 'admin', isApproved: true, email: 'admin@pracownia.pl' },
      { id: 'u2', role: 'member', isApproved: true, email: 'user@pracownia.pl' },
    ]);
    const config = resolveServerConfig({
      dataDir: '/tmp/unused-watch-dir',
      backupMaxAgeHours: 36,
    });

    let backupActive = false;
    let currentAgeHours: number | null = 42.5;
    const sentEmails: BackupAlertEmailPayload[] = [];

    const service = createBackupWatchService({
      config,
      stateStore,
      checkStatusOverride: async () => ({
        active: backupActive,
        lastBackup:
          currentAgeHours !== null
            ? {
                filename: 'app_state_2026-11-13_020000.json.gz',
                timestamp: new Date(Date.now() - currentAgeHours * 3600 * 1000).toISOString(),
                ageHours: currentAgeHours,
                size: 1024,
                encrypted: false,
              }
            : null,
        maxAgeHours: 36,
        message: backupActive ? 'OK' : 'Stale',
      }),
      mailerOverride: async (mail) => {
        sentEmails.push(mail);
      },
    });

    // Przed upływem 2 minut nic nie powinno zostać wysłane
    await vi.advanceTimersByTimeAsync(BACKUP_WATCH_INITIAL_DELAY_MS - 1000);
    expect(sentEmails).toHaveLength(0);

    // Po 2 minutach pierwszy check -> alert
    await vi.advanceTimersByTimeAsync(1000);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual(['admin@pracownia.pl']);
    expect(sentEmails[0].text).toContain('42.5 h');

    // Kolejne 3 sprawdzenia co 6h (6h, 12h, 18h) mieszczą się w oknie 24h -> brak powtórki
    await vi.advanceTimersByTimeAsync(BACKUP_WATCH_INTERVAL_MS * 3);
    expect(sentEmails).toHaveLength(1);

    // 4. sprawdzenie (24h od pierwszego alertu) -> dozwolony kolejny alert
    await vi.advanceTimersByTimeAsync(BACKUP_WATCH_INTERVAL_MS);
    expect(sentEmails).toHaveLength(2);

    // Kopia wraca do normy -> jedno powiadomienie "kopia znów aktualna"
    backupActive = true;
    currentAgeHours = 0.5;
    await vi.advanceTimersByTimeAsync(BACKUP_WATCH_INTERVAL_MS);
    expect(sentEmails).toHaveLength(3);
    expect(sentEmails[2].text.toLowerCase()).toContain('kopia znów aktualna');

    // Kolejne sprawdzenie przy aktywnej kopii nie wysyła już maila
    await vi.advanceTimersByTimeAsync(BACKUP_WATCH_INTERVAL_MS);
    expect(sentEmails).toHaveLength(3);

    const staleEvents = stateStore.recordedEvents.filter((e) => e.type === 'backup_stale');
    const recoveredEvents = stateStore.recordedEvents.filter((e) => e.type === 'backup_recovered');
    expect(staleEvents).toHaveLength(2);
    expect(recoveredEvents).toHaveLength(1);
    expect(staleEvents[0].details).toEqual({ ageHours: 42.5 });
    expect(recoveredEvents[0].details).toEqual({ ageHours: 0.5 });

    service.stop();
    expect(BACKUP_ALERT_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('zapisuje backup_stale i backup_recovered do security_log.jsonl z samym wiekiem bez ścieżek systemowych', async () => {
    vi.useRealTimers();
    const dataDir = createTempDir('zp-backup-disklog-');
    tempDirs.push(dataDir);
    delete process.env.SMTP_HOST;

    const stateStore = createDiskStateStore(dataDir, [
      { id: 'u1', role: 'admin', isApproved: true, email: 'admin@pracownia.pl' },
    ]);
    const config = resolveServerConfig({
      dataDir,
      backupMaxAgeHours: 36,
    });

    let backupActive = false;
    let ageHours = 51.2;

    const service = createBackupWatchService({
      config,
      stateStore,
      disableTimers: true,
      checkStatusOverride: async () => ({
        active: backupActive,
        lastBackup: {
          filename: 'app_state_old.json.gz',
          timestamp: new Date(Date.now() - ageHours * 3600 * 1000).toISOString(),
          ageHours,
          size: 512,
          encrypted: false,
        },
        maxAgeHours: 36,
        message: backupActive ? 'OK' : 'Stale',
      }),
    });

    await service.runCheck();
    backupActive = true;
    ageHours = 1.1;
    await service.runCheck();

    const staleEvents = await stateStore.securityLogger.getRecentEvents(10, 'backup_stale');
    const recoveredEvents = await stateStore.securityLogger.getRecentEvents(10, 'backup_recovered');
    expect(staleEvents).toHaveLength(1);
    expect(recoveredEvents).toHaveLength(1);
    expect(staleEvents[0].details).toEqual({ ageHours: 51.2 });
    expect(recoveredEvents[0].details).toEqual({ ageHours: 1.1 });

    const rawLog = fs.readFileSync(path.join(dataDir, 'security_log.jsonl'), 'utf-8');
    expect(rawLog).not.toContain(dataDir);
    expect(rawLog).not.toContain('/opt/');
    expect(rawLog).not.toContain('backups');

    service.stop();
  });

  it('bez konfiguracji SMTP nie wysyła maila i zapisuje wyłącznie zdarzenie bezpieczeństwa', async () => {
    vi.useRealTimers();
    const dataDir = createTempDir('zp-backup-nosmtp-');
    tempDirs.push(dataDir);
    delete process.env.SMTP_HOST;

    const stateStore = createDiskStateStore(dataDir, [
      { id: 'u1', role: 'admin', isApproved: true, email: 'admin@pracownia.pl' },
    ]);
    const config = resolveServerConfig({
      dataDir,
      backupMaxAgeHours: 36,
      backupAlertEmails: ['ops@pracownia.pl'],
    });
    const mailerSpy = vi.fn(async () => {});

    const service = createBackupWatchService({
      config,
      stateStore,
      disableTimers: true,
      checkStatusOverride: async () => ({
        active: false,
        lastBackup: null,
        maxAgeHours: 36,
        message: 'Brak kopii zapasowej na serwerze',
      }),
      mailerOverride: mailerSpy,
    });

    await service.runCheck();
    expect(mailerSpy).not.toHaveBeenCalled();

    const events = await stateStore.securityLogger.getRecentEvents(10, 'backup_stale');
    expect(events).toHaveLength(1);
    expect(events[0].details).toBeUndefined();

    service.stop();
  });

  it('używa BACKUP_ALERT_EMAILS i transportu nodemailer, gdy brak mailerOverride', async () => {
    vi.useRealTimers();
    const dataDir = createTempDir('zp-backup-smtp-');
    tempDirs.push(dataDir);
    process.env.SMTP_HOST = 'smtp.test.local';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_FROM = 'noreply@test.local';

    const sendMailSpy = vi.fn(async () => ({ messageId: 'msg-1' }));
    const createTransportSpy = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail: sendMailSpy } as any);

    const stateStore = createDiskStateStore(dataDir, [
      { id: 'u1', role: 'admin', isApproved: true, email: 'admin@pracownia.pl' },
    ]);
    const config = resolveServerConfig({
      dataDir,
      backupMaxAgeHours: 24,
      backupAlertEmails: ['alerts@pracownia.pl', 'backup@pracownia.pl'],
    });

    const service = createBackupWatchService({
      config,
      stateStore,
      disableTimers: true,
      checkStatusOverride: async () => ({
        active: false,
        lastBackup: {
          filename: 'app_state_old.json.gz',
          timestamp: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
          ageHours: 30,
          size: 512,
          encrypted: false,
        },
        maxAgeHours: 24,
        message: 'Stale',
      }),
    });

    await service.runCheck();

    expect(createTransportSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect((sendMailSpy.mock.calls[0] as any)[0].to).toBe(
      'alerts@pracownia.pl, backup@pracownia.pl'
    );

    service.stop();
  });

  it('stop() anuluje zaplanowane timery', async () => {
    const stateStore = createMemoryStateStore([]);
    const config = resolveServerConfig({ dataDir: '/tmp/unused-stop-dir' });
    const checkSpy = vi.fn(async () => ({
      active: false,
      lastBackup: null,
      maxAgeHours: 36,
      message: 'None',
    }));

    const service = createBackupWatchService({
      config,
      stateStore,
      checkStatusOverride: checkSpy,
    });
    service.stop();

    await vi.advanceTimersByTimeAsync(BACKUP_WATCH_INITIAL_DELAY_MS + BACKUP_WATCH_INTERVAL_MS);
    expect(checkSpy).not.toHaveBeenCalled();
  });
});
