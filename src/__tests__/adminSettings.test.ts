import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import nodemailer from 'nodemailer';
import { createApp, CreateAppOptions } from '../../server.js';
import { validateAdminSettingsUpdate } from '../utils/settingsSchema.js';
import { createSettingsService } from '../server/settings.js';
import { createMailer, formatSmtpErrorPolish } from '../server/mailer.js';
import { resolveServerConfig } from '../server/config.js';
import { createStateStore } from '../server/state.js';

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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-admin-settings-'));
  const shouldCleanupDir = !overrides.dataDir;
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    setupToken: '',
    googleSyncDisableTimers: true,
    backupWatchDisableTimers: true,
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
  const data = await res.json();
  expect(res.status).toBe(200);
  return { res, data, cookie: extractSessionCookie(res) };
}

describe('P42: Walidacja schematu ustawień (settingsSchema)', () => {
  it('waliduje zakresy portu, trybu szyfrowania, e-maila nadawcy oraz spójność sesji', () => {
    const valid = validateAdminSettingsUpdate(
      {
        smtp: {
          host: 'smtp.pracownia.pl',
          port: 465,
          encryption: 'tls',
          user: 'bot',
          password: 'secret-smtp-password',
          fromName: 'Biuro',
          fromAddress: 'biuro@pracownia.pl',
          allowSelfSigned: true,
        },
        access: { allowSelfRegistration: false },
        sessions: { idleMinutes: 60, maxHours: 8 },
      },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(valid.ok).toBe(true);
    expect(valid.errors).toEqual([]);
    expect(valid.patch.smtp?.port).toBe(465);

    const badPort = validateAdminSettingsUpdate(
      { smtp: { port: 70000 } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(badPort.ok).toBe(false);
    expect(badPort.errors[0]).toContain('65535');

    const badEnc = validateAdminSettingsUpdate(
      { smtp: { encryption: 'sslv3' } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(badEnc.ok).toBe(false);

    const badEmail = validateAdminSettingsUpdate(
      { smtp: { fromAddress: 'nie-email' } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(badEmail.ok).toBe(false);

    const badIdleMax = validateAdminSettingsUpdate(
      { sessions: { idleMinutes: 3, maxHours: 200 } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(badIdleMax.ok).toBe(false);
    expect(badIdleMax.errors.length).toBeGreaterThanOrEqual(2);

    const inconsistent = validateAdminSettingsUpdate(
      { sessions: { idleMinutes: 120, maxHours: 1 } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(inconsistent.ok).toBe(false);
    expect(inconsistent.errors[0]).toContain('nie może przekraczać');

    // Puste hasło oznacza brak zmiany
    const emptyPass = validateAdminSettingsUpdate(
      { smtp: { password: '' } },
      { idleMinutes: 120, maxHours: 12 }
    );
    expect(emptyPass.ok).toBe(true);
    expect(emptyPass.patch.smtp?.password).toBeUndefined();
  });
});

describe('P42: Ustawienia administratora w API (pierwszeństwo, szyfrowanie, bezpieczeństwo, brak restartu)', () => {
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_ENCRYPTION',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'SMTP_ALLOW_SELF_SIGNED',
    'ALLOW_SELF_REGISTRATION',
    'SESSION_IDLE_MINUTES',
    'SESSION_MAX_HOURS',
  ];

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
      if (envBackup[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = envBackup[k];
      }
    }
  });

  it('wymaga roli administratora (403 dla innych ról) i aktualnego hasła administratora przy PUT (400/401)', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // Utwórz zwykłego użytkownika
    const createRes = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projektant Jan',
        email: 'jan@pracownia.pl',
        password: USER_PASS,
        role: 'developer',
        department: 'Architektura',
      }),
    });
    expect(createRes.status).toBe(200);

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jan@pracownia.pl', password: USER_PASS }),
    });
    expect(loginRes.status).toBe(200);
    const userCookie = extractSessionCookie(loginRes);

    // Zwykły użytkownik -> 403
    expect((await fetch(`${ctx.baseUrl}/api/admin/settings`, { headers: { Cookie: userCookie } })).status).toBe(403);
    expect(
      (
        await fetch(`${ctx.baseUrl}/api/admin/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: userCookie },
          body: JSON.stringify({ currentPassword: USER_PASS, access: { allowSelfRegistration: false } }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${ctx.baseUrl}/api/admin/settings/smtp-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: userCookie },
          body: JSON.stringify({}),
        })
      ).status
    ).toBe(403);

    // Admin bez currentPassword -> 400
    const noPassRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ access: { allowSelfRegistration: false } }),
    });
    expect(noPassRes.status).toBe(400);

    // Admin z błędnym currentPassword -> 401
    const badPassRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: 'Bledne-Haslo-2026!',
        access: { allowSelfRegistration: false },
      }),
    });
    expect(badPassRes.status).toBe(401);
  });

  it('zasada pierwszeństwa env > ui > default oraz 409 przy próbie zmiany pola zablokowanego przez env', async () => {
    process.env.SMTP_HOST = 'env-smtp.pracownia.pl';
    process.env.SESSION_MAX_HOURS = '24';

    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const getRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();

    // env > ui > default
    expect(body.smtp.host).toEqual({
      value: 'env-smtp.pracownia.pl',
      source: 'env',
      locked: true,
      envVar: 'SMTP_HOST',
    });
    expect(body.sessions.maxHours).toEqual({
      value: 24,
      source: 'env',
      locked: true,
      envVar: 'SESSION_MAX_HOURS',
    });
    expect(body.sessions.idleMinutes).toEqual({
      value: 120,
      source: 'default',
      locked: false,
    });
    // Sekcja tylko do odczytu zawiera oczekiwane pola bez wartości APP_SECRET
    expect(body.readOnly.dataDir).toBe(ctx.dataDir);
    expect(body.readOnly.mode).toBe('production');
    expect(body.readOnly.appSecret).toEqual({
      configured: true,
      lengthOk: true,
      source: 'option',
    });
    expect(JSON.stringify(body)).not.toContain(TEST_APP_SECRET);

    // Próba nadpisania SMTP_HOST z UI -> 409 z nazwą zmiennej
    const lockedRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        smtp: { host: 'nowy.smtp.pl' },
      }),
    });
    expect(lockedRes.status).toBe(409);
    const lockedErr = await lockedRes.json();
    expect(lockedErr.envVar).toBe('SMTP_HOST');
    expect(lockedErr.error).toContain('SMTP_HOST');

    // Zapis niezablokowanego pola działa i zmienia źródło na 'ui'
    const okRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        sessions: { idleMinutes: 45 },
      }),
    });
    expect(okRes.status).toBe(200);
    const okData = await okRes.json();
    expect(okData.settings.sessions.idleMinutes).toEqual({
      value: 45,
      source: 'ui',
      locked: false,
    });
  });

  it('szyfruje hasło SMTP w app_state.json, nie ujawnia go w /api/state ani /api/admin/settings, chroni przed POST /api/state oraz nie loguje wartości w security_log', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const SMTP_SECRET_PW = 'SuperTajneHasloSmtp!987';

    const saveRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        smtp: {
          host: 'mail.firma.pl',
          port: 587,
          encryption: 'starttls',
          user: 'mailer@firma.pl',
          password: SMTP_SECRET_PW,
          fromName: 'Pracownia',
          fromAddress: 'biuro@firma.pl',
        },
      }),
    });
    expect(saveRes.status).toBe(200);
    const saveData = await saveRes.json();
    expect(saveData.settings.smtp.passwordSet.value).toBe(true);
    expect(JSON.stringify(saveData)).not.toContain(SMTP_SECRET_PW);

    // GET /api/admin/settings nie zwraca hasła
    const adminGet = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      headers: { Cookie: adminCookie },
    });
    const adminGetText = await adminGet.text();
    expect(adminGetText).not.toContain(SMTP_SECRET_PW);
    expect(adminGetText).not.toContain('enc:v1:');

    // GET /api/state nie zawiera serverSettings ani hasła SMTP
    const stateGet = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    const stateJson = await stateGet.json();
    expect(stateJson.state.serverSettings).toBeUndefined();
    expect(JSON.stringify(stateJson)).not.toContain(SMTP_SECRET_PW);

    // POST /api/state zachowuje serverSettings (nie pozwala na wyczyszczenie ani nadpisanie)
    const importStateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projects: [],
        tasks: [],
        serverSettings: { smtp: { host: 'evil.example' } },
      }),
    });
    expect(importStateRes.status).toBe(200);

    const verifyAfterImport = await (
      await fetch(`${ctx.baseUrl}/api/admin/settings`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(verifyAfterImport.smtp.host.value).toBe('mail.firma.pl');
    expect(verifyAfterImport.smtp.passwordSet.value).toBe(true);

    // Plik app_state.json zawiera serverSettings, a hasło jest zaszyfrowane enc:v1:
    const rawDiskState = fs.readFileSync(path.join(ctx.dataDir, 'app_state.json'), 'utf-8');
    expect(rawDiskState).not.toContain(SMTP_SECRET_PW);
    const parsedDisk = JSON.parse(rawDiskState);
    expect(parsedDisk.serverSettings?.smtp?.passwordEncrypted).toMatch(/^enc:v1:/);

    // security_log.jsonl zawiera settings_changed wyłącznie z nazwami pól, BEZ wartości
    const secEventsRes = await fetch(`${ctx.baseUrl}/api/security/events?type=settings_changed`, {
      headers: { Cookie: adminCookie },
    });
    const secEventsData = await secEventsRes.json();
    expect(secEventsData.events.length).toBe(1);
    expect(secEventsData.events[0].details.changedFields).toContain('smtp.password');
    expect(secEventsData.events[0].details.changedFields).toContain('smtp.host');
    const rawSecLog = fs.readFileSync(path.join(ctx.dataDir, 'security_log.jsonl'), 'utf-8');
    expect(rawSecLog).not.toContain(SMTP_SECRET_PW);
    expect(rawSecLog).not.toContain('mail.firma.pl');
    expect(rawSecLog).not.toContain('mailer@firma.pl');

    // Usuwanie hasła SMTP działa po podaniu clearPassword: true
    const clearPassRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        smtp: { clearPassword: true },
      }),
    });
    expect(clearPassRes.status).toBe(200);
    const cleared = await clearPassRes.json();
    expect(cleared.settings.smtp.passwordSet.value).toBe(false);
  });

  it('zmiana allowSelfRegistration i limitów sesji działa natychmiast bez restartu i nie przerywa ważnej sesji', async () => {
    ctx = await startServer({ allowSelfRegistration: true });
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // 1. Początkowo rejestracja włączona
    const statusBefore = await (await fetch(`${ctx.baseUrl}/api/auth/setup-status`)).json();
    expect(statusBefore.allowSelfRegistration).toBe(true);

    // 2. Wyłącz rejestrację oraz zmień limity sesji (bez restartu)
    const updateRes = await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        access: { allowSelfRegistration: false },
        sessions: { idleMinutes: 15, maxHours: 4 },
      }),
    });
    expect(updateRes.status).toBe(200);

    // 3. Rejestracja natychmiast wyłączona na /setup-status oraz POST /register -> 403
    const statusAfter = await (await fetch(`${ctx.baseUrl}/api/auth/setup-status`)).json();
    expect(statusAfter.allowSelfRegistration).toBe(false);

    const regBlocked = await fetch(`${ctx.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nowy User',
        email: 'nowy@pracownia.pl',
        password: USER_PASS,
      }),
    });
    expect(regBlocked.status).toBe(403);

    // 4. Bieżąca sesja administratora pozostała ważna i nie została przerwana,
    // a nowe logowanie dostaje ciasteczko z zaktualizowanym Max-Age (4h = 14400s)
    const meStillOk = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: adminCookie },
    });
    expect(meStillOk.status).toBe(200);

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pracownia.pl', password: ADMIN_PASS }),
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.headers.get('set-cookie')).toContain('Max-Age=14400');
  });

  it('mailer obsługuje tryby szyfrowania (none, starttls, tls) oraz allowSelfSigned, a endpoint testowy loguje i zwraca czytelne błędy PL bez hasła', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-mailer-unit-'));
    try {
      const config = resolveServerConfig({
        dataDir: tempDir,
        appSecret: TEST_APP_SECRET,
        isProduction: true,
      });
      const stateStore = await createStateStore(config);
      const settingsService = createSettingsService({ config, stateStore });
      const mailer = createMailer(settingsService);

      const sendMailSpy = vi.fn(async () => ({ messageId: 'ok-1' }));
      const createTransportSpy = vi
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail: sendMailSpy } as any);

      // 1. Tryb TLS + allowSelfSigned: true
      await settingsService.applySettingsPatch({
        smtp: {
          host: 'smtp.local',
          port: 465,
          encryption: 'tls',
          user: 'u',
          password: 'secret-password-xyz',
          fromName: 'Pracownia',
          fromAddress: 'biuro@local.pl',
          allowSelfSigned: true,
        },
      });
      await mailer.sendMail({ to: 'a@b.pl', subject: 'Test TLS', text: 'Hi' });
      expect(createTransportSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          host: 'smtp.local',
          port: 465,
          secure: true,
          tls: { rejectUnauthorized: false },
          auth: { user: 'u', pass: 'secret-password-xyz' },
        })
      );

      // 2. Tryb STARTTLS + allowSelfSigned: false
      await settingsService.applySettingsPatch({
        smtp: { port: 587, encryption: 'starttls', allowSelfSigned: false },
      });
      await mailer.sendMail({ to: 'a@b.pl', subject: 'Test STARTTLS', text: 'Hi' });
      const startTlsCall = createTransportSpy.mock.calls.at(-1)?.[0] as any;
      expect(startTlsCall.secure).toBe(false);
      expect(startTlsCall.requireTLS).toBe(true);
      expect(startTlsCall.tls).toBeUndefined();

      // 3. Tryb none (bez szyfrowania)
      await settingsService.applySettingsPatch({
        smtp: { port: 25, encryption: 'none', allowSelfSigned: true },
      });
      await mailer.sendMail({ to: 'a@b.pl', subject: 'Test None', text: 'Hi' });
      const noneCall = createTransportSpy.mock.calls.at(-1)?.[0] as any;
      expect(noneCall.secure).toBe(false);
      expect(noneCall.ignoreTLS).toBe(true);
      expect(noneCall.tls).toBeUndefined();

      // Polskie komunikaty błędów bez wycieku hasła
      expect(formatSmtpErrorPolish({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND secret-password-xyz' }, 'secret-password-xyz')).toContain('DNS');
      expect(formatSmtpErrorPolish({ code: 'ECONNREFUSED' })).toContain('odrzucił połączenie');
      expect(formatSmtpErrorPolish({ code: 'EAUTH', responseCode: 535 })).toContain('uwierzytelniania');
      expect(formatSmtpErrorPolish({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toContain('certyfikatu TLS');
      expect(formatSmtpErrorPolish({ code: 'ETIMEDOUT' })).toContain('limit czasu');
      const generic = formatSmtpErrorPolish(new Error('fail secret-password-xyz'), 'secret-password-xyz');
      expect(generic).not.toContain('secret-password-xyz');
      expect(generic).toContain('[UKRYTE]');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('POST /api/admin/settings/smtp-test wysyła test i rejestruje smtp_test_sent / smtp_test_failed', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    await fetch(`${ctx.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: ADMIN_PASS,
        smtp: {
          host: 'smtp.pracownia.pl',
          port: 587,
          encryption: 'starttls',
          fromAddress: 'biuro@pracownia.pl',
        },
      }),
    });

    const sendMailSpy = vi
      .fn()
      .mockResolvedValueOnce({ messageId: 'ok-test' })
      .mockRejectedValueOnce(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }));
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailSpy } as any);

    // Sukces -> 200 + smtp_test_sent
    const okTestRes = await fetch(`${ctx.baseUrl}/api/admin/settings/smtp-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect(okTestRes.status).toBe(200);
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect((sendMailSpy.mock.calls[0] as any)[0].to).toBe('admin@pracownia.pl');

    // Błąd auth -> 502 po polsku + smtp_test_failed
    const failTestRes = await fetch(`${ctx.baseUrl}/api/admin/settings/smtp-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ to: 'odbiorca@pracownia.pl' }),
    });
    expect(failTestRes.status).toBe(502);
    const failJson = await failTestRes.json();
    expect(failJson.error).toContain('uwierzytelniania');

    const sentEvents = await (
      await fetch(`${ctx.baseUrl}/api/security/events?type=smtp_test_sent`, {
        headers: { Cookie: adminCookie },
      })
    ).json();
    expect(sentEvents.events.length).toBe(1);

    const failedEvents = await (
      await fetch(`${ctx.baseUrl}/api/security/events?type=smtp_test_failed`, {
        headers: { Cookie: adminCookie },
      })
    ).json();
    expect(failedEvents.events.length).toBe(1);
  });

  it('w trybie dev aplikacja startuje bez żadnych zmiennych środowiskowych i utrwala .dev_app_secret w DATA_DIR', async () => {
    const devDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-dev-nosecret-'));
    try {
      const prevSecret = process.env.APP_SECRET;
      delete process.env.APP_SECRET;
      try {
        const instance = await createApp({
          dataDir: devDir,
          isProduction: false,
          port: 0,
          enableVite: false,
          googleSyncDisableTimers: true,
          backupWatchDisableTimers: true,
        });
        await instance.close();
      } finally {
        if (prevSecret !== undefined) process.env.APP_SECRET = prevSecret;
      }

      const secretFile = path.join(devDir, '.dev_app_secret');
      expect(fs.existsSync(secretFile)).toBe(true);
      const firstSecret = fs.readFileSync(secretFile, 'utf-8').trim();
      expect(firstSecret.length).toBe(64);
      expect(fs.statSync(secretFile).mode & 0o777).toBe(0o600);

      // Ponowny start używa dokładnie tego samego klucza z .dev_app_secret
      const cfg2 = resolveServerConfig({ dataDir: devDir, isProduction: false });
      expect(cfg2.effectiveAppSecret).toBe(firstSecret);
      expect(cfg2.appSecretSource).toBe('dev_file');
    } finally {
      fs.rmSync(devDir, { recursive: true, force: true });
    }
  });
});
