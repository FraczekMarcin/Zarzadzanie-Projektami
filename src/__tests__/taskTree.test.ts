import { describe, it, expect } from 'vitest';
import {
  MAX_TASK_DEPTH,
  canReparent,
  getDepth,
  getSubtreeHeight,
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
});
