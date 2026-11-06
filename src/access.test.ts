import { describe, it, expect } from 'vitest';
import {
  filterStateForUser,
  filterProjectForUser,
  canAccessProject,
  canWrite,
  hasForbiddenKeys,
  pickAllowedTaskFields,
  pickAllowedProjectFields,
  FINANCIAL_AND_CLIENT_FIELDS,
} from './utils/access';

describe('Kontrola dostępu (RBAC), filtrowanie danych i whitelista pól (access.ts)', () => {
  const adminUser = { id: 'usr-admin', name: 'Admin', role: 'admin' as const };
  const pmUser = { id: 'usr-pm', name: 'Manager', role: 'project_manager' as const };
  const devUser = { id: 'usr-dev', name: 'Developer', role: 'developer' as const };
  const viewerUser = { id: 'usr-viewer', name: 'Viewer', role: 'viewer' as const };

  const sampleState = {
    revision: 10,
    projects: [
      {
        id: 'prj-allowed',
        key: 'PRJ1',
        name: 'Projekt Dostępny',
        description: 'Dostępny dla programisty',
        memberIds: ['usr-dev', 'usr-admin'],
        budget: '500 000 PLN',
        costs: [{ id: 'c1', projectId: 'prj-allowed', title: 'Geodezja', amountNet: 5000, amountGross: 6150, category: 'geologia', date: '2026-11-01', status: 'paid' }],
        quotations: [{ id: 'q1', title: 'Wycena główna', quantity: 1, unit: 'kpl', unitPriceNet: 50000, totalNet: 50000, totalGross: 61500, vatRate: 23, status: 'accepted' }],
        projectValue: 500000,
        projectValueGross: 615000,
        projectVatRate: 23,
        clientName: 'Inwestor Budowlany S.A.',
        clientContactPerson: 'Jan Kowalski',
        clientPhone: '+48 600 100 200',
        clientEmail: 'inwestor@example.com',
        clientNip: '1234567890',
        clientAddress: 'ul. Prosta 1, Warszawa',
        color: '#3b82f6',
      },
      {
        id: 'prj-foreign',
        key: 'PRJ2',
        name: 'Projekt Poufny Cudzy',
        description: 'Tylko dla zarządu',
        memberIds: ['usr-admin', 'usr-pm'],
        budget: '2 000 000 PLN',
        costs: [{ id: 'c2', projectId: 'prj-foreign', title: 'Architektura', amountNet: 100000, amountGross: 123000, category: 'podwykonawca', date: '2026-11-01', status: 'paid' }],
        projectValue: 2000000,
        clientName: 'Tajna Spółka z o.o.',
        clientEmail: 'tajne@example.com',
        color: '#ef4444',
      },
    ],
    tasks: [
      {
        id: 'tsk-1',
        projectId: 'prj-allowed',
        title: 'Zadanie w dozwolonym projekcie',
        assigneeId: 'usr-dev',
        reporterId: 'usr-admin',
      },
      {
        id: 'tsk-2',
        projectId: 'prj-foreign',
        title: 'Zadanie w cudzym projekcie',
        assigneeId: 'usr-pm',
        reporterId: 'usr-admin',
      },
      {
        id: 'tsk-3',
        projectId: 'prj-foreign',
        title: 'Zadanie w cudzym projekcie przypisane do dev',
        assigneeId: 'usr-dev',
        reporterId: 'usr-admin',
      },
    ],
    comments: [
      { id: 'com-1', taskId: 'tsk-1', userId: 'usr-dev', content: 'Komentarz do tsk-1' },
      { id: 'com-2', taskId: 'tsk-2', userId: 'usr-pm', content: 'Komentarz do tsk-2' },
      { id: 'com-3', taskId: 'tsk-3', userId: 'usr-dev', content: 'Komentarz do tsk-3' },
    ],
    activityLogs: [
      { id: 'act-1', projectId: 'prj-allowed', taskId: 'tsk-1', userId: 'usr-dev', action: 'Edycja zadania' },
      { id: 'act-2', projectId: 'prj-foreign', taskId: 'tsk-2', userId: 'usr-pm', action: 'Nowy etap' },
    ],
  };

  describe('1. canAccessProject', () => {
    it('admin i project_manager mają dostęp do każdego projektu', () => {
      const foreignProject = sampleState.projects[1];
      expect(canAccessProject(adminUser, foreignProject)).toBe(true);
      expect(canAccessProject(pmUser, foreignProject)).toBe(true);
    });

    it('developer ma dostęp tylko do projektów, w których jest członkiem (memberIds)', () => {
      const allowedProject = sampleState.projects[0];
      const foreignProject = sampleState.projects[1];
      expect(canAccessProject(devUser, allowedProject)).toBe(true);
      expect(canAccessProject(devUser, foreignProject)).toBe(false);
    });
  });

  describe('2. developer nie widzi cudzego projektu i jego finansów (filterStateForUser)', () => {
    it('developer otrzymuje tylko projekty, w których jest w memberIds', () => {
      const filtered = filterStateForUser(sampleState, devUser);
      expect(filtered.projects).toHaveLength(1);
      expect(filtered.projects[0].id).toBe('prj-allowed');
      expect(filtered.projects.find((p: any) => p.id === 'prj-foreign')).toBeUndefined();
    });

    it('developer nie widzi pól finansowych ani danych klienta (budget, costs, quotations, client*)', () => {
      const filtered = filterStateForUser(sampleState, devUser);
      const project = filtered.projects[0];

      // Pola finansowe
      expect(project.budget).toBeUndefined();
      expect(project.costs).toBeUndefined();
      expect(project.quotations).toBeUndefined();
      expect(project.projectValue).toBeUndefined();
      expect(project.projectValueGross).toBeUndefined();
      expect(project.projectVatRate).toBeUndefined();

      // Pola klienta (wszystkie client*)
      expect(project.clientName).toBeUndefined();
      expect(project.clientContactPerson).toBeUndefined();
      expect(project.clientPhone).toBeUndefined();
      expect(project.clientEmail).toBeUndefined();
      expect(project.clientNip).toBeUndefined();
      expect(project.clientAddress).toBeUndefined();

      // Standardowe dane projektu są widoczne
      expect(project.id).toBe('prj-allowed');
      expect(project.name).toBe('Projekt Dostępny');
      expect(project.key).toBe('PRJ1');
      expect(project.color).toBe('#3b82f6');
    });

    it('developer widzi zadania ze swoich projektów oraz zadania przypisane/zgłoszone przez niego', () => {
      const filtered = filterStateForUser(sampleState, devUser);
      const taskIds = filtered.tasks.map((t: any) => t.id);

      expect(taskIds).toContain('tsk-1'); // Z projektu dozwolonego
      expect(taskIds).toContain('tsk-3'); // Z cudzego projektu, ale przypisane do usr-dev
      expect(taskIds).not.toContain('tsk-2'); // Z cudzego projektu i nieprzypisane do usr-dev
    });

    it('developer widzi komentarze i logi powiązane wyłącznie z dostępnymi zadaniami/projektami', () => {
      const filtered = filterStateForUser(sampleState, devUser);
      const commentIds = filtered.comments.map((c: any) => c.id);
      expect(commentIds).toContain('com-1');
      expect(commentIds).toContain('com-3');
      expect(commentIds).not.toContain('com-2'); // Komentarz do tsk-2 nie jest widoczny

      const logIds = filtered.activityLogs.map((l: any) => l.id);
      expect(logIds).toContain('act-1');
      expect(logIds).not.toContain('act-2'); // Log z cudzego projektu
    });
  });

  describe('3. developer nie przenosi zadania do cudzego projektu (pickAllowedTaskFields)', () => {
    it('developer nie może edytować pola projectId', () => {
      const patch = {
        title: 'Zaktualizowany tytuł',
        projectId: 'prj-foreign',
        description: 'Nowy opis',
      };
      const allowed = pickAllowedTaskFields(patch, devUser);
      expect(allowed.title).toBe('Zaktualizowany tytuł');
      expect(allowed.description).toBe('Nowy opis');
      expect(allowed.projectId).toBeUndefined(); // Ignorowane dla developera
    });

    it('admin i project_manager mogą zmienić projectId zadania', () => {
      const patch = { projectId: 'prj-foreign' };
      const allowedAdmin = pickAllowedTaskFields(patch, adminUser);
      const allowedPm = pickAllowedTaskFields(patch, pmUser);
      expect(allowedAdmin.projectId).toBe('prj-foreign');
      expect(allowedPm.projectId).toBe('prj-foreign');
    });

    it('pola id, revision, createdAt, reporterId nigdy nie są edytowalne przez nikogo', () => {
      const maliciousPayload = {
        id: 'fake-id',
        revision: 999,
        createdAt: '2020-01-01T00:00:00Z',
        reporterId: 'fake-reporter',
        title: 'Legalny tytuł',
      };
      const resultAdmin = pickAllowedTaskFields(maliciousPayload, adminUser);
      expect(resultAdmin.id).toBeUndefined();
      expect(resultAdmin.revision).toBeUndefined();
      expect(resultAdmin.createdAt).toBeUndefined();
      expect(resultAdmin.reporterId).toBeUndefined();
      expect(resultAdmin.title).toBe('Legalny tytuł');
    });
  });

  describe('4. developer nie zmienia memberIds ani klucza projektu (pickAllowedProjectFields)', () => {
    it('developer nie może modyfikować memberIds ani key projektu', () => {
      const patch = {
        name: 'Nowa legalna nazwa',
        memberIds: ['usr-dev', 'attacker-id'],
        key: 'HACK',
        progress: 80,
      };
      const allowed = pickAllowedProjectFields(patch, devUser);
      expect(allowed.name).toBe('Nowa legalna nazwa');
      expect(allowed.progress).toBe(80);
      expect(allowed.memberIds).toBeUndefined();
      expect(allowed.key).toBeUndefined();
    });

    it('admin i project_manager mogą modyfikować memberIds oraz key projektu', () => {
      const patch = {
        memberIds: ['usr-dev', 'usr-pm'],
        key: 'NOWY',
      };
      const allowedAdmin = pickAllowedProjectFields(patch, adminUser);
      expect(allowedAdmin.memberIds).toEqual(['usr-dev', 'usr-pm']);
      expect(allowedAdmin.key).toBe('NOWY');
    });

    it('developer nie może edytować ani wstrzykiwać pól finansowych w projekcie', () => {
      const patch = {
        budget: '10 000 000 PLN',
        clientName: 'Fake Client',
        name: 'Dozwolona nazwa',
      };
      const allowed = pickAllowedProjectFields(patch, devUser);
      expect(allowed.budget).toBeUndefined();
      expect(allowed.clientName).toBeUndefined();
      expect(allowed.name).toBe('Dozwolona nazwa');
    });
  });

  describe('5. admin widzi wszystko (filterStateForUser)', () => {
    it('admin otrzymuje wszystkie projekty, zadania i zachowuje pełne dane finansowe oraz klienta', () => {
      const filtered = filterStateForUser(sampleState, adminUser);
      expect(filtered.projects).toHaveLength(2);

      const prj1 = filtered.projects.find((p: any) => p.id === 'prj-allowed');
      expect(prj1.budget).toBe('500 000 PLN');
      expect(prj1.costs).toBeDefined();
      expect(prj1.quotations).toBeDefined();
      expect(prj1.clientName).toBe('Inwestor Budowlany S.A.');
      expect(prj1.clientEmail).toBe('inwestor@example.com');

      const prj2 = filtered.projects.find((p: any) => p.id === 'prj-foreign');
      expect(prj2.budget).toBe('2 000 000 PLN');
      expect(prj2.clientName).toBe('Tajna Spółka z o.o.');

      expect(filtered.tasks).toHaveLength(3);
      expect(filtered.comments).toHaveLength(3);
      expect(filtered.activityLogs).toHaveLength(2);
    });

    it('project_manager również zachowuje pełne dane finansowe i widzi wszystkie projekty', () => {
      const filtered = filterStateForUser(sampleState, pmUser);
      expect(filtered.projects).toHaveLength(2);
      expect(filtered.projects[0].budget).toBeDefined();
      expect(filtered.projects[0].clientName).toBeDefined();
    });
  });

  describe('6. viewer nie zapisuje (canWrite)', () => {
    it('canWrite zwraca false wyłącznie dla roli viewer', () => {
      expect(canWrite(viewerUser)).toBe(false);
      expect(canWrite(devUser)).toBe(true);
      expect(canWrite(adminUser)).toBe(true);
      expect(canWrite(pmUser)).toBe(true);
      expect(canWrite(null)).toBe(false);
      expect(canWrite(undefined)).toBe(false);
    });
  });

  describe('7. Odrzucanie prototypowych kluczy (__proto__, constructor, prototype)', () => {
    it('hasForbiddenKeys wykrywa niebezpieczne klucze', () => {
      expect(hasForbiddenKeys({ title: 'Normal' })).toBe(false);
      expect(hasForbiddenKeys({ __proto__: { admin: true } })).toBe(true);
      expect(hasForbiddenKeys({ constructor: { name: 'Evil' } })).toBe(true);
      expect(hasForbiddenKeys({ prototype: { hack: true } })).toBe(true);
    });

    it('pickAllowedTaskFields oraz pickAllowedProjectFields rzucają błąd przy próbie wstrzyknięcia prototypu', () => {
      expect(() => pickAllowedTaskFields({ __proto__: {} }, devUser)).toThrow();
      expect(() => pickAllowedProjectFields({ constructor: {} }, devUser)).toThrow();
    });
  });

  describe('8. Stała FINANCIAL_AND_CLIENT_FIELDS', () => {
    it('zawiera wszystkie wymagane pola finansowe oraz client*', () => {
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('budget');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('costs');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('quotations');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('projectValue');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('projectValueGross');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('projectVatRate');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('clientName');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('clientContactPerson');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('clientPhone');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('clientEmail');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('clientNip');
      expect(FINANCIAL_AND_CLIENT_FIELDS).toContain('clientAddress');
    });
  });

  describe('9. KRYTERIUM: developer spoza projektu nie dostaje w /api/state ani w ICS żadnych danych tego projektu', () => {
    it('developer spoza projektu prj-foreign nie otrzymuje żadnych jego zadań ani metadanych', () => {
      // Przygotuj stan, w którym developer 'usr-dev' nie ma żadnych zadań w 'prj-foreign'
      const stateWithoutDevInForeign = {
        ...sampleState,
        tasks: [
          {
            id: 'tsk-1',
            projectId: 'prj-allowed',
            title: 'Zadanie w dozwolonym projekcie',
            assigneeId: 'usr-dev',
            reporterId: 'usr-admin',
          },
          {
            id: 'tsk-2',
            projectId: 'prj-foreign',
            title: 'Zadanie w cudzym projekcie',
            assigneeId: 'usr-pm',
            reporterId: 'usr-admin',
          },
        ],
      };

      const filtered = filterStateForUser(stateWithoutDevInForeign, devUser);
      // Brak projektu
      expect(filtered.projects.some((p: any) => p.id === 'prj-foreign')).toBe(false);
      // Brak zadań z tego projektu
      expect(filtered.tasks.some((t: any) => t.projectId === 'prj-foreign')).toBe(false);

      // Symulacja logiki filtrowania feedu kalendarza /api/calendar/:token/all.ics
      const accessibleProjectIds = new Set(
        stateWithoutDevInForeign.projects
          .filter((p: any) => canAccessProject(devUser, p))
          .map((p: any) => p.id)
      );
      const calendarTasks = stateWithoutDevInForeign.tasks.filter(
        (t: any) => accessibleProjectIds.has(t.projectId) || t.assigneeId === devUser.id || t.reporterId === devUser.id
      );

      expect(calendarTasks).toHaveLength(1);
      expect(calendarTasks[0].id).toBe('tsk-1');
      expect(calendarTasks.some((t: any) => t.projectId === 'prj-foreign')).toBe(false);
    });
  });
});

