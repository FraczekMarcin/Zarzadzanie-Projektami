import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
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
});
