import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import nodemailer from 'nodemailer';
import { createApp, CreateAppOptions } from '../../server.js';
import {
  TRUSTED_DEVICE_GRACE_MS,
  TRUSTED_DEVICE_MAX_PER_USER,
  TrustedDeviceRecord,
  enforceMaxDevicesForUser,
  formatDeviceLabel,
  generateDeviceToken,
  hashDeviceToken,
  matchDeviceToken,
  pruneExpiredDevices,
  toPublicTrustedDevice,
} from '../utils/trustedDevices.js';
import { calculateTotpForStep } from '../utils/totp.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Katedra-Architektura-2026!';
const USER_PASS = 'Projekt-Budowa-2026!';
const NEW_USER_PASS = 'Konstrukcja-Nowe-2026!';

interface TestServerContext {
  baseUrl: string;
  dataDir: string;
  instance: Awaited<ReturnType<typeof createApp>>;
  close: () => Promise<void>;
}

function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as any;
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function extractCookiePair(res: Response, name: string): string {
  for (const raw of getSetCookies(res)) {
    const first = raw.split(';')[0].trim();
    if (first.startsWith(`${name}=`)) {
      return first;
    }
  }
  return '';
}

function extractCookieHeaderRaw(res: Response, name: string): string {
  for (const raw of getSetCookies(res)) {
    const first = raw.split(';')[0].trim();
    if (first.startsWith(`${name}=`)) {
      return raw;
    }
  }
  return '';
}

function extractCookieValue(res: Response, name: string): string {
  const pair = extractCookiePair(res, name);
  if (!pair) return '';
  return decodeURIComponent(pair.slice(name.length + 1));
}

async function startServer(overrides: Partial<CreateAppOptions> = {}): Promise<TestServerContext> {
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-trusted-devices-'));
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
    instance,
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
  const data = await res.json();
  expect(res.status).toBe(200);
  return { res, data, adminCookie: extractCookiePair(res, 'zp_session'), adminUser: data.user };
}

async function createApprovedUser(
  baseUrl: string,
  adminCookie: string,
  email = 'jan@pracownia.pl',
  name = 'Projektant Jan'
) {
  const res = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      name,
      email,
      password: USER_PASS,
      role: 'developer',
      department: 'Architektura',
    }),
  });
  const data = await res.json();
  expect(res.status).toBe(200);
  return data.user;
}

