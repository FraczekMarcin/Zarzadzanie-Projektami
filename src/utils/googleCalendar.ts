import crypto from 'crypto';
import fs from 'fs';
import { PRIORITY_LABELS, STATUS_LABELS, formatDurationDays } from './labels.js';
import { isValidDateStr } from './icsBuilder.js';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleSyncTask {
  id: string;
  projectId?: string;
  code?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  startDate?: string;
  dueDate?: string;
  durationDays?: number;
  revision?: number;
}

export interface GoogleSyncProject {
  id: string;
  name?: string;
  shortName?: string;
  key?: string;
  isArchived?: boolean;
}

export type GoogleSyncProjectsInput =
  | Map<string, GoogleSyncProject>
  | Record<string, GoogleSyncProject>
  | GoogleSyncProject[];

export interface GoogleCalendarEventPayload {
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
  status: 'confirmed' | 'cancelled';
  extendedProperties: {
    private: {
      zpTaskId: string;
      zpRevision: string;
      zpManaged: 'true';
    };
  };
}

export interface GoogleCalendarExistingEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: {
    private?: Record<string, string | undefined>;
  };
}

export interface DiffEventsResult {
  create: Array<{ taskId: string; payload: GoogleCalendarEventPayload }>;
  update: Array<{ eventId: string; taskId: string; payload: GoogleCalendarEventPayload }>;
  delete: Array<{ eventId: string; zpTaskId: string }>;
}

export interface ServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
}

export interface GoogleCalendarClientOptions {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  minIntervalMs?: number;
  backoffBaseMs?: number;
  maxRetries?: number;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class GoogleCalendarApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.status = status;
  }
}

function addDaysIsoDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr.trim()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizeProjectsMap(projects?: GoogleSyncProjectsInput): Map<string, GoogleSyncProject> | null {
  if (!projects) return null;
  if (projects instanceof Map) return projects;
  const map = new Map<string, GoogleSyncProject>();
  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (p && p.id) map.set(p.id, p);
    }
    return map;
  }
  for (const [k, v] of Object.entries(projects)) {
    if (v) map.set(k, v);
  }
  return map;
}

/**
 * Buduje ładunek wydarzenia całodniowego Google Calendar API v3 na podstawie zadania i projektu.
 */
export function buildEventPayload(
  task: GoogleSyncTask,
  project?: GoogleSyncProject
): GoogleCalendarEventPayload {
  const hasStart = isValidDateStr(task.startDate);
  const hasDue = isValidDateStr(task.dueDate);

  let start = hasStart ? (task.startDate as string).trim() : hasDue ? (task.dueDate as string).trim() : new Date().toISOString().slice(0, 10);
  let due = hasDue ? (task.dueDate as string).trim() : start;
  if (due < start) {
    due = start;
  }
  const exclusiveEnd = addDaysIsoDate(due, 1);

  const codePart = task.code ? `[${task.code}] ` : '';
  const summary = `${codePart}${task.title || 'Zadanie'}`;

  const priorityKey = task.priority || 'normal';
  const priorityText = PRIORITY_LABELS[priorityKey] || task.priority || PRIORITY_LABELS.normal;
  const statusKey = task.status || 'to_do';
  const statusText = STATUS_LABELS[statusKey] || task.status || STATUS_LABELS.to_do;
  const durationText = formatDurationDays(task.durationDays);

  const descParts: string[] = [];
  const projectDisplayName = project?.shortName?.trim() || project?.name;
  if (projectDisplayName) {
    descParts.push(`Projekt: ${projectDisplayName}`);
  }
  descParts.push(`Priorytet: ${priorityText}`);
  descParts.push(`Status: ${statusText}`);
  descParts.push(`Czas: ${durationText}`);
  if (task.description) {
    descParts.push(task.description);
  }

  return {
    summary,
    description: descParts.join('\n'),
    start: { date: start },
    end: { date: exclusiveEnd },
    status: task.status === 'cancelled' ? 'cancelled' : 'confirmed',
    extendedProperties: {
      private: {
        zpTaskId: String(task.id),
        zpRevision: String(task.revision ?? 1),
        zpManaged: 'true',
      },
    },
  };
}

