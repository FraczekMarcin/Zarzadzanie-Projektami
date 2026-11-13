import express from 'express';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { isDirectRunEntry } from './src/server/config.js';
import { createApp, CreateAppOptions, CreateAppResult } from './src/server/app.js';
import type { Session } from './src/server/sessions.js';

export { createApp };
export type { CreateAppOptions, CreateAppResult, Session };

const __filename = fileURLToPath(import.meta.url);

if (isDirectRunEntry(__filename, import.meta.url)) {
  const PORT = process.env.PORT || 3000;
  let appClose: (() => Promise<void>) | null = null;
  let server: ReturnType<express.Express['listen']> | null = null;

  try {
    const instance = await createApp({ port: PORT, isDirectRun: true });
    appClose = instance.close;
    server = instance.app.listen(PORT, () => {
      console.log(`Zarządzanie Projektami running on port ${PORT}`);
    });
  } catch (startupErr) {
    console.error('[Server FATAL] Nie udało się uruchomić serwera:', startupErr);
    process.exit(1);
  }

  let isShuttingDown = false;
  async function handleGracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Server] Otrzymano sygnał ${signal}. Trwa wymuszony zapis stanu bazy i zamykanie serwera...`);

    try {
      if (appClose) {
        await appClose();
      }
      console.log('[Server] Stan bazy zapisany bezpiecznie.');
    } catch (err) {
      console.error('[Server] Błąd wymuszonego zapisu stanu przed zamknięciem:', err);
    }

    if (server) {
      server.close(() => {
        console.log('[Server] Serwer HTTP zatrzymany. Do widzenia.');
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
