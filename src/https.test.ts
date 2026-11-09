import { describe, it, expect } from 'vitest';
import express from 'express';

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
