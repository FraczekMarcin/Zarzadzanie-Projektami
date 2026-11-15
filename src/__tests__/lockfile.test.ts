import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(__dirname, '..', '..');

interface LockPackageEntry {
  version?: string;
  optionalDependencies?: Record<string, string>;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, LockPackageEntry>;
}

function resolveLockfileCandidates(pkgKey: string, depName: string): string[] {
  const candidates: string[] = [];
  if (!pkgKey) {
    candidates.push(`node_modules/${depName}`);
    return candidates;
  }

  let current = pkgKey;
  while (current) {
    candidates.push(`${current}/node_modules/${depName}`);
    const lastNmIdx = current.lastIndexOf('node_modules/');
    if (lastNmIdx <= 0) break;
    current = current.slice(0, lastNmIdx).replace(/\/$/, '');
  }
  candidates.push(`node_modules/${depName}`);
  return candidates;
}

describe('Spójność optionalDependencies w package-lock.json (kompatybilność z npm 11)', () => {
  it('każda zależność z optionalDependencies dowolnego pakietu ma wpis w packages', () => {
    const lockPath = path.join(ROOT_DIR, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as PackageLock;
    const packages = lock.packages || {};

    const missing: Array<{ packageKey: string; optionalDependency: string; expectedRange: string }> = [];

    for (const [pkgKey, entry] of Object.entries(packages)) {
      const optDeps = entry?.optionalDependencies;
      if (!optDeps) continue;

      for (const [depName, expectedRange] of Object.entries(optDeps)) {
        const candidates = resolveLockfileCandidates(pkgKey, depName);
        const found = candidates.some((candidate) => Object.prototype.hasOwnProperty.call(packages, candidate));
        if (!found) {
          missing.push({
            packageKey: pkgKey || '<root>',
            optionalDependency: depName,
            expectedRange,
          });
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
