import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { getOpenDialogCount, isTopDialogContainer } from '../utils/useFocusTrap';

export type OverlayDismissMode = 'dismiss' | 'form' | 'conditional';

export const OVERLAY_PORTAL_IGNORE_SELECTOR = [
  '[role="alert"]',
  '[role="status"]',
  '[data-dismiss-ignore="true"]',
  '[data-radix-popper-content-wrapper]',
  '.flatpickr-calendar',
].join(', ');

export interface TargetLike {
  isConnected?: boolean;
  closest?: (selector: string) => unknown;
}

export function isPortalOrDetachedTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return true;
  if (target.isConnected === false) return true;
  if (typeof target.closest === 'function') {
    if (target.closest(OVERLAY_PORTAL_IGNORE_SELECTOR)) {
      return true;
    }
  }
  return false;
}

export type BackdropDismissOutcome = 'ignore' | 'dismiss' | 'flash_and_focus_cancel';

export interface BackdropPointerDownInput {
  target: unknown;
  currentTarget: unknown;
  button?: number;
  isConnected?: boolean;
  isPortalIgnored?: boolean;
  isDisabled?: boolean;
  isTopmost?: boolean;
}

export interface BackdropClickInput extends BackdropPointerDownInput {
  mode: OverlayDismissMode;
  isDirty?: boolean;
}

export interface BackdropDismissMachine {
  handlePointerDown: (input: BackdropPointerDownInput) => void;
  handleClick: (input: BackdropClickInput) => BackdropDismissOutcome;
  reset: () => void;
}

export function createBackdropDismissMachine(): BackdropDismissMachine {
  let startedOnBackdrop = false;

  return {
    handlePointerDown(input) {
      const isPrimary = input.button === undefined || input.button === 0;
      const connected = input.isConnected !== false;
      startedOnBackdrop = Boolean(
        !input.isDisabled &&
          input.isTopmost !== false &&
          isPrimary &&
          connected &&
          !input.isPortalIgnored &&
          input.target !== null &&
          input.target !== undefined &&
          input.target === input.currentTarget
      );
    },
    handleClick(input) {
      const wasStartedOnBackdrop = startedOnBackdrop;
      startedOnBackdrop = false;

      const connected = input.isConnected !== false;
      if (
        !wasStartedOnBackdrop ||
        input.isDisabled ||
        input.isTopmost === false ||
        !connected ||
        input.isPortalIgnored ||
        input.target !== input.currentTarget
      ) {
        return 'ignore';
      }

      if (input.mode === 'dismiss') {
        return 'dismiss';
      }

      if (input.mode === 'conditional') {
        return input.isDirty ? 'flash_and_focus_cancel' : 'dismiss';
      }

      // Group B ('form'): never closes on outside click; flash + focus Cancel if dirty
      return input.isDirty ? 'flash_and_focus_cancel' : 'ignore';
    },
    reset() {
      startedOnBackdrop = false;
    },
  };
}

export interface MenuPointerInput {
  isInsideMenu: boolean;
  isInsideTrigger: boolean;
  button?: number;
  isConnected?: boolean;
  isPortalIgnored?: boolean;
  isDisabled?: boolean;
  hasBlockingDialog?: boolean;
}

export interface MenuDismissMachine {
  handlePointerDown: (input: MenuPointerInput) => void;
  handleClick: (input: MenuPointerInput) => 'ignore' | 'dismiss';
  reset: () => void;
}

export function createMenuDismissMachine(): MenuDismissMachine {
  let startedOutside = false;

  return {
    handlePointerDown(input) {
      const isPrimary = input.button === undefined || input.button === 0;
      const connected = input.isConnected !== false;
      startedOutside = Boolean(
        !input.isDisabled &&
          !input.hasBlockingDialog &&
          isPrimary &&
          connected &&
          !input.isPortalIgnored &&
          !input.isInsideMenu &&
          !input.isInsideTrigger
      );
    },
    handleClick(input) {
      const wasOutside = startedOutside;
      startedOutside = false;

      const connected = input.isConnected !== false;
      if (
        !wasOutside ||
        input.isDisabled ||
        input.hasBlockingDialog ||
        !connected ||
        input.isPortalIgnored ||
        input.isInsideMenu ||
        input.isInsideTrigger
      ) {
        return 'ignore';
      }

      return 'dismiss';
    },
    reset() {
      startedOutside = false;
    },
  };
}

