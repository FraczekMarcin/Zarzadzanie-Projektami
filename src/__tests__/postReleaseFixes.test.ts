import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Księżyc-Wiosna-2026!';

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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-p46-'));
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
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe('P46: passwordResetAvailable w setup-status oraz biała lista PATCH /api/auth/preferences', () => {
  it('zwraca passwordResetAvailable=false przed konfiguracją SMTP i true po skonfigurowaniu SMTP (bez wycieku istnienia kont)', async () => {
    const server = await startServer();
    try {
      // Przed konfiguracją administratora i SMTP (brak sesji)
      const unauthBefore = await fetch(`${server.baseUrl}/api/auth/setup-status`);
      expect(unauthBefore.status).toBe(200);
      const unauthBeforeJson = await unauthBefore.json();
      expect(unauthBeforeJson.passwordResetAvailable).toBe(false);

      // Utworzenie administratora
      const setupRes = await fetch(`${server.baseUrl}/api/auth/setup-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Anna Kowalska',
          email: 'admin@pracownia.pl',
          password: ADMIN_PASS,
          department: 'Architektura',
        }),
      });
      expect(setupRes.status).toBe(200);
      const adminCookie = extractSessionCookie(setupRes);
      expect(adminCookie).toContain('zp_session=');

      // Zalogowany admin bez SMTP
      const authBefore = await fetch(`${server.baseUrl}/api/auth/setup-status`, {
        headers: { Cookie: adminCookie },
      });
      expect(authBefore.status).toBe(200);
      const authBeforeJson = await authBefore.json();
      expect(authBeforeJson.passwordResetAvailable).toBe(false);

      // Konfiguracja SMTP przez panel administratora
      const putRes = await fetch(`${server.baseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          currentPassword: ADMIN_PASS,
          smtp: {
            host: 'smtp.pracownia.example',
            port: 587,
            encryption: 'starttls',
            fromAddress: 'powiadomienia@pracownia.example',
          },
        }),
      });
      expect(putRes.status).toBe(200);

      // Zarówno bez sesji jak i z sesją flaga zmienia się na true
      const unauthAfter = await fetch(`${server.baseUrl}/api/auth/setup-status`);
      expect(unauthAfter.status).toBe(200);
      const unauthAfterJson = await unauthAfter.json();
      expect(unauthAfterJson.passwordResetAvailable).toBe(true);

      const authAfter = await fetch(`${server.baseUrl}/api/auth/setup-status`, {
        headers: { Cookie: adminCookie },
      });
      expect(authAfter.status).toBe(200);
      const authAfterJson = await authAfter.json();
      expect(authAfterJson.passwordResetAvailable).toBe(true);

      // Odpowiedź na reset hasła nie ujawnia istnienia konta
      const reqMissing = await fetch(`${server.baseUrl}/api/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nieistnieje@pracownia.pl' }),
      });
      expect(reqMissing.status).toBe(200);
      const reqMissingJson = await reqMissing.json();
      expect(reqMissingJson.success).toBe(true);
      expect(reqMissingJson.message).toContain('Jeśli podany adres e-mail istnieje');
    } finally {
      await server.close();
    }
  });

  it('PATCH /api/auth/preferences akceptuje wyłącznie emailReminders i odrzuca 400 nieznane lub błędne pola', async () => {
    const server = await startServer();
    try {
      const setupRes = await fetch(`${server.baseUrl}/api/auth/setup-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Anna Kowalska',
          email: 'admin@pracownia.pl',
          password: ADMIN_PASS,
          department: 'Architektura',
        }),
      });
      const adminCookie = extractSessionCookie(setupRes);

      // Poprawne wyłączenie i włączenie
      const okOff = await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ emailReminders: false }),
      });
      expect(okOff.status).toBe(200);
      const okOffJson = await okOff.json();
      expect(okOffJson.user.emailReminders).toBe(false);

      // Dodatkowe nieznane pole razem z poprawnym -> 400
      const extraField = await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ emailReminders: true, role: 'superadmin' }),
      });
      expect(extraField.status).toBe(400);

      // Wyłącznie nieznane pole -> 400
      const unknownOnly = await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ isApproved: true }),
      });
      expect(unknownOnly.status).toBe(400);

      // Niedozwolony klucz prototypu -> 400
      const protoRes = await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: '{"emailReminders":true,"__proto__":{"polluted":true}}',
      });
      expect(protoRes.status).toBe(400);

      // Błędny typ wartości -> 400
      const badType = await fetch(`${server.baseUrl}/api/auth/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ emailReminders: 'yes' }),
      });
      expect(badType.status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
