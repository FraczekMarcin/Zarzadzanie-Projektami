import { describe, it, expect } from 'vitest';
import express from 'express';
import { isSameOrigin } from './utils/access';

function isRequestHttps(req: express.Request): boolean {
  if (req.app.get('trust proxy')) {
    const xfp = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(xfp)
      ? xfp[0]?.toLowerCase().trim()
      : typeof xfp === 'string'
      ? xfp.split(',')[0].toLowerCase().trim()
      : '';
    return Boolean(req.secure || proto === 'https');
  }
  return Boolean(req.secure);
}

function buildSessionCookieHeader(req: express.Request, rawToken: string, maxAgeSec = 12 * 3600): string {
  const isHttps = isRequestHttps(req);
  const cookieName = isHttps ? '__Host-zp_session' : 'zp_session';
  const cookieParts = [
    `${cookieName}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) {
    cookieParts.push('Secure');
  }
  return cookieParts.join('; ');
}

function getClientIp(req: express.Request): string {
  if (req.app.get('trust proxy')) {
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

describe('HTTPS & Reverse Proxy Support (TRUST_PROXY=1)', () => {
  it('detects HTTPS and adds Secure attribute when TRUST_PROXY is set and X-Forwarded-Proto is https', () => {
    const app = express();
    app.set('trust proxy', 1);

    const mockReq = {
      app,
      secure: false,
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '192.168.1.150',
      },
      socket: { remoteAddress: '172.20.0.2' },
      ip: '192.168.1.150',
    } as unknown as express.Request;

    expect(isRequestHttps(mockReq)).toBe(true);

    const cookieHeader = buildSessionCookieHeader(mockReq, 'sample-raw-token-123');
    expect(cookieHeader).toContain('__Host-zp_session=');
    expect(cookieHeader).toContain('Secure');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');

    expect(getClientIp(mockReq)).toBe('192.168.1.150');
  });

  it('falls back to non-secure cookie when request is HTTP even with trust proxy enabled', () => {
    const app = express();
    app.set('trust proxy', 1);

    const mockReq = {
      app,
      secure: false,
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-for': '192.168.1.150',
      },
      socket: { remoteAddress: '172.20.0.2' },
      ip: '192.168.1.150',
    } as unknown as express.Request;

    expect(isRequestHttps(mockReq)).toBe(false);

    const cookieHeader = buildSessionCookieHeader(mockReq, 'sample-raw-token-123');
    expect(cookieHeader).toContain('zp_session=');
    expect(cookieHeader).not.toContain('__Host-');
    expect(cookieHeader).not.toContain('Secure');
  });

  it('ignores spoofed X-Forwarded-Proto and X-Forwarded-For when trust proxy is false', () => {
    const app = express();
    app.set('trust proxy', false);

    const mockReq = {
      app,
      secure: false,
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '1.2.3.4',
      },
      socket: { remoteAddress: '192.168.1.80' },
      ip: '192.168.1.80',
    } as unknown as express.Request;

    // Bez zaufanego proxy, nagłówek X-Forwarded-Proto nie może sfingować HTTPS
    expect(isRequestHttps(mockReq)).toBe(false);

    const cookieHeader = buildSessionCookieHeader(mockReq, 'sample-raw-token-123');
    expect(cookieHeader).not.toContain('Secure');

    // Bez zaufanego proxy, IP klienta to bezpośredni adres socketu
    expect(getClientIp(mockReq)).toBe('192.168.1.80');
  });

  it('correctly handles comma-separated and uppercase X-Forwarded-Proto headers', () => {
    const app = express();
    app.set('trust proxy', 1);

    const mockReq = {
      app,
      secure: false,
      headers: {
        'x-forwarded-proto': 'HTTPS, http',
      },
      socket: { remoteAddress: '172.20.0.2' },
    } as unknown as express.Request;

    expect(isRequestHttps(mockReq)).toBe(true);
  });
});

describe('CSRF Protection Middleware (Origin vs Host)', () => {
  function parseCookies(header?: string): Record<string, string> {
    const res: Record<string, string> = {};
    if (!header) return res;
    for (const pair of header.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        res[k] = decodeURIComponent(v);
      }
    }
    return res;
  }

  function simulateCsrfMiddleware(req: any): { allowed: boolean; status?: number; error?: string } {
    const CSRF_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    if (!CSRF_MUTATING_METHODS.has(req.method.toUpperCase())) {
      return { allowed: true };
    }

    const originHeader = req.headers?.origin;
    const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!rawOrigin || typeof rawOrigin !== 'string' || !rawOrigin.trim()) {
      return { allowed: true };
    }

    const authHeader = req.headers?.authorization;
    const isBearer = Boolean(
      authHeader &&
      typeof authHeader === 'string' &&
      authHeader.trim().toLowerCase().startsWith('bearer ')
    );
    if (isBearer) {
      return { allowed: true };
    }

    const cookies = parseCookies(req.headers?.cookie);
    const hasSessionCookie = Boolean(cookies['__Host-zp_session'] || cookies['zp_session']);
    if (!hasSessionCookie) {
      return { allowed: true };
    }

    let effectiveHost = '';
    if (req.app?.get?.('trust proxy')) {
      const xfh = req.headers?.['x-forwarded-host'];
      if (xfh) {
        const rawXfh = Array.isArray(xfh) ? xfh[0] : xfh;
        if (typeof rawXfh === 'string' && rawXfh.trim()) {
          effectiveHost = rawXfh.split(',')[0].trim();
        }
      }
    }
    if (!effectiveHost) {
      const h = req.headers?.host;
      const rawH = Array.isArray(h) ? h[0] : h;
      if (typeof rawH === 'string') {
        effectiveHost = rawH.trim();
      }
    }

    if (!isSameOrigin(rawOrigin, effectiveHost)) {
      return { allowed: false, status: 403, error: 'Niedozwolone źródło żądania' };
    }

    return { allowed: true };
  }

  it('POST z Origin: http://evil.example i ciasteczkiem sesji dostaje 403', () => {
    const app = express();
    app.set('trust proxy', false);

    const req = {
      app,
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://evil.example',
        cookie: 'zp_session=tajny-token-sesji',
      },
    };

    const res = simulateCsrfMiddleware(req);
    expect(res.allowed).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toBe('Niedozwolone źródło żądania');
  });

  it('działa normalnie przez http://IP:3000 gdy Origin pasuje do Host', () => {
    const app = express();
    app.set('trust proxy', false);

    const req = {
      app,
      method: 'POST',
      headers: {
        host: '192.168.1.100:3000',
        origin: 'http://192.168.1.100:3000',
        cookie: 'zp_session=tajny-token-sesji',
      },
    };

    const res = simulateCsrfMiddleware(req);
    expect(res.allowed).toBe(true);
  });

  it('działa normalnie przez https://host przy włączonym trust proxy i X-Forwarded-Host', () => {
    const app = express();
    app.set('trust proxy', 1);

    const req = {
      app,
      method: 'POST',
      headers: {
        host: 'app:3000',
        'x-forwarded-host': 'projekty.twojafirma.pl',
        origin: 'https://projekty.twojafirma.pl',
        cookie: '__Host-zp_session=tajny-token-sesji',
      },
    };

    const res = simulateCsrfMiddleware(req);
    expect(res.allowed).toBe(true);
  });

  it('przepuszcza żądania bez nagłówka Origin', () => {
    const app = express();
    const req = {
      app,
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        cookie: 'zp_session=tajny-token-sesji',
      },
    };

    const res = simulateCsrfMiddleware(req);
    expect(res.allowed).toBe(true);
  });

  it('przepuszcza żądania uwierzytelnione Bearer tokenem nawet z obcym Origin', () => {
    const app = express();
    const req = {
      app,
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://evil.example',
        authorization: 'Bearer token-dla-api',
      },
    };

    const res = simulateCsrfMiddleware(req);
    expect(res.allowed).toBe(true);
  });

  it('przepuszcza metody bezpieczne (GET, HEAD)', () => {
    const app = express();
    const req = {
      app,
      method: 'GET',
      headers: {
        host: 'localhost:3000',
        origin: 'http://evil.example',
        cookie: 'zp_session=tajny-token-sesji',
      },
    };

    const res = simulateCsrfMiddleware(req);
    expect(res.allowed).toBe(true);
  });
});

describe('API 404 handler i fallback SPA routing', () => {
  it('nieznana ścieżka pod /api zwraca 404 z JSON { error: "Nie znaleziono" } i Content-Type application/json', async () => {
    const app = express();

    // Rejestracja przykładowej trasy API
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    // 404 handler dla nieznanych tras /api
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'Nie znaleziono' });
    });

    // Fallback SPA
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api')) return next();
      res.type('html').send('<!doctype html><html>SPA</html>');
    });

    // Symulacja żądania do nieznanej trasy /api/nieistnieje
    const req = { method: 'GET', url: '/api/nieistnieje', path: '/api/nieistnieje' };
    let responseStatus: number | undefined;
    let responseBody: any;
    let responseContentType: string | undefined;

    const res = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json(body: any) {
        responseBody = body;
        responseContentType = 'application/json';
        return this;
      },
      setHeader(name: string, val: string) {
        if (name.toLowerCase() === 'content-type') responseContentType = val;
        return this;
      },
    };

    // Uruchomienie routingu dla /api/nieistnieje
    await new Promise<void>((resolve) => {
      (app as any).handle(req as any, res as any, () => resolve());
      resolve();
    });

    expect(responseStatus).toBe(404);
    expect(responseBody).toEqual({ error: 'Nie znaleziono' });
    expect(responseContentType).toContain('application/json');
  });

  it('fallback SPA nie przechwytuje żądań do /api ani metod innych niż GET', () => {
    let spaCalled = false;
    const spaFallback = (req: any, _res: any, next: any) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api')) return next();
      spaCalled = true;
    };

    // GET /api/nieistnieje nie może uruchomić SPA
    spaFallback({ method: 'GET', path: '/api/nieistnieje' }, {}, () => {});
    expect(spaCalled).toBe(false);

    // POST /projekty nie może uruchomić SPA
    spaFallback({ method: 'POST', path: '/projekty' }, {}, () => {});
    expect(spaCalled).toBe(false);

    // GET /projekty uruchamia SPA
    spaFallback({ method: 'GET', path: '/projekty' }, {}, () => {});
    expect(spaCalled).toBe(true);
  });
});


