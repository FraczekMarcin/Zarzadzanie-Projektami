import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  buildSecurityEvent,
  rotateIfNeeded,
  sanitizeDetails,
  SecurityLog,
  SecurityEventType,
} from '../utils/securityLog';

describe('securityLog utility & pure functions', () => {
  it('buildSecurityEvent creates valid structure and sets ISO ts', () => {
    const ev = buildSecurityEvent('login_success', {
      userId: 'usr-123',
      email: 'ADMIN@EXAMPLE.COM',
      ip: '192.168.1.50',
      userAgent: 'Mozilla/5.0 Chrome',
      details: { role: 'admin' },
    });

    expect(ev.type).toBe('login_success');
    expect(ev.userId).toBe('usr-123');
    expect(ev.email).toBe('admin@example.com');
    expect(ev.ip).toBe('192.168.1.50');
    expect(ev.userAgent).toBe('Mozilla/5.0 Chrome');
    expect(ev.details).toEqual({ role: 'admin' });
    expect(typeof ev.ts).toBe('string');
    expect(new Date(ev.ts).toISOString()).toBe(ev.ts);
  });

  it('buildSecurityEvent strips email for non-auth/reg events', () => {
    const ev = buildSecurityEvent('password_changed', {
      userId: 'usr-123',
      email: 'test@example.com',
      details: { by: 'admin' },
    });

    expect(ev.type).toBe('password_changed');
    expect(ev.userId).toBe('usr-123');
    expect(ev.email).toBeUndefined(); // email only on login, reg, setup_admin
  });

  it('buildSecurityEvent trims email to 120 chars and userAgent to 100 chars', () => {
    const longEmail = 'a'.repeat(150) + '@example.com';
    const longUa = 'UserAgent-'.repeat(20);

    const ev = buildSecurityEvent('login_failure', {
      email: longEmail,
      userAgent: longUa,
      details: { reason: 'bad_password' },
    });

    expect(ev.email?.length).toBe(120);
    expect(ev.userAgent?.length).toBe(100);
  });

  it('sanitizeDetails recursively strips fields matching password, token, secret, code', () => {
    const dirty = {
      password: 'plain_password',
      newPassword: 'new_pwd',
      user_password_hash: 'hash',
      token: 'jwt-123',
      sessionToken: 'xyz',
      csrf_token: 'abc',
      secret: 'app_secret',
      totpSecret: 'base32',
      code: '123456',
      backupCodes: ['111', '222'],
      totpCode: '654321',
      setupToken: 'sec-token',
      safeField: 'visible',
      nested: {
        api_token: 'secret-val',
        userCode: '999',
        okStatus: true,
        deep: {
          passwordResetHash: 'hash',
          allowedInfo: 'yes',
        },
      },
      list: [
        { code: 'secret-code', name: 'item1' },
        { plainText: 'hello' },
      ],
    };

    const clean = sanitizeDetails(dirty);

    expect(clean.safeField).toBe('visible');
    expect(clean.password).toBeUndefined();
    expect(clean.newPassword).toBeUndefined();
    expect(clean.user_password_hash).toBeUndefined();
    expect(clean.token).toBeUndefined();
    expect(clean.sessionToken).toBeUndefined();
    expect(clean.csrf_token).toBeUndefined();
    expect(clean.secret).toBeUndefined();
    expect(clean.totpSecret).toBeUndefined();
    expect(clean.code).toBeUndefined();
    expect(clean.backupCodes).toBeUndefined();
    expect(clean.totpCode).toBeUndefined();
    expect(clean.setupToken).toBeUndefined();

    expect(clean.nested.api_token).toBeUndefined();
    expect(clean.nested.userCode).toBeUndefined();
    expect(clean.nested.okStatus).toBe(true);
    expect(clean.nested.deep.passwordResetHash).toBeUndefined();
    expect(clean.nested.deep.allowedInfo).toBe('yes');

    expect(clean.list[0].code).toBeUndefined();
    expect(clean.list[0].name).toBe('item1');
    expect(clean.list[1].plainText).toBe('hello');
  });

  it('buildSecurityEvent removes fields containing password, token, secret, code from details', () => {
    const ev = buildSecurityEvent('login_success', {
      userId: 'u-1',
      email: 'u@example.com',
      details: {
        role: 'admin',
        password: '123',
        currentPassword: 'abc',
        authToken: 'tok',
        secretKey: 'sec',
        totpCode: '999888',
        reset_code: '444555',
      },
    });

    expect(ev.details).toEqual({ role: 'admin' });
    expect(JSON.stringify(ev)).not.toContain('123');
    expect(JSON.stringify(ev)).not.toContain('tok');
    expect(JSON.stringify(ev)).not.toContain('sec');
    expect(JSON.stringify(ev)).not.toContain('999888');
  });

  it('rotateIfNeeded correctly checks byte limit', () => {
    expect(rotateIfNeeded(100, 500)).toBe(false);
    expect(rotateIfNeeded(500, 500)).toBe(true);
    expect(rotateIfNeeded(1000, 500)).toBe(true);
  });
});