/**
 * Oblicza różnice między zadaniami w aplikacji a istniejącymi wydarzeniami w Google Calendar.
 * Wydarzenia bez extendedProperties.private.zpManaged === 'true' nigdy nie są modyfikowane ani usuwane.
 */
export function diffEvents(
  tasks: GoogleSyncTask[],
  existingEvents: GoogleCalendarExistingEvent[],
  projects?: GoogleSyncProjectsInput
): DiffEventsResult {
  const projectsMap = normalizeProjectsMap(projects);
  const create: DiffEventsResult['create'] = [];
  const update: DiffEventsResult['update'] = [];
  const toDelete: DiffEventsResult['delete'] = [];

  const syncableTasksById = new Map<string, { task: GoogleSyncTask; project?: GoogleSyncProject }>();
  for (const t of tasks || []) {
    if (!t || !t.id) continue;
    if (t.status === 'cancelled') continue;
    if (!isValidDateStr(t.startDate) && !isValidDateStr(t.dueDate)) continue;

    let project: GoogleSyncProject | undefined;
    if (projectsMap) {
      project = t.projectId ? projectsMap.get(t.projectId) : undefined;
      if (!project || project.isArchived) continue;
    }

    syncableTasksById.set(t.id, { task: t, project });
  }

  const managedByTaskId = new Map<string, GoogleCalendarExistingEvent>();
  for (const ev of existingEvents || []) {
    if (!ev || !ev.id) continue;
    const priv = ev.extendedProperties?.private;
    if (!priv || priv.zpManaged !== 'true' || !priv.zpTaskId) {
      // Cudze wydarzenia bez znacznika zpManaged nigdy nie są dotykane
      continue;
    }

    const zpTaskId = String(priv.zpTaskId);
    if (!syncableTasksById.has(zpTaskId)) {
      toDelete.push({ eventId: ev.id, zpTaskId });
      continue;
    }

    if (managedByTaskId.has(zpTaskId)) {
      // Usuń ewentualny duplikat utworzony przez przerwany wcześniejszy przebieg
      toDelete.push({ eventId: ev.id, zpTaskId });
      continue;
    }

    managedByTaskId.set(zpTaskId, ev);
  }

  for (const [taskId, { task, project }] of syncableTasksById.entries()) {
    const payload = buildEventPayload(task, project);
    const existing = managedByTaskId.get(taskId);
    if (!existing) {
      create.push({ taskId, payload });
    } else {
      const existingRevision = String(existing.extendedProperties?.private?.zpRevision ?? '');
      const targetRevision = payload.extendedProperties.private.zpRevision;
      if (existingRevision !== targetRevision) {
        update.push({ eventId: existing.id, taskId, payload });
      }
    }
  }

  return { create, update, delete: toDelete };
}

/**
 * Wczytuje i waliduje plik JSON konta usługi Google bez logowania tajnych pól.
 */
export async function loadServiceAccountCredentials(filePath: string): Promise<ServiceAccountCredentials> {
  if (!filePath || !filePath.trim()) {
    throw new GoogleCalendarApiError('Brak ścieżki pliku konta usługi Google.');
  }
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: any) {
    throw new GoogleCalendarApiError(`Nie można odczytać pliku konta usługi (${err?.code || 'IO_ERROR'}).`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleCalendarApiError('Nieprawidłowy format JSON pliku konta usługi.');
  }

  const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email.trim() : '';
  const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key : '';

  if (!clientEmail || !privateKey) {
    throw new GoogleCalendarApiError('Plik konta usługi nie zawiera wymaganych pól client_email i private_key.');
  }

  return { clientEmail, privateKey };
}

