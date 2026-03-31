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
  it('renders a minimal lightbox with image, page count, and basic navigation', async () => {
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

    const lightbox = screen.getByRole('dialog', { name: 'Image lightbox' });
    const closeButton = within(lightbox).getByRole('button', { name: 'Close image' });

    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveFocus();
    expect(within(lightbox).getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();
    expect(within(lightbox).getByText('1 / 2')).toBeInTheDocument();
    expect(within(lightbox).getByRole('button', { name: 'Previous image' })).toBeDisabled();

    await user.click(within(lightbox).getByRole('button', { name: 'Next image' }));
    expect(onSelectIndex).toHaveBeenCalledWith(1);

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the lightbox when Escape is pressed', async () => {
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

  it('navigates with ArrowLeft and ArrowRight keys', async () => {
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

    await user.keyboard('{ArrowLeft}');
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
    await user.keyboard('{ArrowRight}');
    expect(onSelectIndex).toHaveBeenCalledWith(1);
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('lightbox-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus trapped inside the lightbox', async () => {
    const user = userEvent.setup();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const lightbox = screen.getByRole('dialog', { name: 'Image lightbox' });
    const closeButton = within(lightbox).getByRole('button', { name: 'Close image' });
    const nextButton = within(lightbox).getByRole('button', { name: 'Next image' });

    expect(closeButton).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(nextButton).toHaveFocus();

    await user.keyboard('{Tab}');
    expect(closeButton).toHaveFocus();
  });
});
