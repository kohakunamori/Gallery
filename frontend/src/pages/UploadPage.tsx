import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resetPhotoRequestCache } from '../services/photos';
import { uploadPhotos, type UploadPhotosResponse } from '../services/uploadPhotos';

const ACCEPTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'heic'] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const ACCEPTED_EXTENSION_SET = new Set<string>(ACCEPTED_IMAGE_EXTENSIONS);
const MAX_VISIBLE_OUTPUT_LINES = 200;

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error' | 'canceled';

type StagedImage = {
  key: string;
  file: File;
  previewUrl: string;
};

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

export function isAcceptedImageFile(file: File): boolean {
  const extension = getExtension(file.name);

  if (ACCEPTED_EXTENSION_SET.has(extension)) {
    return true;
  }

  // Fallback for environments that omit extensions but provide an image MIME type.
  if (file.type.startsWith('image/') && !file.type.includes('svg')) {
    const subtype = file.type.slice('image/'.length).toLowerCase();

    return ACCEPTED_EXTENSION_SET.has(subtype) || subtype === 'jpg';
  }

  return false;
}

export function filterAcceptedImages(files: Iterable<File>): File[] {
  return Array.from(files).filter(isAcceptedImageFile);
}

function createStagedImage(file: File, index = 0): StagedImage {
  return {
    key: `${file.name}-${file.size}-${file.lastModified}-${index}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function createStagedImages(files: File[]): StagedImage[] {
  return files.map((file, index) => createStagedImage(file, index));
}

function revokeStaged(staged: StagedImage | StagedImage[]): void {
  const items = Array.isArray(staged) ? staged : [staged];

  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function trimOutputLines(lines: string[]): string[] {
  return lines.slice(-MAX_VISIBLE_OUTPUT_LINES);
}

function getFileIdentity(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function appendUniqueFiles(current: StagedImage[], incoming: File[]): StagedImage[] {
  const seen = new Set(current.map((item) => getFileIdentity(item.file)));
  const additions: StagedImage[] = [];

  for (const [index, file] of incoming.entries()) {
    const identity = getFileIdentity(file);

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    additions.push(createStagedImage(file, current.length + index));
  }

  return additions.length === 0 ? current : [...current, ...additions];
}

type UploadScriptLogProps = {
  hiddenLineCount: number;
  lines: string[];
  defaultOpen: boolean;
};

function UploadScriptLog({ hiddenLineCount, lines, defaultOpen }: UploadScriptLogProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  if (lines.length === 0) {
    return null;
  }

  return (
    <details
      className="mt-5 rounded-2xl bg-surface-container-low p-4"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      data-testid="technical-log"
    >
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">Technical log</summary>
      {hiddenLineCount > 0 && (
        <p className="mt-2 text-xs text-on-surface-variant">
          Showing the last {MAX_VISIBLE_OUTPUT_LINES} lines; {hiddenLineCount} earlier lines hidden.
        </p>
      )}
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-on-surface p-4 text-xs leading-6 text-surface-container-lowest">
        {lines.join('\n')}
      </pre>
    </details>
  );
}

export function UploadPage() {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadControllerRef = useRef<AbortController | null>(null);
  const dragDepthRef = useRef(0);
  const stagedRef = useRef<StagedImage[]>([]);
  const totalOutputLineCountRef = useRef(0);

  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [result, setResult] = useState<UploadPhotosResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scriptOutput, setScriptOutput] = useState<string[]>([]);
  const [hiddenOutputLineCount, setHiddenOutputLineCount] = useState(0);
  const [uploadToken, setUploadToken] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, true>>({});

  stagedRef.current = staged;

  const totalSize = useMemo(() => staged.reduce((sum, item) => sum + item.file.size, 0), [staged]);
  const isUploading = status === 'uploading';

  useEffect(
    () => () => {
      activeUploadControllerRef.current?.abort();
      revokeStaged(stagedRef.current);
    },
    [],
  );

  const clearTransientState = () => {
    setStatus('idle');
    setResult(null);
    setErrorMessage(null);
    setScriptOutput([]);
    setHiddenOutputLineCount(0);
    totalOutputLineCountRef.current = 0;
    setDropMessage(null);
  };

  const replaceStaged = (files: File[]) => {
    activeUploadControllerRef.current?.abort();
    revokeStaged(stagedRef.current);
    const nextStaged = createStagedImages(files);
    stagedRef.current = nextStaged;
    setStaged(nextStaged);
    setBrokenPreviews({});
    clearTransientState();
  };

  const appendStaged = (files: File[]) => {
    activeUploadControllerRef.current?.abort();
    setStaged((current) => {
      const next = appendUniqueFiles(current, files);
      stagedRef.current = next;
      return next;
    });
    clearTransientState();
  };

  const removeStagedItem = (key: string) => {
    activeUploadControllerRef.current?.abort();
    setStaged((current) => {
      const target = current.find((item) => item.key === key);

      if (target !== undefined) {
        revokeStaged(target);
      }

      const next = current.filter((item) => item.key !== key);
      stagedRef.current = next;
      return next;
    });
    setBrokenPreviews((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
    clearTransientState();
  };

  const clearAllStaged = () => {
    activeUploadControllerRef.current?.abort();
    revokeStaged(stagedRef.current);
    stagedRef.current = [];
    setStaged([]);
    setBrokenPreviews({});
    clearTransientState();
  };

  const resetForMoreUploads = () => {
    clearAllStaged();
  };

  const appendScriptOutput = (line: string) => {
    totalOutputLineCountRef.current += 1;
    const hidden = Math.max(0, totalOutputLineCountRef.current - MAX_VISIBLE_OUTPUT_LINES);
    setHiddenOutputLineCount(hidden);
    setScriptOutput((currentOutput) => trimOutputLines([...currentOutput, line]));
  };

  const cancelActiveUpload = () => {
    activeUploadControllerRef.current?.abort();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isUploading) {
      event.currentTarget.value = '';
      return;
    }

    const selectedCount = event.target.files?.length ?? 0;
    const nextFiles = filterAcceptedImages(event.target.files ?? []);
    replaceStaged(nextFiles);
    // Clearing the input value empties FileList — capture counts before reset.
    event.currentTarget.value = '';

    if (selectedCount > 0 && nextFiles.length === 0) {
      setDropMessage('None of the selected files are supported image types.');
    }
  };

  const handleBrowseClick = () => {
    if (isUploading) {
      return;
    }

    fileInputRef.current?.click();
  };

  const handleDropzoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isUploading) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isUploading) {
      return;
    }

    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isUploading) {
      return;
    }

    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isUploading) {
      return;
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);

    if (isUploading) {
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
    const accepted = filterAcceptedImages(droppedFiles);

    if (accepted.length === 0) {
      setDropMessage(
        droppedFiles.length === 0
          ? 'No files were dropped.'
          : 'None of the dropped files are supported image types.',
      );
      return;
    }

    appendStaged(accepted);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (staged.length === 0) {
      setStatus('error');
      setErrorMessage('Choose one or more image files before uploading.');
      setResult(null);
      setScriptOutput([]);
      setHiddenOutputLineCount(0);
      totalOutputLineCountRef.current = 0;
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
    totalOutputLineCountRef.current = 0;
    setDropMessage(null);

    try {
      const files = staged.map((item) => item.file);
      const nextResult = await uploadPhotos(files, {
        signal: controller.signal,
        uploadToken,
        onOutput: (line) => appendScriptOutput(line),
      });

      setResult({
        ...nextResult,
        output: trimOutputLines(nextResult.output),
      });
      setStatus('success');
      resetPhotoRequestCache();
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

  const successOutput = result !== null && result.output.length > 0 ? result.output : scriptOutput;
  const dropzoneClassName = [
    'relative block rounded-[28px] border border-dashed p-6 transition-colors motion-reduce:transition-none',
    isDragging
      ? 'border-primary bg-primary/5'
      : 'border-outline-variant bg-surface-container-low hover:bg-surface-container',
    isUploading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
  ].join(' ');

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
              Add images to the gallery
            </h1>
            <p className="mt-4 text-base leading-7 text-on-surface-variant">
              Drop images here or browse your device. Selected files are published to the gallery media store and then
              cleared from temporary staging on this server.
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div
              className={dropzoneClassName}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleBrowseClick}
              onKeyDown={handleDropzoneKeyDown}
              role="button"
              tabIndex={isUploading ? -1 : 0}
              aria-disabled={isUploading}
              aria-describedby={`${fileInputId}-help`}
              data-testid="upload-dropzone"
            >
              <span className="block text-base font-semibold text-on-surface">Drop images here or browse</span>
              <span id={`${fileInputId}-help`} className="mt-2 block text-sm text-on-surface-variant">
                Supported extensions: {ACCEPTED_IMAGE_EXTENSIONS.join(', ')}
              </span>
              <span className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">
                Choose image files
              </span>
              <input
                ref={fileInputRef}
                id={fileInputId}
                className="sr-only"
                type="file"
                name="files"
                accept={ACCEPT_ATTRIBUTE}
                multiple
                disabled={isUploading}
                onChange={handleFileChange}
                onClick={(event) => event.stopPropagation()}
                aria-label="Choose image files"
              />
            </div>

            {dropMessage !== null && (
              <p className="text-sm text-on-surface-variant" role="status">
                {dropMessage}
              </p>
            )}

            <label className="block rounded-[24px] bg-surface-container-low p-5">
              <span className="block text-sm font-semibold text-on-surface">Upload token</span>
              <span className="mt-1 block text-xs text-on-surface-variant">
                Required only when the server is configured with one.
              </span>
              <input
                className="mt-3 block w-full rounded-2xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface"
                type="password"
                autoComplete="off"
                value={uploadToken}
                onChange={(event) => setUploadToken(event.target.value)}
              />
            </label>

            {staged.length > 0 && (
              <section className="rounded-[24px] bg-surface-container-low p-5" aria-label="Selected files">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-headline text-xl font-semibold tracking-[-0.02em]">Selected files</h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-on-surface-variant">
                      {staged.length} file{staged.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
                    </p>
                    {staged.length >= 2 && (
                      <button
                        type="button"
                        className="text-sm font-semibold text-primary hover:underline"
                        onClick={clearAllStaged}
                        disabled={isUploading}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>

                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="upload-preview-grid">
                  {staged.map((item) => {
                    const isBroken = brokenPreviews[item.key] === true;

                    return (
                      <li
                        className="overflow-hidden rounded-2xl border border-outline-variant/50 bg-surface-container-lowest"
                        key={item.key}
                      >
                        <div className="relative aspect-square bg-surface-container">
                          {isBroken ? (
                            <div className="flex h-full items-center justify-center p-3 text-center text-xs text-on-surface-variant">
                              Preview unavailable
                            </div>
                          ) : (
                            <img
                              src={item.previewUrl}
                              alt=""
                              className="h-full w-full object-cover"
                              onError={() => {
                                setBrokenPreviews((current) => ({ ...current, [item.key]: true }));
                              }}
                            />
                          )}
                        </div>
                        <div className="space-y-2 p-3">
                          <p className="truncate text-sm font-medium text-on-surface" title={item.file.name}>
                            {item.file.name}
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-on-surface-variant">{formatBytes(item.file.size)}</p>
                            <button
                              type="button"
                              className="text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => removeStagedItem(item.key)}
                              disabled={isUploading}
                              aria-label={`Remove ${item.file.name}`}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white transition hover:bg-primary-container disabled:cursor-not-allowed disabled:bg-outline disabled:text-surface-container-lowest"
                type="submit"
                disabled={isUploading}
              >
                {isUploading ? 'Uploading…' : 'Upload selected files'}
              </button>
              {isUploading && (
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
            {scriptOutput.length > 0 && (
              <UploadScriptLog hiddenLineCount={hiddenOutputLineCount} lines={scriptOutput} defaultOpen />
            )}
          </section>
        )}

        {status === 'uploading' && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" aria-live="polite">
            <p className="text-sm font-medium text-on-surface">Uploading…</p>
            {scriptOutput.length > 0 && (
              <UploadScriptLog hiddenLineCount={hiddenOutputLineCount} lines={scriptOutput} defaultOpen />
            )}
          </section>
        )}

        {status === 'success' && result !== null && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" aria-live="polite">
            <h2 className="font-headline text-2xl font-semibold tracking-[-0.03em]">Upload complete</h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              Published {result.files.length} image{result.files.length === 1 ? '' : 's'}.
            </p>

            {result.files.length > 0 && (
              <ul className="mt-4 divide-y divide-outline-variant/60">
                {result.files.map((file) => (
                  <li className="py-3 text-sm" key={`${file.name}-${file.path}-${file.size}`}>
                    <p className="font-medium text-on-surface">{file.name}</p>
                    <p className="mt-1 text-on-surface-variant">{formatBytes(file.size)}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="/"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white transition hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                View gallery
              </a>
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-outline-variant px-6 text-sm font-semibold text-on-surface transition hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={resetForMoreUploads}
              >
                Upload more
              </button>
            </div>

            {successOutput.length > 0 && (
              <UploadScriptLog
                hiddenLineCount={hiddenOutputLineCount}
                lines={successOutput}
                defaultOpen={false}
              />
            )}
          </section>
        )}
      </section>
    </main>
  );
}
