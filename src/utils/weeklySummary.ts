import type { Project, Task, User } from '../types/index.js';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels.js';
import { escapeHtml, isValidIanaTimezone, localDateString } from './reminders.js';

export interface WeeklySummarySettings {
  enabled: boolean;
  dayOfWeek: number; // 1 (poniedziałek) .. 7 (niedziela)
  time: string; // 'HH:MM'
  timezone: string; // IANA, np. 'Europe/Warsaw' (wspólna z reminders.timezone)
  windowDays: 7 | 14;
  includeAdmins: boolean;
  maxItemsPerProject: number; // 5..50
  appBaseUrl?: string;
}

export interface PersistedWeeklySummaryState {
  lastSentWeekKey: string | null;
  lastRunAt: string | null;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
  sentUserIdsWeekKey: string | null;
  sentUserIdsThisWeek: string[];
}

export interface WeeklySummaryTaskItem {
  id: string;
  code: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  assigneeId?: string;
  assigneeName: string;
  diffDays: number;
  daysOverdue: number;
}

export interface WeeklySummaryProjectSection {
  projectId: string;
  projectKey: string;
  projectName: string;
  openCount: number;
  overdueCount: number;
  upcomingCount: number;
  overdueItems: WeeklySummaryTaskItem[];
  overdueOverflow: number;
  upcomingItems: WeeklySummaryTaskItem[];
  upcomingOverflow: number;
}

export interface WeeklySummaryCleanProject {
  projectId: string;
  projectKey: string;
  projectName: string;
  openCount: number;
}

export interface UserWeeklySummary {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  weekKey: string;
  date: string;
  timezone: string;
  windowDays: 7 | 14;
  maxItemsPerProject: number;
  totalOpen: number;
  totalOverdue: number;
  totalUpcoming: number;
  projects: WeeklySummaryProjectSection[];
  cleanProjects: WeeklySummaryCleanProject[];
}

export interface WeeklyTargetWindow {
  weekKey: string;
  scheduledAtMs: number;
  elapsedMs: number;
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SIMPLE_EMAIL_REGEX = /^[^\s@<>()[\]\\,;:\"]+@[^\s@<>()[\]\\,;:\"]+\.[^\s@<>()[\]\\,;:\"]+$/;
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  medium: 2,
  low: 3,
};

export const WEEKLY_DAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Poniedziałek' },
  { value: 2, label: 'Wtorek' },
  { value: 3, label: 'Środa' },
  { value: 4, label: 'Czwartek' },
  { value: 5, label: 'Piątek' },
  { value: 6, label: 'Sobota' },
  { value: 7, label: 'Niedziela' },
];

export const WEEKLY_MIN_ITEMS_PER_PROJECT = 5;
export const WEEKLY_MAX_ITEMS_PER_PROJECT = 50;

function toDate(now: Date | number): Date {
  return now instanceof Date ? now : new Date(now);
}

function resolveTimezone(timezone?: string): string {
  return timezone && isValidIanaTimezone(timezone) ? timezone.trim() : 'Europe/Warsaw';
}

