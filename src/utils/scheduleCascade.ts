import { Task } from '../types';

/**
 * Dodaje liczbę dni do daty w formacie YYYY-MM-DD
 */
export function addDays(dateStr: string, days: number): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return dateStr;
  }
}

/**
 * Oblicza liczbę dni między dwiema datami włącznie
 */
export function calculateDaysBetween(startDate: string, dueDate: string): number {
  try {
    const d1 = new Date(startDate + 'T00:00:00').getTime();
    const d2 = new Date(dueDate + 'T00:00:00').getTime();
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, diff);
  } catch {
    return 1;
  }
}

/**
 * Oblicza termin końcowy na podstawie daty rozpoczęcia i czasu trwania w dniach
 */
export function calculateDueDateFromDuration(startDate: string, durationDays: number): string {
  const days = Math.max(1, durationDays);
  return addDays(startDate, days - 1);
}

/**
 * Silnik kaskadowego dostosowywania terminów kolejnych etapów (Schedule Cascading):
 * - Przy zadaniu blokowanym przez inne, data rozpoczęcia jest dostosowywana w dzień zakończenia poprzedzającego zadania.
 * - Jeśli data poprzednika się zmieni, system automatycznie i kaskadowo dostosowuje daty wszystkich kolejnych etapów.
 */
export function cascadeScheduleDates(tasks: Task[]): { updatedTasks: Task[]; cascadedEvents: string[] } {
  const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, { ...t }]));
  const events: string[] = [];
  let changed = true;
  let iterations = 0;
  const maxIterations = 50; // Zabezpieczenie przed pętlami zależności

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const [taskId, task] of taskMap.entries()) {
      const blockerIds = task.blockingTaskIds || task.dependencies || [];
      if (blockerIds.length === 0) continue;

      // Znajdź zadania blokujące w aktualnym stanie
      const blockers = blockerIds
        .map((bId) => taskMap.get(bId))
        .filter((b): b is Task => !!b);

      if (blockers.length === 0) continue;

      // Wyznacz najpóźniejszy dzień zakończenia spośród wszystkich poprzedników
      let maxBlockerDueDate = '';
      let triggerBlocker: Task | null = null;
      for (const b of blockers) {
        if (b.dueDate && (!maxBlockerDueDate || b.dueDate > maxBlockerDueDate)) {
          maxBlockerDueDate = b.dueDate;
          triggerBlocker = b;
        }
      }

      if (maxBlockerDueDate && task.startDate !== maxBlockerDueDate) {
        const oldStart = task.startDate;
        const duration = task.durationDays || calculateDaysBetween(task.startDate, task.dueDate);
        const newStart = maxBlockerDueDate;
        const newDue = calculateDueDateFromDuration(newStart, duration);

        if (task.startDate !== newStart || task.dueDate !== newDue) {
          const updatedTask: Task = {
            ...task,
            startDate: newStart,
            dueDate: newDue,
            durationDays: duration,
            updatedAt: new Date().toISOString(),
          };

          taskMap.set(taskId, updatedTask);
          changed = true;

          events.push(
            `Dostosowano termin kolejnego etapu [${task.code}] "${task.title}": start w dzień zakończenia [${triggerBlocker?.code || 'poprzednika'}] (${newStart}), termin: ${newDue} (${duration} dni).`
          );
        }
      }
    }
  }

  return {
    updatedTasks: Array.from(taskMap.values()),
    cascadedEvents: events,
  };
}