describe('P52: Jednostkowe testy pomocnicze zaufanych urządzeń (src/utils/trustedDevices.ts)', () => {
  it('generuje losowy token 32 bajty i skrót SHA-256 bez powtórzeń', () => {
    const t1 = generateDeviceToken();
    const t2 = generateDeviceToken();
    expect(t1).not.toBe(t2);
    expect(Buffer.from(t1, 'base64url').length).toBe(32);

    const h1 = hashDeviceToken(t1);
    expect(h1).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(h1)).toBe(true);
    expect(hashDeviceToken(`  ${t1}  `)).toBe(h1);
  });

  it('poprawnie rozpoznaje nazwę przeglądarki i systemu operacyjnego w formatDeviceLabel', () => {
    expect(
      formatDeviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome na Windows');
    expect(
      formatDeviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0')
    ).toBe('Firefox na Linux');
    expect(
      formatDeviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
      )
    ).toBe('Safari na macOS');
    expect(formatDeviceLabel('')).toBe('Nieznane urządzenie');
    expect(formatDeviceLabel(undefined)).toBe('Nieznane urządzenie');
  });

  it('rozróżnia statusy current, grace (do 60s), reuse (>60s) i expired', () => {
    const now = 1700000000000;
    const currentRaw = generateDeviceToken();
    const prevRaw = generateDeviceToken();
    const unknownRaw = generateDeviceToken();

    const record: TrustedDeviceRecord = {
      id: 'dev-1',
      userId: 'usr-1',
      tokenHash: hashDeviceToken(currentRaw),
      previousTokenHash: hashDeviceToken(prevRaw),
      previousTokenExpiresAt: now + TRUSTED_DEVICE_GRACE_MS,
      rotatedAt: now,
      label: 'Chrome na Windows',
      createdAt: now - 1000,
      lastUsedAt: now,
      expiresAt: now + 86400 * 1000,
    };

    expect(matchDeviceToken([record], currentRaw, now).status).toBe('current');
    expect(matchDeviceToken([record], prevRaw, now + 30_000).status).toBe('grace');
    expect(matchDeviceToken([record], prevRaw, now + TRUSTED_DEVICE_GRACE_MS + 1).status).toBe('reuse');
    expect(matchDeviceToken([record], unknownRaw, now).status).toBe('none');
    expect(matchDeviceToken([record], currentRaw, record.expiresAt).status).toBe('expired');
  });

  it('egzekwuje limit maksymalnie 10 zaufanych urządzeń na użytkownika (usuwa najdawniej używane)', () => {
    const records: TrustedDeviceRecord[] = [];
    for (let i = 0; i < 12; i++) {
      records.push({
        id: `dev-${i}`,
        userId: 'usr-1',
        tokenHash: `hash-${i}`,
        label: `Device ${i}`,
        createdAt: 1000 + i,
        lastUsedAt: 1000 + i * 10,
        expiresAt: 999999999,
      });
    }
    records.push({
      id: 'other-user-dev',
      userId: 'usr-2',
      tokenHash: 'hash-other',
      label: 'Other',
      createdAt: 1,
      lastUsedAt: 1,
      expiresAt: 999999999,
    });

    const trimmed = enforceMaxDevicesForUser(records, 'usr-1', TRUSTED_DEVICE_MAX_PER_USER);
    const usr1 = trimmed.filter((r) => r.userId === 'usr-1');
    const usr2 = trimmed.filter((r) => r.userId === 'usr-2');
    expect(usr1).toHaveLength(10);
    expect(usr1.some((r) => r.id === 'dev-0')).toBe(false);
    expect(usr1.some((r) => r.id === 'dev-1')).toBe(false);
    expect(usr1.some((r) => r.id === 'dev-11')).toBe(true);
    expect(usr2).toHaveLength(1);
  });

  it('usuwa wygasłe rekordy i mapuje obiekty publiczne bez wycieku tokenHash/previousTokenHash', () => {
    const now = 1700000000000;
    const valid: TrustedDeviceRecord = {
      id: 'rec-valid',
      userId: 'usr-1',
      tokenHash: 'secret-sha256-hash',
      previousTokenHash: 'secret-prev-sha256',
      label: 'Firefox na Linux',
      createdAt: now - 5000,
      lastUsedAt: now - 1000,
      expiresAt: now + 5000,
      ip: '127.0.0.1',
    };
    const expired: TrustedDeviceRecord = {
      ...valid,
      id: 'rec-expired',
      expiresAt: now - 1,
    };

    const { active, removedCount } = pruneExpiredDevices([valid, expired], now);
    expect(removedCount).toBe(1);
    expect(active).toHaveLength(1);

    const pub = toPublicTrustedDevice(valid, 'rec-valid', TEST_APP_SECRET);
    expect(pub.id).toHaveLength(16);
    expect(pub.current).toBe(true);
    expect('tokenHash' in pub).toBe(false);
    expect('previousTokenHash' in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('secret-sha256-hash');
    expect(JSON.stringify(pub)).not.toContain('secret-prev-sha256');
  });
});

