import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { createApp } from '../../server.js';
import type { Project } from '../types';
import {
  buildFinancePatch,
  computeProjectFinance,
  isPaymentOverdue,
  validateProjectFinanceFields,
} from '../utils/finance';
import { MONEY_PRECISION_ERROR } from '../utils/money';

function makeBaseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj-1',
    key: 'PRJ-1',
    name: 'Projekt testowy',
    description: 'Opis',
    priority: 'normal',
    status: 'active',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    durationDays: 365,
    progress: 10,
    memberIds: ['usr-admin'],
    color: '#0284c7',
    ...overrides,
  };
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
    if (/(?:__Host-zp_session|zp_session)=([^;]+)/.test(raw)) {
      return raw.split(';')[0];
    }
  }
  return '';
}

describe('Logika finansowa projektu (finance.ts) i API finansów', () => {
  it('wycena kosztowa z linkedCostId nie jest liczona podwójnie w computeProjectFinance', () => {
    const project = makeBaseProject({
      projectValue: 10000,
      projectVatRate: 23,
      quotations: [
        {
          id: 'q-rev',
          title: 'Dodatkowy etap',
          type: 'przychod',
          isSelected: true,
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 2000,
          vatRate: 23,
          totalNet: 2000,
          totalGross: 2460,
          status: 'accepted',
        },
        {
          id: 'q-cost-linked',
          title: 'Konstrukcja podwykonawcy',
          type: 'koszt',
          isSelected: true,
          isChosenOffer: true,
          linkedCostId: 'cst-1',
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 3500,
          vatRate: 23,
          totalNet: 3500,
          totalGross: 4305,
          status: 'accepted',
          dueDate: '2026-12-10',
          isPaid: false,
        },
        {
          id: 'q-cost-unlinked',
          title: 'Alternatywna wycena sanitarna',
          type: 'koszt',
          isSelected: true,
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 1000,
          vatRate: 23,
          totalNet: 1000,
          totalGross: 1230,
          status: 'accepted',
          dueDate: '2026-12-15',
          isPaid: false,
        },
      ],
      costs: [
        {
          id: 'cst-1',
          projectId: 'prj-1',
          title: 'Konstrukcja podwykonawcy',
          category: 'podwykonawca',
          amountNet: 3500,
          amountGross: 4305,
          date: '2026-11-19',
          dueDate: '2026-12-10',
          status: 'planned',
          isPaid: false,
          sourceQuotationId: 'q-cost-linked',
        },
      ],
    });

    const summary = computeProjectFinance(project, { todayIso: '2026-11-19' });

    expect(summary.totalRevenueNet).toBe(12000);
    expect(summary.directCostsNet).toBe(3500);
    // q-cost-linked musi być pominięta, liczy się tylko q-cost-unlinked (1000) + cst-1 (3500)
    expect(summary.quoteCostsNet).toBe(1000);
    expect(summary.totalCostsNet).toBe(4500);
    expect(summary.profitNet).toBe(7500);
    expect(summary.expectedOutflowNet).toBe(4500);
  });

  it('wylicza transze płatności, ostrzeżenie o przekroczeniu wartości, expectedInflowNet, expectedOutflowNet i nextPaymentDate', () => {
    const project = makeBaseProject({
      projectValue: 10000,
      projectVatRate: 23,
      quotations: [
        {
          id: 'q-r1',
          title: 'Aneks z terminem',
          type: 'przychod',
          isSelected: true,
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 1500.5,
          vatRate: 23,
          totalNet: 1500.5,
          totalGross: 1845.62,
          status: 'accepted',
          dueDate: '2026-12-01',
          isPaid: false,
        },
        {
          id: 'q-r2-nodate',
          title: 'Aneks bez terminu',
          type: 'przychod',
          isSelected: true,
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 500,
          vatRate: 23,
          totalNet: 500,
          totalGross: 615,
          status: 'accepted',
          isPaid: false,
        },
      ],
      paymentTranches: [
        {
          id: 't1',
          title: 'Zaliczka',
          amountNet: 4000,
          amountGross: 4920,
          dueDate: '2026-10-15',
          isPaid: true,
          paidAt: '2026-10-14',
          paidAmount: 4000,
        },
        {
          id: 't2',
          title: 'Transza II',
          amountNet: 9000,
          amountGross: 11070,
          dueDate: '2026-11-25',
          isPaid: false,
        },
      ],
      costs: [
        {
          id: 'c1',
          projectId: 'prj-1',
          title: 'Geologia planowana',
          category: 'geologia',
          amountNet: 1234.56,
          amountGross: 1518.51,
          date: '2026-11-01',
          dueDate: '2026-11-22',
          status: 'planned',
          isPaid: false,
        },
        {
          id: 'c2',
          projectId: 'prj-1',
          title: 'Mapa zapłacona',
          category: 'mapa',
          amountNet: 800,
          amountGross: 984,
          date: '2026-10-01',
          dueDate: '2026-10-10',
          status: 'paid',
          isPaid: true,
        },
        {
          id: 'c3',
          projectId: 'prj-1',
          title: 'Koszt bez terminu',
          category: 'inne',
          amountNet: 300,
          amountGross: 369,
          date: '2026-11-01',
          status: 'incurred',
          isPaid: false,
        },
      ],
    });

    const summary = computeProjectFinance(project, { todayIso: '2026-11-19' });

    // totalRevenueNet = 10000 + 1500.5 + 500 = 12000.5
    // tranchesTotalNet = 4000 + 9000 = 13000 > 12000.5 -> przekracza wartość projektu
    expect(summary.totalRevenueNet).toBe(12000.5);
    expect(summary.tranchesTotalNet).toBe(13000);
    expect(summary.tranchesPaidNet).toBe(4000);
    expect(summary.tranchesRemainingNet).toBe(9000);
    expect(summary.tranchesExceedProjectValue).toBe(true);

    // expectedInflowNet = niezapłacona transza z terminem (9000) + niezapłacona wycena z terminem (1500.50)
    expect(summary.expectedInflowNet).toBe(10500.5);
    // expectedOutflowNet = niezapłacony koszt z terminem (1234.56)
    expect(summary.expectedOutflowNet).toBe(1234.56);
    // najbliższy nadchodzący termin płatności >= 2026-11-19 to 2026-11-22 (c1)
    expect(summary.nextPaymentDate).toBe('2026-11-22');

    expect(isPaymentOverdue('2026-11-18', false, '2026-11-19')).toBe(true);
    expect(isPaymentOverdue('2026-11-18', true, '2026-11-19')).toBe(false);
    expect(isPaymentOverdue('2026-11-20', false, '2026-11-19')).toBe(false);
  });

  it('buildFinancePatch wysyła wyłącznie zmienione pola finansowe', () => {
    const orig = makeBaseProject({
      projectValue: 10000,
      projectVatRate: 23,
      clientName: 'Inwestor A',
      costs: [
        {
          id: 'c1',
          projectId: 'prj-1',
          title: 'MDCP',
          category: 'mapa',
          amountNet: 500,
          amountGross: 615,
          date: '2026-11-01',
          status: 'paid',
        },
      ],
    });

    const patch = buildFinancePatch(orig, {
      ...orig,
      projectValue: 12345.67,
    });

    expect(Object.keys(patch)).toEqual(['projectValue']);
    expect(patch.projectValue).toBe(12345.67);
  });

  it('validateProjectFinanceFields odrzuca >2 miejsca po przecinku na kosztach/wycenach/transzach', () => {
    const bad = validateProjectFinanceFields({
      costs: [
        {
          id: 'c-bad',
          projectId: 'prj-1',
          title: 'Błędny koszt',
          category: 'mapa',
          amountNet: 12.345,
          amountGross: 15.18,
          date: '2026-11-01',
          status: 'planned',
        },
      ],
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe(MONEY_PRECISION_ERROR);
    expect(bad.itemType).toBe('cost');
    expect(bad.itemId).toBe('c-bad');
  });

  it('API PATCH /api/projects/:id wymusza canEditFinance (403 dla obcego PM), walidację 400 i konflikt rewizji 409', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-finance-api-'));
    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const instance = await createApp({
      dataDir,
      appSecret: secret,
      port: 0,
      isProduction: true,
      allowSelfRegistration: false,
      setupToken: '',
    });

    const srv = http.createServer(instance.app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const addr = srv.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1. Setup Admin
      const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin Finanse',
          email: 'admin.fin@example.pl',
          password: 'Haslo-Bezpieczne-2026!',
        }),
      });
      expect(setupRes.status).toBe(200);
      const adminCookie = extractSessionCookie(setupRes);

      // 2. Dodaj 2 kierowników projektu: owner PM oraz other PM
      const pm1Res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Kierownik Właściciel',
          email: 'pm.owner@example.pl',
          role: 'project_manager',
          department: 'Architektura',
          password: 'Haslo-Bezpieczne-2026!',
        }),
      });
      const pm1Data = await pm1Res.json();

      const pm2Res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Kierownik Obcy',
          email: 'pm.other@example.pl',
          role: 'project_manager',
          department: 'Konstrukcja',
          password: 'Haslo-Bezpieczne-2026!',
        }),
      });
      expect(pm2Res.status).toBe(200);

      // 3. Zaloguj obu kierowników
      const loginPm2 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'pm.other@example.pl',
          password: 'Haslo-Bezpieczne-2026!',
        }),
      });
      const pm2Cookie = extractSessionCookie(loginPm2);

      // 4. Admin tworzy projekt z ownerId = pm1
      const createProj = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          key: 'FIN-1',
          name: 'Projekt Finansowy',
          ownerId: pm1Data.user.id,
        }),
      });
      expect(createProj.status).toBe(201);
      const projData = await createProj.json();
      const projId = projData.project.id;

      // 5. Obcy PM próbuje zmienić finanse -> 403
      const forbiddenRes = await fetch(`${baseUrl}/api/projects/${projId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '1',
          Cookie: pm2Cookie,
        },
        body: JSON.stringify({ projectValue: 9999 }),
      });
      expect(forbiddenRes.status).toBe(403);

      // 6. Admin wysyła kwotę z 3 miejscami po przecinku -> 400
      const badPrecisionRes = await fetch(`${baseUrl}/api/projects/${projId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '1',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ projectValue: 12.345 }),
      });
      expect(badPrecisionRes.status).toBe(400);
      const badPrecisionJson = await badPrecisionRes.json();
      expect(badPrecisionJson.error).toBe(MONEY_PRECISION_ERROR);

      // 7. Poprawny zapis groszowy -> 200 (rewizja rośnie do 2)
      const okRes = await fetch(`${baseUrl}/api/projects/${projId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '1',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ projectValue: 1234.56 }),
      });
      expect(okRes.status).toBe(200);

      // 8. Zapis ze starą rewizją If-Match: 1 -> 409 z currentProject
      const conflictRes = await fetch(`${baseUrl}/api/projects/${projId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '1',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ projectValue: 2000 }),
      });
      expect(conflictRes.status).toBe(409);
      const conflictJson = await conflictRes.json();
      expect(conflictJson.currentProject.projectValue).toBe(1234.56);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('validateProjectFinanceFields sprawdza limity pozycji, unikalność ID, nieznane pola, słowniki, daty i spójność netto/VAT/brutto', () => {
    // Limit 500 dla kosztów
    const tooManyCosts = Array.from({ length: 501 }, (_, i) => ({
      id: `c-${i}`,
      projectId: 'p1',
      title: `Koszt ${i}`,
      category: 'inne',
      amountNet: 100,
      amountGross: 123,
      date: '2026-11-01',
      status: 'planned',
    }));
    const overflowCosts = validateProjectFinanceFields({ costs: tooManyCosts });
    expect(overflowCosts.ok).toBe(false);
    expect(overflowCosts.error).toBe('Zbyt wiele pozycji (maks. 500)');

    // Limit 100 dla transz
    const tooManyTranches = Array.from({ length: 101 }, (_, i) => ({
      id: `t-${i}`,
      title: `Transza ${i}`,
      amountNet: 100,
      amountGross: 123,
      isPaid: false,
    }));
    const overflowTranches = validateProjectFinanceFields({ paymentTranches: tooManyTranches });
    expect(overflowTranches.ok).toBe(false);
    expect(overflowTranches.error).toBe('Zbyt wiele pozycji (maks. 100)');

    // Duplikat ID
    const dupId = validateProjectFinanceFields({
      costs: [
        {
          id: 'dup',
          projectId: 'p1',
          title: 'A',
          category: 'mapa',
          amountNet: 100,
          amountGross: 123,
          date: '2026-11-01',
          status: 'planned',
        },
        {
          id: 'dup',
          projectId: 'p1',
          title: 'B',
          category: 'mapa',
          amountNet: 100,
          amountGross: 123,
          date: '2026-11-01',
          status: 'planned',
        },
      ],
    });
    expect(dupId.ok).toBe(false);
    expect(dupId.error).toContain('Duplikat');

    // Nieznane pole
    const unknownField = validateProjectFinanceFields({
      quotations: [
        {
          id: 'q1',
          title: 'Wycena',
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 100,
          vatRate: 23,
          totalNet: 100,
          totalGross: 123,
          status: 'accepted',
          extraHackField: true,
        },
      ],
    });
    expect(unknownField.ok).toBe(false);
    expect(unknownField.error).toContain('extraHackField');

    // Błędna data
    const badDate = validateProjectFinanceFields({
      costs: [
        {
          id: 'c-date',
          projectId: 'p1',
          title: 'Koszt złą datą',
          category: 'mapa',
          amountNet: 100,
          amountGross: 123,
          date: '2026-02-30',
          status: 'planned',
        },
      ],
    });
    expect(badDate.ok).toBe(false);

    // Niespójne brutto (> 0,05 zł)
    const badGross = validateProjectFinanceFields({
      quotations: [
        {
          id: 'q-bad-gross',
          title: 'Wycena błędna',
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 1000,
          vatRate: 23,
          totalNet: 1000,
          totalGross: 1500,
          status: 'accepted',
        },
      ],
    });
    expect(badGross.ok).toBe(false);
    expect(badGross.itemId).toBe('q-bad-gross');

    // Zwolniony z VAT (taxType: 'zwolniony' oraz vatRate: 0)
    const exemptOk = validateProjectFinanceFields({
      quotations: [
        {
          id: 'q-zw',
          title: 'Usługa zwolniona',
          taxType: 'zwolniony',
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 1000,
          unitPriceGross: 1000,
          vatRate: 0,
          totalNet: 1000,
          totalGross: 1000,
          status: 'accepted',
        },
      ],
    });
    expect(exemptOk.ok).toBe(true);

    const exemptMismatch = validateProjectFinanceFields({
      quotations: [
        {
          id: 'q-zw-bad',
          title: 'Zwolniona z VAT ale z narzutem',
          taxType: 'zwolniony',
          quantity: 1,
          unit: 'kpl',
          unitPriceNet: 1000,
          vatRate: 0,
          totalNet: 1000,
          totalGross: 1230,
          status: 'accepted',
        },
      ],
    });
    expect(exemptMismatch.ok).toBe(false);
  });

  it('API integracyjne P62: właściciel developer edytuje finanse, nie-właściciel PM dostaje 403, legacy PM 200, limity 500/VAT 400, audyt finance_changed i parentId zadań', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-p62-api-'));
    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const instance = await createApp({
      dataDir,
      appSecret: secret,
      port: 0,
      isProduction: true,
      allowSelfRegistration: false,
      setupToken: '',
    });

    const srv = http.createServer(instance.app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const addr = srv.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin P62',
          email: 'admin.p62@example.pl',
          password: 'Haslo-Bezpieczne-2026!',
        }),
      });
      expect(setupRes.status).toBe(200);
      const adminCookie = extractSessionCookie(setupRes);

      const createUser = async (name: string, email: string, role: string) => {
        const uRes = await fetch(`${baseUrl}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            name,
            email,
            role,
            department: 'Projektowy',
            password: 'Haslo-Bezpieczne-2026!',
          }),
        });
        expect(uRes.status).toBe(200);
        const uJson = await uRes.json();
        const lRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'Haslo-Bezpieczne-2026!' }),
        });
        expect(lRes.status).toBe(200);
        return { user: uJson.user, cookie: extractSessionCookie(lRes) };
      };

      const devOwner = await createUser('Dev Właściciel', 'dev.owner@example.pl', 'developer');
      const testerOwner = await createUser('Tester Właściciel', 'tester.owner@example.pl', 'tester');
      const pmNonOwner = await createUser('PM Obcy', 'pm.nonowner@example.pl', 'project_manager');

      // 1. Projekt z ownerId = devOwner (bez podawania go w memberIds -> serwer dodaje i traktuje jak członka)
      const ownedProjRes = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          key: '2026-1_A',
          name: 'Projekt Dev Owner',
          ownerId: devOwner.user.id,
        }),
      });
      expect(ownedProjRes.status).toBe(201);
      const ownedProj = (await ownedProjRes.json()).project;
      expect(ownedProj.memberIds).toContain(devOwner.user.id);

      // 2. Projekt bez ownerId (legacy) oraz cudzy projekt
      const legacyProjRes = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          key: '2026-2_A',
          name: 'Projekt Bez Właściciela',
        }),
      });
      expect(legacyProjRes.status).toBe(201);
      const legacyProj = (await legacyProjRes.json()).project;

      // Właściciel developer edytuje finanse własnego projektu -> 200
      const devPatchOwn = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: devOwner.cookie },
        body: JSON.stringify({
          projectValue: 10000,
          projectValueGross: 12300,
          projectVatRate: 23,
          costs: [
            {
              id: 'cost-1',
              projectId: ownedProj.id,
              title: 'Mapa MDCP',
              category: 'mapa',
              amountNet: 1000,
              amountGross: 1230,
              vatRate: 23,
              date: '2026-11-10',
              status: 'planned',
            },
          ],
        }),
      });
      expect(devPatchOwn.status).toBe(200);
      const devPatchJson = await devPatchOwn.json();
      expect(devPatchJson.project.projectValue).toBe(10000);
      expect(devPatchJson.project.costs).toHaveLength(1);

      // Właściciel developer nie może zmienić memberIds ani key -> 403
      const devPatchMembers = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: devOwner.cookie },
        body: JSON.stringify({ memberIds: [devOwner.user.id] }),
      });
      expect(devPatchMembers.status).toBe(403);

      // Właściciel developer nie może edytować cudzego projektu -> 403
      const devPatchForeign = await fetch(`${baseUrl}/api/projects/${legacyProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: devOwner.cookie },
        body: JSON.stringify({ projectValue: 500 }),
      });
      expect(devPatchForeign.status).toBe(403);

      // PM niebędący właścicielem projektu z ustawionym ownerId -> 403 (zarówno finanse, jak i próba zmiany ownerId)
      const pmPatchOwned = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: pmNonOwner.cookie },
        body: JSON.stringify({ projectValue: 7777 }),
      });
      expect(pmPatchOwned.status).toBe(403);

      const pmStealOwner = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: pmNonOwner.cookie },
        body: JSON.stringify({ ownerId: pmNonOwner.user.id }),
      });
      expect(pmStealOwner.status).toBe(403);

      // Projekt bez ownerId -> PM może edytować finanse (200)
      const pmPatchLegacy = await fetch(`${baseUrl}/api/projects/${legacyProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: pmNonOwner.cookie },
        body: JSON.stringify({ projectValue: 4000, projectValueGross: 4920 }),
      });
      expect(pmPatchLegacy.status).toBe(200);

      // Aktualizacja kosztu przez devOwner (sprawdzimy diff before/after w finance_changed)
      const updateCostRes = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: devOwner.cookie },
        body: JSON.stringify({
          costs: [
            {
              id: 'cost-1',
              projectId: ownedProj.id,
              title: 'Mapa MDCP',
              category: 'mapa',
              amountNet: 1500,
              amountGross: 1845,
              vatRate: 23,
              date: '2026-11-10',
              status: 'incurred',
            },
          ],
        }),
      });
      expect(updateCostRes.status).toBe(200);

      // Przekazanie ownerId przez obecnego właściciela na testerOwner dodaje go do memberIds i daje mu prawo edycji
      const transferOwnerRes = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: devOwner.cookie },
        body: JSON.stringify({ ownerId: testerOwner.user.id }),
      });
      expect(transferOwnerRes.status).toBe(200);
      const transferredProj = (await transferOwnerRes.json()).project;
      expect(transferredProj.ownerId).toBe(testerOwner.user.id);
      expect(transferredProj.memberIds).toContain(testerOwner.user.id);

      const testerPatchRes = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: testerOwner.cookie },
        body: JSON.stringify({ projectValue: 11000, projectValueGross: 13530 }),
      });
      expect(testerPatchRes.status).toBe(200);

      // 501 kosztów -> 400
      const costs501 = Array.from({ length: 501 }, (_, i) => ({
        id: `c-${i}`,
        projectId: ownedProj.id,
        title: `Koszt ${i}`,
        category: 'inne',
        amountNet: 10,
        amountGross: 12.3,
        date: '2026-11-10',
        status: 'planned',
      }));
      const res501 = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ costs: costs501 }),
      });
      expect(res501.status).toBe(400);
      const json501 = await res501.json();
      expect(json501.error).toBe('Zbyt wiele pozycji (maks. 500)');

      // Niespójne brutto -> 400
      const resBadGross = await fetch(`${baseUrl}/api/projects/${ownedProj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          costs: [
            {
              id: 'c-bad',
              projectId: ownedProj.id,
              title: 'Złe brutto',
              category: 'mapa',
              amountNet: 1000,
              amountGross: 2000,
              vatRate: 23,
              date: '2026-11-10',
              status: 'planned',
            },
          ],
        }),
      });
      expect(resBadGross.status).toBe(400);

      // Zdarzenie finance_changed widoczne dla administratora z diffem przed/po
      const secRes = await fetch(`${baseUrl}/api/security/events?type=finance_changed&limit=20`, {
        headers: { Cookie: adminCookie },
      });
      expect(secRes.status).toBe(200);
      const secJson = await secRes.json();
      expect(secJson.events.length).toBeGreaterThanOrEqual(3);
      const costUpdateEvent = secJson.events.find(
        (ev: any) =>
          ev.details?.projectId === ownedProj.id &&
          Array.isArray(ev.details?.items) &&
          ev.details.items.some((it: any) => it.action === 'updated' && it.id === 'cost-1')
      );
      expect(costUpdateEvent).toBeDefined();
      expect(costUpdateEvent.userId).toBe(devOwner.user.id);
      expect(costUpdateEvent.details.projectKey).toBe('2026-1_A');
      const costDiff = costUpdateEvent.details.items.find((it: any) => it.id === 'cost-1');
      expect(costDiff.title).toBe('Mapa MDCP');
      expect(costDiff.before).toEqual({ net: 1000, gross: 1230 });
      expect(costDiff.after).toEqual({ net: 1500, gross: 1845 });

      // Walidacja parentId w API zadań: cykl, inny projekt, self-parenting, głębokość 6, usuwanie pustym ciągiem
      const createTask = async (payload: Record<string, any>) => {
        return fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify(payload),
        });
      };

      const t1 = (await (await createTask({ projectId: ownedProj.id, title: 'Poziom 1' })).json()).task;
      const t2 = (await (await createTask({ projectId: ownedProj.id, title: 'Poziom 2', parentId: t1.id })).json()).task;

      // Cykl w PATCH /api/tasks/:id (t1 -> parentId: t2) -> 400
      const cycleRes = await fetch(`${baseUrl}/api/tasks/${t1.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ parentId: t2.id }),
      });
      expect(cycleRes.status).toBe(400);

      // Zadanie z innego projektu -> 400
      const foreignTask = (await (await createTask({ projectId: legacyProj.id, title: 'Obce zadanie' })).json()).task;
      const crossProjPost = await createTask({
        projectId: ownedProj.id,
        title: 'Zły parent z innego projektu',
        parentId: foreignTask.id,
      });
      expect(crossProjPost.status).toBe(400);

      // Głębokość > 6 -> 400
      const t3 = (await (await createTask({ projectId: ownedProj.id, title: 'P3', parentId: t2.id })).json()).task;
      const t4 = (await (await createTask({ projectId: ownedProj.id, title: 'P4', parentId: t3.id })).json()).task;
      const t5 = (await (await createTask({ projectId: ownedProj.id, title: 'P5', parentId: t4.id })).json()).task;
      const t6Res = await createTask({ projectId: ownedProj.id, title: 'P6', parentId: t5.id });
      expect(t6Res.status).toBe(201);
      const t6 = (await t6Res.json()).task;

      const t7Res = await createTask({ projectId: ownedProj.id, title: 'P7', parentId: t6.id });
      expect(t7Res.status).toBe(400);

      // Pusty ciąg usuwa parentId -> 200 i brak parentId w zadaniu
      const clearParentRes = await fetch(`${baseUrl}/api/tasks/${t2.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ parentId: '' }),
      });
      expect(clearParentRes.status).toBe(200);
      const clearedTask = (await clearParentRes.json()).task;
      expect(clearedTask.parentId).toBeUndefined();
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
