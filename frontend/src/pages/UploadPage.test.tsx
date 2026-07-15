import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadPage } from './UploadPage';
import { uploadPhotos } from '../services/uploadPhotos';
import { resetPhotoRequestCache } from '../services/photos';

vi.mock('../services/uploadPhotos', () => ({
  uploadPhotos: vi.fn(),
}));

vi.mock('../services/photos', () => ({
  resetPhotoRequestCache: vi.fn(),
}));

const mockedUploadPhotos = vi.mocked(uploadPhotos);
const mockedResetPhotoRequestCache = vi.mocked(resetPhotoRequestCache);

function createDataTransfer(files: File[]) {
  return {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
    })),
    types: ['Files'],
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

describe('UploadPage', () => {
  beforeEach(() => {
    localStorage.clear();

    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(() => 'blob:preview'),
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:preview');
    }

    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('previews selected files in a grid and uploads them', async () => {
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

    await user.type(screen.getByLabelText(/Upload token/i), 'secret-token');
    await user.upload(screen.getByLabelText(/Choose image files/i), [avifFile, webpFile]);

    const previewGrid = screen.getByTestId('upload-preview-grid');
    expect(within(previewGrid).getByText('new art.avif')).toBeInTheDocument();
    expect(within(previewGrid).getByText('batch.webp')).toBeInTheDocument();
    expect(screen.getByText(/2 files/i)).toBeInTheDocument();
    expect(previewGrid.querySelectorAll('img')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    await waitFor(() => {
      expect(mockedUploadPhotos).toHaveBeenCalledWith(
        [avifFile, webpFile],
        expect.objectContaining({
          onOutput: expect.any(Function),
          signal: expect.any(AbortSignal),
          uploadToken: 'secret-token',
        }),
      );
    });

    expect(await screen.findByText('Live clear!')).toBeInTheDocument();
    expect(screen.getByText(/Published 2 images/i)).toBeInTheDocument();
    expect(screen.getByTestId('upload-success-hint')).toHaveTextContent(
      /New photos appear under Newest sort without a hard reload/i,
    );
    expect(screen.getByRole('link', { name: /View the stage/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: /Upload more/i })).toBeInTheDocument();
    expect(mockedResetPhotoRequestCache).toHaveBeenCalled();

    const technicalLog = screen.getByTestId('technical-log');
    expect(technicalLog).toBeInTheDocument();
    expect(technicalLog).not.toHaveAttribute('open');
    expect(within(technicalLog).getByText(/uploaded r2/)).toBeInTheDocument();
    expect(within(technicalLog).getByText(/uploaded qiniu/)).toBeInTheDocument();
    expect(screen.queryByText(/Published as uploads\//i)).not.toBeInTheDocument();
  });

  it('stages dropped files into the preview grid', async () => {
    const file = new File(['image-body'], 'dropped.webp', { type: 'image/webp' });

    render(<UploadPage />);

    const dropzone = screen.getByTestId('upload-dropzone');
    fireEvent.drop(dropzone, { dataTransfer: createDataTransfer([file]) });

    const previewGrid = await screen.findByTestId('upload-preview-grid');
    expect(within(previewGrid).getByText('dropped.webp')).toBeInTheDocument();
    expect(screen.getByText(/1 file/i)).toBeInTheDocument();
  });

  it('appends dropped files to an existing selection', async () => {
    const user = userEvent.setup();
    const first = new File(['a'], 'first.webp', { type: 'image/webp' });
    const second = new File(['b'], 'second.webp', { type: 'image/webp' });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), first);
    fireEvent.drop(screen.getByTestId('upload-dropzone'), {
      dataTransfer: createDataTransfer([second]),
    });

    const previewGrid = screen.getByTestId('upload-preview-grid');
    expect(within(previewGrid).getByText('first.webp')).toBeInTheDocument();
    expect(within(previewGrid).getByText('second.webp')).toBeInTheDocument();
    expect(screen.getByText(/2 files/i)).toBeInTheDocument();
  });

  it('ignores unsupported dropped files with a calm message', () => {
    const textFile = new File(['nope'], 'notes.txt', { type: 'text/plain' });

    render(<UploadPage />);

    fireEvent.drop(screen.getByTestId('upload-dropzone'), {
      dataTransfer: createDataTransfer([textFile]),
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'None of the dropped files are supported image types.',
    );
    expect(screen.queryByTestId('upload-preview-grid')).not.toBeInTheDocument();
  });

  it('shows a calm message when the file picker yields only unsupported types', () => {
    const textFile = new File(['nope'], 'notes.txt', { type: 'text/plain' });

    render(<UploadPage />);

    // Bypass the accept attribute so we can assert client-side filtering + messaging.
    fireEvent.change(screen.getByLabelText(/Choose image files/i), {
      target: { files: [textFile] },
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'None of the selected files are supported image types.',
    );
    expect(screen.queryByTestId('upload-preview-grid')).not.toBeInTheDocument();
  });

  it('removes individual staged files and updates counts', async () => {
    const user = userEvent.setup();
    const first = new File(['a'], 'keep.webp', { type: 'image/webp' });
    const second = new File(['b'], 'remove-me.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockResolvedValue({
      files: [{ name: 'keep.webp', path: 'uploads/keep.webp', size: first.size }],
      output: [],
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), [first, second]);
    expect(screen.getByText(/2 files/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Remove remove-me\.webp/i }));

    expect(screen.queryByText('remove-me.webp')).not.toBeInTheDocument();
    expect(screen.getByText('keep.webp')).toBeInTheDocument();
    expect(screen.getByText(/1 file/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    await waitFor(() => {
      expect(mockedUploadPhotos).toHaveBeenCalledWith([first], expect.any(Object));
    });
  });

  it('resets the staging UI when Upload more is chosen after success', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockResolvedValue({
      files: [{ name: 'source.webp', path: 'uploads/source.webp', size: file.size }],
      output: ['done'],
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));
    expect(await screen.findByText('Live clear!')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upload more/i }));

    expect(screen.queryByText('Live clear!')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upload-preview-grid')).not.toBeInTheDocument();
    expect(screen.getByTestId('upload-dropzone')).toBeInTheDocument();
  });

  it('shows a useful error when no file is selected', async () => {
    const user = userEvent.setup();

    render(<UploadPage />);

    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose one or more image files before uploading.');
    expect(mockedUploadPhotos).not.toHaveBeenCalled();
  });

  it('does not advertise svg uploads as supported', () => {
    render(<UploadPage />);

    expect(screen.getByText(/Supported extensions:/)).not.toHaveTextContent('svg');
    expect(screen.getByLabelText(/Choose image files/i)).not.toHaveAttribute(
      'accept',
      expect.stringContaining('.svg'),
    );
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
    expect(screen.getByTestId('technical-log')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: /Uploading/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cancel upload/i })).toBeInTheDocument();
    expect(screen.getByTestId('upload-dropzone')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('upload-progress-label')).toHaveTextContent(/Uploading 0 of 1/i);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1');

    resolveUpload?.({ files: [], output: ['streamed r2 line'] });
    expect(await screen.findByText('Live clear!')).toBeInTheDocument();
  });

  it('updates progress as file events arrive during upload', async () => {
    const user = userEvent.setup();
    const first = new File(['a'], 'one.webp', { type: 'image/webp' });
    const second = new File(['b'], 'two.webp', { type: 'image/webp' });
    let resolveUpload: ((value: {
      files: Array<{ name: string; path: string; size: number }>;
      output: string[];
    }) => void) | undefined;
    let onFile: ((file: { name: string; path: string; size: number }, indexHint?: number) => void) | undefined;

    mockedUploadPhotos.mockImplementation((_files, options) => {
      if (options !== undefined && !('aborted' in options)) {
        onFile = options.onFile;
      }

      return new Promise((resolve) => {
        resolveUpload = resolve;
      });
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), [first, second]);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(await screen.findByTestId('upload-progress-label')).toHaveTextContent(/Uploading 0 of 2/i);

    act(() => {
      onFile?.({ name: 'one.webp', path: 'uploads/one.webp', size: first.size }, 0);
    });
    expect(await screen.findByTestId('upload-progress-label')).toHaveTextContent(/Uploading 1 of 2/i);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

    act(() => {
      onFile?.({ name: 'two.webp', path: 'uploads/two.webp', size: second.size }, 1);
    });
    expect(await screen.findByTestId('upload-progress-label')).toHaveTextContent(/Uploading 2 of 2/i);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');

    act(() => {
      resolveUpload?.({
        files: [
          { name: 'one.webp', path: 'uploads/one.webp', size: first.size },
          { name: 'two.webp', path: 'uploads/two.webp', size: second.size },
        ],
        output: [],
      });
    });

    expect(await screen.findByText('Live clear!')).toBeInTheDocument();
  });

  it('remembers the upload token on this device when checked', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockResolvedValue({
      files: [{ name: 'source.webp', path: 'uploads/source.webp', size: file.size }],
      output: [],
    });

    const { unmount } = render(<UploadPage />);

    const tokenInput = screen.getByLabelText(/Upload token/i);
    await user.type(tokenInput, 'device-token');
    await user.click(screen.getByLabelText(/Remember token on this device/i));
    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(await screen.findByText('Live clear!')).toBeInTheDocument();
    expect(localStorage.getItem('gallery.uploadToken')).toBe('device-token');

    unmount();
    render(<UploadPage />);

    expect(screen.getByLabelText(/Upload token/i)).toHaveValue('device-token');
    expect(screen.getByLabelText(/Remember token on this device/i)).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^Clear$/i }));
    expect(screen.getByLabelText(/Upload token/i)).toHaveValue('');
    expect(screen.getByLabelText(/Remember token on this device/i)).not.toBeChecked();
    expect(localStorage.getItem('gallery.uploadToken')).toBeNull();
  });

  it('shows backend errors and keeps streamed output inspectable', async () => {
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
    expect(screen.getByTestId('technical-log')).toHaveAttribute('open');
  });

  it('cancels an active upload without showing a failure alert', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockImplementation(
      (_files, options) =>
        new Promise((_resolve, reject) => {
          if (options !== undefined && !('aborted' in options)) {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Canceled', 'AbortError')),
            );
          }
        }),
    );

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));
    await user.click(await screen.findByRole('button', { name: /Cancel upload/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Upload canceled');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables adding files while an upload is in progress', async () => {
    const user = userEvent.setup();
    const firstFile = new File(['image-body'], 'source.webp', { type: 'image/webp' });
    let signal: AbortSignal | undefined;

    mockedUploadPhotos.mockImplementation((_files, options) => {
      if (options !== undefined && !('aborted' in options)) {
        signal = options.signal;
      }

      return new Promise(() => undefined);
    });

    render(<UploadPage />);

    const fileInput = screen.getByLabelText(/Choose image files/i);
    await user.upload(fileInput, firstFile);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));
    await waitFor(() => expect(signal).toBeDefined());

    expect(fileInput).toBeDisabled();
    expect(screen.getByTestId('upload-dropzone')).toHaveAttribute('aria-disabled', 'true');
    expect(signal?.aborted).toBe(false);
  });

  it('caps visible script output', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockImplementation(async (_files, options) => {
      if (options !== undefined && !('aborted' in options)) {
        for (let index = 0; index < 201; index += 1) {
          options.onOutput?.(`line-${index}`, 'stdout');
        }
      }

      return { files: [], output: [] };
    });

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    expect(await screen.findByText(/Showing the last 200 lines/)).toBeInTheDocument();
    expect(screen.queryByText('line-0')).not.toBeInTheDocument();
    expect(screen.getByText(/line-200/)).toBeInTheDocument();
  });

  it('uses calm product copy without internal implementation paths', () => {
    render(<UploadPage />);

    expect(screen.getByRole('heading', { name: /Send new works to the stage/i })).toBeInTheDocument();
    expect(screen.getByTestId('upload-dropzone')).toHaveTextContent(/Drop images here or browse/i);
    expect(screen.queryByText(/photos-index\.json/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/object storage/i);
  });
  it('maps rejected upload tokens to calm copy without leaking paths', async () => {
    const user = userEvent.setup();
    const file = new File(['image-body'], 'source.webp', { type: 'image/webp' });

    mockedUploadPhotos.mockRejectedValue(
      new Error('That upload token was not accepted. Check the token and try again.'),
    );

    render(<UploadPage />);

    await user.upload(screen.getByLabelText(/Choose image files/i), file);
    await user.click(screen.getByRole('button', { name: /Upload selected files/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That upload token was not accepted. Check the token and try again.',
    );
    expect(alert).not.toHaveTextContent(/photos-index\.json|\/var\/|Traceback/i);
  });

});
