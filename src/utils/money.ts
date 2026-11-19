export const MONEY_PRECISION_ERROR = 'Podaj kwotę z maksymalnie dwoma miejscami po przecinku';
export const MONEY_POSITIVE_ERROR = 'Podaj kwotę większą od 0';
export const QUANTITY_PRECISION_ERROR = 'Podaj ilość z maksymalnie trzema miejscami po przecinku';
export const QUANTITY_POSITIVE_ERROR = 'Podaj ilość większą od 0';

export function toGrosze(pln: number): number {
  if (!Number.isFinite(pln)) return 0;
  return Math.round((pln + Number.EPSILON) * 100);
}

export function fromGrosze(grosze: number): number {
  if (!Number.isFinite(grosze)) return 0;
  return Math.round(grosze) / 100;
}

export function roundMoney(pln: number): number {
  if (!Number.isFinite(pln)) return 0;
  return Math.round((pln + Number.EPSILON) * 100) / 100;
}

export function addMoney(...values: number[]): number {
  let sumGrosze = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      sumGrosze += toGrosze(v);
    }
  }
  return fromGrosze(sumGrosze);
}

export function subtractMoney(a: number, b: number): number {
  return fromGrosze(toGrosze(a) - toGrosze(b));
}

export function multiplyMoney(amount: number, factor: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(factor)) return 0;
  return fromGrosze(Math.round(toGrosze(amount) * factor));
}

export function calcGrossFromNet(net: number, vatRate: number): number {
  if (!Number.isFinite(net)) return 0;
  const rate = Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 0;
  return fromGrosze(Math.round(toGrosze(net) * (1 + rate / 100)));
}

export function calcNetFromGross(gross: number, vatRate: number): number {
  if (!Number.isFinite(gross)) return 0;
  const rate = Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 0;
  if (rate <= 0) return roundMoney(gross);
  return fromGrosze(Math.round(toGrosze(gross) / (1 + rate / 100)));
}

export function calcMarginPercent(revenueNet: number, profitNet: number): number {
  if (!Number.isFinite(revenueNet) || revenueNet <= 0) return 0;
  return Math.round((profitNet / revenueNet) * 100);
}

function stripGroupingSpaces(raw: string): string {
  return raw.replace(/[\s\u00A0\u202F]/g, '').trim();
}

export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    const scaled = input * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return null;
    return Math.round(scaled) / 100;
  }

  const cleaned = stripGroupingSpaces(String(input));
  if (!cleaned) return null;

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(cleaned)) {
    return null;
  }

  const normalized = cleaned.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export interface MoneyValidationResult {
  valid: boolean;
  value: number | null;
  error?: string;
}

export function validateMoneyInput(
  raw: string,
  options?: { requiredPositive?: boolean; allowEmpty?: boolean }
): MoneyValidationResult {
  const cleaned = stripGroupingSpaces(raw);
  if (!cleaned) {
    if (options?.requiredPositive) {
      return { valid: false, value: null, error: MONEY_POSITIVE_ERROR };
    }
    if (options?.allowEmpty === false) {
      return { valid: false, value: null, error: MONEY_PRECISION_ERROR };
    }
    return { valid: true, value: null };
  }

  const parsed = parseMoney(cleaned);
  if (parsed === null) {
    return { valid: false, value: null, error: MONEY_PRECISION_ERROR };
  }

  if (options?.requiredPositive && parsed <= 0) {
    return { valid: false, value: parsed, error: MONEY_POSITIVE_ERROR };
  }

  return { valid: true, value: parsed };
}

export function parseQuantity(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    const scaled = input * 1000;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return null;
    return Math.round(scaled) / 1000;
  }

  const cleaned = stripGroupingSpaces(String(input));
  if (!cleaned) return null;

  if (!/^\d+(?:[.,]\d{1,3})?$/.test(cleaned)) {
    return null;
  }

  const normalized = cleaned.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

export function validateQuantityInput(raw: string): MoneyValidationResult {
  const cleaned = stripGroupingSpaces(raw);
  if (!cleaned) {
    return { valid: false, value: null, error: QUANTITY_POSITIVE_ERROR };
  }

  const parsed = parseQuantity(cleaned);
  if (parsed === null) {
    if (/^\d+(?:[.,]\d+)?$/.test(cleaned)) {
      const num = Number(cleaned.replace(',', '.'));
      if (Number.isFinite(num) && num <= 0) {
        return { valid: false, value: num, error: QUANTITY_POSITIVE_ERROR };
      }
    }
    return { valid: false, value: null, error: QUANTITY_PRECISION_ERROR };
  }

  return { valid: true, value: parsed };
}

export function formatMoney(
  value: number | null | undefined,
  options?: { emptyAs?: string }
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return options?.emptyAs ?? '';
  }

  const isNeg = value < 0;
  const absRounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  const fixed = absRounded.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${isNeg ? '-' : ''}${grouped},${decPart}`;
}

export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return String(rounded).replace('.', ',');
}
