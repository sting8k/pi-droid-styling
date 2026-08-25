# Changelog

## 2.11.0 - 2026-08-25

### Added
- New `userZoneStyle: "nvim"` preset: a Neovim-inspired dock with a lined input frame and one full-width statusline bar. A leading solid-block badge (reverse video) shows the thinking level uppercased verbatim from Pi's own six levels, or `BASH` while the input starts with `!`, coloured by mode rather than level (`accent` for normal input — the theme's own general highlight token, so a theme author retuning it deliberately carries every accented UI element, including this badge, along with it; measured alternatives scored higher on raw contrast/distinctness but borrow meaning from an unrelated part of the theme (syntax highlighting); known and accepted that `accent` equals `bashMode` in 5 of 26 companion themes, where bash mode recolours only the label; Pi's own `theme.getBashModeBorderColor()` for bash — the level lives in the label text only); a non-reasoning model renders no badge at all. The bar shows `provider · model`, and `branch · tokens ctx% · CH%` right-aligned, with a width-based degradation ladder so the row always fills the terminal exactly. Other extensions' status is appended to the far right of that same row and truncated with `…` if it overflows.

## 2.10.1 - 2026-08-25

### Fixed
- Terminal images in tool results (kitty/iTerm2, e.g. reading an image file) are no longer dropped by the tool spacing normalization; live sessions holding the previous render wrapper pick up the fix through the refreshed runtime delegate.

## 2.10.0 - 2026-08-24

### Added
- Bundle the new `lipgloss` companion theme built entirely from the official CharmTone palette used by Charm's Crush.

## 2.9.3 - 2026-08-17

### Changed
- Declare the README screenshot as the package thumbnail (`pi.image`) so the pi.dev gallery card shows it.

## 2.9.2 - 2026-08-17

### Changed
- Align the cli-dock status row with the input text and remove the redundant `Model:` label.

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
