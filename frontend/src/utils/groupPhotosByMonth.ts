import type { Photo } from '../types/photo';

type PhotoMonthGroup = {
  title: string;
  photos: Photo[];
  latestSortTime: string;
};

export function groupPhotosByMonth(photos: Photo[]): { title: string; photos: Photo[] }[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const groups = new Map<string, PhotoMonthGroup>();

  for (const photo of photos) {
    const title = formatter.format(new Date(photo.sortTime));
    const existingGroup = groups.get(title);

    if (existingGroup) {
      existingGroup.photos.push(photo);

      if (photo.sortTime > existingGroup.latestSortTime) {
        existingGroup.latestSortTime = photo.sortTime;
      }

      continue;
    }

    groups.set(title, {
      title,
      photos: [photo],
      latestSortTime: photo.sortTime,
    });
  }

  return Array.from(groups.values())
    .sort((left, right) => right.latestSortTime.localeCompare(left.latestSortTime))
    .map(({ title, photos: groupedPhotos }) => ({
      title,
      photos: groupedPhotos,
    }));
}
