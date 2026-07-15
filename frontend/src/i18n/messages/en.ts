/**
 * English message catalog — source of truth for visitor-facing copy.
 * Keys are stable identifiers; values are the English strings rendered by default.
 */
export const enMessages = {
  // Header
  'header.wordmark': 'Gallery',
  'header.upload': 'Upload',
  'header.settings': 'Settings',
  'header.openUpload': 'Open gallery upload',
  'header.openSettings': 'Open gallery settings',
  'header.albums': 'Albums',
  'header.openAlbums': 'Browse albums',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',

  // Exhibition status panels
  'exhibition.error.title': 'Unable to load the exhibition',
  'exhibition.error.description':
    'Something went wrong while loading works. Check your connection and try again.',
  'exhibition.error.retry': 'Retry',
  'exhibition.error.openUpload': 'Open upload',
  'exhibition.empty.title': 'No works yet',
  'exhibition.empty.description': 'The exhibition is ready. Upload the first images to start the wall.',
  'exhibition.empty.upload': 'Upload first images',

  // Gallery settings modal
  'settings.title': 'Gallery settings',
  'settings.close': 'Close',
  'settings.closeAria': 'Close gallery settings',
  'settings.closeMobile': 'Close settings',
  'settings.display': 'Display',
  'settings.description':
    'Choose how many columns the waterfall uses while keeping the presentation stable.',
  'settings.sortOrder': 'Sort order',
  'settings.waterfallColumns': 'Waterfall columns',
  'settings.sort.newest': 'Newest first',
  'settings.sort.oldest': 'Oldest first',
  'settings.sort.filenameAsc': 'Filename A–Z',
  'settings.sort.filenameDesc': 'Filename Z–A',
  'settings.sort.random': 'Random order',
  'settings.columns.auto': 'Auto',
  'settings.columns.fixed': 'Fixed columns',
  'settings.columns.fixedHint': 'Choose a fixed count from {min} to {max}.',
  'settings.columns.decrease': 'Decrease waterfall columns',
  'settings.columns.increase': 'Increase waterfall columns',
  'settings.columns.selectedCount': 'Selected waterfall column count',
  'settings.columns.autoHint':
    'Auto still follows the current responsive breakpoints. Use the stepper to switch to a fixed layout.',

  // Upload page
  'upload.backToGallery': 'Back to gallery',
  'upload.eyebrow': 'Gallery upload',
  'upload.heading': 'Add images to the gallery',
  'upload.intro':
    'Drop images here or browse your device. Selected files are published to the gallery media store and then cleared from temporary staging on this server.',
  'upload.dropzone': 'Drop images here or browse',
  'upload.chooseFiles': 'Choose image files',
  'upload.token': 'Upload token',
  'upload.tokenHint': 'Required only when the server is configured with one.',
  'upload.rememberToken': 'Remember token on this device',
  'upload.submit': 'Upload selected files',
  'upload.uploading': 'Uploading…',
  'upload.cancel': 'Cancel upload',
  'upload.viewGallery': 'View gallery',
  'upload.uploadMore': 'Upload more',
  'upload.complete': 'Upload complete',
  'upload.failed': 'Upload failed',
  'upload.canceled': 'Upload canceled',
  'upload.canceledBody': 'The active upload was canceled before completion.',
  'upload.selectedFiles': 'Selected files',
  'upload.clearAll': 'Clear all',
  'upload.remove': 'Remove',
  'upload.technicalLog': 'Technical log',
} as const;

export type MessageKey = keyof typeof enMessages;
export type MessageCatalog = Record<MessageKey, string>;
