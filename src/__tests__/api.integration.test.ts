import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import ical from 'node-ical';
import { createApp, CreateAppOptions } from '../../server.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface TestServerContext {
  baseUrl: string;
  hostHeader: string;
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
    const match = raw.match(/(?:__Host-zp_session|zp_session)=([^;]+)/);
    if (match) {
      return raw.split(';')[0];
    }
  }
  return '';
}

async function startTestServer(overrides: Partial<CreateAppOptions> = {}): Promise<TestServerContext> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-api-test-'));
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    allowSelfRegistration: true,
    setupToken: '',
    ...overrides,
  });

  const httpServer = http.createServer(instance.app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    await instance.close();
    throw new Error('Nie udało się odczytać portu testowego serwera');
  }

  const hostHeader = `127.0.0.1:${addr.port}`;
  const baseUrl = `http://${hostHeader}`;

  const close = async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await instance.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, hostHeader, dataDir, close };
}

async function setupAdmin(
  baseUrl: string,
  options: { setupToken?: string; email?: string; password?: string; name?: string } = {}
) {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: options.name ?? 'Admin Testowy',
      email: options.email ?? 'admin@pracownia.pl',
      password: options.password ?? 'Księżyc-Wiosna-2026!',
      ...(options.setupToken !== undefined ? { setupToken: options.setupToken } : {}),
    }),
  });
  const data = await res.json();
  const cookie = extractSessionCookie(res);
  return { res, data, cookie };
}

