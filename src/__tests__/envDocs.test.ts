import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Jedyne dozwolone zmienne środowiskowe środowiska uruchomieniowego Node, które mogą występować poza konfiguracją aplikacji
const ENV_ALLOWLIST = new Set<string>(['NODE_ENV']);

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Dokumentacja zmiennych środowiskowych i czystość logowania serwera', () => {
  it('każda zmienna process.env.* odczytywana przez kod serwera jest udokumentowana w README.md i docker.env.example', () => {
    const serverFiles = [
      path.join(ROOT_DIR, 'server.ts'),
      ...collectTsFiles(path.join(ROOT_DIR, 'src', 'server')),
      path.join(ROOT_DIR, 'src', 'utils', 'stateStore.ts'),
      path.join(ROOT_DIR, 'src', 'utils', 'secretBox.ts'),
      path.join(ROOT_DIR, 'src', 'utils', 'totp.ts'),
      path.join(ROOT_DIR, 'src', 'utils', 'googleCalendar.ts'),
    ];

    const discoveredVars = new Set<string>();
    const envRegex = /process\.env(?:\?\.)?\.([A-Z][A-Z0-9_]*)/g;

    for (const filePath of serverFiles) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = envRegex.exec(content)) !== null) {
        discoveredVars.add(match[1]);
      }
    }

    expect(discoveredVars.size).toBeGreaterThan(10);

    const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
    const envExample = fs.readFileSync(path.join(ROOT_DIR, 'docker.env.example'), 'utf-8');

    const missingInReadme: string[] = [];
    const missingInEnvExample: string[] = [];

    for (const varName of discoveredVars) {
      if (ENV_ALLOWLIST.has(varName)) continue;

      const tokenRegex = new RegExp(`\\b${varName}\\b`);
      if (!tokenRegex.test(readme)) {
        missingInReadme.push(varName);
      }
      if (!tokenRegex.test(envExample)) {
        missingInEnvExample.push(varName);
      }
    }

    expect(missingInReadme).toEqual([]);
    expect(missingInEnvExample).toEqual([]);
  });

  it('kod serwera (src/server/*, src/utils/stateStore.ts, server.ts) nie zawiera bezpośrednich wywołań console.*', () => {
    const filesToCheck = [
      path.join(ROOT_DIR, 'server.ts'),
      ...collectTsFiles(path.join(ROOT_DIR, 'src', 'server')),
      path.join(ROOT_DIR, 'src', 'utils', 'stateStore.ts'),
    ];

    const violations: string[] = [];
    const consoleCallRegex = /\bconsole\.(log|warn|error|info|debug)\b/g;

    for (const filePath of filesToCheck) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (consoleCallRegex.test(content)) {
        violations.push(path.relative(ROOT_DIR, filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
