import { describe, it, expect } from 'vitest';
import {
  getNextProjectCode,
  isProjectCodeAvailable,
  isValidProjectCodeFormat,
  parseProjectCode,
} from '../utils/projectCode';
import type { Company, Project, TrashEntry } from '../types';

const COMPANIES: Company[] = [
  { id: 'comp-a', name: 'Alfa Sp. z o.o.', letter: 'A', isActive: true, vatPayer: true },
  { id: 'comp-b', name: 'Beta Pracownia', letter: 'B', isActive: true, vatPayer: true },
];

function makeProject(id: string, key: string, extras: Partial<Project> = {}): Project {
  return {
    id,
    key,
    name: `Projekt ${key}`,
    description: '',
    priority: 'normal',
    status: 'active',
    startDate: '2026-01-01',
    dueDate: '2026-03-01',
    durationDays: 60,
    progress: 0,
    memberIds: [],
    color: '#0284c7',
    ...extras,
  };
}

function makeTrashedProject(id: string, key: string, companyId?: string): TrashEntry {
  return {
    id: `tr-${id}`,
    type: 'project',
    title: `Usunięty ${key}`,
    code: key,
    projectId: id,
    deletedAt: '2026-05-01T10:00:00.000Z',
    deletedBy: 'usr-admin',
    deletedByName: 'Admin',
    expiresAt: '2026-06-01T10:00:00.000Z',
    payload: {
      project: makeProject(id, key, companyId ? { companyId } : {}),
      tasks: [],
      comments: [],
    },
  };
}

