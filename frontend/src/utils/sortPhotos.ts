import type { Photo } from '../types/photo';
import type { GallerySortPreference } from '../components/exhibition/GallerySettingsModal';

export function sortPhotos(photos: Photo[], sortPreference: GallerySortPreference) {
  const sortedPhotos = [...photos];

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
