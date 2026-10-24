import { Task } from '../types';

/**
 * Calculates remaining working days (Monday-Friday) between fromDate and dueDate.
 * Excludes Saturdays (day 6) and Sundays (day 0).
 */
export function getBusinessDaysRemaining(dueDateStr: string, fromDateStr: string = '2026-10-24'): number {
  if (!dueDateStr) return 999;

  try {
    const from = new Date(fromDateStr + 'T00:00:00');
    const due = new Date(dueDateStr + 'T00:00:00');

    // If past due date
    if (due < from) {
      let count = 0;
      const cur = new Date(due);
      while (cur < from) {
        cur.setDate(cur.getDate() + 1);
        const day = cur.getDay();
        if (day !== 0 && day !== 6) {
          count--;
        }
      }
      return count;
    }

    let count = 0;
    const cur = new Date(from);
    while (cur < due) {
      cur.setDate(cur.getDate() + 1);
      const day = cur.getDay();
      if (day !== 0 && day !== 6) {
        count++;
      }
    }
    return count;
  } catch {
    return 999;
  }
}

/**
 * Returns true if a task has an official statutory deadline approaching within 3 business days or overdue.
 */
export function isApproachingOfficialDeadline(task: Task, fromDateStr: string = '2026-10-24'): boolean {
  if (!task.isOfficialDeadline || task.status === 'done') {
    return false;
  }
  const remaining = getBusinessDaysRemaining(task.dueDate, fromDateStr);
  // Approaches within 3 business days or already overdue (<= 3 business days)
  return remaining <= 3;
}
