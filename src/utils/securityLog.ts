import fs from 'fs';
import path from 'path';

export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'twofa_enabled'
  | 'twofa_disabled'
  | 'twofa_backup_code_used'
  | 'user_created'
  | 'user_deleted'
  | 'user_approved'
  | 'user_role_changed'
  | 'session_revoked'
  | 'registration'
  | 'setup_admin'
  | 'origin_blocked';

export type LoginFailureReason =
  | 'bad_password'
  | 'unknown_user'
  | 'locked_out'
  | 'bad_2fa'
  | 'pending_approval';

export interface SecurityEventInput {
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, any>;
}

export interface SecurityEvent {
  ts: string;
  type: SecurityEventType;
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, any>;
}

const SENSITIVE_KEY_PATTERN = /(password|token|secret|code)/i;

/**
 * Usuwa rekurencyjnie pola o nazwach zawierających password, token, secret, code
 * oraz gwarantuje bezpieczną serializację szczegółów zdarzenia.
 */
export function sanitizeDetails(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeDetails);
  }

  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (value !== undefined) {
      clean[key] = sanitizeDetails(value);
    }
  }
  return clean;
}

/**
 * Czysta funkcja tworząca obiekt zdarzenia bezpieczeństwa:
 * - ts: ISO format
 * - email: małymi literami, obcięty do 120 znaków; tylko dla zdarzeń logowania i rejestracji
 * - userAgent: obcięty do 100 znaków
 * - details: oczyszczony z sekretów
 */
export function buildSecurityEvent(
  type: SecurityEventType,
  input: SecurityEventInput = {}
): SecurityEvent {
  const ts = new Date().toISOString();
  const event: SecurityEvent = {
    ts,
    type,
  };

  if (input.userId && typeof input.userId === 'string') {
    event.userId = input.userId;
  }

  // email dopuszczalny tylko dla logowania i rejestracji
  const isAuthOrReg =
    type === 'login_success' ||
    type === 'login_failure' ||
    type === 'registration' ||
    type === 'setup_admin';

  if (isAuthOrReg && input.email && typeof input.email === 'string') {
    event.email = input.email.trim().toLowerCase().slice(0, 120);
  }

  if (input.ip && typeof input.ip === 'string') {
    event.ip = input.ip;
  }

  if (input.userAgent && typeof input.userAgent === 'string') {
    event.userAgent = input.userAgent.slice(0, 100);
  }

  if (input.details && typeof input.details === 'object') {
    const cleanDetails = sanitizeDetails(input.details);
    if (cleanDetails && Object.keys(cleanDetails).length > 0) {
      event.details = cleanDetails;
    }
  }

  return event;
}

/**
 * Czysta funkcja sprawdzająca czy rozmiar przekracza limit rotacji
 */
export function rotateIfNeeded(sizeBytes: number, maxBytes: number = 5 * 1024 * 1024): boolean {
  return sizeBytes >= maxBytes;
}

export const SECURITY_EVENT_LABELS: Record<SecurityEventType, string> = {
  login_success: 'Udane logowanie',
  login_failure: 'Nieudane logowanie',
  logout: 'Wylogowanie',
  password_changed: 'Zmiana hasła',
  password_reset_requested: 'Żądanie resetu hasła',
  password_reset_completed: 'Zakończenie resetu hasła',
  twofa_enabled: 'Włączenie 2FA',
  twofa_disabled: 'Wyłączenie 2FA',
  twofa_backup_code_used: 'Użycie kodu zapasowego 2FA',
  user_created: 'Utworzenie użytkownika',
  user_deleted: 'Usunięcie użytkownika',
  user_approved: 'Zatwierdzenie użytkownika',
  user_role_changed: 'Zmiana roli użytkownika',
  session_revoked: 'Unieważnienie sesji',
  registration: 'Wniosek rejestracyjny',
  setup_admin: 'Inicjalizacja administratora',
  origin_blocked: 'Zablokowane źródło Origin',
};

/**
 * Klasa SecurityLog zapisująca zdarzenia jako JSONL do security_log.jsonl w DATA_DIR,
 * z asynchronicznym dopisywaniem, rotacją po 5 MB (do security_log.1.jsonl, zachowaj 3 pliki)
 * i bezpiecznym odczytem ostatnich N zdarzeń.
 */
