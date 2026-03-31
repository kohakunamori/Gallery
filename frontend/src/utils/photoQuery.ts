export function readSelectedPhotoId(): string | null {
  return new URL(window.location.href).searchParams.get('photo');
}

export function writeSelectedPhotoId(photoId: string | null): void {
  const url = new URL(window.location.href);

  if (photoId === null) {
    url.searchParams.delete('photo');
  } else {
    url.searchParams.set('photo', photoId);
  }

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
