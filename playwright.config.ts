import { defineConfig, devices } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

if (!process.env.E2E_DATA_DIR) {
  process.env.E2E_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-data-'));
}
if (!process.env.E2E_APP_SECRET) {
  process.env.E2E_APP_SECRET = crypto.randomBytes(32).toString('hex');
}

const e2eDataDir = process.env.E2E_DATA_DIR;
const e2eAppSecret = process.env.E2E_APP_SECRET;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['html', { open: 'never' }]],
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node dist/server.js',
    url: 'http://localhost:4173/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '4173',
      DATA_DIR: e2eDataDir,
      APP_SECRET: e2eAppSecret,
    },
  },
});
