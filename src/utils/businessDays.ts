import { Task } from '../types';
import { getTodayIso } from './today';
import { isPolishHoliday } from './polishHolidays';

/**
 * Checks if a given Date is a working business day (not weekend and not a Polish statutory public holiday).
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) {
    return false;
  }
  return !isPolishHoliday(date);
}

/**
 * Calculates remaining working days (Monday-Friday, excluding Polish statutory holidays)
 * between fromDate and dueDate.
 */
export function getBusinessDaysRemaining(dueDateStr: string, fromDateStr: string = getTodayIso()): number {
  if (!dueDateStr) return 999;

  try {
    const [fy, fm, fd] = fromDateStr.split('-').map(Number);
    const [dy, dm, dd] = dueDateStr.split('-').map(Number);
    const from = new Date(fy, (fm || 1) - 1, fd || 1, 12, 0, 0);
    const due = new Date(dy, (dm || 1) - 1, dd || 1, 12, 0, 0);

    // If past due date
    if (due < from) {
      let count = 0;
      const cur = new Date(due.getTime());
      while (cur < from) {
        cur.setDate(cur.getDate() + 1);
        if (isBusinessDay(cur)) {
          count--;
        }
      }
      return count;
    }

    let count = 0;
    const cur = new Date(from.getTime());
    while (cur < due) {
      cur.setDate(cur.getDate() + 1);
      if (isBusinessDay(cur)) {
        count++;
      }
    }
    return count;
  } catch {
    return 999;
  }
}

/**
 * Adds n business days (Monday-Friday, excluding Polish statutory holidays) to a date string YYYY-MM-DD.
 * If n < 0, subtracts business days.
 */
export function addBusinessDays(dateStr: string, n: number): string {
  if (!dateStr || n === 0) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const cur = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);

  let remaining = Math.abs(n);
  const step = n > 0 ? 1 : -1;

  while (remaining > 0) {
    cur.setDate(cur.getDate() + step);
    if (isBusinessDay(cur)) {
      remaining--;
    }
  }

  const resYear = cur.getFullYear();
  const resMonth = String(cur.getMonth() + 1).padStart(2, '0');
  const resDay = String(cur.getDate()).padStart(2, '0');
  return `${resYear}-${resMonth}-${resDay}`;
}

/**
 * Returns true if a task has an official statutory deadline approaching within 3 business days or overdue.
 */
export function isApproachingOfficialDeadline(task: Task, fromDateStr: string = getTodayIso()): boolean {
  if (!task.isOfficialDeadline || task.status === 'done') {
    return false;
  }
  const remaining = getBusinessDaysRemaining(task.dueDate, fromDateStr);
  // Approaches within 3 business days or already overdue (<= 3 business days)
  return remaining <= 3;
}
