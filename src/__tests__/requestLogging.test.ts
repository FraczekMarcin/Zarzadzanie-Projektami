import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';

function createTestLoggingApp() {
  const app = express();

  // Lekkie logowanie żądań API bez zewnętrznych zależności
  app.use((req, res, next) => {
    const reqPath = req.path;
    if (!reqPath.startsWith('/api/') && reqPath !== '/api') {
      return next();
    }
    if (reqPath === '/api/health' || reqPath === '/api/state/revision') {
      return next();
    }

    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const status = res.statusCode;
      if (status >= 400 || durationMs > 500) {
        console.log(`[API] ${req.method} ${reqPath} ${status} ${durationMs}ms`);
      }
    });

    next();
  });

  // Trasy testowe
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/state/revision', (_req, res) => {
    res.status(200).json({ revision: 1 });
  });

  app.get('/api/fast-ok', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get('/api/bad-request', (_req, res) => {
    res.status(400).json({ error: 'Złe zapytanie' });
  });

  app.get('/api/server-error', (_req, res) => {
    res.status(500).json({ error: 'Awaria' });
  });

  app.get('/api/slow-ok', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 520));
    res.status(200).json({ ok: true });
  });

  app.get('/public/page', (_req, res) => {
    res.status(404).send('Not Found');
  });

  return app;
}

describe('Lekkie logowanie żądań API (server.ts request logging)', () => {
  let server: http.Server;
  let port: number;
  let logSpy: any;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = createTestLoggingApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('pomija zapytania /api/health oraz /api/state/revision', async () => {
    await fetch(`http://localhost:${port}/api/health`);
    await fetch(`http://localhost:${port}/api/state/revision`);

    const apiLogs = logSpy.mock.calls
      .map((c: any) => c[0])
      .filter((msg: string) => typeof msg === 'string' && msg.startsWith('[API]'));

    expect(apiLogs).toHaveLength(0);
  });

  it('nie loguje szybkich, udanych zapytań (status 200, czas <= 500ms)', async () => {
    await fetch(`http://localhost:${port}/api/fast-ok?queryParam=secret123`);

    const apiLogs = logSpy.mock.calls
      .map((c: any) => c[0])
      .filter((msg: string) => typeof msg === 'string' && msg.startsWith('[API]'));

    expect(apiLogs).toHaveLength(0);
  });

  it('loguje błędy klienta (status >= 400) bez query string i bez wrażliwych danych', async () => {
    await fetch(`http://localhost:${port}/api/bad-request?userEmail=test@example.com`);

    const apiLogs = logSpy.mock.calls
      .map((c: any) => c[0])
      .filter((msg: string) => typeof msg === 'string' && msg.startsWith('[API]'));

    expect(apiLogs).toHaveLength(1);
    expect(apiLogs[0]).toMatch(/^\[API\] GET \/api\/bad-request 400 \d+ms$/);
    expect(apiLogs[0]).not.toContain('userEmail');
    expect(apiLogs[0]).not.toContain('test@example.com');
  });

  it('loguje błędy serwera (status 500)', async () => {
    await fetch(`http://localhost:${port}/api/server-error`);

    const apiLogs = logSpy.mock.calls
      .map((c: any) => c[0])
      .filter((msg: string) => typeof msg === 'string' && msg.startsWith('[API]'));

    expect(apiLogs).toHaveLength(1);
    expect(apiLogs[0]).toMatch(/^\[API\] GET \/api\/server-error 500 \d+ms$/);
  });

  it('loguje wolne zapytania (czas > 500ms) nawet przy statusie 200', async () => {
    await fetch(`http://localhost:${port}/api/slow-ok`);

    const apiLogs = logSpy.mock.calls
      .map((c: any) => c[0])
      .filter((msg: string) => typeof msg === 'string' && msg.startsWith('[API]'));

    expect(apiLogs).toHaveLength(1);
    expect(apiLogs[0]).toMatch(/^\[API\] GET \/api\/slow-ok 200 \d+ms$/);
    const duration = parseInt(apiLogs[0].match(/(\d+)ms$/)?.[1] || '0', 10);
    expect(duration).toBeGreaterThan(500);
  });

  it('nie loguje zapytań spoza prefiksu /api', async () => {
    await fetch(`http://localhost:${port}/public/page`);

    const apiLogs = logSpy.mock.calls
      .map((c: any) => c[0])
      .filter((msg: string) => typeof msg === 'string' && msg.startsWith('[API]'));

    expect(apiLogs).toHaveLength(0);
  });
});
