import { memo } from 'react';

type ExhibitionStatusPanelProps = {
  variant: 'error' | 'empty';
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  primaryHref?: {
    label: string;
    href: string;
  };
  secondaryHref?: {
    label: string;
    href: string;
  };
};

const primaryButtonClassName =
  'inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
const secondaryLinkClassName =
  'inline-flex min-h-11 items-center rounded-full border border-outline-variant/60 bg-surface px-5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export const ExhibitionStatusPanel = memo(function ExhibitionStatusPanel({
  variant,
  title,
  description,
  primaryAction,
  primaryHref,
  secondaryHref,
}: ExhibitionStatusPanelProps) {
  const isError = variant === 'error';
  const hasActions = Boolean(primaryAction || primaryHref || secondaryHref);

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className="mx-auto flex w-full max-w-md flex-col items-start gap-4 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest px-6 py-8 shadow-ambient"
      data-testid={`exhibition-status-${variant}`}
    >
      <div className="space-y-2">
        <p className="font-headline text-sm font-semibold tracking-[0.04em] text-on-surface">{title}</p>
        <p className="text-sm leading-6 text-on-surface-variant">{description}</p>
      </div>

      {hasActions && (
        <div className="flex flex-wrap items-center gap-3">
          {primaryAction && (
            <button type="button" onClick={primaryAction.onClick} className={primaryButtonClassName}>
              {primaryAction.label}
            </button>
          )}
          {primaryHref && (
            <a href={primaryHref.href} className={primaryButtonClassName}>
              {primaryHref.label}
            </a>
          )}
          {secondaryHref && (
            <a href={secondaryHref.href} className={secondaryLinkClassName}>
              {secondaryHref.label}
            </a>
          )}
        </div>
      )}
    </div>
  );
});