/**
 * Tworzy podpisany JWT RS256 dla konta usługi Google za pomocą wbudowanego modułu crypto.
 */
export function createServiceAccountJwt(
  credentials: ServiceAccountCredentials,
  options: { scope?: string; audience?: string; nowSec?: number } = {}
): string {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: credentials.clientEmail,
    scope: options.scope ?? GOOGLE_CALENDAR_SCOPE,
    aud: options.audience ?? GOOGLE_OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(credentials.privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function sanitizeGoogleErrorMessage(status: number, bodyText: string): string {
  let reason = '';
  try {
    const parsed = JSON.parse(bodyText);
    const msg = parsed?.error?.message || parsed?.error_description || parsed?.error;
    if (typeof msg === 'string' && msg.trim()) {
      reason = msg.trim();
    }
  } catch {
    if (bodyText && bodyText.trim()) {
      reason = bodyText.trim();
    }
  }
  const cleanReason = reason
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[PRIVATE_KEY_REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 180);

  return cleanReason ? `HTTP ${status}: ${cleanReason}` : `HTTP ${status}`;
}

export class GoogleCalendarClient {
  private clientEmail: string;
  private privateKey: string;
  private calendarId: string;
  private tokenUrl: string;
  private apiBaseUrl: string;
  private fetchFn: typeof fetch;
  private minIntervalMs: number;
  private backoffBaseMs: number;
  private maxRetries: number;
  private nowFn: () => number;
  private sleepFn: (ms: number) => Promise<void>;

  private cachedToken: string | null = null;
  private cachedTokenExpiresAtMs = 0;
  private pendingTokenPromise: Promise<string> | null = null;

  private rateQueue: Promise<void> = Promise.resolve();
  private lastRequestAtMs = 0;

  constructor(options: GoogleCalendarClientOptions) {
    this.clientEmail = options.clientEmail;
    this.privateKey = options.privateKey;
    this.calendarId = options.calendarId;
    this.tokenUrl = (options.tokenUrl || GOOGLE_OAUTH_TOKEN_URL).replace(/\/+$/, '');
    this.apiBaseUrl = (options.apiBaseUrl || GOOGLE_CALENDAR_API_BASE).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.minIntervalMs = options.minIntervalMs ?? 200; // maks. 5 żądań/s
    this.backoffBaseMs = options.backoffBaseMs ?? 300;
    this.maxRetries = options.maxRetries ?? 3;
    this.nowFn = options.nowFn || (() => Date.now());
    this.sleepFn =
      options.sleepFn ||
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async waitRateSlot(): Promise<void> {
    const run = async () => {
      if (this.minIntervalMs <= 0) return;
      const now = this.nowFn();
      const waitMs = this.lastRequestAtMs + this.minIntervalMs - now;
      if (waitMs > 0) {
        await this.sleepFn(waitMs);
      }
      this.lastRequestAtMs = this.nowFn();
    };
    const next = this.rateQueue.then(run, run);
    this.rateQueue = next.catch(() => {});
    return next;
  }

  private async requestWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    while (true) {
      await this.waitRateSlot();

      let res: Response;
      try {
        res = await this.fetchFn(url, init);
      } catch (err: any) {
        if (attempt < this.maxRetries) {
          const delayMs = this.backoffBaseMs * Math.pow(2, attempt);
          attempt += 1;
          await this.sleepFn(delayMs);
          continue;
        }
        throw new GoogleCalendarApiError(
          `Błąd sieci podczas komunikacji z Google API (${err?.code || 'NETWORK_ERROR'})`
        );
      }

      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt < this.maxRetries) {
          const retryAfterHeader = res.headers?.get?.('retry-after');
          const parsedRetrySec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const delayMs =
            !Number.isNaN(parsedRetrySec) && parsedRetrySec > 0
              ? Math.min(parsedRetrySec * 1000, 10000)
              : this.backoffBaseMs * Math.pow(2, attempt);
          attempt += 1;
          await this.sleepFn(delayMs);
          continue;
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new GoogleCalendarApiError(sanitizeGoogleErrorMessage(res.status, text), res.status);
      }

      return res;
    }
  }

  async getAccessToken(): Promise<string> {
    const now = this.nowFn();
    if (this.cachedToken && now < this.cachedTokenExpiresAtMs) {
      return this.cachedToken;
    }

    if (this.pendingTokenPromise) {
      return this.pendingTokenPromise;
    }

    this.pendingTokenPromise = (async () => {
      try {
        const jwt = createServiceAccountJwt(
          { clientEmail: this.clientEmail, privateKey: this.privateKey },
          {
            scope: GOOGLE_CALENDAR_SCOPE,
            audience: this.tokenUrl,
            nowSec: Math.floor(this.nowFn() / 1000),
          }
        );

        const body = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }).toString();

        const res = await this.requestWithRetry(this.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });

        const data: any = await res.json();
        const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
        if (!accessToken) {
          throw new GoogleCalendarApiError('Brak pola access_token w odpowiedzi Google OAuth.');
        }

        const expiresInSec = typeof data?.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
        const marginMs = expiresInSec > 120 ? 60_000 : Math.floor(expiresInSec * 200);
        this.cachedToken = accessToken;
        this.cachedTokenExpiresAtMs = this.nowFn() + Math.max(1000, expiresInSec * 1000 - marginMs);
        return accessToken;
      } finally {
        this.pendingTokenPromise = null;
      }
    })();

    return this.pendingTokenPromise;
  }

  private async authorizedFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    };
    return this.requestWithRetry(url, { ...init, headers });
  }

  async listEvents(): Promise<GoogleCalendarExistingEvent[]> {
    const encodedCalId = encodeURIComponent(this.calendarId);
    const allEvents: GoogleCalendarExistingEvent[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        privateExtendedProperty: 'zpManaged=true',
        singleEvents: 'false',
        maxResults: '250',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `${this.apiBaseUrl}/calendars/${encodedCalId}/events?${params.toString()}`;
      const res = await this.authorizedFetch(url, { method: 'GET' });
      const data: any = await res.json();
      if (Array.isArray(data?.items)) {
        allEvents.push(...data.items);
      }
      pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
    } while (pageToken);

    return allEvents;
  }

  async insertEvent(payload: GoogleCalendarEventPayload): Promise<GoogleCalendarExistingEvent> {
    const encodedCalId = encodeURIComponent(this.calendarId);
    const url = `${this.apiBaseUrl}/calendars/${encodedCalId}/events`;
    const res = await this.authorizedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as GoogleCalendarExistingEvent;
  }

  async patchEvent(
    eventId: string,
    payload: Partial<GoogleCalendarEventPayload>
  ): Promise<GoogleCalendarExistingEvent> {
    const encodedCalId = encodeURIComponent(this.calendarId);
    const encodedEventId = encodeURIComponent(eventId);
    const url = `${this.apiBaseUrl}/calendars/${encodedCalId}/events/${encodedEventId}`;
    const res = await this.authorizedFetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as GoogleCalendarExistingEvent;
  }

  async deleteEvent(eventId: string): Promise<void> {
    const encodedCalId = encodeURIComponent(this.calendarId);
    const encodedEventId = encodeURIComponent(eventId);
    const url = `${this.apiBaseUrl}/calendars/${encodedCalId}/events/${encodedEventId}`;
    try {
      await this.authorizedFetch(url, { method: 'DELETE' });
    } catch (err: any) {
      // Jeśli wydarzenie zostało już usunięte po stronie Google, nie przerywaj synchronizacji
      if (err instanceof GoogleCalendarApiError && (err.status === 404 || err.status === 410)) {
        return;
      }
      throw err;
    }
  }
}
