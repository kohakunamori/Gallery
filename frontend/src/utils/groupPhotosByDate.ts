import type { Photo } from '../types/photo';

export type PhotoGroup = {
  title: string;
  photos: Photo[];
};

export function groupPhotosByDate(photos: Photo[], now = new Date()): PhotoGroup[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const groups = new Map<string, Photo[]>();

  for (const photo of photos) {
    const photoDate = new Date(photo.sortTime);
    const startOfPhotoDate = new Date(photoDate.getFullYear(), photoDate.getMonth(), photoDate.getDate());
    const diffInDays = Math.round((startOfNow.getTime() - startOfPhotoDate.getTime()) / 86_400_000);

    const title = diffInDays === 0
      ? 'Today'
      : diffInDays === 1
        ? 'Yesterday'
        : formatter.format(photoDate);

    if (!groups.has(title)) {
      groups.set(title, []);
    }

    groups.get(title)!.push(photo);
  }

  return Array.from(groups.entries()).map(([title, groupedPhotos]) => ({
    title,
    photos: groupedPhotos,
  }));
}
