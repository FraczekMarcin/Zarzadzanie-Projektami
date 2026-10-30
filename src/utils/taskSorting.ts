import { Task, Priority } from '../types';

/**
 * Wymóg: Wszystkie zadania sortuj według priorytetu a następnie terminu
 * 1. Priorytet: Krytyczny (critical) -> Wysoki (high) -> Normalny (normal) -> Niski (low)
 * 2. Termin zakończenia: wcześniejsze terminy pierwsze, brak terminu na końcu
 * 3. Data rozpoczęcia (dla równego terminu)
 */
export function sortTasksByPriorityAndDueDate(tasks: Task[]): Task[] {
  if (!Array.isArray(tasks)) return [];

  const priorityWeight: Record<Priority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  return [...tasks].sort((a, b) => {
    // 1. Priorytet
    const pA = priorityWeight[a.priority || 'normal'] ?? 2;
    const pB = priorityWeight[b.priority || 'normal'] ?? 2;
    if (pA !== pB) {
      return pA - pB;
    }

    // 2. Termin zakończenia (dueDate)
    const dueA = a.dueDate ? a.dueDate.trim() : '9999-99-99';
    const dueB = b.dueDate ? b.dueDate.trim() : '9999-99-99';
    if (dueA !== dueB) {
      return dueA.localeCompare(dueB);
    }

    // 3. Data rozpoczęcia (startDate)
    const startA = a.startDate ? a.startDate.trim() : '9999-99-99';
    const startB = b.startDate ? b.startDate.trim() : '9999-99-99';
    if (startA !== startB) {
      return startA.localeCompare(startB);
    }

    // 4. Kod zadania
    return (a.code || '').localeCompare(b.code || '');
  });
}
