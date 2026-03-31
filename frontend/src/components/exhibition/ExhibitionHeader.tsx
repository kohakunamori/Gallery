type ExhibitionHeaderProps = {
  isAtTop: boolean;
};

export function ExhibitionHeader({ isAtTop }: ExhibitionHeaderProps) {
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 flex justify-center px-4 py-6 transition-opacity duration-300 md:px-8 ${
        isAtTop ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      role="banner"
    >
      <div className="rounded-full bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <p className="font-headline text-sm font-medium uppercase tracking-[0.28em] text-on-surface">Gallery</p>
      </div>
    </header>
  );
}
