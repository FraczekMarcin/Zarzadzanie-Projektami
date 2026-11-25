import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROJECT_PRIORITIES,
  DEFAULT_PROJECT_STATUSES,
  PROJECT_META_PALETTE,
  getDefaultProjectPriorityId,
  getDefaultProjectStatusId,
  getPaletteDef,
  isProjectStatusClosed,
  normalizeProjectPriorities,
  normalizeProjectStatuses,
  resolveProjectPriority,
  resolveProjectStatus,
  slugifyProjectMetaId,
} from '../utils/projectMeta.js';
import { validateProjectFinanceFields } from '../utils/financeValidation.js';
import { normalizeSubmitError, parseApiErrorResponse } from '../hooks/useFormSubmit.js';

describe('P76: Słowniki stanów i priorytetów projektów (projectMeta)', () => {
  it('normalizeProjectStatuses zachowuje stany systemowe, naprawia kolor/kolejność i wymusza dokładnie jeden domyślny stan', () => {
    const normalized = normalizeProjectStatuses([
      { id: 'planning', label: 'Wstępny', color: 'invalid_color' as any, order: 2, isDefault: false },
      { id: 'active', label: 'Realizacja', color: 'emerald', order: 1, isDefault: true },
      { id: 'cancelled', label: 'Anulowany', color: 'rose', order: 5, isDefault: true, isClosed: true },
    ]);

    const ids = normalized.map((s) => s.id);
    expect(ids).toEqual(['active', 'planning', 'on_hold', 'completed', 'cancelled']);

    const defaults = normalized.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('active');

    const planning = normalized.find((s) => s.id === 'planning')!;
    expect(planning.isSystem).toBe(true);
    expect(planning.color).toBe('sky');

    const cancelled = normalized.find((s) => s.id === 'cancelled')!;
    expect(cancelled.isClosed).toBe(true);
    expect(cancelled.isSystem).toBeUndefined();

    // Gdy lista jest pusta -> zwraca domyślne stany
    expect(normalizeProjectStatuses([])).toEqual(DEFAULT_PROJECT_STATUSES);
  });

  it('normalizeProjectPriorities zachowuje priorytety systemowe i wymusza domyślny priorytet', () => {
    const normalized = normalizeProjectPriorities([
      { id: 'strategic', label: 'Strategiczny', color: 'purple', order: 1, isDefault: true },
    ]);
    expect(normalized.map((p) => p.id)).toEqual([
      'low',
      'strategic',
      'normal',
      'high',
      'critical',
    ]);
    expect(getDefaultProjectPriorityId(normalized)).toBe('strategic');
    expect(normalizeProjectPriorities(null)).toEqual(DEFAULT_PROJECT_PRIORITIES);
  });

  it('resolveProjectStatus, resolveProjectPriority i isProjectStatusClosed obsługują pozycje niestandardowe oraz fallback', () => {
    const customStatuses = [
      ...DEFAULT_PROJECT_STATUSES,
      {
        id: 'cancelled',
        label: 'Anulowany',
        color: 'rose' as const,
        order: 5,
        isDefault: false,
        isClosed: true,
      },
      {
        id: 'warranty',
        label: 'Gwarancja',
        color: 'indigo' as const,
        order: 6,
        isDefault: false,
        isClosed: false,
      },
    ];
    const customPriorities = [
      ...DEFAULT_PROJECT_PRIORITIES,
      {
        id: 'urgent_vip',
        label: 'Pilny VIP',
        color: 'amber' as const,
        order: 5,
        isDefault: true,
      },
    ];

    expect(getDefaultProjectStatusId(customStatuses)).toBe('planning');
    expect(getDefaultProjectPriorityId(customPriorities)).toBe('urgent_vip');

    const resolvedCancelled = resolveProjectStatus('cancelled', customStatuses);
    expect(resolvedCancelled.label).toBe('Anulowany');
    expect(resolvedCancelled.isClosed).toBe(true);
    expect(resolvedCancelled.badgeClass).toContain('bg-rose-100');

    expect(isProjectStatusClosed('cancelled', customStatuses)).toBe(true);
    expect(isProjectStatusClosed('completed', customStatuses)).toBe(true);
    expect(isProjectStatusClosed('warranty', customStatuses)).toBe(false);
    expect(isProjectStatusClosed('active', customStatuses)).toBe(false);
    // Fallback bez listy słownika: tylko 'completed' jest końcowy
    expect(isProjectStatusClosed('completed', undefined)).toBe(true);
    expect(isProjectStatusClosed('cancelled', undefined)).toBe(false);

    const resolvedPriority = resolveProjectPriority('urgent_vip', customPriorities);
    expect(resolvedPriority.label).toBe('Pilny VIP');
    expect(resolvedPriority.order).toBe(5);

    const unknownStatus = resolveProjectStatus('legacy_status', customStatuses);
    expect(unknownStatus.label).toBe('legacy_status');
    expect(unknownStatus.isClosed).toBe(false);
  });

  it('slugifyProjectMetaId oraz paleta kolorów generują poprawne identyfikatory i klasy kontrastu', () => {
    expect(slugifyProjectMetaId('Wstrzymany przez urząd (Łódź)', 'st')).toBe(
      'wstrzymany_przez_urzad_lodz'
    );
    expect(slugifyProjectMetaId('!!!', 'status_x')).toBe('status_x');
    for (const def of PROJECT_META_PALETTE) {
      expect(getPaletteDef(def.key).badgeClass).toContain('dark:text-');
    }
    expect(getPaletteDef('nieznany').key).toBe('slate');
  });
});

