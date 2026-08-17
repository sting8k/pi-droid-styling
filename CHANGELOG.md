# Changelog

## 2.9.1 - 2026-08-17

### Changed
- Refresh the README screenshot to show the current interface.

## 2.9.0 - 2026-08-17

### Added
- Bundle the companion `pi-themes` collection and register only themes that are not already available, avoiding conflicts with standalone installs.
- Show Pi-compatible cache-hit percentage (`CH`) in compact footer token usage.

### Changed
- Publish under the npm scope `@sting8k/pi-droid-styling` with public access.
- Keep Gemini footer status metadata on one right-anchored line.
- Remove the duplicated fixed-zone compositor stack in favor of Pi core fullscreen behavior.

### Upgrade note
- Existing standalone `pi-themes` installs can stay enabled. They take priority, while `pi-droid-styling` provides only missing bundled themes.

## 2.0.0 - 2026-05-31

### Changed
- Reorganized internal modules into `core/`, `theme/`, and `performance/`.
- Extracted assistant speed tracking from `index.ts`.
- Extracted git branch status fetching from `index.ts`.
- Kept `tool-tags/` as the dedicated tool rendering domain.

### Notes
- This release marks the accumulated UI, performance, and styling patches as a major version.
