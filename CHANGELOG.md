# Changelog

## Unreleased

### Changed
- Startup welcome now uses a Claude Code-style rounded border banner (theme accent) with Pi content: centered Welcome/logo/model+cwd, Tips / Context / What's new columns, muted version label, and flush top spacing (header spacers stripped).
- What's new bullets are read from the installed Pi `CHANGELOG.md` for the current `VERSION` (up to 2 from New Features / Added), with a short fallback and `/changelog` link — no theme hardcoding that goes stale on Pi upgrades.
- Welcome banner uses the same full content width as the cli-dock statusline (no extra `MESSAGE_TEXT_INDENT` inset).
- Welcome banner is new-session only (skipped when `session.state.messages.length > 0`), matching Pi's changelog gate for resumed sessions.
- Keep this welcome layout in `startup-ui.ts` across upgrades — do not revert to the old compact header-only startup UI without an intentional replacement.

## 2.0.0 - 2026-05-31

### Changed
- Reorganized internal modules into `core/`, `theme/`, and `performance/`.
- Extracted assistant speed tracking from `index.ts`.
- Extracted git branch status fetching from `index.ts`.
- Kept `tool-tags/` as the dedicated tool rendering domain.

### Notes
- This release marks the accumulated UI, performance, and styling patches as a major version.
