import { describe, it, expect } from 'vitest';
import { parseBackupFilename } from '../utils/backupFiles';

describe('parseBackupFilename', () => {
  it('recognizes unencrypted .json.gz backup files', () => {
    expect(parseBackupFilename('app_state_2026-11-13_020000.json.gz')).toEqual({
      isBackup: true,
      encrypted: false,
    });
    expect(parseBackupFilename('manual_backup.json.gz')).toEqual({
      isBackup: true,
      encrypted: false,
    });
  });

  it('recognizes encrypted .json.gz.enc backup files', () => {
    expect(parseBackupFilename('app_state_2026-11-13_020000.json.gz.enc')).toEqual({
      isBackup: true,
      encrypted: true,
    });
  });

  it('recognizes legacy .sql.gz backup files as unencrypted backups', () => {
    expect(parseBackupFilename('legacy_dump.sql.gz')).toEqual({
      isBackup: true,
      encrypted: false,
    });
  });

  it('ignores temporary, hidden, key, and non-backup files', () => {
    expect(parseBackupFilename('.app_state_2026-11-13.tmp.gz')).toEqual({
      isBackup: false,
      encrypted: false,
    });
    expect(parseBackupFilename('app_state_2026-11-13.json.gz.tmp')).toEqual({
      isBackup: false,
      encrypted: false,
    });
    expect(parseBackupFilename('.hidden.json.gz.enc')).toEqual({
      isBackup: false,
      encrypted: false,
    });
    expect(parseBackupFilename('backup.key')).toEqual({
      isBackup: false,
      encrypted: false,
    });
    expect(parseBackupFilename('README.md')).toEqual({
      isBackup: false,
      encrypted: false,
    });
    expect(parseBackupFilename('')).toEqual({
      isBackup: false,
      encrypted: false,
    });
  });
});