export function parseTimeHHMM(raw: unknown): { hour: number; minute: number; formatted: string } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  return {
    hour,
    minute,
    formatted: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export function normalizeEnvTimeHHMM(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDateOnlyUtcMs(dateStr: unknown): number | null {
  if (typeof dateStr !== 'string' || !DATE_ONLY_REGEX.test(dateStr)) return null;
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.getTime();
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoWeekday: number; // 1..7
}

function getLocalDateTimeParts(now: Date | number, timezone: string): LocalDateTimeParts {
  const safeTz = resolveTimezone(timezone);
  const d = toDate(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');
  const rawHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const hour = ((rawHour % 24) + 24) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const isoWeekday = utcDate.getUTCDay() || 7;

  return { year, month, day, hour, minute, isoWeekday };
}

/**
 * Konwertuje lokalną datę (YYYY-MM-DD) i godzinę (HH:MM) w podanej strefie IANA na timestamp UTC,
 * uwzględniając przejścia DST (pominięta godzina -> pierwszy ważny moment po zmianie;
 * powtórzona godzina -> pierwsze wystąpienie).
 */
function resolveLocalDateTimeMs(
  year: number,
  month: number,
  day: number,
  targetHour: number,
  targetMinute: number,
  timezone: string
): number {
  const safeTz = resolveTimezone(timezone);
  const targetDayUtc = Date.UTC(year, month - 1, day);
  const targetUtcAsSame = Date.UTC(year, month - 1, day, targetHour, targetMinute, 0, 0);

  let guess = targetUtcAsSame;
  for (let i = 0; i < 3; i++) {
    const p = getLocalDateTimeParts(guess, safeTz);
    const localDayUtc = Date.UTC(p.year, p.month - 1, p.day);
    const localMinutes = (localDayUtc - targetDayUtc) / MS_PER_MINUTE + p.hour * 60 + p.minute;
    const desiredMinutes = targetHour * 60 + targetMinute;
    const diffMinutes = localMinutes - desiredMinutes;
    if (diffMinutes === 0) {
      // Jeśli to powtórzona godzina przy cofnięciu czasu (DST fall-back), wybierz wcześniejsze wystąpienie
      const earlier = guess - MS_PER_HOUR;
      const ep = getLocalDateTimeParts(earlier, safeTz);
      if (
        ep.year === year &&
        ep.month === month &&
        ep.day === day &&
        ep.hour === targetHour &&
        ep.minute === targetMinute
      ) {
        return earlier;
      }
      return guess;
    }
    guess -= diffMinutes * MS_PER_MINUTE;
  }

  // W przypadku pominiętej godziny podczas zmiany czasu na letni znajdź pierwszy moment >= docelowego czasu
  const targetTotalMinutes = targetHour * 60 + targetMinute;
  let lo = targetUtcAsSame - 15 * MS_PER_HOUR;
  let hi = targetUtcAsSame + 15 * MS_PER_HOUR;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / (2 * MS_PER_MINUTE)) * MS_PER_MINUTE;
    const p = getLocalDateTimeParts(mid, safeTz);
    const localDayUtc = Date.UTC(p.year, p.month - 1, p.day);
    const localMinutes = (localDayUtc - targetDayUtc) / MS_PER_MINUTE + p.hour * 60 + p.minute;
    if (localMinutes >= targetTotalMinutes) {
      hi = mid;
    } else {
      lo = mid + MS_PER_MINUTE;
    }
  }
  return lo;
}

function addUtcDaysToParts(year: number, month: number, day: number, deltaDays: number): {
  year: number;
  month: number;
  day: number;
  isoWeekday: number;
} {
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    isoWeekday: dt.getUTCDay() || 7,
  };
}

/**
 * Zwraca klucz tygodnia ISO 8601 w formacie 'RRRR-Www' dla lokalnej daty w podanej strefie czasowej.
 */
