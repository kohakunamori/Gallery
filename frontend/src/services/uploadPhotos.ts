export type UploadPhotoResult = {
  name: string;
  path: string;
  size: number;
};

export type UploadPhotosResponse = {
  files: UploadPhotoResult[];
  output: string[];
};

export async function uploadPhotos(files: File[], signal?: AbortSignal): Promise<UploadPhotosResponse> {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData,
    signal,
  });
  const payload = (await response.json().catch(() => null)) as Partial<UploadPhotosResponse> & { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Upload failed with status ${response.status}`);
  }

  return {
    files: payload?.files ?? [],
    output: payload?.output ?? [],
  };
}
