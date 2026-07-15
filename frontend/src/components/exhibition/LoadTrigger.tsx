import { memo, useEffect, useRef } from 'react';

type LoadTriggerProps = {
  disabled: boolean;
  isComplete: boolean;
  onLoadMore: () => void;
  resetKey?: number;
  rootMargin?: string;
};

const MIN_TRIGGER_INTERVAL_MS = 250;

export const LoadTrigger = memo(function LoadTrigger({
  disabled,
  isComplete,
  onLoadMore,
  resetKey = 0,
  rootMargin = '1200px 0px',
}: LoadTriggerProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const hasTriggeredForCurrentEntryRef = useRef(false);
  const isIntersectingRef = useRef(false);
  const lastTriggeredAtRef = useRef(0);
  const scheduledTriggerTimeoutRef = useRef<number | null>(null);
  const disabledRef = useRef(disabled);
  const isCompleteRef = useRef(isComplete);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  const clearScheduledTrigger = () => {
    if (scheduledTriggerTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(scheduledTriggerTimeoutRef.current);
    scheduledTriggerTimeoutRef.current = null;
  };

  const triggerLoadMore = () => {
    clearScheduledTrigger();
    hasTriggeredForCurrentEntryRef.current = true;
    lastTriggeredAtRef.current = Date.now();
    onLoadMoreRef.current();
  };

  const scheduleLoadMoreIfNeeded = () => {
    if (disabledRef.current || isCompleteRef.current || !isIntersectingRef.current || hasTriggeredForCurrentEntryRef.current) {
      return;
    }

    const remainingCooldown = Math.max(0, MIN_TRIGGER_INTERVAL_MS - (Date.now() - lastTriggeredAtRef.current));

    if (remainingCooldown === 0) {
      triggerLoadMore();
      return;
    }

    if (scheduledTriggerTimeoutRef.current !== null) {
      return;
    }

    scheduledTriggerTimeoutRef.current = window.setTimeout(() => {
      scheduledTriggerTimeoutRef.current = null;

      if (disabledRef.current || isCompleteRef.current || !isIntersectingRef.current || hasTriggeredForCurrentEntryRef.current) {
        return;
      }

      triggerLoadMore();
    }, remainingCooldown);
  };

  useEffect(() => {
    disabledRef.current = disabled;
    isCompleteRef.current = isComplete;

    if (disabled || isComplete) {
      clearScheduledTrigger();
    }
  }, [disabled, isComplete]);

  useEffect(() => {
    if (disabled || isComplete) {
      return;
    }

    hasTriggeredForCurrentEntryRef.current = false;

    if (isIntersectingRef.current) {
      scheduleLoadMoreIfNeeded();
    }
  }, [disabled, isComplete, resetKey]);

  useEffect(() => {
    return () => {
      clearScheduledTrigger();
    };
  }, []);

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

      triggerLoadMore();
    }, { rootMargin });

    observer.observe(triggerRef.current);

    return () => observer.disconnect();
  }, [disabled, isComplete, rootMargin]);

  if (isComplete) {
    return null;
  }

  return (
    <div ref={triggerRef} className="pt-10 text-center text-sm text-on-surface-variant">
      {disabled ? 'Loading more works…' : 'Continue scrolling'}
    </div>
  );
});
