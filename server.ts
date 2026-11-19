import express from 'express';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { isDirectRunEntry } from './src/server/config.js';
import { createApp, CreateAppOptions, CreateAppResult } from './src/server/app.js';
import { logger } from './src/server/logger.js';
import type { Session } from './src/server/sessions.js';

export { createApp };
export type { CreateAppOptions, CreateAppResult, Session };

const __filename = fileURLToPath(import.meta.url);

function readCliOption(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1] && !args[i + 1].startsWith('--')) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

if (isDirectRunEntry(__filename, import.meta.url)) {
  process.umask(0o077);
  const cliPort = Number(readCliOption('--port'));
  const PORT = (Number.isFinite(cliPort) && cliPort > 0 ? cliPort : Number(process.env.PORT)) || 3000;
  const HOST = readCliOption('--host')?.trim() || '0.0.0.0';
  let appClose: (() => Promise<void>) | null = null;
  let server: ReturnType<express.Express['listen']> | null = null;

  try {
    const instance = await createApp({ port: PORT, isDirectRun: true });
    appClose = instance.close;
    server = instance.app.listen(PORT, HOST, () => {
      logger.info(`Zarządzanie Projektami running on http://${HOST}:${PORT}`);
    });
  } catch (startupErr) {
    logger.error('[Server FATAL] Nie udało się uruchomić serwera:', startupErr);
    process.exit(1);
  }

  let isShuttingDown = false;
  async function handleGracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`[Server] Otrzymano sygnał ${signal}. Trwa wymuszony zapis stanu bazy i zamykanie serwera...`);

    try {
      if (appClose) {
        await appClose();
      }
      logger.info('[Server] Stan bazy zapisany bezpiecznie.');
    } catch (err) {
      logger.error('[Server] Błąd wymuszonego zapisu stanu przed zamknięciem:', err);
    }

    if (server) {
      server.close(() => {
        logger.info('[Server] Serwer HTTP zatrzymany. Do widzenia.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }

    setTimeout(() => {
      process.exit(0);
    }, 3000).unref();
  }

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
  process.on('beforeExit', async () => {
    try {
      if (appClose) {
        await appClose();
      }
    } catch {}
  });
}
