import { t } from '../../i18n';
import { useEffect, useState } from 'react';

export const MAX_VISIBLE_OUTPUT_LINES = 200;

export type UploadTechnicalLogProps = {
  hiddenLineCount: number;
  lines: string[];
  defaultOpen: boolean;
};

export function UploadTechnicalLog({ hiddenLineCount, lines, defaultOpen }: UploadTechnicalLogProps) {
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
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">{t('upload.technicalLog')}</summary>
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
