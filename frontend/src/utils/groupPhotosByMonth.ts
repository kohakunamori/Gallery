import type { Photo } from '../types/photo';

export type PhotoMonthGroup = {
  title: string;
  photos: Photo[];
};

export function groupPhotosByMonth(photos: Photo[]): PhotoMonthGroup[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const groups = new Map<string, Photo[]>();

  for (const photo of photos) {
    const title = formatter.format(new Date(photo.sortTime));

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