export interface OverlayStackRegistry {
  push: (id: symbol) => void;
  remove: (id: symbol) => void;
  isTop: (id: symbol) => boolean;
  size: () => number;
  clear: () => void;
}

export function createOverlayStackRegistry(): OverlayStackRegistry {
  const stack: symbol[] = [];
  return {
    push(id) {
      if (!stack.includes(id)) stack.push(id);
    },
    remove(id) {
      const idx = stack.indexOf(id);
      if (idx !== -1) stack.splice(idx, 1);
    },
    isTop(id) {
      return stack.length > 0 && stack[stack.length - 1] === id;
    },
    size() {
      return stack.length;
    },
    clear() {
      stack.length = 0;
    },
  };
}

export function findFallbackCancelButton(panel: HTMLElement | null): HTMLElement | null {
  if (!panel) return null;
  const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
  return (
    buttons.find((btn) => {
      const text = (btn.textContent || '').trim();
      return text === 'Anuluj' || text === 'Zamknij';
    }) || null
  );
}

export interface UseDismissOnOutsideClickOptions {
  isOpen: boolean;
  mode: OverlayDismissMode;
  panelRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  disabled?: boolean;
  isDirty?: boolean;
  cancelButtonRef?: RefObject<HTMLElement | null>;
  onBeforeDismiss?: () => boolean;
}

export interface UseDismissOnOutsideClickResult {
  backdropProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
  };
  isFlashing: boolean;
  flashClassName: string;
  requestClose: () => void;
  isDiscardModalOpen: boolean;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

export function useDismissOnOutsideClick({
  isOpen,
  mode,
  panelRef,
  onDismiss,
  disabled = false,
  isDirty = false,
  cancelButtonRef,
  onBeforeDismiss,
}: UseDismissOnOutsideClickOptions): UseDismissOnOutsideClickResult {
  const [isFlashing, setIsFlashing] = useState(false);
  const [isDiscardModalOpen, setIsDiscardModalOpen] = useState(false);
  const flashTimerRef = useRef<number | null>(null);
  const machineRef = useRef<BackdropDismissMachine>(createBackdropDismissMachine());

  useEffect(() => {
    if (!isOpen) {
      setIsFlashing(false);
      setIsDiscardModalOpen(false);
      machineRef.current.reset();
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const triggerFlashAndFocusCancel = useCallback(() => {
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    setIsFlashing(false);
    window.requestAnimationFrame(() => {
      setIsFlashing(true);
      flashTimerRef.current = window.setTimeout(() => {
        setIsFlashing(false);
        flashTimerRef.current = null;
      }, 480);
    });

    const cancelTarget = cancelButtonRef?.current ?? findFallbackCancelButton(panelRef.current);
    if (cancelTarget && cancelTarget.isConnected) {
      cancelTarget.focus({ preventScroll: true });
    }
  }, [cancelButtonRef, panelRef]);

  const performClose = useCallback(() => {
    if (disabled) return;
    if (onBeforeDismiss && !onBeforeDismiss()) {
      return;
    }
    onDismiss();
  }, [disabled, onBeforeDismiss, onDismiss]);

  const requestClose = useCallback(() => {
    if (disabled) return;
    if (onBeforeDismiss && !onBeforeDismiss()) {
      return;
    }
    if ((mode === 'form' || mode === 'conditional') && isDirty) {
      setIsDiscardModalOpen(true);
      return;
    }
    onDismiss();
  }, [disabled, isDirty, mode, onBeforeDismiss, onDismiss]);

  const confirmDiscard = useCallback(() => {
    setIsDiscardModalOpen(false);
    onDismiss();
  }, [onDismiss]);

  const cancelDiscard = useCallback(() => {
    setIsDiscardModalOpen(false);
  }, []);

  const onBackdropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const targetNode = e.target as unknown as TargetLike;
      const isTopmost =
        getOpenDialogCount() === 0 || isTopDialogContainer(panelRef.current);
      machineRef.current.handlePointerDown({
        target: e.target,
        currentTarget: e.currentTarget,
        button: e.button,
        isConnected: targetNode?.isConnected,
        isPortalIgnored: isPortalOrDetachedTarget(targetNode),
        isDisabled: disabled,
        isTopmost,
      });
    },
    [disabled, panelRef]
  );

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const targetNode = e.target as unknown as TargetLike;
      const isTopmost =
        getOpenDialogCount() === 0 || isTopDialogContainer(panelRef.current);
      const outcome = machineRef.current.handleClick({
        target: e.target,
        currentTarget: e.currentTarget,
        isConnected: targetNode?.isConnected,
        isPortalIgnored: isPortalOrDetachedTarget(targetNode),
        isDisabled: disabled,
        isTopmost,
        mode,
        isDirty,
      });

      if (outcome === 'dismiss') {
        performClose();
      } else if (outcome === 'flash_and_focus_cancel') {
        triggerFlashAndFocusCancel();
      }
    },
    [disabled, isDirty, mode, panelRef, performClose, triggerFlashAndFocusCancel]
  );

  return {
    backdropProps: {
      onPointerDown: onBackdropPointerDown,
      onClick: onBackdropClick,
    },
    isFlashing,
    flashClassName: isFlashing ? 'animate-modal-flash border-amber-500 dark:border-amber-400' : '',
    requestClose,
    isDiscardModalOpen,
    confirmDiscard,
    cancelDiscard,
  };
}

