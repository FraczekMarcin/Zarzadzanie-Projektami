import { Company, Project, ProjectNumberingScope, TrashEntry } from '../types';

export const PROJECT_CODE_PATTERN = /^(\d{4})-(\d{1,3})(?:_([A-Z]))?$/;
export const MAX_PROJECT_NUMBER_PER_YEAR = 999;

export type ProjectCodeSourceItem =
  | Project
  | TrashEntry
  | { key?: string; companyId?: string };

export interface ParsedProjectCode {
  year: number;
  number: number;
  letter?: string;
}

/**
 * Parsuje numer projektu w formacie RRRR-X_L (np. 2026-1_A, 2026-123_B)
 * oraz starszym formacie RRRR-NN (np. 2026-04).
 */
export function parseProjectCode(code: string): ParsedProjectCode | null {
  if (!code || typeof code !== 'string') return null;
  const trimmed = code.trim().toUpperCase();
  const match = trimmed.match(PROJECT_CODE_PATTERN);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const num = parseInt(match[2], 10);
  if (!Number.isInteger(year) || !Number.isInteger(num) || num < 0) {
    return null;
  }

  return {
    year,
    number: num,
    letter: match[3] || undefined,
  };
}

function extractKeyAndCompany(item: any): { key: string; companyId?: string } | null {
  if (!item || typeof item !== 'object') return null;

  if ('type' in item && 'payload' in item) {
    if (item.type !== 'project') return null;
    const proj = item.payload?.project;
    if (proj && typeof proj.key === 'string') {
      return { key: proj.key, companyId: proj.companyId };
    }
    if (typeof item.code === 'string') {
      return { key: item.code };
    }
    return null;
  }

  if (typeof item.key === 'string') {
    return { key: item.key, companyId: item.companyId };
  }

  return null;
}

/**
 * Generuje kolejny numer projektu w formacie 'RRRR-X_L' (gdy podano firmę)
 * lub legacy 'RRRR-NN' (gdy projekt nie ma firmy).
 * Uwzględnia aktywne, zarchiwizowane oraz usunięte do kosza projekty.
 */
export function getNextProjectCode(
  projects: ProjectCodeSourceItem[],
  trashedProjects: ProjectCodeSourceItem[] = [],
  companies: Company[] = [],
  companyId?: string,
  year: number = new Date().getFullYear(),
  scope: ProjectNumberingScope = 'year'
): string {
  const targetYear =
    typeof year === 'number' && Number.isInteger(year)
      ? year
      : new Date().getFullYear();

  const company = companyId
    ? companies.find((c) => c && c.id === companyId)
    : undefined;
  const targetLetter = company?.letter
    ? company.letter.trim().toUpperCase()
    : undefined;

  const numbers: number[] = [];
  const allSources = [
    ...(Array.isArray(projects) ? projects : []),
    ...(Array.isArray(trashedProjects) ? trashedProjects : []),
  ];

  for (const item of allSources) {
    const extracted = extractKeyAndCompany(item);
    if (!extracted) continue;

    const parsed = parseProjectCode(extracted.key);
    if (!parsed || parsed.year !== targetYear) continue;

    if (scope === 'company' && targetLetter) {
      if (parsed.letter !== targetLetter) continue;
    }

    numbers.push(parsed.number);
  }

  const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
  const nextNum = maxNum + 1;

  if (nextNum > MAX_PROJECT_NUMBER_PER_YEAR) {
    throw new Error('Wyczerpano numerację w roku');
  }

  if (targetLetter) {
    return `${targetYear}-${nextNum}_${targetLetter}`;
  }

  return `${targetYear}-${String(nextNum).padStart(2, '0')}`;
}

/**
 * Sprawdza dostępność numeru projektu (porównanie bez rozróżniania wielkości liter).
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
 * Waliduje format kodu projektu - akceptuje RRRR-X_L, RRRR-NN oraz starsze formaty alfanumeryczne.
 */
export function isValidProjectCodeFormat(code: string): boolean {
  if (!code || !code.trim()) return false;
  return /^[A-Za-z0-9-_]{2,20}$/.test(code.trim());
}
