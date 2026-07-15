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
  'exhibition.error.title': 'Unable to raise the curtain',
  'exhibition.error.description':
    'Something went wrong backstage while loading works. Check your connection and try again.',
  'exhibition.error.retry': 'Retry',
  'exhibition.error.openUpload': 'Open upload',
  'exhibition.empty.title': 'The stage is empty',
  'exhibition.empty.description': 'Everything is set for the debut. Upload the first images to open the show.',
  'exhibition.empty.upload': 'Stage the first images',

  // Gallery settings modal
  'settings.title': 'Gallery settings',
  'settings.close': 'Close',
  'settings.closeAria': 'Close gallery settings',
  'settings.closeMobile': 'Close settings',
  'settings.display': 'Production',
  'settings.description':
    'Set the stage: theme, accent color, and how the wall runs.',
  'settings.sortOrder': 'Sort order',
  'settings.accent': 'Accent color',
  'settings.accent.azure': 'Azure',
  'settings.accent.scarlet': 'Scarlet',
  'settings.accent.sapphire': 'Sapphire',
  'settings.accent.emerald': 'Emerald',
  'settings.accent.gold': 'Gold',
  'settings.accent.sakura': 'Sakura',
  'settings.waterfallColumns': 'Waterfall columns',
  'settings.sort.newest': 'Newest',
  'settings.sort.oldest': 'Oldest',
  'settings.sort.filenameAsc': 'A–Z',
  'settings.sort.filenameDesc': 'Z–A',
  'settings.sort.random': 'Random',
  'settings.columns.auto': 'Auto',
  'settings.columns.fixed': 'Fixed columns',
  'settings.columns.fixedHint': 'Choose a fixed count from {min} to {max}.',
  'settings.columns.decrease': 'Decrease waterfall columns',
  'settings.columns.increase': 'Increase waterfall columns',
  'settings.columns.selectedCount': 'Selected waterfall column count',
  'settings.columns.autoHint':
    'Auto still follows the current responsive breakpoints. Use the stepper to switch to a fixed layout.',

  // Upload page
  'upload.backToGallery': 'Back to the stage',
  'upload.eyebrow': 'Production desk',
  'upload.heading': 'Send new works to the stage',
  'upload.intro':
    'Drop images here or browse your device. New works are published to the gallery media store and then cleared from temporary staging on this server.',
  'upload.dropzone': 'Drop images here or browse',
  'upload.chooseFiles': 'Choose image files',
  'upload.token': 'Upload token',
  'upload.tokenHint': 'Required only when the server is configured with one.',
  'upload.rememberToken': 'Remember token on this device',
  'upload.submit': 'Upload selected files',
  'upload.uploading': 'Uploading…',
  'upload.cancel': 'Cancel upload',
  'upload.viewGallery': 'View the stage',
  'upload.uploadMore': 'Upload more',
  'upload.complete': 'Live clear!',
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
