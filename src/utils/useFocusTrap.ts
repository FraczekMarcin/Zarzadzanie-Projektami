import { RefObject, useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

interface DialogStackEntry {
  id: symbol;
  container: HTMLElement | null;
}

const openDialogStack: DialogStackEntry[] = [];
let scrollLockCount = 0;
let savedBodyOverflow: string | null = null;
let lastOutsideFocusedElement: HTMLElement | null = null;
let focusTrackerInstalled = false;

function ensureFocusTracker(): void {
  if (focusTrackerInstalled || typeof document === 'undefined') return;
  focusTrackerInstalled = true;
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const insideTopDialog = openDialogStack.some((entry) => entry.container?.contains(target));
      if (!insideTopDialog) {
        lastOutsideFocusedElement = target;
      }
    },
    true
  );
}

export function isElementFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
    return false;
  }
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => isElementFocusable(el));
}

export function getWrappedFocusTargetIndex(
  currentIndex: number,
  total: number,
  shiftKey: boolean
): number | null {
  if (total <= 0) return null;
  if (shiftKey) {
    if (currentIndex <= 0) return total - 1;
    return null;
  }
  if (currentIndex === -1 || currentIndex >= total - 1) return 0;
  return null;
}

export interface UseFocusTrapOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useFocusTrap({
  isOpen,
  onClose,
  containerRef,
  initialFocusRef,
}: UseFocusTrapOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    ensureFocusTracker();

    const instanceId = Symbol('dialog');
    const container = containerRef.current;

    const currentActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocusTarget =
      currentActive && !(container && container.contains(currentActive))
        ? currentActive
        : lastOutsideFocusedElement;

    openDialogStack.push({ id: instanceId, container });

    scrollLockCount += 1;
    if (scrollLockCount === 1) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const focusInitial = () => {
      const targetContainer = containerRef.current;
      if (!targetContainer) return;

      // Update stack container ref in case ref was attached slightly later
      const entry = openDialogStack.find((item) => item.id === instanceId);
      if (entry) entry.container = targetContainer;

      if (initialFocusRef?.current && isElementFocusable(initialFocusRef.current)) {
        initialFocusRef.current.focus({ preventScroll: true });
        return;
      }

      const activeNow = document.activeElement;
      if (activeNow instanceof HTMLElement && targetContainer.contains(activeNow)) {
        return;
      }

      const focusables = getFocusableElements(targetContainer);
      if (focusables.length > 0) {
        focusables[0].focus({ preventScroll: true });
      } else {
        if (!targetContainer.hasAttribute('tabindex')) {
          targetContainer.setAttribute('tabindex', '-1');
        }
        targetContainer.focus({ preventScroll: true });
      }
    };

    const rafId = window.requestAnimationFrame(focusInitial);

    const handleKeyDown = (event: KeyboardEvent) => {
      const topEntry = openDialogStack[openDialogStack.length - 1];
      if (!topEntry || topEntry.id !== instanceId) return;

      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const targetContainer = containerRef.current;
        if (!targetContainer) return;

        const focusables = getFocusableElements(targetContainer);
        if (focusables.length === 0) {
          event.preventDefault();
          targetContainer.focus({ preventScroll: true });
          return;
        }

        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const currentIndex = active ? focusables.indexOf(active) : -1;
        const wrappedIndex = getWrappedFocusTargetIndex(
          currentIndex,
          focusables.length,
          event.shiftKey
        );

        if (wrappedIndex !== null) {
          event.preventDefault();
          focusables[wrappedIndex].focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown);

      const idx = openDialogStack.findIndex((entry) => entry.id === instanceId);
      if (idx !== -1) {
        openDialogStack.splice(idx, 1);
      }

      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow ?? '';
        savedBodyOverflow = null;
      }

      if (returnFocusTarget && returnFocusTarget.isConnected) {
        window.requestAnimationFrame(() => {
          if (returnFocusTarget.isConnected) {
            returnFocusTarget.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [isOpen, containerRef, initialFocusRef]);
}