describe('P76: Walidacja VAT 0% (ZW) i pustej wartości projektu (financeValidation)', () => {
  it('akceptuje stawkę VAT 0% oraz spójną kwotę brutto 10000 = 10000 i odrzuca 12300 przy 0%', () => {
    const okZeroVat = validateProjectFinanceFields({
      projectValue: 10000,
      projectValueGross: 10000,
      projectVatRate: 0,
    });
    expect(okZeroVat.ok).toBe(true);

    const okExemptCompany = validateProjectFinanceFields(
      {
        projectValue: 10000,
        projectValueGross: 10000,
        projectVatRate: 23,
      },
      null,
      { company: { vatPayer: false } }
    );
    expect(okExemptCompany.ok).toBe(true);

    const badZeroVatMismatch = validateProjectFinanceFields({
      projectValue: 10000,
      projectValueGross: 12300,
      projectVatRate: 0,
    });
    expect(badZeroVatMismatch.ok).toBe(false);
    expect(badZeroVatMismatch.field).toBe('projectValueGross');

    const okClearValue = validateProjectFinanceFields({
      projectValue: null,
      projectValueGross: null,
    });
    expect(okClearValue.ok).toBe(true);
  });
});

describe('P76: Parsowanie i normalizacja błędów formularzy (useFormSubmit helpers)', () => {
  it('parseApiErrorResponse wyciąga komunikat i pole z JSON oraz zwraca polskie komunikaty dla statusów HTTP bez JSON', async () => {
    const jsonErrRes = new Response(
      JSON.stringify({
        error: 'Numer projektu jest już zajęty.',
        field: 'key',
        itemType: 'project',
        itemId: 'p1',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
    expect(await parseApiErrorResponse(jsonErrRes)).toEqual({
      error: 'Numer projektu jest już zajęty.',
      field: 'key',
      itemType: 'project',
      itemId: 'p1',
    });

    const errorsArrayRes = new Response(JSON.stringify({ errors: ['Pole nazwa jest wymagane'] }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await parseApiErrorResponse(errorsArrayRes)).toEqual({
      error: 'Pole nazwa jest wymagane',
      field: undefined,
      itemType: undefined,
      itemId: undefined,
    });

    const html401 = new Response('<html>Unauthorized</html>', { status: 401 });
    expect((await parseApiErrorResponse(html401)).error).toContain('Sesja wygasła');

    const html403 = new Response('', { status: 403 });
    expect((await parseApiErrorResponse(html403)).error).toContain('Brak uprawnień');

    const html409 = new Response('', { status: 409 });
    expect((await parseApiErrorResponse(html409)).error).toContain('Konflikt danych');

    const html413 = new Response('', { status: 413 });
    expect((await parseApiErrorResponse(html413)).error).toContain('rozmiar');

    const html507 = new Response('', { status: 507 });
    expect((await parseApiErrorResponse(html507)).error).toContain('miejsca');

    const html500 = new Response('Internal Server Error', { status: 500 });
    expect((await parseApiErrorResponse(html500)).error).toContain('błąd serwera');
  });

  it('normalizeSubmitError tłumaczy błędy sieciowe Failed to fetch oraz zachowuje field', () => {
    expect(normalizeSubmitError(new TypeError('Failed to fetch'))).toEqual({
      error: 'Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.',
    });
    expect(normalizeSubmitError({ error: 'Błąd pola', field: 'projectValue' })).toEqual({
      error: 'Błąd pola',
      field: 'projectValue',
    });
    expect(normalizeSubmitError('Własny komunikat')).toEqual({ error: 'Własny komunikat' });
    expect(normalizeSubmitError(undefined, 'Domyślny błąd')).toEqual({ error: 'Domyślny błąd' });
  });
});
