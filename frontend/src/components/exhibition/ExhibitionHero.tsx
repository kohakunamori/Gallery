type ExhibitionHeroProps = {
  totalCount: number;
};

export function ExhibitionHero({ totalCount }: ExhibitionHeroProps) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-28 pb-10 md:px-8 md:pt-36 md:pb-14">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Digital exhibition</p>
      <h1 className="mt-4 font-headline text-5xl font-black tracking-tight text-on-surface md:text-7xl">
        A living exhibition of recent work.
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-on-surface-variant md:text-base">
        A single flowing wall of images, arranged like a curated show instead of a file browser.
      </p>
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.22em] text-outline">
        {totalCount} works in view
      </p>
    </section>
  );
}
