# Progress
_Last updated: 2026-02-25_

## 2026-02-25
- [x] Re-explored the `pi-droid-styling` codebase and confirmed structure/entrypoints for future changes.
- [x] Verified startup flow in `index.ts`: installs tool/message/editor/loader patches on `session_start` and replaces editor with `BoxEditor`.
- [x] Confirmed performance safeguards: render throttling (`16ms`), chat virtualization (render tail of `50`), and TUI horizontal padding.
- [x] Confirmed custom tool renderers are registered only for active built-ins (`read`, `write`, `edit`, `ls`, `find`, `grep`, `bash`) with default badge fallback for other tools.
- [ ] Next: if changing visual style, start from theme extras in `theme-extras.ts` and consume via `getThemeExtra()` at render sites.

## 2025-02-21
- [x] Added `parensTextColor` and `parensBracketColor` to theme extras — allows customizing tool call parens color via theme JSON
- [x] Updated `parens()` in `tool-tags/common.ts` to use extras, fallback changed from `muted`/`toolOutput` to `text`
