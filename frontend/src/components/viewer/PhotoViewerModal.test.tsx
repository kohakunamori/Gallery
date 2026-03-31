import { render, screen, within } from '@testing-library/react';
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
});
