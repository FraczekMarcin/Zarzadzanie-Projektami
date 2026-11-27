import fs from 'fs';
import { builtinModules } from 'node:module';
import path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'server.ts');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

const BUILTIN_MODULE_SET = new Set<string>(
  builtinModules.flatMap((mod) =>
    mod.startsWith('node:') ? [mod, mod.slice('node:'.length)] : [mod, `node:${mod}`]
  )
);

export const FORBIDDEN_SERVER_AND_SHARED_PACKAGES = new Set<string>([
  'react',
  'react-dom',
  'lucide-react',
]);

export interface ImportViolation {
  file: string;
  specifier: string;
  packageName: string;
  reason: string;
}

export interface ServerImportGraphAnalysis {
  visitedFiles: string[];
  sharedUtilsFiles: string[];
  externalPackages: Array<{ file: string; specifier: string; packageName: string }>;
  violations: ImportViolation[];
}

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'punct'; value: string };

function tokenizeModuleSyntax(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;
  let i = 0;

  while (i < len) {
    const ch = source[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Line comment
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Single or double quoted string
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      i++;
      let value = '';
      while (i < len) {
        const c = source[i];
        if (c === '\\') {
          if (i + 1 < len) {
            value += source[i + 1];
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        value += c;
        i++;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }

    // Template literal (skip contents cleanly, including nested ${...})
    if (ch === '`') {
      i++;
      let exprDepth = 0;
      while (i < len) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (exprDepth === 0) {
          if (c === '`') {
            i++;
            break;
          }
          if (c === '$' && source[i + 1] === '{') {
            exprDepth = 1;
            i += 2;
            continue;
          }
          i++;
        } else {
          if (c === '{') exprDepth++;
          else if (c === '}') exprDepth--;
          else if (c === '\'' || c === '"') {
            const q = c;
            i++;
            while (i < len) {
              if (source[i] === '\\') {
                i += 2;
                continue;
              }
              if (source[i] === q) break;
              i++;
            }
          }
          i++;
        }
      }
      tokens.push({ kind: 'word', value: '__TEMPLATE__' });
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let start = i;
      i++;
      while (i < len && /[A-Za-z0-9_$]/.test(source[i])) i++;
      tokens.push({ kind: 'word', value: source.slice(start, i) });
      continue;
    }

    // Numbers (consume so dot or digits don't confuse anything)
    if (/[0-9]/.test(ch)) {
      while (i < len && /[0-9A-Za-z_.]/.test(source[i])) i++;
      tokens.push({ kind: 'word', value: '__NUMBER__' });
      continue;
    }

    // Regex literal heuristic omitted intentionally; punctuation suffices for top-level import/export
    tokens.push({ kind: 'punct', value: ch });
    i++;
  }

  return tokens;
}

export function collectStaticModuleSpecifiers(_filePath: string, sourceText: string): string[] {
  const tokens = tokenizeModuleSyntax(sourceText);
  const specifiers: string[] = [];
  let braceDepth = 0;
  let parenDepth = 0;

  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];

    if (tok.kind === 'punct') {
      if (tok.value === '{') braceDepth++;
      else if (tok.value === '}' && braceDepth > 0) braceDepth--;
      else if (tok.value === '(') parenDepth++;
      else if (tok.value === ')' && parenDepth > 0) parenDepth--;
      idx++;
      continue;
    }

    const prevTok = idx > 0 ? tokens[idx - 1] : null;
    const isMemberAccess = prevTok?.kind === 'punct' && prevTok.value === '.';

    if (
      braceDepth === 0 &&
      parenDepth === 0 &&
      !isMemberAccess &&
      tok.kind === 'word' &&
      (tok.value === 'import' || tok.value === 'export')
    ) {
      const next = tokens[idx + 1];
      // Dynamic import(...) or import.meta -> not a static declaration
      if (tok.value === 'import' && next?.kind === 'punct' && (next.value === '(' || next.value === '.')) {
        idx++;
        continue;
      }

      // Side-effect import: import 'pkg'
      if (tok.value === 'import' && next?.kind === 'string') {
        specifiers.push(next.value);
        idx += 2;
        continue;
      }

      // Non-re-export export declarations: export const/let/var/function/async/class/interface/type Alias =/enum/default/declare
      if (
        tok.value === 'export' &&
        next?.kind === 'word' &&
        ['const', 'let', 'var', 'function', 'async', 'class', 'interface', 'enum', 'default', 'declare', 'abstract'].includes(
          next.value
        )
      ) {
        idx++;
        continue;
      }

      // Walk forward to scan static import ... from 'specifier' or export ... from 'specifier'
      let scan = idx + 1;
      let innerBrace = 0;
      let foundFrom = false;
      while (scan < tokens.length) {
        const t = tokens[scan];
        if (t.kind === 'punct') {
          if (t.value === '{') {
            innerBrace++;
          } else if (t.value === '}') {
            if (innerBrace > 0) innerBrace--;
          } else if (t.value === ';' && innerBrace === 0) {
            break;
          } else if (t.value === '=' && innerBrace === 0 && tok.value === 'export') {
            // e.g. export type Foo = ...
            break;
          }
        } else if (t.kind === 'word' && innerBrace === 0) {
          if (t.value === 'from') {
            const afterFrom = tokens[scan + 1];
            if (afterFrom?.kind === 'string') {
              specifiers.push(afterFrom.value);
              foundFrom = true;
              scan += 2;
              break;
            }
          }
          // `export type Foo` without `from` hits `=` or `{` or `;`, bail out cleanly if another top-level statement starts
          if (
            scan > idx + 1 &&
            (t.value === 'import' || t.value === 'export' || t.value === 'const' || t.value === 'function' || t.value === 'class')
          ) {
            break;
          }
        }
        scan++;
      }

      if (foundFrom) {
        idx = scan;
        continue;
      }
    }

    idx++;
  }

  return specifiers;
}

