import express from 'express';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, ServerConfig } from './config.js';
import { logger } from './logger.js';

const MISSING_STATIC_ASSET_EXT_RE = /\.(?:png|svg|ico|jpg|jpeg|webp|gif|avif|webmanifest)$/i;

export async function setupStaticAndSpa(
  app: express.Express,
  config: ServerConfig
): Promise<() => Promise<void>> {
  let viteServer: any = null;

  // Starsze przeglądarki odpytują /favicon.ico — przekieruj na wektorową ikonę
  app.get('/favicon.ico', (_req, res) => {
    res.redirect(302, '/favicon.svg');
  });

  if (!config.isProduction) {
    if (config.enableVite) {
      try {
        const { createServer: createViteServer } = await import('vite');
        viteServer = await createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        });
        app.use(viteServer.middlewares);
        logger.info('[Server] Mounted Vite development middlewares on port ' + config.port);
      } catch (viteErr) {
        logger.warn('[Server] Could not initialize Vite dev middleware:', viteErr);
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
        logger.error(`[Server FATAL] Brak pliku "${indexPath}". Zbuduj frontend (npm run build) przed uruchomieniem serwera produkcyjnego.`);
        throw new Error(`Brak pliku "${indexPath}"`);
      }
      logger.warn(`[Server] Brak katalogu statycznego "${staticDir}" (pominięto serwowanie SPA dla instancji testowej).`);
    } else {
      logger.info(`[Server] Serving static assets from: ${staticDir}`);

      app.use(express.static(staticDir, {
        index: false,
        dotfiles: 'deny',
        setHeaders: (res, filePath) => {
          const normalizedPath = filePath.replace(/\\/g, '/');
          if (normalizedPath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
          } else if (normalizedPath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          }

          if (normalizedPath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (normalizedPath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (MISSING_STATIC_ASSET_EXT_RE.test(normalizedPath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          }
        },
      }));

      // Fallback to index.html for SPA client routing (wyłącznie metody GET i HEAD poza /api oraz brakującymi zasobami graficznymi)
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api')) return next();
        if (MISSING_STATIC_ASSET_EXT_RE.test(req.path)) {
          return res.status(404).type('text/plain; charset=utf-8').send('Nie znaleziono zasobu');
        }

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
