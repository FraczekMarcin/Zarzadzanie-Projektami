import { describe, it, expect } from 'vitest';
import {
  MAX_TASK_DEPTH,
  canReparent,
  getDepth,
  getSubtreeHeight,
  reconcileParentCompletionOnReparent,
  type TaskTreeNodeLike,
} from '../utils/taskTree';

describe('Walidacja hierarchii zadań parentId (taskTree.ts)', () => {
  const baseTasks: TaskTreeNodeLike[] = [
    { id: 't1', projectId: 'p1' }, // głębokość 1
    { id: 't2', projectId: 'p1', parentId: 't1' }, // głębokość 2
    { id: 't3', projectId: 'p1', parentId: 't2' }, // głębokość 3
    { id: 't4', projectId: 'p1', parentId: 't3' }, // głębokość 4
    { id: 't5', projectId: 'p1', parentId: 't4' }, // głębokość 5
    { id: 't6', projectId: 'p1', parentId: 't5' }, // głębokość 6 (maks.)
    { id: 'other-proj-task', projectId: 'p2' },
  ];

  it('wylicza głębokość zadań w drzewie oraz wysokość poddrzewa', () => {
    expect(MAX_TASK_DEPTH).toBe(6);
    expect(getDepth(baseTasks, 't1')).toBe(1);
    expect(getDepth(baseTasks, 't3')).toBe(3);
    expect(getDepth(baseTasks, 't6')).toBe(6);
    expect(getDepth(baseTasks, 'missing')).toBe(0);

    expect(getSubtreeHeight(baseTasks, 't6')).toBe(1);
    expect(getSubtreeHeight(baseTasks, 't5')).toBe(2);
    expect(getSubtreeHeight(baseTasks, 't1')).toBe(6);
  });

  it('odrzuca przypisanie zadania do samego siebie (self-parenting)', () => {
    const res = canReparent(baseTasks, 't1', 't1', 'p1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('własnym zadaniem nadrzędnym');
  });

  it('odrzuca przypisanie prowadzące do cyklu w hierarchii', () => {
    const resDirect = canReparent(baseTasks, 't1', 't2', 'p1');
    expect(resDirect.ok).toBe(false);
    expect(resDirect.error).toContain('cykl');

    const resDeep = canReparent(baseTasks, 't2', 't6', 'p1');
    expect(resDeep.ok).toBe(false);
    expect(resDeep.error).toContain('cykl');
  });

  it('odrzuca parentId z innego projektu lub nieistniejące', () => {
    const crossProj = canReparent(baseTasks, 't2', 'other-proj-task', 'p1');
    expect(crossProj.ok).toBe(false);
    expect(crossProj.error).toContain('tego samego projektu');

    const missing = canReparent(baseTasks, 't2', 'does-not-exist', 'p1');
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('nie istnieje');
  });

  it('wymusza maksymalną głębokość 6 poziomów (dla nowego zadania i przenoszonego poddrzewa)', () => {
    // Nowe zadanie pod t5 -> poziom 6 (OK)
    expect(canReparent(baseTasks, null, 't5', 'p1').ok).toBe(true);
    // Nowe zadanie pod t6 -> poziom 7 (Błąd)
    const tooDeep = canReparent(baseTasks, null, 't6', 'p1');
    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.error).toContain('6');

    // Przeniesienie poddrzewa o wysokości 2 (subRoot -> subLeaf) pod t5 dałoby głębokość 7 (Błąd)
    const subtreeTasks: TaskTreeNodeLike[] = [
      ...baseTasks,
      { id: 'subRoot', projectId: 'p1' },
      { id: 'subLeaf', projectId: 'p1', parentId: 'subRoot' },
    ];
    const moveSubtreeTooDeep = canReparent(subtreeTasks, 'subRoot', 't5', 'p1');
    expect(moveSubtreeTooDeep.ok).toBe(false);
    expect(moveSubtreeTooDeep.error).toContain('6');

    // Przeniesienie tego samego poddrzewa pod t4 da głębokość 6 (OK)
    expect(canReparent(subtreeTasks, 'subRoot', 't4', 'p1').ok).toBe(true);
  });

  it('akceptuje pusty ciąg lub null jako usunięcie parentId', () => {
    expect(canReparent(baseTasks, 't2', '', 'p1').ok).toBe(true);
    expect(canReparent(baseTasks, 't2', null, 'p1').ok).toBe(true);
    expect(canReparent(baseTasks, 't2', undefined, 'p1').ok).toBe(true);
  });

  it('pozwala na przenoszenie zadań ukończonych (status done) pod innego rodzica i na poziom główny', () => {
    const doneTasks = [
      { id: 'pA', projectId: 'p1', status: 'done' },
      { id: 'pB', projectId: 'p1', status: 'in_progress' },
      { id: 'doneChild', projectId: 'p1', parentId: 'pA', status: 'done' },
    ];
    expect(canReparent(doneTasks, 'doneChild', 'pB', 'p1').ok).toBe(true);
    expect(canReparent(doneTasks, 'doneChild', null, 'p1').ok).toBe(true);
    expect(canReparent(doneTasks, 'pA', 'pB', 'p1').ok).toBe(true);
  });

  it('przelicza postęp i dwukierunkowo zmienia status rodziców po przeniesieniu podzadania (zachowując daty i zależności)', () => {
    const nowIso = '2026-06-01T10:00:00.000Z';
    const tasks = [
      {
        id: 'oldGrand',
        projectId: 'p1',
        status: 'in_progress',
        progress: 50,
        startDate: '2026-05-01',
        dueDate: '2026-05-20',
        durationDays: 19,
      },
      {
        id: 'oldParent',
        projectId: 'p1',
        parentId: 'oldGrand',
        status: 'in_progress',
        progress: 50,
        startDate: '2026-05-01',
        dueDate: '2026-05-15',
        durationDays: 14,
      },
      {
        id: 'oldSiblingDone',
        projectId: 'p1',
        parentId: 'oldParent',
        status: 'done',
        progress: 100,
        estimatedHours: 10,
      },
      {
        id: 'newParent',
        projectId: 'p1',
        status: 'done',
        progress: 100,
        startDate: '2026-05-02',
        dueDate: '2026-05-18',
        durationDays: 16,
      },
      {
        id: 'newExistingDone',
        projectId: 'p1',
        parentId: 'newParent',
        status: 'done',
        progress: 100,
        estimatedHours: 10,
      },
      {
        id: 'movedChild',
        projectId: 'p1',
        // po przeniesieniu spod oldParent pod newParent:
        parentId: 'newParent',
        status: 'in_progress',
        progress: 20,
        estimatedHours: 10,
        startDate: '2026-05-03',
        dueDate: '2026-05-09',
        durationDays: 6,
        blockingTaskIds: ['oldSiblingDone'],
      },
    ];

    const res = reconcileParentCompletionOnReparent(tasks, {
      movedTaskId: 'movedChild',
      oldParentId: 'oldParent',
      newParentId: 'newParent',
      projectId: 'p1',
      nowIso,
    });

    const oldParentAfter = res.tasks.find((t) => t.id === 'oldParent')!;
    const oldGrandAfter = res.tasks.find((t) => t.id === 'oldGrand')!;
    const newParentAfter = res.tasks.find((t) => t.id === 'newParent')!;
    const movedAfter = res.tasks.find((t) => t.id === 'movedChild')!;

    // Stary rodzic ma teraz wyłącznie ukończone podzadania -> przechodzi na 'done' (100%), a z nim dziadek
    expect(oldParentAfter.status).toBe('done');
    expect(oldParentAfter.progress).toBe(100);
    expect(oldGrandAfter.status).toBe('done');
    expect(oldGrandAfter.progress).toBe(100);

    // Nowy rodzic był 'done', ale otrzymał podzadanie 'in_progress' -> wraca do 'in_progress', postęp (100 + 20) / 2 = 60%
    expect(newParentAfter.status).toBe('in_progress');
    expect(newParentAfter.progress).toBe(60);

    // Daty oraz zależności przeniesionego zadania pozostają nienaruszone
    expect(movedAfter.startDate).toBe('2026-05-03');
    expect(movedAfter.dueDate).toBe('2026-05-09');
    expect(movedAfter.durationDays).toBe(6);
    expect(movedAfter.blockingTaskIds).toEqual(['oldSiblingDone']);
    expect(res.changedStatusParentIds).toContain('oldParent');
    expect(res.changedStatusParentIds).toContain('oldGrand');
    expect(res.changedStatusParentIds).toContain('newParent');
  });
});
