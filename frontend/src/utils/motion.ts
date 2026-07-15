export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
}

export function getScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
