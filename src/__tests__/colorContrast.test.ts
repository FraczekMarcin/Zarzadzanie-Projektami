import { describe, it, expect } from 'vitest';
import {
  COMPANY_COLOR_PALETTE,
  getCompanyBadgeColors,
  getContrastRatio,
  getDefaultCompanyColor,
  getRelativeLuminance,
  hexToRgb,
  isValidCompanyColor,
  normalizeCompanyColor,
  pickReadableTextColor,
  resolveCompanyColor,
} from '../utils/colorContrast.js';

describe('P78: Kolory firm oraz dobór kontrastowego tekstu WCAG (>= 4.5:1)', () => {
  it('waliduje i normalizuje kody hex #RRGGBB', () => {
    expect(isValidCompanyColor('#1d4ed8')).toBe(true);
    expect(isValidCompanyColor(' #aBcDeF ')).toBe(true);
    expect(isValidCompanyColor('#123')).toBe(false);
    expect(isValidCompanyColor('1d4ed8')).toBe(false);
    expect(isValidCompanyColor('#12345G')).toBe(false);
    expect(isValidCompanyColor(null)).toBe(false);

    expect(normalizeCompanyColor(' #0f766e ')).toBe('#0F766E');
    expect(normalizeCompanyColor('invalid')).toBeUndefined();
  });

  it('poprawnie wyznacza RGB, luminancję względną i współczynnik kontrastu WCAG', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });

    expect(getRelativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(getRelativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(getContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(getContrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('zwraca spójne domyślne kolory z 12-elementowej palety', () => {
    expect(COMPANY_COLOR_PALETTE).toHaveLength(12);
    expect(getDefaultCompanyColor('A')).toBe(COMPANY_COLOR_PALETTE[0].hex);
    expect(getDefaultCompanyColor('b')).toBe(COMPANY_COLOR_PALETTE[1].hex);
    expect(getDefaultCompanyColor(11)).toBe(COMPANY_COLOR_PALETTE[11].hex);
    expect(resolveCompanyColor({ letter: 'C', color: '#be123c' })).toBe('#BE123C');
    expect(resolveCompanyColor({ letter: 'C' })).toBe(COMPANY_COLOR_PALETTE[2].hex);
  });

  it('gwarantuje kontrast >= 4.5:1 dla wszystkich 12 kolorów palety i kolorów skrajnych w motywie jasnym oraz ciemnym', () => {
    const testedColors = [
      ...COMPANY_COLOR_PALETTE.map((c) => c.hex),
      '#000000',
      '#FFFFFF',
      '#FFFF00',
      '#777777',
      '#808080',
      '#123456',
      '#FDE047',
      '#EC4899',
      '#38BDF8',
      '#E2E8F0',
    ];

    for (const bg of testedColors) {
      for (const theme of ['light', 'dark'] as const) {
        const fg = pickReadableTextColor(bg, theme);
        const ratio = getContrastRatio(bg, fg);
        expect(
          ratio,
          `Kontrast ${ratio.toFixed(2)}:1 dla tła ${bg} i tekstu ${fg} w motywie ${theme}`
        ).toBeGreaterThanOrEqual(4.5);

        const badge = getCompanyBadgeColors({ color: bg }, theme);
        expect(badge.backgroundColor).toBe(bg.toUpperCase());
        expect(getContrastRatio(badge.backgroundColor, badge.color)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
