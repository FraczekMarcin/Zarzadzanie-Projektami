import { describe, it, expect } from 'vitest';
import { getBusinessDaysRemaining, addBusinessDays, isBusinessDay } from '../utils/businessDays';
import { 
  getEasterSunday, 
  getCorpusChristi, 
  formatDateIso, 
  isPolishHoliday, 
  getPolishHolidaysForYear 
} from '../utils/polishHolidays';

describe('Polskie Święta Ustawowe i Dni Robocze', () => {
  it('oblicza Wielkanoc 2026 na 2026-04-05 oraz Boże Ciało 2026 na 2026-06-04', () => {
    const easter = getEasterSunday(2026);
    expect(formatDateIso(easter)).toBe('2026-04-05');

    const corpusChristi = getCorpusChristi(2026);
    expect(formatDateIso(corpusChristi)).toBe('2026-06-04');
  });

  it('poprawnie kwalifikuje 24.12.2026 i 25.12.2026 jako święta, a 26.12.2026 jako sobotę', () => {
    expect(isPolishHoliday('2026-12-24')).toBe(true);
    expect(isPolishHoliday('2026-12-25')).toBe(true);
    expect(isPolishHoliday('2026-12-26')).toBe(true);

    const boxingDayDate = new Date(2026, 11, 26, 12, 0, 0);
    // 6 = sobota
    expect(boxingDayDate.getDay()).toBe(6);
    // 26.12 nie jest dniem roboczym
    expect(isBusinessDay(boxingDayDate)).toBe(false);
  });

  it('pomija 11.11 (Święto Niepodległości) i zwraca dokładnie 2 dni robocze od 2026-11-09 do 2026-11-12', () => {
    // 2026-11-09: Poniedziałek
    // 2026-11-10: Wtorek (1 dzień roboczy)
    // 2026-11-11: Środa (Święto Niepodległości - wolne)
    // 2026-11-12: Czwartek (2. dzień roboczy - termin)
    const remaining = getBusinessDaysRemaining('2026-11-12', '2026-11-09');
    expect(remaining).toBe(2);
  });

  it('addBusinessDays dodaje dni robocze z pominięciem świąt i weekendów', () => {
    // Poniedziałek 2026-11-09 + 2 dni robocze = Czwartek 2026-11-12 (bo środa 11.11 to święto)
    const result = addBusinessDays('2026-11-09', 2);
    expect(result).toBe('2026-11-12');

    // Piątek 2026-05-01 (Święto Pracy) + 1 dzień roboczy = Poniedziałek 2026-05-04
    // (1.05 święto, 2.05 sobota, 3.05 święto/niedziela)
    const mayResult = addBusinessDays('2026-04-30', 1);
    expect(mayResult).toBe('2026-05-04');
  });

  it('obsługuje wszystkie stałe święta ustawowe', () => {
    expect(isPolishHoliday('2026-01-01')).toBe(true); // Nowy Rok
    expect(isPolishHoliday('2026-01-06')).toBe(true); // Trzech Króli
    expect(isPolishHoliday('2026-05-01')).toBe(true); // Święto Pracy
    expect(isPolishHoliday('2026-05-03')).toBe(true); // 3 Maja
    expect(isPolishHoliday('2026-08-15')).toBe(true); // Wniebowzięcie NMP
    expect(isPolishHoliday('2026-11-01')).toBe(true); // Wszystkich Świętych
    expect(isPolishHoliday('2026-11-11')).toBe(true); // Niepodległości
    expect(isPolishHoliday('2026-12-24')).toBe(true); // Wigilia (od 2025)
    expect(isPolishHoliday('2026-12-25')).toBe(true); // Boże Narodzenie 1
    expect(isPolishHoliday('2026-12-26')).toBe(true); // Boże Narodzenie 2

    // Zwykłe dni robocze nie są świętami
    expect(isPolishHoliday('2026-11-10')).toBe(false);
    expect(isPolishHoliday('2026-11-12')).toBe(false);
  });

  it('cachuje listę świąt dla roku w pamięci podręcznej', () => {
    const holidays1 = getPolishHolidaysForYear(2026);
    const holidays2 = getPolishHolidaysForYear(2026);
    expect(holidays1).toBe(holidays2); // ta sama referencja z cache
  });
});
