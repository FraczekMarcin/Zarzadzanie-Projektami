import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import type { Project, ProjectTemplate, ProjectTypeOption, User } from '../types/index.js';
import {
  DEFAULT_PROJECT_TYPES,
  DELIVERABLE_LIMITS,
  PROJECT_SUBTYPE_MAX_ITEMS,
  PROJECT_TYPE_LABEL_MAX,
  PROJECT_TYPE_MAX_ITEMS,
  SHORT_NAME_MAX,
  compareProjectDisplayNames,
  copyTemplateDeliverablesToProject,
  findProjectSubtypeUsage,
  findProjectTypeUsage,
  getDeliverablesSummary,
  getProjectDisplayName,
  hasDistinctShortName,
  mapLegacyTemplateCategory,
  matchesProjectSearch,
  normalizeProjectTypes,
} from '../utils/projectMeta.js';
import { sortProjectsList } from '../components/projects/projectsViewUtils.js';
import { DEFAULT_PROJECT_TEMPLATES } from '../data/defaultTemplates.js';
import {
  migrateLegacyTemplate,
  validateTemplateWritePayload,
} from '../utils/templateValidation.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_PASS = 'Księżyc-Wiosna-2026!X';
const USER_PASS = 'Jastrząb-Chmura-2026!Y';

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
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zp-p77-'));
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
    weeklySummaryDisableTimers: true,
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
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await instance.close();
      if (shouldCleanupDir) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

async function setupAdmin(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Administrator P77',
      email: 'admin.p77@pracownia.pl',
      password: ADMIN_PASS,
    }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return { cookie: extractSessionCookie(res), user: data.user as User };
}

async function createAndLoginUser(
  baseUrl: string,
  adminCookie: string,
  params: { name: string; email: string; role: 'project_manager' | 'developer' | 'viewer' }
) {
  const createRes = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      role: params.role,
      password: USER_PASS,
      department: 'Projektowanie',
    }),
  });
  expect(createRes.status).toBe(200);
  const created = await createRes.json();

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: params.email, password: USER_PASS }),
  });
  expect(loginRes.status).toBe(200);
  return { cookie: extractSessionCookie(loginRes), user: created.user as User };
}

