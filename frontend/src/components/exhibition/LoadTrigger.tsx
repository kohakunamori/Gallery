import { useEffect, useRef } from 'react';

type LoadTriggerProps = {
  disabled: boolean;
  isComplete: boolean;
  onLoadMore: () => void;
  resetKey?: number;
};

export function LoadTrigger({ disabled, isComplete, onLoadMore, resetKey = 0 }: LoadTriggerProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const hasTriggeredForCurrentEntryRef = useRef(false);
  const isIntersectingRef = useRef(false);

  useEffect(() => {
    if (disabled || isComplete) {
      return;
    }

    hasTriggeredForCurrentEntryRef.current = false;

    if (isIntersectingRef.current) {
      hasTriggeredForCurrentEntryRef.current = true;
      onLoadMore();
    }
  }, [disabled, isComplete, onLoadMore, resetKey]);

  useEffect(() => {
    if (disabled || isComplete || triggerRef.current === null) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      isIntersectingRef.current = entry.isIntersecting;

      if (!entry.isIntersecting) {
        hasTriggeredForCurrentEntryRef.current = false;
        return;
      }

      if (hasTriggeredForCurrentEntryRef.current) {
        return;
      }

      hasTriggeredForCurrentEntryRef.current = true;
      onLoadMore();
    }, { rootMargin: '1200px 0px' });

    observer.observe(triggerRef.current);

    return () => observer.disconnect();
  }, [disabled, isComplete, onLoadMore]);

  if (isComplete) {
    return null;
  }

  return (
    <div ref={triggerRef} className="pt-10 text-center text-sm text-on-surface-variant">
      {disabled ? 'Loading more works…' : 'Continue scrolling'}
    </div>
  );
}
