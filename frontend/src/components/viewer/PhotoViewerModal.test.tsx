import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoViewerModal } from './PhotoViewerModal';

const photos = [
  {
    id: 'one',
    filename: 'one.jpg',
    url: '/media/one.jpg',
    thumbnailUrl: '/media/one.jpg',
    takenAt: '2026-03-31T09:00:00+00:00',
    sortTime: '2026-03-31T09:00:00+00:00',
    width: 1200,
    height: 800,
  },
  {
    id: 'two',
    filename: 'two.jpg',
    url: '/media/two.jpg',
    thumbnailUrl: '/media/two.jpg',
    takenAt: '2026-03-30T09:00:00+00:00',
    sortTime: '2026-03-30T09:00:00+00:00',
    width: 1200,
    height: 800,
  },
];

describe('PhotoViewerModal', () => {
  it('renders an immersive viewer overlay with chrome, metadata, navigation, and active viewer controls', async () => {
    const user = userEvent.setup();
    const onSelectIndex = vi.fn();
    const onClose = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });
    const closeButton = within(viewer).getByRole('button', { name: 'Close viewer' });

    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveFocus();
    expect(within(viewer).getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();
    expect(within(viewer).getByText(/1 of 2/)).toBeInTheDocument();
    expect(within(viewer).getByRole('heading', { name: 'Info' })).toBeInTheDocument();
    expect(within(viewer).getByText('1200 × 800')).toBeInTheDocument();
    expect(within(viewer).getByRole('button', { name: 'Bookmark photo' })).toBeDisabled();
    expect(within(viewer).getByRole('button', { name: 'Share photo' })).toBeDisabled();
    expect(within(viewer).getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(within(viewer).getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(within(viewer).getByRole('button', { name: 'Hide details' })).toBeEnabled();
    expect(within(viewer).getByRole('button', { name: 'Previous photo' })).toBeDisabled();
    expect(within(viewer).getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Next photo' }));
    expect(onSelectIndex).toHaveBeenCalledWith(1);

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders exhibition viewer chrome with zoom status and details toggle copy', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });

    expect(within(viewer).getByText('100%')).toBeInTheDocument();
    expect(within(viewer).getByRole('button', { name: 'Hide details' })).toBeInTheDocument();
    expect(within(viewer).getByText('Photo viewer')).toBeInTheDocument();
  });

  it('closes the viewer when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates to previous photo with ArrowLeft key', async () => {
    const user = userEvent.setup();
    const onSelectIndex = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={1}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    await user.keyboard('{ArrowLeft}');

    expect(onSelectIndex).toHaveBeenCalledWith(0);
  });

  it('navigates to next photo with ArrowRight key', async () => {
    const user = userEvent.setup();
    const onSelectIndex = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    await user.keyboard('{ArrowRight}');

    expect(onSelectIndex).toHaveBeenCalledWith(1);
  });

  it('navigates with A and D keys', async () => {
    const user = userEvent.setup();
    const onSelectIndex = vi.fn();

    const { rerender } = render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={1}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    await user.keyboard('a');
    expect(onSelectIndex).toHaveBeenCalledWith(0);

    rerender(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    onSelectIndex.mockClear();
    await user.keyboard('d');
    expect(onSelectIndex).toHaveBeenCalledWith(1);
  });

  it('toggles details panel visibility', async () => {
    const user = userEvent.setup();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });
    const toggleButton = within(viewer).getByRole('button', { name: 'Hide details' });

    expect(within(viewer).getByRole('heading', { name: 'Info' })).toBeInTheDocument();

    await user.click(toggleButton);
    expect(within(viewer).queryByRole('heading', { name: 'Info' })).not.toBeInTheDocument();
    expect(within(viewer).getByRole('button', { name: 'Show details' })).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Show details' }));
    expect(within(viewer).getByRole('heading', { name: 'Info' })).toBeInTheDocument();
  });

  it('wraps Shift+Tab from the close button to the last focusable control in the modal', async () => {
    const user = userEvent.setup();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });
    const closeButton = within(viewer).getByRole('button', { name: 'Close viewer' });
    const detailsToggleButton = within(viewer).getByRole('button', { name: 'Hide details' });

    expect(closeButton).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');

    expect(detailsToggleButton).toHaveFocus();
  });

  it('wraps Tab from the last focusable control in the modal to the close button', async () => {
    const user = userEvent.setup();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });
    const closeButton = within(viewer).getByRole('button', { name: 'Close viewer' });
    const detailsToggleButton = within(viewer).getByRole('button', { name: 'Hide details' });

    detailsToggleButton.focus();
    expect(detailsToggleButton).toHaveFocus();

    await user.keyboard('{Tab}');

    expect(closeButton).toHaveFocus();
  });

  it('zooms in and out with buttons', async () => {
    const user = userEvent.setup();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });
    const zoomInButton = within(viewer).getByRole('button', { name: 'Zoom in' });
    const zoomOutButton = within(viewer).getByRole('button', { name: 'Zoom out' });

    expect(within(viewer).getByText('100%')).toBeInTheDocument();
    expect(zoomOutButton).toBeDisabled();

    await user.click(zoomInButton);
    expect(within(viewer).getByText('150%')).toBeInTheDocument();
    expect(zoomOutButton).toBeEnabled();

    await user.click(zoomInButton);
    expect(within(viewer).getByText('200%')).toBeInTheDocument();

    await user.click(zoomInButton);
    expect(within(viewer).getByText('300%')).toBeInTheDocument();
    expect(zoomInButton).toBeDisabled();

    await user.click(zoomOutButton);
    expect(within(viewer).getByText('200%')).toBeInTheDocument();
    expect(zoomInButton).toBeEnabled();
  });

  it('keeps pan translation in screen space after zooming', async () => {
    const user = userEvent.setup();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });
    const zoomInButton = within(viewer).getByRole('button', { name: 'Zoom in' });
    const image = within(viewer).getByRole('img', { name: 'one.jpg' });
    const panSurface = image.parentElement;

    expect(panSurface).not.toBeNull();

    await user.click(zoomInButton);

    fireEvent.mouseDown(panSurface as HTMLDivElement);

    const mouseMoveEvent = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperties(mouseMoveEvent, {
      movementX: { value: 12 },
      movementY: { value: 8 },
    });

    fireEvent(panSurface as HTMLDivElement, mouseMoveEvent);
    fireEvent.mouseUp(panSurface as HTMLDivElement);

    expect(image).toHaveStyle({
      transform: 'translate(12px, 8px) scale(1.5)',
    });
  });
});
