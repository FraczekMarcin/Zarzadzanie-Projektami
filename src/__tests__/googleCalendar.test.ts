import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildEventPayload,
  createServiceAccountJwt,
  diffEvents,
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarApiError,
  GoogleCalendarClient,
  GoogleCalendarExistingEvent,
  GoogleSyncProject,
  GoogleSyncTask,
  loadServiceAccountCredentials,
} from '../utils/googleCalendar.js';
import { createGoogleSyncService } from '../server/googleSync.js';
import { resolveServerConfig } from '../server/config.js';
import { SecurityLog } from '../utils/securityLog.js';
import { StateStore } from '../server/state.js';

let testPublicKey = '';
let testPrivateKey = '';

beforeAll(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  testPublicKey = publicKey;
  testPrivateKey = privateKey;
});

function decodeBase64UrlJson(segment: string): any {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function createFakeStateStore(initial: {
  tasks: GoogleSyncTask[];
  projects: GoogleSyncProject[];
  revision?: number;
  dataDir?: string;
}): StateStore & { recordedEvents: Array<{ type: string; details?: any }> } {
  const state: any = {
    tasks: initial.tasks,
    projects: initial.projects,
    revision: initial.revision ?? 1,
  };
  const listeners = new Set<(rev: number) => void>();
  const recordedEvents: Array<{ type: string; details?: any }> = [];
  const securityLogger = {
    record: async (type: any, opts: any = {}) => {
      recordedEvents.push({ type, details: opts.details });
    },
    query: async () => [],
    getLogFilePath: () => path.join(initial.dataDir || os.tmpdir(), 'security_log.jsonl'),
  } as unknown as SecurityLog;

  return {
    recordedEvents,
    getAppState: () => state,
    setAppState: (next: any) => {
      Object.assign(state, next);
    },
    getUsers: () => [],
    setUsers: () => {},
    ensureStateStructure: () => state,
    bumpStateRevision: () => {
      state.revision = (state.revision || 1) + 1;
      for (const l of listeners) l(state.revision);
      return state.revision;
    },
    onRevisionChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveStateAtomicAsync: async () => {},
    flushPendingStateSave: async () => {},
    securityLogger,
  };
}

describe('Google Calendar Service Account sync', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildEventPayload tworzy poprawne wydarzenie całodniowe z polskimi etykietami i extendedProperties.private', () => {
    const project: GoogleSyncProject = {
      id: 'proj-1',
      name: 'Osiedle Zielone',
      key: 'OZ',
    };
    const task: GoogleSyncTask = {
      id: 'task-42',
      projectId: 'proj-1',
      code: 'OZ-42',
      title: 'Projekt wykonawczy dachu',
      description: 'Uzgodnić detale obróbek blacharskich.',
      priority: 'high',
      status: 'in_progress',
      startDate: '2026-11-10',
      dueDate: '2026-11-12',
      durationDays: 3,
      revision: 7,
    };

    const payload = buildEventPayload(task, project);
    expect(payload.summary).toBe('[OZ-42] Projekt wykonawczy dachu');
    expect(payload.start).toEqual({ date: '2026-11-10' });
    // Exclusive end date: 2026-11-12 + 1 dzień = 2026-11-13
    expect(payload.end).toEqual({ date: '2026-11-13' });
    expect(payload.status).toBe('confirmed');
    expect(payload.description).toContain('Projekt: Osiedle Zielone');
    expect(payload.description).toContain('Priorytet: Wysoki');
    expect(payload.description).toContain('Status: W toku');
    expect(payload.description).toContain('Czas: 3 dni');
    expect(payload.description).toContain('Uzgodnić detale obróbek blacharskich.');
    expect(payload.extendedProperties).toEqual({
      private: {
        zpTaskId: 'task-42',
        zpRevision: '7',
        zpManaged: 'true',
      },
    });
  });

  it('buildEventPayload koryguje datę końcową mniejszą od początkowej', () => {
    const payload = buildEventPayload({
      id: 'task-rev',
      code: 'PR-1',
      title: 'Zadanie 1-dniowe',
      startDate: '2026-11-15',
      dueDate: '2026-11-10',
      priority: 'normal',
      status: 'to_do',
      durationDays: 1,
      revision: 1,
    });

    expect(payload.start).toEqual({ date: '2026-11-15' });
    expect(payload.end).toEqual({ date: '2026-11-16' });
    expect(payload.description).toContain('Czas: 1 dzień');
  });

  it('diffEvents tworzy, aktualizuje i usuwa tylko wydarzenia z zpManaged=true oraz nigdy nie rusza cudzych wydarzeń', () => {
    const projects: GoogleSyncProject[] = [
      { id: 'p-active', name: 'Projekt Aktywny' },
      { id: 'p-arch', name: 'Projekt Archiwalny', isArchived: true },
    ];
    const tasks: GoogleSyncTask[] = [
      {
        id: 't-new',
        projectId: 'p-active',
        code: 'PA-1',
        title: 'Nowe zadanie',
        startDate: '2026-11-20',
        dueDate: '2026-11-21',
        revision: 1,
      },
      {
        id: 't-same',
        projectId: 'p-active',
        code: 'PA-2',
        title: 'Bez zmian',
        startDate: '2026-11-20',
        dueDate: '2026-11-20',
        revision: 4,
      },
      {
        id: 't-upd',
        projectId: 'p-active',
        code: 'PA-3',
        title: 'Zmienione',
        startDate: '2026-11-22',
        dueDate: '2026-11-23',
        revision: 9,
      },
      {
        id: 't-cancelled',
        projectId: 'p-active',
        code: 'PA-4',
        title: 'Anulowane',
        status: 'cancelled',
        startDate: '2026-11-22',
        dueDate: '2026-11-23',
        revision: 2,
      },
      {
        id: 't-archived',
        projectId: 'p-arch',
        code: 'AR-1',
        title: 'Z archiwum',
        startDate: '2026-11-22',
        dueDate: '2026-11-23',
        revision: 2,
      },
    ];

    const existing: GoogleCalendarExistingEvent[] = [
      // Cudze wydarzenie bez zpManaged -> nietykalne
      {
        id: 'foreign-1',
        summary: 'Spotkanie z inwestorem (ręczne)',
      },
      {
        id: 'foreign-2',
        summary: 'Urlop zespołu',
        extendedProperties: { private: { zpManaged: 'false', customTag: 'yes' } },
      },
      // Zarządzane, ta sama rewizja -> brak zmian
      {
        id: 'ev-same',
        extendedProperties: { private: { zpTaskId: 't-same', zpRevision: '4', zpManaged: 'true' } },
      },
      // Zarządzane, stara rewizja -> aktualizacja
      {
        id: 'ev-upd',
        extendedProperties: { private: { zpTaskId: 't-upd', zpRevision: '8', zpManaged: 'true' } },
      },
      // Zarządzane, usunięte z aplikacji -> usunięcie
      {
        id: 'ev-orphan',
        extendedProperties: { private: { zpTaskId: 't-deleted', zpRevision: '1', zpManaged: 'true' } },
      },
      // Zarządzane, anulowane w aplikacji -> usunięcie
      {
        id: 'ev-cancelled',
        extendedProperties: { private: { zpTaskId: 't-cancelled', zpRevision: '2', zpManaged: 'true' } },
      },
      // Zarządzane, projekt zarchiwizowany -> usunięcie
      {
        id: 'ev-archived',
        extendedProperties: { private: { zpTaskId: 't-archived', zpRevision: '2', zpManaged: 'true' } },
      },
    ];

    const diff = diffEvents(tasks, existing, projects);
    expect(diff.create.map((c) => c.taskId)).toEqual(['t-new']);
    expect(diff.update.map((u) => ({ eventId: u.eventId, taskId: u.taskId }))).toEqual([
      { eventId: 'ev-upd', taskId: 't-upd' },
    ]);
    expect(diff.delete.map((d) => d.eventId).sort()).toEqual([
      'ev-archived',
      'ev-cancelled',
      'ev-orphan',
    ]);
    // Upewnij się, że żadne wydarzenie bez zpManaged='true' nie trafiło do update ani delete
    const touchedIds = [
      ...diff.update.map((u) => u.eventId),
      ...diff.delete.map((d) => d.eventId),
    ];
    expect(touchedIds).not.toContain('foreign-1');
    expect(touchedIds).not.toContain('foreign-2');
  });

  it('createServiceAccountJwt podpisuje poprawny JWT RS256 z wymaganymi roszczeniami', () => {
    const jwt = createServiceAccountJwt(
      {
        clientEmail: 'sync-bot@projekt-testowy.iam.gserviceaccount.com',
        privateKey: testPrivateKey,
      },
      { nowSec: 1_700_000_000 }
    );

    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const header = decodeBase64UrlJson(parts[0]);
    const claims = decodeBase64UrlJson(parts[1]);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims.iss).toBe('sync-bot@projekt-testowy.iam.gserviceaccount.com');
    expect(claims.scope).toBe(GOOGLE_CALENDAR_SCOPE);
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.iat).toBe(1_700_000_000);
    expect(claims.exp).toBe(1_700_003_600);

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const sigPad = parts[2].length % 4 === 0 ? '' : '='.repeat(4 - (parts[2].length % 4));
    const sigBuf = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/') + sigPad, 'base64');
    expect(verifier.verify(testPublicKey, sigBuf)).toBe(true);
  });

  it('GoogleCalendarClient buforuje token, obsługuje paginację i ponawia żądania po 429 bez wycieku sekretów w błędach', async () => {
    let tokenCalls = 0;
    let listCalls = 0;
    let patchCalls = 0;
    const sleepDurations: number[] = [];
    const seenAuthHeaders: string[] = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://oauth2.googleapis.com/token') {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({ access_token: 'mock-access-token-secret', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization || '';
      seenAuthHeaders.push(authHeader);

      if (url.includes('/events?') && (!init?.method || init.method === 'GET')) {
        listCalls += 1;
        if (listCalls === 1) {
          // Najpierw odpowiedź 429 z ponowieniem
          return new Response(JSON.stringify({ error: { message: 'Rate Limit Exceeded' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (listCalls === 2) {
          return new Response(
            JSON.stringify({
              items: [{ id: 'g-1', extendedProperties: { private: { zpManaged: 'true', zpTaskId: 't-1', zpRevision: '1' } } }],
              nextPageToken: 'page-2-token',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            items: [{ id: 'g-2', extendedProperties: { private: { zpManaged: 'true', zpTaskId: 't-2', zpRevision: '1' } } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (init?.method === 'PATCH') {
        patchCalls += 1;
        // Symuluj trwałe 503 z tekstem zawierającym potencjalny token Bearer -> musi zostać ocenzurowany
        return new Response(
          JSON.stringify({
            error: { message: 'Backend unavailable Bearer super-secret-jwt-should-not-leak' },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('{}', { status: 404 });
    };

    const client = new GoogleCalendarClient({
      clientEmail: 'sa@example.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
      calendarId: 'team-cal@group.calendar.google.com',
      fetchFn: mockFetch,
      minIntervalMs: 0,
      backoffBaseMs: 5,
      maxRetries: 3,
      sleepFn: async (ms) => {
        sleepDurations.push(ms);
      },
    });

    const events = await client.listEvents();
    expect(events.map((e) => e.id)).toEqual(['g-1', 'g-2']);
    expect(tokenCalls).toBe(1); // token z cache przy kolejnych wywołaniach
    expect(listCalls).toBe(3); // 1x 429 + 2 strony paginacji
    expect(sleepDurations.length).toBeGreaterThanOrEqual(1);
    expect(seenAuthHeaders.every((h) => h === 'Bearer mock-access-token-secret')).toBe(true);

    // Błąd po wyczerpaniu 3 ponowień (1 + 3 = 4 wywołania PATCH) nie ujawnia tokena ani klucza prywatnego
    let caughtErr: unknown;
    try {
      await client.patchEvent('g-1', { summary: 'Test' });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(GoogleCalendarApiError);
    expect(patchCalls).toBe(4);
    const errMsg = (caughtErr as Error).message;
    expect(errMsg).toContain('HTTP 503');
    expect(errMsg).not.toContain('super-secret-jwt-should-not-leak');
    expect(errMsg).not.toContain('mock-access-token-secret');
    expect(errMsg).not.toContain('BEGIN PRIVATE KEY');
  });

  it('loadServiceAccountCredentials odczytuje JSON konta usługi i maskuje błędy IO/walidacji', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-gsa-test-'));
    tempDirs.push(dir);
    const keyFile = path.join(dir, 'sa.json');
    fs.writeFileSync(
      keyFile,
      JSON.stringify({
        client_email: 'worker@demo.iam.gserviceaccount.com',
        private_key: testPrivateKey,
      }),
      'utf-8'
    );

    const creds = await loadServiceAccountCredentials(keyFile);
    expect(creds.clientEmail).toBe('worker@demo.iam.gserviceaccount.com');
    expect(creds.privateKey).toBe(testPrivateKey);

    await expect(loadServiceAccountCredentials(path.join(dir, 'missing.json'))).rejects.toThrow(
      /ENOENT|IO_ERROR/
    );
  });

  it('createGoogleSyncService: wyłączony bez konfiguracji, blokada równoległości, 1 patch przy zmianie i 1 delete przy usunięciu bez sekretów w logach', async () => {
    // 1. Brak konfiguracji -> funkcja całkowicie wyłączona
    const disabledCfg = resolveServerConfig({
      dataDir: os.tmpdir(),
      isProduction: false,
      googleServiceAccountFile: '',
      googleCalendarId: '',
    });
    const emptyStore = createFakeStateStore({ tasks: [], projects: [] });
    const disabledSync = createGoogleSyncService({
      config: disabledCfg,
      stateStore: emptyStore,
      disableTimers: true,
    });
    expect(disabledSync.isEnabled()).toBe(false);
    expect(await disabledSync.runSync('manual')).toEqual({ skipped: true, reason: 'disabled' });
    disabledSync.stop();

    // 2. Z włączonym klientem: pełny cykl (1 insert -> 1 patch po zmianie -> 1 delete po usunięciu) + blokada równoległości
    const remoteEvents = new Map<string, GoogleCalendarExistingEvent>();
    let seq = 1;
    let inserts = 0;
    let patches = 0;
    let deletes = 0;
    let listGate: (() => void) | null = null;
    let blockNextList = false;

    const fakeClient = {
      listEvents: async () => {
        if (blockNextList) {
          await new Promise<void>((resolve) => {
            listGate = resolve;
          });
        }
        return Array.from(remoteEvents.values());
      },
      insertEvent: async (payload: any) => {
        inserts += 1;
        const id = `ev-${seq++}`;
        const ev: GoogleCalendarExistingEvent = { id, ...payload };
        remoteEvents.set(id, ev);
        return ev;
      },
      patchEvent: async (eventId: string, payload: any) => {
        patches += 1;
        const cur = remoteEvents.get(eventId) || { id: eventId };
        const updated = { ...cur, ...payload };
        remoteEvents.set(eventId, updated);
        return updated;
      },
      deleteEvent: async (eventId: string) => {
        deletes += 1;
        remoteEvents.delete(eventId);
      },
    };

    const project: GoogleSyncProject = { id: 'p-1', name: 'Biuro', key: 'BR' };
    const task: GoogleSyncTask = {
      id: 'task-1',
      projectId: 'p-1',
      code: 'BR-1',
      title: 'Koncepcja',
      startDate: '2026-11-15',
      dueDate: '2026-11-17',
      revision: 1,
    };
    const store = createFakeStateStore({ tasks: [task], projects: [project] });

    const sync = createGoogleSyncService({
      config: disabledCfg,
      stateStore: store,
      clientOverride: fakeClient,
      disableTimers: true,
    });
    expect(sync.isEnabled()).toBe(true);

    // Krok A: pierwsze dodanie (1 insert)
    const r1 = await sync.runSync('manual');
    expect(r1).toEqual({ skipped: false, created: 1, updated: 0, deleted: 0 });
    expect(inserts).toBe(1);
    expect(patches).toBe(0);
    expect(deletes).toBe(0);

    // Krok B: brak zmian -> 0 operacji modyfikacji
    const rNoop = await sync.runSync('interval');
    expect(rNoop).toEqual({ skipped: false, created: 0, updated: 0, deleted: 0 });

    // Krok C: zmiana zadania -> dokładnie 1 patch
    task.title = 'Koncepcja zmieniona';
    task.revision = 2;
    const rUpdate = await sync.runSync('debounce');
    expect(rUpdate).toEqual({ skipped: false, created: 0, updated: 1, deleted: 0 });
    expect(patches).toBe(1);

    // Krok D: usunięcie zadania -> dokładnie 1 delete
    store.ensureStateStructure().tasks = [];
    const rDelete = await sync.runSync('debounce');
    expect(rDelete).toEqual({ skipped: false, created: 0, updated: 0, deleted: 1 });
    expect(deletes).toBe(1);

    // Krok E: równoległe wywołania -> drugie zostaje pominięte (already_running)
    blockNextList = true;
    const firstPromise = sync.runSync('manual');
    const secondResult = await sync.runSync('manual');
    expect(secondResult).toEqual({ skipped: true, reason: 'already_running' });
    blockNextList = false;
    const releaseGate = listGate as (() => void) | null;
    if (releaseGate) {
      releaseGate();
    }
    await firstPromise;

    // Dziennik bezpieczeństwa zawiera wpisy started/completed bez sekretów
    const eventTypes = store.recordedEvents.map((e) => e.type);
    expect(eventTypes).toContain('google_sync_started');
    expect(eventTypes).toContain('google_sync_completed');
    const serializedLog = JSON.stringify(store.recordedEvents);
    expect(serializedLog).not.toContain('BEGIN PRIVATE KEY');
    expect(serializedLog).not.toContain('Bearer ');

    sync.stop();
  });
});