describe('Generator i walidacja numerów projektów (projectCode.ts)', () => {
  describe('parseProjectCode', () => {
    it('parsuje format RRRR-X_L (1-3 cyfry bez zer wiodących + wielka litera A-Z)', () => {
      expect(parseProjectCode('2026-1_A')).toEqual({ year: 2026, number: 1, letter: 'A' });
      expect(parseProjectCode('2026-12_B')).toEqual({ year: 2026, number: 12, letter: 'B' });
      expect(parseProjectCode('2026-123_Z')).toEqual({ year: 2026, number: 123, letter: 'Z' });
    });

    it('parsuje starszy format RRRR-NN bez litery firmy', () => {
      expect(parseProjectCode('2026-04')).toEqual({ year: 2026, number: 4, letter: undefined });
      expect(parseProjectCode('2025-120')).toEqual({ year: 2025, number: 120, letter: undefined });
    });

    it('zwraca null dla niepasujących kodów tekstowych', () => {
      expect(parseProjectCode('HALA')).toBeNull();
      expect(parseProjectCode('2026-1000_A')).toBeNull();
      expect(parseProjectCode('')).toBeNull();
    });
  });

  describe('getNextProjectCode — tryb wspólny dla roku (scope = "year")', () => {
    it('pierwszy numer w roku z firmą ma postać RRRR-1_L bez zer wiodących', () => {
      expect(getNextProjectCode([], [], COMPANIES, 'comp-a', 2026, 'year')).toBe('2026-1_A');
    });

    it('inkrementuje wspólną sekwencję między różnymi firmami w tym samym roku', () => {
      const projects = [
        makeProject('p1', '2026-1_A', { companyId: 'comp-a' }),
        makeProject('p2', '2026-2_B', { companyId: 'comp-b' }),
      ];
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-a', 2026, 'year')).toBe('2026-3_A');
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-b', 2026, 'year')).toBe('2026-3_B');
    });

    it('zachowuje max + 1 przy lukach w numeracji', () => {
      const projects = [
        makeProject('p1', '2026-1_A', { companyId: 'comp-a' }),
        makeProject('p5', '2026-5_B', { companyId: 'comp-b' }),
      ];
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-a', 2026, 'year')).toBe('2026-6_A');
    });

    it('parsuje istniejące numery w starym formacie RRRR-NN jako źródło największej liczby w roku', () => {
      const projects = [makeProject('p1', '2026-04')];
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-a', 2026, 'year')).toBe('2026-5_A');
    });

    it('uwzględnia projekty zarchiwizowane i znajdujące się w koszu (ignoruje zadania w koszu)', () => {
      const archived = [makeProject('p1', '2026-3_A', { isArchived: true, companyId: 'comp-a' })];
      const trashed: TrashEntry[] = [
        makeTrashedProject('p2', '2026-7_B', 'comp-b'),
        {
          id: 'tr-task-1',
          type: 'task',
          title: 'Usunięte zadanie',
          code: '2026-99_A',
          projectId: 'p1',
          deletedAt: '2026-05-01T10:00:00.000Z',
          deletedBy: 'usr-admin',
          deletedByName: 'Admin',
          expiresAt: '2026-06-01T10:00:00.000Z',
          payload: {
            task: {
              id: 't1',
              projectId: 'p1',
              code: '2026-999',
              title: 'Zadanie testowe',
              description: '',
              type: 'task',
              status: 'to_do',
              priority: 'normal',
              startDate: '2026-01-01',
              dueDate: '2026-01-05',
              durationDays: 5,
              progress: 0,
              reporterId: 'usr-admin',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            comments: [],
            links: {
              blockingTaskIds: [],
              dependencies: [],
              childTaskIds: [],
              dependentTaskIds: [],
            },
          },
        },
      ];
      expect(getNextProjectCode(archived, trashed, COMPANIES, 'comp-a', 2026, 'year')).toBe('2026-8_A');
    });

    it('rozpoczyna od 1 w nowym roku oraz używa bieżącego roku jako domyślnego (brak zaszytego 2026)', () => {
      const currentYear = new Date().getFullYear();
      const oldProjects = [makeProject('p1', '2024-99_A', { companyId: 'comp-a' })];
      expect(getNextProjectCode(oldProjects, [], COMPANIES, 'comp-a', currentYear + 1, 'year')).toBe(
        `${currentYear + 1}-1_A`
      );
      expect(getNextProjectCode(oldProjects, [], COMPANIES, 'comp-a')).toBe(`${currentYear}-1_A`);
    });

    it('rzuca błąd "Wyczerpano numerację w roku" po osiągnięciu 999', () => {
      const projects = [makeProject('p999', '2026-999_A', { companyId: 'comp-a' })];
      expect(() =>
        getNextProjectCode(projects, [], COMPANIES, 'comp-b', 2026, 'year')
      ).toThrow('Wyczerpano numerację w roku');
    });
  });

  describe('getNextProjectCode — osobna numeracja per firma (scope = "company")', () => {
    it('prowadzi niezależne liczniki dla każdej litery firmy', () => {
      const projects = [
        makeProject('p1', '2026-1_A', { companyId: 'comp-a' }),
        makeProject('p2', '2026-2_A', { companyId: 'comp-a' }),
        makeProject('p3', '2026-1_B', { companyId: 'comp-b' }),
      ];
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-a', 2026, 'company')).toBe('2026-3_A');
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-b', 2026, 'company')).toBe('2026-2_B');
    });

    it('rzuca "Wyczerpano numerację w roku" tylko dla firmy z wyczerpanym zakresem 999', () => {
      const projects = [makeProject('p999', '2026-999_A', { companyId: 'comp-a' })];
      expect(() =>
        getNextProjectCode(projects, [], COMPANIES, 'comp-a', 2026, 'company')
      ).toThrow('Wyczerpano numerację w roku');
      expect(getNextProjectCode(projects, [], COMPANIES, 'comp-b', 2026, 'company')).toBe('2026-1_B');
    });
  });

  describe('getNextProjectCode bez firmy (kompatybilność wsteczna)', () => {
    it('zwraca format RRRR-NN gdy nie wybrano firmy', () => {
      const year = new Date().getFullYear();
      const projects = [makeProject('p1', `${year}-04`)];
      expect(getNextProjectCode(projects)).toBe(`${year}-05`);
    });
  });

  describe('isValidProjectCodeFormat i isProjectCodeAvailable', () => {
    it('akceptuje zarówno RRRR-X_L, RRRR-NN, jak i starsze formaty alfanumeryczne', () => {
      expect(isValidProjectCodeFormat('2026-1_A')).toBe(true);
      expect(isValidProjectCodeFormat('2026-123_Z')).toBe(true);
      expect(isValidProjectCodeFormat('2026-04')).toBe(true);
      expect(isValidProjectCodeFormat('HALA-2026')).toBe(true);
      expect(isValidProjectCodeFormat('X')).toBe(false);
    });

    it('sprawdza unikalność bez rozróżniania wielkości liter', () => {
      const projects = [makeProject('p1', '2026-1_A')];
      expect(isProjectCodeAvailable('2026-1_a', projects)).toBe(false);
      expect(isProjectCodeAvailable('2026-1_A', projects, 'p1')).toBe(true);
      expect(isProjectCodeAvailable('2026-2_A', projects)).toBe(true);
    });
  });
});
