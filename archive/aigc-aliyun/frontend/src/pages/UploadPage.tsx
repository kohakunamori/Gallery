import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { uploadPhotos, type UploadPhotosResponse } from '../services/uploadPhotos';

const ACCEPTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'heic'];
const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const MAX_VISIBLE_OUTPUT_LINES = 200;

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(filename: string): string {
  const extension = filename.split('.').pop();

  return extension === undefined || extension === filename ? 'unknown' : extension.toLowerCase();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function trimOutputLines(lines: string[]): string[] {
  return lines.slice(-MAX_VISIBLE_OUTPUT_LINES);
}

function UploadScriptOutput({ hiddenLineCount, lines }: { hiddenLineCount: number; lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="mt-5" aria-live="polite">
      <h3 className="text-sm font-semibold text-on-surface">Upload script output</h3>
      {hiddenLineCount > 0 && (
        <p className="mt-2 text-xs text-on-surface-variant">Showing the last {MAX_VISIBLE_OUTPUT_LINES} lines; {hiddenLineCount} earlier lines hidden.</p>
      )}
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-on-surface p-4 text-xs leading-6 text-surface-container-lowest">
        {lines.join('\n')}
      </pre>
    </div>
  );
}

export function UploadPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error' | 'canceled'>('idle');
  const [result, setResult] = useState<UploadPhotosResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scriptOutput, setScriptOutput] = useState<string[]>([]);
  const [hiddenOutputLineCount, setHiddenOutputLineCount] = useState(0);
  const [uploadToken, setUploadToken] = useState('');
  const activeUploadControllerRef = useRef<AbortController | null>(null);
  const totalSize = useMemo(
    () => selectedFiles.reduce((sum, file) => sum + file.size, 0),
    [selectedFiles],
  );

  useEffect(() => () => {
    activeUploadControllerRef.current?.abort();
  }, []);

  const appendScriptOutput = (line: string) => {
    setScriptOutput((currentOutput) => {
      const nextOutput = [...currentOutput, line];
      const hiddenLineCount = Math.max(0, nextOutput.length - MAX_VISIBLE_OUTPUT_LINES);
      setHiddenOutputLineCount((currentHiddenLineCount) => currentHiddenLineCount + hiddenLineCount);

      return trimOutputLines(nextOutput);
    });
  };

  const cancelActiveUpload = () => {
    activeUploadControllerRef.current?.abort();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    cancelActiveUpload();
    const nextFiles = Array.from(event.target.files ?? []);

    setSelectedFiles(nextFiles);
    setStatus('idle');
    setResult(null);
    setErrorMessage(null);
    setScriptOutput([]);
    setHiddenOutputLineCount(0);

    if (nextFiles.length > 0) {
      event.currentTarget.value = '';
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (selectedFiles.length === 0) {
      setStatus('error');
      setErrorMessage('Choose one or more image files before uploading.');
      setResult(null);
      setScriptOutput([]);
      setHiddenOutputLineCount(0);
      return;
    }

    cancelActiveUpload();
    const controller = new AbortController();
    activeUploadControllerRef.current = controller;
    setStatus('uploading');
    setErrorMessage(null);
    setResult(null);
    setScriptOutput([]);
    setHiddenOutputLineCount(0);

    try {
      const nextResult = await uploadPhotos(selectedFiles, {
        signal: controller.signal,
        uploadToken,
        onOutput: (line) => appendScriptOutput(line),
      });

      setResult({
        ...nextResult,
        output: trimOutputLines(nextResult.output),
      });
      setStatus('success');
    } catch (error: unknown) {
      if (isAbortError(error)) {
        setStatus('canceled');
        setErrorMessage(null);
        setResult(null);
        return;
      }

      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      if (activeUploadControllerRef.current === controller) {
        activeUploadControllerRef.current = null;
      }
    }
  };

  return (
    <main className="min-h-screen bg-surface px-4 py-8 text-on-surface md:px-8 md:py-12">
      <section className="mx-auto max-w-4xl">
        <a className="text-sm font-medium text-primary hover:underline" href="/">
          Back to gallery
        </a>

        <div className="mt-8 rounded-[32px] bg-surface-container-lowest p-6 shadow-ambient md:p-10">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Gallery upload</p>
            <h1 className="mt-3 font-headline text-4xl font-bold tracking-[-0.04em] text-on-surface md:text-5xl">
              Upload new gallery images
            </h1>
            <p className="mt-4 text-base leading-7 text-on-surface-variant">
              Select one image or a batch of images. The server saves them into the gallery source folder and publishes
              them to the configured remote media targets.
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <label className="block rounded-[28px] border border-dashed border-outline-variant bg-surface-container-low p-6 transition hover:bg-surface-container">
              <span className="block text-base font-semibold text-on-surface">Choose image files</span>
              <span className="mt-2 block text-sm text-on-surface-variant">
                Supported extensions: {ACCEPTED_IMAGE_EXTENSIONS.join(', ')}
              </span>
              <input
                className="mt-5 block w-full rounded-2xl bg-surface-container-lowest text-sm text-on-surface file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-5 file:py-3 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-container"
                type="file"
                name="files"
                accept={ACCEPT_ATTRIBUTE}
                multiple
                onChange={handleFileChange}
              />
            </label>

            <label className="block rounded-[24px] bg-surface-container-low p-5">
              <span className="block text-sm font-semibold text-on-surface">Upload token</span>
              <span className="mt-1 block text-xs text-on-surface-variant">Required only when the server is configured with one.</span>
              <input
                className="mt-3 block w-full rounded-2xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface"
                type="password"
                autoComplete="off"
                value={uploadToken}
                onChange={(event) => setUploadToken(event.target.value)}
              />
            </label>

            {selectedFiles.length > 0 && (
              <section className="rounded-[24px] bg-surface-container-low p-5" aria-label="Selected files">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-headline text-xl font-semibold tracking-[-0.02em]">Selected files</h2>
                  <p className="text-sm text-on-surface-variant">
                    {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
                  </p>
                </div>
                <ul className="mt-4 divide-y divide-outline-variant/60">
                  {selectedFiles.map((file, index) => (
                    <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" key={`${file.name}-${file.size}-${index}`}>
                      <div>
                        <p className="font-medium text-on-surface">{file.name}</p>
                        <p className="text-on-surface-variant">.{getExtension(file.name)}</p>
                      </div>
                      <p className="text-on-surface-variant">{formatBytes(file.size)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white transition hover:bg-primary-container disabled:cursor-not-allowed disabled:bg-outline disabled:text-surface-container-lowest"
                type="submit"
                disabled={status === 'uploading'}
              >
                {status === 'uploading' ? 'Uploading…' : 'Upload selected files'}
              </button>
              {status === 'uploading' && (
                <button
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-outline-variant px-6 text-sm font-semibold text-on-surface transition hover:bg-surface-container"
                  type="button"
                  onClick={cancelActiveUpload}
                >
                  Cancel upload
                </button>
              )}
            </div>
          </form>
        </div>

        {status === 'canceled' && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" role="status">
            <h2 className="font-semibold">Upload canceled</h2>
            <p className="mt-2 text-sm text-on-surface-variant">The active upload was canceled before completion.</p>
          </section>
        )}

        {status === 'error' && errorMessage !== null && (
          <section className="mt-6 rounded-[24px] border border-red-200 bg-red-50 p-5 text-red-800" role="alert">
            <h2 className="font-semibold">Upload failed</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{errorMessage}</p>
          </section>
        )}

        {(status === 'uploading' || status === 'error') && scriptOutput.length > 0 && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient">
            <UploadScriptOutput hiddenLineCount={hiddenOutputLineCount} lines={scriptOutput} />
          </section>
        )}

        {status === 'success' && result !== null && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" aria-live="polite">
            <h2 className="font-headline text-2xl font-semibold tracking-[-0.03em]">Upload complete</h2>
            <ul className="mt-4 divide-y divide-outline-variant/60">
              {result.files.map((file) => (
                <li className="py-3 text-sm" key={file.path}>
                  <p className="font-medium text-on-surface">{file.name}</p>
                  <p className="mt-1 text-on-surface-variant">
                    Saved as {file.path} · {formatBytes(file.size)}
                  </p>
                </li>
              ))}
            </ul>

            <UploadScriptOutput hiddenLineCount={hiddenOutputLineCount} lines={result.output.length > 0 ? result.output : scriptOutput} />
          </section>
        )}
      </section>
    </main>
  );
}
