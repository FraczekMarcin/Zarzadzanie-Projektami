export type WriteFn = () => Promise<void>;

export interface StateWriterWaiter {
  resolve: () => void;
  reject: (err: any) => void;
}

/**
 * Single-flight atomic state writer.
 *
 * Gwarantuje:
 * 1. Zapis natychmiastowy bez sztucznego opóźnienia (debounce), jeśli żaden zapis nie trwa.
 * 2. Jeśli zapis trwa, stan zostaje oznaczony jako brudny i po jego zakończeniu
 *    wykonywany jest dokładnie jeden kolejny zapis najnowszego stanu.
 * 3. Każde wywołanie zwraca Promise rozwiązywany po zakończeniu zapisu obejmującego jego zmianę
 *    (nigdy po zapisie starszym niż ta zmiana).
 * 4. Błąd zapisu odrzuca Promise wszystkich oczekujących na dany zapis.
 * 5. Brak głodzenia (starvation) przy ciągłym strumieniu żądań.
 */
export class StateWriter {
  private writeFn: WriteFn;
  private writing: boolean = false;
  private dirty: boolean = false;
  private activeWaiters: StateWriterWaiter[] = [];
  private pendingWaiters: StateWriterWaiter[] = [];
  private runningCycle: Promise<void> | null = null;
  private lastWriteError: any = null;

  constructor(writeFn: WriteFn) {
    this.writeFn = writeFn;
  }

  public isWriting(): boolean {
    return this.writing;
  }

  public isDirty(): boolean {
    return this.dirty;
  }

  public markDirty(): void {
    this.dirty = true;
  }

  public save(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.writing) {
        this.writing = true;
        this.activeWaiters.push({ resolve, reject });
        this.startCycle();
      } else {
        this.dirty = true;
        this.pendingWaiters.push({ resolve, reject });
      }
    });
  }

  private startCycle(): void {
    this.runningCycle = this.executeCycle().finally(() => {
      this.runningCycle = null;
      this.writing = false;
    });
    // Zabezpieczenie przed unhandled rejection w tle
    this.runningCycle.catch(() => {});
  }

  private async executeCycle(): Promise<void> {
    while (true) {
      const currentWaiters = this.activeWaiters;
      this.activeWaiters = [];
      this.dirty = false;

      let writeError: any = null;
      try {
        await this.writeFn();
        this.lastWriteError = null;
      } catch (err) {
        writeError = err;
        this.lastWriteError = err;
      }

      if (writeError) {
        for (const w of currentWaiters) {
          w.reject(writeError);
        }
      } else {
        for (const w of currentWaiters) {
          w.resolve();
        }
      }

      if (this.pendingWaiters.length > 0 || this.dirty) {
        this.activeWaiters = this.pendingWaiters;
        this.pendingWaiters = [];
        this.dirty = false;
      } else {
        this.writing = false;
        break;
      }
    }
  }

  public async flush(): Promise<void> {
    while (this.runningCycle) {
      await this.runningCycle;
    }
    if (this.dirty) {
      this.writing = true;
      this.startCycle();
      if (this.runningCycle) {
        await this.runningCycle;
      }
    }
    if (this.lastWriteError) {
      const err = this.lastWriteError;
      this.lastWriteError = null;
      throw err;
    }
  }
}

export function createStateWriter(writeFn: WriteFn): StateWriter {
  return new StateWriter(writeFn);
}
