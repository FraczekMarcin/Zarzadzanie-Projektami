/**
 * Polish Statutory Public Holidays (Polskie Święta Ustawowe Wolne od Pracy)
 *
 * Obsługuje:
 * - Stałe: 1.01, 6.01, 1.05, 3.05, 15.08, 1.11, 11.11, 24.12 (od 2025 r.), 25.12, 26.12
 * - Ruchome: Wielkanoc (Meeus/Jones/Butcher), Poniedziałek Wielkanocny (+1d),
 *   Zielone Świątki (+49d), Boże Ciało (+60d)
 *
 * Wyniki są cachowane per rok.
 */

const holidaysCache = new Map<number, Set<string>>();

/**
 * Calculates Easter Sunday for a given Gregorian year using the Meeus/Jones/Butcher algorithm.
 */
export function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Calculates Corpus Christi (Boże Ciało, 60 days after Easter Sunday).
 */
export function getCorpusChristi(year: number): Date {
  const easter = getEasterSunday(year);
  const corpus = new Date(easter.getTime());
  corpus.setDate(corpus.getDate() + 60);
  return corpus;
}

/**
 * Helper to format date as YYYY-MM-DD
 */
export function formatDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns set of holiday date strings 'YYYY-MM-DD' for a given year (cached).
 */
export function getPolishHolidaysForYear(year: number): Set<string> {
  const cached = holidaysCache.get(year);
  if (cached) return cached;

  const holidays = new Set<string>();
  const pad = (n: number) => String(n).padStart(2, '0');
  const addHoliday = (m: number, d: number) => {
    holidays.add(`${year}-${pad(m)}-${pad(d)}`);
  };

  // 1. Stałe święta ustawowe
  addHoliday(1, 1);   // Nowy Rok / Świętej Bożej Rodzicielki
  addHoliday(1, 6);   // Trzech Króli (Objawienie Pańskie)
  addHoliday(5, 1);   // Święto Państwowe / Święto Pracy
  addHoliday(5, 3);   // Święto Narodowe Trzeciego Maja
  addHoliday(8, 15);  // Wniebowzięcie Najświętszej Maryi Panny / Święto Wojska Polskiego
  addHoliday(11, 1);  // Wszystkich Świętych
  addHoliday(11, 11); // Narodowe Święto Niepodległości

  // 24.12 - Wigilia Bożego Narodzenia (ustawowy dzień wolny od pracy od 2025 r.)
  if (year >= 2025) {
    addHoliday(12, 24);
  }

  addHoliday(12, 25); // Pierwszy dzień Bożego Narodzenia
  addHoliday(12, 26); // Drugi dzień Bożego Narodzenia

  // 2. Ruchome święta wielkanocne
  const easter = getEasterSunday(year);
  holidays.add(formatDateIso(easter)); // Niedziela Wielkanocna

  const easterMonday = new Date(easter.getTime());
  easterMonday.setDate(easterMonday.getDate() + 1);
  holidays.add(formatDateIso(easterMonday)); // Poniedziałek Wielkanocny

  const pentecost = new Date(easter.getTime());
  pentecost.setDate(pentecost.getDate() + 49);
  holidays.add(formatDateIso(pentecost)); // Zielone Świątki (Niedziela)

  const corpusChristi = new Date(easter.getTime());
  corpusChristi.setDate(corpusChristi.getDate() + 60);
  holidays.add(formatDateIso(corpusChristi)); // Boże Ciało (Czwartek)

  holidaysCache.set(year, holidays);
  return holidays;
}

/**
 * Checks if a given Date or ISO date string (YYYY-MM-DD) is a statutory Polish public holiday.
 */
export function isPolishHoliday(date: Date | string): boolean {
  if (!date) return false;
  let year: number;
  let dateKey: string;

  if (typeof date === 'string') {
    const parts = date.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return false;
    year = parts[0];
    dateKey = `${year}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
  } else {
    year = date.getFullYear();
    dateKey = formatDateIso(date);
  }

  const holidays = getPolishHolidaysForYear(year);
  return holidays.has(dateKey);
}
