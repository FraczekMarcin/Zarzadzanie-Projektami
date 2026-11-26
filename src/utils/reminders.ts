import type { Project, ProjectStatusOption, Task, User } from '../types/index.js';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels.js';
import { getProjectDisplayName, isProjectStatusClosed } from './projectMeta.js';

export const ALLOWED_REMINDER_DAYS: readonly number[] = [0, 1, 2, 3, 7] as const;

export const POPULAR_TIMEZONES: readonly string[] = [
  'Europe/Warsaw',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Vienna',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
] as const;

export interface ReminderSettings {
  enabled: boolean;
  sendHour: number;
  timezone: string;
  daysBefore: number[];
  notifyOverdue: boolean;
  appBaseUrl: string;
}

export interface PersistedReminderState {
  lastRunDate: string | null;
  lastRunAt: string | null;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
  sentUserIdsDate: string | null;
  sentUserIdsToday: string[];
}

export interface DigestTaskItem {
  id: string;
  code: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  isOfficialDeadline?: boolean;
  diffDays: number;
}

export interface DigestSection {
  key: string;
  title: string;
  tasks: DigestTaskItem[];
}

export interface UserDigest {
  user: {
    id: string;
    name: string;
    email: string;
    role?: string;
  };
  date: string;
  timezone: string;
  totalTasks: number;
  overdueCount: number;
  todayCount: number;
  upcomingCount: number;
  sections: DigestSection[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SIMPLE_EMAIL_REGEX = /^[^\s@<>()[\]\\,;:\"]+@[^\s@<>()[\]\\,;:\"]+\.[^\s@<>()[\]\\,;:\"]+$/;
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  medium: 2,
  low: 3,
};

export function isValidIanaTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string') return false;
  const trimmed = timezone.trim();
  if (!trimmed || trimmed.length > 100 || /[\r\n\0]/.test(trimmed)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

function toDate(now: Date | number): Date {
  return now instanceof Date ? now : new Date(now);
}

export function localDateString(now: Date | number, timezone: string): string {
  const safeTz = isValidIanaTimezone(timezone) ? timezone.trim() : 'Europe/Warsaw';
  const d = toDate(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function localHour(now: Date | number, timezone: string): number {
  const safeTz = isValidIanaTimezone(timezone) ? timezone.trim() : 'Europe/Warsaw';
  const d = toDate(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);

  const rawHour = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const parsed = parseInt(rawHour, 10);
  if (!Number.isFinite(parsed)) return 0;
  return ((parsed % 24) + 24) % 24;
}

function parseDateOnlyUtcMs(dateStr: string): number | null {
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

export function normalizeDaysBefore(rawDays: unknown): number[] {
  if (!Array.isArray(rawDays)) return [];
  const validSet = new Set<number>();
  for (const item of rawDays) {
    const n = typeof item === 'number' ? item : Number(item);
    if (Number.isInteger(n) && ALLOWED_REMINDER_DAYS.includes(n)) {
      validSet.add(n);
    }
  }
  return Array.from(validSet).sort((a, b) => b - a);
}

function compareDigestTasks(a: DigestTaskItem, b: DigestTaskItem): number {
  if (a.dueDate !== b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }
  const rankA = PRIORITY_RANK[a.priority] ?? 99;
  const rankB = PRIORITY_RANK[b.priority] ?? 99;
  if (rankA !== rankB) return rankA - rankB;
  return (a.code || a.title).localeCompare(b.code || b.title, 'pl');
}

function formatDaysAheadTitle(days: number): string {
  if (days === 0) return 'Termin dziś';
  if (days === 1) return 'Termin za 1 dzień';
  return `Termin za ${days} dni`;
}

export function buildDigests(
  tasks: Task[],
  projects: Project[],
  users: User[],
  now: Date | number,
  settings: ReminderSettings,
  projectStatuses?: ProjectStatusOption[] | null
): UserDigest[] {
  const safeTz = isValidIanaTimezone(settings.timezone) ? settings.timezone.trim() : 'Europe/Warsaw';
  const todayStr = localDateString(now, safeTz);
  const todayUtcMs = parseDateOnlyUtcMs(todayStr);
  if (todayUtcMs === null) return [];

  const projectMap = new Map<string, Project>();
  for (const p of projects || []) {
    if (!p || !p.id || p.isArchived || isProjectStatusClosed(p.status, projectStatuses)) continue;
    projectMap.set(p.id, p);
  }

  const allowedDaysSet = new Set(normalizeDaysBefore(settings.daysBefore));
  const includeToday = allowedDaysSet.has(0);
  const positiveDays = Array.from(allowedDaysSet)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);

  const tasksByUser = new Map<string, Task[]>();
  for (const t of tasks || []) {
    if (!t || !t.assigneeId) continue;
    if ((t.status as string) === 'done' || (t.status as string) === 'cancelled') continue;
    if (!projectMap.has(t.projectId)) continue;
    const dueMs = parseDateOnlyUtcMs(t.dueDate);
    if (dueMs === null) continue;

    const list = tasksByUser.get(t.assigneeId);
    if (list) {
      list.push(t);
    } else {
      tasksByUser.set(t.assigneeId, [t]);
    }
  }

  const digests: UserDigest[] = [];

  for (const u of users || []) {
    if (!u || !u.id) continue;
    if (u.isApproved === false) continue;
    if (u.emailReminders === false) continue;

    const cleanEmail = typeof u.email === 'string' ? u.email.trim() : '';
    if (!cleanEmail || !SIMPLE_EMAIL_REGEX.test(cleanEmail)) continue;

    const userTasks = tasksByUser.get(u.id);
    if (!userTasks || userTasks.length === 0) continue;

    const overdueTasks: DigestTaskItem[] = [];
    const todayTasks: DigestTaskItem[] = [];
    const upcomingByDay = new Map<number, DigestTaskItem[]>();
    for (const d of positiveDays) {
      upcomingByDay.set(d, []);
    }

    for (const t of userTasks) {
      const dueMs = parseDateOnlyUtcMs(t.dueDate);
      if (dueMs === null) continue;
      const diffDays = Math.round((dueMs - todayUtcMs) / MS_PER_DAY);
      const proj = projectMap.get(t.projectId)!;

      const item: DigestTaskItem = {
        id: t.id,
        code: t.code || '',
        title: t.title || '(Bez tytułu)',
        dueDate: t.dueDate,
        priority: t.priority || 'normal',
        status: t.status || 'to_do',
        projectId: proj.id,
        projectName: getProjectDisplayName(proj) || proj.name || '',
        projectKey: proj.key || '',
        isOfficialDeadline: Boolean(t.isOfficialDeadline),
        diffDays,
      };

      if (diffDays <= -1 && diffDays >= -3) {
        if (settings.notifyOverdue) {
          overdueTasks.push(item);
        }
      } else if (diffDays === 0) {
        if (includeToday) {
          todayTasks.push(item);
        }
      } else if (diffDays > 0 && upcomingByDay.has(diffDays)) {
        upcomingByDay.get(diffDays)!.push(item);
      }
    }

    const sections: DigestSection[] = [];
    if (overdueTasks.length > 0) {
      overdueTasks.sort(compareDigestTasks);
      sections.push({
        key: 'overdue',
        title: 'Po terminie',
        tasks: overdueTasks,
      });
    }
    if (todayTasks.length > 0) {
      todayTasks.sort(compareDigestTasks);
      sections.push({
        key: 'due_0',
        title: formatDaysAheadTitle(0),
        tasks: todayTasks,
      });
    }
    let upcomingCount = 0;
    for (const d of positiveDays) {
      const bucket = upcomingByDay.get(d)!;
      if (bucket.length > 0) {
        bucket.sort(compareDigestTasks);
        upcomingCount += bucket.length;
        sections.push({
          key: `due_${d}`,
          title: formatDaysAheadTitle(d),
          tasks: bucket,
        });
      }
    }

    const totalTasks = overdueTasks.length + todayTasks.length + upcomingCount;
    if (totalTasks === 0) continue;

    digests.push({
      user: {
        id: u.id,
        name: u.name || cleanEmail,
        email: cleanEmail,
        role: u.role,
      },
      date: todayStr,
      timezone: safeTz,
      totalTasks,
      overdueCount: overdueTasks.length,
      todayCount: todayTasks.length,
      upcomingCount,
      sections,
    });
  }

  return digests;
}

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSafeBaseUrl(rawUrl: string): string {
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

export function renderDigestEmail(
  digest: UserDigest,
  appBaseUrl: string
): { subject: string; text: string; html: string } {
  const cleanBaseUrl = normalizeSafeBaseUrl(appBaseUrl);
  const subject = `Przypomnienie o terminach zadań (${digest.totalTasks}) — ${digest.date}`;

  const textLines: string[] = [
    `Dzień dobry, ${digest.user.name}!`,
    '',
    `Podsumowanie Twoich zadań z nadchodzącym lub przekroczonym terminem (stan na ${digest.date}, strefa ${digest.timezone}):`,
    '',
  ];

  const htmlSections: string[] = [];

  for (const section of digest.sections) {
    textLines.push(`=== ${section.title} (${section.tasks.length}) ===`);
    const htmlRows: string[] = [];

    for (const task of section.tasks) {
      const priorityLabel = PRIORITY_LABELS[task.priority] || task.priority;
      const statusLabel = STATUS_LABELS[task.status] || task.status;
      const taskUrl = cleanBaseUrl ? `${cleanBaseUrl}/?task=${encodeURIComponent(task.id)}` : '';

      const codePart = task.code ? `[${task.code}] ` : '';
      const overdueNote =
        task.diffDays < 0
          ? ` (po terminie o ${Math.abs(task.diffDays)} ${Math.abs(task.diffDays) === 1 ? 'dzień' : 'dni'})`
          : '';
      const lineParts = [
        `• ${codePart}${task.title}`,
        `Projekt: ${task.projectName}`,
        `Termin: ${task.dueDate}${overdueNote}`,
        `Priorytet: ${priorityLabel}`,
        `Status: ${statusLabel}`,
      ];
      if (taskUrl) {
        lineParts.push(`Link: ${taskUrl}`);
      }
      textLines.push(lineParts.join(' | '));

      const escapedCode = escapeHtml(task.code);
      const escapedTitle = escapeHtml(task.title);
      const escapedProject = escapeHtml(task.projectName);
      const escapedDue = escapeHtml(task.dueDate);
      const escapedPriority = escapeHtml(priorityLabel);
      const escapedStatus = escapeHtml(statusLabel);
      const escapedOverdue = task.diffDays < 0
        ? ` <span style="color:#be123c;font-weight:600;">(po terminie: ${Math.abs(task.diffDays)} ${Math.abs(task.diffDays) === 1 ? 'dzień' : 'dni'})</span>`
        : '';

      const titleHtml = taskUrl
        ? `<a href="${escapeHtml(taskUrl)}" style="color:#0369a1;text-decoration:none;font-weight:600;">${escapedTitle}</a>`
        : `<span style="color:#0f172a;font-weight:600;">${escapedTitle}</span>`;

      htmlRows.push(
        `<li style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#ffffff;list-style:none;">
          <div style="font-size:14px;line-height:1.4;">
            ${escapedCode ? `<span style="font-family:monospace;font-size:12px;background:#f1f5f9;color:#334155;padding:2px 6px;border-radius:4px;margin-right:6px;">${escapedCode}</span>` : ''}${titleHtml}
          </div>
          <div style="font-size:12px;color:#475569;margin-top:4px;">
            Projekt: <strong>${escapedProject}</strong> &middot;
            Termin: <strong>${escapedDue}</strong>${escapedOverdue} &middot;
            Priorytet: ${escapedPriority} &middot;
            Status: ${escapedStatus}
          </div>
        </li>`
      );
    }

    textLines.push('');

    const isOverdueSection = section.key === 'overdue';
    const headerColor = isOverdueSection ? '#be123c' : section.key === 'due_0' ? '#b45309' : '#0369a1';
    htmlSections.push(
      `<div style="margin-bottom:20px;">
        <h3 style="margin:0 0 10px 0;font-size:14px;color:${headerColor};border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          ${escapeHtml(section.title)} (${section.tasks.length})
        </h3>
        <ul style="margin:0;padding:0;">
          ${htmlRows.join('\n')}
        </ul>
      </div>`
    );
  }

  const footerText =
    'Aby wyłączyć dzienne przypomnienia e-mail, zaloguj się do aplikacji Zarządzanie Projektami i odznacz opcję przypomnień w ustawieniach swojego konta.';
  textLines.push('---', footerText);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
    <div style="margin-bottom:16px;">
      <h2 style="margin:0 0 6px 0;font-size:18px;color:#0f172a;">Zarządzanie Projektami — przypomnienie o terminach</h2>
      <p style="margin:0;font-size:13px;color:#475569;">
        Dzień dobry, <strong>${escapeHtml(digest.user.name)}</strong>! Poniżej znajduje się zestawienie zadań na dzień <strong>${escapeHtml(digest.date)}</strong> (${escapeHtml(digest.timezone)}).
      </p>
    </div>
    ${htmlSections.join('\n')}
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

export function shouldRunNow(
  now: Date | number,
  settings: ReminderSettings,
  lastRunDate?: string | null
): boolean {
  if (!settings.enabled) return false;
  const safeTz = isValidIanaTimezone(settings.timezone) ? settings.timezone.trim() : 'Europe/Warsaw';
  const todayStr = localDateString(now, safeTz);
  if (lastRunDate && lastRunDate >= todayStr) {
    return false;
  }
  const hour = localHour(now, safeTz);
  return hour >= settings.sendHour;
}

export function computeNextScheduledAt(
  now: Date | number,
  settings: ReminderSettings,
  lastRunDate?: string | null
): string | null {
  if (!settings.enabled) return null;
  const safeTz = isValidIanaTimezone(settings.timezone) ? settings.timezone.trim() : 'Europe/Warsaw';
  const baseMs = toDate(now).getTime();

  // Zaokrąglij w górę do pełnej godziny, jeśli minuty/sekundy > 0
  const startHourMs = Math.floor(baseMs / (60 * 60 * 1000)) * (60 * 60 * 1000);
  const startStep = startHourMs < baseMs ? 1 : 0;

  for (let i = startStep; i <= 48; i++) {
    const candidateMs = startHourMs + i * 60 * 60 * 1000;
    const candidateDate = localDateString(candidateMs, safeTz);
    const candidateHour = localHour(candidateMs, safeTz);
    if (lastRunDate && lastRunDate >= candidateDate) continue;
    if (candidateHour === settings.sendHour) {
      return new Date(candidateMs).toISOString();
    }
  }
  return null;
}
