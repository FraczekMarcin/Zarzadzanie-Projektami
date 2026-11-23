import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp, CreateAppOptions } from '../../server.js';
import type { Company, Tender } from '../types/index.js';
import { normalizeStateStructure } from '../utils/stateStore.js';
import {
  buildProjectFromTender,
  computeTenderSummary,
  filterTenders,
  normalizeTenderSearchText,
  sortTenders,
  TENDER_SORT_KEYS,
  toTenderDetail,
  toTenderListItem,
  validateTenderWritePayload,
} from '../utils/tenders.js';

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-tenders-test-'));
  const instance = await createApp({
    dataDir,
    appSecret: TEST_APP_SECRET,
    port: 0,
    isProduction: true,
    allowSelfRegistration: true,
    setupToken: '',
    remindersDisableTimers: true,
    weeklySummaryDisableTimers: true,
    backupWatchDisableTimers: true,
    diskWatchDisableTimers: true,
    trashCleanupDisableTimers: true,
    googleSyncDisableTimers: true,
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
      name: 'Admin Przetargi',
      email: 'admin@pracownia.pl',
      password: 'Księżyc-Wiosna-2026!',
    }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  const cookie = extractSessionCookie(res);
  return { user: data.user, cookie };
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

function makeSampleTender(overrides: Partial<Tender> = {}): Tender {
  return {
    id: overrides.id ?? 't-1',
    name: overrides.name ?? 'Przebudowa DK12',
    contractingAuthority: overrides.contractingAuthority ?? 'GDDKiA Oddział Łódź',
    resolutionDate: overrides.resolutionDate ?? '2026-10-15',
    status: overrides.status ?? 'resolved',
    priceBasis: overrides.priceBasis ?? 'gross',
    bidders: overrides.bidders ?? [],
    createdAt: '2026-10-01T10:00:00.000Z',
    createdBy: 'u-1',
    updatedAt: '2026-10-15T10:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

describe('Moduł Przetargi — logika czysta (src/utils/tenders.ts)', () => {
  const companies: Company[] = [
    { id: 'c-vat', name: 'Pracownia VAT Sp. z o.o.', letter: 'A', isActive: true, vatPayer: true },
    { id: 'c-zw', name: 'Biuro Zwolnione', letter: 'B', isActive: true, vatPayer: false },
  ];

  it('normalizuje polskie znaki diakrytyczne w wyszukiwaniu', () => {
    expect(normalizeTenderSearchText('GDDKiA Oddział Łódź — Żółć i Świerk')).toBe(
      'gddkia oddzial lodz — zolc i swierk'
    );
  });

  it('waliduje błędne kwoty, brak resolutionDate, niepoprawny URL oraz limity ilości i długości', () => {
    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          authorityBudget: 123.456,
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          authorityBudget: -10,
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          authorityBudget: 1_000_000_000,
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-02-30',
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          url: 'javascript:alert(1)',
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          scopeQuantity: 0,
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          scopeQuantity: 1.2345,
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);
  });

  it('odrzuca zdyskwalifikowanego zwycięzcę, winnerBidderId poza status=resolved, dwóch naszych oferentów, companyId bez isOurs i nieznane klucze', () => {
    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          status: 'announced',
          bidders: [{ id: 'b1', name: 'Nasza', isOurs: true, price: 1000 }],
          winnerBidderId: 'b1',
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          status: 'resolved',
          bidders: [{ id: 'b1', name: 'Firma X', isOurs: false, price: 1000, isDisqualified: true }],
          winnerBidderId: 'b1',
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          bidders: [
            { id: 'b1', name: 'Nasza 1', isOurs: true, price: 1000 },
            { id: 'b2', name: 'Nasza 2', isOurs: true, price: 1200 },
          ],
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          bidders: [{ id: 'b1', name: 'Obca', isOurs: false, companyId: 'c-vat', price: 1000 }],
        },
        { mode: 'create', callerId: 'u-1', companies }
      ).ok
    ).toBe(false);

    expect(
      validateTenderWritePayload(
        {
          name: 'Test',
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-10-01',
          unknownProp: 123,
        },
        { mode: 'create', callerId: 'u-1' }
      ).ok
    ).toBe(false);

    const protoObj = JSON.parse(
      '{"name":"Test","contractingAuthority":"Zamawiający","resolutionDate":"2026-10-01","__proto__":{"polluted":true}}'
    );
    expect(validateTenderWritePayload(protoObj, { mode: 'create', callerId: 'u-1' }).ok).toBe(false);
  });

  it('oblicza ranking oferentów, ceny jednostkowe, % budżetu i różnice', () => {
    const tender = makeSampleTender({
      authorityBudget: 200_000,
      scopeQuantity: 10,
      scopeUnit: 'km',
      winnerBidderId: 'b-win',
      bidders: [
        { id: 'b-dq', name: 'Odrzucona', isOurs: false, price: 90_000, isDisqualified: true },
        { id: 'b-win', name: 'Konkurent A', isOurs: false, price: 120_000 },
        { id: 'b-our', name: 'Nasza Firma', isOurs: true, companyId: 'c-vat', price: 150_000 },
      ],
    });

    const detail = toTenderDetail(tender);
    expect(detail.biddersCount).toBe(3);
    expect(detail.lowestPrice).toBe(120_000);
    expect(detail.winnerPrice).toBe(120_000);
    expect(detail.ourPrice).toBe(150_000);
    expect(detail.ourRank).toBe(2);
    expect(detail.authorityBudgetPerUnit).toBe(20_000);
    expect(detail.winnerPricePerUnit).toBe(12_000);
    expect(detail.ourPricePerUnit).toBe(15_000);
    expect(detail.winnerToBudgetPct).toBe(60);
    expect(detail.ourToBudgetPct).toBe(75);
    expect(detail.differenceOurVsWinner).toBe(30_000);
    expect(detail.wonByUs).toBe(false);

    const dqBidder = detail.bidders.find((b) => b.id === 'b-dq')!;
    expect(dqBidder.rank).toBeNull();
    expect(dqBidder.pricePerUnit).toBe(9_000);
    expect(dqBidder.pctOfBudget).toBe(45);
  });

  it('wylicza medianę i statystyki jednostkowe dla wspólnej jednostki oraz dla wielu jednostek', () => {
    const itemsSameUnit = [
      toTenderListItem(
        makeSampleTender({
          id: '1',
          scopeQuantity: 10,
          scopeUnit: 'km',
          winnerBidderId: 'w1',
          bidders: [{ id: 'w1', name: 'Nasza', isOurs: true, price: 10_000 }], // 1000/km
        })
      ),
      toTenderListItem(
        makeSampleTender({
          id: '2',
          scopeQuantity: 10,
          scopeUnit: 'km',
          winnerBidderId: 'w2',
          bidders: [{ id: 'w2', name: 'Obca', isOurs: false, price: 20_000 }], // 2000/km
        })
      ),
      toTenderListItem(
        makeSampleTender({
          id: '3',
          scopeQuantity: 10,
          scopeUnit: 'KM',
          winnerBidderId: 'w3',
          bidders: [{ id: 'w3', name: 'Obca', isOurs: false, price: 30_000 }], // 3000/km
        })
      ),
      toTenderListItem(
        makeSampleTender({
          id: '4',
          scopeQuantity: 10,
          scopeUnit: 'km',
          winnerBidderId: 'w4',
          bidders: [{ id: 'w4', name: 'Nasza', isOurs: true, price: 50_000 }], // 5000/km
        })
      ),
    ];

    const sameSummary = computeTenderSummary(itemsSameUnit);
    expect(sameSummary.totalCount).toBe(4);
    expect(sameSummary.withScopeCount).toBe(4);
    expect(sameSummary.wonCount).toBe(2);
    expect(sameSummary.wonPercent).toBe(50);
    expect(sameSummary.commonScopeUnit).toBe('km');
    expect(sameSummary.winnerPricePerUnit).toEqual({
      unit: 'km',
      count: 4,
      min: 1000,
      median: 2500, // (2000 + 3000) / 2
      max: 5000,
    });

    const mixedItems = [
      ...itemsSameUnit.slice(0, 3),
      toTenderListItem(
        makeSampleTender({
          id: '5',
          scopeQuantity: 100,
          scopeUnit: 'm2',
          winnerBidderId: 'w5',
          bidders: [{ id: 'w5', name: 'Obca', isOurs: false, price: 40_000 }], // 400/m2
        })
      ),
    ];
    const mixedSummary = computeTenderSummary(mixedItems);
    expect(mixedSummary.commonScopeUnit).toBeNull();
    expect(mixedSummary.winnerPricePerUnit).toBeNull();
    expect(mixedSummary.winnerPricePerUnitByUnit.km).toEqual({
      unit: 'km',
      count: 3,
      min: 1000,
      median: 2000,
      max: 3000,
    });
    expect(mixedSummary.winnerPricePerUnitByUnit.m2).toEqual({
      unit: 'm2',
      count: 1,
      min: 400,
      median: 400,
      max: 400,
    });
  });

  it('sortuje po każdym z 10 kluczy i umieszcza braki (null) na końcu', () => {
    const tA = toTenderListItem(
      makeSampleTender({
        id: 'a',
        name: 'Alfa',
        contractingAuthority: 'Urząd B',
        resolutionDate: '2026-10-01',
        authorityBudget: 100_000,
        scopeQuantity: 10,
        scopeUnit: 'km',
        winnerBidderId: 'aw',
        bidders: [
          { id: 'aw', name: 'W1', isOurs: false, price: 80_000 },
          { id: 'ao', name: 'Nasza', isOurs: true, price: 90_000 },
        ],
      })
    );
    const tB = toTenderListItem(
      makeSampleTender({
        id: 'b',
        name: 'Beta',
        contractingAuthority: 'Urząd A',
        resolutionDate: '2026-10-10',
        authorityBudget: 200_000,
        scopeQuantity: 10,
        scopeUnit: 'km',
        winnerBidderId: 'bw',
        bidders: [{ id: 'bw', name: 'Nasza', isOurs: true, price: 150_000 }],
      })
    );
    const tNull = toTenderListItem(
      makeSampleTender({
        id: 'c',
        name: 'Gamma',
        contractingAuthority: 'Urząd C',
        resolutionDate: '2026-10-05',
        status: 'announced',
        bidders: [],
      })
    );

    const list = [tA, tB, tNull];
    for (const sortKey of TENDER_SORT_KEYS) {
      const asc = sortTenders(list, sortKey, 'asc');
      const desc = sortTenders(list, sortKey, 'desc');
      expect(asc).toHaveLength(3);
      expect(desc).toHaveLength(3);
      if (
        sortKey !== 'resolutionDate' &&
        sortKey !== 'name' &&
        sortKey !== 'contractingAuthority' &&
        sortKey !== 'biddersCount'
      ) {
        expect(asc[asc.length - 1].id).toBe('c');
        expect(desc[desc.length - 1].id).toBe('c');
      }
    }

    expect(sortTenders(list, 'winnerPrice', 'asc').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(sortTenders(list, 'winnerPrice', 'desc').map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('przelicza wartości projektu z przetargu z uwzględnieniem priceBasis oraz statusu VAT firmy', () => {
    const tenderGross = makeSampleTender({
      id: 'tg',
      name: 'Obwodnica',
      contractingAuthority: 'ZDW Kraków',
      description: 'Projekt drogi',
      url: 'https://ezamowienia.gov.pl/test',
      priceBasis: 'gross',
      status: 'resolved',
      winnerBidderId: 'our',
      bidders: [{ id: 'our', name: 'Nasza', isOurs: true, companyId: 'c-vat', price: 123_000 }],
    });

    const resVatGross = buildProjectFromTender({
      tender: tenderGross,
      callerId: 'u-1',
      projects: [],
      companies,
      todayIso: '2026-11-22',
    });
    expect(resVatGross.ok).toBe(true);
    if (resVatGross.ok) {
      expect(resVatGross.project.key).toBe('2026-1_A');
      expect(resVatGross.project.projectValueGross).toBe(123_000);
      expect(resVatGross.project.projectValue).toBe(100_000);
      expect(resVatGross.project.projectVatRate).toBe(23);
      expect(resVatGross.project.sourceTenderId).toBe('tg');
    }

    const tenderZw = makeSampleTender({
      id: 'tzw',
      priceBasis: 'gross',
      status: 'resolved',
      winnerBidderId: 'our',
      bidders: [{ id: 'our', name: 'Nasza ZW', isOurs: true, companyId: 'c-zw', price: 123_000 }],
    });
    const resZw = buildProjectFromTender({
      tender: tenderZw,
      callerId: 'u-1',
      projects: [],
      companies,
      todayIso: '2026-11-22',
    });
    expect(resZw.ok).toBe(true);
    if (resZw.ok) {
      expect(resZw.project.key).toBe('2026-1_B');
      expect(resZw.project.projectValue).toBe(123_000);
      expect(resZw.project.projectValueGross).toBe(123_000);
      expect(resZw.project.projectVatRate).toBe(0);
    }

    const tenderNet = makeSampleTender({
      id: 'tn',
      priceBasis: 'net',
      status: 'resolved',
      winnerBidderId: 'our',
      bidders: [{ id: 'our', name: 'Nasza', isOurs: true, companyId: 'c-vat', price: 100_000 }],
    });
    const resVatNet = buildProjectFromTender({
      tender: tenderNet,
      callerId: 'u-1',
      projects: [],
      companies,
      body: { vatRate: 8 },
      todayIso: '2026-11-22',
    });
    expect(resVatNet.ok).toBe(true);
    if (resVatNet.ok) {
      expect(resVatNet.project.projectValue).toBe(100_000);
      expect(resVatNet.project.projectValueGross).toBe(108_000);
      expect(resVatNet.project.projectVatRate).toBe(8);
    }
  });

  it('zachowuje wsteczną kompatybilność normalizeStateStructure dla starszego app_state.json bez tenders', () => {
    const legacy = normalizeStateStructure({ revision: 3, projects: [], tasks: [] });
    expect(Array.isArray(legacy.tenders)).toBe(true);
    expect(legacy.tenders).toEqual([]);
  });
});

describe('Integracyjne testy API /api/tenders', () => {
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

  it('egzekwuje RBAC (developer/viewer 403, PM/admin 200), delete author vs non-author oraz confirm: true', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const pm1 = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'PM Jeden',
      email: 'pm1@pracownia.pl',
      role: 'project_manager',
      password: 'Projekt-Most-2026-Krakow!',
    });
    const pm2 = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'PM Dwa',
      email: 'pm2@pracownia.pl',
      role: 'project_manager',
      password: 'Projekt-Tunel-2026-Gdansk!',
    });
    const dev = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Deweloper',
      email: 'dev@pracownia.pl',
      role: 'developer',
      password: 'Projekt-Dach-2026-Poznan!',
    });
    const viewer = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'Obserwator',
      email: 'viewer@pracownia.pl',
      role: 'viewer',
      password: 'Projekt-Rondo-2026-Opole!',
    });

    // PM1 tworzy przetarg
    const createRes = await fetch(`${ctx.baseUrl}/api/tenders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: pm1.cookie },
      body: JSON.stringify({
        name: 'Przetarg PM1',
        contractingAuthority: 'Gmina Testowa',
        resolutionDate: '2026-11-10',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const tenderId = created.tender.id;

    // Developer i Viewer otrzymują 403 na każdym endpoincie
    for (const badCookie of [dev.cookie, viewer.cookie]) {
      expect((await fetch(`${ctx.baseUrl}/api/tenders`, { headers: { Cookie: badCookie } })).status).toBe(403);
      expect(
        (await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}`, { headers: { Cookie: badCookie } })).status
      ).toBe(403);
      expect(
        (
          await fetch(`${ctx.baseUrl}/api/tenders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: badCookie },
            body: JSON.stringify({
              name: 'Nieautoryzowany',
              contractingAuthority: 'X',
              resolutionDate: '2026-11-10',
            }),
          })
        ).status
      ).toBe(403);
      expect(
        (
          await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: badCookie },
            body: JSON.stringify({ name: 'Zmiana' }),
          })
        ).status
      ).toBe(403);
      expect(
        (
          await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Cookie: badCookie },
            body: JSON.stringify({ confirm: true }),
          })
        ).status
      ).toBe(403);
      expect(
        (
          await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}/create-project`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: badCookie },
            body: JSON.stringify({}),
          })
        ).status
      ).toBe(403);
    }

    // PM2 (nie-autor) nie może usunąć przetargu PM1 -> 403
    const pm2DelRes = await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: pm2.cookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(pm2DelRes.status).toBe(403);

    // PM1 bez confirm: true -> 400
    const pm1NoConfirm = await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: pm1.cookie },
      body: JSON.stringify({}),
    });
    expect(pm1NoConfirm.status).toBe(400);

    // PM1 z confirm: true -> 200
    const pm1DelOk = await fetch(`${ctx.baseUrl}/api/tenders/${tenderId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: pm1.cookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(pm1DelOk.status).toBe(200);

    // Admin może usunąć przetarg innego PM
    const create2 = await (
      await fetch(`${ctx.baseUrl}/api/tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: pm1.cookie },
        body: JSON.stringify({
          name: 'Przetarg do usunięcia przez admina',
          contractingAuthority: 'Gmina Testowa',
          resolutionDate: '2026-11-11',
        }),
      })
    ).json();
    const adminDel = await fetch(`${ctx.baseUrl}/api/tenders/${create2.tender.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(adminDel.status).toBe(200);
  });

  it('obsługuje konflikt rewizji If-Match (409), wyszukiwanie z polskimi znakami, sortowanie, paginację i podsumowanie', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    const payloads = [
      {
        name: 'Modernizacja drogi Łódź-Zgierz',
        contractingAuthority: 'GDDKiA Oddział Łódź',
        referenceNumber: 'ZDP-2026/01',
        resolutionDate: '2026-10-10',
        status: 'resolved',
        priceBasis: 'gross',
        authorityBudget: 100_000,
        scopeQuantity: 5,
        scopeUnit: 'km',
        bidders: [
          { id: 'b1', name: 'Nasza Spółka', isOurs: true, price: 80_000 },
          { id: 'b2', name: 'Konkurent Żółć', isOurs: false, price: 95_000 },
        ],
        winnerBidderId: 'b1',
      },
      {
        name: 'Projekt szkoły w Gdańsku',
        contractingAuthority: 'Urząd Miasta Gdańsk',
        referenceNumber: 'UMG-99',
        resolutionDate: '2026-10-20',
        status: 'resolved',
        priceBasis: 'gross',
        authorityBudget: 200_000,
        scopeQuantity: 10,
        scopeUnit: 'km',
        bidders: [
          { id: 'b1', name: 'Biuro Świerk', isOurs: false, price: 150_000 },
          { id: 'b2', name: 'Nasza Spółka', isOurs: true, price: 180_000 },
        ],
        winnerBidderId: 'b1',
      },
      {
        name: 'Hala sportowa Kraków',
        contractingAuthority: 'ZIS Kraków',
        resolutionDate: '2026-10-05',
        status: 'announced',
        priceBasis: 'net',
        authorityBudget: 300_000,
        scopeQuantity: 1000,
        scopeUnit: 'm2',
        bidders: [{ id: 'b1', name: 'KrakBud', isOurs: false, price: 250_000 }],
      },
    ];

    const createdIds: string[] = [];
    for (const p of payloads) {
      const r = await fetch(`${ctx.baseUrl}/api/tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(p),
      });
      expect(r.status).toBe(201);
      createdIds.push((await r.json()).tender.id);
    }

    // Konflikt rewizji If-Match -> 409
    const patchOk = await fetch(`${ctx.baseUrl}/api/tenders/${createdIds[0]}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': '1',
      },
      body: JSON.stringify({ notes: 'Zaktualizowana notatka' }),
    });
    expect(patchOk.status).toBe(200);
    const patchedJson = await patchOk.json();
    expect(patchedJson.tender.revision).toBe(2);

    const patchConflict = await fetch(`${ctx.baseUrl}/api/tenders/${createdIds[0]}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'If-Match': '1',
      },
      body: JSON.stringify({ notes: 'Stara rewizja' }),
    });
    expect(patchConflict.status).toBe(409);

    // Wyszukiwanie q bez polskich znaków znajduje 'Żółć' w nazwie oferenta
    const qRes = await (
      await fetch(`${ctx.baseUrl}/api/tenders?q=zolc`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(qRes.total).toBe(1);
    expect(qRes.items[0].id).toBe(createdIds[0]);

    // Filtr won=true i ourOnly=true
    const wonRes = await (
      await fetch(`${ctx.baseUrl}/api/tenders?won=true`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(wonRes.total).toBe(1);
    expect(wonRes.items[0].id).toBe(createdIds[0]);

    const ourRes = await (
      await fetch(`${ctx.baseUrl}/api/tenders?ourOnly=true&page=1&pageSize=1&sort=winnerPrice&order=desc`, {
        headers: { Cookie: adminCookie },
      })
    ).json();
    expect(ourRes.total).toBe(2);
    expect(ourRes.items).toHaveLength(1);
    expect(ourRes.items[0].id).toBe(createdIds[1]); // 150k > 80k
    // Summary liczone ze wszystkich pasujących (2 szt. w km), nie tylko ze strony 1!
    expect(ourRes.summary.totalCount).toBe(2);
    expect(ourRes.summary.wonPercent).toBe(50);
    expect(ourRes.summary.commonScopeUnit).toBe('km');
    expect(ourRes.summary.winnerPricePerUnit).toEqual({
      unit: 'km',
      count: 2,
      min: 15_000,
      median: 15_500, // (16000 + 15000) / 2
      max: 16_000,
    });

    // Wszystkie klucze sortowania działają przez HTTP
    for (const sortKey of TENDER_SORT_KEYS) {
      const sortRes = await fetch(`${ctx.baseUrl}/api/tenders?sort=${sortKey}&order=asc`, {
        headers: { Cookie: adminCookie },
      });
      expect(sortRes.status).toBe(200);
    }
  });

  it('tworzy projekt z wygranego przetargu (create-project), chroni przed duplikacją, obsługuje force i templateId oraz ukrywa tenders w GET/POST /api/state', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);

    // Utwórz dwie firmy: VAT i ZW
    const cVat = (
      await (
        await fetch(`${ctx.baseUrl}/api/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'Spółka VAT', letter: 'A', vatPayer: true }),
        })
      ).json()
    ).company;
    const cZw = (
      await (
        await fetch(`${ctx.baseUrl}/api/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ name: 'Spółka ZW', letter: 'B', vatPayer: false }),
        })
      ).json()
    ).company;

    // Przetarg wygrany przez obcą firmę -> 409 przy create-project
    const lostTender = (
      await (
        await fetch(`${ctx.baseUrl}/api/tenders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            name: 'Przegrany',
            contractingAuthority: 'Zamawiający',
            resolutionDate: '2026-10-01',
            status: 'resolved',
            bidders: [{ id: 'w', name: 'Konkurent', isOurs: false, price: 50_000 }],
            winnerBidderId: 'w',
          }),
        })
      ).json()
    ).tender;

    const lostCreateProj = await fetch(
      `${ctx.baseUrl}/api/tenders/${lostTender.id}/create-project`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({}),
      }
    );
    expect(lostCreateProj.status).toBe(409);

    // Przetarg wygrany przez naszą firmę VAT (brutto 123 000 -> netto 100 000 przy 23%)
    const wonTender = (
      await (
        await fetch(`${ctx.baseUrl}/api/tenders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            name: 'Dokumentacja S7',
            contractingAuthority: 'GDDKiA Warszawa',
            description: 'Projekt budowlany',
            url: 'https://ezamowienia.gov.pl/s7',
            resolutionDate: '2026-11-01',
            status: 'resolved',
            priceBasis: 'gross',
            bidders: [
              { id: 'our', name: 'Spółka VAT', isOurs: true, companyId: cVat.id, price: 123_000 },
            ],
            winnerBidderId: 'our',
          }),
        })
      ).json()
    ).tender;

    const createProjRes = await fetch(
      `${ctx.baseUrl}/api/tenders/${wonTender.id}/create-project`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ startDate: '2026-11-25', templateId: 'tpl-ignored' }),
      }
    );
    expect(createProjRes.status).toBe(201);
    const createdProjData = await createProjRes.json();
    expect(createdProjData.project.key).toMatch(/^\d{4}-1_A$/);
    expect(createdProjData.project.projectValue).toBe(100_000);
    expect(createdProjData.project.projectValueGross).toBe(123_000);
    expect(createdProjData.project.projectVatRate).toBe(23);
    expect(createdProjData.project.clientName).toBe('GDDKiA Warszawa');
    expect(createdProjData.project.sourceTenderId).toBe(wonTender.id);
    expect(createdProjData.project.description).toContain('Projekt budowlany');
    expect(createdProjData.project.description).toContain('https://ezamowienia.gov.pl/s7');
    expect(createdProjData.tender.linkedProjectId).toBe(createdProjData.project.id);
    expect(createdProjData.message || createdProjData.notice).toBeTruthy();

    // Ponowne kopiowanie bez force -> 409
    const dupRes = await fetch(
      `${ctx.baseUrl}/api/tenders/${wonTender.id}/create-project`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({}),
      }
    );
    expect(dupRes.status).toBe(409);

    // Ponowne kopiowanie z force: true i nadpisaną firmą ZW -> 201, netto = brutto, VAT 0
    const forceRes = await fetch(
      `${ctx.baseUrl}/api/tenders/${wonTender.id}/create-project`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ force: true, companyId: cZw.id }),
      }
    );
    expect(forceRes.status).toBe(201);
    const forceData = await forceRes.json();
    expect(forceData.project.key).toMatch(/^\d{4}-2_B$/);
    expect(forceData.project.projectValue).toBe(123_000);
    expect(forceData.project.projectValueGross).toBe(123_000);
    expect(forceData.project.projectVatRate).toBe(0);

    // GET /api/state nie zwraca tenders
    const stateGet = await (
      await fetch(`${ctx.baseUrl}/api/state`, { headers: { Cookie: adminCookie } })
    ).json();
    expect('tenders' in stateGet.state).toBe(false);

    // POST /api/state zachowuje przetargi
    const importRes = await fetch(`${ctx.baseUrl}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        ...stateGet.state,
        tenders: [],
      }),
    });
    expect(importRes.status).toBe(200);

    const tendersAfterImport = await (
      await fetch(`${ctx.baseUrl}/api/tenders`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(tendersAfterImport.total).toBe(2);

    // Zdarzenia bezpieczeństwa zostały zapisane
    const eventsRes = await (
      await fetch(`${ctx.baseUrl}/api/security/events?limit=50`, {
        headers: { Cookie: adminCookie },
      })
    ).json();
    const types = eventsRes.events.map((e: any) => e.type);
    expect(types).toContain('tender_created');
    expect(types).toContain('tender_project_created');
  });

  it('egzekwuje limit 60 zapisów/godz./użytkownik (429)', async () => {
    ctx = await startTestServer();
    const { cookie: adminCookie } = await setupAdmin(ctx.baseUrl);
    const pm = await createAndLoginUser(ctx.baseUrl, adminCookie, {
      name: 'PM Limiter',
      email: 'pm-limit@pracownia.pl',
      role: 'project_manager',
      password: 'Projekt-Wiadukt-2026-Lublin!',
    });

    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: pm.cookie },
        body: JSON.stringify({
          name: `Przetarg ${i + 1}`,
          contractingAuthority: 'Zamawiający',
          resolutionDate: '2026-11-15',
        }),
      });
      expect(r.status).toBe(201);
    }

    const blocked = await fetch(`${ctx.baseUrl}/api/tenders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: pm.cookie },
      body: JSON.stringify({
        name: 'Przetarg 61',
        contractingAuthority: 'Zamawiający',
        resolutionDate: '2026-11-15',
      }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });
});
