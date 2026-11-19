import { describe, it, expect } from 'vitest';
import {
  addMoney,
  calcGrossFromNet,
  calcMarginPercent,
  calcNetFromGross,
  formatMoney,
  formatQuantity,
  MONEY_POSITIVE_ERROR,
  MONEY_PRECISION_ERROR,
  multiplyMoney,
  parseMoney,
  parseQuantity,
  QUANTITY_PRECISION_ERROR,
  roundMoney,
  subtractMoney,
  validateMoneyInput,
  validateQuantityInput,
} from '../utils/money';

describe('Operacje na kwotach z dokładnością 0,01 zł (money.ts)', () => {
  it('parseMoney akceptuje przecinek, kropkę, spacje separujące i dokładność do 0,01 zł', () => {
    expect(parseMoney('1234,56')).toBe(1234.56);
    expect(parseMoney('1234.56')).toBe(1234.56);
    expect(parseMoney('1 234,50')).toBe(1234.5);
    expect(parseMoney('0,01')).toBe(0.01);
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('1000,10')).toBe(1000.1);
    expect(parseMoney(1234.56)).toBe(1234.56);
  });

  it('parseMoney i validateMoneyInput odrzucają >2 miejsca po przecinku oraz ujemne/nieprawidłowe kwoty', () => {
    expect(parseMoney('12,345')).toBeNull();
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('-10,00')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();

    const invalidPrecision = validateMoneyInput('12,345', { requiredPositive: true });
    expect(invalidPrecision.valid).toBe(false);
    expect(invalidPrecision.error).toBe(MONEY_PRECISION_ERROR);

    const zeroWhenPositive = validateMoneyInput('0,00', { requiredPositive: true });
    expect(zeroWhenPositive.valid).toBe(false);
    expect(zeroWhenPositive.error).toBe(MONEY_POSITIVE_ERROR);
  });

  it('formatMoney formatuje deterministycznie ze spacją tysięcy i przecinkiem', () => {
    expect(formatMoney(1234.5)).toBe('1 234,50');
    expect(formatMoney(1234.56)).toBe('1 234,56');
    expect(formatMoney(1000000)).toBe('1 000 000,00');
    expect(formatMoney(0)).toBe('0,00');
    expect(formatMoney(-45.2)).toBe('-45,20');
    expect(formatMoney(null)).toBe('');
  });

  it('arytmetyka w groszach eliminuje błędy zmiennoprzecinkowe IEEE-754', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(1234.56, 0.44, 10.05)).toBe(1245.05);
    expect(subtractMoney(1000.1, 0.09)).toBe(1000.01);
    expect(multiplyMoney(123.45, 2.5)).toBe(308.63);
    expect(roundMoney(10.005)).toBe(10.01);
    expect(calcGrossFromNet(1000, 23)).toBe(1230);
    expect(calcNetFromGross(1230, 23)).toBe(1000);
    expect(calcMarginPercent(1000, 250)).toBe(25);
  });

  it('parseQuantity i validateQuantityInput obsługują ilość do 3 miejsc po przecinku', () => {
    expect(parseQuantity('1,234')).toBe(1.234);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('1,2345')).toBeNull();
    expect(parseQuantity('0')).toBeNull();
    expect(formatQuantity(1.5)).toBe('1,5');

    const badQty = validateQuantityInput('1,2345');
    expect(badQty.valid).toBe(false);
    expect(badQty.error).toBe(QUANTITY_PRECISION_ERROR);
  });
});
