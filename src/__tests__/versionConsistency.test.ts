import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { getLocalInstalledVersion } from '../server/config.js';
import { CURRENT_APP_VERSION } from '../data/dockerConfig.js';
import { generateLinuxCronBackupScript } from '../utils/autoBackup.js';
import { createApp } from '../../server.js';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const VERSION_LITERAL_REGEX = /20\d\d-\d\d-\d\d v\d+\.\d+\.\d+/g;

function collectFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Spójność wersji aplikacji (Single Source of Truth)', () => {
  it('plik VERSION zawiera poprawną pojedynczą linię wersji zgodną z package.json', () => {
    const rawVersion = fs.readFileSync(path.join(ROOT_DIR, 'VERSION'), 'utf-8');
    const lines = rawVersion.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);

    const expectedVersion = lines[0].trim();
    expect(expectedVersion).toMatch(/^20\d\d-\d\d-\d\d v\d+\.\d+\.\d+$/);

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    const semverMatch = expectedVersion.match(/v(\d+\.\d+\.\d+)$/);
    expect(semverMatch).not.toBeNull();
    expect(pkg.version).toBe(semverMatch![1]);
  });

  it('w repozytorium (poza CHANGELOG.md i package-lock.json) nie ma zaszytych literałów wersji innych niż VERSION', () => {
    const expectedVersion = fs.readFileSync(path.join(ROOT_DIR, 'VERSION'), 'utf-8').trim();

    const filesToCheck: string[] = [
      ...collectFilesRecursively(path.join(ROOT_DIR, 'src')),
      path.join(ROOT_DIR, 'index.html'),
      path.join(ROOT_DIR, 'Dockerfile'),
      path.join(ROOT_DIR, 'install.sh'),
      path.join(ROOT_DIR, 'backup.sh'),
      path.join(ROOT_DIR, 'restore-test.sh'),
      path.join(ROOT_DIR, 'README.md'),
    ];

    for (const entry of fs.readdirSync(ROOT_DIR)) {
      if (/^docker-compose.*\.yml$/.test(entry)) {
        filesToCheck.push(path.join(ROOT_DIR, entry));
      }
    }

    const unexpectedLiterals: Array<{ file: string; match: string }> = [];

    for (const filePath of filesToCheck) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      const matches = content.match(VERSION_LITERAL_REGEX);
      if (matches) {
        for (const m of matches) {
          if (m !== expectedVersion || filePath !== path.join(ROOT_DIR, 'VERSION')) {
            unexpectedLiterals.push({
              file: path.relative(ROOT_DIR, filePath),
              match: m,
            });
          }
        }
      }
    }

    expect(unexpectedLiterals).toEqual([]);
  });

  it('stała __APP_VERSION__ w frontendzie i skryptach pochodzi z pliku VERSION', () => {
    const expectedVersion = fs.readFileSync(path.join(ROOT_DIR, 'VERSION'), 'utf-8').trim();
    expect(CURRENT_APP_VERSION).toBe(expectedVersion);

    const backupScript = generateLinuxCronBackupScript();
    expect(backupScript).toContain(`# Wersja: ${expectedVersion}`);
  });

  it('serwer odczytuje wersję z pliku VERSION i respektuje priorytet zmiennej APP_VERSION', async () => {
    const expectedVersion = fs.readFileSync(path.join(ROOT_DIR, 'VERSION'), 'utf-8').trim();
    const prevEnv = process.env.APP_VERSION;

    try {
      delete process.env.APP_VERSION;
      expect(getLocalInstalledVersion()).toBe(expectedVersion);

      // APP_VERSION ze środowiska ma pierwszeństwo
      const overrideVal = 'custom-env-version';
      process.env.APP_VERSION = overrideVal;
      expect(getLocalInstalledVersion()).toBe(overrideVal);

      // Sprawdzenie /api/health z domyślnym odczytem VERSION
      delete process.env.APP_VERSION;
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-ver-test-'));
      const instance = await createApp({
        dataDir,
        appSecret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        isProduction: true,
      });
      const srv = http.createServer(instance.app);
      await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
      try {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') throw new Error('Brak portu');
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.version).toBe(expectedVersion);
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        await instance.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    } finally {
      if (prevEnv === undefined) {
        delete process.env.APP_VERSION;
      } else {
        process.env.APP_VERSION = prevEnv;
      }
    }
  });
});