describe('P77: Jednostkowe — rodzaje projektów, migracja szablonów, nazwa skrócona (PL), deliverables', () => {
  it('zawiera 9 domyślnych rodzajów projektu i zachowuje możliwość ich edycji/usunięcia gdy nieużywane', () => {
    expect(DEFAULT_PROJECT_TYPES.map((t) => t.label)).toEqual([
      'Projekt Budowlany',
      'Zgłoszenie',
      'ZRID',
      'Uzgodnienie',
      'Zjazd PD',
      'Zjazd DW',
      'Organizacja ruchu',
      'Kosztorys',
      'Inne',
    ]);
    // Lista przekazana przez administratora bez wybranych domyślnych rodzajów nie przywraca usuniętych
    const customOnly = normalizeProjectTypes([
      {
        id: 'wlasny',
        label: 'Własny rodzaj',
        color: 'indigo',
        order: 1,
        isActive: true,
        subtypes: [{ id: 'sub-1', label: 'Branża drogowa', order: 1, isActive: true }],
      },
    ]);
    expect(customOnly).toHaveLength(1);
    expect(customOnly[0].id).toBe('wlasny');
    expect(customOnly[0].subtypes[0].id).toBe('sub-1');
  });

  it('migruje stare kategorie szablonów na odpowiadające rodzaje projektu oraz nieznane na Inne', () => {
    expect(mapLegacyTemplateCategory('kubaturowe')).toBe('projekt_budowlany');
    expect(mapLegacyTemplateCategory('mieszkaniowe')).toBe('projekt_budowlany');
    expect(mapLegacyTemplateCategory('przemyslowe')).toBe('projekt_budowlany');
    expect(mapLegacyTemplateCategory('przebudowa')).toBe('projekt_budowlany');
    expect(mapLegacyTemplateCategory('infrastruktura')).toBe('zrid');
    expect(mapLegacyTemplateCategory('ogolne')).toBe('inne');
    expect(mapLegacyTemplateCategory('nieznana_kategoria')).toBe('inne');
    expect(mapLegacyTemplateCategory(undefined)).toBe('inne');

    const migrated = migrateLegacyTemplate({
      id: 'legacy-infra',
      name: 'Droga z kategorią legacy',
      category: 'infrastruktura',
      tasks: [{ title: 'ZRID', durationDays: 10, offsetDays: 0 }],
    });
    expect(migrated.typeId).toBe('zrid');
    expect((migrated as any).category).toBeUndefined();

    // Wbudowane szablony używają zdefiniowanych rodzajów z listy DEFAULT_PROJECT_TYPES
    const defaultTypeIds = new Set(DEFAULT_PROJECT_TYPES.map((t) => t.id));
    for (const tpl of DEFAULT_PROJECT_TEMPLATES) {
      expect(defaultTypeIds.has(tpl.typeId)).toBe(true);
    }
  });

  it('sortuje po nazwie skróconej (zapasowo pełnej) z polską kolacją i bez rozróżniania wielkości liter', () => {
    const base = {
      description: '',
      priority: 'normal',
      status: 'active',
      startDate: '2026-01-01',
      dueDate: '2026-06-01',
      durationDays: 150,
      progress: 0,
      memberIds: ['u1'],
      color: '#0284c7',
    };
    const projects: Project[] = [
      { ...base, id: 'p-z', key: '2026-1_A', name: 'Projekt Zwykły', shortName: 'zajezdnia' },
      { ...base, id: 'p-a', key: '2026-2_A', name: 'Projekt Alfabetyczny', shortName: 'ałun' },
      { ...base, id: 'p-l', key: '2026-3_A', name: 'Łódź Fabryczna Przebudowa' }, // brak shortName -> fallback name
      { ...base, id: 'p-c', key: '2026-4_A', name: 'Centrum', shortName: 'Ćma' },
      { ...base, id: 'p-o', key: '2026-5_A', name: 'Ostatni', shortName: 'Źródlana' },
    ];

    expect(getProjectDisplayName(projects[1])).toBe('ałun');
    expect(getProjectDisplayName(projects[2])).toBe('Łódź Fabryczna Przebudowa');
    expect(hasDistinctShortName(projects[1])).toBe(true);
    expect(hasDistinctShortName(projects[2])).toBe(false);

    // Wyszukiwarka przeszukuje zarówno nazwę skróconą, jak i pełną
    expect(matchesProjectSearch(projects[1], 'Alfabetyczny')).toBe(true);
    expect(matchesProjectSearch(projects[1], 'ałun')).toBe(true);
    expect(matchesProjectSearch(projects[1], 'nieistnieje')).toBe(false);

    // Polska kolacja bez rozróżniania wielkości liter: ałun < Ćma < Łódź... < zajezdnia < Źródlana
    const sortedAsc = [...projects].sort(compareProjectDisplayNames);
    expect(sortedAsc.map((p) => p.id)).toEqual(['p-a', 'p-c', 'p-l', 'p-z', 'p-o']);

    const sortedByUtilsDesc = sortProjectsList(projects, {
      sortKey: 'name',
      sortDir: 'desc',
      companies: [],
      users: [],
      tasks: [],
      currentUser: { id: 'u1', role: 'admin' },
      todayIso: '2026-05-01',
      projectTypes: DEFAULT_PROJECT_TYPES,
    });
    expect(sortedByUtilsDesc.map((p) => p.id)).toEqual(['p-o', 'p-z', 'p-l', 'p-c', 'p-a']);
  });

  it('wylicza podsumowanie elementów do odbioru i kopiuje je z szablonu ze statusem isDone=false', () => {
    const summary = getDeliverablesSummary([
      { id: 'd1', name: 'PZT', copies: 4, unit: 'egz.', isDone: true, doneAt: '2026-05-01T10:00:00Z', doneBy: 'Jan' },
      { id: 'd2', name: 'PB', copies: 4, unit: 'egz.', isDone: true, doneAt: '2026-05-01T10:00:00Z', doneBy: 'Jan' },
      { id: 'd3', name: 'PT', copies: 2, unit: 'egz.', isDone: true, doneAt: '2026-05-01T10:00:00Z', doneBy: 'Jan' },
      { id: 'd4', name: 'BIOZ', copies: 1, unit: 'egz.', isDone: false },
      { id: 'd5', name: 'Płyta CD', copies: 2, unit: 'szt.', isDone: false },
    ]);
    expect(summary).toEqual({
      done: 3,
      total: 5,
      percent: 60,
      label: 'Wykonano 3 z 5',
    });

    const copied = copyTemplateDeliverablesToProject([
      { id: 'td1', name: 'Projekt budowlany', copies: 4, unit: 'egz.', notes: 'Oprawa miękka' },
      { id: 'td2', name: 'Wersja PDF', copies: 1, unit: 'kpl.' },
    ]);
    expect(copied).toHaveLength(2);
    expect(copied[0].name).toBe('Projekt budowlany');
    expect(copied[0].copies).toBe(4);
    expect(copied[0].unit).toBe('egz.');
    expect(copied[0].notes).toBe('Oprawa miękka');
    expect(copied[0].isDone).toBe(false);
    expect(copied[0].doneAt).toBeUndefined();
    expect(copied[0].doneBy).toBeUndefined();
  });

  it('waliduje elementy do odbioru oraz typeId w szablonach', () => {
    const valid = validateTemplateWritePayload({
      name: 'Szablon z elementami',
      typeId: 'zrid',
      deliverables: [{ id: 'del-1', name: 'Operat wodnoprawny', copies: 3, unit: 'egz.' }],
      tasks: [],
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data.typeId).toBe('zrid');
      expect(valid.data.deliverables).toHaveLength(1);
    }

    const tooManyDeliverables = validateTemplateWritePayload({
      name: 'Za dużo elementów',
      typeId: 'inne',
      deliverables: Array.from({ length: DELIVERABLE_LIMITS.maxItems + 1 }, (_, i) => ({
        name: `Element ${i + 1}`,
        copies: 1,
        unit: 'egz.',
      })),
      tasks: [],
    });
    expect(tooManyDeliverables.ok).toBe(false);
  });

  it('wykrywa użycie rodzaju i podrodzaju w projektach, szablonach i pozycjach (findProjectTypeUsage / findProjectSubtypeUsage)', () => {
    const typeUsage = findProjectTypeUsage('audyt_brd', {
      projects: [
        {
          id: 'p1',
          key: 'PRJ-1',
          name: 'Projekt 1',
          typeId: 'inne',
          costs: [{ id: 'c1', typeId: 'audyt_brd', subtypeId: 'sub_a' }],
          quotations: [{ id: 'q1', typeId: 'inne' }],
        },
      ],
      templates: [{ id: 't1', name: 'Szablon', typeId: 'audyt_brd' }],
      tenders: [{ id: 'td1', typeId: 'audyt_brd', subtypeId: 'sub_a' }],
    });
    expect(typeUsage.projects).toHaveLength(0);
    expect(typeUsage.templates).toHaveLength(1);
    expect(typeUsage.positionsCount).toBe(2);

    const subUsage = findProjectSubtypeUsage('audyt_brd', 'sub_a', {
      projects: [
        {
          id: 'p1',
          key: 'PRJ-1',
          name: 'Projekt 1',
          typeId: 'inne',
          paymentTranches: [{ id: 'tr1', typeId: 'audyt_brd', subtypeId: 'sub_a' }],
        },
      ],
      templates: [],
      tenders: [{ id: 'td1', typeId: 'audyt_brd', subtypeId: 'sub_a' }],
    });
    expect(subUsage.positionsCount).toBe(2);
  });
});

