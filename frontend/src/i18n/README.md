# i18n (lightweight message catalogs)

This project uses a tiny hand-rolled catalog instead of a heavy i18n framework.

## Layout

```text
frontend/src/i18n/
├── index.ts            # getMessage / t / useT
├── locale.ts           # read/write gallery.locale (default: en)
├── messages/
│   └── en.ts           # English source of truth
└── README.md
```

- **Default locale:** `en`
- **Storage key:** `gallery.locale`
- **English catalog is the source of truth** — do not machine-dump translations.

## Usage

```ts
import { t, useT } from '../i18n';

// Pure helper (preferred in pure utils / event handlers)
t('settings.title'); // → "Gallery settings"
t('settings.columns.fixedHint', { min: 1, max: 8 });

// Optional hook in components
const translate = useT();
translate('header.upload');
```

Missing keys fall back to English, then to the key string itself so UI never renders blank.

## Adding a locale (e.g. Chinese)

1. Copy the English catalog:
   ```bash
   cp frontend/src/i18n/messages/en.ts frontend/src/i18n/messages/zh.ts
   ```
2. Rename the export (`enMessages` → `zhMessages`) and translate **values only** — keep keys identical.
3. Register the locale:
   - Extend `Locale` in `locale.ts` (`'en' | 'zh'`).
   - Add `'zh'` to `SUPPORTED_LOCALES`.
   - Import `zhMessages` in `index.ts` and add `zh: zhMessages` to `catalogs`.
4. Persist selection with `writeLocale('zh')` (wire a settings control when ready).
5. Prefer human review over machine-only dumps.

## Conventions

- Flat dotted keys (`settings.title`, `exhibition.error.retry`).
- Interpolation uses `{name}` placeholders.
- Keep visitor copy free of internal paths and secrets.
- Existing tests assert English strings via `getByText` / roles — keep `en.ts` values stable unless intentionally changing copy.
