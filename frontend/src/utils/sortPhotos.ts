import type { Photo } from '../types/photo';
import type { GallerySortPreference } from './gallerySettings';

export function sortPhotos(photos: Photo[], sortPreference: GallerySortPreference) {
  const sortedPhotos = [...photos];

  if (sortPreference === 'random') {
    return shufflePhotosWithinMonths(sortedPhotos);
  }

  sortedPhotos.sort((left, right) => {
    switch (sortPreference) {
      case 'oldest': {
        return comparePhotosByDateAscending(left, right);
      }
      case 'filename-asc': {
        return comparePhotosByFilename(left, right);
      }
      case 'filename-desc': {
        return comparePhotosByFilename(right, left);
      }
      case 'newest':
      default: {
        return comparePhotosByDateDescending(left, right);
      }
    }
  });

  return sortedPhotos;
}

function shufflePhotosWithinMonths(photos: Photo[]) {
  const newestFirst = [...photos].sort(comparePhotosByDateDescending);
  const groups: Photo[][] = [];
  let currentMonthKey: string | null = null;

  for (const photo of newestFirst) {
    const monthKey = photo.sortTime.slice(0, 7);

    if (monthKey !== currentMonthKey) {
      groups.push([]);
      currentMonthKey = monthKey;
    }

    groups[groups.length - 1]?.push(photo);
  }

  return groups.flatMap((group) => {
    const shuffledGroup = [...group];
    shufflePhotos(shuffledGroup);
    return shuffledGroup;
  });
}

function shufflePhotos(photos: Photo[]) {
  for (let index = photos.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const currentPhoto = photos[index];
    photos[index] = photos[randomIndex];
    photos[randomIndex] = currentPhoto;
  }
}

function comparePhotosByDateAscending(left: Photo, right: Photo) {
  const bySortTime = left.sortTime.localeCompare(right.sortTime);

  if (bySortTime !== 0) {
    return bySortTime;
  }

  return comparePhotosByFilename(left, right);
}

function comparePhotosByDateDescending(left: Photo, right: Photo) {
  const bySortTime = right.sortTime.localeCompare(left.sortTime);

  if (bySortTime !== 0) {
    return bySortTime;
  }

  return comparePhotosByFilename(left, right);
}

function comparePhotosByFilename(left: Photo, right: Photo) {
  const byFilename = left.filename.localeCompare(right.filename, undefined, { sensitivity: 'base' });

  if (byFilename !== 0) {
    return byFilename;
  }

  return left.id.localeCompare(right.id);
}
