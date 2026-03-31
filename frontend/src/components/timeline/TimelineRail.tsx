type TimelineRailProps = {
  year: string;
  labels: string[];
};

export function TimelineRail({ year, labels }: TimelineRailProps) {
  return (
    <aside
      aria-label="Timeline rail"
      className="rounded-[2rem] border border-black/5 bg-surface-container-low px-5 py-6 shadow-sm lg:sticky lg:top-24 lg:h-fit"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-on-surface-variant">Archive</p>
      <p className="mt-3 font-headline text-6xl font-black tracking-tight text-on-surface">{year}</p>

      <div className="mt-6 flex gap-4">
        <div className="w-px self-stretch bg-outline/30" aria-hidden="true" />
        <ol className="space-y-4">
          {labels.map((label) => (
            <li key={label} className="space-y-1">
              <p className="text-sm font-semibold text-on-surface">{label}</p>
              <p className="text-xs uppercase tracking-[0.24em] text-on-surface-variant">New Moments</p>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
