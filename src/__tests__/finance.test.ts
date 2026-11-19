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
});