export class SecurityLog {
  private dataDir: string;
  private logPath: string;
  private maxBytes: number;
  private maxRotatedFiles: number;

  constructor(
    dataDir: string,
    options: { maxBytes?: number; maxRotatedFiles?: number } = {}
  ) {
    this.dataDir = dataDir;
    this.logPath = path.join(dataDir, 'security_log.jsonl');
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024; // 5 MB
    this.maxRotatedFiles = options.maxRotatedFiles ?? 3; // 1, 2, 3
  }

  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Wykonuje rotację plików dziennika:
   * security_log.3.jsonl (usunięty)
   * security_log.2.jsonl -> security_log.3.jsonl
   * security_log.1.jsonl -> security_log.2.jsonl
   * security_log.jsonl -> security_log.1.jsonl
   */
  async rotate(): Promise<void> {
    try {
      const oldestPath = path.join(this.dataDir, `security_log.${this.maxRotatedFiles}.jsonl`);
      if (fs.existsSync(oldestPath)) {
        await fs.promises.unlink(oldestPath).catch(() => {});
      }

      for (let i = this.maxRotatedFiles - 1; i >= 1; i--) {
        const src = path.join(this.dataDir, `security_log.${i}.jsonl`);
        const dst = path.join(this.dataDir, `security_log.${i + 1}.jsonl`);
        if (fs.existsSync(src)) {
          await fs.promises.rename(src, dst).catch(() => {});
        }
      }

      if (fs.existsSync(this.logPath)) {
        const firstRotated = path.join(this.dataDir, 'security_log.1.jsonl');
        await fs.promises.rename(this.logPath, firstRotated).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[SecurityLog] Błąd podczas rotacji plików dziennika:', err?.message);
    }
  }

  /**
   * Zapisuje zdarzenie do pliku JSONL. Błąd zapisu nie przerywa wykonania (tylko console.warn).
   */
  async log(event: SecurityEvent): Promise<void> {
    try {
      if (!fs.existsSync(this.dataDir)) {
        await fs.promises.mkdir(this.dataDir, { recursive: true }).catch(() => {});
      }

      // Sprawdź rozmiar przed dopisaniem i wykonaj rotację jeśli trzeba
      try {
        const stats = await fs.promises.stat(this.logPath).catch(() => null);
        if (stats && rotateIfNeeded(stats.size, this.maxBytes)) {
          await this.rotate();
        }
      } catch {
        // Ignoruj błędy sprawdzania rozmiaru
      }

      const line = JSON.stringify(event) + '\n';
      await fs.promises.appendFile(this.logPath, line, 'utf-8');
    } catch (err: any) {
      console.warn('[SecurityLog] Nie można zapisać zdarzenia bezpieczeństwa:', err?.message);
    }
  }

  /**
   * Helper logujący zbudowane zdarzenie
   */
  async record(type: SecurityEventType, input: SecurityEventInput = {}): Promise<void> {
    const event = buildSecurityEvent(type, input);
    await this.log(event);
  }

  /**
   * Odczytuje ostatnie N zdarzeń z pliku security_log.jsonl (oraz rotowanych plików jeśli potrzeba)
   * od najnowszych do najstarszych.
   */
  async getRecentEvents(limit: number = 100, filterType?: SecurityEventType): Promise<SecurityEvent[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const results: SecurityEvent[] = [];

    // Sprawdzamy główny plik oraz pliki zrotowane (1..3)
    const filesToRead = [this.logPath];
    for (let i = 1; i <= this.maxRotatedFiles; i++) {
      filesToRead.push(path.join(this.dataDir, `security_log.${i}.jsonl`));
    }

    for (const filePath of filesToRead) {
      if (!fs.existsSync(filePath)) continue;

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        // Plik czytamy od końca ku początkowi
        for (let i = lines.length - 1; i >= 0; i--) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          try {
            const ev = JSON.parse(trimmed) as SecurityEvent;
            if (filterType && ev.type !== filterType) {
              continue;
            }
            results.push(ev);
            if (results.length >= safeLimit) {
              return results;
            }
          } catch {
            // Pomiń uszkodzoną linię
          }
        }
      } catch (err: any) {
        console.warn(`[SecurityLog] Błąd odczytu pliku ${filePath}:`, err?.message);
      }
    }

    return results;
  }
}
