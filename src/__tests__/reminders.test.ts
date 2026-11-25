import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import nodemailer from 'nodemailer';
import { createApp, CreateAppOptions } from '../../server.js';
import {
  buildDigests,
  computeNextScheduledAt,
  isValidIanaTimezone,
  localDateString,
  localHour,
  renderDigestEmail,
  shouldRunNow,
  ReminderSettings,
} from '../utils/reminders.js';
import { validateAdminSettingsUpdate } from '../utils/settingsSchema.js';
import { resolveServerConfig } from '../server/config.js';
import { createStateStore } from '../server/state.js';
import { createSettingsService } from '../server/settings.js';
import { createReminderService } from '../server/reminders.js';
import { MailerService } from '../server/mailer.js';
import type { Project, Task, User } from '../types/index.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Księżyc-Wiosna-2026!';
const USER_PASS = 'Jesień-Kwiaty-2026!';

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

async function startServer(overrides: Partial<CreateAppOptions> = {}) {
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-reminders-'));
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
    remindersDisableTimers: true,
    ...overrides,
  });

  const httpServer = http.createServer(instance.app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await instance.close();
    throw new Error('Brak portu testowego');
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
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
      name: 'Anna Kowalska',
      email,
      password: ADMIN_PASS,
      department: 'Architektura',
    }),
  });
  const cookie = extractSessionCookie(res);
  const data = await res.json();
  return { res, cookie, user: data.user };
}

