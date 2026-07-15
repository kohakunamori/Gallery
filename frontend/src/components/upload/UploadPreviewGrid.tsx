import { t } from '../../i18n';
export type UploadPreviewItem = {
  key: string;
  name: string;
  sizeLabel: string;
  previewUrl: string;
  isBroken: boolean;
};

export type UploadPreviewGridProps = {
  items: UploadPreviewItem[];
  totalSizeLabel: string;
  isUploading: boolean;
  onClearAll: () => void;
  onRemoveItem: (key: string) => void;
  onPreviewError: (key: string) => void;
};

export function UploadPreviewGrid({
  items,
  totalSizeLabel,
  isUploading,
  onClearAll,
  onRemoveItem,
  onPreviewError,
}: UploadPreviewGridProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-[24px] bg-surface-container-low p-5" aria-label={t('upload.selectedFiles')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-headline text-xl font-semibold tracking-[-0.02em]">{t('upload.selectedFiles')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-on-surface-variant">
            {items.length} file{items.length === 1 ? '' : 's'} · {totalSizeLabel}
          </p>
          {items.length >= 2 && (
            <button
              type="button"
              className="text-sm font-semibold text-primary hover:underline"
              onClick={onClearAll}
              disabled={isUploading}
            >
              {t('upload.clearAll')}
            </button>
          )}
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="upload-preview-grid">
        {items.map((item) => (
          <li
            className="overflow-hidden rounded-2xl border border-outline-variant/50 bg-surface-container-lowest"
            key={item.key}
          >
            <div className="relative aspect-square bg-surface-container">
              {item.isBroken ? (
                <div className="flex h-full items-center justify-center p-3 text-center text-xs text-on-surface-variant">
                  Preview unavailable
                </div>
              ) : (
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => {
                    onPreviewError(item.key);
                  }}
                />
              )}
            </div>
            <div className="space-y-2 p-3">
              <p className="truncate text-sm font-medium text-on-surface" title={item.name}>
                {item.name}
              </p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-on-surface-variant">{item.sizeLabel}</p>
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => onRemoveItem(item.key)}
                  disabled={isUploading}
                  aria-label={`Remove ${item.name}`}
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
