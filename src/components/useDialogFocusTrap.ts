import { useEffect, type RefObject } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocusTrap<T extends HTMLElement>(dialogRef: RefObject<T | null>): void {
  useEffect(() => {
    let animationFrame = 0;
    let cleanupTrap: (() => void) | undefined;

    function attachTrap() {
      const currentDialog = dialogRef.current;
      if (!currentDialog) {
        animationFrame = window.requestAnimationFrame(attachTrap);
        return;
      }
      const dialogElement: HTMLElement = currentDialog;
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusDialog = () => {
        if (dialogElement.contains(document.activeElement)) {
          return;
        }
        const firstFocusable = focusableElements(dialogElement)[0];
        (firstFocusable ?? dialogElement).focus();
      };

      dialogElement.dataset.focusTrap = 'active';
      animationFrame = window.requestAnimationFrame(focusDialog);

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Tab') {
          return;
        }

        const focusable = focusableElements(dialogElement);
        if (focusable.length === 0) {
          event.preventDefault();
          dialogElement.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      dialogElement.addEventListener('keydown', handleKeyDown);
      cleanupTrap = () => {
        dialogElement.removeEventListener('keydown', handleKeyDown);
        delete dialogElement.dataset.focusTrap;
        if (previousFocus?.isConnected) {
          previousFocus.focus();
        }
      };
    }

    attachTrap();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      cleanupTrap?.();
    };
  }, [dialogRef]);
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}
