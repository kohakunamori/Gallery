import { describe, expect, it, vi } from 'vitest';
import {
  getFocusableElements,
  getVisibleInitialFocusElement,
  isElementVisible,
  trapTabKey,
} from './dialogFocus';

function createButton(label: string, options: { disabled?: boolean; hidden?: boolean } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;

  if (options.disabled) {
    button.disabled = true;
  }

  if (options.hidden) {
    button.hidden = true;
  }

  return button;
}

describe('dialogFocus helpers', () => {
  it('collects enabled focusable descendants and skips disabled controls', () => {
    const root = document.createElement('div');
    const enabled = createButton('Enabled');
    const disabled = createButton('Disabled', { disabled: true });
    const link = document.createElement('a');
    link.href = '/upload';
    link.textContent = 'Upload';

    root.append(enabled, disabled, link);
    document.body.append(root);

    expect(getFocusableElements(root)).toEqual([enabled, link]);

    root.remove();
  });

  it('wraps Tab from the last focusable element to the first', () => {
    const root = document.createElement('div');
    const first = createButton('First');
    const second = createButton('Second');
    root.append(first, second);
    document.body.append(root);
    second.focus();

    const preventDefault = vi.fn();
    trapTabKey({ key: 'Tab', shiftKey: false, preventDefault } as unknown as KeyboardEvent, root);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(first).toHaveFocus();

    root.remove();
  });

  it('wraps Shift+Tab from the first focusable element to the last', () => {
    const root = document.createElement('div');
    const first = createButton('First');
    const second = createButton('Second');
    root.append(first, second);
    document.body.append(root);
    first.focus();

    const preventDefault = vi.fn();
    trapTabKey({ key: 'Tab', shiftKey: true, preventDefault } as unknown as KeyboardEvent, root);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(second).toHaveFocus();

    root.remove();
  });

  it('prefers a visible candidate for initial dialog focus', () => {
    const hidden = createButton('Hidden');
    const visible = createButton('Visible');
    Object.defineProperty(hidden, 'getClientRects', {
      value: () => [],
    });
    Object.defineProperty(visible, 'getClientRects', {
      value: () => [new DOMRect(0, 0, 40, 20)],
    });

    expect(isElementVisible(hidden)).toBe(false);
    expect(isElementVisible(visible)).toBe(true);
    expect(getVisibleInitialFocusElement([hidden, visible])).toBe(visible);
  });

  it('skips controls with tabindex -1 and nested aria-hidden subtrees', () => {
    const root = document.createElement('div');
    const enabled = createButton('Enabled');
    const skipped = createButton('Skipped');
    skipped.tabIndex = -1;
    const hiddenTree = document.createElement('div');
    hiddenTree.setAttribute('aria-hidden', 'true');
    const hiddenButton = createButton('Hidden tree');
    hiddenTree.append(hiddenButton);
    root.append(enabled, skipped, hiddenTree);
    document.body.append(root);

    expect(getFocusableElements(root)).toEqual([enabled]);

    root.remove();
  });
});
