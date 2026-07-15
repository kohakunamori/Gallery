type WriteSelectedPhotoIdOptions = {
  mode?: 'replace' | 'push';
  /** Optional injection for tests — full href or path+search+hash */
  url?: string;
  history?: Pick<History, 'replaceState' | 'pushState'>;
};

/** Read `photo` from the current location search string. Empty → null. */
export function readSelectedPhotoId(search?: string): string | null {
  if (search === undefined && typeof window === 'undefined') {
    return null;
  }

  const searchString = search ?? window.location.search;
  const params = new URLSearchParams(searchString);
  const value = params.get('photo');

  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Write or clear `photo` on the current URL via History API.
 * Preserves path, other query keys, and hash.
 * Defaults to `replaceState` so open/prev/next/close do not spam history.
 */
export function writeSelectedPhotoId(
  photoId: string | null,
  options?: WriteSelectedPhotoIdOptions,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const mode = options?.mode ?? 'replace';
  const historyApi = options?.history ?? window.history;
  const baseHref = options?.url ?? window.location.href;
  const nextUrl = new URL(baseHref, window.location.origin);
  const nextPhotoId = photoId?.trim() ?? '';

  if (nextPhotoId === '') {
    nextUrl.searchParams.delete('photo');
  } else {
    nextUrl.searchParams.set('photo', nextPhotoId);
  }

  const next = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;

  if (mode === 'push') {
    historyApi.pushState(window.history.state, '', next);
    return;
  }

  historyApi.replaceState(window.history.state, '', next);
}