export interface UseMenuDismissOptions {
  isOpen: boolean;
  menuRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null> | (() => HTMLElement | null);
  onClose: () => void;
  disabled?: boolean;
}

export function useMenuDismiss({
  isOpen,
  menuRef,
  triggerRef,
  onClose,
  disabled = false,
}: UseMenuDismissOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const triggerRefOrGetter = useRef(triggerRef);
  triggerRefOrGetter.current = triggerRef;
  const machineRef = useRef<MenuDismissMachine>(createMenuDismissMachine());

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      machineRef.current.reset();
      return;
    }

    const resolveTrigger = (): HTMLElement | null => {
      const src = triggerRefOrGetter.current;
      return typeof src === 'function' ? src() : src.current;
    };

    const evaluateTarget = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      const menuEl = menuRef.current;
      const triggerEl = resolveTrigger();
      const isInsideMenu = Boolean(node && menuEl?.contains(node));
      const isInsideTrigger = Boolean(node && triggerEl?.contains(node));
      const targetLike = node instanceof Element ? (node as unknown as TargetLike) : null;
      const isPortalIgnored =
        targetLike !== null &&
        !isInsideMenu &&
        !isInsideTrigger &&
        (isPortalOrDetachedTarget(targetLike) || Boolean(targetLike.closest?.('[role="dialog"]')));

      return {
        isInsideMenu,
        isInsideTrigger,
        isConnected: node ? node.isConnected : false,
        isPortalIgnored,
        hasBlockingDialog: getOpenDialogCount() > 0,
      };
    };

    const handlePointerDown = (e: PointerEvent) => {
      const info = evaluateTarget(e.target);
      machineRef.current.handlePointerDown({
        ...info,
        button: e.button,
        isDisabled: disabled,
      });
    };

    const handleClick = (e: MouseEvent) => {
      const info = evaluateTarget(e.target);
      const outcome = machineRef.current.handleClick({
        ...info,
        isDisabled: disabled,
      });
      if (outcome === 'dismiss') {
        const triggerEl = resolveTrigger();
        onCloseRef.current();
        window.requestAnimationFrame(() => {
          if (triggerEl && triggerEl.isConnected && getOpenDialogCount() === 0) {
            triggerEl.focus({ preventScroll: true });
          }
        });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || disabled) return;
      if (getOpenDialogCount() > 0) return;
      e.preventDefault();
      e.stopPropagation();
      const triggerEl = resolveTrigger();
      onCloseRef.current();
      window.requestAnimationFrame(() => {
        if (triggerEl && triggerEl.isConnected) {
          triggerEl.focus({ preventScroll: true });
        }
      });
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      machineRef.current.reset();
    };
  }, [isOpen, menuRef, disabled]);
}
