import { memo } from 'react';

type ExhibitionHeroProps = {
  status: 'loading' | 'error' | 'empty' | 'ready';
  photoCount?: number;
  monthCount?: number;
};

function formatWorksLabel(photoCount: number) {
  return photoCount === 1 ? '1 work' : `${photoCount} works`;
}

function formatMonthsLabel(monthCount: number) {
  return monthCount === 1 ? '1 month' : `${monthCount} months`;
}

export const ExhibitionHero = memo(function ExhibitionHero({
  status,
  photoCount = 0,
  monthCount,
}: ExhibitionHeroProps) {
  const metaLine =
    status === 'ready'
      ? monthCount && monthCount > 0
        ? `${formatWorksLabel(photoCount)} · ${formatMonthsLabel(monthCount)}`
        : formatWorksLabel(photoCount)
      : status === 'loading'
        ? 'Setting the stage…'
        : null;

  return (
    <section className="mx-auto max-w-6xl px-4 pt-24 pb-6 md:px-8 md:pt-28 md:pb-8" data-testid="exhibition-hero">
      {metaLine ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-outline" data-testid="exhibition-hero-meta">
          {metaLine}
        </p>
      ) : (
        <div className="h-4" aria-hidden="true" />
      )}
    </section>
  );
});
