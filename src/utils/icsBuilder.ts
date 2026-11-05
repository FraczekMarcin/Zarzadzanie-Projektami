/**
 * Generator feedu iCalendar zgodny ze specyfikacją RFC 5545
 */

export interface IcsTask {
  id: string;
  projectId?: string;
  code?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  assigneeId?: string;
  reporterId?: string;
  startDate?: string;
  dueDate?: string;
  durationDays?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Sprawdza czy ciąg jest poprawną datą YYYY-MM-DD
 */
export function isValidDateStr(s?: string): boolean {
  if (!s || typeof s !== 'string') return false;
  const clean = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return false;
  const d = new Date(clean + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

/**
 * Zwraca datę kolejnego dnia w formacie YYYYMMDD (do DTEND dla całodniowych zdarzeń RFC 5545)
 */
export function getNextDayDateStr(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Konwertuje datę/timestamp na format UTC YYYYMMDDTHHMMSSZ dla DTSTAMP
 */
export function toIcsUtcTimestamp(dateInput?: string | number | Date): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const valid = !isNaN(d.getTime()) ? d : new Date();
  const iso = valid.toISOString(); // np. 2026-11-05T18:00:00.000Z
  return iso.replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Escapowanie znaków specjalnych dla pól tekstowych RFC 5545 (TEXT):
 * Kolejność: backslash (\), średnik (;), przecinek (,), nowa linia (\n)
 */
export function escapeIcsText(str?: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/**
 * Składanie długiej linii (line folding) zgodnie z RFC 5545 sekcja 3.1:
 * Maksymalnie 75 oktetów (bajtów UTF-8) w jednej linii, kontynuacja zaczyna się od CRLF + spacja.
 */
export function foldLine(line: string, maxBytes = 75): string {
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(line)
    : Buffer.from(line, 'utf-8');

  if (bytes.length <= maxBytes) {
    return line;
  }

  const decodeChunk = (chunk: Uint8Array) => {
    return typeof TextDecoder !== 'undefined'
      ? new TextDecoder('utf-8').decode(chunk)
      : Buffer.from(chunk).toString('utf-8');
  };

  const chunks: string[] = [];
  let curBuf = bytes;
  let isFirst = true;

  while (curBuf.length > 0) {
    const limit = isFirst ? maxBytes : (maxBytes - 1); // 1 bajt zarezerwowany na spację kontynuacji
    if (curBuf.length <= limit) {
      chunks.push(decodeChunk(curBuf));
      break;
    }

    // Bezpieczne dzielenie znaków UTF-8 (nie przecinaj bajtów wielobajtowego znaku)
    let splitIdx = limit;
    while (splitIdx > 0 && (curBuf[splitIdx] & 0xc0) === 0x80) {
      splitIdx--;
    }
    if (splitIdx === 0) {
      splitIdx = limit;
    }

    chunks.push(decodeChunk(curBuf.subarray(0, splitIdx)));
    curBuf = curBuf.subarray(splitIdx);
    isFirst = false;
  }

  return chunks.join('\r\n ');
}

/**
 * Jedna wspólna funkcja budująca feed RFC 5545 dla dowolnej listy zadań i nazwy kalendarza.
 */
export function buildIcs(tasks: IcsTask[], calendarName: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zarzadzanie Projektami//PL//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName || 'Zarządzanie Projektami')}`,
    'X-WR-TIMEZONE:Europe/Warsaw',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];

  for (const t of tasks || []) {
    const hasStart = isValidDateStr(t.startDate);
    const hasDue = isValidDateStr(t.dueDate);

    // Wymóg 2: Pomijaj zadania bez poprawnej daty
    if (!hasStart && !hasDue) {
      continue;
    }

    let start = hasStart ? (t.startDate as string) : (t.dueDate as string);
    let due = hasDue ? (t.dueDate as string) : (t.startDate as string);

    // Wymóg 2: dueDate < startDate -> użyj startDate
    if (due < start) {
      due = start;
    }

    const dtStart = start.replace(/-/g, '');
    const dtEnd = getNextDayDateStr(due);
    const dtStamp = toIcsUtcTimestamp(t.updatedAt || t.createdAt);

    // Wymóg 3: Ukończone: STATUS:CONFIRMED i "✓ " w SUMMARY
    const isDone = t.status === 'done';
    const checkPrefix = isDone ? '✓ ' : '';
    const codePart = t.code ? `[${t.code}] ` : '';
    const rawSummary = `${checkPrefix}${codePart}${t.title || 'Zadanie'}`;
    const summary = escapeIcsText(rawSummary);

    const descParts = [
      `Priorytet: ${t.priority || 'Normalny'}`,
      `Status: ${t.status || 'W toku'}`,
      `Czas: ${t.durationDays || 1} dni`,
    ];
    if (t.description) {
      descParts.push(t.description);
    }
    const description = escapeIcsText(descParts.join('\n'));

    // Wymóg 4: UID stabilny
    const uid = `${t.id || 'tsk-' + Math.random().toString(36).substring(2, 8)}@zarzadzanierp.local`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:${description}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('CLASS:PUBLIC');
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // Wymóg 4: Składanie linii po 75 oktetach, plik kończy się CRLF
  const foldedLines = lines.map((l) => foldLine(l, 75));
  return foldedLines.join('\r\n') + '\r\n';
}
