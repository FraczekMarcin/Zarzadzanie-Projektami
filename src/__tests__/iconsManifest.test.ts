import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createApp } from '../../server.js';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // Sprawdzenie nagłówka PNG (8 B) + długość/typ chunku IHDR
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('Ikony strony (favicon) i manifest webowy', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('katalog public/ zawiera poprawne pliki favicon.svg, PNG oraz manifest.webmanifest', () => {
    const svgPath = path.join(PUBLIC_DIR, 'favicon.svg');
    expect(fs.existsSync(svgPath)).toBe(true);
    const svg = fs.readFileSync(svgPath, 'utf-8');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg.toLowerCase()).not.toContain('<script');
    const svgWithoutXmlns = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
    expect(svgWithoutXmlns).not.toMatch(/https?:\/\//i);
    expect(svgWithoutXmlns).not.toMatch(/\bhref=|url\(/i);

    const expectedPngs: Array<{ name: string; size: number }> = [
      { name: 'favicon-32.png', size: 32 },
      { name: 'apple-touch-icon.png', size: 180 },
      { name: 'icon-192.png', size: 192 },
      { name: 'icon-512.png', size: 512 },
    ];
    for (const item of expectedPngs) {
      const p = path.join(PUBLIC_DIR, item.name);
      expect(fs.existsSync(p)).toBe(true);
      expect(readPngDimensions(p)).toEqual({ width: item.size, height: item.size });
    }

    const manifestPath = path.join(PUBLIC_DIR, 'manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('Zarządzanie Projektami');
    expect(manifest.short_name).toBe('Projekty');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('pl');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  });

  it('serwer serwuje favicon.svg, manifest.webmanifest, apple-touch-icon.png, przekierowuje /favicon.ico (302) i zwraca 404 dla brakujących grafik', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-icons-data-'));
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-icons-static-'));
    fs.cpSync(PUBLIC_DIR, staticDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><body>OK</body></html>');

    const instance = await createApp({
      dataDir,
      appSecret: TEST_APP_SECRET,
      port: 0,
      isProduction: true,
      staticDir,
      googleSyncDisableTimers: true,
      backupWatchDisableTimers: true,
      trashCleanupDisableTimers: true,
      remindersDisableTimers: true,
      diskWatchDisableTimers: true,
    });

    const httpServer = http.createServer(instance.app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      await instance.close();
      throw new Error('Brak portu testowego');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    cleanups.push(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(staticDir, { recursive: true, force: true });
    });

    // 1. /favicon.svg
    const svgRes = await fetch(`${baseUrl}/favicon.svg`);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get('content-type')).toContain('image/svg+xml');
    expect(svgRes.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(svgRes.headers.get('cache-control')).not.toContain('immutable');
    expect(await svgRes.text()).toContain('viewBox="0 0 64 64"');

    // 2. /manifest.webmanifest oraz sprawdzenie każdej zadeklarowanej ikony
    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers.get('content-type')).toContain('application/manifest+json');
    expect(manifestRes.headers.get('cache-control')).toBe('public, max-age=86400');
    const manifest = await manifestRes.json();
    expect(manifest.name).toBe('Zarządzanie Projektami');
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const iconRes = await fetch(`${baseUrl}${icon.src}`);
      expect(iconRes.status).toBe(200);
      expect(iconRes.headers.get('cache-control')).toBe('public, max-age=86400');
    }

    // 3. /apple-touch-icon.png i /favicon-32.png
    const appleRes = await fetch(`${baseUrl}/apple-touch-icon.png`);
    expect(appleRes.status).toBe(200);
    expect(appleRes.headers.get('content-type')).toContain('image/png');
    expect(appleRes.headers.get('cache-control')).toBe('public, max-age=86400');

    const favicon32Res = await fetch(`${baseUrl}/favicon-32.png`);
    expect(favicon32Res.status).toBe(200);
    expect(favicon32Res.headers.get('content-type')).toContain('image/png');

    // 4. /favicon.ico -> 302 na /favicon.svg
    const icoRes = await fetch(`${baseUrl}/favicon.ico`, { redirect: 'manual' });
    expect(icoRes.status).toBe(302);
    const location = icoRes.headers.get('location') || '';
    expect(location.endsWith('/favicon.svg')).toBe(true);

    // 5. Brakujące pliki graficzne -> 404 (bez fallbacku HTML SPA)
    for (const missingPath of ['/nie-istnieje.png', '/brak.svg', '/img.webp', '/zdjecie.jpg', '/stara.ico']) {
      const missingRes = await fetch(`${baseUrl}${missingPath}`);
      expect(missingRes.status).toBe(404);
      expect(missingRes.headers.get('content-type') || '').not.toContain('text/html');
    }

    // 6. Routing SPA dla ścieżki bez rozszerzenia graficznego nadal zwraca index.html
    const spaRes = await fetch(`${baseUrl}/widok-projektu`);
    expect(spaRes.status).toBe(200);
    expect(spaRes.headers.get('content-type')).toContain('text/html');
  });
});
