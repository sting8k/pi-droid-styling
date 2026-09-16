# Changelog

## 2.14.2 - 2026-09-15

### Fixed
- Script-mode `edit` results now render line numbers in the split-diff gutter. `buildSplitRows` seeds its old/new line cursors from `@@ -a,b +c,d @@` hunk headers — which `stripPatchHeaders` no longer removes — so multi-hunk and multi-file unified patches number every hunk correctly. Unified-mode lines also skip inline-gutter parsing, so added lines starting with digits keep their content, and `---`/`+++` header stripping now requires the trailing space real file headers have. Core edit and quick-edit diffs are unchanged.

## 2.14.1 - 2026-09-15

### Fixed
- The `edit` tool tag now renders script-mode edit calls (pi-utils US-003), which send `paths` + optional `lang` instead of a single `path`: the label shows `Paths: a.ts, b.ts` (or `N paths`) with the language hint instead of `(unknown)`. Script-mode results carry a unified `details.patch`, whose `---`/`+++`/`@@` headers are stripped before diff parsing so they are no longer misread as changed lines. Default (core) edit rendering is unchanged.


## 2.14.0 - 2026-09-15

### Added
- New `transparentBackground` config (default `false`). When enabled the extension stops painting the page/frame background and no longer claims OSC 11 — it emits an OSC 111 reset instead — so the terminal's own default background (Ghostty `background-image`, kitty `background_image`, WezTerm `window_background_image`, acrylic/blur) shows through. Tool boxes, sent user messages, boxed core message blocks, and the editor input box (including halfblock `▄▀` edge bars, blanked while preserving row count and width) render without fills on every `userZoneStyle` preset. Real selections and diff accents stay opaque. The flag hot-reloads from `~/.pi/agent/pi-droid-styling.json`; turning it back off needs a session restart for OSC 11 to be re-applied. Dim/blur is tuned on the terminal side.

## 2.13.1 - 2026-09-15

### Fixed
- Builtin tool styling no longer re-registers `read`/`write`/`ls`/`find`/`grep`/`bash` under builtin names (issue #24). Renderers are attached at the ToolExecutionComponent layer by tool name, so same-name tools from other packages (pi-utils shell-bg `bash`, fs-search `grep`, …) are no longer shadowed regardless of package order. `edit` still registers as the pi-ctx-kit enhanced-edit bridge. Tool-call elapsed metrics now come from component/renderer state and `tool_execution_start`/`tool_execution_end` events instead of an execute wrapper.

## 2.13.0 - 2026-09-10

### Added
- Collapsed thinking rows (`Ctrl+T`) now show a live peek at the end of the last thinking line instead of a static label: `Thinking ▸ …tail` while the model is thinking, `Thinking · …tail` once the run settles. One row, fills the terminal width, left-truncated; the label is Pi's own `hiddenThinkingLabel` with its trailing dots trimmed, bold and upright; marker and tail use the new `collapsedThinkingTailColor` theme extra (default `muted`) and are never italic. New config `collapsedThinking: "tail" | "label"` (default `tail`); `label` restores the previous static row byte-for-byte.

### Fixed
- The 33 ms streaming presentation buffer never engaged during real assistant streams, because Pi's partial messages already carry `stopReason: "stop"`. Streaming is now tracked by the extension itself, so large deltas are drip-fed as designed and the finished-render cache stays out of the way while a message streams.

## 2.12.2 - 2026-09-08

### Fixed
- Selecting a bundled companion theme (for example `amber-pyre`) without a standalone `pi-themes` install no longer shows a `Failed to load theme … Fell back to dark theme` banner at startup. Pi applies the settings theme inside `init()` before extensions can answer `resources_discover`; the transient failure for bundled theme names is now silenced during `init()` and the theme is re-applied after discovery as before. Errors for non-bundled themes still surface.

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
