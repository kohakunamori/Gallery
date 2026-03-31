type ExhibitionHeroProps = {
  totalCount: number;
};

export function ExhibitionHero({ totalCount }: ExhibitionHeroProps) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-28 pb-10 md:px-8 md:pt-36 md:pb-14">
      <h1 className="mt-4 font-headline text-5xl font-black tracking-tight text-on-surface md:text-7xl">
        A curated wall of AIGC imagery.
      </h1>
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.22em] text-outline">
        {totalCount} works in view
      </p>
    </section>
  );
}
