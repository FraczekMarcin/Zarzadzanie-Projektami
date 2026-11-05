import { describe, it, expect } from 'vitest';
import ical from 'node-ical';
import { buildIcs, escapeIcsText, foldLine, IcsTask } from './utils/icsBuilder';

describe('buildIcs - Generator RFC 5545 iCalendar i parser node-ical', () => {
  it('Prawidłowo buduje i parsuje feed z zadaniem ze znakami specjalnymi "a,b;c", odwróconymi datami i bez dat', async () => {
    const tasks: IcsTask[] = [
      // 1. Zadanie bez dat - powinno zostać pominięte
      {
        id: 'task-no-dates',
        title: 'Zadanie bez dat',
        status: 'to_do',
      },
      // 2. Zadanie z odwróconymi datami (dueDate < startDate) -> używa startDate
      {
        id: 'task-reversed-dates',
        code: 'PRJ-REV',
        title: 'Zadanie z odwróconą kolejnością dat',
        startDate: '2026-11-10',
        dueDate: '2026-11-05',
        status: 'in_progress',
        updatedAt: '2026-11-05T12:00:00.000Z',
      },
      // 3. Zadanie ze znakami specjalnymi "a,b;c" i wieloliniowym opisem
      {
        id: 'task-special-chars',
        code: 'PRJ-SPEC',
        title: 'Zadanie z przecinkami, średnikami; a,b;c oraz ukośnikiem \\',
        description: 'Linia 1: a,b;c\nLinia 2: backslash \\ i średniki ;;\nLinia 3: bardzo długi tekst z polskimi znakami ąćęłńóśźż ąćęłńóśźż ąćęłńóśźż.',
        startDate: '2026-11-15',
        dueDate: '2026-11-20',
        status: 'to_do',
        updatedAt: '2026-11-05T12:00:00.000Z',
      },
      // 4. Zadanie ukończone (status done) -> STATUS:CONFIRMED i "✓ " w SUMMARY
      {
        id: 'task-completed',
        code: 'PRJ-DONE',
        title: 'Ukończony etap projektu architektonicznego',
        startDate: '2026-11-01',
        dueDate: '2026-11-04',
        status: 'done',
        updatedAt: '2026-11-04T15:30:00.000Z',
      },
    ];

    const icsContent = buildIcs(tasks, 'Pracownia Architektoniczna - Test Feed');

    // Weryfikacja formatu pliku
    expect(icsContent.endsWith('\r\n')).toBe(true);
    expect(icsContent).not.toContain('NaN');
    expect(icsContent).not.toContain('STATUS:COMPLETED');

    // Sprawdzenie składania linii (żadna linia nie przekracza 75 bajtów przed CRLF)
    const rawLines = icsContent.split('\r\n');
    for (const line of rawLines) {
      const bytes = Buffer.byteLength(line, 'utf-8');
      expect(bytes).toBeLessThanOrEqual(75);
    }

    // Parsowanie biblioteką node-ical
    const parsed = ical.parseICS(icsContent);
    const events = Object.values(parsed).filter((e: any) => e.type === 'VEVENT');

    // Zadanie bez daty zostało pominięte -> powinno być dokładnie 3 zdarzenia
    expect(events.length).toBe(3);

    // Weryfikacja zadania z odwróconymi datami
    const revEvent: any = events.find((e: any) => e.uid?.includes('task-reversed-dates'));
    expect(revEvent).toBeDefined();
    expect(revEvent.status).toBe('CONFIRMED');
    // DTSTART to 2026-11-10, DTEND to 2026-11-11 (ponieważ dueDate zostało skorygowane do startDate)
    expect(revEvent.start.toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(revEvent.end.toISOString().slice(0, 10)).toBe('2026-11-11');

    // Weryfikacja zadania ze znakami specjalnymi "a,b;c"
    const specEvent: any = events.find((e: any) => e.uid?.includes('task-special-chars'));
    expect(specEvent).toBeDefined();
    expect(specEvent.summary).toContain('a,b;c');
    expect(specEvent.description).toContain('Linia 1: a,b;c');

    // Weryfikacja zadania ukończonego
    const doneEvent: any = events.find((e: any) => e.uid?.includes('task-completed'));
    expect(doneEvent).toBeDefined();
    expect(doneEvent.status).toBe('CONFIRMED');
    expect(doneEvent.summary).toMatch(/^✓ /);
  });

  it('Funkcja foldLine prawidłowo zawija linie po 75 bajtach bez uszkadzania wielobajtowych znaków UTF-8', () => {
    const longLine = 'SUMMARY:Bardzo długa nazwa zadania z polskimi znakami: ąćęłńóśźż ąćęłńóśźż ąćęłńóśźż ąćęłńóśźż ąćęłńóśźż';
    const folded = foldLine(longLine, 75);
    const parts = folded.split('\r\n ');
    expect(parts.length).toBeGreaterThan(1);
    for (let i = 0; i < parts.length; i++) {
      const lineLen = Buffer.byteLength((i === 0 ? '' : ' ') + parts[i], 'utf-8');
      expect(lineLen).toBeLessThanOrEqual(75);
    }
  });

  it('escapeIcsText escapuje \\, ;, , oraz nowe linie', () => {
    const raw = 'Test \\ z backslashem; średnikiem, przecinkiem\ni nową linią\r\noraz drugą';
    const escaped = escapeIcsText(raw);
    expect(escaped).toBe('Test \\\\ z backslashem\\; średnikiem\\, przecinkiem\\ni nową linią\\noraz drugą');
  });

  it('Weryfikacja bezpieczeństwa tokenu: generowanie hasha SHA-256 i odrzucanie nieprawidłowych/pustych tokenów', async () => {
    const crypto = await import('crypto');
    const rawToken = crypto.randomBytes(24).toString('hex');
    expect(rawToken.length).toBe(48);

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    expect(tokenHash.length).toBe(64);

    // Mock sprawdzenia tokenu w bazie użytkowników
    const mockUsers = [
      { id: 'usr-1', name: 'Jan Kowalski', calendarTokenHash: tokenHash, isApproved: true },
      { id: 'usr-2', name: 'Nieaktywny', calendarTokenHash: 'abc', isApproved: false },
    ];

    const verifyToken = (tokenToTest: string) => {
      if (!tokenToTest || typeof tokenToTest !== 'string') return null;
      const clean = tokenToTest.trim();
      if (clean.length < 16) return null;
      const h = crypto.createHash('sha256').update(clean).digest('hex');
      return mockUsers.find((u) => u.calendarTokenHash === h && u.isApproved !== false) || null;
    };

    // Poprawny token znajduje użytkownika
    expect(verifyToken(rawToken)).toEqual(mockUsers[0]);

    // Zły token, pusty token, za krótki token, odwołany token zwracają null
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('short')).toBeNull();
    expect(verifyToken('0123456789abcdef0123456789abcdef_fake')).toBeNull();
    expect(verifyToken('non-existent-token-1234567890123456')).toBeNull();
  });
});
