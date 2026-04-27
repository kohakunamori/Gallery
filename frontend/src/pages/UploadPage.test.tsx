import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadPage } from './UploadPage';
import { uploadPhotos } from '../services/uploadPhotos';

vi.mock('../services/uploadPhotos', () => ({
  uploadPhotos: vi.fn(),
}));

const mockedUploadPhotos = vi.mocked(uploadPhotos);

describe('UploadPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('previews selected file metadata and uploads the files', async () => {
    const user = userEvent.setup();
    const avifFile = new File(['avif-body'], 'new art.avif', { type: 'image/avif' });
    const webpFile = new File(['webp-body'], 'batch.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockImplementation(async (_files, options) => {
      if (options !== undefined && !('aborted' in options)) {
        options.onOutput?.('uploaded r2', 'stdout');
      }

      return {
        files: [
          { name: 'new art.avif', path: 'uploads/new-art.avif', size: avifFile.size },
          { name: 'batch.webp', path: 'uploads/batch.webp', size: webpFile.size },
        ],
        output: ['uploaded r2', 'uploaded qiniu'],
      };
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), [avifFile, webpFile]);

    expect(screen.getByText('new art.avif')).toBeInTheDocument();
    expect(screen.getByText('batch.webp')).toBeInTheDocument();
    expect(screen.getByText(/2 files/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    await waitFor(() => {
      expect(mockedUploadPhotos).toHaveBeenCalledWith([avifFile, webpFile], expect.objectContaining({ onOutput: expect.any(Function) }));
    });
    expect(await screen.findByText('Upload complete')).toBeInTheDocument();
    expect(screen.getByText(/Saved as uploads\/new-art\.avif/i)).toBeInTheDocument();
    expect(screen.getByText(/uploaded r2/)).toBeInTheDocument();
    expect(screen.getByText(/uploaded qiniu/)).toBeInTheDocument();
  });

  it('shows a useful error when no file is selected', async () => {
    const user = userEvent.setup();

    render(<UploadPage />);

    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose one or more image files before uploading.');
    expect(mockedUploadPhotos).not.toHaveBeenCalled();
  });

  it('shows live script output while uploading', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });
    let resolveUpload: ((value: { files: []; output: string[] }) => void) | undefined;

    mockedUploadPhotos.mockImplementation((_files, options) => {
      if (options !== undefined && !('aborted' in options)) {
        options.onOutput?.('streamed r2 line', 'stdout');
      }

      return new Promise((resolve) => {
        resolveUpload = resolve;
      });
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(await screen.findByText('streamed r2 line')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Uploading/i })).toBeDisabled();

    resolveUpload?.({ files: [], output: ['streamed r2 line'] });
    expect(await screen.findByText('Upload complete')).toBeInTheDocument();
  });

  it('shows backend errors and keeps streamed output visible', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockImplementation(async (_files, options) => {
      if (options !== undefined && !('aborted' in options)) {
        options.onOutput?.('remote failed log', 'stderr');
      }

      throw new Error('Remote upload failed.');
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Remote upload failed.');
    expect(screen.getByText('remote failed log')).toBeInTheDocument();
  });
});