describe('Przypomnienia e-mail o terminach — logika czysta (src/utils/reminders.ts)', () => {
  it('poprawnie wyznacza lokalną datę i godzinę przy przejściu północy UTC vs Europe/Warsaw oraz DST', () => {
    // 2026-11-16 23:30 UTC => w Warszawie (CET, UTC+1) jest już 2026-11-17 00:30
    const midnightCet = Date.parse('2026-11-16T23:30:00.000Z');
    expect(localDateString(midnightCet, 'UTC')).toBe('2026-11-16');
    expect(localHour(midnightCet, 'UTC')).toBe(23);
    expect(localDateString(midnightCet, 'Europe/Warsaw')).toBe('2026-11-17');
    expect(localHour(midnightCet, 'Europe/Warsaw')).toBe(0);

    // Zmiana czasu na letni 2026-03-29 01:30 UTC => 03:30 CEST w Warszawie
    const dstSpring = Date.parse('2026-03-29T01:30:00.000Z');
    expect(localDateString(dstSpring, 'Europe/Warsaw')).toBe('2026-03-29');
    expect(localHour(dstSpring, 'Europe/Warsaw')).toBe(3);

    // Zmiana czasu na zimowy 2026-10-25 00:30 UTC => 02:30 CEST w Warszawie
    const dstAutumn = Date.parse('2026-10-25T00:30:00.000Z');
    expect(localDateString(dstAutumn, 'Europe/Warsaw')).toBe('2026-10-25');
    expect(localHour(dstAutumn, 'Europe/Warsaw')).toBe(2);
  });

  it('grupuje po jednej wiadomości na osobę, pomija done/cancelled/archived/>3d/disabled oraz bez zadań', () => {
    const now = Date.parse('2026-11-16T08:00:00.000Z');
    const projects: Project[] = [
      {
        id: 'p1',
        key: 'PR1',
        name: 'Biurowiec Centrum',
        description: 'Tajne szczegóły projektu',
        priority: 'high',
        status: 'active',
        startDate: '2026-11-01',
        dueDate: '2026-12-30',
        durationDays: 60,
        progress: 20,
        budget: '999999 PLN',
        projectValue: 500000,
        memberIds: ['u1', 'u2'],
        color: '#0ea5e9',
      },
      {
        id: 'p2',
        key: 'ARC',
        name: 'Projekt Zarchiwizowany',
        description: '',
        priority: 'normal',
        status: 'completed',
        startDate: '2026-10-01',
        dueDate: '2026-11-20',
        durationDays: 50,
        progress: 100,
        memberIds: ['u1'],
        color: '#64748b',
        isArchived: true,
      },
    ];

    const users: User[] = [
      {
        id: 'u1',
        name: 'Jan Nowak',
        email: 'jan@pracownia.pl',
        role: 'developer',
        department: 'Architektura',
        initials: 'JN',
        isApproved: true,
        // emailReminders undefined => domyślnie true (kompatybilność wsteczna)
      },
      {
        id: 'u2',
        name: 'Maria Wójcik',
        email: 'maria@pracownia.pl',
        role: 'developer',
        department: 'Konstrukcja',
        initials: 'MW',
        isApproved: true,
        emailReminders: false, // wyłączone przez użytkownika
      },
      {
        id: 'u3',
        name: 'Piotr Lis',
        email: 'piotr@pracownia.pl',
        role: 'developer',
        department: 'Sanitarka',
        initials: 'PL',
        isApproved: true,
        // brak zadań
      },
      {
        id: 'u4',
        name: 'Nowy Użytkownik',
        email: 'nowy@pracownia.pl',
        role: 'developer',
        department: 'Architektura',
        initials: 'NU',
        isApproved: false,
      },
    ];

    const baseTask = {
      projectId: 'p1',
      description: 'OPIS_FINANSOWY_TAJNY 123456 PLN',
      type: 'task',
      priority: 'high' as const,
      reporterId: 'u1',
      startDate: '2026-11-10',
      durationDays: 2,
      progress: 0,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    };

    const tasks: Task[] = [
      { ...baseTask, id: 't1', code: 'PR1-01', title: 'Zaległe o 2 dni', status: 'in_progress', assigneeId: 'u1', dueDate: '2026-11-14' },
      { ...baseTask, id: 't2', code: 'PR1-02', title: 'Zaległe o 4 dni (za stare)', status: 'to_do', assigneeId: 'u1', dueDate: '2026-11-12' },
      { ...baseTask, id: 't3', code: 'PR1-03', title: 'Na dziś', status: 'review', assigneeId: 'u1', dueDate: '2026-11-16' },
      { ...baseTask, id: 't4', code: 'PR1-04', title: 'Na jutro (za 1 dzień)', status: 'to_do', assigneeId: 'u1', dueDate: '2026-11-17' },
      { ...baseTask, id: 't5', code: 'PR1-05', title: 'Za 7 dni (poza daysBefore)', status: 'to_do', assigneeId: 'u1', dueDate: '2026-11-23' },
      { ...baseTask, id: 't6', code: 'PR1-06', title: 'Ukończone dziś', status: 'done', assigneeId: 'u1', dueDate: '2026-11-16' },
      { ...baseTask, id: 't7', code: 'PR1-07', title: 'Anulowane dziś', status: 'cancelled' as any, assigneeId: 'u1', dueDate: '2026-11-16' },
      { ...baseTask, id: 't8', code: 'ARC-01', title: 'W archiwum', status: 'to_do', projectId: 'p2', assigneeId: 'u1', dueDate: '2026-11-16' },
      { ...baseTask, id: 't9', code: 'PR1-09', title: 'Dla wyłączonej Marii', status: 'to_do', assigneeId: 'u2', dueDate: '2026-11-16' },
      { ...baseTask, id: 't10', code: 'PR1-10', title: 'Dla niezatwierdzonego', status: 'to_do', assigneeId: 'u4', dueDate: '2026-11-16' },
    ];

    const settings: ReminderSettings = {
      enabled: true,
      sendHour: 8,
      timezone: 'Europe/Warsaw',
      daysBefore: [1, 0],
      notifyOverdue: true,
      appBaseUrl: 'https://projekty.firma.pl',
    };

    const digests = buildDigests(tasks, projects, users, now, settings);
    expect(digests).toHaveLength(1);
    expect(digests[0].user.id).toBe('u1');
    expect(digests[0].totalTasks).toBe(3);
    expect(digests[0].sections.map((s) => s.title)).toEqual([
      'Po terminie',
      'Termin dziś',
      'Termin za 1 dzień',
    ]);
    expect(digests[0].sections[0].tasks.map((t) => t.id)).toEqual(['t1']);
    expect(digests[0].sections[1].tasks.map((t) => t.id)).toEqual(['t3']);
    expect(digests[0].sections[2].tasks.map((t) => t.id)).toEqual(['t4']);
  });

  it('pomija zadania projektów w niestandardowym stanie końcowym (isClosed: true)', () => {
    const now = Date.parse('2026-11-16T08:00:00.000Z');
    const projects: Project[] = [
      {
        id: 'p-open',
        key: 'OPEN',
        name: 'Projekt otwarty',
        description: '',
        priority: 'normal',
        status: 'active',
        startDate: '2026-11-01',
        dueDate: '2026-12-30',
        durationDays: 60,
        progress: 20,
        memberIds: ['u1'],
        color: '#0ea5e9',
      },
      {
        id: 'p-closed',
        key: 'CNCL',
        name: 'Projekt anulowany',
        description: '',
        priority: 'normal',
        status: 'cancelled',
        startDate: '2026-11-01',
        dueDate: '2026-12-30',
        durationDays: 60,
        progress: 0,
        memberIds: ['u1'],
        color: '#64748b',
      },
    ];
    const users: User[] = [
      {
        id: 'u1',
        name: 'Jan Nowak',
        email: 'jan@pracownia.pl',
        role: 'developer',
        department: 'Architektura',
        initials: 'JN',
        isApproved: true,
      },
    ];
    const tasks: Task[] = [
      {
        id: 't-open',
        projectId: 'p-open',
        code: 'OPEN-01',
        title: 'Zadanie aktywne',
        description: '',
        type: 'task',
        priority: 'normal',
        status: 'to_do',
        assigneeId: 'u1',
        reporterId: 'u1',
        startDate: '2026-11-10',
        dueDate: '2026-11-16',
        durationDays: 1,
        progress: 0,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      {
        id: 't-closed',
        projectId: 'p-closed',
        code: 'CNCL-01',
        title: 'Zadanie w anulowanym projekcie',
        description: '',
        type: 'task',
        priority: 'normal',
        status: 'to_do',
        assigneeId: 'u1',
        reporterId: 'u1',
        startDate: '2026-11-10',
        dueDate: '2026-11-16',
        durationDays: 1,
        progress: 0,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
    ];
    const settings: ReminderSettings = {
      enabled: true,
      sendHour: 8,
      timezone: 'Europe/Warsaw',
      daysBefore: [0],
      notifyOverdue: true,
      appBaseUrl: '',
    };
    const customStatuses = [
      { id: 'active', label: 'Aktywny', color: 'emerald' as const, order: 1, isDefault: true, isClosed: false },
      { id: 'cancelled', label: 'Anulowany', color: 'rose' as const, order: 2, isDefault: false, isClosed: true },
    ];

    const digests = buildDigests(tasks, projects, users, now, settings, customStatuses);
    expect(digests).toHaveLength(1);
    expect(digests[0].totalTasks).toBe(1);
    expect(digests[0].sections[0].tasks.map((t) => t.id)).toEqual(['t-open']);
  });

  it('escapuje HTML, pomija opisy i dane finansowe oraz dołącza linki wyłącznie gdy podano appBaseUrl', () => {
    const now = Date.parse('2026-11-16T08:00:00.000Z');
    const projects: Project[] = [
      {
        id: 'p1',
        key: 'XSS',
        name: 'Projekt <b>"Test"</b> & Co',
        description: 'Tajne',
        priority: 'normal',
        status: 'active',
        startDate: '2026-11-01',
        dueDate: '2026-11-30',
        durationDays: 30,
        progress: 0,
        budget: '888000 PLN',
        clientEmail: 'tajny@klient.pl',
        memberIds: ['u1'],
        color: '#000',
      },
    ];
    const users: User[] = [
      {
        id: 'u1',
        name: '<img src=x onerror=alert(1)>',
        email: 'u1@pracownia.pl',
        role: 'developer',
        department: 'D',
        initials: 'U1',
      },
    ];
    const tasks: Task[] = [
      {
        id: 'tsk-1',
        projectId: 'p1',
        code: 'XSS-01',
        title: '<script>alert("xss")</script> & sprawdzenie',
        description: 'TAJNY_OPIS_ZADANIA',
        type: 'task',
        priority: 'critical',
        status: 'in_progress',
        assigneeId: 'u1',
        reporterId: 'u1',
        startDate: '2026-11-10',
        dueDate: '2026-11-16',
        durationDays: 1,
        progress: 0,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
    ];

    const settings: ReminderSettings = {
      enabled: true,
      sendHour: 8,
      timezone: 'Europe/Warsaw',
      daysBefore: [0],
      notifyOverdue: true,
      appBaseUrl: 'https://projekty.biuro.pl/',
    };

    const digests = buildDigests(tasks, projects, users, now, settings);
    const emailWithUrl = renderDigestEmail(digests[0], settings.appBaseUrl);

    expect(emailWithUrl.html).not.toContain('<script>');
    expect(emailWithUrl.html).not.toContain('<img src=x');
    expect(emailWithUrl.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(emailWithUrl.html).toContain('Krytyczny (P1)');
    expect(emailWithUrl.html).toContain('W toku');
    expect(emailWithUrl.html).toContain('https://projekty.biuro.pl/?task=tsk-1');
    expect(emailWithUrl.html).not.toContain('TAJNY_OPIS_ZADANIA');
    expect(emailWithUrl.html).not.toContain('888000 PLN');
    expect(emailWithUrl.html).not.toContain('tajny@klient.pl');
    expect(emailWithUrl.text).toContain('Aby wyłączyć dzienne przypomnienia e-mail');

    const emailNoUrl = renderDigestEmail(digests[0], '');
    expect(emailNoUrl.html).not.toContain('?task=');
    expect(emailNoUrl.text).not.toContain('?task=');
  });

  it('shouldRunNow i walidacja strefy czasowej IANA oraz ustawień w settingsSchema działają poprawnie', () => {
    expect(isValidIanaTimezone('Europe/Warsaw')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Invalid/Zone_123')).toBe(false);

    const settings: ReminderSettings = {
      enabled: true,
      sendHour: 8,
      timezone: 'Europe/Warsaw',
      daysBefore: [1, 0],
      notifyOverdue: true,
      appBaseUrl: '',
    };

    // 06:30 UTC w zimie = 07:30 CET (przed 8:00)
    expect(shouldRunNow(Date.parse('2026-11-16T06:30:00Z'), settings, null)).toBe(false);
    // 07:05 UTC w zimie = 08:05 CET (po 8:00)
    expect(shouldRunNow(Date.parse('2026-11-16T07:05:00Z'), settings, null)).toBe(true);
    // Już wysłano dzisiaj
    expect(shouldRunNow(Date.parse('2026-11-16T07:05:00Z'), settings, '2026-11-16')).toBe(false);
    // Wysłano wczoraj
    expect(shouldRunNow(Date.parse('2026-11-16T07:05:00Z'), settings, '2026-11-15')).toBe(true);
    // Wyłączone
    expect(shouldRunNow(Date.parse('2026-11-16T07:05:00Z'), { ...settings, enabled: false }, null)).toBe(false);

    expect(
      computeNextScheduledAt(Date.parse('2026-11-16T06:30:00Z'), settings, null)
    ).toBe('2026-11-16T07:00:00.000Z');

    const badValidation = validateAdminSettingsUpdate(
      {
        reminders: {
          sendHour: 25,
          timezone: 'Bad/Timezone',
          daysBefore: [0, 5],
          appBaseUrl: 'javascript:alert(1)',
        },
      },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(badValidation.ok).toBe(false);
    expect(badValidation.errors.length).toBe(4);
  });
});

describe('Scheduler przypomnień (src/server/reminders.ts) — odporność na awarie i limity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-rem-sched-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('wysyła maks. 1 e-mail/osobę dziennie, toleruje błąd jednego odbiorcy i respektuje deduplikację po restarcie', async () => {
    const config = resolveServerConfig({
      dataDir: tmpDir,
      appSecret: TEST_APP_SECRET,
      isProduction: true,
    });
    const stateStore = await createStateStore(config);
    const appState = stateStore.ensureStateStructure();
    appState.users = [
      { id: 'u1', name: 'Adam Jeden', email: 'adam@pracownia.pl', role: 'developer', isApproved: true },
      { id: 'u2', name: 'Ewa Dwa', email: 'ewa@pracownia.pl', role: 'developer', isApproved: true },
      { id: 'u3', name: 'Brak Zadań', email: 'brak@pracownia.pl', role: 'developer', isApproved: true },
    ];
    appState.projects = [
      { id: 'p1', key: 'PRJ', name: 'Projekt Test', status: 'active', memberIds: ['u1', 'u2'] },
    ];
    appState.tasks = [
      { id: 't1', projectId: 'p1', code: 'PRJ-01', title: 'Zadanie Adama', status: 'to_do', priority: 'high', assigneeId: 'u1', dueDate: '2026-11-16' },
      { id: 't2', projectId: 'p1', code: 'PRJ-02', title: 'Zadanie Ewy 1', status: 'to_do', priority: 'normal', assigneeId: 'u2', dueDate: '2026-11-16' },
      { id: 't3', projectId: 'p1', code: 'PRJ-03', title: 'Zadanie Ewy 2', status: 'in_progress', priority: 'critical', assigneeId: 'u2', dueDate: '2026-11-17' },
    ];
    appState.serverSettings = {
      reminders: {
        enabled: true,
        sendHour: 8,
        timezone: 'Europe/Warsaw',
        daysBefore: [1, 0],
        notifyOverdue: true,
        appBaseUrl: 'https://app.test',
      },
    };
    stateStore.setAppState(appState);
    stateStore.setUsers(appState.users);
    await stateStore.saveStateAtomicAsync();

    const settingsService = createSettingsService({ config, stateStore });
    const sentTo: string[] = [];
    let failFirst = true;
    const delayCalls: number[] = [];

    const mockMailer: MailerService = {
      isMailConfigured: () => true,
      sendMail: async (mail) => {
        const to = Array.isArray(mail.to) ? mail.to[0] : mail.to;
        if (to === 'adam@pracownia.pl' && failFirst) {
          throw new Error('ECONNREFUSED');
        }
        sentTo.push(to);
      },
    };

    const fixedNow = Date.parse('2026-11-16T07:30:00.000Z'); // 08:30 CET
    const service = createReminderService({
      stateStore,
      settingsService,
      mailer: mockMailer,
      disableTimers: true,
      now: () => fixedNow,
      sendDelayMs: 1000,
      delayFn: async (ms) => {
        delayCalls.push(ms);
      },
    });

    // Pierwszy przebieg: błąd dla Adama nie przerywa wysyłki do Ewy
    const firstResult = await service.tick();
    expect(firstResult).not.toBeNull();
    expect(firstResult!.sentCount).toBe(1);
    expect(firstResult!.errorCount).toBe(1);
    expect(firstResult!.skippedCount).toBe(1); // u3 bez zadań
    expect(sentTo).toEqual(['ewa@pracownia.pl']);
    expect(delayCalls).toEqual([1000]);

    // Drugi tick tego samego dnia NIE wysyła ponownie
    const secondTick = await service.tick();
    expect(secondTick).toBeNull();
    expect(sentTo).toEqual(['ewa@pracownia.pl']);

    // Symulacja przerwania w trakcie przebiegu (lastRunDate wyczyszczone, ale sentUserIdsToday zawiera u2)
    failFirst = false;
    const afterCrashState = stateStore.getAppState();
    expect(afterCrashState.reminderState.sentUserIdsToday).toEqual(['u2']);
    afterCrashState.reminderState.lastRunDate = null;
    stateStore.setAppState(afterCrashState);

    const recoveryResult = await service.tick();
    expect(recoveryResult!.sentCount).toBe(1); // tylko Adam!
    expect(recoveryResult!.skippedCount).toBe(2); // u3 + już obsłużona u2
    expect(sentTo).toEqual(['ewa@pracownia.pl', 'adam@pracownia.pl']);

    // Sprawdź log bezpieczeństwa: są liczniki, brak adresów e-mail i tytułów zadań
    const events = await stateStore.securityLogger.getRecentEvents(20);
    const sentEvents = events.filter((e) => e.type === 'reminders_sent');
    const failedEvents = events.filter((e) => e.type === 'reminders_failed');
    expect(sentEvents.length).toBeGreaterThanOrEqual(1);
    expect(failedEvents.length).toBe(1);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('adam@pracownia.pl');
    expect(serialized).not.toContain('ewa@pracownia.pl');
    expect(serialized).not.toContain('Zadanie Adama');
  });

  it('przy braku konfiguracji SMTP zapisuje status błędu i nie wysyła wiadomości', async () => {
    const config = resolveServerConfig({
      dataDir: tmpDir,
      appSecret: TEST_APP_SECRET,
      isProduction: true,
    });
    const stateStore = await createStateStore(config);
    const appState = stateStore.ensureStateStructure();
    appState.serverSettings = {
      reminders: { enabled: true, sendHour: 8, timezone: 'Europe/Warsaw' },
    };
    stateStore.setAppState(appState);

    const settingsService = createSettingsService({ config, stateStore });
    const sendMailSpy = vi.fn();
    const mockMailer: MailerService = {
      isMailConfigured: () => false,
      sendMail: sendMailSpy,
    };

    const service = createReminderService({
      stateStore,
      settingsService,
      mailer: mockMailer,
      disableTimers: true,
      now: () => Date.parse('2026-11-16T08:00:00.000Z'),
    });

    const result = await service.tick();
    expect(result).not.toBeNull();
    expect(result!.smtpConfigured).toBe(false);
    expect(result!.sentCount).toBe(0);
    expect(result!.errorCount).toBe(1);
    expect(sendMailSpy).not.toHaveBeenCalled();

    const status = service.getStatus();
    expect(status.smtpConfigured).toBe(false);
    expect(status.lastError).toContain('SMTP');
  });
});

describe('Endpointy API przypomnień, preferencji i nadpisania env', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['REMINDERS_ENABLED', 'REMINDER_TIMEZONE', 'REMINDER_SEND_HOUR'];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('izoluje reminderState przed /api/state, chroni endpointy admina oraz obsługuje preview (3/godz.), run-now i PATCH /api/auth/preferences', async () => {
    const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: vi.fn(async (opts: any) => {
        sentEmails.push({
          to: String(opts.to),
          subject: String(opts.subject),
          html: String(opts.html || ''),
        });
        return { messageId: 'mock-id' };
      }),
    } as any);

    const srv = await startServer({ publicBaseUrl: 'https://biuro.example.pl' });
    try {
      const { cookie: adminCookie, user: adminUser } = await setupAdmin(srv.baseUrl, 'admin@biuro.pl');

      // Dodaj projekt i zwykłego użytkownika
      const createUserRes = await fetch(`${srv.baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Marek Projektant',
          email: 'marek@biuro.pl',
          role: 'developer',
          department: 'Konstrukcja',
          password: USER_PASS,
        }),
      });
      expect(createUserRes.status).toBe(200);
      const { user: marek } = await createUserRes.json();

      // Zaloguj się jako Marek
      const marekLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'marek@biuro.pl', password: USER_PASS }),
      });
      const marekCookie = extractSessionCookie(marekLogin);

      // Marek nie ma dostępu do endpointów admina
      const forbiddenStatus = await fetch(`${srv.baseUrl}/api/admin/reminders/status`, {
        headers: { Cookie: marekCookie },
      });
      expect(forbiddenStatus.status).toBe(403);

      // Anonimowy nie może zmieniać preferencji
      const unauthPref = await fetch(`${srv.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailReminders: false }),
      });
      expect(unauthPref.status).toBe(401);

      // Skonfiguruj SMTP i przypomnienia (wyłączone na start, żeby przetestować preview przy enabled=false)
      const putRes = await fetch(`${srv.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          smtp: { host: 'smtp.biuro.pl', port: 587, encryption: 'starttls' },
          reminders: {
            enabled: false,
            sendHour: 9,
            timezone: 'Europe/Warsaw',
            daysBefore: [0, 1, 7],
            notifyOverdue: true,
          },
        }),
      });
      expect(putRes.status).toBe(200);
      const putJson = await putRes.json();
      expect(putJson.settings.reminders.appBaseUrl.value).toBe('https://biuro.example.pl');

      // Utwórz projekt i zadanie na dziś przypisane do admina oraz Marka
      const todayIso = localDateString(Date.now(), 'Europe/Warsaw');
      const projRes = await fetch(`${srv.baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          key: 'REM',
          name: 'Projekt Przypomnień',
          priority: 'high',
          status: 'active',
          startDate: todayIso,
          dueDate: todayIso,
          durationDays: 5,
          memberIds: [adminUser.id, marek.id],
        }),
      });
      expect(projRes.status).toBe(201);
      const { project } = await projRes.json();

      for (const [assigneeId, title] of [
        [adminUser.id, 'Zadanie Admina Dziś'],
        [marek.id, 'Zadanie Marka Dziś'],
      ] as const) {
        const taskRes = await fetch(`${srv.baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            projectId: project.id,
            title,
            status: 'to_do',
            priority: 'high',
            assigneeId,
            startDate: todayIso,
            dueDate: todayIso,
          }),
        });
        expect(taskRes.status).toBe(201);
      }

      // Preview wysyła wyłącznie do admina nawet przy enabled=false (maks. 3/godz.)
      for (let i = 0; i < 3; i++) {
        const prevRes = await fetch(`${srv.baseUrl}/api/admin/reminders/preview`, {
          method: 'POST',
          headers: { Cookie: adminCookie },
        });
        expect(prevRes.status).toBe(200);
      }
      expect(sentEmails).toHaveLength(3);
      expect(sentEmails.every((m) => m.to === 'admin@biuro.pl')).toBe(true);
      expect(sentEmails[0].subject).toContain('[PODGLĄD]');
      expect(sentEmails[0].html).toContain('https://biuro.example.pl/?task=');

      // 4. wywołanie preview w tej samej godzinie zwraca 429
      const rateLimitedPrev = await fetch(`${srv.baseUrl}/api/admin/reminders/preview`, {
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      expect(rateLimitedPrev.status).toBe(429);

      // Marek wyłącza własne przypomnienia przez PATCH /api/auth/preferences
      const prefOffRes = await fetch(`${srv.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: marekCookie },
        body: JSON.stringify({ emailReminders: false }),
      });
      expect(prefOffRes.status).toBe(200);
      const prefOffJson = await prefOffRes.json();
      expect(prefOffJson.user.emailReminders).toBe(false);

      // Ręczne uruchomienie run-now powinno wysłać tylko do admina (Marek ma opt-out)
      sentEmails.length = 0;
      const runNowRes = await fetch(`${srv.baseUrl}/api/admin/reminders/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ force: false }),
      });
      expect(runNowRes.status).toBe(200);
      const runNowJson = await runNowRes.json();
      expect(runNowJson.sentCount).toBe(1);
      expect(sentEmails.map((m) => m.to)).toEqual(['admin@biuro.pl']);

      // Ponowne wywołanie bez force pomija admina
      const runNowRepeat = await fetch(`${srv.baseUrl}/api/admin/reminders/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ force: false }),
      });
      const repeatJson = await runNowRepeat.json();
      expect(repeatJson.sentCount).toBe(0);

      // Wywołanie z force=true wysyła ponownie
      const runNowForce = await fetch(`${srv.baseUrl}/api/admin/reminders/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ force: true }),
      });
      const forceJson = await runNowForce.json();
      expect(forceJson.sentCount).toBe(1);

      // Sprawdź, że GET /api/state NIE ujawnia reminderState ani serverSettings
      const stateRes = await fetch(`${srv.baseUrl}/api/state`, {
        headers: { Cookie: adminCookie },
      });
      const stateJson = await stateRes.json();
      expect(stateJson.state.reminderState).toBeUndefined();
      expect(stateJson.state.serverSettings).toBeUndefined();
    } finally {
      await srv.close();
    }
  });

  it('zmienne środowiskowe REMINDERS_ENABLED, REMINDER_TIMEZONE i REMINDER_SEND_HOUR nadpisują i blokują pola w UI', async () => {
    process.env.REMINDERS_ENABLED = 'true';
    process.env.REMINDER_TIMEZONE = 'UTC';
    process.env.REMINDER_SEND_HOUR = '6';

    const srv = await startServer();
    try {
      const { cookie } = await setupAdmin(srv.baseUrl);
      const res = await fetch(`${srv.baseUrl}/api/admin/settings`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const settings = await res.json();

      expect(settings.reminders.enabled).toEqual({
        value: true,
        source: 'env',
        locked: true,
        envVar: 'REMINDERS_ENABLED',
      });
      expect(settings.reminders.timezone).toEqual({
        value: 'UTC',
        source: 'env',
        locked: true,
        envVar: 'REMINDER_TIMEZONE',
      });
      expect(settings.reminders.sendHour).toEqual({
        value: 6,
        source: 'env',
        locked: true,
        envVar: 'REMINDER_SEND_HOUR',
      });

      const conflictRes = await fetch(`${srv.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          reminders: { timezone: 'Europe/Warsaw' },
        }),
      });
      expect(conflictRes.status).toBe(409);
      const conflictJson = await conflictRes.json();
      expect(conflictJson.envVar).toBe('REMINDER_TIMEZONE');
    } finally {
      await srv.close();
    }
  });
});
