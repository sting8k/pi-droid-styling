# Changelog

## 2.12.1 - 2026-09-06

### Fixed
- Consecutive thinking blocks no longer cause the final assistant response to inherit muted, italic thinking styling. Assistant child lookup now follows the host Pi version's rendered-run layout for both presentation styling and streaming Markdown caching.

## 2.12.0 - 2026-08-25

### Added
- nvim preset: the current git branch is embedded in the input frame's top rule, right-aligned — `─── ⎇ branch +N -M ─`. Diff counts are gitsigns-style bare numbers (insertions in `success`, deletions in `error`, zero counts self-hide), the `⎇` glyph and branch name use `muted` (the same tier as the model id on the statusline), and the rule dashes keep the frame tone. The branch name is capped at 24 columns at the source; on narrow widths the label degrades LOC-first, then disappears entirely rather than leaving a bare ellipsis.

### Changed
- nvim statusline no longer renders the `⎇ branch` segment — it moved to the top rule, and the freed width flows to other extensions' status text.
- The branch badge formatter is now a single shared source (`buildBranchBadge`) with per-caller tone and bracket/bare style parameters; the droid and gemini badges render byte-identically to before.
- nvim statusline: the context metric outranks the provider in the width ladder — the provider (decoration) is sacrificed first, so the full `tokens ctx% · CH%` cluster survives down to width 45 and the provider re-joins only from width 57; the metric cluster is rendered `muted` (the same tier as the model id) instead of dim, while the extension status stays dim.

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
