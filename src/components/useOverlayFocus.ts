import { useLayoutEffect, useRef, type RefObject } from 'react';

interface OverlayFocusOptions {
  open: boolean;
  onClose: () => void;
  initialFocus?: string;
  isolateBackground?: boolean;
}

export function useOverlayFocus<T extends HTMLElement>({
  open,
  onClose,
  initialFocus,
  isolateBackground = true,
}: OverlayFocusOptions): RefObject<T> {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !containerRef.current) {
      return undefined;
    }
    const container = containerRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isolated = isolateBackground ? isolateOverlayBackground(container) : [];
    const focusTarget =
      (initialFocus ? container.querySelector<HTMLElement>(initialFocus) : null) ??
      focusableElements(container)[0] ??
      container;
    if (!container.hasAttribute('tabindex') && focusTarget === container) {
      container.tabIndex = -1;
    }
    window.requestAnimationFrame(() => focusTarget.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
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
      } else if (!container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreIsolatedElements(isolated);
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
  }, [initialFocus, isolateBackground, open]);

  return containerRef;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    ),
  ).filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
}

interface IsolatedElement {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

function isolateOverlayBackground(container: HTMLElement): IsolatedElement[] {
  const overlayRoot = container.closest<HTMLElement>('.modal-backdrop, .project-drawer-layer, .inspector-drawer-layer') ?? container;
  const isolated: IsolatedElement[] = [];
  let current: HTMLElement = overlayRoot;
  while (current.parentElement && current.parentElement !== document.body) {
    const parent = current.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === current || sibling.contains(current)) {
        continue;
      }
      isolated.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
    current = parent;
  }
  return isolated;
}

function restoreIsolatedElements(isolated: IsolatedElement[]) {
  for (const { element, inert, ariaHidden } of isolated) {
    element.inert = inert;
    if (ariaHidden === null) {
      element.removeAttribute('aria-hidden');
    } else {
      element.setAttribute('aria-hidden', ariaHidden);
    }
  }
}
