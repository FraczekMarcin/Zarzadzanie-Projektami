/**
 * Utility for local date calculations without timezone shift bugs.
 */

/**
 * Returns today's local date in YYYY-MM-DD format (local time, avoiding UTC shifts).
 */
export function getTodayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Adds days to an ISO date string (YYYY-MM-DD) and returns the resulting date string.
 */
export function addDaysIso(isoDate: string, days: number): string {
  if (!isoDate) return getTodayIso();
  const parts = isoDate.split('-').map(Number);
  const date = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses an ISO date string (YYYY-MM-DD) into a local Date object at midnight.
 */
export function parseIsoDate(isoDate: string): Date {
  if (!isoDate) return new Date();
  const parts = isoDate.split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, 0, 0, 0, 0);
}