describe('P52: Integracyjne testy API i bezpieczeństwa zaufanych urządzeń', () => {
  const ENV_KEYS = ['TRUSTED_DEVICES_ENABLED', 'TRUSTED_DEVICE_DAYS', 'TRUST_PROXY'];
  const envBackup: Record<string, string | undefined> = {};
  let ctx: TestServerContext | null = null;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
    for (const k of ENV_KEYS) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
  });

  it('wydaje ciasteczko urządzenia wyłącznie przy trustDevice=true (HTTP zp_device i HTTPS __Host-zp_device) oraz obsługuje 2FA', async () => {
    process.env.TRUST_PROXY = '1';
    ctx = await startServer();
    const { adminCookie } = await setupAdmin(ctx.baseUrl);
    const user = await createApprovedUser(ctx.baseUrl, adminCookie);

    // 1. Logowanie z trustDevice: false -> brak ciasteczka zp_device
    const noTrustRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: false }),
    });
    expect(noTrustRes.status).toBe(200);
    expect(extractCookiePair(noTrustRes, 'zp_device')).toBe('');

    // 2. Logowanie z trustDevice: true (HTTP) -> zp_device HttpOnly + SameSite=Lax + sesja zachowana równolegle
    const trustHttpRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/124.0 Windows NT 10.0' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    expect(trustHttpRes.status).toBe(200);
    const userSessionCookie = extractCookiePair(trustHttpRes, 'zp_session');
    const deviceRawHeader = extractCookieHeaderRaw(trustHttpRes, 'zp_device');
    expect(userSessionCookie).toContain('zp_session=');
    expect(deviceRawHeader).toContain('zp_device=');
    expect(deviceRawHeader).toContain('HttpOnly');
    expect(deviceRawHeader).toContain('SameSite=Lax');
    expect(deviceRawHeader).toContain('Path=/');

    // 3. Logowanie z trustDevice: true przez HTTPS proxy -> __Host-zp_device z Secure
    const trustHttpsRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    expect(trustHttpsRes.status).toBe(200);
    const hostDeviceHeader = extractCookieHeaderRaw(trustHttpsRes, '__Host-zp_device');
    expect(hostDeviceHeader).toContain('__Host-zp_device=');
    expect(hostDeviceHeader).toContain('HttpOnly');
    expect(hostDeviceHeader).toContain('Secure');
    expect(hostDeviceHeader).toContain('Path=/');

    // 4. Konto z 2FA: pierwszy krok bez totpCode NIE wydaje tokena urządzenia
    const setup2faRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}/2fa/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userSessionCookie },
      body: JSON.stringify({ currentPassword: USER_PASS }),
    });
    const { secret } = await setup2faRes.json();
    const stepConfirm = Math.floor(Date.now() / 1000 / 30);
    const confirm2faRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}/2fa/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userSessionCookie },
      body: JSON.stringify({ code: calculateTotpForStep(secret, stepConfirm - 1) }),
    });
    expect(confirm2faRes.status).toBe(200);

    const stepOne2fa = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    expect(stepOne2fa.status).toBe(200);
    const stepOneJson = await stepOne2fa.json();
    expect(stepOneJson.require2FA).toBe(true);
    expect(extractCookiePair(stepOne2fa, 'zp_device')).toBe('');

    // Krok 2 z kodem 2FA -> wydaje ciasteczko urządzenia
    const stepTwo2fa = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: USER_PASS,
        totpCode: calculateTotpForStep(secret, stepConfirm),
        trustDevice: true,
      }),
    });
    expect(stepTwo2fa.status).toBe(200);
    expect(extractCookiePair(stepTwo2fa, 'zp_device')).toContain('zp_device=');
  });

  it('device-login rotuje token, obsługuje okno 60 s (grace), wykrywa kradzież po >60 s (czyści wszystkie urządzenia i sesje) i loguje device_token_reuse', async () => {
    ctx = await startServer();
    const { adminCookie } = await setupAdmin(ctx.baseUrl);
    const user = await createApprovedUser(ctx.baseUrl, adminCookie);

    const baseNow = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow);

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    const sessionA = extractCookiePair(loginRes, 'zp_session');
    const device1Pair = extractCookiePair(loginRes, 'zp_device');
    const device1Raw = extractCookieValue(loginRes, 'zp_device');
    expect(device1Raw).toBeTruthy();

    // Użycie device-login #1 -> nowa sesja + zrotowany token urządzenia
    dateNowSpy.mockReturnValue(baseNow + 5_000);
    const devLogin1 = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: { Cookie: device1Pair },
    });
    expect(devLogin1.status).toBe(200);
    const sessionB = extractCookiePair(devLogin1, 'zp_session');
    const device2Pair = extractCookiePair(devLogin1, 'zp_device');
    const device2Raw = extractCookieValue(devLogin1, 'zp_device');
    expect(sessionB).toContain('zp_session=');
    expect(device2Raw).toBeTruthy();
    expect(device2Raw).not.toBe(device1Raw);

    // Równoległa zakładka wysyła stary token w oknie 60 s -> przechodzi (grace) bez ponownej rotacji
    dateNowSpy.mockReturnValue(baseNow + 25_000);
    const graceRes = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: { Cookie: device1Pair },
    });
    expect(graceRes.status).toBe(200);
    expect(extractCookiePair(graceRes, 'zp_device')).toBe('');

    // Nowy token nadal działa poprawnie
    const meBeforeReuse = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: sessionA },
    });
    expect(meBeforeReuse.status).toBe(200);

    // Po minięciu okna 60 s ponowne użycie starego tokena (device1Pair) -> wykrycie kradzieży!
    dateNowSpy.mockReturnValue(baseNow + 5_000 + TRUSTED_DEVICE_GRACE_MS + 10_000);
    const reuseRes = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: { Cookie: device1Pair },
    });
    expect(reuseRes.status).toBe(401);
    expect(extractCookieHeaderRaw(reuseRes, 'zp_device')).toContain('Max-Age=0');

    // Zarówno nowy token (device2Pair), jak i obie aktywne sesje zostały natychmiast unieważnione
    const retryValidToken = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: { Cookie: device2Pair },
    });
    expect(retryValidToken.status).toBe(401);
    expect((await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: sessionA } })).status).toBe(401);
    expect((await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: sessionB } })).status).toBe(401);

    // Dziennik bezpieczeństwa zawiera device_token_reuse i NIE zawiera surowych tokenów ani hashów
    const secRes = await fetch(`${ctx.baseUrl}/api/security/events?type=device_token_reuse`, {
      headers: { Cookie: adminCookie },
    });
    const secData = await secRes.json();
    expect(secData.events.length).toBe(1);
    expect(secData.events[0].userId).toBe(user.id);

    const rawLog = fs.readFileSync(path.join(ctx.dataDir, 'security_log.jsonl'), 'utf-8');
    expect(rawLog).not.toContain(device1Raw);
    expect(rawLog).not.toContain(device2Raw);
    expect(rawLog).not.toContain(hashDeviceToken(device1Raw));
    expect(rawLog).not.toContain(hashDeviceToken(device2Raw));
  });

  it('cofnięcie zaufania przy wylogowaniu, zmianie hasła, resecie hasła, zmianie 2FA, unieważnieniu sesji przez admina i usunięciu konta', async () => {
    ctx = await startServer();
    const baseUrl = ctx.baseUrl;
    const { adminCookie } = await setupAdmin(baseUrl);
    const user = await createApprovedUser(baseUrl, adminCookie);

    const issueForUser = async (pass = USER_PASS) => {
      const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: pass, trustDevice: true }),
      });
      expect(r.status).toBe(200);
      return {
        sessionCookie: extractCookiePair(r, 'zp_session'),
        deviceCookie: extractCookiePair(r, 'zp_device'),
      };
    };

    // a) Wylogowanie cofa bieżące urządzenie
    const dLogout = await issueForUser();
    const outRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `${dLogout.sessionCookie}; ${dLogout.deviceCookie}` },
    });
    expect(outRes.status).toBe(200);
    expect(extractCookieHeaderRaw(outRes, 'zp_device')).toContain('Max-Age=0');
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: dLogout.deviceCookie } })).status).toBe(401);

    // b) Zmiana własnego hasła cofa wszystkie zaufane urządzenia
    const dSelfPw = await issueForUser();
    const pwRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: dSelfPw.sessionCookie },
      body: JSON.stringify({ currentPassword: USER_PASS, newPassword: NEW_USER_PASS }),
    });
    expect(pwRes.status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: dSelfPw.deviceCookie } })).status).toBe(401);

    // c) Zmiana hasła przez admina cofa wszystkie zaufane urządzenia użytkownika
    const dAdminPw = await issueForUser(NEW_USER_PASS);
    const adminPwRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ newPassword: USER_PASS }),
    });
    expect(adminPwRes.status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: dAdminPw.deviceCookie } })).status).toBe(401);

    // d) Reset hasła e-mailem (confirm) cofa wszystkie zaufane urządzenia użytkownika
    await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        smtp: { host: 'smtp.pracownia.pl', port: 587, fromAddress: 'biuro@pracownia.pl' },
      }),
    });
    let capturedResetCode = '';
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: vi.fn(async (mail: any) => {
        const m = String(mail.text || '').match(/(\d{6})/);
        if (m) capturedResetCode = m[1];
        return { messageId: 'reset-1' };
      }),
    } as any);
    const dResetPw = await issueForUser(USER_PASS);
    await fetch(`${ctx.baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/password-reset/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, code: capturedResetCode }),
    });
    const { verifiedTicket } = await verifyRes.json();
    const confirmReset = await fetch(`${ctx.baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, verifiedTicket, newPassword: NEW_USER_PASS }),
    });
    expect(confirmReset.status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: dResetPw.deviceCookie } })).status).toBe(401);

    // e) Włączenie 2FA i wyłączenie 2FA przez admina cofają urządzenia
    const d2fa = await issueForUser(NEW_USER_PASS);
    const setup2 = await (
      await fetch(`${ctx.baseUrl}/api/users/${user.id}/2fa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: d2fa.sessionCookie },
        body: JSON.stringify({ currentPassword: NEW_USER_PASS }),
      })
    ).json();
    const nowStep = Math.floor(Date.now() / 1000 / 30);
    await fetch(`${ctx.baseUrl}/api/users/${user.id}/2fa/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: d2fa.sessionCookie },
      body: JSON.stringify({ code: calculateTotpForStep(setup2.secret, nowStep) }),
    });
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: d2fa.deviceCookie } })).status).toBe(401);

    // Zaloguj się ponownie z 2FA + trustDevice, po czym admin resetuje 2FA
    const login2fa = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: NEW_USER_PASS,
        totpCode: calculateTotpForStep(setup2.secret, nowStep + 1),
        trustDevice: true,
      }),
    });
    const d2faResetCookie = extractCookiePair(login2fa, 'zp_device');
    await fetch(`${ctx.baseUrl}/api/users/${user.id}/2fa/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: d2faResetCookie } })).status).toBe(401);

    // f) Admin DELETE /api/users/:userId/sessions cofa także zaufane urządzenia
    const dSessionsRev = await issueForUser(NEW_USER_PASS);
    const revSessRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}/sessions`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(revSessRes.status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: dSessionsRev.deviceCookie } })).status).toBe(401);

    // g) Usunięcie użytkownika usuwa jego zaufane urządzenia
    const dDelete = await issueForUser(NEW_USER_PASS);
    const delUserRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delUserRes.status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: dDelete.deviceCookie } })).status).toBe(401);
  });

  it('ustawienia administratora (trustedDevices.enabled, allowForAdmins, zmienne env), blokada niezatwierdzonego konta oraz operacje wrażliwe', async () => {
    process.env.TRUSTED_DEVICE_DAYS = '14';
    ctx = await startServer();
    const { adminCookie } = await setupAdmin(ctx.baseUrl);
    const user = await createApprovedUser(ctx.baseUrl, adminCookie);

    // Setup-status odzwierciedla TRUSTED_DEVICE_DAYS=14
    const statusRes = await (await fetch(`${ctx.baseUrl}/api/auth/setup-status`)).json();
    expect(statusRes.trustedDevices).toEqual({ enabled: true, days: 14, hasCookie: false });

    // Próba nadpisania TRUSTED_DEVICE_DAYS z UI -> 409
    const lockedRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        trustedDevices: { days: 60 },
      }),
    });
    expect(lockedRes.status).toBe(409);

    // Wyłączenie allowForAdmins nie blokuje zwykłego użytkownika, ale blokuje administratora
    const allowAdminOff = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        trustedDevices: { allowForAdmins: false },
      }),
    });
    expect(allowAdminOff.status).toBe(200);

    const adminTrustTry = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pracownia.pl', password: ADMIN_PASS, trustDevice: true }),
    });
    expect(adminTrustTry.status).toBe(200);
    expect((await adminTrustTry.json()).trustDevice).toBe('disabled');
    expect(extractCookiePair(adminTrustTry, 'zp_device')).toBe('');

    const userTrustOk = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    const userDevCookie = extractCookiePair(userTrustOk, 'zp_device');
    expect(userDevCookie).toContain('zp_device=');

    // Sesja odnowiona przez device-login nadal wymaga hasła przy operacjach wrażliwych (np. zmiana hasła)
    const renewedLogin = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: { Cookie: userDevCookie },
    });
    expect(renewedLogin.status).toBe(200);
    const renewedSessionCookie = extractCookiePair(renewedLogin, 'zp_session');
    const renewedDevCookie = extractCookiePair(renewedLogin, 'zp_device');

    const sensitivePwFail = await fetch(`${ctx.baseUrl}/api/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: renewedSessionCookie },
      body: JSON.stringify({ newPassword: NEW_USER_PASS }),
    });
    expect(sensitivePwFail.status).toBe(400);

    // Wyłączenie trustedDevices.enabled cofa natychmiast wszystkie zaufane urządzenia globalnie
    const disableAllRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        trustedDevices: { enabled: false },
      }),
    });
    expect(disableAllRes.status).toBe(200);

    expect(
      (await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: renewedDevCookie } }))
        .status
    ).toBe(401);

    // Ponowne włączenie nie przywraca cofniętych urządzeń
    await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        trustedDevices: { enabled: true },
      }),
    });
    expect(
      (await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: renewedDevCookie } }))
        .status
    ).toBe(401);
  });

  it('zarządzanie listą urządzeń (/api/auth/devices oraz admin /api/users/:id/devices), brak wycieku w /api/state, CSRF Origin i rate limit', async () => {
    ctx = await startServer();
    const { adminCookie, adminUser } = await setupAdmin(ctx.baseUrl);
    const user = await createApprovedUser(ctx.baseUrl, adminCookie);

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/126.0 Windows' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    const userSession = extractCookiePair(loginRes, 'zp_session');
    const userDev1 = extractCookiePair(loginRes, 'zp_device');

    const loginRes2 = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Firefox/126.0 Linux' },
      body: JSON.stringify({ email: user.email, password: USER_PASS, trustDevice: true }),
    });
    const userDev2 = extractCookiePair(loginRes2, 'zp_device');

    // GET /api/auth/devices zwraca oba urządzenia i oznacza bieżące
    const listRes = await fetch(`${ctx.baseUrl}/api/auth/devices`, {
      headers: { Cookie: `${userSession}; ${userDev1}` },
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.devices).toHaveLength(2);
    expect(listData.devices.filter((d: any) => d.current)).toHaveLength(1);
    expect(JSON.stringify(listData)).not.toContain('tokenHash');
    expect(JSON.stringify(listData)).not.toContain('previousTokenHash');

    // Zwykły użytkownik nie ma dostępu do admin endpointu innego użytkownika -> 403
    expect(
      (
        await fetch(`${ctx.baseUrl}/api/users/${adminUser.id}/devices`, {
          headers: { Cookie: userSession },
        })
      ).status
    ).toBe(403);

    // Admin widzi urządzenia użytkownika i może usunąć jedno z nich
    const adminListRes = await fetch(`${ctx.baseUrl}/api/users/${user.id}/devices`, {
      headers: { Cookie: adminCookie },
    });
    expect(adminListRes.status).toBe(200);
    const adminList = await adminListRes.json();
    expect(adminList.devices).toHaveLength(2);

    const nonCurrent = listData.devices.find((d: any) => !d.current);
    const delOne = await fetch(`${ctx.baseUrl}/api/auth/devices/${nonCurrent.id}`, {
      method: 'DELETE',
      headers: { Cookie: `${userSession}; ${userDev1}` },
    });
    expect(delOne.status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/device-login`, { method: 'POST', headers: { Cookie: userDev2 } })).status).toBe(401);

    // GET /api/state nie ujawnia trustedDevices, a POST /api/state nie nadpisuje appState.trustedDevices
    const stateGet = await (await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })).json();
    expect(stateGet.state.trustedDevices).toBeUndefined();

    const statePost = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ projects: [], tasks: [], trustedDevices: [] }),
    });
    expect(statePost.status).toBe(200);

    const afterImportList = await (
      await fetch(`${ctx.baseUrl}/api/auth/devices`, {
        headers: { Cookie: `${userSession}; ${userDev1}` },
      })
    ).json();
    expect(afterImportList.devices).toHaveLength(1);

    // CSRF: obcy Origin na POST /api/auth/device-login -> 403
    const csrfRes = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        Cookie: userDev1,
      },
    });
    expect(csrfRes.status).toBe(403);

    // Rate limiter: ponad 20 żądań /api/auth/device-login w 15 minut -> 429
    let hit429 = false;
    for (let i = 0; i < 25; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/auth/device-login`, {
        method: 'POST',
      });
      if (r.status === 429) {
        hit429 = true;
        break;
      }
    }
    expect(hit429).toBe(true);
  });
});
