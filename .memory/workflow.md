# Workflow
_Last updated: 2025-02-21_

## Adding new customizable colors
1. Add key + default to `HARDCODED_DEFAULTS` in `theme-extras.ts`
2. Use `getThemeExtra(theme, "keyName")` to read value
3. Apply with `fgHex(theme, color, text)` — falls back gracefully when empty string
4. User sets value in theme JSON under `extras: { "keyName": "#hexcolor" }`
