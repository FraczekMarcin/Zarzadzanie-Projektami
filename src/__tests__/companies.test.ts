import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import { normalizeStateStructure } from '../utils/stateStore.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
    const match = raw.match(/(?:__Host-zp_session|zp_session)=([^;]+)/);
    if (match) {
      return raw.split(';')[0];
    }
  }
  return '';
}

async function startTestServer(overrides: Partial<CreateAppOptions> = {}): Promise<TestServerContext> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-companies-test-'));
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

  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await instance.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, dataDir, close };
}

async function setupAdmin(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin Główny',
      email: 'admin@pracownia.pl',
      password: 'Księżyc-Wiosna-2026!',
    }),
  });
  const data = await res.json();
  const cookie = extractSessionCookie(res);
  return { res, data, cookie };
}

async function createAndLoginUser(
  baseUrl: string,
  adminCookie: string,
  params: { name: string; email: string; role: 'project_manager' | 'developer' | 'viewer'; password: string }
) {
  const createRes = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify(params),
  });
  expect(createRes.status).toBe(200);
  const created = await createRes.json();

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });
  expect(loginRes.status).toBe(200);
  const cookie = extractSessionCookie(loginRes);
  return { user: created.user, cookie };
}

describe('Integracyjne testy firm (companies) i numeracji RRRR-X_L', () => {
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

  it('wymusza RBAC na /api/companies oraz ukrywa nip i address dla developer/viewer', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const pm = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'PM Jeden',
      email: 'pm@pracownia.pl',
      role: 'project_manager',
      password: 'Projekt-Most-2026-Krakow!',
    });
    const dev = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Dev Jeden',
      email: 'dev@pracownia.pl',
      role: 'developer',
      password: 'Projekt-Tunel-2026-Gdansk!',
    });
    const viewer = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Viewer Jeden',
      email: 'viewer@pracownia.pl',
      role: 'viewer',
      password: 'Projekt-Dach-2026-Poznan!',
    });

    // Niezalogowany -> 401
    const unauthRes = await fetch(`${ctx.baseUrl}/api/companies`);
    expect(unauthRes.status).toBe(401);

    // Admin tworzy firmę z NIP i adresem
    const createRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Biuro Projektowe Alfa Sp. z o.o.',
        letter: 'A',
        nip: '525-100-20-30',
        address: 'ul. Architektów 12, Warszawa',
      }),
    });
    expect(createRes.status).toBe(201);
    const createdCompany = (await createRes.json()).company;

    // PM / Dev / Viewer nie mogą dodawać, edytować ani usuwać firm ani zmieniać ustawień
    for (const userCookie of [pm.cookie, dev.cookie, viewer.cookie]) {
      const postDeny = await fetch(`${ctx.baseUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ name: 'Nielegalna Firma', letter: 'Z' }),
      });
      expect(postDeny.status).toBe(403);

      const patchDeny = await fetch(`${ctx.baseUrl}/api/companies/${createdCompany.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ name: 'Podmiana' }),
      });
      expect(patchDeny.status).toBe(403);

      const delDeny = await fetch(`${ctx.baseUrl}/api/companies/${createdCompany.id}`, {
        method: 'DELETE',
        headers: { Cookie: userCookie },
      });
      expect(delDeny.status).toBe(403);

      const settingsDeny = await fetch(`${ctx.baseUrl}/api/companies/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ scope: 'company' }),
      });
      expect(settingsDeny.status).toBe(403);
    }

    // PM widzi nip i address w /api/companies oraz /api/state
    const pmGet = await fetch(`${ctx.baseUrl}/api/companies`, { headers: { Cookie: pm.cookie } });
    expect(pmGet.status).toBe(200);
    const pmData = await pmGet.json();
    expect(pmData.companies[0].nip).toBe('525-100-20-30');
    expect(pmData.companies[0].address).toBe('ul. Architektów 12, Warszawa');

    // Dev i Viewer widzą nazwę i literę, ale BEZ nip i address
    for (const restrictedCookie of [dev.cookie, viewer.cookie]) {
      const getComp = await fetch(`${ctx.baseUrl}/api/companies`, { headers: { Cookie: restrictedCookie } });
      expect(getComp.status).toBe(200);
      const compData = await getComp.json();
      expect(compData.companies[0]).toEqual({
        id: createdCompany.id,
        name: 'Biuro Projektowe Alfa Sp. z o.o.',
        letter: 'A',
        color: expect.stringMatching(/^#[0-9A-F]{6}$/),
        isActive: true,
      });

      const getState = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: restrictedCookie } });
      expect(getState.status).toBe(200);
      const stateData = await getState.json();
      expect(stateData.state.companies[0].nip).toBeUndefined();
      expect(stateData.state.companies[0].address).toBeUndefined();
    }
  });

  it('pilnuje unikalności litery (409), limitu 26 firm (400), blokady zmiany litery i usunięcia z projektami (409) oraz loguje zdarzenia bezpieczeństwa', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // Firma A
    const compARes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa', letter: 'A' }),
    });
    expect(compARes.status).toBe(201);
    const compA = (await compARes.json()).company;

    // Duplikat litery A -> 409
    const dupLetter = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa Bis', letter: 'a' }),
    });
    expect(dupLetter.status).toBe(409);

    // Dodaj pozostałe 25 liter B..Z (łącznie 26)
    for (let i = 1; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      const r = await fetch(`${ctx.baseUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: `Firma ${letter}`, letter }),
      });
      expect(r.status).toBe(201);
    }

    // 27. firma przekracza limit -> 400
    const overLimit = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Nadmiarowa', letter: 'A' }),
    });
    expect(overLimit.status).toBe(400);

    // Usuń firmę Z (nie ma projektów) -> 200 i zapis company_deleted
    const listRes = await fetch(`${ctx.baseUrl}/api/companies`, { headers: { Cookie: adminCookie } });
    const allCompanies = (await listRes.json()).companies;
    const compZ = allCompanies.find((c: any) => c.letter === 'Z');

    // Utwórz projekt dla firmy A
    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Budynek Alfa', companyId: compA.id }),
    });
    expect(projRes.status).toBe(201);

    // Próba zmiany litery firmy A mającej projekt -> 409
    const letterChangeConflict = await fetch(`${ctx.baseUrl}/api/companies/${compA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ letter: 'X' }),
    });
    expect(letterChangeConflict.status).toBe(409);

    // Próba usunięcia firmy A mającej projekt -> 409
    const deleteConflict = await fetch(`${ctx.baseUrl}/api/companies/${compA.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(deleteConflict.status).toBe(409);

    // Dezaktywacja firmy A działa -> 200
    const deactivateRes = await fetch(`${ctx.baseUrl}/api/companies/${compA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ isActive: false }),
    });
    expect(deactivateRes.status).toBe(200);
    expect((await deactivateRes.json()).company.isActive).toBe(false);

    // Usunięcie firmy Z bez projektów -> 200
    const delZRes = await fetch(`${ctx.baseUrl}/api/companies/${compZ.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delZRes.status).toBe(200);

    // Sprawdź dziennik bezpieczeństwa
    const secRes = await fetch(`${ctx.baseUrl}/api/security/events`, {
      headers: { Cookie: adminCookie },
    });
    expect(secRes.status).toBe(200);
    const events = (await secRes.json()).events || [];
    const types = events.map((e: any) => e.type);
    expect(types).toContain('company_created');
    expect(types).toContain('company_updated');
    expect(types).toContain('company_deleted');
  });

  it('20 równoległych żądań POST /api/projects generuje 20 unikalnych numerów RRRR-X_L bez wyścigu', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const year = new Date().getFullYear();

    const compARes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa', letter: 'A' }),
    });
    const compA = (await compARes.json()).company;

    const compBRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Beta', letter: 'B' }),
    });
    const compB = (await compBRes.json()).company;

    // Gdy istnieje aktywna firma, brak companyId -> 400
    const missingCompRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Bez firmy' }),
    });
    expect(missingCompRes.status).toBe(400);

    // Wyślij 20 równoległych żądań naprzemiennie dla firmy A i B
    const serverBaseUrl = ctx.baseUrl;
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        fetch(`${serverBaseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            name: `Równoległy Projekt ${i + 1}`,
            companyId: i % 2 === 0 ? compA.id : compB.id,
          }),
        })
      )
    );

    const payloads = await Promise.all(responses.map((r) => r.json()));
    for (const r of responses) {
      expect(r.status).toBe(201);
    }

    const keys = payloads.map((p) => p.project.key);
    expect(new Set(keys).size).toBe(20);

    // Numery sekwencyjne 1..20 (bez zer wiodących) w ramach wspólnego licznika rocznego
    const nums = keys
      .map((k: string) => {
        const m = k.match(new RegExp(`^${year}-(\\d{1,3})_[AB]$`));
        return m ? Number(m[1]) : -1;
      })
      .sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    // Duplikat własnego key zwraca 409
    const dupCustomRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Duplikat klucza',
        companyId: compA.id,
        key: keys[0],
      }),
    });
    expect(dupCustomRes.status).toBe(409);
  });

  it('zmiana firmy projektu przez admina/właściciela nie zmienia wydanego numeru, a inni użytkownicy dostają 403', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const pmOwner = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Właściciel PM',
      email: 'owner@pracownia.pl',
      role: 'project_manager',
      password: 'Projekt-Most-2026-Krakow!',
    });
    const pmOther = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Obcy PM',
      email: 'otherpm@pracownia.pl',
      role: 'project_manager',
      password: 'Projekt-Rzeka-2026-Wroclaw!',
    });

    const compA = (
      await (
        await fetch(`${ctx.baseUrl}/api/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'Alfa', letter: 'A' }),
        })
      ).json()
    ).company;

    const compB = (
      await (
        await fetch(`${ctx.baseUrl}/api/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'Beta', letter: 'B' }),
        })
      ).json()
    ).company;

    const createRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt z właścicielem',
        companyId: compA.id,
        ownerId: pmOwner.user.id,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).project;
    const issuedKey = created.key;
    expect(issuedKey).toMatch(/^\d{4}-1_A$/);

    // Obcy PM (nie właściciel i nie admin) -> 403 przy zmianie firmy
    const forbiddenRes = await fetch(`${ctx.baseUrl}/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pmOther.cookie,
        'If-Match': String(created.revision),
      },
      body: JSON.stringify({ companyId: compB.id }),
    });
    expect(forbiddenRes.status).toBe(403);

    // Właściciel może zmienić firmę, a wydany numer projektu pozostaje niezmieniony
    const ownerPatchRes = await fetch(`${ctx.baseUrl}/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pmOwner.cookie,
        'If-Match': String(created.revision),
      },
      body: JSON.stringify({ companyId: compB.id }),
    });
    expect(ownerPatchRes.status).toBe(200);
    const updated = (await ownerPatchRes.json()).project;
    expect(updated.companyId).toBe(compB.id);
    expect(updated.key).toBe(issuedKey);
  });

  it('zachowuje pole companies przy imporcie stanu (POST /api/state) i blokuje przywrócenie z kosza kolizyjnego numeru RRRR-X_L (409)', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const year = new Date().getFullYear();

    const compA = (
      await (
        await fetch(`${ctx.baseUrl}/api/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'Alfa', letter: 'A' }),
        })
      ).json()
    ).company;

    // Pobierz aktualną rewizję i stan
    const stateRes1 = await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } });
    const rev1 = (await stateRes1.json()).state.revision;

    // Import bez pola companies zachowuje istniejące firmy
    const importWithoutCompanies = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': String(rev1),
      },
      body: JSON.stringify({ projects: [], tasks: [] }),
    });
    expect(importWithoutCompanies.status).toBe(200);

    const afterImport1 = await (await fetch(`${ctx.baseUrl}/api/companies`, { headers: { Cookie: adminCookie } })).json();
    expect(afterImport1.companies).toHaveLength(1);
    expect(afterImport1.companies[0].id).toBe(compA.id);

    // Import z własnym polem companies zapisuje zsanitizowane firmy
    const rev2 = (await (await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })).json()).state.revision;
    const importWithCompanies = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': String(rev2),
      },
      body: JSON.stringify({
        companies: [
          { id: compA.id, name: 'Alfa Po Imporcie', letter: 'A', isActive: true },
          { id: 'comp-c', name: 'Gamma', letter: 'C', isActive: true },
        ],
        projects: [],
        tasks: [],
      }),
    });
    expect(importWithCompanies.status).toBe(200);

    const afterImport2 = await (await fetch(`${ctx.baseUrl}/api/companies`, { headers: { Cookie: adminCookie } })).json();
    expect(afterImport2.companies).toHaveLength(2);
    expect(afterImport2.companies[0].name).toBe('Alfa Po Imporcie');

    // Kolizja przy przywracaniu z kosza
    const p1Res = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Do kosza', companyId: compA.id }),
    });
    expect(p1Res.status).toBe(201);
    const p1 = (await p1Res.json()).project;
    expect(p1.key).toBe(`${year}-1_A`);

    const delRes = await fetch(`${ctx.baseUrl}/api/projects/${p1.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);
    const trashId = (await delRes.json()).trashId;

    // Kolejny automatycznie nadany numer nie koliduje z koszem -> będzie -2_A
    const p2Res = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Drugi automatyczny', companyId: compA.id }),
    });
    expect(p2Res.status).toBe(201);
    expect((await p2Res.json()).project.key).toBe(`${year}-2_A`);

    // Admin ręcznie zajmuje numer 1_A
    const p3Res = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Zajmujący numer z kosza', companyId: compA.id, key: p1.key }),
    });
    expect(p3Res.status).toBe(201);

    // Próba przywrócenia projektu z kosza o zajętym kluczu -> 409
    const restoreRes = await fetch(`${ctx.baseUrl}/api/trash/${trashId}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(restoreRes.status).toBe(409);
  });

  it('obsługuje status VAT firmy (vatPayer, vatExemptionBasis), migrację stanu, dziennik zmian i RBAC bez nadpisywania kwot projektów', async () => {
    // 1. Migracja istniejących firm bez pola vatPayer -> domyślnie true + normalizacja podstawy
    const migrated = normalizeStateStructure({
      revision: 1,
      companies: [
        { id: 'legacy-1', name: 'Stara Firma', letter: 'S', isActive: true, vatExemptionBasis: '   ' },
      ],
      projects: [],
      tasks: [],
      users: [],
      comments: [],
      activityLogs: [],
    });
    expect(migrated.companies?.[0]?.vatPayer).toBe(true);
    expect(migrated.companies?.[0]?.vatExemptionBasis).toBeUndefined();

    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const devOwner = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Właściciel Dev',
      email: 'dev.vat.owner@pracownia.pl',
      role: 'developer',
      password: 'Projekt-Strop-2026-Lublin!',
    });
    const devOther = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Obcy Dev',
      email: 'dev.vat.other@pracownia.pl',
      role: 'developer',
      password: 'Projekt-Okno-2026-Torun!',
    });

    // 2. Walidacja błędnego vatPayer i podstawy > 200 znaków
    const badBoolRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Błędna', letter: 'X', vatPayer: 'nie' }),
    });
    expect(badBoolRes.status).toBe(400);

    const badBasisRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Za długa podstawa',
        letter: 'Y',
        vatPayer: false,
        vatExemptionBasis: 'a'.repeat(201),
      }),
    });
    expect(badBasisRes.status).toBe(400);

    // 3. Utworzenie firmy zwolnionej z VAT i projektu z historyczną stawką 23%
    const createZwRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Pracownia Zwolniona',
        letter: 'Z',
        nip: '123-456-78-90',
        address: 'ul. Mała 1',
        vatPayer: false,
        vatExemptionBasis: 'art. 113 ust. 1 ustawy o VAT',
      }),
    });
    expect(createZwRes.status).toBe(201);
    const compZ = (await createZwRes.json()).company;
    expect(compZ.vatPayer).toBe(false);
    expect(compZ.vatExemptionBasis).toBe('art. 113 ust. 1 ustawy o VAT');

    const projRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Zwolnionej Firmy',
        companyId: compZ.id,
        ownerId: devOwner.user.id,
        projectValue: 10000,
        projectValueGross: 10000,
        projectVatRate: 0,
        costs: [
          {
            id: 'cost-z1',
            title: 'Faktura z VAT 23%',
            category: 'inne',
            amountNet: 1000,
            amountGross: 1230,
            vatRate: 23,
            status: 'planned',
          },
        ],
      }),
    });
    expect(projRes.status).toBe(201);
    const projBeforeToggle = (await projRes.json()).project;

    // 4. RBAC: właściciel projektu (developer) widzi vatPayer i vatExemptionBasis, ale bez nip/address; obcy developer nie widzi vatPayer
    const ownerCompaniesRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      headers: { Cookie: devOwner.cookie },
    });
    const ownerComp = (await ownerCompaniesRes.json()).companies.find((c: any) => c.id === compZ.id);
    expect(ownerComp.vatPayer).toBe(false);
    expect(ownerComp.vatExemptionBasis).toBe('art. 113 ust. 1 ustawy o VAT');
    expect(ownerComp.nip).toBeUndefined();
    expect(ownerComp.address).toBeUndefined();

    const otherCompaniesRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      headers: { Cookie: devOther.cookie },
    });
    const otherComp = (await otherCompaniesRes.json()).companies.find((c: any) => c.id === compZ.id);
    expect(otherComp).toEqual({
      id: compZ.id,
      name: 'Pracownia Zwolniona',
      letter: 'Z',
      color: expect.stringMatching(/^#[0-9A-F]{6}$/),
      isActive: true,
    });

    // 5. Zmiana statusu VAT firmy (false -> true) zapisuje audit log i NIE nadpisuje kwot w projekcie
    const toggleRes = await fetch(`${ctx.baseUrl}/api/companies/${compZ.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ vatPayer: true }),
    });
    expect(toggleRes.status).toBe(200);
    const toggledComp = (await toggleRes.json()).company;
    expect(toggledComp.vatPayer).toBe(true);

    const stateAfterToggle = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })
    ).json();
    const projAfterToggle = stateAfterToggle.state.projects.find((p: any) => p.id === projBeforeToggle.id);
    expect(projAfterToggle.projectValue).toBe(10000);
    expect(projAfterToggle.projectValueGross).toBe(10000);
    expect(projAfterToggle.projectVatRate).toBe(0);
    expect(projAfterToggle.costs[0].amountNet).toBe(1000);
    expect(projAfterToggle.costs[0].amountGross).toBe(1230);

    const secEvents = await (
      await fetch(`${ctx.baseUrl}/api/security/events`, { headers: { Cookie: adminCookie } })
    ).json();
    const vatChangeEvent = (secEvents.events || []).find(
      (ev: any) => ev.type === 'company_updated' && ev.details?.vatPayerChanged === true
    );
    expect(vatChangeEvent).toBeDefined();
    expect(vatChangeEvent.details.previousVatPayer).toBe(false);
    expect(vatChangeEvent.details.vatPayer).toBe(true);
  });

  it('P78: przypisuje domyślny kolor z palety, waliduje format #RRGGBB na serwerze i zapisuje kolor w POST/PATCH', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // 1. Tworzenie bez podania koloru -> domyślny z palety dla litery A (#1D4ED8)
    const defaultRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Domyślny Kolor Sp. z o.o.', letter: 'A' }),
    });
    expect(defaultRes.status).toBe(201);
    const compDefault = (await defaultRes.json()).company;
    expect(compDefault.color).toBe('#1D4ED8');

    // 2. Tworzenie z niepoprawnym formatem hex -> 400
    for (const invalidColor of ['red', '#123', '1D4ED8', '#GGGGGG', '#1234567']) {
      const badCreate = await fetch(`${ctx.baseUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Błędna Firma', letter: 'B', color: invalidColor }),
      });
      expect(badCreate.status).toBe(400);
    }

    // 3. Tworzenie z niestandardowym hexem (małe litery normalizowane do wielkich)
    const customRes = await fetch(`${ctx.baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Własny Kolor Sp. z o.o.', letter: 'B', color: '#0f766e' }),
    });
    expect(customRes.status).toBe(201);
    const compCustom = (await customRes.json()).company;
    expect(compCustom.color).toBe('#0F766E');

    // 4. PATCH niepoprawny hex -> 400
    const badPatch = await fetch(`${ctx.baseUrl}/api/companies/${compCustom.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ color: 'niebieski' }),
    });
    expect(badPatch.status).toBe(400);

    // 5. PATCH poprawny hex -> 200 i utrwalenie w /api/state
    const goodPatch = await fetch(`${ctx.baseUrl}/api/companies/${compCustom.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ color: '#be123c' }),
    });
    expect(goodPatch.status).toBe(200);
    expect((await goodPatch.json()).company.color).toBe('#BE123C');

    const stateRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Cookie: adminCookie },
    });
    const stateJson = await stateRes.json();
    const saved = stateJson.state.companies.find((c: any) => c.id === compCustom.id);
    expect(saved.color).toBe('#BE123C');
  });
});
