import express from 'express';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, ServerConfig } from './config.js';

export async function setupStaticAndSpa(
  app: express.Express,
  config: ServerConfig
): Promise<() => Promise<void>> {
  let viteServer: any = null;

  if (!config.isProduction) {
    if (config.enableVite) {
      try {
        const { createServer: createViteServer } = await import('vite');
        viteServer = await createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        });
        app.use(viteServer.middlewares);
        console.log('[Server] Mounted Vite development middlewares on port ' + config.port);
      } catch (viteErr) {
        console.warn('[Server] Could not initialize Vite dev middleware:', viteErr);
      }
    }
  } else {
    const candidatePublicDir = path.join(APP_ROOT, 'public');
    const candidateDistPublicDir = path.resolve(APP_ROOT, 'dist', 'public');
    const staticDir = config.staticDir || (
      fs.existsSync(path.join(candidatePublicDir, 'index.html'))
        ? candidatePublicDir
        : fs.existsSync(path.join(candidateDistPublicDir, 'index.html'))
        ? candidateDistPublicDir
        : candidatePublicDir
    );
    const indexPath = path.join(staticDir, 'index.html');

    if (!fs.existsSync(indexPath)) {
      if (config.isDirectRun) {
        console.error(`[Server FATAL] Brak pliku "${indexPath}". Zbuduj frontend (npm run build) przed uruchomieniem serwera produkcyjnego.`);
        throw new Error(`Brak pliku "${indexPath}"`);
      }
      console.warn(`[Server] Brak katalogu statycznego "${staticDir}" (pominięto serwowanie SPA dla instancji testowej).`);
    } else {
      console.log(`[Server] Serving static assets from: ${staticDir}`);

      app.use(express.static(staticDir, {
        index: false,
        dotfiles: 'deny',
        setHeaders: (res, filePath) => {
          const normalizedPath = filePath.replace(/\\/g, '/');
          if (normalizedPath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (normalizedPath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }));

      // Fallback to index.html for SPA client routing (wyłącznie metody GET i HEAD poza /api) - Cache-Control: no-cache
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api')) return next();

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendFile(indexPath);
      });
    }
  }

  return async () => {
    if (viteServer) {
      await viteServer.close();
      viteServer = null;
    }
  };
}
