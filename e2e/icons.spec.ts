import { test, expect } from '@playwright/test';

test('strona deklaruje linki favicon i manifest oraz ładuje ikony bez naruszeń CSP', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  await page.addInitScript(() => {
    const win = window as unknown as { __cspViolations?: string[] };
    win.__cspViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => {
      win.__cspViolations?.push(
        `${event.violatedDirective || event.effectiveDirective}: ${event.blockedURI}`
      );
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  await page.goto('/');

  const svgIconLink = page.locator('head link[rel="icon"][type="image/svg+xml"]');
  await expect(svgIconLink).toHaveAttribute('href', '/favicon.svg');

  const pngIconLink = page.locator('head link[rel="icon"][sizes="32x32"]');
  await expect(pngIconLink).toHaveAttribute('href', '/favicon-32.png');

  const appleIconLink = page.locator('head link[rel="apple-touch-icon"]');
  await expect(appleIconLink).toHaveAttribute('href', '/apple-touch-icon.png');

  const manifestLink = page.locator('head link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');

  await expect(page.locator('head meta[name="theme-color"]')).toHaveCount(2);

  // Sprawdzenie ładowania ikon i manifestu bezpośrednio w przeglądarce (z weryfikacją CSP)
  const loadCheck = await page.evaluate(async () => {
    const loadImage = (src: string) =>
      new Promise<{ ok: boolean; width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ ok: false, width: 0, height: 0 });
        img.src = src;
      });

    const [svgImg, png32Img, appleImg, manifestRes] = await Promise.all([
      loadImage('/favicon.svg'),
      loadImage('/favicon-32.png'),
      loadImage('/apple-touch-icon.png'),
      fetch('/manifest.webmanifest').then(async (r) => ({
        status: r.status,
        contentType: r.headers.get('content-type') || '',
        body: await r.json(),
      })),
    ]);

    return { svgImg, png32Img, appleImg, manifestRes };
  });

  expect(loadCheck.svgImg.ok).toBe(true);
  expect(loadCheck.svgImg.width).toBeGreaterThan(0);
  expect(loadCheck.png32Img).toEqual({ ok: true, width: 32, height: 32 });
  expect(loadCheck.appleImg).toEqual({ ok: true, width: 180, height: 180 });
  expect(loadCheck.manifestRes.status).toBe(200);
  expect(loadCheck.manifestRes.contentType).toContain('application/manifest+json');
  expect(loadCheck.manifestRes.body.name).toBe('Zarządzanie Projektami');

  const cspViolations = await page.evaluate(() => {
    const win = window as unknown as { __cspViolations?: string[] };
    return win.__cspViolations || [];
  });

  expect(cspViolations, 'Naruszenia Content-Security-Policy').toEqual([]);
  expect(consoleErrors, 'Błędy konsoli przeglądarki').toEqual([]);
  expect(pageErrors, 'Nieobsłużone wyjątki pageerror').toEqual([]);
});
