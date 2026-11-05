import { Task, Project } from '../types';

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

export const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Krytyczny (P1)',
  high: 'Wysoki (P2)',
  normal: 'Normalny (P3)',
  medium: 'Normalny (P3)',
  low: 'Niski (P4)',
};

export const STATUS_LABELS: Record<string, string> = {
  to_do: 'Do zrobienia',
  in_progress: 'W toku',
  review: 'Do weryfikacji',
  done: 'Ukończone',
  blocked: 'Zablokowane',
};

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

import { buildIcs } from './icsBuilder';

/**
 * Generates RFC 5545 compliant iCalendar (.ics) string using buildIcs.
 * Compatible with Google Calendar (Import/Export & URL subscription), Apple Calendar, and Outlook.
 */
export function generateIcsContent(tasks: Task[] = [], projectName: string = 'Zarządzanie Projektami'): string {
  return buildIcs(tasks as any, `${projectName} - Terminarz Zadań`);
}

/**
 * Triggers instant browser download of .ics file
 */
export function downloadIcsFile(tasks: Task[], filename: string = 'terminarz.ics', projectName?: string) {
  const content = generateIcsContent(tasks, projectName);
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
