export type UploadPhotoResult = {
  name: string;
  path: string;
  size: number;
};

export type UploadPhotosResponse = {
  files: UploadPhotoResult[];
  output: string[];
};

export type UploadOutputStream = 'stdout' | 'stderr';

export type UploadPhotosOptions = {
  signal?: AbortSignal;
  onOutput?: (line: string, stream: UploadOutputStream) => void;
};

type UploadStreamEvent =
  | { type: 'file'; file: UploadPhotoResult }
  | { type: 'output'; stream?: UploadOutputStream; line?: string }
  | { type: 'complete'; files?: UploadPhotoResult[]; output?: string[] }
  | { type: 'error'; error?: string; output?: string[] };

export async function uploadPhotos(
  files: File[],
  optionsOrSignal?: UploadPhotosOptions | AbortSignal,
): Promise<UploadPhotosResponse> {
  const options = normalizeOptions(optionsOrSignal);
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData,
    signal: options.signal,
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);

    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('Content-Type') ?? '';

  if (contentType.includes('application/x-ndjson')) {
    return readUploadEventStream(response, options);
  }

  const payload = (await response.json().catch(() => null)) as Partial<UploadPhotosResponse> | null;

  return {
    files: payload?.files ?? [],
    output: payload?.output ?? [],
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers?.get('Content-Type') ?? '';

  if (contentType.includes('application/json') || typeof response.text !== 'function') {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (typeof payload?.error === 'string' && payload.error !== '') {
      return payload.error;
    }
  }

  const text = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
  const normalizedText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  return normalizedText === '' ? `Upload failed with status ${response.status}` : normalizedText;
}

function normalizeOptions(optionsOrSignal: UploadPhotosOptions | AbortSignal | undefined): UploadPhotosOptions {
  if (optionsOrSignal === undefined) {
    return {};
  }

  if ('aborted' in optionsOrSignal) {
    return { signal: optionsOrSignal };
  }

  return optionsOrSignal;
}

async function readUploadEventStream(response: Response, options: UploadPhotosOptions): Promise<UploadPhotosResponse> {
  if (response.body === null) {
    throw new Error('Upload response stream is unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const output: string[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const result = handleUploadStreamLine(line, output, options);

      if (result !== null) {
        return result;
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim() !== '') {
    const result = handleUploadStreamLine(buffer, output, options);

    if (result !== null) {
      return result;
    }
  }

  throw new Error('Upload stream ended before completion.');
}

function parseUploadStreamEvent(line: string): UploadStreamEvent {
  try {
    return JSON.parse(line) as UploadStreamEvent;
  } catch {
    const normalizedLine = line.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const message = normalizedLine === '' ? 'Upload stream contained an invalid response.' : normalizedLine;

    throw new Error(`Upload stream returned a server error: ${message}`);
  }
}

function handleUploadStreamLine(
  line: string,
  output: string[],
  options: UploadPhotosOptions,
): UploadPhotosResponse | null {
  if (line.trim() === '') {
    return null;
  }

  const event = parseUploadStreamEvent(line);

  if (event.type === 'output' && typeof event.line === 'string') {
    const stream = event.stream ?? 'stdout';

    output.push(event.line);
    options.onOutput?.(event.line, stream);

    return null;
  }

  if (event.type === 'complete') {
    return {
      files: event.files ?? [],
      output: event.output ?? output,
    };
  }

  if (event.type === 'error') {
    throw new Error(event.error ?? 'Upload failed.');
  }

  return null;
}