describe('P77: API serwera — walidacja rodzaju/podrodzaju, shortName, deliverables, szablony i blokada usuwania', () => {
  let ctx: TestServerContext | null = null;

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
      ctx = null;
    }
  });

  it('PUT /api/admin/variables egzekwuje limity rodzajów/podrodzajów i blokuje (409) usunięcie używanych w projektach, pozycjach i szablonach', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // 1. Walidacja limitów: maks. 30 rodzajów, maks. 30 podrodzajów, etykieta do 60 znaków
    const overTypesRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: Array.from({ length: PROJECT_TYPE_MAX_ITEMS + 1 }, (_, i) => ({
          id: `typ_${i}`,
          label: `Rodzaj ${i}`,
          color: 'sky',
          order: i + 1,
          isActive: true,
          subtypes: [],
        })),
      }),
    });
    expect(overTypesRes.status).toBe(400);

    const overSubtypesRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: [
          {
            id: 'typ_ok',
            label: 'Projekt Budowlany',
            color: 'sky',
            order: 1,
            isActive: true,
            subtypes: Array.from({ length: PROJECT_SUBTYPE_MAX_ITEMS + 1 }, (_, i) => ({
              id: `sub_${i}`,
              label: `Branża ${i}`,
              order: i + 1,
              isActive: true,
            })),
          },
        ],
      }),
    });
    expect(overSubtypesRes.status).toBe(400);

    const longLabelRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: [
          {
            id: 'typ_long',
            label: 'A'.repeat(PROJECT_TYPE_LABEL_MAX + 1),
            color: 'sky',
            order: 1,
            isActive: true,
            subtypes: [],
          },
        ],
      }),
    });
    expect(longLabelRes.status).toBe(400);

    // 2. Dodaj podrodzaje do Projektu Budowlanego oraz niestandardowy rodzaj 'audyt_brd'
    const withSubtypes: ProjectTypeOption[] = DEFAULT_PROJECT_TYPES.map((t) =>
      t.id === 'projekt_budowlany'
        ? {
            ...t,
            subtypes: [
              { id: 'architektura', label: 'Architektura', order: 1, isActive: true },
              { id: 'konstrukcja', label: 'Konstrukcja', order: 2, isActive: true },
            ],
          }
        : t
    );
    withSubtypes.push({
      id: 'audyt_brd',
      label: 'Audyt BRD',
      color: 'amber',
      order: 10,
      isActive: true,
      subtypes: [{ id: 'audyt_etap_1', label: 'Etap projektu', order: 1, isActive: true }],
    });

    const addTypesRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ projectTypes: withSubtypes }),
    });
    expect(addTypesRes.status).toBe(200);

    // 3. Utwórz projekt z rodzajem i podrodzajem
    const prjRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Rozbudowa Centrum Sportu',
        typeId: 'projekt_budowlany',
        subtypeId: 'architektura',
      }),
    });
    expect(prjRes.status).toBe(201);
    const prjId = (await prjRes.json()).project.id as string;

    // Próba usunięcia podrodzaju 'architektura' używanego przez projekt -> 409
    const delUsedSubRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: withSubtypes.map((t) =>
          t.id === 'projekt_budowlany'
            ? { ...t, subtypes: t.subtypes.filter((s) => s.id !== 'architektura') }
            : t
        ),
      }),
    });
    expect(delUsedSubRes.status).toBe(409);

    // Próba usunięcia rodzaju 'projekt_budowlany' używanego przez projekt -> 409
    const delUsedTypeRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: withSubtypes.filter((t) => t.id !== 'projekt_budowlany'),
      }),
    });
    expect(delUsedTypeRes.status).toBe(409);

    // 4. Utwórz szablon używający 'audyt_brd' -> próba usunięcia 'audyt_brd' zablokowana (409)
    const tplRes = await fetch(`${ctx.baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Szablon Audytu',
        typeId: 'audyt_brd',
        tasks: [],
      }),
    });
    expect(tplRes.status).toBe(201);
    const tplId = (await tplRes.json()).template.id as string;

    const delTemplateTypeRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: withSubtypes.filter((t) => t.id !== 'audyt_brd'),
      }),
    });
    expect(delTemplateTypeRes.status).toBe(409);

    // Po usunięciu szablonu używającego 'audyt_brd' można usunąć nieużywany rodzaj (200)
    expect((await fetch(`${ctx.baseUrl}/api/templates/${tplId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })).status).toBe(200);

    const delUnusedRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectTypes: withSubtypes.filter((t) => t.id !== 'audyt_brd'),
      }),
    });
    expect(delUnusedRes.status).toBe(200);

    // 5. Blokada usunięcia rodzaju i podrodzaju używanego w pozycji (koszt/wycena w app_state.json)
    await ctx.close();
    const seededDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-p77-pos-'));
    try {
      fs.writeFileSync(
        path.join(seededDir, 'app_state.json'),
        JSON.stringify({
          initialized: true,
          users: [],
          variables: {
            projectTypes: [
              ...DEFAULT_PROJECT_TYPES,
              {
                id: 'audyt_pos',
                label: 'Audyt pozycji',
                color: 'teal',
                order: 20,
                isActive: true,
                subtypes: [{ id: 'sub_pos', label: 'Podrodzaj pozycji', order: 1, isActive: true }],
              },
            ],
          },
          projects: [
            {
              id: 'proj-pos',
              key: 'POS-1',
              name: 'Projekt z pozycją',
              status: 'active',
              priority: 'normal',
              typeId: 'inne',
              costs: [
                {
                  id: 'cost-pos-1',
                  title: 'Pozycja ekonomiczna',
                  amountNet: 500,
                  amountGross: 615,
                  category: 'inne',
                  date: '2026-05-01',
                  status: 'planned',
                  typeId: 'audyt_pos',
                  subtypeId: 'sub_pos',
                },
              ],
            },
          ],
          tasks: [],
        })
      );
      ctx = await startServer({ dataDir: seededDir });
      const { cookie: seededCookie } = await setupAdmin(ctx.baseUrl);
      const delPosTypeRes = await fetch(`${ctx.baseUrl}/api/admin/variables`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: seededCookie },
        body: JSON.stringify({ projectTypes: DEFAULT_PROJECT_TYPES }),
      });
      expect(delPosTypeRes.status).toBe(409);
      const delPosBody = await delPosTypeRes.json();
      expect(delPosBody.positionsCount).toBe(1);
    } finally {
      await ctx?.close();
      ctx = null;
      fs.rmSync(seededDir, { recursive: true, force: true });
    }
  });

  it('POST /api/projects i PATCH /api/projects/:id walidują typeId, subtypeId, shortName i deliverables (data/osoba wykonania, dziennik, uprawnienia bez finansów)', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const dev = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Jan Projektant',
      email: 'jan.dev@pracownia.pl',
      role: 'developer',
    });
    const viewer = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Ewa Obserwator',
      email: 'ewa.viewer@pracownia.pl',
      role: 'viewer',
    });

    // Konfiguracja podrodzaju
    const customTypes: ProjectTypeOption[] = DEFAULT_PROJECT_TYPES.map((t) =>
      t.id === 'projekt_budowlany'
        ? {
            ...t,
            subtypes: [{ id: 'instalacje', label: 'Instalacje', order: 1, isActive: true }],
          }
        : t
    );
    await fetch(`${ctx.baseUrl}/api/admin/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ projectTypes: customTypes }),
    });

    // Nieistniejący rodzaj -> 400
    expect((await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Błędny rodzaj', typeId: 'nie_ma_takiego' }),
    })).status).toBe(400);

    // Podrodzaj bez rodzaju -> 400
    expect((await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Bez rodzaju', subtypeId: 'instalacje' }),
    })).status).toBe(400);

    // Podrodzaj nienależący do rodzaju -> 400
    expect((await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Zły podrodzaj', typeId: 'zrid', subtypeId: 'instalacje' }),
    })).status).toBe(400);

    // shortName > 60 znaków -> 400
    expect((await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Długa nazwa',
        shortName: 'X'.repeat(SHORT_NAME_MAX + 1),
      }),
    })).status).toBe(400);

    // deliverables przekroczone limity (copies=1000, >100 pozycji, nazwa >200) -> 400
    expect((await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Błąd egzemplarzy',
        deliverables: [{ name: 'PZT', copies: 1000, unit: 'egz.', isDone: false }],
      }),
    })).status).toBe(400);

    expect((await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Za dużo elementów',
        deliverables: Array.from({ length: DELIVERABLE_LIMITS.maxItems + 1 }, (_, i) => ({
          name: `Poz ${i + 1}`,
          copies: 1,
          unit: 'egz.',
          isDone: false,
        })),
      }),
    })).status).toBe(400);

    // Poprawne utworzenie projektu z memberem 'dev' (który NIE jest właścicielem finansów)
    const createRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Budowa obwodnicy północnej etap II w ciągu drogi krajowej',
        shortName: 'Obwodnica Północna II',
        typeId: 'projekt_budowlany',
        subtypeId: 'instalacje',
        memberIds: [dev.user.id],
        deliverables: [
          { id: 'del-a', name: 'Projekt zagospodarowania terenu', copies: 4, unit: 'egz.', isDone: false },
          { id: 'del-b', name: 'Projekt techniczny' }, // domyślne copies=1, unit='egz.'
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const createdProject = (await createRes.json()).project as Project;
    expect(createdProject.shortName).toBe('Obwodnica Północna II');
    expect(createdProject.typeId).toBe('projekt_budowlany');
    expect(createdProject.subtypeId).toBe('instalacje');
    expect(createdProject.deliverables).toHaveLength(2);
    expect(createdProject.deliverables![1].copies).toBe(1);
    expect(createdProject.deliverables![1].unit).toBe('egz.');

    // Viewer otrzymuje 403 przy próbie odznaczenia wykonania
    const viewerPatch = await fetch(`${ctx.baseUrl}/api/projects/${createdProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: viewer.cookie },
      body: JSON.stringify({
        deliverables: createdProject.deliverables!.map((d, i) => (i === 0 ? { ...d, isDone: true } : d)),
      }),
    });
    expect(viewerPatch.status).toBe(403);

    // Zwykły członek (developer bez prawa do finansów!) może odznaczyć wykonanie elementu do odbioru
    const devToggleDoneRes = await fetch(`${ctx.baseUrl}/api/projects/${createdProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: dev.cookie },
      body: JSON.stringify({
        deliverables: createdProject.deliverables!.map((d, i) =>
          i === 0 ? { ...d, isDone: true, doneBy: 'Podszyta osoba', doneAt: '1999-01-01T00:00:00Z' } : d
        ),
      }),
    });
    expect(devToggleDoneRes.status).toBe(200);
    const updatedAfterDone = (await devToggleDoneRes.json()).project as Project;
    expect(updatedAfterDone.deliverables![0].isDone).toBe(true);
    // Serwer samodzielnie nadaje doneBy i bieżącą datę doneAt
    expect(updatedAfterDone.deliverables![0].doneBy).toBe('Jan Projektant');
    expect(updatedAfterDone.deliverables![0].doneAt).not.toBe('1999-01-01T00:00:00Z');
    expect(Number.isFinite(Date.parse(updatedAfterDone.deliverables![0].doneAt!))).toBe(true);
    expect(updatedAfterDone.deliverables![1].isDone).toBe(false);

    // Dziennik aktywności zawiera wpis aktualizacji elementów do odbioru
    const stateData = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })
    ).json();
    const actLogs = (stateData.state.activityLogs || []) as Array<{ action: string }>;
    expect(
      actLogs.some((a) => a.action.includes('elementy do odbioru') && a.action.includes('Wykonano 1 z 2'))
    ).toBe(true);

    // Cofnięcie wykonania czyści doneAt i doneBy
    const undoRes = await fetch(`${ctx.baseUrl}/api/projects/${createdProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: dev.cookie },
      body: JSON.stringify({
        deliverables: updatedAfterDone.deliverables!.map((d) => ({ ...d, isDone: false })),
      }),
    });
    expect(undoRes.status).toBe(200);
    const afterUndo = (await undoRes.json()).project as Project;
    expect(afterUndo.deliverables![0].isDone).toBe(false);
    expect(afterUndo.deliverables![0].doneAt).toBeUndefined();
    expect(afterUndo.deliverables![0].doneBy).toBeUndefined();

    // Zmiana rodzaju projektu na inny bez tego podrodzaju automatycznie czyści subtypeId
    const changeTypeRes = await fetch(`${ctx.baseUrl}/api/projects/${createdProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ typeId: 'zrid' }),
    });
    expect(changeTypeRes.status).toBe(200);
    const afterChangeType = (await changeTypeRes.json()).project as Project;
    expect(afterChangeType.typeId).toBe('zrid');
    expect(afterChangeType.subtypeId).toBeUndefined();
  });

  it('szablon z rodzajem i elementami do odbioru przekazuje typeId i deliverables (isDone=false) do nowego projektu i przejmuje je z projektu źródłowego', async () => {
    ctx = await startServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // 1. Utwórz szablon z typeId='zrid' i 2 elementami do odbioru
    const tplCreateRes = await fetch(`${ctx.baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Szablon ZRID z odbiorami',
        typeId: 'zrid',
        defaultDurationDays: 30,
        deliverables: [
          { name: 'Wniosek o wydanie ZRID', copies: 2, unit: 'egz.', notes: 'Z załącznikami' },
          { name: 'Mapy podziałowe', copies: 5, unit: 'ark.' },
        ],
        tasks: [{ key: 't1', title: 'Inwentaryzacja', durationDays: 5, offsetDays: 0 }],
      }),
    });
    expect(tplCreateRes.status).toBe(201);
    const tpl = (await tplCreateRes.json()).template as ProjectTemplate;
    expect(tpl.typeId).toBe('zrid');
    expect(tpl.deliverables).toHaveLength(2);

    // 2. Utwórz projekt z tego szablonu -> dziedziczy typeId i deliverables (isDone=false)
    const projFromTplRes = await fetch(`${ctx.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Obwodnica Południowa',
        shortName: 'Obw. Południowa',
        templateId: tpl.id,
        startDate: '2026-06-01',
      }),
    });
    expect(projFromTplRes.status).toBe(201);
    const projFromTpl = (await projFromTplRes.json()).project as Project;
    expect(projFromTpl.typeId).toBe('zrid');
    expect(projFromTpl.deliverables).toHaveLength(2);
    expect(projFromTpl.deliverables![0].name).toBe('Wniosek o wydanie ZRID');
    expect(projFromTpl.deliverables![0].copies).toBe(2);
    expect(projFromTpl.deliverables![0].unit).toBe('egz.');
    expect(projFromTpl.deliverables![0].isDone).toBe(false);
    expect(projFromTpl.deliverables![1].copies).toBe(5);
    expect(projFromTpl.deliverables![1].unit).toBe('ark.');

    // Oznacz jeden element jako wykonany i utwórz szablon z tego projektu -> przejmuje typeId i deliverables (bez statusu done)
    await fetch(`${ctx.baseUrl}/api/projects/${projFromTpl.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        deliverables: projFromTpl.deliverables!.map((d, idx) =>
          idx === 0 ? { ...d, isDone: true } : d
        ),
      }),
    });

    const fromProjRes = await fetch(`${ctx.baseUrl}/api/templates/from-project/${projFromTpl.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Szablon sklonowany z projektu',
      }),
    });
    expect(fromProjRes.status).toBe(201);
    const clonedTpl = (await fromProjRes.json()).template as ProjectTemplate;
    expect(clonedTpl.typeId).toBe('zrid');
    expect(clonedTpl.deliverables).toHaveLength(2);
    expect(clonedTpl.deliverables![0].name).toBe('Wniosek o wydanie ZRID');
    expect((clonedTpl.deliverables![0] as any).isDone).toBeUndefined();
  });
});