export function isoWeekKey(now: Date | number, timezone: string = 'Europe/Warsaw'): string {
  const safeTz = resolveTimezone(timezone);
  const { year, month, day } = getLocalDateTimeParts(now, safeTz);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  // Przesuń na czwartek bieżącego tygodnia ISO (wyznacza rok ISO)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

function normalizeWeeklySettings(settings: WeeklySummarySettings): {
  enabled: boolean;
  dayOfWeek: number;
  hour: number;
  minute: number;
  timeFormatted: string;
  timezone: string;
  windowDays: 7 | 14;
  includeAdmins: boolean;
  maxItemsPerProject: number;
} {
  const parsedTime = parseTimeHHMM(settings.time) ?? { hour: 8, minute: 0, formatted: '08:00' };
  const rawDay = Number(settings.dayOfWeek);
  const dayOfWeek = Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 7 ? rawDay : 1;
  const windowDays: 7 | 14 = Number(settings.windowDays) === 14 ? 14 : 7;
  const rawMax = Number(settings.maxItemsPerProject);
  const maxItemsPerProject = Number.isInteger(rawMax)
    ? Math.min(WEEKLY_MAX_ITEMS_PER_PROJECT, Math.max(WEEKLY_MIN_ITEMS_PER_PROJECT, rawMax))
    : 15;

  return {
    enabled: Boolean(settings.enabled),
    dayOfWeek,
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    timeFormatted: parsedTime.formatted,
    timezone: resolveTimezone(settings.timezone),
    windowDays,
    includeAdmins: settings.includeAdmins !== false,
    maxItemsPerProject,
  };
}

/**
 * Zwraca najbardziej aktualne okno wysyłki tygodniowej (jeśli mieścimy się w oknie do 24h po terminie),
 * wraz z kluczem tygodnia ISO samego zaplanowanego terminu.
 */
export function findTargetWeeklyWindow(
  now: Date | number,
  settings: WeeklySummarySettings
): WeeklyTargetWindow | null {
  const norm = normalizeWeeklySettings(settings);
  if (!norm.enabled) return null;

  const nowMs = toDate(now).getTime();
  const localNow = getLocalDateTimeParts(nowMs, norm.timezone);

  for (let offset = 0; offset >= -2; offset--) {
    const candidateDay = addUtcDaysToParts(localNow.year, localNow.month, localNow.day, offset);
    if (candidateDay.isoWeekday !== norm.dayOfWeek) continue;

    const scheduledAtMs = resolveLocalDateTimeMs(
      candidateDay.year,
      candidateDay.month,
      candidateDay.day,
      norm.hour,
      norm.minute,
      norm.timezone
    );

    const elapsedMs = nowMs - scheduledAtMs;
    if (elapsedMs >= 0 && elapsedMs <= MS_PER_DAY) {
      return {
        weekKey: isoWeekKey(scheduledAtMs, norm.timezone),
        scheduledAtMs,
        elapsedMs,
      };
    }
  }

  return null;
}

/**
 * Sprawdza, czy podsumowanie tygodniowe powinno zostać wysłane w danym momencie:
 * wysyła w wybranym dniu tygodnia po godzinie wysyłki i nadrabia zaległość do 24h po terminie.
 */
export function shouldRunWeeklyNow(
  now: Date | number,
  settings: WeeklySummarySettings,
  lastSentWeekKey?: string | null
): boolean {
  const target = findTargetWeeklyWindow(now, settings);
  if (!target) return false;
  if (lastSentWeekKey && lastSentWeekKey >= target.weekKey) {
    return false;
  }
  return true;
}

/**
 * Zwraca następny zaplanowany termin wysyłki w ISO UTC (lub null gdy wyłączone).
 * Prawidłowo uwzględnia zmiany czasu DST w podanej strefie czasowej.
 */
export function nextWeeklyRun(
  now: Date | number,
  settings: WeeklySummarySettings,
  lastSentWeekKey?: string | null
): string | null {
  const norm = normalizeWeeklySettings(settings);
  if (!norm.enabled) return null;

  const nowMs = toDate(now).getTime();
  const localNow = getLocalDateTimeParts(nowMs, norm.timezone);

  for (let offset = 0; offset <= 14; offset++) {
    const candidateDay = addUtcDaysToParts(localNow.year, localNow.month, localNow.day, offset);
    if (candidateDay.isoWeekday !== norm.dayOfWeek) continue;

    const scheduledAtMs = resolveLocalDateTimeMs(
      candidateDay.year,
      candidateDay.month,
      candidateDay.day,
      norm.hour,
      norm.minute,
      norm.timezone
    );

    if (scheduledAtMs <= nowMs) continue;

    const weekKey = isoWeekKey(scheduledAtMs, norm.timezone);
    if (lastSentWeekKey && lastSentWeekKey >= weekKey) {
      continue;
    }

    return new Date(scheduledAtMs).toISOString();
  }

  return null;
}

function compareOverdueTasks(a: WeeklySummaryTaskItem, b: WeeklySummaryTaskItem): number {
  if (a.diffDays !== b.diffDays) {
    return a.diffDays - b.diffDays; // Najbardziej ujemne (najbardziej zaległe) pierwsze
  }
  const rankA = PRIORITY_RANK[a.priority] ?? 99;
  const rankB = PRIORITY_RANK[b.priority] ?? 99;
  if (rankA !== rankB) return rankA - rankB;
  return (a.code || a.title).localeCompare(b.code || b.title, 'pl');
}

function compareUpcomingTasks(a: WeeklySummaryTaskItem, b: WeeklySummaryTaskItem): number {
  if (a.diffDays !== b.diffDays) {
    return a.diffDays - b.diffDays; // Najbliższy termin pierwszy (0, 1, 2, ...)
  }
  const rankA = PRIORITY_RANK[a.priority] ?? 99;
  const rankB = PRIORITY_RANK[b.priority] ?? 99;
  if (rankA !== rankB) return rankA - rankB;
  return (a.code || a.title).localeCompare(b.code || b.title, 'pl');
}

/**
 * Buduje tygodniowe podsumowanie dla uprawnionych kierowników projektów (i opcjonalnie administratorów)
 * ze wszystkich niezarchiwizowanych projektów.
 */
export function buildWeeklySummary(
  tasks: Task[],
  projects: Project[],
  users: User[],
  now: Date | number,
  settings: WeeklySummarySettings
): UserWeeklySummary[] {
  const norm = normalizeWeeklySettings(settings);
  const todayStr = localDateString(now, norm.timezone);
  const todayUtcMs = parseDateOnlyUtcMs(todayStr);
  if (todayUtcMs === null) return [];

  const weekKey = isoWeekKey(now, norm.timezone);

  const userNameMap = new Map<string, string>();
  for (const u of users || []) {
    if (!u || !u.id) continue;
    userNameMap.set(u.id, (u.name || u.email || '').trim());
  }

  const eligibleRecipients: Array<{ id: string; name: string; email: string; role: string }> = [];
  for (const u of users || []) {
    if (!u || !u.id) continue;
    if (u.isApproved === false) continue;
    if (u.weeklySummary === false) continue;

    const roleOk = u.role === 'project_manager' || (norm.includeAdmins && u.role === 'admin');
    if (!roleOk) continue;

    const cleanEmail = typeof u.email === 'string' ? u.email.trim() : '';
    if (!cleanEmail || !SIMPLE_EMAIL_REGEX.test(cleanEmail)) continue;

    eligibleRecipients.push({
      id: u.id,
      name: (u.name || cleanEmail).trim(),
      email: cleanEmail,
      role: u.role,
    });
  }

  if (eligibleRecipients.length === 0) {
    return [];
  }

  const activeProjects = (projects || []).filter((p) => p && p.id && !p.isArchived);
  const tasksByProject = new Map<string, Task[]>();
  for (const p of activeProjects) {
    tasksByProject.set(p.id, []);
  }

  for (const t of tasks || []) {
    if (!t || !t.id) continue;
    if ((t.status as string) === 'done' || (t.status as string) === 'cancelled') continue;
    const bucket = tasksByProject.get(t.projectId);
    if (!bucket) continue;
    if (parseDateOnlyUtcMs(t.dueDate) === null) continue;
    bucket.push(t);
  }

  const projectSections: WeeklySummaryProjectSection[] = [];
  const cleanProjects: WeeklySummaryCleanProject[] = [];
  let totalOpen = 0;
  let totalOverdue = 0;
  let totalUpcoming = 0;

  for (const proj of activeProjects) {
    const projTasks = tasksByProject.get(proj.id) || [];
    const openCount = projTasks.length;
    totalOpen += openCount;

    const allOverdue: WeeklySummaryTaskItem[] = [];
    const allUpcoming: WeeklySummaryTaskItem[] = [];

    for (const t of projTasks) {
      const dueMs = parseDateOnlyUtcMs(t.dueDate);
      if (dueMs === null) continue;
      const diffDays = Math.round((dueMs - todayUtcMs) / MS_PER_DAY);
      const assigneeId = typeof t.assigneeId === 'string' && t.assigneeId.trim() ? t.assigneeId.trim() : undefined;
      const resolvedAssignee = assigneeId ? userNameMap.get(assigneeId) : '';
      const assigneeName = resolvedAssignee || 'nieprzypisane';

      const item: WeeklySummaryTaskItem = {
        id: t.id,
        code: t.code || '',
        title: t.title || '(Bez tytułu)',
        dueDate: t.dueDate,
        priority: t.priority || 'normal',
        status: t.status || 'to_do',
        ...(assigneeId ? { assigneeId } : {}),
        assigneeName,
        diffDays,
        daysOverdue: diffDays < 0 ? Math.abs(diffDays) : 0,
      };

      if (diffDays < 0) {
        allOverdue.push(item);
      } else if (diffDays >= 0 && diffDays <= norm.windowDays) {
        allUpcoming.push(item);
      }
    }

    totalOverdue += allOverdue.length;
    totalUpcoming += allUpcoming.length;

    if (allOverdue.length === 0 && allUpcoming.length === 0) {
      cleanProjects.push({
        projectId: proj.id,
        projectKey: proj.key || '',
        projectName: proj.name || '',
        openCount,
      });
      continue;
    }

    allOverdue.sort(compareOverdueTasks);
    allUpcoming.sort(compareUpcomingTasks);

    const overdueItems = allOverdue.slice(0, norm.maxItemsPerProject);
    const overdueOverflow = Math.max(0, allOverdue.length - norm.maxItemsPerProject);
    const upcomingItems = allUpcoming.slice(0, norm.maxItemsPerProject);
    const upcomingOverflow = Math.max(0, allUpcoming.length - norm.maxItemsPerProject);

    projectSections.push({
      projectId: proj.id,
      projectKey: proj.key || '',
      projectName: proj.name || '',
      openCount,
      overdueCount: allOverdue.length,
      upcomingCount: allUpcoming.length,
      overdueItems,
      overdueOverflow,
      upcomingItems,
      upcomingOverflow,
    });
  }

  return eligibleRecipients.map((recipient) => ({
    user: recipient,
    weekKey,
    date: todayStr,
    timezone: norm.timezone,
    windowDays: norm.windowDays,
    maxItemsPerProject: norm.maxItemsPerProject,
    totalOpen,
    totalOverdue,
    totalUpcoming,
    projects: projectSections,
    cleanProjects,
  }));
}

function normalizeSafeBaseUrl(rawUrl?: string): string {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function formatOverdueDaysPl(days: number): string {
  return days === 1 ? '1 dzień opóźnienia' : `${days} dni opóźnienia`;
}

export function renderWeeklySummaryEmail(
  summary: UserWeeklySummary,
  appBaseUrl?: string
): { subject: string; text: string; html: string } {
  const cleanBaseUrl = normalizeSafeBaseUrl(appBaseUrl);
  const subject = `Podsumowanie tygodnia: ${summary.totalOverdue} zaległych, ${summary.totalUpcoming} kończących się (${summary.weekKey})`;

  const textLines: string[] = [
    `Dzień dobry, ${summary.user.name}!`,
    '',
    `Tygodniowe podsumowanie projektów (${summary.weekKey}, stan na ${summary.date}, strefa ${summary.timezone}):`,
    `Łącznie: otwartych ${summary.totalOpen} | zaległych ${summary.totalOverdue} | kończących się w ciągu ${summary.windowDays} dni: ${summary.totalUpcoming}`,
    '',
  ];

  const htmlProjectBlocks: string[] = [];

  for (const proj of summary.projects) {
    const projLabel = proj.projectKey ? `[${proj.projectKey}] ${proj.projectName}` : proj.projectName;
    textLines.push(
      `=== ${projLabel} (otwarte: ${proj.openCount}, zaległe: ${proj.overdueCount}, kończące się: ${proj.upcomingCount}) ===`
    );

    const renderTaskText = (task: WeeklySummaryTaskItem, isOverdue: boolean) => {
      const priorityLabel = PRIORITY_LABELS[task.priority] || task.priority;
      const statusLabel = STATUS_LABELS[task.status] || task.status;
      const taskUrl = cleanBaseUrl ? `${cleanBaseUrl}/?task=${encodeURIComponent(task.id)}` : '';
      const codePrefix = task.code ? `[${task.code}] ` : '';
      const timingNote = isOverdue
        ? `${formatOverdueDaysPl(task.daysOverdue)} (termin ${task.dueDate})`
        : task.diffDays === 0
        ? `Termin dziś (${task.dueDate})`
        : `Termin: ${task.dueDate}`;
      const parts = [
        `• ${codePrefix}${task.title}`,
        timingNote,
        `Osoba: ${task.assigneeName}`,
        `Priorytet: ${priorityLabel}`,
        `Status: ${statusLabel}`,
      ];
      if (taskUrl) parts.push(`Link: ${taskUrl}`);
      return parts.join(' | ');
    };

    if (proj.overdueItems.length > 0) {
      textLines.push(`Zaległe (${proj.overdueCount}):`);
      for (const task of proj.overdueItems) {
        textLines.push(renderTaskText(task, true));
      }
      if (proj.overdueOverflow > 0) {
        textLines.push(`… i ${proj.overdueOverflow} więcej`);
      }
    }

    if (proj.upcomingItems.length > 0) {
      textLines.push(`Kończące się w ciągu ${summary.windowDays} dni (${proj.upcomingCount}):`);
      for (const task of proj.upcomingItems) {
        textLines.push(renderTaskText(task, false));
      }
      if (proj.upcomingOverflow > 0) {
        textLines.push(`… i ${proj.upcomingOverflow} więcej`);
      }
    }

    textLines.push('');

    const renderHtmlRows = (items: WeeklySummaryTaskItem[], overflow: number, isOverdue: boolean) => {
      const rows = items.map((task) => {
        const priorityLabel = PRIORITY_LABELS[task.priority] || task.priority;
        const statusLabel = STATUS_LABELS[task.status] || task.status;
        const taskUrl = cleanBaseUrl ? `${cleanBaseUrl}/?task=${encodeURIComponent(task.id)}` : '';
        const escapedCode = escapeHtml(task.code);
        const escapedTitle = escapeHtml(task.title);
        const escapedAssignee = escapeHtml(task.assigneeName);
        const escapedDue = escapeHtml(task.dueDate);
        const escapedPriority = escapeHtml(priorityLabel);
        const escapedStatus = escapeHtml(statusLabel);

        const titleCell = taskUrl
          ? `<a href="${escapeHtml(taskUrl)}" style="color:#0369a1;text-decoration:none;font-weight:600;">${escapedTitle}</a>`
          : `<span style="color:#0f172a;font-weight:600;">${escapedTitle}</span>`;

        const timingCell = isOverdue
          ? `<span style="color:#be123c;font-weight:600;">${escapeHtml(formatOverdueDaysPl(task.daysOverdue))}</span><div style="font-size:11px;color:#64748b;">${escapedDue}</div>`
          : `<span style="color:#0369a1;font-weight:600;">${escapedDue}</span>`;

        return `<tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 10px;font-size:12px;vertical-align:top;">
            ${escapedCode ? `<span style="font-family:monospace;font-size:11px;background:#f1f5f9;color:#334155;padding:1px 5px;border-radius:4px;margin-right:6px;">${escapedCode}</span>` : ''}${titleCell}
          </td>
          <td style="padding:8px 10px;font-size:12px;vertical-align:top;white-space:nowrap;">${timingCell}</td>
          <td style="padding:8px 10px;font-size:12px;vertical-align:top;color:#334155;">${escapedAssignee}</td>
          <td style="padding:8px 10px;font-size:12px;vertical-align:top;color:#475569;">${escapedPriority} &middot; ${escapedStatus}</td>
        </tr>`;
      });

      if (overflow > 0) {
        rows.push(
          `<tr style="border-top:1px solid #e2e8f0;background:#f8fafc;">
            <td colspan="4" style="padding:8px 10px;font-size:12px;color:#475569;font-style:italic;">
              … i ${overflow} więcej
            </td>
          </tr>`
        );
      }

      return rows.join('\n');
    };

    const overdueBlock =
      proj.overdueItems.length > 0
        ? `<div style="margin-top:10px;">
            <div style="font-size:12px;font-weight:700;color:#be123c;margin-bottom:6px;">Zaległe (${proj.overdueCount})</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;background:#ffffff;">
              <thead>
                <tr style="background:#fff1f2;text-align:left;font-size:11px;color:#881337;">
                  <th style="padding:6px 10px;">Zadanie</th>
                  <th style="padding:6px 10px;">Opóźnienie / termin</th>
                  <th style="padding:6px 10px;">Osoba odpowiedzialna</th>
                  <th style="padding:6px 10px;">Priorytet / status</th>
                </tr>
              </thead>
              <tbody>
                ${renderHtmlRows(proj.overdueItems, proj.overdueOverflow, true)}
              </tbody>
            </table>
          </div>`
        : '';

    const upcomingBlock =
      proj.upcomingItems.length > 0
        ? `<div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:700;color:#0369a1;margin-bottom:6px;">Kończące się w ciągu ${summary.windowDays} dni (${proj.upcomingCount})</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;background:#ffffff;">
              <thead>
                <tr style="background:#f0f9ff;text-align:left;font-size:11px;color:#0c4a6e;">
                  <th style="padding:6px 10px;">Zadanie</th>
                  <th style="padding:6px 10px;">Termin</th>
                  <th style="padding:6px 10px;">Osoba odpowiedzialna</th>
                  <th style="padding:6px 10px;">Priorytet / status</th>
                </tr>
              </thead>
              <tbody>
                ${renderHtmlRows(proj.upcomingItems, proj.upcomingOverflow, false)}
              </tbody>
            </table>
          </div>`
        : '';

    htmlProjectBlocks.push(
      `<div style="margin-bottom:18px;padding:14px;border:1px solid #cbd5e1;border-radius:10px;background:#ffffff;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">
          <h3 style="margin:0;font-size:15px;color:#0f172a;">${escapeHtml(projLabel)}</h3>
          <span style="font-size:12px;color:#475569;">
            Otwarte: <strong>${proj.openCount}</strong> &middot;
            Zaległe: <strong style="color:${proj.overdueCount > 0 ? '#be123c' : '#334155'};">${proj.overdueCount}</strong> &middot;
            Kończące się: <strong style="color:${proj.upcomingCount > 0 ? '#0369a1' : '#334155'};">${proj.upcomingCount}</strong>
          </span>
        </div>
        ${overdueBlock}
        ${upcomingBlock}
      </div>`
    );
  }

  let cleanLineHtml = '';
  if (summary.cleanProjects.length > 0) {
    const cleanList = summary.cleanProjects
      .map((p) => (p.projectKey ? `[${p.projectKey}] ${p.projectName}` : p.projectName))
      .join(', ');
    const cleanLineText = `Bez uwag: ${cleanList}`;
    textLines.push(cleanLineText);
    textLines.push('');
    cleanLineHtml = `<p style="margin:12px 0;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534;">
      <strong>Bez uwag:</strong> ${escapeHtml(cleanList)}
    </p>`;
  }

  const footerText =
    'Aby wyłączyć cotygodniowe podsumowanie dla kierowników projektów, zaloguj się do aplikacji Zarządzanie Projektami i odznacz odpowiednią opcję w ustawieniach swojego konta.';
  textLines.push('---', footerText);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:740px;margin:0 auto;padding:24px;color:#1e293b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
    <div style="margin-bottom:16px;">
      <h2 style="margin:0 0 6px 0;font-size:18px;color:#0f172a;">Zarządzanie Projektami — podsumowanie tygodniowe (${escapeHtml(summary.weekKey)})</h2>
      <p style="margin:0;font-size:13px;color:#475569;">
        Dzień dobry, <strong>${escapeHtml(summary.user.name)}</strong>! Stan na dzień <strong>${escapeHtml(summary.date)}</strong> (${escapeHtml(summary.timezone)}).
      </p>
      <p style="margin:8px 0 0 0;font-size:13px;color:#334155;">
        Otwarte: <strong>${summary.totalOpen}</strong> &middot;
        Zaległe: <strong style="color:#be123c;">${summary.totalOverdue}</strong> &middot;
        Kończące się w ciągu ${summary.windowDays} dni: <strong style="color:#0369a1;">${summary.totalUpcoming}</strong>
      </p>
    </div>
    ${htmlProjectBlocks.join('\n')}
    ${cleanLineHtml}
    <div style="margin-top:20px;padding-top:12px;border-top:1px solid #cbd5e1;font-size:11px;color:#64748b;line-height:1.5;">
      ${escapeHtml(footerText)}
    </div>
  </div>`;

  return {
    subject,
    text: textLines.join('\n'),
    html,
  };
}
