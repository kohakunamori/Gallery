import { t } from '../../i18n';
import { type ChangeEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react';

export type UploadDropzoneProps = {
  acceptAttribute: string;
  acceptedExtensions: readonly string[];
  describedById: string;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  isUploading: boolean;
  onBrowseClick: () => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDropzoneKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function UploadDropzone({
  acceptAttribute,
  acceptedExtensions,
  describedById,
  fileInputId,
  fileInputRef,
  isDragging,
  isUploading,
  onBrowseClick,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onDropzoneKeyDown,
  onFileChange,
}: UploadDropzoneProps) {
  const dropzoneClassName = [
    'relative block rounded-[28px] border border-dashed p-6 transition-colors motion-reduce:transition-none',
    isDragging
      ? 'border-primary bg-primary/5'
      : 'border-outline-variant bg-surface-container-low hover:bg-surface-container',
    isUploading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
  ].join(' ');

  return (
    <div
      className={dropzoneClassName}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onBrowseClick}
      onKeyDown={onDropzoneKeyDown}
      role="button"
      tabIndex={isUploading ? -1 : 0}
      aria-disabled={isUploading}
      aria-describedby={describedById}
      data-testid="upload-dropzone"
    >
      <span className="block text-base font-semibold text-on-surface">{t('upload.dropzone')}</span>
      <span id={describedById} className="mt-2 block text-sm text-on-surface-variant">
        Supported extensions: {acceptedExtensions.join(', ')}
      </span>
      <span className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">
        {t('upload.chooseFiles')}
      </span>
      <input
        ref={fileInputRef}
        id={fileInputId}
        className="sr-only"
        type="file"
        name="files"
        accept={acceptAttribute}
        multiple
        disabled={isUploading}
        onChange={onFileChange}
        onClick={(event) => event.stopPropagation()}
        aria-label={t('upload.chooseFiles')}
      />
    </div>
  );
}