describe('Integracyjne testy API (server.ts)', () => {
  let ctx: TestServerContext | null = null;

  beforeEach(() => {
    ctx = null;
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
  });

  it('setup-admin działa bez SETUP_TOKEN i wymusza poprawny token gdy SETUP_TOKEN jest ustawiony', async () => {
    // 1. Bez SETUP_TOKEN
    ctx = await startTestServer({ setupToken: '' });
    const statusRes1 = await fetch(`${ctx.baseUrl}/api/auth/setup-status`);
    expect(statusRes1.status).toBe(200);
    const status1 = await statusRes1.json();
    expect(status1.setupRequired).toBe(true);
    expect(status1.requireSetupToken).toBe(false);

    const { res: okRes, data: okData, cookie: okCookie } = await setupAdmin(ctx.baseUrl);
    expect(okRes.status).toBe(200);
    expect(okData.success).toBe(true);
    expect(okData.user.role).toBe('admin');
    expect(okCookie).toContain('zp_session=');

    // Kolejna próba setup-admin musi zostać odrzucona
    const dupRes = await fetch(`${ctx.baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Drugi Admin',
        email: 'admin2@pracownia.pl',
        password: 'Księżyc-Wiosna-2026!',
      }),
    });
    expect(dupRes.status).toBe(400);

    await ctx.close();
    ctx = null;

    // 2. Z wymaganym SETUP_TOKEN
    ctx = await startTestServer({ setupToken: 'super-tajny-token-instalacyjny' });
    const statusRes2 = await fetch(`${ctx.baseUrl}/api/auth/setup-status`);
    const status2 = await statusRes2.json();
    expect(status2.setupRequired).toBe(true);
    expect(status2.requireSetupToken).toBe(true);

    // Brak tokena -> 403
    const missingTok = await setupAdmin(ctx.baseUrl);
    expect(missingTok.res.status).toBe(403);

    // Błędny token -> 403
    const wrongTok = await setupAdmin(ctx.baseUrl, { setupToken: 'zly-token' });
    expect(wrongTok.res.status).toBe(403);

    // Poprawny token -> 200
    const validTok = await setupAdmin(ctx.baseUrl, { setupToken: 'super-tajny-token-instalacyjny' });
    expect(validTok.res.status).toBe(200);
    expect(validTok.data.success).toBe(true);
    expect(validTok.cookie).toContain('zp_session=');
  });

  it('logowanie ustawia ciasteczko HttpOnly sesji i pozwala na dostęp do /api/auth/me oraz wylogowanie', async () => {
    ctx = await startTestServer();
    const { res: setupRes } = await setupAdmin(ctx.baseUrl, {
      email: 'jan@pracownia.pl',
      password: 'Silne-Haslo-Krakow-2026!',
    });
    expect(setupRes.status).toBe(200);

    // Błędne hasło -> 401
    const badLogin = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jan@pracownia.pl', password: 'BledneHaslo' }),
    });
    expect(badLogin.status).toBe(401);

    // Poprawne logowanie -> 200 + Set-Cookie HttpOnly
    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jan@pracownia.pl', password: 'Silne-Haslo-Krakow-2026!' }),
    });
    expect(loginRes.status).toBe(200);
    const setCookieHeader = loginRes.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain('zp_session=');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Lax');

    const cookie = extractSessionCookie(loginRes);
    expect(cookie).not.toBe('');

    const meRes = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.authenticated).toBe(true);
    expect(meData.user.email).toBe('jan@pracownia.pl');
    expect(meData.user.passwordHash).toBeUndefined();

    // Wylogowanie unieważnia sesję
    const logoutRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it('zwraca 401 dla chronionych tras bez aktywnej sesji', async () => {
    ctx = await startTestServer();
    await setupAdmin(ctx.baseUrl);

    const protectedEndpoints: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/auth/me' },
      { method: 'GET', path: '/api/auth/sessions' },
      { method: 'GET', path: '/api/state' },
      { method: 'GET', path: '/api/state/revision' },
      { method: 'GET', path: '/api/security/events' },
      { method: 'GET', path: '/api/backup/status' },
      { method: 'POST', path: '/api/projects', body: { name: 'Projekt' } },
      { method: 'POST', path: '/api/tasks', body: { title: 'Zadanie', projectId: 'x' } },
      { method: 'POST', path: '/api/activity', body: { projectId: 'x', action: 'test' } },
      { method: 'POST', path: '/api/state', body: { tasks: [] } },
    ];

    for (const ep of protectedEndpoints) {
      const res = await fetch(`${ctx.baseUrl}${ep.path}`, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.status, `Oczekiwano 401 dla ${ep.method} ${ep.path}`).toBe(401);
    }

    // Publiczny healthcheck dalej zwraca 200
    const healthRes = await fetch(`${ctx.baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
  });

  it('blokuje żądania mutujące z obcym nagłówkiem Origin (403) i przepuszcza własny Origin (200/201)', async () => {
    ctx = await startTestServer();
    const { cookie } = await setupAdmin(ctx.baseUrl);

    // Obcy Origin z ciasteczkiem -> 403
    const evilRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://evil-attacker.example',
      },
      body: JSON.stringify({ name: 'Zły Projekt' }),
    });
    expect(evilRes.status).toBe(403);

    // Własny Origin z ciasteczkiem -> 201 / 200
    const ownOriginRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: ctx.baseUrl,
      },
      body: JSON.stringify({ name: 'Własny Projekt', key: 'WL' }),
    });
    expect(ownOriginRes.status).toBe(201);

    const ownLogout = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: ctx.baseUrl,
      },
    });
    expect(ownLogout.status).toBe(200);
  });

  it('wymusza izolację developera w /api/state, feedzie ICS, przenoszeniu zadań, memberIds i aktywności', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie, data: adminSetup } = await setupAdmin(ctx.baseUrl);
    const adminId = adminSetup.user.id;

    // Utwórz dwóch developerów
    const dev1Res = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Dev Jeden',
        email: 'dev1@pracownia.pl',
        role: 'developer',
        password: 'Projekt-Most-2026-Krakow!',
      }),
    });
    expect(dev1Res.status).toBe(200);
    const dev1Id = (await dev1Res.json()).user.id;

    const dev2Res = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Dev Dwa',
        email: 'dev2@pracownia.pl',
        role: 'developer',
        password: 'Projekt-Tunel-2026-Gdansk!',
      }),
    });
    expect(dev2Res.status).toBe(200);
    const dev2Id = (await dev2Res.json()).user.id;

    // Admin tworzy projekt A (dla dev1) i projekt B (wyłącznie dla dev2)
    const projARes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Dostępny A',
        key: 'PA',
        memberIds: [adminId, dev1Id],
        budget: 150000,
        clientName: 'Poufny Klient A',
      }),
    });
    expect(projARes.status).toBe(201);
    const projA = (await projARes.json()).project;

    const projBRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Cudzy B',
        key: 'PB',
        memberIds: [adminId, dev2Id],
        budget: 999999,
        clientName: 'Poufny Klient B',
      }),
    });
    expect(projBRes.status).toBe(201);
    const projB = (await projBRes.json()).project;

    // Admin tworzy zadania w obu projektach
    const taskARes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: projA.id,
        title: 'Zadanie Widoczne A',
        assigneeId: dev1Id,
        dueDate: '2026-12-01',
      }),
    });
    expect(taskARes.status).toBe(201);
    const taskA = (await taskARes.json()).task;

    const taskBRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: projB.id,
        title: 'Tajne Zadanie B',
        assigneeId: dev2Id,
        dueDate: '2026-12-02',
      }),
    });
    expect(taskBRes.status).toBe(201);

    // Logowanie jako dev1
    const devLogin = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev1@pracownia.pl', password: 'Projekt-Most-2026-Krakow!' }),
    });
    expect(devLogin.status).toBe(200);
    const devCookie = extractSessionCookie(devLogin);

    // 1. /api/state ukrywa cudze projekty, pola finansowe/klienta oraz cudze zadania
    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: devCookie },
    });
    expect(stateRes.status).toBe(200);
    const stateJson = await stateRes.json();
    const visibleProjectIds = stateJson.state.projects.map((p: any) => p.id);
    const visibleTaskTitles = stateJson.state.tasks.map((t: any) => t.title);

    expect(visibleProjectIds).toContain(projA.id);
    expect(visibleProjectIds).not.toContain(projB.id);
    expect(stateJson.state.projects[0].budget).toBeUndefined();
    expect(stateJson.state.projects[0].clientName).toBeUndefined();
    expect(visibleTaskTitles).toContain('Zadanie Widoczne A');
    expect(visibleTaskTitles).not.toContain('Tajne Zadanie B');

    // 2. Feed ICS nie zawiera cudzych zadań
    const tokenRes = await fetch(`${ctx.baseUrl}/api/calendar/token/generate`, {
      method: 'POST',
      headers: { Cookie: devCookie },
    });
    expect(tokenRes.status).toBe(200);
    const { token } = await tokenRes.json();

    const icsRes = await fetch(`${ctx.baseUrl}/api/calendar/${token}/all.ics`);
    expect(icsRes.status).toBe(200);
    const icsBody = await icsRes.text();
    expect(icsBody).toContain('Zadanie Widoczne A');
    expect(icsBody).not.toContain('Tajne Zadanie B');

    // 3. Developer nie może przenieść zadania do cudzego projektu -> 403
    const moveRes = await fetch(`${ctx.baseUrl}/api/tasks/${taskA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ projectId: projB.id }),
    });
    expect(moveRes.status).toBe(403);

    // 4. Developer nie może zmienić memberIds projektu -> 403
    const memberRes = await fetch(`${ctx.baseUrl}/api/projects/${projA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ memberIds: [adminId, dev1Id, dev2Id] }),
    });
    expect(memberRes.status).toBe(403);

    // 5. Developer dostaje 403 przy próbie rejestracji aktywności w cudzym projekcie
    const activityRes = await fetch(`${ctx.baseUrl}/api/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ projectId: projB.id, action: 'Nieuprawniona aktywność' }),
    });
    expect(activityRes.status).toBe(403);
  });

  it('egzekwuje limity pól (tytuł 5000 znaków zapisany jako 200, ciało >100KB -> 413)', async () => {
    ctx = await startTestServer();
    const { cookie } = await setupAdmin(ctx.baseUrl);

    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Projekt Limity', key: 'LIM' }),
    });
    const proj = (await projRes.json()).project;

    // Tytuł 5000 znaków -> przycięty do 200
    const longTitle = 'Z'.repeat(5000);
    const taskRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ projectId: proj.id, title: longTitle }),
    });
    expect(taskRes.status).toBe(201);
    const taskData = await taskRes.json();
    expect(taskData.task.title.length).toBe(200);
    expect(taskData.task.title).toBe('Z'.repeat(200));

    // Ciało 200 KB dla zwykłego endpointu API -> 413
    const hugeDescription = 'X'.repeat(200 * 1024);
    const payloadTooLargeRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        projectId: proj.id,
        title: 'Duże żądanie',
        description: hugeDescription,
      }),
    });
    expect(payloadTooLargeRes.status).toBe(413);
    const errJson = await payloadTooLargeRes.json();
    expect(typeof errJson.error).toBe('string');
  });

  it('ogranicza liczbę rejestracji z tego samego IP (6. próba zwraca 429)', async () => {
    ctx = await startTestServer({ allowSelfRegistration: true });

    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${ctx.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Użytkownik ${i}`,
          email: `user${i}@pracownia.pl`,
          password: 'Zielony-rower-2026-xK',
        }),
      });
      expect(res.status, `Próba rejestracji #${i} powinna się powieść`).toBe(200);
    }

    const sixthRes = await fetch(`${ctx.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Użytkownik 6',
        email: 'user6@pracownia.pl',
        password: 'Zielony-rower-2026-xK',
      }),
    });
    expect(sixthRes.status).toBe(429);
    expect(sixthRes.headers.get('retry-after')).toBeTruthy();
  });

  it('konfiguracja 2FA (/2fa/setup) wymaga podania poprawnego aktualnego hasła', async () => {
    ctx = await startTestServer();
    const { cookie, data } = await setupAdmin(ctx.baseUrl, {
      password: 'MojeSuperHaslo123!',
    });
    const userId = data.user.id;

    // Brak hasła -> 400
    const noPassRes = await fetch(`${ctx.baseUrl}/api/users/${userId}/2fa/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(noPassRes.status).toBe(400);

    // Błędne hasło -> 401
    const wrongPassRes = await fetch(`${ctx.baseUrl}/api/users/${userId}/2fa/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: 'ZleHaslo123!' }),
    });
    expect(wrongPassRes.status).toBe(401);

    // Poprawne hasło -> 200 i wygenerowany sekret + kody zapasowe
    const okRes = await fetch(`${ctx.baseUrl}/api/users/${userId}/2fa/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: 'MojeSuperHaslo123!' }),
    });
    expect(okRes.status).toBe(200);
    const okData = await okRes.json();
    expect(okData.success).toBe(true);
    expect(typeof okData.secret).toBe('string');
    expect(Array.isArray(okData.backupCodes)).toBe(true);
    expect(okData.backupCodes).toHaveLength(10);
  });

  it('zmiana hasła unieważnia pozostałe aktywne sesje użytkownika, zostawiając bieżącą', async () => {
    ctx = await startTestServer();
    const { cookie: session1, data: setupData } = await setupAdmin(ctx.baseUrl, {
      email: 'anna@pracownia.pl',
      password: 'Pierwsze-Mocne-Haslo-2026!',
    });
    const userId = setupData.user.id;

    // Drugie logowanie tworzy drugą niezależną sesję
    const login2 = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'anna@pracownia.pl', password: 'Pierwsze-Mocne-Haslo-2026!' }),
    });
    expect(login2.status).toBe(200);
    const session2 = extractSessionCookie(login2);
    expect(session2).not.toBe(session1);

    // Obie sesje są początkowo ważne
    expect((await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: session1 } })).status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: session2 } })).status).toBe(200);

    // Zmiana hasła z użyciem session1
    const pwdRes = await fetch(`${ctx.baseUrl}/api/users/${userId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session1 },
      body: JSON.stringify({
        currentPassword: 'Pierwsze-Mocne-Haslo-2026!',
        newPassword: 'Drugie-Mocne-Haslo-2026!',
      }),
    });
    expect(pwdRes.status).toBe(200);

    // Bieżąca sesja (session1) pozostaje aktywna, ale inna sesja (session2) daje 401
    expect((await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: session1 } })).status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: session2 } })).status).toBe(401);
  });

  it('egzekwuje politykę haseł przy setup-admin, rejestracji, tworzeniu użytkownika i zmianie hasła', async () => {
    ctx = await startTestServer({ allowSelfRegistration: true });

    // setup-admin z popularnym hasłem -> 400 + errors[]
    const badSetup = await setupAdmin(ctx.baseUrl, { password: 'qwerty123456' });
    expect(badSetup.res.status).toBe(400);
    expect(Array.isArray(badSetup.data.errors)).toBe(true);
    expect(badSetup.data.errors.length).toBeGreaterThan(0);

    // setup-admin z poprawnym hasłem -> 200
    const { res: okSetup, cookie: adminCookie, data: adminData } = await setupAdmin(ctx.baseUrl);
    expect(okSetup.status).toBe(200);

    // Rejestracja ze słabym hasłem -> 400 + lista powodów
    const badReg = await fetch(`${ctx.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tomasz Kwiatkowski',
        email: 't.kwiatkowski@pracownia.pl',
        password: 'haslo123456',
      }),
    });
    expect(badReg.status).toBe(400);
    const badRegJson = await badReg.json();
    expect(Array.isArray(badRegJson.errors)).toBe(true);
    expect(badRegJson.errors.length).toBeGreaterThan(0);

    // Rejestracja z silnym hasłem -> 200
    const goodReg = await fetch(`${ctx.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tomasz Kwiatkowski',
        email: 't.kwiatkowski@pracownia.pl',
        password: 'Zielony-rower-2026-xK',
      }),
    });
    expect(goodReg.status).toBe(200);

    // Tworzenie użytkownika przez admina z hasłem zawierającym imię -> 400 + errors[]
    const badCreateUser = await fetch(`${ctx.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Marek Zielinski',
        email: 'marek@pracownia.pl',
        role: 'developer',
        password: 'Super-Marek-2026!',
      }),
    });
    expect(badCreateUser.status).toBe(400);
    const badCreateJson = await badCreateUser.json();
    expect(Array.isArray(badCreateJson.errors)).toBe(true);

    // Zmiana hasła na prostą sekwencję -> 400 + errors[]
    const badPwdChange = await fetch(`${ctx.baseUrl}/api/users/${adminData.user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        currentPassword: 'Księżyc-Wiosna-2026!',
        newPassword: 'abcdefghijkl',
      }),
    });
    expect(badPwdChange.status).toBe(400);
    const badPwdJson = await badPwdChange.json();
    expect(Array.isArray(badPwdJson.errors)).toBe(true);
  });

  it('zwraca JSON 404 dla nieznanej trasy pod /api/*', async () => {
    ctx = await startTestServer();

    const getUnknown = await fetch(`${ctx.baseUrl}/api/nieistniejaca-trasa`);
    expect(getUnknown.status).toBe(404);
    expect(getUnknown.headers.get('content-type')).toContain('application/json');
    expect(await getUnknown.json()).toEqual({ error: 'Nie znaleziono' });

    const postUnknown = await fetch(`${ctx.baseUrl}/api/inna/nieznana/trasa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(postUnknown.status).toBe(404);
    expect(postUnknown.headers.get('content-type')).toContain('application/json');
    expect(await postUnknown.json()).toEqual({ error: 'Nie znaleziono' });
  });

  it('nie udostępnia kodu źródłowego pod /server.js w trybie produkcyjnym', async () => {
    // Tworzymy tymczasowy katalog statyczny udający zbudowany dist/public
    const fakeStaticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-static-'));
    try {
      fs.writeFileSync(path.join(fakeStaticDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>', 'utf-8');
      ctx = await startTestServer({ isProduction: true, staticDir: fakeStaticDir });

      const res = await fetch(`${ctx.baseUrl}/server.js`);
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(text).not.toContain('createApp');
      expect(text).not.toContain('import express');
      expect(text).not.toContain('hashPasswordScrypt');
    } finally {
      fs.rmSync(fakeStaticDir, { recursive: true, force: true });
    }
  });

  it('obsługuje HEAD / (200 text/html), nie zwraca index.html dla POST / oraz zwraca 404 dla HEAD /api/nieistnieje', async () => {
    const fakeStaticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-static-head-'));
    try {
      fs.writeFileSync(path.join(fakeStaticDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>', 'utf-8');
      ctx = await startTestServer({ isProduction: true, staticDir: fakeStaticDir });

      const headRoot = await fetch(`${ctx.baseUrl}/`, { method: 'HEAD' });
      expect(headRoot.status).toBe(200);
      expect(headRoot.headers.get('content-type')).toContain('text/html');
      expect(await headRoot.text()).toBe('');

      const postRoot = await fetch(`${ctx.baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const postText = await postRoot.text();
      expect(postRoot.status).not.toBe(200);
      expect(postText).not.toContain('<!doctype html>');
      expect(postText).not.toContain('SPA');

      const headApiUnknown = await fetch(`${ctx.baseUrl}/api/nieistnieje`, { method: 'HEAD' });
      expect(headApiUnknown.status).toBe(404);
      expect(await headApiUnknown.text()).toBe('');
    } finally {
      fs.rmSync(fakeStaticDir, { recursive: true, force: true });
    }
  });

  it('wykonuje 100 kolejnych żądań POST /api/tasks w czasie poniżej 5 sekund', { timeout: 15000 }, async () => {
    ctx = await startTestServer();
    const { cookie } = await setupAdmin(ctx.baseUrl);

    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Projekt Wydajność', key: 'PERF' }),
    });
    const proj = (await projRes.json()).project;

    const startMs = Date.now();
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`${ctx.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          projectId: proj.id,
          title: `Zadanie wydajnościowe #${i + 1}`,
        }),
      });
      expect(res.status).toBe(201);
    }
    const elapsedMs = Date.now() - startMs;

    expect(elapsedMs).toBeLessThan(5000);
  });

  it('feedy iCal zwracają ETag, Last-Modified, Cache-Control, obsługują 304, respektują PUBLIC_BASE_URL i parsują się przez node-ical', async () => {
    ctx = await startTestServer({ publicBaseUrl: 'https://kalendarz.pracownia.pl' });
    const { cookie, data: setupData } = await setupAdmin(ctx.baseUrl);
    const adminId = setupData.user.id;

    // 1. Token i publicBaseUrl
    const tokenStatusBefore = await fetch(`${ctx.baseUrl}/api/calendar/token`, {
      headers: { Cookie: cookie },
    });
    expect(tokenStatusBefore.status).toBe(200);
    const statusJson = await tokenStatusBefore.json();
    expect(statusJson.hasToken).toBe(false);
    expect(statusJson.publicBaseUrl).toBe('https://kalendarz.pracownia.pl');

    const genRes = await fetch(`${ctx.baseUrl}/api/calendar/token/generate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(genRes.status).toBe(200);
    const genJson = await genRes.json();
    expect(genJson.success).toBe(true);
    expect(genJson.token).toBeTruthy();
    expect(genJson.publicBaseUrl).toBe('https://kalendarz.pracownia.pl');
    const token = genJson.token as string;

    // 2. Projekt + zadania
    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Dom nad Wisłą', key: 'DNW' }),
    });
    expect(projRes.status).toBe(201);
    const proj = (await projRes.json()).project;

    const taskRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        projectId: proj.id,
        title: 'Projekt wykonawczy',
        priority: 'normal',
        status: 'to_do',
        assigneeId: adminId,
        startDate: '2026-11-20',
        dueDate: '2026-11-21',
        durationDays: 2,
      }),
    });
    expect(taskRes.status).toBe(201);
    const createdTask = (await taskRes.json()).task;

    // 3. Dwa kolejne żądania na niezmienionych danych zwracają identyczny ETag i Cache-Control
    const feedUrl = `${ctx.baseUrl}/api/calendar/${token}/all.ics`;
    const feedRes1 = await fetch(feedUrl);
    expect(feedRes1.status).toBe(200);
    const etag1 = feedRes1.headers.get('etag');
    const lastModified1 = feedRes1.headers.get('last-modified');
    expect(etag1).toBeTruthy();
    expect(lastModified1).toBeTruthy();
    expect(feedRes1.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
    const icsBody = await feedRes1.text();

    const feedRes2 = await fetch(feedUrl);
    expect(feedRes2.status).toBe(200);
    expect(feedRes2.headers.get('etag')).toBe(etag1);

    // 4. If-None-Match -> 304 Not Modified
    const res304Etag = await fetch(feedUrl, {
      headers: { 'If-None-Match': etag1! },
    });
    expect(res304Etag.status).toBe(304);
    expect(await res304Etag.text()).toBe('');

    // 5. If-Modified-Since -> 304 Not Modified
    const res304Ims = await fetch(feedUrl, {
      headers: { 'If-Modified-Since': lastModified1! },
    });
    expect(res304Ims.status).toBe(304);
    expect(await res304Ims.text()).toBe('');

    // 6. Walidacja treści parserem node-ical
    const parsed = ical.parseICS(icsBody);
    const events = Object.values(parsed).filter((e: any) => e.type === 'VEVENT') as any[];
    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev.status).toBe('CONFIRMED');
    expect(ev.categories).toContain('Dom nad Wisłą');
    expect(ev.description).toContain('Projekt: Dom nad Wisłą');
    expect(ev.description).toContain('Priorytet: Normalny');
    expect(ev.description).toContain('Status: Do zrobienia');
    expect(ev.description).toContain('2 dni');
    expect(ev.url).toBe(`https://kalendarz.pracownia.pl/?task=${encodeURIComponent(createdTask.id)}`);
    expect(icsBody).not.toContain(token);
  });

  it('SSE /api/events: wymaga sesji (401), dostarcza rewizję do dwóch klientów w <1s, ogranicza do 5 połączeń (429) i zamyka po wylogowaniu', async () => {
    ctx = await startTestServer();
    const { cookie } = await setupAdmin(ctx.baseUrl);

    // 1. Brak sesji -> 401
    const unauthRes = await fetch(`${ctx.baseUrl}/api/events`);
    expect(unauthRes.status).toBe(401);

    interface SseHandle {
      statusCode: number;
      headers: http.IncomingHttpHeaders;
      events: Array<{ event: string; data: any }>;
      waitForEvent: (predicate: (ev: { event: string; data: any }) => boolean, timeoutMs?: number) => Promise<{ event: string; data: any }>;
      ended: Promise<void>;
      close: () => void;
    }

    const openStreams: SseHandle[] = [];

    const openSse = (sessionCookie: string): Promise<SseHandle> => {
      return new Promise((resolve, reject) => {
        const req = http.get(
          `${ctx!.baseUrl}/api/events`,
          { headers: { Cookie: sessionCookie, 'Accept-Encoding': 'gzip, deflate' } },
          (res) => {
            const events: Array<{ event: string; data: any }> = [];
            const waiters: Array<{
              predicate: (ev: { event: string; data: any }) => boolean;
              resolve: (ev: { event: string; data: any }) => void;
              reject: (err: Error) => void;
              timer: NodeJS.Timeout;
            }> = [];

            let buffer = '';
            let endedResolved = false;
            let resolveEnded: () => void = () => {};
            const ended = new Promise<void>((r) => {
              resolveEnded = () => {
                if (!endedResolved) {
                  endedResolved = true;
                  r();
                }
              };
            });

            res.setEncoding('utf-8');
            res.on('data', (chunk: string) => {
              buffer += chunk;
              const frames = buffer.split('\n\n');
              buffer = frames.pop() || '';
              for (const frame of frames) {
                const lines = frame.split('\n').filter((l) => !l.startsWith(':'));
                if (lines.length === 0) continue;
                let eventName = 'message';
                const dataParts: string[] = [];
                for (const line of lines) {
                  if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                  } else if (line.startsWith('data:')) {
                    dataParts.push(line.slice(5).trim());
                  }
                }
                if (dataParts.length === 0) continue;
                const rawData = dataParts.join('\n');
                let parsedData: any = rawData;
                try {
                  parsedData = JSON.parse(rawData);
                } catch {
                  // ignore
                }
                const ev = { event: eventName, data: parsedData };
                events.push(ev);
                for (let i = waiters.length - 1; i >= 0; i--) {
                  const w = waiters[i];
                  if (w.predicate(ev)) {
                    clearTimeout(w.timer);
                    waiters.splice(i, 1);
                    w.resolve(ev);
                  }
                }
              }
            });

            res.on('end', resolveEnded);
            res.on('close', resolveEnded);

            const handle: SseHandle = {
              statusCode: res.statusCode || 0,
              headers: res.headers,
              events,
              ended,
              waitForEvent: (predicate, timeoutMs = 1000) => {
                const existing = events.find(predicate);
                if (existing) return Promise.resolve(existing);
                return new Promise((resWait, rejWait) => {
                  const timer = setTimeout(() => {
                    rejWait(new Error(`Timeout (${timeoutMs} ms) oczekiwania na zdarzenie SSE`));
                  }, timeoutMs);
                  waiters.push({ predicate, resolve: resWait, reject: rejWait, timer });
                });
              },
              close: () => {
                req.destroy();
                res.destroy();
                resolveEnded();
              },
            };

            openStreams.push(handle);
            resolve(handle);
          }
        );

        req.on('error', (err) => {
          reject(err);
        });
      });
    };

    try {
      // 2. Dwa połączenia SSE dla zalogowanego użytkownika
      const stream1 = await openSse(cookie);
      const stream2 = await openSse(cookie);

      expect(stream1.statusCode).toBe(200);
      expect(stream1.headers['content-type']).toContain('text/event-stream');
      expect(stream1.headers['cache-control']).toBe('no-cache');
      expect(stream1.headers['x-accel-buffering']).toBe('no');
      expect(stream1.headers['content-encoding']).toBeUndefined();

      // Początkowe zdarzenie rewizji
      const init1 = await stream1.waitForEvent((e) => e.event === 'revision');
      const init2 = await stream2.waitForEvent((e) => e.event === 'revision');
      expect(Object.keys(init1.data)).toEqual(['revision']);
      expect(typeof init1.data.revision).toBe('number');
      expect(init2.data.revision).toBe(init1.data.revision);

      const initialRev = init1.data.revision;

      // 3. Zmiana zadania -> oba strumienie dostają zdarzenie w < 1 s
      const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Projekt SSE', key: 'SSE' }),
      });
      const proj = (await projRes.json()).project;

      const tStart = Date.now();
      const taskRes = await fetch(`${ctx.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          projectId: proj.id,
          title: 'Zadanie SSE na żywo',
        }),
      });
      expect(taskRes.status).toBe(201);
      const taskJson = await taskRes.json();
      const targetRev = taskJson.revision;
      expect(targetRev).toBeGreaterThan(initialRev);

      const [ev1, ev2] = await Promise.all([
        stream1.waitForEvent((e) => e.event === 'revision' && e.data?.revision === targetRev, 1000),
        stream2.waitForEvent((e) => e.event === 'revision' && e.data?.revision === targetRev, 1000),
      ]);
      expect(Date.now() - tStart).toBeLessThan(1000);
      expect(Object.keys(ev1.data)).toEqual(['revision']);
      expect(Object.keys(ev2.data)).toEqual(['revision']);

      // 4. Limit 5 jednoczesnych strumieni na użytkownika -> 6. dostaje 429
      const stream3 = await openSse(cookie);
      const stream4 = await openSse(cookie);
      const stream5 = await openSse(cookie);
      expect(stream3.statusCode).toBe(200);
      expect(stream4.statusCode).toBe(200);
      expect(stream5.statusCode).toBe(200);

      const sixthRes = await fetch(`${ctx.baseUrl}/api/events`, {
        headers: { Cookie: cookie },
      });
      expect(sixthRes.status).toBe(429);

      // 5. Po wylogowaniu otwarte strumienie są zamykane przez serwer
      const logoutRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(logoutRes.status).toBe(200);

      await Promise.all([
        Promise.race([
          stream1.ended,
          new Promise((_, rej) => setTimeout(() => rej(new Error('stream1 nie zamknął się po wylogowaniu')), 1500)),
        ]),
        Promise.race([
          stream2.ended,
          new Promise((_, rej) => setTimeout(() => rej(new Error('stream2 nie zamknął się po wylogowaniu')), 1500)),
        ]),
      ]);
    } finally {
      for (const s of openStreams) {
        s.close();
      }
    }
  });

  it('SSE /api/events nie odświeża lastSeenAt i zamyka strumień po wygaśnięciu bezczynnej sesji', async () => {
    ctx = await startTestServer({ sessionIdleMs: 250 }); // 250 ms idle timeout
    const { cookie } = await setupAdmin(ctx.baseUrl);

    const closedPromise = new Promise<number>((resolve, reject) => {
      const req = http.get(
        `${ctx!.baseUrl}/api/events`,
        { headers: { Cookie: cookie } },
        (res) => {
          expect(res.statusCode).toBe(200);
          res.resume();
          const t = Date.now();
          const timeout = setTimeout(() => {
            req.destroy();
            res.destroy();
            reject(new Error('Strumień SSE nie zamknął się po wygaśnięciu sesji'));
          }, 2000);
          res.on('end', () => {
            clearTimeout(timeout);
            resolve(Date.now() - t);
          });
        }
      );
      req.on('error', reject);
    });

    const elapsedMs = await closedPromise;
    expect(elapsedMs).toBeLessThan(1500);

    // Sesja wygasła mimo otwartego wcześniej strumienia SSE
    const meRes = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(401);
  });
});
