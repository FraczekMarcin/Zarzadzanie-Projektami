import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.resolve(process.cwd(), 'src');

/**
 * Jawna lista plików z `role="dialog"` celowo pozbawionych wariantów `dark:` (obecnie pusta — każdy dialog musi wspierać tryb ciemny).
 */
const ALLOWED_DIALOG_EXCEPTIONS: readonly string[] = [];

const DARK_LIGHT_TEXT_TOKEN = /^text-(?:black|[a-z]+-(?:[5-9]00|950))(?:\/[0-9]+)?$/;

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function extractClassLiterals(source: string): Array<{ line: number; value: string }> {
  const literals: Array<{ line: number; value: string }> = [];
  const literalRegex = /'([^'\n]|\\.)*'|"([^"\n]|\\.)*"|`([^`\\]|\\.)*`/g;
  let match: RegExpExecArray | null;

  while ((match = literalRegex.exec(source)) !== null) {
    const raw = match[0];
    const inner = raw.slice(1, -1);
    // W literałach szablonowych usuwamy interpolacje ${...} przed analizą statycznych tokenów
    const normalized = raw.startsWith('`') ? inner.replace(/\$\{[^}]*\}/g, ' ') : inner;
    const line = source.slice(0, match.index).split('\n').length;
    literals.push({ line, value: normalized });
  }

  return literals;
}

describe('Ochrona przed regresją trybu ciemnego (Dark Mode)', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  it('żaden literał klas Tailwind w src/ nie łączy dark:bg-* z ciemnym tekstem bez jawnego dark:text-*', () => {
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

      for (const literal of extractClassLiterals(content)) {
        const tokens = literal.value.split(/\s+/).filter(Boolean);
        const hasDarkBg = tokens.some((token) => /^dark:bg-/.test(token));
        if (!hasDarkBg) continue;

        const hasDarkText = tokens.some((token) => /^dark:text-/.test(token));
        if (hasDarkText) continue;

        const unsafeTextTokens = tokens.filter((token) => DARK_LIGHT_TEXT_TOKEN.test(token));
        if (unsafeTextTokens.length > 0) {
          violations.push(
            `${relPath}:${literal.line} ma dark:bg-* i ciemny tekst [${unsafeTextTokens.join(', ')}] bez dark:text-*`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('wszystkie okna dialogowe (role="dialog") zawierają warianty dark:', () => {
    const missingDarkDialogs: string[] = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes('role="dialog"')) continue;

      const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
      if (ALLOWED_DIALOG_EXCEPTIONS.includes(relPath)) continue;

      if (!content.includes('dark:')) {
        missingDarkDialogs.push(relPath);
      }
    }

    expect(missingDarkDialogs).toEqual([]);
  });

  it('src/index.css ustawia color-scheme dla trybu jasnego i ciemnego oraz ciemne stylowanie option', () => {
    const indexCssPath = path.join(SRC_ROOT, 'index.css');
    const css = fs.readFileSync(indexCssPath, 'utf-8');

    expect(css).toContain('color-scheme: light');
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain('html.dark option');
  });
});