function normalizeRelPath(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

export function extractPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  const slashIdx = specifier.indexOf('/');
  return slashIdx === -1 ? specifier : specifier.slice(0, slashIdx);
}

export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) {
    const bare = specifier.slice('node:'.length);
    return BUILTIN_MODULE_SET.has(bare) || BUILTIN_MODULE_SET.has(extractPackageName(bare));
  }
  return BUILTIN_MODULE_SET.has(specifier) || BUILTIN_MODULE_SET.has(extractPackageName(specifier));
}

function readSourceFile(
  absPath: string,
  fileOverrides?: Map<string, string>
): string | null {
  if (fileOverrides) {
    const normalized = path.resolve(absPath);
    if (fileOverrides.has(normalized)) {
      return fileOverrides.get(normalized)!;
    }
    const rel = normalizeRelPath(normalized);
    if (fileOverrides.has(rel)) {
      return fileOverrides.get(rel)!;
    }
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return null;
  }
  return fs.readFileSync(absPath, 'utf8');
}

function hasFile(absPath: string, fileOverrides?: Map<string, string>): boolean {
  if (fileOverrides) {
    const normalized = path.resolve(absPath);
    if (fileOverrides.has(normalized) || fileOverrides.has(normalizeRelPath(normalized))) {
      return true;
    }
  }
  return fs.existsSync(absPath) && fs.statSync(absPath).isFile();
}

