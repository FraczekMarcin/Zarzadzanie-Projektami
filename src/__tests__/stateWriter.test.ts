import { describe, it, expect } from 'vitest';
import { StateWriter } from '../utils/stateWriter';

describe('StateWriter (single-flight atomic state saving)', () => {
  it('pojedyncze wywołanie kończy się w czasie krótszym niż 50 ms z szybkim zapisem', async () => {
    let diskWrites = 0;
    const writer = new StateWriter(async () => {
      diskWrites++;
      // Symulacja szybkiego zapisu na dysk (np. 2 ms)
      await new Promise((resolve) => setTimeout(resolve, 2));
    });

    const start = Date.now();
    await writer.save();
    const duration = Date.now() - start;

    expect(diskWrites).toBe(1);
    expect(duration).toBeLessThan(50);
  });

  it('20 równoległych wywołań daje maksymalnie 2 zapisy', async () => {
    let actualDiskWrites = 0;
    const writer = new StateWriter(async () => {
      actualDiskWrites++;
      // Symulacja czasu trwania zapisu (10 ms)
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const calls = Array.from({ length: 20 }, () => writer.save());
    await Promise.all(calls);

    // Pierwsze wywołanie uruchamia 1. zapis, a pozostałe 19 zostaje połączone w dokładnie 2. zapis
    expect(actualDiskWrites).toBeLessThanOrEqual(2);
    expect(actualDiskWrites).toBeGreaterThanOrEqual(1);
  });

  it('każde wywołanie widzi zapis nie starszy niż jego zmiana', async () => {
    let currentStateVersion = 0;
    const snapshotsWritten: number[] = [];

    const writer = new StateWriter(async () => {
      const versionAtWrite = currentStateVersion;
      await new Promise((resolve) => setTimeout(resolve, 15));
      snapshotsWritten.push(versionAtWrite);
    });

    // 1. Zmiana i wywołanie zapisu #1
    currentStateVersion = 1;
    let versionObservedByCall1 = 0;
    const p1 = writer.save().then(() => {
      versionObservedByCall1 = snapshotsWritten[snapshotsWritten.length - 1];
    });

    // 2. Po 5 ms (gdy zapis #1 nadal trwa) następuje zmiana i wywołanie #2
    await new Promise((resolve) => setTimeout(resolve, 5));
    currentStateVersion = 2;
    let versionObservedByCall2 = 0;
    const p2 = writer.save().then(() => {
      versionObservedByCall2 = snapshotsWritten[snapshotsWritten.length - 1];
    });

    await Promise.all([p1, p2]);

    // Wywołanie #1 widziało zapis wersji >= 1
    expect(versionObservedByCall1).toBeGreaterThanOrEqual(1);
    // Wywołanie #2 widziało zapis wersji >= 2 (nie zostało rozwiązane na starszym zapisie #1)
    expect(versionObservedByCall2).toBeGreaterThanOrEqual(2);
    expect(snapshotsWritten).toEqual([1, 2]);
  });

  it('błąd zapisu odrzuca oczekujących', async () => {
    const diskError = new Error('Błąd zapisu I/O na dysku');
    const writer = new StateWriter(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw diskError;
    });

    const p1 = writer.save();
    const p2 = writer.save();

    await expect(p1).rejects.toThrow('Błąd zapisu I/O na dysku');
    await expect(p2).rejects.toThrow('Błąd zapisu I/O na dysku');
  });

  it('brak głodzenia przy ciągłym strumieniu wywołań', async () => {
    let writesCount = 0;
    const writer = new StateWriter(async () => {
      writesCount++;
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    const completionTimes: number[] = [];
    const testStart = Date.now();

    // Ciągły strumień 20 wywołań co 5 ms (łączny czas nadawania: ~100 ms)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const p = writer.save().then(() => {
        completionTimes.push(Date.now() - testStart);
      });
      promises.push(p);
    }

    await Promise.all(promises);

    expect(completionTimes.length).toBe(20);
    // Wykonało się wiele zapisów w trakcie trwania strumienia (brak blokowania)
    expect(writesCount).toBeGreaterThan(1);
    // Pierwsze żądanie rozwiązało się bardzo wcześnie (znacznie przed końcem całego strumienia)
    expect(completionTimes[0]).toBeLessThan(60);
  });

  it('flushPendingStateSave czeka na zakończenie trwającego zapisu i wykonuje ostatni zapis, jeśli stan jest brudny', async () => {
    let writesCount = 0;
    let stateValue = 'initial';
    const savedStates: string[] = [];

    const writer = new StateWriter(async () => {
      writesCount++;
      const current = stateValue;
      await new Promise((resolve) => setTimeout(resolve, 20));
      savedStates.push(current);
    });

    // Uruchomienie zapisu
    stateValue = 'v1';
    const savePromise = writer.save();

    // W trakcie zapisu zmiana stanu i oznaczenie jako brudny
    await new Promise((resolve) => setTimeout(resolve, 5));
    stateValue = 'v2-dirty';
    writer.markDirty();

    // Flush w trakcie trwania zapisu
    await writer.flush();
    await savePromise;

    // Flush poczekał na zapis v1 oraz wykonał ostatni zapis dla stanu brudnego (v2-dirty)
    expect(writesCount).toBe(2);
    expect(savedStates).toEqual(['v1', 'v2-dirty']);

    // Kolejny flush przy czystym stanie nie wykonuje nadmiarowego zapisu
    await writer.flush();
    expect(writesCount).toBe(2);
  });
});
