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
  uploadToken?: string;
  onOutput?: (line: string, stream: UploadOutputStream) => void;
};

type UploadStreamEvent =
  | { type: 'file'; file: UploadPhotoResult }
  | { type: 'output'; stream: UploadOutputStream; line: string }
  | { type: 'complete'; files: UploadPhotoResult[]; output?: string[] }
  | { type: 'error'; error?: string; output?: string[] };

const MAX_RETAINED_OUTPUT_LINES = 500;

export async function uploadPhotos(
  files: File[],
  optionsOrSignal?: UploadPhotosOptions | AbortSignal,
): Promise<UploadPhotosResponse> {
  const options = normalizeOptions(optionsOrSignal);
  const formData = new FormData();
  const headers: Record<string, string> = {};
  const uploadToken = options.uploadToken?.trim();

  for (const file of files) {
    formData.append('files', file);
  }

  if (uploadToken !== undefined && uploadToken !== '') {
    headers['X-Upload-Token'] = uploadToken;
  }

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData,
    signal: options.signal,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);

    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('Content-Type') ?? '';

  if (contentType.includes('application/x-ndjson')) {
    return readUploadEventStream(response, options);
  }

  const payload = await response.json().catch(() => null);

  return parseUploadResponse(payload);
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
  let event: unknown;

  try {
    event = JSON.parse(line);
  } catch {
    const normalizedLine = line.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const message = normalizedLine === '' ? 'Upload stream contained an invalid response.' : normalizedLine;

    throw new Error(`Upload stream returned a server error: ${message}`);
  }

  if (!isRecord(event) || typeof event.type !== 'string') {
    throw new Error('Upload stream contained an invalid event.');
  }

  if (event.type === 'file') {
    if (!isUploadPhotoResult(event.file)) {
      throw new Error('Upload stream contained an invalid file event.');
    }

    return { type: 'file', file: event.file };
  }

  if (event.type === 'output') {
    if (typeof event.line !== 'string') {
      throw new Error('Upload stream contained an invalid output event.');
    }

    return {
      type: 'output',
      line: event.line,
      stream: isUploadOutputStream(event.stream) ? event.stream : 'stdout',
    };
  }

  if (event.type === 'complete') {
    if (!Array.isArray(event.files) || !event.files.every(isUploadPhotoResult)) {
      throw new Error('Upload stream contained an invalid complete event.');
    }

    if (event.output !== undefined && (!Array.isArray(event.output) || !event.output.every(isString))) {
      throw new Error('Upload stream contained an invalid complete event.');
    }

    return { type: 'complete', files: event.files, output: event.output };
  }

  if (event.type === 'error') {
    if (event.error !== undefined && typeof event.error !== 'string') {
      throw new Error('Upload stream contained an invalid error event.');
    }

    if (event.output !== undefined && (!Array.isArray(event.output) || !event.output.every(isString))) {
      throw new Error('Upload stream contained an invalid error event.');
    }

    return { type: 'error', error: event.error, output: event.output };
  }

  throw new Error('Upload stream contained an invalid event.');
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

  if (event.type === 'output') {
    appendOutputLine(output, event.line);
    options.onOutput?.(event.line, event.stream);

    return null;
  }

  if (event.type === 'complete') {
    return {
      files: event.files,
      output: event.output ?? output,
    };
  }

  if (event.type === 'error') {
    throw new Error(event.error ?? 'Upload failed.');
  }

  return null;
}

function parseUploadResponse(payload: unknown): UploadPhotosResponse {
  if (!isRecord(payload)) {
    throw new Error('Invalid upload response.');
  }

  const files = payload.files;
  const output = payload.output;

  if (!Array.isArray(files) || !files.every(isUploadPhotoResult)) {
    throw new Error('Invalid upload response.');
  }

  if (!Array.isArray(output) || !output.every(isString)) {
    throw new Error('Invalid upload response.');
  }

  return { files, output };
}

function appendOutputLine(output: string[], line: string) {
  output.push(line);

  while (output.length > MAX_RETAINED_OUTPUT_LINES) {
    output.shift();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isUploadPhotoResult(value: unknown): value is UploadPhotoResult {
  return (
    isRecord(value)
    && typeof value.name === 'string'
    && typeof value.path === 'string'
    && typeof value.size === 'number'
    && Number.isFinite(value.size)
  );
}

function isUploadOutputStream(value: unknown): value is UploadOutputStream {
  return value === 'stdout' || value === 'stderr';
}
