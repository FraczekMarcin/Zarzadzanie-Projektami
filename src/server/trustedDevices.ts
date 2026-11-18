import crypto from 'crypto';
import type express from 'express';
import {
  PublicTrustedDevice,
  TRUSTED_DEVICE_GRACE_MS,
  TRUSTED_DEVICE_MAX_PER_USER,
  TrustedDeviceRecord,
  computeDevicePublicId,
  enforceMaxDevicesForUser,
  formatDeviceLabel,
  generateDeviceToken,
  hashDeviceToken,
  matchDeviceToken,
  pruneExpiredDevices,
  toPublicTrustedDevice,
} from '../utils/trustedDevices.js';
import { ServerConfig } from './config.js';
import { isRequestHttps, parseCookies } from './security.js';
import { SessionStore } from './sessions.js';
import { SettingsService } from './settings.js';
import { StateStore } from './state.js';
import { logger } from './logger.js';

export interface TrustedDeviceAuthResult {
  ok: boolean;
  reason?: 'missing' | 'unknown' | 'expired' | 'token_reuse' | 'disabled' | 'admin_disallowed' | 'user_unavailable';
  userId?: string;
  user?: any;
  device?: TrustedDeviceRecord;
  rotatedToken?: string;
  graceUsed?: boolean;
}

export interface TrustedDevicesService {
  start: () => Promise<void>;
  stop: () => void;
  getDeviceCookieName: (req: express.Request) => string;
  getDeviceTokenFromReq: (req: express.Request) => string | undefined;
  setDeviceCookie: (req: express.Request, res: express.Response, rawToken: string, days: number) => void;
  clearDeviceCookie: (req: express.Request, res: express.Response) => void;
  issueTrustedDevice: (
    userId: string,
    meta: { ip?: string; userAgent?: string; days?: number }
  ) => Promise<{ record: TrustedDeviceRecord; rawToken: string }>;
  authenticateWithDeviceToken: (
    rawToken: string | undefined | null,
    meta: { ip?: string; userAgent?: string }
  ) => Promise<TrustedDeviceAuthResult>;
  listPublicDevicesForUser: (
    userId: string,
    currentRawToken?: string | null
  ) => PublicTrustedDevice[];
  revokeDeviceByPublicId: (
    userId: string,
    publicId: string,
    currentRawToken?: string | null
  ) => Promise<{ revoked: boolean; wasCurrent: boolean; label?: string }>;
  revokeAllDevicesForUser: (userId: string) => Promise<number>;
  revokeDeviceByRawToken: (
    rawToken: string | undefined | null
  ) => Promise<{ revoked: boolean; userId?: string; label?: string }>;
  revokeAllDevicesGlobally: () => Promise<number>;
  cleanupExpired: () => Promise<number>;
}

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Co 1 godzinę

