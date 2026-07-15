type BackToTopButtonProps = {
  visible: boolean;
  onActivate: () => void;
};

export function BackToTopButton({ visible, onActivate }: BackToTopButtonProps) {
  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={onActivate}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      data-testid="back-to-top"
      className={`gallery-chrome-surface-scrolled fixed bottom-6 right-6 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface/92 text-on-surface backdrop-blur-xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none ${
        visible
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0'
      }`}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-[1.7]">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 15.5V4.5m0 0L5.5 9M10 4.5 14.5 9" />
      </svg>
    </button>
  );
}
