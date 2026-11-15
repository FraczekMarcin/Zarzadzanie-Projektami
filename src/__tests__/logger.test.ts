import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger, resolveLogFormat, resolveLogLevel } from '../server/logger.js';
import { JsonFileStateStore } from '../utils/stateStore.js';

describe('Structured server logger (src/server/logger.ts)', () => {
  const prevLevel = process.env.LOG_LEVEL;
  const prevFormat = process.env.LOG_FORMAT;

  afterEach(() => {
    if (prevLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prevLevel;

    if (prevFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = prevFormat;
  });

  it('domyślnie używa poziomu info i formatu text z prefiksem czasu ISO oraz poziomu', () => {
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
    expect(resolveLogLevel()).toBe('info');
    expect(resolveLogFormat()).toBe('text');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const fixedDate = new Date('2026-11-15T10:15:30.123Z');
    const log = createLogger({
      writeStdout: (l) => stdout.push(l),
      writeStderr: (l) => stderr.push(l),
      now: () => fixedDate,
    });

    log.debug('ukryty wpis debug');
    log.info('start serwera');
    log.warn('ostrzeżenie testowe');
    log.error('błąd krytyczny', new Error('Awaria dysku'));

    expect(stdout).toEqual(['2026-11-15T10:15:30.123Z [INFO] start serwera']);
    expect(stderr).toHaveLength(2);
    expect(stderr[0]).toBe('2026-11-15T10:15:30.123Z [WARN] ostrzeżenie testowe');
    expect(stderr[1]).toContain('2026-11-15T10:15:30.123Z [ERROR] błąd krytyczny');
    expect(stderr[1]).toContain('Awaria dysku');
  });

  it('filtruje wpisy zgodnie z LOG_LEVEL (debug / warn / error)', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const log = createLogger({
      writeStdout: (l) => stdout.push(l),
      writeStderr: (l) => stderr.push(l),
    });

    process.env.LOG_LEVEL = 'debug';
    log.debug('widoczny debug');
    expect(stdout).toHaveLength(1);

    process.env.LOG_LEVEL = 'warn';
    log.debug('pominięty debug');
    log.info('pominięty info');
    log.warn('widoczny warn');
    log.error('widoczny error');
    expect(stdout).toHaveLength(1);
    expect(stderr).toHaveLength(2);

    process.env.LOG_LEVEL = 'error';
    log.warn('pominięty warn');
    log.error('ostatni error');
    expect(stderr).toHaveLength(3);
  });

  it('obsługuje LOG_FORMAT=json emitując dokładnie jedną linię JSON na wpis', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.LOG_FORMAT = 'json';

    const stdout: string[] = [];
    const stderr: string[] = [];
    const fixedDate = new Date('2026-11-15T10:15:30.000Z');
    const log = createLogger({
      writeStdout: (l) => stdout.push(l),
      writeStderr: (l) => stderr.push(l),
      now: () => fixedDate,
    });

    log.info('żądanie obsłużone');
    log.error('wyjątek', new Error('Zły format'));

    expect(stdout).toHaveLength(1);
    expect(stdout[0]).not.toContain('\n');
    const parsedInfo = JSON.parse(stdout[0]);
    expect(parsedInfo).toEqual({
      timestamp: '2026-11-15T10:15:30.000Z',
      level: 'info',
      message: 'żądanie obsłużone',
    });

    expect(stderr).toHaveLength(1);
    expect(stderr[0]).not.toContain('\n');
    const parsedErr = JSON.parse(stderr[0]);
    expect(parsedErr.timestamp).toBe('2026-11-15T10:15:30.000Z');
    expect(parsedErr.level).toBe('error');
    expect(parsedErr.message).toBe('wyjątek');
    expect(parsedErr.details.message).toBe('Zły format');
  });
});

describe('Prywatność logów startowych (brak adresów e-mail oraz imion/nazwisk)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-log-privacy-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('JsonFileStateStore przy błędzie odszyfrowania 2FA loguje wyłącznie userId bez adresu e-mail ani nazwiska', async () => {
    const stateFile = path.join(tmpDir, 'app_state.json');
    const secretOld = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const secretNew = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    const writer = new JsonFileStateStore({
      filePath: stateFile,
      appSecret: secretOld,
      isProduction: true,
    });
    await writer.save({
      initialized: true,
      revision: 1,
      tasks: [],
      projects: [],
      comments: [],
      activityLogs: [],
      users: [
        {
          id: 'user-privacy-1',
          name: 'Jan Kowalski',
          email: 'jan.kowalski@pracownia.pl',
          twoFactorEnabled: true,
          twoFactorSecret: 'JBSWY3DPEHPK3PXP',
        },
      ],
    });

    const stderrChunks: string[] = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;

    try {
      const reader = new JsonFileStateStore({
        filePath: stateFile,
        appSecret: secretNew,
        isProduction: false,
        reset2faOnStart: true,
      });
      await reader.load();
    } finally {
      process.stderr.write = origStderrWrite;
    }

    const joined = stderrChunks.join('\n');
    expect(joined).toContain('user-privacy-1');
    expect(joined).not.toContain('jan.kowalski@pracownia.pl');
    expect(joined).not.toContain('Jan Kowalski');
  });
});
