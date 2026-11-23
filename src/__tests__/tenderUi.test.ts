import { describe, it, expect } from 'vitest';
import {
  buildTenderQueryParams,
  canAccessTenders,
  canDeleteTender,
  computeLiveBidderPreview,
  exportTendersCsv,
  formatTenderCsvCell,
  formatTenderPercent,
  formatTenderPln,
  formatTenderPricePerUnit,
  formatTenderScope,
  INITIAL_TENDER_FILTERS,
  sanitizeTenderCsvFormula,
  sortComputedBiddersForDetail,
  TenderListItem,
} from '../utils/tenderUi.js';
import type { Company } from '../types/index.js';

describe('Formatowanie, uprawnienia i obliczenia UI modułu Przetargi', () => {
  it('poprawnie formatuje kwoty PLN, procenty, zakresy i ceny jednostkowe', () => {
    expect(formatTenderPln(12345.6)).toBe('12 345,60 zł');
    expect(formatTenderPln(null)).toBe('—');
    expect(formatTenderPercent(87.5)).toBe('87,50%');
    expect(formatTenderPercent(undefined)).toBe('—');
    expect(formatTenderScope(12.5, 'km')).toBe('12,5 km');
    expect(formatTenderScope(null, 'km')).toBe('—');
    expect(formatTenderPricePerUnit(1250, 'km')).toBe('1 250,00 zł/km');
    expect(formatTenderPricePerUnit(500, '')).toBe('500,00 zł/jedn.');
    expect(formatTenderPricePerUnit(null, 'km')).toBe('—');
  });

  it('wylicza podgląd ceny jednostkowej i procentu budżetu na żywo', () => {
    expect(computeLiveBidderPreview(150000, 10, 200000)).toEqual({
      pricePerUnit: 15000,
      pctOfBudget: 75,
    });
    expect(computeLiveBidderPreview(150000, null, 200000)).toEqual({
      pricePerUnit: null,
      pctOfBudget: 75,
    });
    expect(computeLiveBidderPreview(null, 10, 200000)).toEqual({
      pricePerUnit: null,
      pctOfBudget: null,
    });
  });

  it('sortuje oferentów w szczegółach według ceny i przenosi odrzuconych na koniec', () => {
    const sorted = sortComputedBiddersForDetail([
      { id: 'b3', name: 'Odrzucona Tania', price: 90, isOurs: false, isDisqualified: true, rank: null, pricePerUnit: null, pctOfBudget: null },
      { id: 'b2', name: 'Droższa', price: 200, isOurs: false, rank: 2, pricePerUnit: null, pctOfBudget: null },
      { id: 'b1', name: 'Najtańsza', price: 150, isOurs: true, rank: 1, pricePerUnit: null, pctOfBudget: null },
    ]);
    expect(sorted.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('sprawdza uprawnienia dostępu i usuwania przetargów według roli i autora', () => {
    expect(canAccessTenders({ role: 'admin' })).toBe(true);
    expect(canAccessTenders({ role: 'project_manager' })).toBe(true);
    expect(canAccessTenders({ role: 'developer' })).toBe(false);
    expect(canAccessTenders({ role: 'tester' })).toBe(false);
    expect(canAccessTenders({ role: 'viewer' })).toBe(false);

    expect(canDeleteTender({ id: 'u-1', role: 'admin' }, { createdBy: 'u-2' })).toBe(true);
    expect(canDeleteTender({ id: 'u-2', role: 'project_manager' }, { createdBy: 'u-2' })).toBe(true);
    expect(canDeleteTender({ id: 'u-3', role: 'project_manager' }, { createdBy: 'u-2' })).toBe(false);
  });

  it('buduje parametry zapytania listy przetargów z filtrami, sortowaniem i paginacją', () => {
    const params = buildTenderQueryParams(
      {
        ...INITIAL_TENDER_FILTERS,
        q: 'droga',
        authority: 'Gmina',
        status: 'resolved',
        ourOnly: true,
        won: true,
        minPrice: '10 000,50',
      },
      'winnerPricePerUnit',
      'asc',
      2,
      50
    );
    expect(params.get('q')).toBe('droga');
    expect(params.get('authority')).toBe('Gmina');
    expect(params.get('status')).toBe('resolved');
    expect(params.get('ourOnly')).toBe('true');
    expect(params.get('won')).toBe('true');
    expect(params.get('minPrice')).toBe('10000.50');
    expect(params.get('sort')).toBe('winnerPricePerUnit');
    expect(params.get('order')).toBe('asc');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('50');
  });
});

describe('Eksport CSV przetargów i ochrona przed wstrzyknięciem formuł', () => {
  it('poprzedza apostrofem komórki zaczynające się od =, +, -, @ i poprawnie cytuje średniki/cudzysłowy', () => {
    expect(sanitizeTenderCsvFormula('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeTenderCsvFormula('+cmd|" /C calc"!A0')).toBe("'+cmd|\" /C calc\"!A0");
    expect(sanitizeTenderCsvFormula('-2+3')).toBe("'-2+3");
    expect(sanitizeTenderCsvFormula('@SUM(1+1)')).toBe("'@SUM(1+1)");
    expect(sanitizeTenderCsvFormula('  =HYPERLINK("http://evil")')).toBe("'  =HYPERLINK(\"http://evil\")");
    expect(sanitizeTenderCsvFormula('Zwykły tekst')).toBe('Zwykły tekst');

    expect(formatTenderCsvCell('=1+1;test')).toBe('"\'=1+1;test"');
    expect(formatTenderCsvCell('Firma "Alfa"')).toBe('"Firma ""Alfa"""');
  });

  it('generuje plik CSV z BOM UTF-8, separatorem ; i przecinkiem dziesiętnym', () => {
    const companies: Company[] = [
      { id: 'c-1', name: 'Biuro Alfa', letter: 'A', isActive: true, vatPayer: true },
    ];
    const items: TenderListItem[] = [
      {
        id: 'tnd-1',
        name: '=IMPORTXML("http://x")',
        contractingAuthority: '+Urząd Miasta',
        referenceNumber: '-REF-1',
        url: 'https://example.pl/tnd-1',
        announcementDate: '2026-01-10',
        submissionDeadline: '2026-02-01',
        resolutionDate: '2026-02-15',
        status: 'resolved',
        priceBasis: 'gross',
        authorityBudget: 250000.5,
        scopeQuantity: 10.25,
        scopeUnit: 'km',
        bidders: [
          { id: 'b-1', name: '@Konkurent', price: 240000, isOurs: false },
          { id: 'b-2', name: 'Biuro Alfa', price: 205000, isOurs: true, companyId: 'c-1' },
        ],
        winnerBidderId: 'b-2',
        createdAt: '2026-02-15T10:00:00.000Z',
        createdBy: 'usr-1',
        updatedAt: '2026-02-15T10:00:00.000Z',
        revision: 1,
        biddersCount: 2,
        lowestPrice: 205000,
        winnerPrice: 205000,
        ourPrice: 205000,
        ourRank: 1,
        authorityBudgetPerUnit: 24390.29,
        winnerPricePerUnit: 20000,
        ourPricePerUnit: 20000,
        winnerToBudgetPct: 82,
        ourToBudgetPct: 82,
        differenceOurVsWinner: 0,
        wonByUs: true,
      },
    ];

    const csv = exportTendersCsv(items, companies);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Nazwa;Zamawiający;');
    const rowCols = lines[1].split(';');
    expect(rowCols[0]).toBe('"\'=IMPORTXML(""http://x"")"');
    expect(rowCols[1]).toBe("'+Urząd Miasta");
    expect(rowCols[2]).toBe("'-REF-1");
    expect(rowCols[8]).toBe('250000,50');
    expect(rowCols[9]).toBe('10,25');
    expect(rowCols[10]).toBe('km');
    expect(rowCols[11]).toBe('205000,00');
    expect(rowCols[14]).toBe('A - Biuro Alfa');
    expect(rowCols[15]).toBe('20000,00');
    expect(rowCols[17]).toBe('82,00');
    expect(rowCols[19]).toBe('Tak');
  });
});
