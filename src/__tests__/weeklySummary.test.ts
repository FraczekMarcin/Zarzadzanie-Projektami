import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import nodemailer from 'nodemailer';
import { createApp, CreateAppOptions } from '../../server.js';
import {
  buildWeeklySummary,
  isoWeekKey,
  nextWeeklyRun,
  renderWeeklySummaryEmail,
  shouldRunWeeklyNow,
  WeeklySummarySettings,
} from '../utils/weeklySummary.js';
import { localDateString } from '../utils/reminders.js';
import { validateAdminSettingsUpdate } from '../utils/settingsSchema.js';
import { resolveServerConfig } from '../server/config.js';
import { createStateStore } from '../server/state.js';
import { createSettingsService } from '../server/settings.js';
import { MailerService } from '../server/mailer.js';
import { createWeeklySummaryService } from '../server/weeklySummary.js';
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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-weekly-'));
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
    weeklySummaryDisableTimers: true,
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

function makeProject(overrides: Partial<Project> & { id: string; key: string; name: string }): Project {
  return {
    description: '',
    priority: 'normal',
    status: 'active',
    startDate: '2026-11-01',
    dueDate: '2026-12-31',
    durationDays: 60,
    progress: 0,
    memberIds: [],
    color: '#0ea5e9',
    isArchived: false,
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<Task> & { id: string; projectId: string; code: string; title: string; dueDate: string }
): Task {
  return {
    description: '',
    type: 'task',
    priority: 'normal',
    status: 'to_do',
    assigneeId: '',
    reporterId: 'u-pm',
    startDate: '2026-11-01',
    durationDays: 1,
    progress: 0,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

function makeBaseSettings(overrides: Partial<WeeklySummarySettings> = {}): WeeklySummarySettings {
  return {
    enabled: true,
    dayOfWeek: 1,
    time: '08:00',
    timezone: 'Europe/Warsaw',
    windowDays: 7,
    includeAdmins: true,
    maxItemsPerProject: 15,
    appBaseUrl: 'https://projekty.firma.pl',
    ...overrides,
  };
}

describe('Podsumowanie tygodniowe — logika czysta (src/utils/weeklySummary.ts)', () => {
  it('isoWeekKey poprawnie obsługuje przełomy roku i tygodnie W53 (ISO 8601) oraz granice doby w strefie czasowej', () => {
    expect(isoWeekKey(Date.parse('2020-12-31T12:00:00.000Z'), 'Europe/Warsaw')).toBe('2020-W53');
    expect(isoWeekKey(Date.parse('2021-01-01T12:00:00.000Z'), 'Europe/Warsaw')).toBe('2020-W53');
    expect(isoWeekKey(Date.parse('2021-01-04T12:00:00.000Z'), 'Europe/Warsaw')).toBe('2021-W01');
    expect(isoWeekKey(Date.parse('2024-12-30T12:00:00.000Z'), 'Europe/Warsaw')).toBe('2025-W01');
    expect(isoWeekKey(Date.parse('2026-12-31T12:00:00.000Z'), 'Europe/Warsaw')).toBe('2026-W53');

    // Niedziela 2026-11-15 23:30 UTC => w Warszawie już poniedziałek 2026-11-16 00:30 (W47)
    const sunLateUtc = Date.parse('2026-11-15T23:30:00.000Z');
    expect(isoWeekKey(sunLateUtc, 'UTC')).toBe('2026-W46');
    expect(isoWeekKey(sunLateUtc, 'Europe/Warsaw')).toBe('2026-W47');
  });

  it('shouldRunWeeklyNow i nextWeeklyRun uwzględniają godzinę, okno nadrabiania 24h, deduplikację i DST', () => {
    const settings = makeBaseSettings({
      enabled: true,
      dayOfWeek: 1, // poniedziałek
      time: '08:30',
      timezone: 'Europe/Warsaw',
    });

    // Wyłączone
    expect(
      shouldRunWeeklyNow(Date.parse('2026-11-16T08:00:00.000Z'), { ...settings, enabled: false }, null)
    ).toBe(false);
    expect(
      nextWeeklyRun(Date.parse('2026-11-16T08:00:00.000Z'), { ...settings, enabled: false }, null)
    ).toBeNull();

    // Poniedziałek 2026-11-16 08:15 CET (07:15 UTC) — przed godziną 08:30
    const monBefore = Date.parse('2026-11-16T07:15:00.000Z');
    expect(shouldRunWeeklyNow(monBefore, settings, null)).toBe(false);
    expect(nextWeeklyRun(monBefore, settings, null)).toBe('2026-11-16T07:30:00.000Z');

    // Poniedziałek 2026-11-16 08:35 CET (07:35 UTC) — po godzinie 08:30
    const monAfter = Date.parse('2026-11-16T07:35:00.000Z');
    expect(shouldRunWeeklyNow(monAfter, settings, null)).toBe(true);
    // Deduplikacja dla tego samego tygodnia 2026-W47
    expect(shouldRunWeeklyNow(monAfter, settings, '2026-W47')).toBe(false);
    expect(nextWeeklyRun(monAfter, settings, '2026-W47')).toBe('2026-11-23T07:30:00.000Z');

    // Nadrabianie zaległości do 24h (wtorek 08:29 CET -> 23h59m po terminie)
    const tueCatchup = Date.parse('2026-11-17T07:29:00.000Z');
    expect(shouldRunWeeklyNow(tueCatchup, settings, '2026-W46')).toBe(true);

    // Powyżej 24h (wtorek 08:31 CET -> 24h01m po terminie) — już NIE nadrabia
    const tueTooLate = Date.parse('2026-11-17T07:31:00.000Z');
    expect(shouldRunWeeklyNow(tueTooLate, settings, '2026-W46')).toBe(false);

    // Zmiana czasu DST (wiosna 2026-03-29 w Europe/Warsaw: przejście z CET UTC+1 na CEST UTC+2)
    const beforeSpringDst = Date.parse('2026-03-28T10:00:00.000Z'); // sobota
    const springMonday = nextWeeklyRun(
      beforeSpringDst,
      makeBaseSettings({ dayOfWeek: 1, time: '08:00', timezone: 'Europe/Warsaw' }),
      null
    );
    // 2026-03-30 08:00 CEST = 06:00:00Z
    expect(springMonday).toBe('2026-03-30T06:00:00.000Z');

    // Pominięta godzina w nocy DST: niedziela 2026-03-29 02:30 (w Warszawie przeskok 02:00->03:00 -> 01:00Z)
    const springSkippedHour = nextWeeklyRun(
      beforeSpringDst,
      makeBaseSettings({ dayOfWeek: 7, time: '02:30', timezone: 'Europe/Warsaw' }),
      null
    );
    expect(springSkippedHour).toBe('2026-03-29T01:00:00.000Z');

    // Zmiana czasu DST (jesień 2026-10-25 w Europe/Warsaw: przejście z CEST UTC+2 na CET UTC+1)
    const beforeAutumnDst = Date.parse('2026-10-24T10:00:00.000Z');
    const autumnMonday = nextWeeklyRun(
      beforeAutumnDst,
      makeBaseSettings({ dayOfWeek: 1, time: '08:00', timezone: 'Europe/Warsaw' }),
      null
    );
    // 2026-10-26 08:00 CET = 07:00:00Z
    expect(autumnMonday).toBe('2026-10-26T07:00:00.000Z');
  });

  it('buildWeeklySummary agreguje po projektach, sortuje, ogranicza listę i filtruje role/statusy', () => {
    const now = Date.parse('2026-11-16T08:00:00.000Z'); // 09:00 CET w Warszawie
    const users: User[] = [
      {
        id: 'u-pm',
        name: 'Katarzyna Kierownik',
        email: 'pm@pracownia.pl',
        role: 'project_manager',
        department: 'Zarządzanie',
        initials: 'KK',
        isApproved: true,
        weeklySummary: true,
      },
      {
        id: 'u-pm-optout',
        name: 'Piotr Wycofany',
        email: 'pm2@pracownia.pl',
        role: 'project_manager',
        department: 'Zarządzanie',
        initials: 'PW',
        isApproved: true,
        weeklySummary: false,
      },
      {
        id: 'u-admin',
        name: 'Anna Admin',
        email: 'admin@pracownia.pl',
        role: 'admin',
        department: 'Zarząd',
        initials: 'AA',
        isApproved: true,
      },
      {
        id: 'u-dev',
        name: 'Jan Projektant',
        email: 'dev@pracownia.pl',
        role: 'developer',
        department: 'Konstrukcje',
        initials: 'JP',
        isApproved: true,
        weeklySummary: true,
      },
      {
        id: 'u-pending',
        name: 'Marek Oczekujący',
        email: 'pending@pracownia.pl',
        role: 'project_manager',
        department: 'Instalacje',
        initials: 'MO',
        isApproved: false,
      },
    ];

    const projects: Project[] = [
      makeProject({ id: 'p-1', key: 'HALA', name: 'Hala Przemysłowa', isArchived: false }),
      makeProject({ id: 'p-clean', key: 'BIURO', name: 'Biurowiec Centrum', isArchived: false }),
      makeProject({ id: 'p-arch', key: 'ARCH', name: 'Projekt Archiwalny', isArchived: true }),
    ];

    const tasks: Task[] = [
      makeTask({
        id: 't-over-10',
        projectId: 'p-1',
        code: 'HALA-1',
        title: 'Projekt fundamentów',
        description: 'TAJNY OPIS TECHNICZNY',
        status: 'in_progress',
        priority: 'high',
        assigneeId: 'u-dev',
        dueDate: '2026-11-06', // 10 dni po terminie
      }),
      makeTask({
        id: 't-over-2',
        projectId: 'p-1',
        code: 'HALA-2',
        title: 'Uzgodnienie PPOŻ',
        status: 'to_do',
        priority: 'normal',
        assigneeId: '',
        dueDate: '2026-11-14', // 2 dni po terminie, nieprzypisane
      }),
      makeTask({
        id: 't-up-0',
        projectId: 'p-1',
        code: 'HALA-3',
        title: 'Oddanie rysunków',
        status: 'review',
        priority: 'critical',
        assigneeId: 'u-dev',
        dueDate: '2026-11-16', // dziś
      }),
      makeTask({
        id: 't-up-10',
        projectId: 'p-1',
        code: 'HALA-4',
        title: 'Wniosek o pozwolenie',
        status: 'to_do',
        priority: 'normal',
        assigneeId: 'u-dev',
        dueDate: '2026-11-26', // za 10 dni (w oknie 14, poza 7)
      }),
      makeTask({
        id: 't-done',
        projectId: 'p-1',
        code: 'HALA-5',
        title: 'Zadanie ukończone',
        status: 'done',
        priority: 'low',
        assigneeId: 'u-dev',
        dueDate: '2026-11-01',
      }),
      makeTask({
        id: 't-cancelled',
        projectId: 'p-1',
        code: 'HALA-6',
        title: 'Zadanie anulowane',
        status: 'cancelled' as any,
        priority: 'low',
        assigneeId: 'u-dev',
        dueDate: '2026-11-02',
      }),
      makeTask({
        id: 't-clean-later',
        projectId: 'p-clean',
        code: 'BIURO-1',
        title: 'Zadanie za 30 dni',
        status: 'to_do',
        priority: 'normal',
        assigneeId: 'u-dev',
        dueDate: '2026-12-16', // poza oknem 7/14, więc projekt ma open=1 ale brak zaległych/kończących się
      }),
      makeTask({
        id: 't-arch',
        projectId: 'p-arch',
        code: 'ARCH-1',
        title: 'Zadanie z archiwum',
        status: 'to_do',
        priority: 'critical',
        assigneeId: 'u-dev',
        dueDate: '2026-11-05',
      }),
    ];

    // Okno 7 dni + includeAdmins: true
    const summaries = buildWeeklySummary(
      tasks,
      projects,
      users,
      now,
      makeBaseSettings({ windowDays: 7, includeAdmins: true })
    );
    expect(summaries.map((s) => s.user.id)).toEqual(['u-pm', 'u-admin']);
    const s = summaries[0];
    expect(s.weekKey).toBe('2026-W47');
    expect(s.totalOpen).toBe(5); // 4 w p-1 + 1 w p-clean (p-arch, done, cancelled pominięte)
    expect(s.totalOverdue).toBe(2);
    expect(s.totalUpcoming).toBe(1);
    expect(s.projects).toHaveLength(1);
    expect(s.cleanProjects.map((p) => p.projectId)).toEqual(['p-clean']);

    const hala = s.projects[0];
    expect(hala.overdueItems.map((i) => i.id)).toEqual(['t-over-10', 't-over-2']); // najpierw 10 dni, potem 2 dni
    expect(hala.overdueItems[0].daysOverdue).toBe(10);
    expect(hala.overdueItems[0].assigneeName).toBe('Jan Projektant');
    expect(hala.overdueItems[1].assigneeName).toBe('nieprzypisane');
    expect(hala.upcomingItems.map((i) => i.id)).toEqual(['t-up-0']);

    // Okno 14 dni + includeAdmins: false -> tylko u-pm i dochodzi t-up-10
    const summaries14 = buildWeeklySummary(
      tasks,
      projects,
      users,
      now,
      makeBaseSettings({ windowDays: 14, includeAdmins: false })
    );
    expect(summaries14.map((x) => x.user.id)).toEqual(['u-pm']);
    expect(summaries14[0].totalUpcoming).toBe(2);
    expect(summaries14[0].projects[0].upcomingItems.map((i) => i.id)).toEqual(['t-up-0', 't-up-10']);

    // Sprawdzenie limitu maxItemsPerProject (minimalnie 5)
    const manyTasks: Task[] = Array.from({ length: 8 }, (_, idx) =>
      makeTask({
        id: `many-${idx}`,
        projectId: 'p-1',
        code: `M-${idx + 1}`,
        title: `Zaległe #${idx + 1}`,
        assigneeId: 'u-dev',
        dueDate: `2026-11-0${Math.min(9, idx + 1)}`,
      })
    );
    const limited = buildWeeklySummary(
      manyTasks,
      projects,
      users,
      now,
      makeBaseSettings({ maxItemsPerProject: 5 })
    );
    expect(limited[0].projects[0].overdueItems).toHaveLength(5);
    expect(limited[0].projects[0].overdueOverflow).toBe(3);
  });

  it('renderWeeklySummaryEmail generuje poprawny temat, tabele HTML, bezpieczne escapowanie i brak danych poufnych', () => {
    const now = Date.parse('2026-11-16T08:00:00.000Z');
    const summary = buildWeeklySummary(
      [
        makeTask({
          id: 't-xss',
          projectId: 'p-xss',
          code: 'XSS-1',
          title: '<script>alert("xss")</script> Belka',
          description: 'POUFNY_OPIS_NIE_POWINIEN_TRAFIC_DO_MAILA',
          status: 'in_progress',
          priority: 'critical',
          assigneeId: 'u-dev',
          dueDate: '2026-11-10',
        }),
        makeTask({
          id: 't-up',
          projectId: 'p-xss',
          code: 'XSS-2',
          title: 'Przekazanie do urzędu',
          status: 'to_do',
          priority: 'high',
          assigneeId: '',
          dueDate: '2026-11-19',
        }),
      ],
      [
        makeProject({ id: 'p-xss', key: 'HALA', name: '<b>Hala & Biuro</b>', budget: '987654 PLN', isArchived: false }),
        makeProject({ id: 'p-ok', key: 'MAG', name: 'Magazyn', isArchived: false }),
      ],
      [
        {
          id: 'u-pm',
          name: 'Adam <img src=x>',
          email: 'pm@pracownia.pl',
          role: 'project_manager',
          department: 'Zarządzanie',
          initials: 'AA',
          isApproved: true,
        },
        {
          id: 'u-dev',
          name: 'Ewa "Projektant"',
          email: 'dev@pracownia.pl',
          role: 'developer',
          department: 'Konstrukcje',
          initials: 'EP',
          isApproved: true,
        },
      ],
      now,
      makeBaseSettings({ maxItemsPerProject: 15 })
    )[0];

    const withLinks = renderWeeklySummaryEmail(summary, 'https://projekty.pracownia.pl/');
    expect(withLinks.subject).toBe('Podsumowanie tygodnia: zaległe 1, kończące się 1 (2026-W47)');
    expect(withLinks.html).not.toContain('<script>');
    expect(withLinks.html).not.toContain('<img src=x>');
    expect(withLinks.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(withLinks.html).toContain('https://projekty.pracownia.pl/?task=t-xss');
    expect(withLinks.html).toContain('Krytyczny (P1)');
    expect(withLinks.html).toContain('W toku');
    expect(withLinks.html).toContain('Bez uwag:');
    expect(withLinks.html).toContain('[MAG] Magazyn');
    expect(withLinks.html).not.toContain('POUFNY_OPIS_NIE_POWINIEN_TRAFIC_DO_MAILA');
    expect(withLinks.html).not.toContain('987654');
    expect(withLinks.text).not.toContain('POUFNY_OPIS_NIE_POWINIEN_TRAFIC_DO_MAILA');

    // Brak lub nieprawidłowy appBaseUrl => bez linków klikalnych
    const noLinks = renderWeeklySummaryEmail(summary, 'javascript:alert(1)');
    expect(noLinks.html).not.toContain('?task=');
    expect(noLinks.text).not.toContain('?task=');
  });
});

describe('Podsumowanie tygodniowe — scheduler i odporność na awarie (src/server/weeklySummary.ts)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-ws-sched-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('wysyła z odstępem 1s, pomija puste raporty, izoluje błędy i wznawia po restarcie bez duplikatów', async () => {
    const config = resolveServerConfig({
      dataDir: tmpDir,
      appSecret: TEST_APP_SECRET,
      isProduction: true,
    });
    const stateStore = await createStateStore(config);
    const appState = stateStore.ensureStateStructure();

    appState.users = [
      {
        id: 'pm-1',
        name: 'PM Jeden',
        email: 'pm1@pracownia.pl',
        role: 'project_manager',
        department: 'Zarządzanie',
        initials: 'P1',
        isApproved: true,
      },
      {
        id: 'pm-2',
        name: 'PM Dwa',
        email: 'pm2@pracownia.pl',
        role: 'project_manager',
        department: 'Zarządzanie',
        initials: 'P2',
        isApproved: true,
      },
      {
        id: 'admin-1',
        name: 'Admin Trzy',
        email: 'admin@pracownia.pl',
        role: 'admin',
        department: 'Zarząd',
        initials: 'A3',
        isApproved: true,
      },
    ];
    appState.projects = [
      makeProject({ id: 'p-1', key: 'H1', name: 'Hala', isArchived: false }),
    ];
    appState.tasks = [
      makeTask({
        id: 't-1',
        projectId: 'p-1',
        code: 'H1-1',
        title: 'Zadanie po terminie',
        status: 'to_do',
        priority: 'high',
        assigneeId: 'pm-1',
        dueDate: '2026-11-10',
      }),
    ];
    appState.serverSettings = {
      weeklySummary: {
        enabled: true,
        dayOfWeek: 1,
        time: '08:00',
        windowDays: 7,
        includeAdmins: true,
        maxItemsPerProject: 15,
      },
    };
    stateStore.setAppState(appState);

    const settingsService = createSettingsService({ config, stateStore });
    const sentEmails: Array<{ to: string; subject: string }> = [];
    let configured = false;
    let failRecipient: string | null = null;

    const fakeMailer: MailerService = {
      isMailConfigured: () => configured,
      sendMail: async (msg) => {
        const to = Array.isArray(msg.to) ? msg.to[0] : msg.to;
        if (failRecipient && to === failRecipient) {
          throw new Error('SMTP 450 temporary failure');
        }
        sentEmails.push({ to, subject: msg.subject });
      },
    };

    const fixedNow = Date.parse('2026-11-16T08:00:00.000Z'); // poniedziałek 09:00 CET
    const delays: number[] = [];

    const service = createWeeklySummaryService({
      stateStore,
      settingsService,
      mailer: fakeMailer,
      disableTimers: true,
      now: () => fixedNow,
      delayFn: async (ms) => {
        delays.push(ms);
      },
      sendDelayMs: 1000,
    });

    // 1. Brak SMTP -> zapisuje status i event błędu bez wysyłki
    const noSmtpRes = await service.tick();
    expect(noSmtpRes?.executed).toBe(false);
    expect(noSmtpRes?.smtpConfigured).toBe(false);
    expect(service.getStatus().lastError).toContain('SMTP');

    // 2. Włączamy SMTP, ale pm2 ma zawieść -> pm1 i admin dostają, pm2 rejestruje błąd
    configured = true;
    failRecipient = 'pm2@pracownia.pl';
    const partialRes = await service.tick();
    expect(partialRes?.executed).toBe(true);
    expect(partialRes?.sentCount).toBe(2);
    expect(partialRes?.errorCount).toBe(1);
    expect(sentEmails.map((m) => m.to)).toEqual(['pm1@pracownia.pl', 'admin@pracownia.pl']);
    expect(delays).toEqual([1000, 1000]);

    // Symulacja awarii/restartu w połowie tygodnia 2026-W47 (lastSentWeekKey cofnięty, ale pm1 i admin już zapisani w sentUserIdsThisWeek)
    const mutated = stateStore.getAppState();
    mutated.weeklySummaryState.lastSentWeekKey = '2026-W46';
    stateStore.setAppState(mutated);
    failRecipient = null;
    sentEmails.length = 0;

    const resumeRes = await service.tick();
    expect(resumeRes?.executed).toBe(true);
    // Tylko pm2 (niezapisany jeszcze w sentUserIdsThisWeek) otrzymuje zaległy raport, pm1 i admin pominięci!
    expect(sentEmails.map((m) => m.to)).toEqual(['pm2@pracownia.pl']);
    expect(resumeRes?.sentCount).toBe(1);
    expect(resumeRes?.skippedCount).toBe(2);

    // 3. Pusty raport (brak zaległych/kończących się) -> pominięty
    const cleanState = stateStore.getAppState();
    cleanState.tasks = [
      makeTask({
        id: 't-far',
        projectId: 'p-1',
        code: 'H1-9',
        title: 'Daleki termin',
        status: 'to_do',
        priority: 'low',
        assigneeId: 'pm-1',
        dueDate: '2026-12-30',
      }),
    ];
    stateStore.setAppState(cleanState);
    sentEmails.length = 0;

    const skipEmptyRes = await service.runNow({ force: true });
    expect(skipEmptyRes.executed).toBe(true);
    expect(skipEmptyRes.sentCount).toBe(0);
    expect(skipEmptyRes.skippedCount).toBe(3);
    expect(sentEmails).toHaveLength(0);

    // Sprawdź dziennik bezpieczeństwa (brak PII w logu)
    const secLogs = await stateStore.securityLogger.getRecentEvents(50);
    const types = secLogs.map((e) => e.type);
    expect(types).toContain('weekly_summary_sent');
    expect(types).toContain('weekly_summary_failed');
    const serialized = JSON.stringify(secLogs);
    expect(serialized).not.toContain('pm1@pracownia.pl');
    expect(serialized).not.toContain('PM Jeden');
  });
});

describe('Endpointy API podsumowania tygodniowego, preferencji i nadpisania env', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['WEEKLY_SUMMARY_ENABLED', 'WEEKLY_SUMMARY_DAY', 'WEEKLY_SUMMARY_TIME'];

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

  it('obsługuje GET status, POST preview (z limitem 3/godz.), POST run-now (z force), preferencje PM i izoluje weeklySummaryState', async () => {
    const sentMailCalls: any[] = [];
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: vi.fn(async (opts: any) => {
        sentMailCalls.push(opts);
        return { messageId: `mock-${sentMailCalls.length}` };
      }),
      verify: vi.fn(async () => true),
    } as any);

    const server = await startServer({ publicBaseUrl: 'https://biuro.example.pl' });

    try {
      const { cookie: adminCookie, user: adminUser } = await setupAdmin(server.baseUrl);

      // Utwórz kierownika projektów (PM) i zwykłego dewelopera (DEV)
      const createPmRes = await fetch(`${server.baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Marek Koordynator',
          email: 'pm@pracownia.pl',
          password: USER_PASS,
          role: 'project_manager',
          department: 'Koordynacja',
        }),
      });
      expect(createPmRes.status).toBe(200);
      const { user: pmUser } = await createPmRes.json();

      const createDevRes = await fetch(`${server.baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Jan Projektant',
          email: 'dev@pracownia.pl',
          password: USER_PASS,
          role: 'developer',
          department: 'Konstrukcja',
        }),
      });
      expect(createDevRes.status).toBe(200);

      const pmLoginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'pm@pracownia.pl', password: USER_PASS }),
      });
      const pmCookie = extractSessionCookie(pmLoginRes);

      // Non-admin nie ma dostępu do endpointów admina
      const forbiddenStatus = await fetch(`${server.baseUrl}/api/admin/weekly-summary/status`, {
        headers: { Cookie: pmCookie },
      });
      expect(forbiddenStatus.status).toBe(403);

      // PM może zmienić swoją preferencję weeklySummary przez PATCH /api/auth/preferences
      const prefRes = await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: pmCookie },
        body: JSON.stringify({ weeklySummary: false }),
      });
      expect(prefRes.status).toBe(200);
      const prefJson = await prefRes.json();
      expect(prefJson.user.weeklySummary).toBe(false);

      // Przywróć PM na true
      await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: pmCookie },
        body: JSON.stringify({ weeklySummary: true }),
      });

      // Skonfiguruj SMTP i ustawienia weeklySummary (enabled: false do testu preview)
      const putSettingsRes = await fetch(`${server.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          smtp: { host: 'smtp.test.local', port: 587, encryption: 'starttls' },
          weeklySummary: {
            enabled: false,
            dayOfWeek: 3,
            time: '09:15',
            windowDays: 14,
            includeAdmins: true,
            maxItemsPerProject: 20,
          },
        }),
      });
      expect(putSettingsRes.status).toBe(200);
      const putJson = await putSettingsRes.json();
      expect(putJson.settings.weeklySummary.dayOfWeek.value).toBe(3);
      expect(putJson.settings.weeklySummary.time.value).toBe('09:15');
      expect(putJson.settings.weeklySummary.windowDays.value).toBe(14);
      expect(putJson.settings.weeklySummary.maxItemsPerProject.value).toBe(20);

      // Dodaj projekt i zadanie z dzisiejszym terminem
      const todayIso = localDateString(Date.now(), 'Europe/Warsaw');
      const projRes = await fetch(`${server.baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          key: 'HALA',
          name: 'Hala testowa',
          priority: 'high',
          status: 'active',
          startDate: todayIso,
          dueDate: todayIso,
          durationDays: 10,
          memberIds: [adminUser.id, pmUser.id],
        }),
      });
      expect(projRes.status).toBe(201);
      const { project } = await projRes.json();

      const taskRes = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          projectId: project.id,
          title: 'Zadanie krytyczne',
          status: 'to_do',
          priority: 'high',
          assigneeId: pmUser.id,
          startDate: '2020-01-01',
          dueDate: todayIso,
        }),
      });
      expect(taskRes.status).toBe(201);

      // Preview działa mimo enabled: false, wysyła wyłącznie do admina i ma limit 3/godz.
      for (let i = 0; i < 3; i++) {
        const previewRes = await fetch(`${server.baseUrl}/api/admin/weekly-summary/preview`, {
          method: 'POST',
          headers: { Cookie: adminCookie },
        });
        expect(previewRes.status).toBe(200);
        const pJson = await previewRes.json();
        expect(pJson.to).toBe('admin@pracownia.pl');
      }
      expect(sentMailCalls).toHaveLength(3);
      expect(sentMailCalls[0].subject).toContain('[PODGLĄD] Podsumowanie tygodnia:');
      expect(sentMailCalls[0].html).toContain('https://biuro.example.pl/?task=');

      const rateLimitedPreview = await fetch(`${server.baseUrl}/api/admin/weekly-summary/preview`, {
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      expect(rateLimitedPreview.status).toBe(429);

      // run-now wysyła do PM i Admina (includeAdmins: true)
      sentMailCalls.length = 0;
      const runNowRes = await fetch(`${server.baseUrl}/api/admin/weekly-summary/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({}),
      });
      expect(runNowRes.status).toBe(200);
      const runNowJson = await runNowRes.json();
      expect(runNowJson.sentCount).toBe(2);

      // Powtórne run-now bez force deduplikuje
      sentMailCalls.length = 0;
      const runNowDedup = await fetch(`${server.baseUrl}/api/admin/weekly-summary/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ force: false }),
      });
      expect(runNowDedup.status).toBe(200);
      const dedupJson = await runNowDedup.json();
      expect(dedupJson.sentCount).toBe(0);
      expect(dedupJson.skippedCount).toBe(2);

      // run-now z force: true ponawia wysyłkę
      const runNowForce = await fetch(`${server.baseUrl}/api/admin/weekly-summary/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ force: true }),
      });
      expect(runNowForce.status).toBe(200);
      const forceJson = await runNowForce.json();
      expect(forceJson.sentCount).toBe(2);

      // GET /api/state nie ujawnia weeklySummaryState
      const stateRes = await fetch(`${server.baseUrl}/api/state`, {
        headers: { Cookie: adminCookie },
      });
      expect(stateRes.status).toBe(200);
      const stateJson = await stateRes.json();
      expect(stateJson.weeklySummaryState).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('nadpisania zmiennych środowiskowych WEEKLY_SUMMARY_* blokują odpowiednie pola (409)', async () => {
    process.env.WEEKLY_SUMMARY_ENABLED = 'true';
    process.env.WEEKLY_SUMMARY_DAY = '5';
    process.env.WEEKLY_SUMMARY_TIME = '14:30';

    const server = await startServer();
    try {
      const { cookie } = await setupAdmin(server.baseUrl);
      const getRes = await fetch(`${server.baseUrl}/api/admin/settings`, {
        headers: { Cookie: cookie },
      });
      expect(getRes.status).toBe(200);
      const json = await getRes.json();
      expect(json.weeklySummary.enabled).toEqual({
        value: true,
        source: 'env',
        locked: true,
        envVar: 'WEEKLY_SUMMARY_ENABLED',
      });
      expect(json.weeklySummary.dayOfWeek).toEqual({
        value: 5,
        source: 'env',
        locked: true,
        envVar: 'WEEKLY_SUMMARY_DAY',
      });
      expect(json.weeklySummary.time).toEqual({
        value: '14:30',
        source: 'env',
        locked: true,
        envVar: 'WEEKLY_SUMMARY_TIME',
      });

      const lockRes = await fetch(`${server.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          weeklySummary: { dayOfWeek: 2 },
        }),
      });
      expect(lockRes.status).toBe(409);

      // Walidacja schematu odrzuca niepoprawne wartości
      const invalidSchema = validateAdminSettingsUpdate(
        {
          weeklySummary: {
            dayOfWeek: 9,
            time: '25:99',
            windowDays: 30,
            maxItemsPerProject: 2,
          },
        },
        { idleMinutes: 120, maxHours: 12 }
      );
      expect(invalidSchema.ok).toBe(false);
      expect(invalidSchema.errors.length).toBeGreaterThanOrEqual(4);
    } finally {
      await server.close();
    }
  });
});
