import type { GalleryConcreteMediaSource } from '../utils/gallerySettings';
import { createSessionRequestCache } from './requestCache';

export type MediaSourceUsage = {
  period: string;
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  isDisabled: boolean;
  isAvailable: boolean;
  status: string;
  lastUpdatedAt: string;
  message?: string;
};

export type MediaSourceStatus = {
  source: GalleryConcreteMediaSource;
  isAvailable: boolean;
  isDisabled: boolean;
  status: string;
  message?: string;
  usage?: MediaSourceUsage;
};

const mediaSourceStatusesRequestCache = createSessionRequestCache<MediaSourceStatus[]>();

export function resetMediaSourceStatusRequestCache() {
  mediaSourceStatusesRequestCache.reset();
}

export function fetchMediaSourceStatuses(signal?: AbortSignal): Promise<MediaSourceStatus[]> {
  return mediaSourceStatusesRequestCache.read(
    'media-source-statuses',
    async (sharedSignal) => {
      const response = await fetch('/api/media-sources', { signal: sharedSignal });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { items: MediaSourceStatus[] };

      return payload.items;
    },
    signal,
  );
}
