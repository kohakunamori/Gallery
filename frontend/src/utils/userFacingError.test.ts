import { describe, expect, it } from 'vitest';
import {
  EXHIBITION_GENERIC_ERROR_MESSAGE,
  EXHIBITION_MEDIA_SOURCE_ERROR_MESSAGE,
  EXHIBITION_STATUS_COPY,
  UPLOAD_GENERIC_ERROR_MESSAGE,
  UPLOAD_NETWORK_ERROR_MESSAGE,
  UPLOAD_TOKEN_ERROR_MESSAGE,
  isMediaSourceFailureMessage,
  mapUserFacingError,
  toUserFacingError,
} from './userFacingError';

describe('userFacingError', () => {
  it('maps 401/403 and token failures to the shared upload token message', () => {
    expect(mapUserFacingError({ status: 401, context: 'upload' })).toBe(UPLOAD_TOKEN_ERROR_MESSAGE);
    expect(mapUserFacingError({ status: 403, context: 'upload' })).toBe(UPLOAD_TOKEN_ERROR_MESSAGE);
    expect(
      mapUserFacingError({
        status: 401,
        message: 'Upload token is required or invalid.',
        context: 'upload',
      }),
    ).toBe(UPLOAD_TOKEN_ERROR_MESSAGE);
    expect(
      toUserFacingError(new Error('Invalid upload token provided'), 'upload'),
    ).toBe(UPLOAD_TOKEN_ERROR_MESSAGE);
  });

  it('maps network failures without leaking technical detail', () => {
    expect(mapUserFacingError({ message: 'Failed to fetch', context: 'upload' })).toBe(
      UPLOAD_NETWORK_ERROR_MESSAGE,
    );
    expect(toUserFacingError(new TypeError('NetworkError when attempting to fetch resource.'), 'upload')).toBe(
      UPLOAD_NETWORK_ERROR_MESSAGE,
    );
  });

  it('maps media-source failures for exhibition copy', () => {
    expect(
      mapUserFacingError({
        message: 'No reachable remote media source.',
        context: 'exhibition',
      }),
    ).toBe(EXHIBITION_MEDIA_SOURCE_ERROR_MESSAGE);
    expect(isMediaSourceFailureMessage('No reachable remote media source.')).toBe(true);
  });

  it('keeps short safe backend validation messages', () => {
    expect(
      mapUserFacingError({
        status: 400,
        message: 'Unsupported image format: notes.txt',
        context: 'upload',
      }),
    ).toBe('Unsupported image format: notes.txt');
  });

  it('hides paths, stack traces, and raw dumps behind short generic copy', () => {
    expect(
      mapUserFacingError({
        message: 'Failed opening /var/www/backend/var/photos-index.json',
        context: 'upload',
      }),
    ).toBe(UPLOAD_GENERIC_ERROR_MESSAGE);

    expect(
      mapUserFacingError({
        message: 'Traceback (most recent call last):\n  File "upload_r2.py", line 12',
        context: 'upload',
      }),
    ).toBe(UPLOAD_GENERIC_ERROR_MESSAGE);

    expect(
      mapUserFacingError({
        message: 'PHP Fatal error: Uncaught Exception in /app/src/Action/UploadPhotosAction.php on line 40',
        context: 'upload',
      }),
    ).toBe(UPLOAD_GENERIC_ERROR_MESSAGE);
  });

  it('uses calm exhibition defaults for unknown errors', () => {
    expect(mapUserFacingError({ context: 'exhibition' })).toBe(EXHIBITION_GENERIC_ERROR_MESSAGE);
    expect(toUserFacingError(new Error('boom'), 'exhibition')).toBe(EXHIBITION_GENERIC_ERROR_MESSAGE);
  });

  it('exports stable exhibition status panel titles and descriptions', () => {
    expect(EXHIBITION_STATUS_COPY.error.title).toBe('Unable to load the exhibition');
    expect(EXHIBITION_STATUS_COPY.empty.title).toBe('No works yet');
    expect(EXHIBITION_STATUS_COPY.mediaSourceUnavailable.title).toBe('Media is temporarily unavailable');
    expect(EXHIBITION_STATUS_COPY.empty.description).not.toMatch(/photos-index\.json|\/var\/|stack/i);
  });
});
