import { useEffect, useState } from 'react';

export interface CompanyColorSwatch {
  hex: string;
  name: string;
}

export const COMPANY_COLOR_PALETTE: readonly CompanyColorSwatch[] = [
  { hex: '#1D4ED8', name: 'Kobaltowy' },
  { hex: '#0369A1', name: 'Błękitny' },
  { hex: '#0F766E', name: 'Morski' },
  { hex: '#047857', name: 'Szmaragdowy' },
  { hex: '#4D7C0F', name: 'Oliwkowy' },
  { hex: '#B45309', name: 'Bursztynowy' },
  { hex: '#C2410C', name: 'Miedziany' },
  { hex: '#BE123C', name: 'Karmazynowy' },
  { hex: '#7E22CE', name: 'Śliwkowy' },
  { hex: '#4338CA', name: 'Indygo' },
  { hex: '#334155', name: 'Grafitowy' },
  { hex: '#FACC15', name: 'Słoneczny' },
] as const;

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export function isValidCompanyColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value.trim());
}

export function normalizeCompanyColor(value: unknown): string | undefined {
  if (!isValidCompanyColor(value)) return undefined;
  return value.trim().toUpperCase();
}

export function getDefaultCompanyColor(letterOrIndex?: string | number): string {
  let index = 0;
  if (typeof letterOrIndex === 'number' && Number.isFinite(letterOrIndex)) {
    index = Math.abs(Math.trunc(letterOrIndex)) % COMPANY_COLOR_PALETTE.length;
  } else if (typeof letterOrIndex === 'string' && letterOrIndex.trim()) {
    const firstChar = letterOrIndex.trim().toUpperCase().charCodeAt(0);
    if (firstChar >= 65 && firstChar <= 90) {
      index = (firstChar - 65) % COMPANY_COLOR_PALETTE.length;
    } else {
      index = Math.abs(firstChar) % COMPANY_COLOR_PALETTE.length;
    }
  }
  return COMPANY_COLOR_PALETTE[index].hex;
}

export function resolveCompanyColor(company?: { color?: string; letter?: string } | null): string {
  const normalized = normalizeCompanyColor(company?.color);
  if (normalized) return normalized;
  return getDefaultCompanyColor(company?.letter);
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeCompanyColor(hex);
  if (!normalized) {
    return { r: 67, g: 56, b: 202 }; // #4338CA fallback
  }
  const intVal = parseInt(normalized.slice(1), 16);
  return {
    r: (intVal >> 16) & 255,
    g: (intVal >> 8) & 255,
    b: intVal & 255,
  };
}

function srgbChannelToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.x relative luminance (0.0 to 1.0)
 */
export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * WCAG 2.x contrast ratio (1.0 to 21.0)
 */
export function getContrastRatio(hexA: string, hexB: string): number {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ThemeSurface = 'light' | 'dark';

/**
 * Picks a foreground text color with at least 4.5:1 WCAG AA contrast
 * separately calibrated for light and dark UI themes.
 */
export function pickReadableTextColor(bgHex: string, theme: ThemeSurface): string {
  const safeBg = normalizeCompanyColor(bgHex) || getDefaultCompanyColor();
  const darkCandidates = theme === 'dark' ? ['#090D16', '#000000'] : ['#0F172A', '#000000'];
  const lightCandidates = theme === 'dark' ? ['#F8FAFC', '#FFFFFF'] : ['#FFFFFF'];

  let bestDark = darkCandidates[0];
  let bestDarkRatio = getContrastRatio(safeBg, bestDark);
  for (const cand of darkCandidates.slice(1)) {
    const r = getContrastRatio(safeBg, cand);
    if (r > bestDarkRatio) {
      bestDark = cand;
      bestDarkRatio = r;
    }
  }

  let bestLight = lightCandidates[0];
  let bestLightRatio = getContrastRatio(safeBg, bestLight);
  for (const cand of lightCandidates.slice(1)) {
    const r = getContrastRatio(safeBg, cand);
    if (r > bestLightRatio) {
      bestLight = cand;
      bestLightRatio = r;
    }
  }

  // Prefer primary theme-tuned candidate when it already comfortably clears 4.5:1
  const primaryDark = darkCandidates[0];
  const primaryLight = lightCandidates[0];
  const primaryDarkRatio = getContrastRatio(safeBg, primaryDark);
  const primaryLightRatio = getContrastRatio(safeBg, primaryLight);

  if (primaryDarkRatio >= 4.5 && primaryDarkRatio >= primaryLightRatio) {
    return primaryDark;
  }
  if (primaryLightRatio >= 4.5 && primaryLightRatio >= primaryDarkRatio) {
    return primaryLight;
  }

  return bestLightRatio >= bestDarkRatio ? bestLight : bestDark;
}

export interface CompanyBadgeColors {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

/**
 * Computes inline CSS colors for company badges/cells in light or dark theme,
 * ensuring >= 4.5:1 text contrast and clean border separation from the page surface.
 */
export function getCompanyBadgeColors(
  companyOrColor: { color?: string; letter?: string } | string | null | undefined,
  theme: ThemeSurface
): CompanyBadgeColors {
  const backgroundColor =
    typeof companyOrColor === 'string'
      ? normalizeCompanyColor(companyOrColor) || getDefaultCompanyColor()
      : resolveCompanyColor(companyOrColor);

  const color = pickReadableTextColor(backgroundColor, theme);
  const lum = getRelativeLuminance(backgroundColor);

  let borderColor: string;
  if (theme === 'dark') {
    borderColor = lum < 0.08 ? 'rgba(248, 250, 252, 0.35)' : 'rgba(255, 255, 255, 0.22)';
  } else {
    borderColor = lum > 0.72 ? 'rgba(15, 23, 42, 0.28)' : 'rgba(15, 23, 42, 0.16)';
  }

  return {
    backgroundColor,
    color,
    borderColor,
  };
}

function readIsDarkFromDom(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(readIsDarkFromDom);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const root = document.documentElement;
    setIsDark(root.classList.contains('dark'));

    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
