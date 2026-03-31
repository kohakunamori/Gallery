import { useEffect, useRef } from 'react';

type LoadTriggerProps = {
  disabled: boolean;
  isComplete: boolean;
  onLoadMore: () => void;
};

export function LoadTrigger({ disabled, isComplete, onLoadMore }: LoadTriggerProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const hasTriggeredForCurrentEntryRef = useRef(false);

  useEffect(() => {
    if (disabled || isComplete || triggerRef.current === null) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      if (!entry.isIntersecting) {
        hasTriggeredForCurrentEntryRef.current = false;
        return;
      }

      if (hasTriggeredForCurrentEntryRef.current) {
        return;
      }

      hasTriggeredForCurrentEntryRef.current = true;
      onLoadMore();
    }, { rootMargin: '600px 0px' });

    observer.observe(triggerRef.current);

    return () => observer.disconnect();
  }, [disabled, isComplete, onLoadMore]);

  if (isComplete) {
    return <p className="pt-10 text-center text-xs font-medium uppercase tracking-[0.22em] text-outline">End of exhibition</p>;
  }

  return (
    <div ref={triggerRef} className="pt-10 text-center text-sm text-on-surface-variant">
      {disabled ? 'Loading more works…' : 'Continue scrolling'}
    </div>
  );
}
