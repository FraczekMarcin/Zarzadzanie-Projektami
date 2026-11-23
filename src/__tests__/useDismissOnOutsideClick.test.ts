import { describe, it, expect } from 'vitest';
import {
  OVERLAY_PORTAL_IGNORE_SELECTOR,
  isPortalOrDetachedTarget,
  createBackdropDismissMachine,
  createMenuDismissMachine,
  createOverlayStackRegistry,
} from '../hooks/useDismissOnOutsideClick';

describe('useDismissOnOutsideClick — maszyna stanów nakładek i menu', () => {
  describe('OVERLAY_PORTAL_IGNORE_SELECTOR i isPortalOrDetachedTarget', () => {
    it('ignoruje brak celu oraz odpięte węzły (isConnected: false)', () => {
      expect(isPortalOrDetachedTarget(null)).toBe(true);
      expect(isPortalOrDetachedTarget(undefined)).toBe(true);
      expect(isPortalOrDetachedTarget({ isConnected: false })).toBe(true);
    });

    it('ignoruje elementy pochodzące z portali / powiadomień (role="alert", role="status", data-dismiss-ignore, popper/flatpickr)', () => {
      expect(OVERLAY_PORTAL_IGNORE_SELECTOR).toContain('[role="alert"]');
      expect(OVERLAY_PORTAL_IGNORE_SELECTOR).toContain('[role="status"]');
      expect(OVERLAY_PORTAL_IGNORE_SELECTOR).toContain('[data-dismiss-ignore="true"]');
      expect(OVERLAY_PORTAL_IGNORE_SELECTOR).toContain('[data-radix-popper-content-wrapper]');
      expect(OVERLAY_PORTAL_IGNORE_SELECTOR).toContain('.flatpickr-calendar');

      const portalTarget = {
        isConnected: true,
        closest: (selector: string) => (selector.includes('[role="alert"]') ? {} : null),
      };
      expect(isPortalOrDetachedTarget(portalTarget)).toBe(true);

      const normalTarget = {
        isConnected: true,
        closest: () => null,
      };
      expect(isPortalOrDetachedTarget(normalTarget)).toBe(false);
    });
  });

  describe('createBackdropDismissMachine — Grupa A (dismiss)', () => {
    it('zamyka wyłącznie gdy zarówno pointerdown jak i click zaszły na samym tle (target === currentTarget)', () => {
      const backdrop = { id: 'backdrop' };
      const innerPanel = { id: 'panel' };
      const machine = createBackdropDismissMachine();

      // Prawdziwe kliknięcie w tło
      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({ target: backdrop, currentTarget: backdrop, mode: 'dismiss' })
      ).toBe('dismiss');

      // Zaznaczanie tekstu z wnętrza okna z puszczeniem myszy na tle (drag-out) nie może zamykać okna
      machine.handlePointerDown({ target: innerPanel, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({ target: backdrop, currentTarget: backdrop, mode: 'dismiss' })
      ).toBe('ignore');

      // Kliknięcie rozpoczęte na tle, ale puszczone w oknie również nie zamyka
      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({ target: innerPanel, currentTarget: backdrop, mode: 'dismiss' })
      ).toBe('ignore');
    });

    it('blokuje zamykanie przy przycisku innym niż główny, gdy okno jest zajęte (disabled), nie jest na wierzchu lub cel to portal', () => {
      const backdrop = { id: 'backdrop' };
      const machine = createBackdropDismissMachine();

      // Prawy przycisk myszy
      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 2 });
      expect(
        machine.handleClick({ target: backdrop, currentTarget: backdrop, mode: 'dismiss' })
      ).toBe('ignore');

      // disabled = true (np. trwa zapis lub przeciąganie)
      machine.handlePointerDown({
        target: backdrop,
        currentTarget: backdrop,
        button: 0,
        isDisabled: true,
      });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'dismiss',
          isDisabled: true,
        })
      ).toBe('ignore');

      // Okno nie jest na szczycie stosu (nad nim jest inne okno dialogowe)
      machine.handlePointerDown({
        target: backdrop,
        currentTarget: backdrop,
        button: 0,
        isTopmost: false,
      });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'dismiss',
          isTopmost: false,
        })
      ).toBe('ignore');

      // Cel należy do ignorowanego portalu / toasta
      machine.handlePointerDown({
        target: backdrop,
        currentTarget: backdrop,
        button: 0,
        isPortalIgnored: true,
      });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'dismiss',
          isPortalIgnored: true,
        })
      ).toBe('ignore');
    });
  });

  describe('createBackdropDismissMachine — Grupa B (form) i Conditional', () => {
    it('Grupa B (form) nigdy nie zamyka okna po kliknięciu w tło; przy isDirty zwraca flash_and_focus_cancel', () => {
      const backdrop = { id: 'backdrop' };
      const machine = createBackdropDismissMachine();

      // Czysty formularz -> ignoruje kliknięcie poza oknem
      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'form',
          isDirty: false,
        })
      ).toBe('ignore');

      // Brudny formularz -> nie zamyka, tylko mruga ramką i przenosi fokus na Anuluj
      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'form',
          isDirty: true,
        })
      ).toBe('flash_and_focus_cancel');
    });

    it('Conditional zamyka okno gdy isDirty === false, a przy isDirty === true zwraca flash_and_focus_cancel', () => {
      const backdrop = { id: 'backdrop' };
      const machine = createBackdropDismissMachine();

      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'conditional',
          isDirty: false,
        })
      ).toBe('dismiss');

      machine.handlePointerDown({ target: backdrop, currentTarget: backdrop, button: 0 });
      expect(
        machine.handleClick({
          target: backdrop,
          currentTarget: backdrop,
          mode: 'conditional',
          isDirty: true,
        })
      ).toBe('flash_and_focus_cancel');
    });
  });

  describe('createMenuDismissMachine — menu podręczne (Kanban „Przenieś do…”)', () => {
    it('zamyka menu przy kliknięciu poza menu i poza przyciskiem wyzwalającym, ignorując kliknięcia w trigger/menu/portal/dialog', () => {
      const machine = createMenuDismissMachine();

      // Kliknięcie poza menu i poza przyciskiem -> dismiss
      machine.handlePointerDown({ isInsideMenu: false, isInsideTrigger: false, button: 0 });
      expect(machine.handleClick({ isInsideMenu: false, isInsideTrigger: false })).toBe('dismiss');

      // Kliknięcie w przycisk wyzwalający (trigger) -> ignore (sam trigger przełącza menu)
      machine.handlePointerDown({ isInsideMenu: false, isInsideTrigger: true, button: 0 });
      expect(machine.handleClick({ isInsideMenu: false, isInsideTrigger: true })).toBe('ignore');

      // Kliknięcie wewnątrz menu -> ignore
      machine.handlePointerDown({ isInsideMenu: true, isInsideTrigger: false, button: 0 });
      expect(machine.handleClick({ isInsideMenu: true, isInsideTrigger: false })).toBe('ignore');

      // Drag z wnętrza menu na zewnątrz -> ignore
      machine.handlePointerDown({ isInsideMenu: true, isInsideTrigger: false, button: 0 });
      expect(machine.handleClick({ isInsideMenu: false, isInsideTrigger: false })).toBe('ignore');

      // Otwarty dialog blokujący -> ignore
      machine.handlePointerDown({
        isInsideMenu: false,
        isInsideTrigger: false,
        button: 0,
        hasBlockingDialog: true,
      });
      expect(
        machine.handleClick({
          isInsideMenu: false,
          isInsideTrigger: false,
          hasBlockingDialog: true,
        })
      ).toBe('ignore');

      // Kliknięcie w toast/portal -> ignore
      machine.handlePointerDown({
        isInsideMenu: false,
        isInsideTrigger: false,
        button: 0,
        isPortalIgnored: true,
      });
      expect(
        machine.handleClick({
          isInsideMenu: false,
          isInsideTrigger: false,
          isPortalIgnored: true,
        })
      ).toBe('ignore');
    });
  });

  describe('createOverlayStackRegistry — stos nakładek (LIFO)', () => {
    it('prawidłowo śledzi najwyższą nakładkę na stosie podczas otwierania i zamykania okien zagnieżdżonych', () => {
      const registry = createOverlayStackRegistry();
      const first = Symbol('first');
      const second = Symbol('second');

      expect(registry.size()).toBe(0);
      expect(registry.isTop(first)).toBe(false);

      registry.push(first);
      expect(registry.size()).toBe(1);
      expect(registry.isTop(first)).toBe(true);

      registry.push(second);
      expect(registry.size()).toBe(2);
      expect(registry.isTop(first)).toBe(false);
      expect(registry.isTop(second)).toBe(true);

      registry.remove(second);
      expect(registry.size()).toBe(1);
      expect(registry.isTop(first)).toBe(true);

      registry.remove(first);
      expect(registry.size()).toBe(0);
    });
  });
});
