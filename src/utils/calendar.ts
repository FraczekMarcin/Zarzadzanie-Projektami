import { Task, Project } from '../types';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import { buildIcs } from './icsBuilder';

export { PRIORITY_LABELS, STATUS_LABELS };

/**
 * Formats a date string 'YYYY-MM-DD' to Google Calendar compact format 'YYYYMMDD'
 */
function toGCalDate(dateStr?: string): string {
  if (!dateStr) {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }
  return String(dateStr).replace(/-/g, '');
}

/**
 * Calculates next day date string 'YYYYMMDD' because Google Calendar end-date is exclusive for all-day events.
 */
function getNextDayGCalDate(dateStr?: string): string {
  if (!dateStr) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) {
      return toGCalDate(dateStr);
    }
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  } catch {
    return toGCalDate(dateStr);
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

/**
 * Sprawdza, czy podany adres URL lub nazwa hosta jest lokalna / prywatna
 * (lub używa niezaszyfrowanego protokołu http://) i nie może zostać pobrana przez serwery Google.
 */
export function isPrivateOrLocalUrl(url: string): boolean {
  const trimmed = (url || '').trim();
  if (!trimmed) return true;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return true;
  }

  if (hasScheme && parsed.protocol.toLowerCase() === 'http:') {
    return true;
  }

  const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!rawHost) return true;

  if (rawHost === 'localhost' || rawHost.endsWith('.localhost')) {
    return true;
  }

  if (rawHost === '::1' || rawHost.startsWith('fe80:') || rawHost.startsWith('fc') || rawHost.startsWith('fd')) {
    return true;
  }

  if (isPrivateIpv4(rawHost)) {
    return true;
  }

  if (!rawHost.includes('.')) {
    return true;
  }

  if (rawHost.endsWith('.local') || rawHost.endsWith('.lan') || rawHost.endsWith('.home')) {
    return true;
  }

  return false;
}

/**
 * Generates direct Google Calendar Web Event creation URL.
 * When clicked, it opens the user's Google Calendar with all fields pre-filled.
 */
export function generateGoogleCalendarUrl(task: Task, project?: Project): string {
  if (!task) return 'https://calendar.google.com/calendar';

  const code = task.code || 'ZAD';
  const taskTitle = task.title || 'Zadanie';
  const title = `[${code}] ${taskTitle}`;
  
  const startDate = toGCalDate(task.startDate || task.dueDate);
  const endDate = getNextDayGCalDate(task.dueDate || task.startDate);
  const dates = `${startDate}/${endDate}`;

  const taskType = task.type ? String(task.type).toUpperCase() : 'ZADANIE';
  const priorityText = PRIORITY_LABELS[task.priority] || task.priority || 'Normalny';
  const statusText = STATUS_LABELS[task.status] || task.status || 'Do zrobienia';
  const durationText = task.durationDays ? `Czas trwania: ${task.durationDays} dni` : '';

  const detailsLines = [
    `Projekt: ${project?.name || 'Zarządzanie Projektami'} (${project?.key || 'PRJ'})`,
    `Typ: ${taskType}`,
    `Priorytet: ${priorityText}`,
    `Status: ${statusText}`,
    durationText,
    task.progress !== undefined ? `Postęp: ${task.progress}%` : '',
    task.estimatedHours ? `Szacowany czas: ${task.estimatedHours}h (przepracowano: ${task.spentHours || 0}h)` : '',
    '',
    `Opis zadania:`,
    task.description || '',
    '',
    `System: Zarządzanie Projektami`,
  ].filter(Boolean);

  const details = detailsLines.join('\n');
  const location = project?.name || 'Zarządzanie Projektami';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: dates,
    details: details,
    location: location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates the Google Calendar "Add by URL" direct subscribe link.
 * When clicked, Google Calendar opens with the "Add Calendar from URL" prompt prefilled under "Moje kalendarze"!
 */
export function generateGoogleCalendarSubscribeUrl(feedUrl: string): string {
  // Google Calendar web subscription URL format:
  // https://calendar.google.com/calendar/r?cid={encoded_webcal_or_https_url}
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`;
}

/**
 * Generates RFC 5545 compliant iCalendar (.ics) string using buildIcs.
 * Compatible with Google Calendar (Import/Export & URL subscription), Apple Calendar, and Outlook.
 */
export function generateIcsContent(
  tasks: Task[] = [],
  projectName: string = 'Zarządzanie Projektami',
  projects: Project[] = []
): string {
  const projectsMap = new Map<string, Project>();
  for (const p of projects || []) {
    if (p && p.id) projectsMap.set(p.id, p);
  }
  return buildIcs(tasks as any, `${projectName} - Terminarz Zadań`, { projects: projectsMap });
}

/**
 * Triggers instant browser download of .ics file
 */
export function downloadIcsFile(
  tasks: Task[],
  filename: string = 'terminarz.ics',
  projectName?: string,
  projects?: Project[]
) {
  const content = generateIcsContent(tasks, projectName, projects);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
