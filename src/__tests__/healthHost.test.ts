import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { createApp, startHttpServer, formatListenHost } from '../../server.js';

const TEST_APP_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function isIpv6BindSupported(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      probe.close();
      resolve(false);
    });
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(0, '::');
  });
}

describe('Nasłuchiwanie serwera HTTP i /api/health (IPv4 + IPv6 dual-stack)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  async function bootServer(explicitHost?: string) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-health-host-'));
    const instance = await createApp({
      dataDir,
      appSecret: TEST_APP_SECRET,
      port: 0,
      isProduction: true,
    });
    const started = await startHttpServer(instance.app, 0, explicitHost);
    cleanups.push(async () => {
      await new Promise<void>((resolve) => {
        started.server.close(() => resolve());
      });
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });
    return started;
  }

  it('odpowiada na /api/health pod 127.0.0.1 oraz pod [::1], gdy IPv6 jest dostępne', async () => {
    const ipv6Supported = await isIpv6BindSupported();
    const started = await bootServer();

    const v4Res = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    expect(v4Res.status).toBe(200);
    const v4Body = (await v4Res.json()) as { status: string };
    expect(v4Body.status).toBe('ok');

    if (ipv6Supported) {
      expect(started.host).toBe('::');
      expect(formatListenHost(started.host)).toBe('[::]');

      const v6Res = await fetch(`http://[::1]:${started.port}/api/health`);
      expect(v6Res.status).toBe(200);
      const v6Body = (await v6Res.json()) as { status: string };
      expect(v6Body.status).toBe('ok');
    } else {
      expect(started.host).toBe('0.0.0.0');
      expect(formatListenHost(started.host)).toBe('0.0.0.0');
      console.info(
        'Pominięto sprawdzenie [::1]/api/health: stos IPv6 (::) nie jest dostępny w tym środowisku testowym.'
      );
    }
  });

  it('respektuje jawnie podany host (np. 127.0.0.1)', async () => {
    const started = await bootServer('127.0.0.1');
    expect(started.host).toBe('127.0.0.1');

    const res = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
