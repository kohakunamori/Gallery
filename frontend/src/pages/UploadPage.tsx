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
import { UploadDropzone } from '../components/upload/UploadDropzone';
import { UploadPreviewGrid } from '../components/upload/UploadPreviewGrid';
import {
  MAX_VISIBLE_OUTPUT_LINES,
  UploadTechnicalLog,
} from '../components/upload/UploadTechnicalLog';
import { resetPhotoRequestCache } from '../services/photos';
import { uploadPhotos, type UploadPhotosResponse } from '../services/uploadPhotos';
import { t } from '../i18n';
import { toUserFacingError } from '../utils/userFacingError';

const ACCEPTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'heic'] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const ACCEPTED_EXTENSION_SET = new Set<string>(ACCEPTED_IMAGE_EXTENSIONS);
const UPLOAD_TOKEN_STORAGE_KEY = 'gallery.uploadToken';

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

function readStoredUploadToken(): string {
  try {
    return localStorage.getItem(UPLOAD_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredUploadToken(token: string): void {
  try {
    localStorage.setItem(UPLOAD_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function clearStoredUploadToken(): void {
  try {
    localStorage.removeItem(UPLOAD_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function UploadPage() {
  const fileInputId = useId();
  const rememberTokenId = useId();
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
  const [uploadToken, setUploadToken] = useState(() => readStoredUploadToken());
  const [rememberToken, setRememberToken] = useState(() => readStoredUploadToken() !== '');
  const [completedUploadCount, setCompletedUploadCount] = useState(0);
  const [uploadTotalCount, setUploadTotalCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, true>>({});

  stagedRef.current = staged;

  const totalSize = useMemo(() => staged.reduce((sum, item) => sum + item.file.size, 0), [staged]);
  const isUploading = status === 'uploading';
  const progressValue = Math.min(completedUploadCount, uploadTotalCount);
  const progressMax = Math.max(uploadTotalCount, 1);
  const progressPercent = uploadTotalCount === 0 ? 0 : Math.round((progressValue / uploadTotalCount) * 100);

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
    setCompletedUploadCount(0);
    setUploadTotalCount(0);
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

  const handleClearRememberedToken = () => {
    clearStoredUploadToken();
    setUploadToken('');
    setRememberToken(false);
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
      setCompletedUploadCount(0);
      setUploadTotalCount(0);
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
    setCompletedUploadCount(0);
    setUploadTotalCount(staged.length);
    setDropMessage(null);

    try {
      const files = staged.map((item) => item.file);
      const nextResult = await uploadPhotos(files, {
        signal: controller.signal,
        uploadToken,
        onOutput: (line) => appendScriptOutput(line),
        onFile: (_file, indexHint) => {
          if (typeof indexHint === 'number') {
            setCompletedUploadCount(indexHint + 1);
          } else {
            setCompletedUploadCount((current) => current + 1);
          }
        },
      });

      setResult({
        ...nextResult,
        output: trimOutputLines(nextResult.output),
      });
      setCompletedUploadCount(nextResult.files.length > 0 ? nextResult.files.length : staged.length);
      setStatus('success');
      resetPhotoRequestCache();

      if (rememberToken) {
        const tokenToStore = uploadToken.trim();

        if (tokenToStore !== '') {
          writeStoredUploadToken(tokenToStore);
        } else {
          clearStoredUploadToken();
        }
      } else {
        clearStoredUploadToken();
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        setStatus('canceled');
        setErrorMessage(null);
        setResult(null);
        return;
      }

      setStatus('error');
      setErrorMessage(toUserFacingError(error, 'upload'));
    } finally {
      if (activeUploadControllerRef.current === controller) {
        activeUploadControllerRef.current = null;
      }
    }
  };

  const successOutput = result !== null && result.output.length > 0 ? result.output : scriptOutput;

  const previewItems = staged.map((item) => ({
    key: item.key,
    name: item.file.name,
    sizeLabel: formatBytes(item.file.size),
    previewUrl: item.previewUrl,
    isBroken: brokenPreviews[item.key] === true,
  }));

  return (
    <main className="min-h-screen bg-surface px-4 py-8 text-on-surface md:px-8 md:py-12">
      <section className="mx-auto max-w-4xl">
        <a className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" href="/">
          {t('upload.backToGallery')}
        </a>

        <div className="mt-8 rounded-[32px] bg-surface-container-lowest p-6 shadow-ambient md:p-10">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">{t('upload.eyebrow')}</p>
            <h1 className="mt-3 font-headline text-4xl font-bold tracking-[-0.04em] text-on-surface md:text-5xl">
              {t('upload.heading')}
            </h1>
            <p className="mt-4 text-base leading-7 text-on-surface-variant">
              {t('upload.intro')}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <UploadDropzone
              acceptAttribute={ACCEPT_ATTRIBUTE}
              acceptedExtensions={ACCEPTED_IMAGE_EXTENSIONS}
              describedById={`${fileInputId}-help`}
              fileInputId={fileInputId}
              fileInputRef={fileInputRef}
              isDragging={isDragging}
              isUploading={isUploading}
              onBrowseClick={handleBrowseClick}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDropzoneKeyDown={handleDropzoneKeyDown}
              onFileChange={handleFileChange}
            />

            {dropMessage !== null && (
              <p className="text-sm text-on-surface-variant" role="status">
                {dropMessage}
              </p>
            )}

            <div className="rounded-[24px] bg-surface-container-low p-5">
              <label className="block">
                <span className="block text-sm font-semibold text-on-surface">{t('upload.token')}</span>
                <span className="mt-1 block text-xs text-on-surface-variant">
                  {t('upload.tokenHint')}
                </span>
                <input
                  className="mt-3 block w-full rounded-2xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  type="password"
                  autoComplete="off"
                  value={uploadToken}
                  onChange={(event) => setUploadToken(event.target.value)}
                  disabled={isUploading}
                />
              </label>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="inline-flex items-center gap-2 text-sm text-on-surface" htmlFor={rememberTokenId}>
                  <input
                    id={rememberTokenId}
                    className="size-4 rounded border-outline-variant text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    type="checkbox"
                    checked={rememberToken}
                    onChange={(event) => setRememberToken(event.target.checked)}
                    disabled={isUploading}
                  />
                  <span>{t('upload.rememberToken')}</span>
                </label>

                {(rememberToken || uploadToken !== '') && (
                  <button
                    type="button"
                    className="text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleClearRememberedToken}
                    disabled={isUploading}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <UploadPreviewGrid
              items={previewItems}
              totalSizeLabel={formatBytes(totalSize)}
              isUploading={isUploading}
              onClearAll={clearAllStaged}
              onRemoveItem={removeStagedItem}
              onPreviewError={(key) => {
                setBrokenPreviews((current) => ({ ...current, [key]: true }));
              }}
            />

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white transition hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:bg-outline disabled:text-surface-container-lowest"
                type="submit"
                disabled={isUploading}
              >
                {isUploading ? t('upload.uploading') : t('upload.submit')}
              </button>
              {isUploading && (
                <button
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-outline-variant px-6 text-sm font-semibold text-on-surface transition hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  type="button"
                  onClick={cancelActiveUpload}
                >
                  {t('upload.cancel')}
                </button>
              )}
            </div>
          </form>
        </div>

        {status === 'canceled' && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" role="status">
            <h2 className="font-semibold">{t('upload.canceled')}</h2>
            <p className="mt-2 text-sm text-on-surface-variant">{t('upload.canceledBody')}</p>
          </section>
        )}

        {status === 'error' && errorMessage !== null && (
          <section className="mt-6 rounded-[24px] border border-red-200 bg-red-50 p-5 text-red-800" role="alert">
            <h2 className="font-semibold">{t('upload.failed')}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{errorMessage}</p>
            {scriptOutput.length > 0 && (
              <UploadTechnicalLog hiddenLineCount={hiddenOutputLineCount} lines={scriptOutput} defaultOpen />
            )}
          </section>
        )}

        {status === 'uploading' && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" aria-live="polite">
            <p className="text-sm font-medium text-on-surface" data-testid="upload-progress-label">
              {uploadTotalCount > 0
                ? `Uploading ${Math.min(completedUploadCount, uploadTotalCount)} of ${uploadTotalCount}…`
                : 'Uploading…'}
            </p>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progressMax}
              aria-valuenow={progressValue}
              aria-label={
                uploadTotalCount > 0
                  ? `Uploading ${Math.min(completedUploadCount, uploadTotalCount)} of ${uploadTotalCount}`
                  : 'Uploading'
              }
              data-testid="upload-progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {scriptOutput.length > 0 && (
              <UploadTechnicalLog hiddenLineCount={hiddenOutputLineCount} lines={scriptOutput} defaultOpen />
            )}
          </section>
        )}

        {status === 'success' && result !== null && (
          <section className="mt-6 rounded-[24px] bg-surface-container-lowest p-5 shadow-ambient" aria-live="polite">
            <h2 className="font-headline text-2xl font-semibold tracking-[-0.03em]">{t('upload.complete')}</h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              Published {result.files.length} image{result.files.length === 1 ? '' : 's'}.
            </p>
            <p className="mt-2 text-sm text-on-surface-variant" data-testid="upload-success-hint">
              New photos appear under Newest sort without a hard reload.
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
                {t('upload.viewGallery')}
              </a>
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-outline-variant px-6 text-sm font-semibold text-on-surface transition hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={resetForMoreUploads}
              >
                {t('upload.uploadMore')}
              </button>
            </div>

            {successOutput.length > 0 && (
              <UploadTechnicalLog
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
