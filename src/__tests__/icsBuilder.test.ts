import { describe, it, expect } from 'vitest';
import ical from 'node-ical';
import { buildIcs, escapeIcsText, foldLine, IcsTask } from '../utils/icsBuilder';
import { isPrivateOrLocalUrl } from '../utils/calendar';

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

  it('Używa polskich etykiet w DESCRIPTION, poprawnej odmiany dni oraz nazwy projektu i CATEGORIES', () => {
    const projects = new Map([
      ['prj-1', { id: 'prj-1', name: 'Osiedle Słoneczne, Etap I; II', key: 'OSL' }],
    ]);

    const tasks: IcsTask[] = [
      {
        id: 'task-1d',
        projectId: 'prj-1',
        title: 'Zadanie 1-dniowe',
        priority: 'normal',
        status: 'to_do',
        durationDays: 1,
        startDate: '2026-11-10',
        dueDate: '2026-11-10',
        updatedAt: '2026-11-05T12:00:00.000Z',
      },
      {
        id: 'task-2d',
        projectId: 'prj-1',
        title: 'Zadanie 2-dniowe',
        priority: 'high',
        status: 'in_progress',
        durationDays: 2,
        startDate: '2026-11-11',
        dueDate: '2026-11-12',
        updatedAt: '2026-11-05T12:00:00.000Z',
      },
      {
        id: 'task-5d',
        projectId: 'prj-1',
        title: 'Zadanie 5-dniowe',
        priority: 'critical',
        status: 'review',
        durationDays: 5,
        startDate: '2026-11-13',
        dueDate: '2026-11-17',
        updatedAt: '2026-11-05T12:00:00.000Z',
      },
    ];

    const ics = buildIcs(tasks, 'Test PL', { projects });
    const parsed = ical.parseICS(ics);
    const events = Object.values(parsed).filter((e: any) => e.type === 'VEVENT') as any[];

    const ev1 = events.find((e) => e.uid.includes('task-1d'));
    const ev2 = events.find((e) => e.uid.includes('task-2d'));
    const ev5 = events.find((e) => e.uid.includes('task-5d'));

    expect(ev1.description).toContain('Projekt: Osiedle Słoneczne, Etap I; II');
    expect(ev1.description).toContain('Priorytet: Normalny');
    expect(ev1.description).toContain('Status: Do zrobienia');
    expect(ev1.description).toContain('1 dzień');
    expect(ev1.categories).toContain('Osiedle Słoneczne, Etap I; II');

    expect(ev2.description).toContain('Priorytet: Wysoki (P2)');
    expect(ev2.description).toContain('Status: W toku');
    expect(ev2.description).toContain('2 dni');

    expect(ev5.description).toContain('Priorytet: Krytyczny (P1)');
    expect(ev5.description).toContain('Status: Do weryfikacji');
    expect(ev5.description).toContain('5 dni');
  });

  it('Emituje LAST-MODIFIED, SEQUENCE, STATUS:CANCELLED oraz URL z publicBaseUrl bez tokenu', () => {
    const tasks: IcsTask[] = [
      {
        id: 'tsk-active',
        title: 'Aktywne zadanie',
        status: 'in_progress',
        revision: 4,
        startDate: '2026-11-10',
        dueDate: '2026-11-11',
        updatedAt: '2026-11-08T09:15:30.000Z',
      },
      {
        id: 'tsk-cancelled',
        title: 'Anulowane zadanie',
        status: 'cancelled',
        revision: 1,
        startDate: '2026-11-12',
        dueDate: '2026-11-12',
        updatedAt: '2026-11-09T10:00:00.000Z',
      },
    ];

    const ics = buildIcs(tasks, 'Feed URL', {
      publicBaseUrl: 'https://kalendarz.pracownia.pl/',
    });

    expect(ics).toContain('LAST-MODIFIED:20261108T091530Z');
    expect(ics).toContain('SEQUENCE:3');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('STATUS:CANCELLED');

    const parsed = ical.parseICS(ics);
    const events = Object.values(parsed).filter((e: any) => e.type === 'VEVENT') as any[];

    const active = events.find((e) => e.uid.includes('tsk-active'));
    const cancelled = events.find((e) => e.uid.includes('tsk-cancelled'));

    expect(active.status).toBe('CONFIRMED');
    expect(Number(active.sequence)).toBe(3);
    expect(active.lastmodified).toBeInstanceOf(Date);
    expect(active.lastmodified.toISOString()).toBe('2026-11-08T09:15:30.000Z');
    expect(active.url).toBe('https://kalendarz.pracownia.pl/?task=tsk-active');
    expect(active.description).toContain('https://kalendarz.pracownia.pl/?task=tsk-active');

    expect(cancelled.status).toBe('CANCELLED');
    expect(Number(cancelled.sequence)).toBe(0);
    expect(cancelled.description).toContain('Status: Anulowane');
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

  it('isPrivateOrLocalUrl poprawnie klasyfikuje adresy prywatne, lokalne, http:// i publiczne https://', () => {
    expect(isPrivateOrLocalUrl('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalUrl('https://10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalUrl('192.168.1.10')).toBe(true);
    expect(isPrivateOrLocalUrl('https://192.168.1.10:8443')).toBe(true);
    expect(isPrivateOrLocalUrl('172.20.1.1')).toBe(true);
    expect(isPrivateOrLocalUrl('https://172.20.1.1')).toBe(true);
    expect(isPrivateOrLocalUrl('localhost')).toBe(true);
    expect(isPrivateOrLocalUrl('http://localhost:3000')).toBe(true);
    expect(isPrivateOrLocalUrl('serwer')).toBe(true);
    expect(isPrivateOrLocalUrl('https://serwer')).toBe(true);
    expect(isPrivateOrLocalUrl('serwer.local')).toBe(true);
    expect(isPrivateOrLocalUrl('https://serwer.local')).toBe(true);
    expect(isPrivateOrLocalUrl('http://example.com')).toBe(true);
    expect(isPrivateOrLocalUrl('https://kalendarz.example.com')).toBe(false);
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
