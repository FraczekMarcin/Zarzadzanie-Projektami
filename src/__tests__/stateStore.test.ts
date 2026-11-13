import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AppState,
  JsonFileStateStore,
  MemoryStateStore,
} from '../utils/stateStore.js';
import { StateWriter } from '../utils/stateWriter.js';
import { isEncryptedSecret } from '../utils/secretBox.js';
import { createApp } from '../../server.js';

const TEST_SECRET_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_SECRET_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

function createSampleState(overrides: Partial<AppState> = {}): AppState {
  return {
    initialized: true,
    revision: 3,
    tasks: [
      {
        id: 't-1',
        projectId: 'p-1',
        code: 'PRJ-01',
        title: 'Projekt koncepcyjny',
        revision: 2,
      },
    ],
    projects: [
      {
        id: 'p-1',
        key: '2026-01',
        name: 'Hala magazynowa',
        revision: 1,
      },
    ],
    users: [
      {
        id: 'u-1',
        email: 'admin@pracownia.pl',
        role: 'admin',
        twoFactorEnabled: true,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
        pending2FA: {
          secret: 'KZXW65TFOJZGS3TH',
          backupCodeHashes: ['h1', 'h2'],
        },
      },
    ],
    comments: [{ id: 'c-1', taskId: 't-1', userId: 'u-1', content: 'Uwaga', createdAt: '2026-11-13T00:00:00Z' }],
    activityLogs: [],
    updatedAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('Abstrakcja magazynu stanu (StateStore)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-statestore-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('JsonFileStateStore', () => {
    it('zwraca null gdy plik app_state.json jeszcze nie istnieje', async () => {
      const filePath = path.join(tmpDir, 'app_state.json');
      const store = new JsonFileStateStore({ filePath, appSecret: TEST_SECRET_A });

      const loaded = await store.load();
      expect(loaded).toBeNull();
    });

    it('zapisuje stan z szyfrowaniem sekretów na dysku i poprawnie go odczytuje', async () => {
      const filePath = path.join(tmpDir, 'app_state.json');
      const store = new JsonFileStateStore({ filePath, appSecret: TEST_SECRET_A });
      const state = createSampleState();

      await store.save(state);

      // Obiekt w pamięci przekazany do save() nie zostaje zmutowany na ciphertext
      expect(state.users[0].twoFactorSecret).toBe('JBSWY3DPEHPK3PXP');
      expect(state.users[0].pending2FA.secret).toBe('KZXW65TFOJZGS3TH');

      // Plik na dysku ma zaszyfrowane sekrety i brak jawnych sekretów
      const rawOnDisk = fs.readFileSync(filePath, 'utf-8');
      expect(rawOnDisk).not.toContain('JBSWY3DPEHPK3PXP');
      expect(rawOnDisk).not.toContain('KZXW65TFOJZGS3TH');
      const parsedOnDisk = JSON.parse(rawOnDisk);
      expect(isEncryptedSecret(parsedOnDisk.users[0].twoFactorSecret)).toBe(true);
      expect(isEncryptedSecret(parsedOnDisk.users[0].pending2FA.secret)).toBe(true);

      // Odczyt przez store.load() odszyfrowuje sekrety i zwraca kompletny stan
      const loaded = await store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.revision).toBe(3);
      expect(loaded!.tasks[0].title).toBe('Projekt koncepcyjny');
      expect(loaded!.users[0].twoFactorSecret).toBe('JBSWY3DPEHPK3PXP');
      expect(loaded!.users[0].pending2FA.secret).toBe('KZXW65TFOJZGS3TH');
    });

    it('zachowuje atomowość: plik tymczasowy nie zostaje po błędzie rename ani zapisu', async () => {
      const filePath = path.join(tmpDir, 'app_state.json');
      const store = new JsonFileStateStore({ filePath, appSecret: TEST_SECRET_A });

      const initial = createSampleState({ revision: 1 });
      await store.save(initial);

      // 1. Symulacja błędu podczas fs.promises.rename
      vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('Symulowany błąd rename'));
      const updated = createSampleState({ revision: 2 });
      await expect(store.save(updated)).rejects.toThrow('Symulowany błąd rename');

      // Plik tymczasowy został usunięty, a poprzedni stan pozostał nienaruszony
      const filesAfterRenameErr = fs.readdirSync(tmpDir);
      expect(filesAfterRenameErr).toEqual(['app_state.json']);
      const loadedAfterRenameErr = await store.load();
      expect(loadedAfterRenameErr?.revision).toBe(1);

      // 2. Symulacja błędu podczas writeFile na pliku tymczasowym
      const realOpen = fs.promises.open;
      vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (p, flags) => {
        const handle = await realOpen(p, flags);
        vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('Symulowany błąd zapisu I/O'));
        return handle;
      });

      await expect(store.save(createSampleState({ revision: 3 }))).rejects.toThrow('Symulowany błąd zapisu I/O');

      const filesAfterWriteErr = fs.readdirSync(tmpDir);
      expect(filesAfterWriteErr).toEqual(['app_state.json']);
      const loadedAfterWriteErr = await store.load();
      expect(loadedAfterWriteErr?.revision).toBe(1);
    });

    it('migruje stare jawne sekrety 2FA i brakujące pola revision przy odczycie', async () => {
      const filePath = path.join(tmpDir, 'app_state.json');
      const legacyPayload = {
        initialized: true,
        tasks: [{ id: 't-legacy', projectId: 'p-legacy', title: 'Stare zadanie' }],
        projects: [{ id: 'p-legacy', key: '2025-01', name: 'Stary projekt' }],
        users: [
          {
            id: 'u-legacy',
            email: 'stary@pracownia.pl',
            twoFactorEnabled: true,
            twoFactorSecret: 'PLAIN_LEGACY_SECRET_32',
            pending2FA: {
              secret: 'PLAIN_PENDING_SECRET_32',
            },
          },
        ],
      };
      fs.writeFileSync(filePath, JSON.stringify(legacyPayload), 'utf-8');

      const store = new JsonFileStateStore({ filePath, appSecret: TEST_SECRET_A });
      const loaded = await store.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.revision).toBe(0);
      expect(loaded!.tasks[0].revision).toBe(1);
      expect(loaded!.projects[0].revision).toBe(1);
      expect(loaded!.users[0].twoFactorSecret).toBe('PLAIN_LEGACY_SECRET_32');
      expect(loaded!.users[0].pending2FA.secret).toBe('PLAIN_PENDING_SECRET_32');

      // Plik na dysku został automatycznie zmigrowany do postaci zaszyfrowanej
      const diskAfterLoad = fs.readFileSync(filePath, 'utf-8');
      expect(diskAfterLoad).not.toContain('PLAIN_LEGACY_SECRET_32');
      expect(diskAfterLoad).not.toContain('PLAIN_PENDING_SECRET_32');
      const parsedDisk = JSON.parse(diskAfterLoad);
      expect(isEncryptedSecret(parsedDisk.users[0].twoFactorSecret)).toBe(true);
      expect(isEncryptedSecret(parsedDisk.users[0].pending2FA.secret)).toBe(true);
    });

    it('odrzuca odczyt błędem przy nieprawidłowym APP_SECRET (w produkcji) oraz obsługuje reset2faOnStart', async () => {
      const filePath = path.join(tmpDir, 'app_state.json');
      const writerStore = new JsonFileStateStore({ filePath, appSecret: TEST_SECRET_A });
      await writerStore.save(createSampleState());

      const wrongKeyStore = new JsonFileStateStore({
        filePath,
        appSecret: TEST_SECRET_B,
        isProduction: true,
      });
      await expect(wrongKeyStore.load()).rejects.toThrow('APP_SECRET nie pasuje do danych w app_state.json');

      // Z flagą reset2faOnStart czyści uszkodzone 2FA zamiast przerywać start
      const resetStore = new JsonFileStateStore({
        filePath,
        appSecret: TEST_SECRET_B,
        isProduction: true,
        reset2faOnStart: true,
      });
      const recovered = await resetStore.load();
      expect(recovered).not.toBeNull();
      expect(recovered!.users[0].twoFactorEnabled).toBe(false);
      expect(recovered!.users[0].twoFactorSecret).toBeUndefined();
      expect(recovered!.users[0].pending2FA).toBeUndefined();
    });
  });

  describe('MemoryStateStore + StateWriter', () => {
    it('zapisuje i izoluje kopie stanu oraz współpracuje z StateWriter przy zapisach równoległych i flush', async () => {
      const memStore = new MemoryStateStore();
      expect(await memStore.load()).toBeNull();

      let currentState = createSampleState({ revision: 1 });
      const saveSpy = vi.spyOn(memStore, 'save');
      const writer = new StateWriter(async () => {
        await new Promise((r) => setTimeout(r, 10));
        await memStore.save(currentState);
      });

      // Równoległe zapisy z mutacją stanu pomiędzy nimi
      const p1 = writer.save();
      await new Promise((r) => setTimeout(r, 2));
      currentState = createSampleState({ revision: 2 });
      const p2 = writer.save();
      currentState = createSampleState({ revision: 3 });
      const p3 = writer.save();

      await Promise.all([p1, p2, p3]);
      await writer.flush();

      // StateWriter zgrupował zapisy (maksymalnie 2 wywołania store.save)
      expect(saveSpy.mock.calls.length).toBeLessThanOrEqual(2);
      const saved = await memStore.load();
      expect(saved?.revision).toBe(3);

      // Mutacja wczytanej kopii nie wpływa na zapisany stan w MemoryStateStore
      saved!.tasks[0].title = 'Zmieniony lokalnie';
      const reloaded = await memStore.load();
      expect(reloaded?.tasks[0].title).toBe('Projekt koncepcyjny');
    });

    it('propaguje błąd zapisu z MemoryStateStore przez StateWriter', async () => {
      const memStore = new MemoryStateStore();
      const state = createSampleState({ revision: 1 });
      vi.spyOn(memStore, 'save').mockRejectedValueOnce(new Error('Błąd zapisu w pamięci'));

      const writer = new StateWriter(async () => {
        await memStore.save(state);
      });

      await expect(writer.save()).rejects.toThrow('Błąd zapisu w pamięci');
    });
  });

  describe('Wybór magazynu przez zmienną STORAGE w createApp', () => {
    it('kończy start błędem Nieobsługiwany typ magazynu dla nieznanej wartości STORAGE', async () => {
      const prevStorage = process.env.STORAGE;
      try {
        process.env.STORAGE = 'postgres';
        await expect(
          createApp({
            dataDir: tmpDir,
            appSecret: TEST_SECRET_A,
            isProduction: true,
          })
        ).rejects.toThrow('Nieobsługiwany typ magazynu');
      } finally {
        if (prevStorage === undefined) {
          delete process.env.STORAGE;
        } else {
          process.env.STORAGE = prevStorage;
        }
      }
    });
  });
});