describe('SecurityLog class file operations & rotation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zp-seclog-test-'));
  });

  afterEach(async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('writes security events as JSONL to security_log.jsonl', async () => {
    const logger = new SecurityLog(tmpDir);

    await logger.record('login_success', {
      userId: 'usr-1',
      email: 'user@test.pl',
      ip: '127.0.0.1',
    });
    await logger.record('password_changed', {
      userId: 'usr-1',
      details: { changedBy: 'self' },
    });

    const logFile = path.join(tmpDir, 'security_log.jsonl');
    expect(fs.existsSync(logFile)).toBe(true);

    const content = await fs.promises.readFile(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    expect(first.type).toBe('login_success');
    expect(first.email).toBe('user@test.pl');

    const second = JSON.parse(lines[1]);
    expect(second.type).toBe('password_changed');
    expect(second.details.changedBy).toBe('self');
  });

  it('reads recent N events in reverse chronological order with optional filtering', async () => {
    const logger = new SecurityLog(tmpDir);

    await logger.record('login_success', { userId: 'u1' });
    await logger.record('login_failure', { email: 'wrong@test.pl', details: { reason: 'bad_password' } });
    await logger.record('twofa_enabled', { userId: 'u1' });

    const recent = await logger.getRecentEvents(10);
    expect(recent.length).toBe(3);
    expect(recent[0].type).toBe('twofa_enabled');
    expect(recent[1].type).toBe('login_failure');
    expect(recent[2].type).toBe('login_success');

    // Filter by type
    const onlyFailures = await logger.getRecentEvents(10, 'login_failure');
    expect(onlyFailures.length).toBe(1);
    expect(onlyFailures[0].type).toBe('login_failure');

    // Limit check
    const single = await logger.getRecentEvents(1);
    expect(single.length).toBe(1);
    expect(single[0].type).toBe('twofa_enabled');
  });

  it('rotates log file when size exceeds maxBytes and preserves 3 rotated files', async () => {
    // maxBytes ustawione na małą wartość np. 300 bajtów
    const logger = new SecurityLog(tmpDir, { maxBytes: 300, maxRotatedFiles: 3 });

    // Zapisujemy tyle zdarzeń, by wymusić kilkukrotną rotację
    for (let i = 1; i <= 15; i++) {
      await logger.record('login_success', {
        userId: `usr-${i}`,
        email: `user${i}@example.com`,
        details: { step: i, padding: 'x'.repeat(40) },
      });
    }

    const mainLog = path.join(tmpDir, 'security_log.jsonl');
    const rot1 = path.join(tmpDir, 'security_log.1.jsonl');
    const rot2 = path.join(tmpDir, 'security_log.2.jsonl');
    const rot3 = path.join(tmpDir, 'security_log.3.jsonl');
    const rot4 = path.join(tmpDir, 'security_log.4.jsonl');

    expect(fs.existsSync(mainLog)).toBe(true);
    expect(fs.existsSync(rot1)).toBe(true);
    expect(fs.existsSync(rot2)).toBe(true);
    expect(fs.existsSync(rot3)).toBe(true);
    expect(fs.existsSync(rot4)).toBe(false); // nie przekracza 3 plików

    // Przy 4 plikach (main + 3 zrotowane) i maxBytes=300, mieści się ok. 7-8 zdarzeń,
    // a najstarsze są bezpiecznie usuwane wraz z rotacją ponad 3 zrotowane pliki.
    const all = await logger.getRecentEvents(50);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.length).toBeLessThanOrEqual(15);
    // Najnowsze zawsze na początku
    expect(all[0].details?.step).toBe(15);
  });

  it('resilience: write error does not throw, logs console.warn', async () => {
    const logger = new SecurityLog(tmpDir);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Zasymuluj błąd zapisu przez mock fs.promises.appendFile
    const origAppend = fs.promises.appendFile;
    vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(new Error('Disk full error simulation'));

    await expect(logger.record('login_success', { userId: 'u1' })).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SecurityLog] Nie można zapisać zdarzenia bezpieczeństwa:'),
      expect.stringContaining('Disk full error simulation')
    );

    warnSpy.mockRestore();
    fs.promises.appendFile = origAppend;
  });
});
