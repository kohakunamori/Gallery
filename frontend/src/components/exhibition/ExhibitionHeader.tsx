export function ExhibitionHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 py-6 md:px-8" role="banner">
      <div className="rounded-full bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <p className="font-headline text-sm font-medium uppercase tracking-[0.28em] text-on-surface">The Curator</p>
      </div>
    </header>
  );
}
