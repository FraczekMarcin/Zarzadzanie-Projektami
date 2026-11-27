import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEADLINE_TIMEZONE,
  DEFAULT_PROJECT_DEADLINE_SETTINGS,
  diffCalendarDays,
  evaluateProjectDeadline,
  formatPolishDays,
  formatProjectDeadlineRelative,
  getTodayIsoInTimezone,
  normalizeProjectDeadlineSettings,
  resolveDeadlineTimezone,
} from '../utils/deadlines.js';

describe('P78: Obliczanie licznika dni i progów ostrzeżeń terminów projektów', () => {
  it('poprawnie odmienia liczbę dni po polsku (1 dzień, 2 dni, 5 dni, 22 dni)', () => {
    expect(formatPolishDays(1)).toBe('1 dzień');
    expect(formatPolishDays(-1)).toBe('1 dzień');
    expect(formatPolishDays(0)).toBe('0 dni');
    expect(formatPolishDays(2)).toBe('2 dni');
    expect(formatPolishDays(3)).toBe('3 dni');
    expect(formatPolishDays(4)).toBe('4 dni');
    expect(formatPolishDays(5)).toBe('5 dni');
    expect(formatPolishDays(12)).toBe('12 dni');
    expect(formatPolishDays(22)).toBe('22 dni');
    expect(formatPolishDays(101)).toBe('101 dni');
  });

  it('formatuje etykietę względną dla dziś, jutra, przyszłości i przeterminowania', () => {
    expect(formatProjectDeadlineRelative(0)).toBe('dziś');
    expect(formatProjectDeadlineRelative(1)).toBe('jutro');
    expect(formatProjectDeadlineRelative(2)).toBe('za 2 dni');
    expect(formatProjectDeadlineRelative(5)).toBe('za 5 dni');
    expect(formatProjectDeadlineRelative(20)).toBe('za 20 dni');
    expect(formatProjectDeadlineRelative(-1)).toBe('1 dzień po terminie');
    expect(formatProjectDeadlineRelative(-2)).toBe('2 dni po terminie');
    expect(formatProjectDeadlineRelative(-5)).toBe('5 dni po terminie');
  });

  it('liczy różnice dni kalendarzowych bezpiecznie przez zmianę czasu (DST wiosna 23h i jesień 25h)', () => {
    // Zmiana czasu letniego w Polsce: 2026-03-29 (doba ma 23h)
    expect(diffCalendarDays('2026-03-30', '2026-03-28')).toBe(2);
    expect(diffCalendarDays('2026-03-29', '2026-03-28')).toBe(1);
    expect(diffCalendarDays('2026-03-29', '2026-03-30')).toBe(-1);

    // Powrót do czasu zimowego w Polsce: 2026-10-25 (doba ma 25h)
    expect(diffCalendarDays('2026-10-26', '2026-10-24')).toBe(2);
    expect(diffCalendarDays('2026-10-25', '2026-10-24')).toBe(1);
    expect(diffCalendarDays('2026-10-24', '2026-10-26')).toBe(-2);

    // Granica miesiąca i roku przestępnego
    expect(diffCalendarDays('2024-03-01', '2024-02-28')).toBe(2);
    expect(diffCalendarDays('2026-01-01', '2025-12-31')).toBe(1);

    // Niepoprawne daty
    expect(diffCalendarDays('2026-02-30', '2026-02-28')).toBeNull();
    expect(diffCalendarDays('invalid', '2026-05-01')).toBeNull();
  });

  it('wyznacza bieżącą datę według strefy czasowej z ustawień przypomnień (granica doby UTC vs Europe/Warsaw)', () => {
    // 2026-06-15T22:30:00Z to w Europe/Warsaw (UTC+2) już 2026-06-16 00:30
    const boundaryUtc = new Date('2026-06-15T22:30:00Z');
    expect(getTodayIsoInTimezone('UTC', boundaryUtc)).toBe('2026-06-15');
    expect(getTodayIsoInTimezone('Europe/Warsaw', boundaryUtc)).toBe('2026-06-16');
    expect(getTodayIsoInTimezone('America/New_York', boundaryUtc)).toBe('2026-06-15');

    // Niepoprawna strefa spada bezpiecznie na Europe/Warsaw
    expect(resolveDeadlineTimezone('Nieznana/Strefa')).toBe(DEFAULT_DEADLINE_TIMEZONE);
    expect(resolveDeadlineTimezone('')).toBe(DEFAULT_DEADLINE_TIMEZONE);
    expect(getTodayIsoInTimezone('Nieznana/Strefa', boundaryUtc)).toBe('2026-06-16');

    const evalWarsaw = evaluateProjectDeadline('2026-06-16', DEFAULT_PROJECT_DEADLINE_SETTINGS, {
      timezone: 'Europe/Warsaw',
      now: boundaryUtc,
    });
    expect(evalWarsaw.diffDays).toBe(0);
    expect(evalWarsaw.text).toBe('dziś');

    const evalUtc = evaluateProjectDeadline('2026-06-16', DEFAULT_PROJECT_DEADLINE_SETTINGS, {
      timezone: 'UTC',
      now: boundaryUtc,
    });
    expect(evalUtc.diffDays).toBe(1);
    expect(evalUtc.text).toBe('jutro');
  });

  it('ukrywa licznik i ostrzeżenia dla projektów zakończonych (isClosed) oraz wyłącza czerwone ostrzeżenia dla archiwalnych', () => {
    const closedEval = evaluateProjectDeadline('2026-05-01', DEFAULT_PROJECT_DEADLINE_SETTINGS, {
      todayIso: '2026-05-05',
      isClosed: true,
    });
    expect(closedEval.showCounter).toBe(false);
    expect(closedEval.text).toBeNull();
    expect(closedEval.isRed).toBe(false);
    expect(closedEval.shouldBlink).toBe(false);

    const archivedEval = evaluateProjectDeadline('2026-05-01', DEFAULT_PROJECT_DEADLINE_SETTINGS, {
      todayIso: '2026-05-05',
      isArchived: true,
    });
    expect(archivedEval.showCounter).toBe(true);
    expect(archivedEval.text).toBe('4 dni po terminie');
    expect(archivedEval.tone).toBe('normal');
    expect(archivedEval.isRed).toBe(false);
    expect(archivedEval.shouldBlink).toBe(false);
  });

  it('klasyfikuje progi ostrzeżeń (warnDays -> czerwony, <= criticalDays -> mruga) i respektuje blinkEnabled / userBlinkEnabled / reducedMotion', () => {
    const customSettings = { warnDays: 25, criticalDays: 5, blinkEnabled: true };

    // 26 dni przed terminem -> normalny (bez czerwieni i mrugania)
    const normalRes = evaluateProjectDeadline('2026-05-27', customSettings, {
      todayIso: '2026-05-01',
    });
    expect(normalRes.diffDays).toBe(26);
    expect(normalRes.text).toBe('za 26 dni');
    expect(normalRes.tone).toBe('normal');
    expect(normalRes.isRed).toBe(false);
    expect(normalRes.shouldBlink).toBe(false);

    // 25 dni (dokładnie próg warnDays) i 6 dni -> ostrzegawczy czerwony, BEZ mrugania
    for (const target of ['2026-05-26', '2026-05-07']) {
      const warnRes = evaluateProjectDeadline(target, customSettings, {
        todayIso: '2026-05-01',
      });
      expect(warnRes.tone).toBe('warning');
      expect(warnRes.isRed).toBe(true);
      expect(warnRes.shouldBlink).toBe(false);
      expect(warnRes.showStaticCritical).toBe(false);
    }

    // 5 dni (dokładnie próg criticalDays), dziś (0) i po terminie (-3) -> krytyczny z mruganiem
    for (const target of ['2026-05-06', '2026-05-01', '2026-04-28']) {
      const critRes = evaluateProjectDeadline(target, customSettings, {
        todayIso: '2026-05-01',
      });
      expect(critRes.tone).toBe('critical');
      expect(critRes.isRed).toBe(true);
      expect(critRes.shouldBlink).toBe(true);
      expect(critRes.showStaticCritical).toBe(false);
    }

    // Wyłączenie przez administratora (blinkEnabled: false) -> statyczne krytyczne obramowanie, bez mrugania
    const adminNoBlink = evaluateProjectDeadline(
      '2026-05-04',
      { warnDays: 30, criticalDays: 7, blinkEnabled: false },
      { todayIso: '2026-05-01' }
    );
    expect(adminNoBlink.tone).toBe('critical');
    expect(adminNoBlink.isRed).toBe(true);
    expect(adminNoBlink.shouldBlink).toBe(false);
    expect(adminNoBlink.showStaticCritical).toBe(true);

    // Wyłączenie przez użytkownika (oph_pref_deadline_blink = false) -> brak animacji
    const userNoBlink = evaluateProjectDeadline('2026-05-04', customSettings, {
      todayIso: '2026-05-01',
      userBlinkEnabled: false,
    });
    expect(userNoBlink.shouldBlink).toBe(false);
    expect(userNoBlink.showStaticCritical).toBe(true);

    // prefers-reduced-motion: reduce -> brak animacji, pozostaje statyczne ostrzeżenie
    const reducedRes = evaluateProjectDeadline('2026-05-04', customSettings, {
      todayIso: '2026-05-01',
      reducedMotion: true,
    });
    expect(reducedRes.shouldBlink).toBe(false);
    expect(reducedRes.showStaticCritical).toBe(true);
  });

  it('normalizuje ustawienia projectDeadline przy niepoprawnych lub granicznych danych', () => {
    expect(normalizeProjectDeadlineSettings(undefined)).toEqual(DEFAULT_PROJECT_DEADLINE_SETTINGS);
    expect(normalizeProjectDeadlineSettings({ warnDays: 10, criticalDays: 10 })).toEqual({
      warnDays: 10,
      criticalDays: 9,
      blinkEnabled: true,
    });
    expect(normalizeProjectDeadlineSettings({ warnDays: 500, criticalDays: -2, blinkEnabled: false })).toEqual({
      warnDays: 30,
      criticalDays: 7,
      blinkEnabled: false,
    });
  });
});
