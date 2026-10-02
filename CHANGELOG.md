# Changelog

## 2.16.0 - 2026-10-02

### Added
- New `diffMode` config option for `edit` and quick-edit diffs ([#31](https://github.com/sting8k/pi-droid-styling/pull/31), thanks @trireg). `split` is the existing side-by-side view, and `unified` shows one column with removed lines above added ones. The default, `auto`, uses split when the terminal is at least 140 columns wide and unified below that, and switches as soon as the terminal is resized. Narrow terminals get unified diffs after updating. Set `"diffMode": "split"` to keep the old layout.

### Changed
- Diffs mark skipped context with a `··· N unmodified lines ···` row, so two changes far apart in a file no longer look adjacent. The `...` line in Pi's own edit diff becomes this row too, instead of showing as a numbered code line.
- A removed/added line pair that shares less than 35% of its text is shown as a full rewrite, without word-level highlights.

### Fixed
- In Pi's own edit diff, line numbers on the new side no longer restart from the wrong number after skipped context.

## 2.15.1 - 2026-10-02

### Changed
- Typing no longer lags in long sessions under the reasonix layout ([#32](https://github.com/sting8k/pi-droid-styling/pull/32), thanks @trireg). Finished tool rows keep their rendered lines and only re-render when the width, error state or footer changes. Rows still running are redrawn every frame so the spinner keeps moving.

### Fixed
- Bundled companion themes no longer fail on every other `/new` or `/resume` with "Theme not found" and a fall back to `dark` ([#30](https://github.com/sting8k/pi-droid-styling/issues/30)). Pi rebuilds its theme registry for each session, but the extension skipped any theme name it saw in the previous session's registry, including the ones it had registered itself. It now skips a bundled theme only when the same name comes from another file, such as a standalone `pi-themes` install.
- Without `pi-ctx-kit`, the extension no longer registers its own copy of the `edit` tool ([#26](https://github.com/sting8k/pi-droid-styling/issues/26)). The copy behaved the same as Pi's but lost the `builtin` source, so tools that look for builtins, such as pi-subagents, dropped `edit` from child agents. Pi's own `edit` is kept and still gets the droid renderer. With `pi-ctx-kit` installed, the enhanced edit is registered as before.

## 2.15.0 - 2026-10-02

### Added
- Pi 1.0 support. The peer dependency range is now `>=0.78.0 <2.0.0` for `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.

### Changed
- On Pi 0.99 and later, the extension keeps Pi's own startup header (logo, key hints, ctrl+o for the full help) instead of replacing it with the 9-line gradient logo. Older Pi versions, which have no logo header, still get the extension's header. The loaded-resources table is unchanged.
- The npm package ships only runtime files: `package.json` now lists `files`, and the bundled `pi-themes` no longer carries its preview images. The tarball drops from 179 files (1.6MB) to 92 files (146KB).

### Fixed
- The boxed editor's host-border helper is renamed to `renderHostBorder`, so it no longer collides with the `renderTopBorder` method that Pi 1.0 added to the editor base class. The collision broke type-checking.

## 2.14.4 - 2026-09-24

### Fixed
- The render self-heal repaint skips screen rows covered by terminal images (kitty/iTerm2), which stops Pi from lagging after the agent reads an image. It used to re-send the whole image payload on almost every frame whenever the image was in the viewport, measured at about 6.7MB over 30 frames for a 400KB image, down to 93KB now. pi-tui still draws and removes the image; it is sent once.

## 2.14.3 - 2026-09-23

### Fixed
- `edit` error and no-change results render one row per output line. Multi-line output used to go into the box as a single row: the embedded newlines broke the box border and hid the cause (e.g. the stderr line of a failed script edit), even when expanded. Applies to both the boxed and reasonix presentations.
- Multi-file script-mode `edit` diffs render one split-diff per file under a `▸ path` title, highlighted with each file's own language, instead of one merged, unattributed table. Single-file diffs look the same as before.
- Script-mode `edit` diff stats count parsed rows, so content lines starting with `+++`/`---` (e.g. an added YAML `---`) are no longer skipped as file headers. Core edit stats are unchanged.

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
