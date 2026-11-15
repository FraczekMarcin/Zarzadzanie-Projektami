import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createApp } from '../../server.js';
import { JsonFileStateStore } from '../utils/stateStore.js';
import { SecurityLog } from '../utils/securityLog.js';
import { logger } from '../server/logger.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Uprawnienia plików danych serwera (0o600 i umask 0o077)', () => {
  let tmpDir: string;
  let originalUmask: number;

  beforeEach(() => {
    originalUmask = process.umask(0o022);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-perms-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.umask(originalUmask);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('JsonFileStateStore zapisuje app_state.json z uprawnieniami 0o600', async () => {
    const stateFile = path.join(tmpDir, 'app_state.json');
    const store = new JsonFileStateStore({ filePath: stateFile, appSecret: TEST_APP_SECRET });

    await store.save({
      initialized: true,
      revision: 1,
      tasks: [],
      projects: [],
      users: [],
      comments: [],
      activityLogs: [],
    });

    const st = await fs.promises.stat(stateFile);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('SecurityLog zapisuje security_log.jsonl oraz pliki po rotacji z uprawnieniami 0o600', async () => {
    const logger = new SecurityLog(tmpDir, { maxBytes: 250, maxRotatedFiles: 3 });

    for (let i = 1; i <= 15; i++) {
      await logger.record('login_success', {
        userId: `u-${i}`,
        email: `u${i}@pracownia.pl`,
        details: { step: i, pad: 'x'.repeat(40) },
      });
    }

    const expectedFiles = [
      'security_log.jsonl',
      'security_log.1.jsonl',
      'security_log.2.jsonl',
      'security_log.3.jsonl',
    ];

    for (const fileName of expectedFiles) {
      const fullPath = path.join(tmpDir, fileName);
      expect(fs.existsSync(fullPath)).toBe(true);
      const st = await fs.promises.stat(fullPath);
      expect(st.mode & 0o777).toBe(0o600);
    }
  });

  it('createApp ustawia umask 0o077 i zapisuje app_state.json, sessions.json oraz security_log.jsonl z uprawnieniami 0o600', async () => {
    const instance = await createApp({
      dataDir: tmpDir,
      appSecret: TEST_APP_SECRET,
      port: 0,
      isProduction: true,
      setupToken: '',
    });

    expect(process.umask()).toBe(0o077);

    const server = http.createServer(instance.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Brak portu testowego');
      }

      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/setup-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin Uprawnienia',
          email: 'admin@pracownia.pl',
          password: 'Księżyc-Wiosna-2026!',
        }),
      });
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await instance.close();
    }

    for (const fileName of ['app_state.json', 'sessions.json', 'security_log.jsonl']) {
      const fullPath = path.join(tmpDir, fileName);
      expect(fs.existsSync(fullPath), `Oczekiwano pliku ${fileName}`).toBe(true);
      const st = await fs.promises.stat(fullPath);
      expect(st.mode & 0o777, `Nieprawidłowe uprawnienia dla ${fileName}`).toBe(0o600);
    }
  });

  it('zawęża przy starcie szersze uprawnienia istniejących plików danych (0o644 -> 0o600) i tylko ostrzega przy błędzie chmod', async () => {
    const filesToPrecreate = [
      'app_state.json',
      'sessions.json',
      'security_log.jsonl',
      'security_log.1.jsonl',
    ];

    fs.writeFileSync(
      path.join(tmpDir, 'app_state.json'),
      JSON.stringify({ initialized: true, revision: 1, tasks: [], projects: [], users: [], comments: [], activityLogs: [] }),
      { encoding: 'utf-8', mode: 0o644 }
    );
    fs.writeFileSync(path.join(tmpDir, 'sessions.json'), '[]', { encoding: 'utf-8', mode: 0o644 });
    fs.writeFileSync(path.join(tmpDir, 'security_log.jsonl'), '', { encoding: 'utf-8', mode: 0o644 });
    fs.writeFileSync(path.join(tmpDir, 'security_log.1.jsonl'), '', { encoding: 'utf-8', mode: 0o644 });

    for (const fileName of filesToPrecreate) {
      await fs.promises.chmod(path.join(tmpDir, fileName), 0o644);
      const stBefore = await fs.promises.stat(path.join(tmpDir, fileName));
      expect(stBefore.mode & 0o777).toBe(0o644);
    }

    const instance1 = await createApp({
      dataDir: tmpDir,
      appSecret: TEST_APP_SECRET,
      port: 0,
      isProduction: true,
    });
    await instance1.close();

    for (const fileName of filesToPrecreate) {
      const stAfter = await fs.promises.stat(path.join(tmpDir, fileName));
      expect(stAfter.mode & 0o777).toBe(0o600);
    }

    // Symulacja błędu chmod przy starcie (ponownie szersze uprawnienia) -> tylko ostrzeżenie, bez wyjątku
    await fs.promises.chmod(path.join(tmpDir, 'security_log.jsonl'), 0o644);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(fs.promises, 'chmod').mockRejectedValueOnce(new Error('EPERM symulowane'));

    const instance2 = await createApp({
      dataDir: tmpDir,
      appSecret: TEST_APP_SECRET,
      port: 0,
      isProduction: true,
    });
    await instance2.close();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Nie udało się ustawić uprawnień 0o600')
    );
  });
});
