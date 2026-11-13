import { describe, it, expect } from 'vitest';
import {
  COMMON_PASSWORD_LIST_SIZE,
  validatePassword,
  getPasswordPolicyChecks,
} from '../utils/passwordPolicy.js';

describe('passwordPolicy (validatePassword)', () => {
  it('akceptuje silne hasło spełniające wszystkie kryteria', () => {
    const res = validatePassword('Zielony-rower-2026-xK', {
      name: 'Anna Nowak',
      email: 'a.nowak@pracownia.pl',
    });
    expect(res).toEqual({ ok: true, errors: [] });

    const checks = getPasswordPolicyChecks('Zielony-rower-2026-xK', {
      name: 'Anna Nowak',
      email: 'a.nowak@pracownia.pl',
    });
    expect(checks.every((c) => c.met)).toBe(true);
  });

  it('zawiera wbudowaną listę co najmniej 300 najczęstszych haseł', () => {
    expect(COMMON_PASSWORD_LIST_SIZE).toBeGreaterThanOrEqual(300);
  });

  it('odrzuca hasła krótsze niż 12 znaków lub dłuższe niż 128 znaków', () => {
    const tooShort = validatePassword('Bezpieczne1');
    expect(tooShort.ok).toBe(false);
    expect(tooShort.errors.some((e) => e.includes('co najmniej 12 znaków'))).toBe(true);

    const empty = validatePassword('');
    expect(empty.ok).toBe(false);
    expect(empty.errors.some((e) => e.includes('co najmniej 12 znaków'))).toBe(true);

    const tooLong = validatePassword('X!9mP#2qL$7v'.repeat(12));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors.some((e) => e.includes('maksymalnie 128 znaków'))).toBe(true);
  });

  it('odrzuca popularne hasła niezależnie od wielkości liter i cyfr/znaków specjalnych na końcu', () => {
    const popularSamples = [
      'haslo123456',
      'HASLO123456!',
      'HasŁo!2026',
      'qwerty123456',
      'QWERTY123456!',
      'zaq12wsx1234',
      'ZAQ12WSX!@#',
      '123456789012',
      'password1234',
      'Password2026!!',
    ];

    for (const pwd of popularSamples) {
      const res = validatePassword(pwd);
      expect(res.ok, `Hasło "${pwd}" powinno zostać odrzucone`).toBe(false);
      expect(
        res.errors.some((e) => e.includes('na liście popularnych')),
        `Brak komunikatu o popularnym haśle dla "${pwd}": ${res.errors.join(' | ')}`
      ).toBe(true);
    }
  });

  it('odrzuca hasła zawierające część lokalną adresu e-mail lub imię/nazwisko (bez rozróżniania wielkości liter)', () => {
    const byName = validatePassword('Kowalski-Projekt-2026', {
      name: 'Jan Kowalski',
      email: 'j.kow@pracownia.pl',
    });
    expect(byName.ok).toBe(false);
    expect(byName.errors.some((e) => e.includes('imienia, nazwiska ani części adresu e-mail'))).toBe(true);

    const byNameUpper = validatePassword('SUPER-MARCIN-2026!', {
      name: 'Marcin Nowak',
      email: 'm.now@pracownia.pl',
    });
    expect(byNameUpper.ok).toBe(false);
    expect(byNameUpper.errors.some((e) => e.includes('imienia, nazwiska ani części adresu e-mail'))).toBe(true);

    const byEmailLocal = validatePassword('Biuro-arch.biuro-2026', {
      name: 'Piotr Zieliński',
      email: 'arch.biuro@pracownia.pl',
    });
    expect(byEmailLocal.ok).toBe(false);
    expect(byEmailLocal.errors.some((e) => e.includes('imienia, nazwiska ani części adresu e-mail'))).toBe(true);
  });

  it('odrzuca hasła z jednego powtarzanego znaku oraz proste sekwencje znaków', () => {
    const badPatterns = [
      'aaaaaaaaaaaa',
      'AAAAAAAAAAAA',
      '111111111111',
      'abababababab',
      '123123123123',
      'abcdefghijkl',
      'ABCDEFGHIJKL',
      'zyxwvutsrqpo',
      '123456789012',
      '987654321098',
      'MojeAbcdefgh!',
      'qwertyuiopas',
    ];

    for (const pwd of badPatterns) {
      const res = validatePassword(pwd);
      expect(res.ok, `Hasło "${pwd}" powinno zostać odrzucone`).toBe(false);
      expect(
        res.errors.some((e) => e.includes('powtarzanego znaku ani prostej sekwencji')),
        `Brak komunikatu o sekwencji/powtórzeniu dla "${pwd}": ${res.errors.join(' | ')}`
      ).toBe(true);
    }
  });
});
