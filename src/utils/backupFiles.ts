export interface BackupFilenameInfo {
  isBackup: boolean;
  encrypted: boolean;
}

/**
 * Rozpoznaje obsługiwane nazwy plików kopii zapasowych (.json.gz, .json.gz.enc, .sql.gz)
 * i określa, czy kopia jest zaszyfrowana.
 * Ignoruje pliki tymczasowe (.tmp) oraz ukryte (zaczynające się od kropki).
 */
export function parseBackupFilename(filename: string): BackupFilenameInfo {
  if (!filename || typeof filename !== 'string') {
    return { isBackup: false, encrypted: false };
  }

  const trimmed = filename.trim();
  if (!trimmed || trimmed.startsWith('.') || trimmed.endsWith('.tmp') || trimmed.includes('.tmp.')) {
    return { isBackup: false, encrypted: false };
  }

  if (trimmed.endsWith('.json.gz.enc')) {
    return { isBackup: true, encrypted: true };
  }

  if (trimmed.endsWith('.json.gz') || trimmed.endsWith('.sql.gz')) {
    return { isBackup: true, encrypted: false };
  }

  return { isBackup: false, encrypted: false };
}
