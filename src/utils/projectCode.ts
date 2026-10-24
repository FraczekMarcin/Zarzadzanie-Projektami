import { Project } from '../types';

/**
 * Generates the next sequential project code in the format 'YYYY-NN',
 * e.g. '2026-01', '2026-02', '2026-03'.
 */
export function getNextProjectCode(projects: Project[], targetYear: number = 2026): string {
  const prefix = `${targetYear}-`;
  const numbers: number[] = [];

  projects.forEach((p) => {
    if (p.key && p.key.startsWith(prefix)) {
      const numPart = parseInt(p.key.replace(prefix, ''), 10);
      if (!isNaN(numPart)) {
        numbers.push(numPart);
      }
    }
  });

  const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(2, '0')}`;
}

/**
 * Checks if a given project code is free/available.
 * Case-insensitive comparison.
 * If currentProjectId is supplied, it ignores the code of the project being edited.
 */
export function isProjectCodeAvailable(
  code: string,
  projects: Project[],
  currentProjectId?: string
): boolean {
  if (!code || !code.trim()) return false;
  const normalized = code.trim().toUpperCase();
  return !projects.some(
    (p) => p.id !== currentProjectId && p.key.trim().toUpperCase() === normalized
  );
}

/**
 * Validates format - accepts standard YYYY-NN or any non-empty custom alphanumeric code.
 */
export function isValidProjectCodeFormat(code: string): boolean {
  if (!code || !code.trim()) return false;
  // Allows letters, digits, dashes, underscores
  return /^[A-Za-z0-9-_]{2,20}$/.test(code.trim());
}
