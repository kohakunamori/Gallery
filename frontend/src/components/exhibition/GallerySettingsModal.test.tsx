import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GallerySettingsModal } from './GallerySettingsModal';

const defaultProps = {
  columnPreference: 'auto' as const,
  sortPreference: 'newest' as const,
  mediaSourcePreference: 'auto' as const,
  themePreference: 'system' as const,
  mediaSourceStatuses: [],
  onSelectColumnPreference: vi.fn(),
  onSelectSortPreference: vi.fn(),
  onSelectMediaSourcePreference: vi.fn(),
  onSelectThemePreference: vi.fn(),
  onClose: vi.fn(),
};

function mockMatchMedia(matchesDesktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 768px') ? matchesDesktop : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe('GallerySettingsModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockMatchMedia(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('focuses the desktop close control on open for desktop viewports', () => {
    mockMatchMedia(true);

    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    const desktopClose = dialog.querySelector('[data-settings-close="desktop"]');

    expect(desktopClose).toBeInstanceOf(HTMLButtonElement);
    expect(desktopClose).toHaveFocus();
  });

  it('focuses the mobile close control on open for narrow viewports', () => {
    mockMatchMedia(false);

    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    const mobileClose = dialog.querySelector('[data-settings-close="mobile"]');

    expect(mobileClose).toBeInstanceOf(HTMLButtonElement);
    expect(mobileClose).toHaveFocus();
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open gallery settings';
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<GallerySettingsModal {...defaultProps} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(opener).toHaveFocus();

    opener.remove();
  });

  it('keeps focus trapped inside the settings dialog', async () => {
    const user = userEvent.setup();

    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    const focused = document.activeElement as HTMLElement | null;
    expect(dialog.contains(focused)).toBe(true);

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Tab}');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('lets keyboard users change a sort option', async () => {
    const user = userEvent.setup();
    const onSelectSortPreference = vi.fn();

    render(<GallerySettingsModal {...defaultProps} onSelectSortPreference={onSelectSortPreference} />);

    await user.click(screen.getByRole('button', { name: /Oldest first/i }));
    expect(onSelectSortPreference).toHaveBeenCalledWith('oldest');
  });

  it('lets users change the theme preference and marks the current selection', async () => {
    const user = userEvent.setup();
    const onSelectThemePreference = vi.fn();

    render(
      <GallerySettingsModal
        {...defaultProps}
        themePreference="light"
        onSelectThemePreference={onSelectThemePreference}
      />,
    );

    const darkOption = screen.getByTestId('theme-option-dark');
    const lightOption = screen.getByTestId('theme-option-light');

    expect(lightOption).toHaveAttribute('aria-pressed', 'true');
    expect(darkOption).toHaveAttribute('aria-pressed', 'false');

    await user.click(darkOption);
    expect(onSelectThemePreference).toHaveBeenCalledWith('dark');
  });

  it('renders option controls with keyboard-reachable close actions', () => {
    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    expect(within(dialog).getByRole('button', { name: /Newest first/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /System/i })).toBeInTheDocument();
    expect(dialog.querySelector('[data-settings-close="desktop"]')).not.toBeNull();
    expect(dialog.querySelector('[data-settings-close="mobile"]')).not.toBeNull();
  });
  it('focuses the desktop close control on open for desktop viewports', () => {
    mockMatchMedia(true);

    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    const desktopClose = dialog.querySelector('[data-settings-close="desktop"]');

    expect(desktopClose).toBeInstanceOf(HTMLButtonElement);
    expect(desktopClose).toHaveFocus();
  });

  it('focuses the mobile close control on open for narrow viewports', () => {
    mockMatchMedia(false);

    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    const mobileClose = dialog.querySelector('[data-settings-close="mobile"]');

    expect(mobileClose).toBeInstanceOf(HTMLButtonElement);
    expect(mobileClose).toHaveFocus();
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open gallery settings';
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<GallerySettingsModal {...defaultProps} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(opener).toHaveFocus();

    opener.remove();
  });

  it('keeps focus trapped inside the settings dialog', async () => {
    const user = userEvent.setup();

    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    const focused = document.activeElement as HTMLElement | null;
    expect(dialog.contains(focused)).toBe(true);

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Tab}');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('lets keyboard users change a sort option', async () => {
    const user = userEvent.setup();
    const onSelectSortPreference = vi.fn();

    render(<GallerySettingsModal {...defaultProps} onSelectSortPreference={onSelectSortPreference} />);

    await user.click(screen.getByRole('button', { name: /Oldest first/i }));
    expect(onSelectSortPreference).toHaveBeenCalledWith('oldest');
  });

  it('renders option controls with keyboard-reachable close actions', () => {
    render(<GallerySettingsModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    expect(within(dialog).getByRole('button', { name: /Newest first/i })).toBeInTheDocument();
    expect(dialog.querySelector('[data-settings-close="desktop"]')).not.toBeNull();
    expect(dialog.querySelector('[data-settings-close="mobile"]')).not.toBeNull();
  });

  it('shows a quiet build identity footer', () => {
    render(<GallerySettingsModal {...defaultProps} />);

    const buildLine = screen.getByTestId('gallery-build-id');
    expect(buildLine).toHaveTextContent(/^Build\s+\S+/);
    expect(buildLine).toHaveClass('text-xs', 'text-on-surface-variant');
  });

});
