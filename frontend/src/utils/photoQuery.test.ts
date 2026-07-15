import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSelectedPhotoId, writeSelectedPhotoId } from './photoQuery';

describe('photoQuery', () => {
  beforeEach(() => {
    window.history.replaceState(window.history.state, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(window.history.state, '', '/');
    vi.restoreAllMocks();
  });

  describe('readSelectedPhotoId', () => {
    it('returns null when the photo param is absent', () => {
      expect(readSelectedPhotoId('')).toBeNull();
      expect(readSelectedPhotoId('?utm_source=share')).toBeNull();
      expect(readSelectedPhotoId()).toBeNull();
    });

    it('returns null for empty or whitespace-only photo values', () => {
      expect(readSelectedPhotoId('?photo=')).toBeNull();
      expect(readSelectedPhotoId('?photo=%20%20')).toBeNull();
      expect(readSelectedPhotoId('?photo=   ')).toBeNull();
    });

    it('returns the trimmed photo id when present', () => {
      expect(readSelectedPhotoId('?photo=fresh')).toBe('fresh');
      expect(readSelectedPhotoId('?utm=1&photo=late-afternoon&x=2')).toBe('late-afternoon');
    });

    it('reads from window.location.search by default', () => {
      window.history.replaceState(window.history.state, '', '/?photo=from-location');

      expect(readSelectedPhotoId()).toBe('from-location');
    });
  });

  describe('writeSelectedPhotoId', () => {
    it('sets the photo param with replaceState by default and preserves other params and hash', () => {
      const replaceState = vi.fn();
      const pushState = vi.fn();

      writeSelectedPhotoId('fresh', {
        url: 'https://gallery.example/exhibition?utm=1#section',
        history: { replaceState, pushState },
      });

      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState.mock.calls[0]?.[2]).toBe('/exhibition?utm=1&photo=fresh#section');
    });

    it('clears only the photo param when writing null', () => {
      const replaceState = vi.fn();

      writeSelectedPhotoId(null, {
        url: 'https://gallery.example/?photo=fresh&utm=1#top',
        history: { replaceState, pushState: vi.fn() },
      });

      expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/?utm=1#top');
    });

    it('omits the query string when clearing the only param', () => {
      const replaceState = vi.fn();

      writeSelectedPhotoId(null, {
        url: 'https://gallery.example/?photo=fresh',
        history: { replaceState, pushState: vi.fn() },
      });

      expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/');
    });

    it('uses pushState when mode is push', () => {
      const replaceState = vi.fn();
      const pushState = vi.fn();

      writeSelectedPhotoId('older', {
        mode: 'push',
        url: 'https://gallery.example/',
        history: { replaceState, pushState },
      });

      expect(pushState).toHaveBeenCalledWith(window.history.state, '', '/?photo=older');
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('trims photo ids before writing and treats whitespace-only as clear', () => {
      const replaceState = vi.fn();

      writeSelectedPhotoId('  fresh  ', {
        url: 'https://gallery.example/',
        history: { replaceState, pushState: vi.fn() },
      });

      expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/?photo=fresh');

      writeSelectedPhotoId('   ', {
        url: 'https://gallery.example/?photo=fresh',
        history: { replaceState, pushState: vi.fn() },
      });

      expect(replaceState).toHaveBeenLastCalledWith(window.history.state, '', '/');
    });

    it('updates the live location via the default history API', () => {
      window.history.replaceState(window.history.state, '', '/?utm=share#hash');

      writeSelectedPhotoId('fresh');

      expect(window.location.search).toBe('?utm=share&photo=fresh');
      expect(window.location.hash).toBe('#hash');

      writeSelectedPhotoId(null);

      expect(window.location.search).toBe('?utm=share');
      expect(window.location.hash).toBe('#hash');
    });
  });
});
