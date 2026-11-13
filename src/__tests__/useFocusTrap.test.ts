import { describe, it, expect } from 'vitest';
import { FOCUSABLE_SELECTOR, getWrappedFocusTargetIndex } from '../utils/useFocusTrap';

describe('useFocusTrap helpers', () => {
  describe('FOCUSABLE_SELECTOR', () => {
    it('includes standard interactive elements and excludes disabled or tabindex=-1', () => {
      expect(FOCUSABLE_SELECTOR).toContain('a[href]');
      expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
      expect(FOCUSABLE_SELECTOR).toContain('input:not([disabled]):not([type="hidden"])');
      expect(FOCUSABLE_SELECTOR).toContain('select:not([disabled])');
      expect(FOCUSABLE_SELECTOR).toContain('textarea:not([disabled])');
      expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
    });
  });

  describe('getWrappedFocusTargetIndex', () => {
    it('returns null when there are no focusable elements', () => {
      expect(getWrappedFocusTargetIndex(0, 0, false)).toBeNull();
      expect(getWrappedFocusTargetIndex(0, 0, true)).toBeNull();
      expect(getWrappedFocusTargetIndex(-1, 0, false)).toBeNull();
    });

    it('wraps forward Tab from last element or outside (-1) back to first element (0)', () => {
      expect(getWrappedFocusTargetIndex(2, 3, false)).toBe(0);
      expect(getWrappedFocusTargetIndex(-1, 3, false)).toBe(0);
    });

    it('returns null for forward Tab on first or middle elements so native Tab proceeds', () => {
      expect(getWrappedFocusTargetIndex(0, 3, false)).toBeNull();
      expect(getWrappedFocusTargetIndex(1, 3, false)).toBeNull();
    });

    it('wraps Shift+Tab from first element (0) or outside (-1) back to last element', () => {
      expect(getWrappedFocusTargetIndex(0, 4, true)).toBe(3);
      expect(getWrappedFocusTargetIndex(-1, 4, true)).toBe(3);
    });

    it('returns null for Shift+Tab on middle or last elements so native Shift+Tab proceeds', () => {
      expect(getWrappedFocusTargetIndex(1, 4, true)).toBeNull();
      expect(getWrappedFocusTargetIndex(3, 4, true)).toBeNull();
    });

    it('keeps focus on index 0 for single-element traps on both Tab and Shift+Tab', () => {
      expect(getWrappedFocusTargetIndex(0, 1, false)).toBe(0);
      expect(getWrappedFocusTargetIndex(0, 1, true)).toBe(0);
    });
  });
});
