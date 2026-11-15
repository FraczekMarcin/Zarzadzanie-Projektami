export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'text' | 'json';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function resolveLogLevel(raw: string | undefined = process.env.LOG_LEVEL): LogLevel {
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
}

export function resolveLogFormat(raw: string | undefined = process.env.LOG_FORMAT): LogFormat {
  return String(raw ?? '').trim().toLowerCase() === 'json' ? 'json' : 'text';
}

function serializeValueForJson(val: unknown): unknown {
  if (val instanceof Error) {
    return {
      name: val.name,
      message: val.message,
      ...(val.stack ? { stack: val.stack } : {}),
    };
  }
  if (typeof val === 'bigint') {
    return val.toString();
  }
  return val;
}

function formatArgForText(val: unknown): string {
  if (val instanceof Error) {
    return val.stack || val.message || String(val);
  }
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean' || val === null || val === undefined) {
    return String(val);
  }
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  writeStdout?: (line: string) => void;
  writeStderr?: (line: string) => void;
  now?: () => Date;
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const writeStdout = options.writeStdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const writeStderr = options.writeStderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const log = (level: LogLevel, message: string, args: unknown[]) => {
    const minLevel = options.level ?? resolveLogLevel();
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) {
      return;
    }

    const format = options.format ?? resolveLogFormat();
    const timestamp = now().toISOString();
    const emit = level === 'warn' || level === 'error' ? writeStderr : writeStdout;

    if (format === 'json') {
      const payload: Record<string, unknown> = {
        timestamp,
        level,
        message: String(message),
      };
      if (args.length === 1) {
        payload.details = serializeValueForJson(args[0]);
      } else if (args.length > 1) {
        payload.details = args.map(serializeValueForJson);
      }
      try {
        emit(JSON.stringify(payload));
      } catch {
        emit(JSON.stringify({ timestamp, level, message: String(message) }));
      }
      return;
    }

    const extra = args.length > 0 ? ` ${args.map(formatArgForText).join(' ')}` : '';
    emit(`${timestamp} [${level.toUpperCase()}] ${String(message)}${extra}`);
  };

  return {
    debug: (message: string, ...args: unknown[]) => log('debug', message, args),
    info: (message: string, ...args: unknown[]) => log('info', message, args),
    warn: (message: string, ...args: unknown[]) => log('warn', message, args),
    error: (message: string, ...args: unknown[]) => log('error', message, args),
  };
}

export const logger = createLogger();