export function resolveRelativeModule(
  fromFile: string,
  specifier: string,
  fileOverrides?: Map<string, string>
): string | null {
  const cleanSpec = specifier.split('?')[0].split('#')[0];
  const baseTarget = path.resolve(path.dirname(fromFile), cleanSpec);
  const ext = path.extname(baseTarget).toLowerCase();

  const candidates: string[] = [];
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx') {
    const stem = baseTarget.slice(0, -ext.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, baseTarget);
  } else if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
    candidates.push(baseTarget);
  } else {
    candidates.push(
      baseTarget,
      `${baseTarget}.ts`,
      `${baseTarget}.tsx`,
      `${baseTarget}.mts`,
      `${baseTarget}.cts`,
      path.join(baseTarget, 'index.ts'),
      path.join(baseTarget, 'index.tsx')
    );
  }

  for (const candidate of candidates) {
    if (hasFile(candidate, fileOverrides)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

export function loadProductionDependencies(packageJsonPath = PACKAGE_JSON_PATH): Set<string> {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return new Set(Object.keys(pkg.dependencies ?? {}));
}

export function analyzeServerImportGraph(options?: {
  entryFile?: string;
  packageJsonPath?: string;
  fileOverrides?: Map<string, string>;
}): ServerImportGraphAnalysis {
  const entryFile = path.resolve(options?.entryFile ?? SERVER_ENTRY);
  const allowedDeps = loadProductionDependencies(options?.packageJsonPath ?? PACKAGE_JSON_PATH);
  const fileOverrides = options?.fileOverrides;

  const visited = new Set<string>();
  const queue: string[] = [entryFile];
  const externalPackages: Array<{ file: string; specifier: string; packageName: string }> = [];
  const violations: ImportViolation[] = [];

  while (queue.length > 0) {
    const currentFile = queue.shift()!;
    if (visited.has(currentFile)) continue;
    visited.add(currentFile);

    const source = readSourceFile(currentFile, fileOverrides);
    if (source === null) {
      violations.push({
        file: normalizeRelPath(currentFile),
        specifier: currentFile,
        packageName: '(brak pliku)',
        reason: `Plik "${normalizeRelPath(currentFile)}" nie istnieje na dysku.`,
      });
      continue;
    }

    const specifiers = collectStaticModuleSpecifiers(currentFile, source);
    const relFile = normalizeRelPath(currentFile);

    for (const specifier of specifiers) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolved = resolveRelativeModule(currentFile, specifier, fileOverrides);
        if (!resolved) {
          violations.push({
            file: relFile,
            specifier,
            packageName: specifier,
            reason: `Plik "${relFile}" posiada nierozwiązywalny import względny "${specifier}".`,
          });
          continue;
        }
        if (!visited.has(resolved)) {
          queue.push(resolved);
        }
        continue;
      }

      if (isNodeBuiltin(specifier)) {
        continue;
      }

      const packageName = extractPackageName(specifier);
      externalPackages.push({ file: relFile, specifier, packageName });

      if (!allowedDeps.has(packageName)) {
        violations.push({
          file: relFile,
          specifier,
          packageName,
          reason: `Plik osiągalny przez serwer "${relFile}" importuje pakiet "${packageName}" (specyfikator "${specifier}"), którego brak w "dependencies" pliku package.json.`,
        });
      }
    }
  }

  const visitedRel = Array.from(visited).map(normalizeRelPath).sort();
  const sharedUtilsFiles = visitedRel.filter((rel) => rel.startsWith('src/utils/'));

  return {
    visitedFiles: visitedRel,
    sharedUtilsFiles,
    externalPackages,
    violations,
  };
}

export function listAllTsFilesInDir(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllTsFilesInDir(full));
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/i.test(entry.name)) {
      results.push(path.resolve(full));
    }
  }
  return results.sort();
}

export function findForbiddenUiPackageImports(
  absFiles: string[],
  fileOverrides?: Map<string, string>
): ImportViolation[] {
  const violations: ImportViolation[] = [];

  for (const absFile of absFiles) {
    const source = readSourceFile(absFile, fileOverrides);
    if (source === null) continue;
    const relFile = normalizeRelPath(absFile);
    const specifiers = collectStaticModuleSpecifiers(absFile, source);

    for (const specifier of specifiers) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
      const packageName = extractPackageName(specifier);
      if (FORBIDDEN_SERVER_AND_SHARED_PACKAGES.has(packageName)) {
        violations.push({
          file: relFile,
          specifier,
          packageName,
          reason: `Zakazany import pakietu frontendowego "${packageName}" w pliku serwerowym/współdzielonym "${relFile}".`,
        });
      }
    }
  }

  return violations;
}

