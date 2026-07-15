import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled') || element.tabIndex === -1 || element.hidden) {
      return false;
    }

    // Skip controls nested under aria-hidden or inert subtrees (e.g. hidden header chrome).
    if (element.closest('[aria-hidden="true"], [inert]')) {
      return false;
    }

    return true;
  });
}

export function getTabbableElements(root: HTMLElement): HTMLElement[] {
  const focusableElements = getFocusableElements(root);
  const visibleElements = focusableElements.filter(isElementVisible);

  // Prefer the visible subset when layout data exists; fall back when jsdom reports no boxes.
  return visibleElements.length > 0 ? visibleElements : focusableElements;
}

export function trapTabKey(
  event: KeyboardEvent | ReactKeyboardEvent,
  root: HTMLElement,
): void {
  if (event.key !== 'Tab') {
    return;
  }

  const focusableElements = getTabbableElements(root);

  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const firstFocusableElement = focusableElements[0];
  const lastFocusableElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstFocusableElement) {
    event.preventDefault();
    lastFocusableElement.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === lastFocusableElement) {
    event.preventDefault();
    firstFocusableElement.focus();
  }
}

export function isElementVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

export function getVisibleInitialFocusElement(
  candidates: Array<HTMLElement | null | undefined>,
): HTMLElement | null {
  for (const candidate of candidates) {
    if (candidate && isElementVisible(candidate)) {
      return candidate;
    }
  }

  return candidates.find((candidate): candidate is HTMLElement => candidate != null) ?? null;
}
