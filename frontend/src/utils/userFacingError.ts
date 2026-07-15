export type UserFacingErrorContext = 'upload' | 'exhibition' | 'generic';

export type UserFacingErrorInput = {
  status?: number;
  message?: string | null;
  context?: UserFacingErrorContext;
};

export const UPLOAD_TOKEN_ERROR_MESSAGE =
  'That upload token was not accepted. Check the token and try again.';

export const UPLOAD_NETWORK_ERROR_MESSAGE =
  'Could not reach the upload service. Check your connection and try again.';

export const UPLOAD_GENERIC_ERROR_MESSAGE = 'Upload failed. Please try again.';

export const EXHIBITION_GENERIC_ERROR_MESSAGE =
  'Something went wrong while loading works. Check your connection and try again.';

export const EXHIBITION_MEDIA_SOURCE_ERROR_MESSAGE =
  'None of the media sources could be reached right now. Try again, or choose another source in settings.';

export const EXHIBITION_STATUS_COPY = {
  error: {
    title: 'Unable to load the exhibition',
    description: EXHIBITION_GENERIC_ERROR_MESSAGE,
  },
  empty: {
    title: 'No works yet',
    description: 'The exhibition is ready. Upload the first images to start the wall.',
  },
  mediaSourceUnavailable: {
    title: 'Media is temporarily unavailable',
    description: EXHIBITION_MEDIA_SOURCE_ERROR_MESSAGE,
  },
} as const;

const PATH_PATTERN =
  /(?:[A-Za-z]:\\|\\\\|\/(?:var|tmp|home|Users|usr|opt|app|backend|frontend)\/|photos-index\.json|\.php|\.py\b)/i;
const STACK_PATTERN =
  /(?:\bat\s+\S+|Traceback \(most recent call last\)|Stack trace:|Exception in|Fatal error|PHP (?:Warning|Notice|Fatal)|File ".*", line \d+)/i;
const NETWORK_PATTERN =
  /\bfailed to fetch\b|\bnetworkerror\b|\bnetwork request failed\b|\bload failed\b|\bfetch failed\b|\beconnrefused\b|\benotfound\b|\berr_network\b|\boffline\b/i;
const TOKEN_PATTERN = /\b(?:token|unauthorized|unauthorised|forbidden|not authorized|authentication)\b/i;
const MEDIA_SOURCE_PATTERN =
  /no reachable remote media source|media source (?:is )?(?:unavailable|disabled|unreachable)|none of the (?:configured )?media sources/i;

/**
 * Map HTTP status / raw service messages into short visitor-safe English copy.
 * Never returns stack traces or filesystem paths.
 */
export function mapUserFacingError(input: UserFacingErrorInput): string {
  const context = input.context ?? 'generic';
  const status = input.status;
  const message = normalizeMessage(input.message);

  if (isTokenFailure(status, message)) {
    return UPLOAD_TOKEN_ERROR_MESSAGE;
  }

  if (isMediaSourceFailure(message)) {
    return EXHIBITION_MEDIA_SOURCE_ERROR_MESSAGE;
  }

  if (isNetworkFailure(message)) {
    return context === 'upload' ? UPLOAD_NETWORK_ERROR_MESSAGE : EXHIBITION_GENERIC_ERROR_MESSAGE;
  }

  // Exhibition stays on calm fixed copy; do not surface opaque service strings.
  if (context === 'exhibition') {
    return EXHIBITION_GENERIC_ERROR_MESSAGE;
  }

  if (message !== '' && isSafeUserMessage(message)) {
    return message;
  }

  if (status !== undefined && status >= 400) {
    return context === 'upload' ? UPLOAD_GENERIC_ERROR_MESSAGE : 'Something went wrong. Please try again.';
  }

  if (context === 'upload') {
    return UPLOAD_GENERIC_ERROR_MESSAGE;
  }

  return 'Something went wrong. Please try again.';
}

/**
 * Convenience wrapper for `unknown` catch values.
 */
export function toUserFacingError(
  error: unknown,
  context: UserFacingErrorContext = 'generic',
): string {
  return mapUserFacingError({
    status: extractStatus(error),
    message: extractMessage(error),
    context,
  });
}

export function isMediaSourceFailureMessage(message: string | null | undefined): boolean {
  return isMediaSourceFailure(normalizeMessage(message));
}

function isTokenFailure(status: number | undefined, message: string): boolean {
  if (status === 401) {
    return true;
  }

  // 403 often means a rejected upload token, but some 403s (e.g. cross-site) carry safer copy.
  if (status === 403) {
    return message === '' || TOKEN_PATTERN.test(message);
  }

  return TOKEN_PATTERN.test(message);
}

function isMediaSourceFailure(message: string): boolean {
  return MEDIA_SOURCE_PATTERN.test(message);
}

function isNetworkFailure(message: string): boolean {
  return NETWORK_PATTERN.test(message);
}

function isSafeUserMessage(message: string): boolean {
  if (message.length > 180) {
    return false;
  }

  if (PATH_PATTERN.test(message) || STACK_PATTERN.test(message)) {
    return false;
  }

  // Multi-line dumps are almost never visitor-facing copy.
  if (message.includes('\n') || message.includes('\r')) {
    return false;
  }

  return true;
}

function normalizeMessage(message: string | null | undefined): string {
  if (typeof message !== 'string') {
    return '';
  }

  return message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return '';
}

function extractStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  if (typeof error.status === 'number' && Number.isFinite(error.status)) {
    return error.status;
  }

  if (typeof error.statusCode === 'number' && Number.isFinite(error.statusCode)) {
    return error.statusCode;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