describe('Strażnik importów serwera (Docker runtime safety)', () => {
  it('poprawnie rozpoznaje statyczne import i export pomijając komentarze i literały tekstowe', () => {
    const sample = `
      // import fake from 'react';
      /* export { x } from 'lucide-react'; */
      import 'dotenv/config';
      import express, {
        Request,
        Response,
      } from 'express';
      import type { Session } from './sessions.js';
      export * from './config.js';
      export { foo as bar } from '../utils/deadlines.js';
      const txt = "import x from 'react-dom'";
      const tpl = \`import y from 'react'\`;
      export async function demo() {
        const mod = await import('vite');
        return mod;
      }
    `;
    expect(collectStaticModuleSpecifiers('sample.ts', sample)).toEqual([
      'dotenv/config',
      'express',
      './sessions.js',
      './config.js',
      '../utils/deadlines.js',
    ]);
  });

  it('wszystkie pliki osiągalne z server.ts importują wyłącznie pakiety z dependencies lub moduły wbudowane Node.js', () => {
    const analysis = analyzeServerImportGraph();

    expect(analysis.visitedFiles).toContain('server.ts');
    expect(analysis.sharedUtilsFiles).toContain('src/utils/deadlines.ts');
    expect(analysis.sharedUtilsFiles).toContain('src/utils/colorContrast.ts');

    if (analysis.violations.length > 0) {
      throw new Error(analysis.violations.map((v) => v.reason).join('\n'));
    }
    expect(analysis.violations).toEqual([]);
  });

  it('zakaz importów react, react-dom oraz lucide-react w src/server/** i współdzielonych plikach src/utils/**', () => {
    const analysis = analyzeServerImportGraph();
    const serverFiles = listAllTsFilesInDir(path.join(REPO_ROOT, 'src', 'server'));
    const sharedUtilsAbs = analysis.sharedUtilsFiles.map((rel) => path.join(REPO_ROOT, rel));
    const filesToCheck = Array.from(new Set([SERVER_ENTRY, ...serverFiles, ...sharedUtilsAbs]));

    const uiViolations = findForbiddenUiPackageImports(filesToCheck);
    if (uiViolations.length > 0) {
      throw new Error(uiViolations.map((v) => v.reason).join('\n'));
    }
    expect(uiViolations).toEqual([]);
  });

  it('wykrywa celowo dodany import react w pliku osiągalnym przez serwer i wskazuje plik oraz pakiet', () => {
    const poisonedPath = path.join(REPO_ROOT, 'src', 'utils', 'deadlines.ts');
    const originalSource = fs.readFileSync(poisonedPath, 'utf8');
    const poisonedSource = `import { useState } from 'react';\n${originalSource}`;
    const overrides = new Map<string, string>([[poisonedPath, poisonedSource]]);

    const analysis = analyzeServerImportGraph({ fileOverrides: overrides });

    expect(analysis.violations.length).toBeGreaterThan(0);
    const reactViolation = analysis.violations.find(
      (v) => v.file === 'src/utils/deadlines.ts' && v.packageName === 'react'
    );
    expect(reactViolation).toBeDefined();
    expect(reactViolation!.reason).toContain('src/utils/deadlines.ts');
    expect(reactViolation!.reason).toContain('react');
  });

  it('wykrywa celowo dodany import lub re-export pakietu frontendowego spoza dependencies w src/server/**', () => {
    const serverFile = path.join(REPO_ROOT, 'src', 'server', 'config.ts');
    const originalSource = fs.readFileSync(serverFile, 'utf8');
    const poisonedSource = `export { Folder } from 'lucide-react';\n${originalSource}`;
    const overrides = new Map<string, string>([[serverFile, poisonedSource]]);

    const graphAnalysis = analyzeServerImportGraph({ fileOverrides: overrides });
    expect(
      graphAnalysis.violations.some(
        (v) => v.file === 'src/server/config.ts' && v.packageName === 'lucide-react'
      )
    ).toBe(true);

    const uiViolations = findForbiddenUiPackageImports([serverFile], overrides);
    expect(uiViolations).toHaveLength(1);
    expect(uiViolations[0].reason).toContain('src/server/config.ts');
    expect(uiViolations[0].reason).toContain('lucide-react');
  });
});
