import type { GalleryConcreteMediaSource } from '../utils/gallerySettings';

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

export async function fetchMediaSourceStatuses(signal?: AbortSignal): Promise<MediaSourceStatus[]> {
  const response = await fetch('/api/media-sources', { signal });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: MediaSourceStatus[] };

  return payload.items;
}
