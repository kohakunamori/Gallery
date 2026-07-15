import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as WaterfallCardModule from '../exhibition/WaterfallCard';
import { cachePhotoImageForTest, resetPreloadedImages } from '../exhibition/WaterfallCard';
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

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  resetPreloadedImages();
});

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

  it('navigates to the next and previous image with horizontal swipes', () => {
    const onSelectIndex = vi.fn();

    const { rerender } = render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    const firstImage = screen.getByRole('img', { name: 'one.jpg' });
    const firstContent = firstImage.parentElement;

    expect(firstContent).not.toBeNull();

    fireEvent.touchStart(firstContent as HTMLElement, {
      touches: [{ clientX: 220, clientY: 120 }],
    });
    fireEvent.touchEnd(firstContent as HTMLElement, {
      changedTouches: [{ clientX: 120, clientY: 128 }],
    });

    expect(onSelectIndex).toHaveBeenCalledWith(1);

    rerender(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={1}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    onSelectIndex.mockClear();

    const secondImage = screen.getByRole('img', { name: 'two.jpg' });
    const secondContent = secondImage.parentElement;

    expect(secondContent).not.toBeNull();

    fireEvent.touchStart(secondContent as HTMLElement, {
      touches: [{ clientX: 120, clientY: 120 }],
    });
    fireEvent.touchEnd(secondContent as HTMLElement, {
      changedTouches: [{ clientX: 220, clientY: 128 }],
    });

    expect(onSelectIndex).toHaveBeenCalledWith(0);
  });

  it('ignores short or mostly vertical swipes', () => {
    const onSelectIndex = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={vi.fn()}
      />,
    );

    const image = screen.getByRole('img', { name: 'one.jpg' });
    const content = image.parentElement;

    expect(content).not.toBeNull();

    fireEvent.touchStart(content as HTMLElement, {
      touches: [{ clientX: 200, clientY: 100 }],
    });
    fireEvent.touchEnd(content as HTMLElement, {
      changedTouches: [{ clientX: 170, clientY: 104 }],
    });

    fireEvent.touchStart(content as HTMLElement, {
      touches: [{ clientX: 200, clientY: 100 }],
    });
    fireEvent.touchEnd(content as HTMLElement, {
      changedTouches: [{ clientX: 170, clientY: 220 }],
    });

    expect(onSelectIndex).not.toHaveBeenCalled();
  });

  it('preloads the adjacent original image after the current modal image loads', () => {
    const preloadSpy = vi.spyOn(WaterfallCardModule, 'preloadPhotoImage').mockImplementation(() => {});

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(preloadSpy).not.toHaveBeenCalled();

    fireEvent.load(screen.getByRole('img', { name: 'one.jpg' }));

    expect(preloadSpy).toHaveBeenCalledWith('two', '/media/two.jpg');
  });

  it('updates adjacent preloading when the selected image changes', () => {
    const preloadSpy = vi.spyOn(WaterfallCardModule, 'preloadPhotoImage').mockImplementation(() => {});
    const photosWithThree = [
      ...photos,
      {
        id: 'three',
        filename: 'three.jpg',
        url: '/media/three.jpg',
        thumbnailUrl: '/media/three.jpg',
        takenAt: '2026-03-29T09:00:00+00:00',
        sortTime: '2026-03-29T09:00:00+00:00',
        width: 1200,
        height: 800,
      },
    ];

    const { rerender } = render(
      <PhotoViewerModal
        photos={photosWithThree}
        selectedIndex={1}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(preloadSpy).not.toHaveBeenCalled();

    fireEvent.load(screen.getByRole('img', { name: 'two.jpg' }));

    expect(preloadSpy).toHaveBeenCalledWith('one', '/media/one.jpg');
    expect(preloadSpy).toHaveBeenCalledWith('three', '/media/three.jpg');

    preloadSpy.mockClear();

    rerender(
      <PhotoViewerModal
        photos={photosWithThree}
        selectedIndex={2}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(preloadSpy).not.toHaveBeenCalled();

    fireEvent.load(screen.getByRole('img', { name: 'three.jpg' }));

    expect(preloadSpy).toHaveBeenCalledWith('two', '/media/two.jpg');
  });

  it('prefers a cached image url for the same photo id', () => {
    cachePhotoImageForTest('one', 'https://r2.example.com/one.jpg');

    render(
      <PhotoViewerModal
        photos={[
          {
            ...photos[0],
            url: 'https://qiniu.example.com/one.jpg',
          },
          photos[1],
        ]}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'one.jpg' })).toHaveAttribute('src', 'https://r2.example.com/one.jpg');
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