export function createTrustedDevicesService(deps: {
  config: ServerConfig;
  stateStore: StateStore;
  sessionStore: SessionStore;
  settingsService: SettingsService;
  disableTimers?: boolean;
}): TrustedDevicesService {
  const { config, stateStore, sessionStore, settingsService, disableTimers } = deps;
  let cleanupTimer: NodeJS.Timeout | null = null;

  function getRecords(): TrustedDeviceRecord[] {
    const appState = stateStore.ensureStateStructure();
    if (!Array.isArray(appState.trustedDevices)) {
      appState.trustedDevices = [];
    }
    return appState.trustedDevices as TrustedDeviceRecord[];
  }

  function setRecords(records: TrustedDeviceRecord[]): void {
    const appState = stateStore.ensureStateStructure();
    appState.trustedDevices = records;
  }

  async function cleanupExpired(): Promise<number> {
    const now = Date.now();
    const records = getRecords();
    const { active, removedCount } = pruneExpiredDevices(records, now);
    if (removedCount > 0) {
      setRecords(active);
      await stateStore.saveStateAtomicAsync();
      logger.info(`[TrustedDevices] Usunięto wygasłe zaufane urządzenia: ${removedCount}.`);
    }
    return removedCount;
  }

  async function start(): Promise<void> {
    await cleanupExpired().catch((err) => {
      logger.warn('[TrustedDevices] Błąd czyszczenia wygasłych urządzeń przy starcie:', err?.message || err);
    });

    if (!disableTimers && !cleanupTimer) {
      cleanupTimer = setInterval(() => {
        cleanupExpired().catch((err) => {
          logger.warn('[TrustedDevices] Błąd cyklicznego czyszczenia wygasłych urządzeń:', err?.message || err);
        });
      }, CLEANUP_INTERVAL_MS);
      cleanupTimer.unref();
    }
  }

  function stop(): void {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  function getDeviceCookieName(req: express.Request): string {
    return isRequestHttps(req) ? '__Host-zp_device' : 'zp_device';
  }

  function getDeviceTokenFromReq(req: express.Request): string | undefined {
    const cookies = parseCookies(req.headers.cookie);
    return cookies['__Host-zp_device'] || cookies['zp_device'];
  }

  function setDeviceCookie(
    req: express.Request,
    res: express.Response,
    rawToken: string,
    days: number
  ): void {
    const isHttps = isRequestHttps(req);
    const cookieName = isHttps ? '__Host-zp_device' : 'zp_device';
    const maxAgeSec = Math.max(1, Math.round(days * 86400));
    const parts = [
      `${cookieName}=${encodeURIComponent(rawToken)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSec}`,
    ];
    if (isHttps) {
      parts.push('Secure');
    }
    res.append('Set-Cookie', parts.join('; '));
  }

  function clearDeviceCookie(req: express.Request, res: express.Response): void {
    const isHttps = isRequestHttps(req);
    res.append(
      'Set-Cookie',
      `zp_device=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
    );
    res.append(
      'Set-Cookie',
      '__Host-zp_device=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
    );
  }

  async function issueTrustedDevice(
    userId: string,
    meta: { ip?: string; userAgent?: string; days?: number }
  ): Promise<{ record: TrustedDeviceRecord; rawToken: string }> {
    const eff = settingsService.getEffectiveTrustedDevicesSettings();
    const days = typeof meta.days === 'number' && meta.days > 0 ? meta.days : eff.days;
    const now = Date.now();
    const rawToken = generateDeviceToken();
    const ua = typeof meta.userAgent === 'string' ? meta.userAgent.slice(0, 200) : undefined;

    const record: TrustedDeviceRecord = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashDeviceToken(rawToken),
      label: formatDeviceLabel(ua),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + days * 86400 * 1000,
      ip: meta.ip,
      userAgent: ua,
    };

    const { active } = pruneExpiredDevices(getRecords(), now);
    const nextRecords = enforceMaxDevicesForUser([...active, record], userId, TRUSTED_DEVICE_MAX_PER_USER);
    setRecords(nextRecords);
    await stateStore.saveStateAtomicAsync();

    return { record, rawToken };
  }

  async function authenticateWithDeviceToken(
    rawToken: string | undefined | null,
    meta: { ip?: string; userAgent?: string }
  ): Promise<TrustedDeviceAuthResult> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      return { ok: false, reason: 'missing' };
    }

    const now = Date.now();
    const records = getRecords();
    const match = matchDeviceToken(records, rawToken, now);

    if (match.status === 'none') {
      return { ok: false, reason: 'unknown' };
    }

    if (match.status === 'expired') {
      const next = records.filter((r) => r.id !== match.record.id);
      setRecords(next);
      await stateStore.saveStateAtomicAsync();
      return { ok: false, reason: 'expired', userId: match.record.userId };
    }

    const record = match.record;

    // Ponowne użycie starego tokena poza oknem 60 s -> wykrycie kradzieży
    if (match.status === 'reuse') {
      const remaining = records.filter((r) => r.userId !== record.userId);
      setRecords(remaining);
      sessionStore.revokeUserSessions(record.userId);
      await Promise.all([
        stateStore.saveStateAtomicAsync(),
        sessionStore.saveSessionsAsync(),
      ]);
      return { ok: false, reason: 'token_reuse', userId: record.userId };
    }

    const eff = settingsService.getEffectiveTrustedDevicesSettings();
    if (!eff.enabled) {
      return { ok: false, reason: 'disabled', userId: record.userId };
    }

    const user = (stateStore.getUsers() || []).find((u) => u.id === record.userId);
    if (!user || user.isApproved === false) {
      const next = records.filter((r) => r.userId !== record.userId);
      setRecords(next);
      await stateStore.saveStateAtomicAsync();
      return { ok: false, reason: 'user_unavailable', userId: record.userId };
    }

    if (user.role === 'admin' && !eff.allowForAdmins) {
      return { ok: false, reason: 'admin_disallowed', userId: record.userId };
    }

    const ua = typeof meta.userAgent === 'string' ? meta.userAgent.slice(0, 200) : record.userAgent;

    if (match.status === 'grace') {
      // Okno 60 s dla wyścigu równoległych zakładek — nie nadpisujemy nowego tokenHash z pierwszego żądania
      record.lastUsedAt = now;
      record.expiresAt = now + eff.days * 86400 * 1000;
      if (meta.ip) record.ip = meta.ip;
      if (ua) {
        record.userAgent = ua;
        record.label = formatDeviceLabel(ua);
      }
      await stateStore.saveStateAtomicAsync();
      return {
        ok: true,
        userId: user.id,
        user,
        device: record,
        graceUsed: true,
      };
    }

    // Standardowa rotacja tokena przy każdym użyciu
    const newRawToken = generateDeviceToken();
    record.previousTokenHash = record.tokenHash;
    record.previousTokenExpiresAt = now + TRUSTED_DEVICE_GRACE_MS;
    record.rotatedAt = now;
    record.tokenHash = hashDeviceToken(newRawToken);
    record.lastUsedAt = now;
    record.expiresAt = now + eff.days * 86400 * 1000;
    if (meta.ip) record.ip = meta.ip;
    if (ua) {
      record.userAgent = ua;
      record.label = formatDeviceLabel(ua);
    }

    await stateStore.saveStateAtomicAsync();

    return {
      ok: true,
      userId: user.id,
      user,
      device: record,
      rotatedToken: newRawToken,
    };
  }

  function findCurrentRecordId(userId: string, currentRawToken?: string | null): string | null {
    if (!currentRawToken || !currentRawToken.trim()) return null;
    const match = matchDeviceToken(
      getRecords().filter((r) => r.userId === userId),
      currentRawToken,
      Date.now()
    );
    if (match.status === 'current' || match.status === 'grace') {
      return match.record.id;
    }
    return null;
  }

  function listPublicDevicesForUser(
    userId: string,
    currentRawToken?: string | null
  ): PublicTrustedDevice[] {
    const now = Date.now();
    const currentId = findCurrentRecordId(userId, currentRawToken);
    return getRecords()
      .filter((r) => r.userId === userId && r.expiresAt > now)
      .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
      .map((r) => toPublicTrustedDevice(r, currentId, config.effectiveAppSecret));
  }

  async function revokeDeviceByPublicId(
    userId: string,
    publicId: string,
    currentRawToken?: string | null
  ): Promise<{ revoked: boolean; wasCurrent: boolean; label?: string }> {
    const records = getRecords();
    const currentId = findCurrentRecordId(userId, currentRawToken);
    const target = records.find(
      (r) =>
        r.userId === userId &&
        computeDevicePublicId(r.id, config.effectiveAppSecret) === publicId
    );
    if (!target) {
      return { revoked: false, wasCurrent: false };
    }
    const next = records.filter((r) => r.id !== target.id);
    setRecords(next);
    await stateStore.saveStateAtomicAsync();
    return {
      revoked: true,
      wasCurrent: target.id === currentId,
      label: target.label,
    };
  }

  async function revokeAllDevicesForUser(userId: string): Promise<number> {
    const records = getRecords();
    const next = records.filter((r) => r.userId !== userId);
    const removed = records.length - next.length;
    if (removed > 0) {
      setRecords(next);
      await stateStore.saveStateAtomicAsync();
    }
    return removed;
  }

  async function revokeDeviceByRawToken(
    rawToken: string | undefined | null
  ): Promise<{ revoked: boolean; userId?: string; label?: string }> {
    if (!rawToken || !rawToken.trim()) {
      return { revoked: false };
    }
    const records = getRecords();
    const incomingHash = hashDeviceToken(rawToken);
    const target = records.find(
      (r) =>
        r.tokenHash === incomingHash ||
        (r.previousTokenHash && r.previousTokenHash === incomingHash)
    );
    if (!target) {
      return { revoked: false };
    }
    const next = records.filter((r) => r.id !== target.id);
    setRecords(next);
    await stateStore.saveStateAtomicAsync();
    return {
      revoked: true,
      userId: target.userId,
      label: target.label,
    };
  }

  async function revokeAllDevicesGlobally(): Promise<number> {
    const records = getRecords();
    const count = records.length;
    if (count > 0) {
      setRecords([]);
      await stateStore.saveStateAtomicAsync();
    }
    return count;
  }

  return {
    start,
    stop,
    getDeviceCookieName,
    getDeviceTokenFromReq,
    setDeviceCookie,
    clearDeviceCookie,
    issueTrustedDevice,
    authenticateWithDeviceToken,
    listPublicDevicesForUser,
    revokeDeviceByPublicId,
    revokeAllDevicesForUser,
    revokeDeviceByRawToken,
    revokeAllDevicesGlobally,
    cleanupExpired,
  };
}
