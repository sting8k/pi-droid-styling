# US-022 Nvim user zone style

## Status

planned

## Lane

normal (2 risk flags: existing behavior — the cli-dock footer and editor layouts are test-covered; public contracts — `userZoneStyle` config surface gains a value). Stronger validation required.

## Product Contract

`userZoneStyle` accepts a fourth value `nvim`: Neovim chrome for the input zone, adapted to a coding agent rather than copied from an editor. It is a peer of `droid`, `gemini`, and `cli-dock` — a preset with its own layout function, not an overlay on top of theirs.

**Conversation rendering is untouched.** For the full Neovim look, pair it with `presentationStyle: "reasonix"`:

```jsonc
{ "presentationStyle": "reasonix", "userZoneStyle": "nvim" }
```

Two switches, deliberately. They are independent axes and stay independent: nvim chrome with droid conversation is a valid combination, and no value implies another. See "Why this is a user zone style, not a presentation style" below.

The preset adds three things:

1. **Statusline (the centerpiece).** One full-width bar (`selectedBg`) below the input, with a leading mode badge:
   - Badge label: `BASH` when the input starts with `!` (core rule: `text.trimStart().startsWith("!")`, derived from the editor's own `getText()`); otherwise the thinking level uppercased, taken verbatim from the value Pi reports. The levels are Pi's own six — `off`, `minimal`, `low`, `medium`, `high`, `xhigh` — and **no label may be invented for any other state**.
   - When the model reports no reasoning support, there is **no badge at all**: the bar starts with the model identity. This matches what the existing rows already do (`box-editor.ts:406`, `:656` render no level suffix in that case) and what core itself does. Gate on `!info.reasoning` so an `undefined` `reasoning` keeps behaving as it does today.
   - Bash-over-level precedence mirrors Pi core exactly, which drives one channel (`editor.borderColor`) with `isBashMode ? bashModeBorderColor : thinkingBorderColor(level)` (`interactive-mode.js:2870-2876`).
   - **One bar, and it is the only one.** `renderNvimLayout()` emits the rows it wants; there is nothing to suppress. Unlike `droid` (host border, metadata row, runtime row, divider) and `gemini` (divider, status row above, footer below), `nvim` renders the input frame and exactly one bar. Every value appears once in the zone.
   - Layout follows the Neovim convention of *mode + identity* on the left and *position* on the right, with the level next to the model it applies to:

     ```
     ▌HIGH  anthropic · claude-sonnet-4        ⎇ main · 84k/200k 42% · CH 91%
     ```

   - Rendered as bold `▌<LABEL>` at the start of the row — **leading badge only, no trailing/bookend block**. Provider and separators in `dim`, model id in `muted` so the model still leads without changing the reading order, right cluster in `dim`.
   - Model **id** is shown, not the display name: ids never contain spaces (a space would read as another field) and the id is what goes into config.
   - **Dropped from the bar on purpose**: cwd (static for a whole session and already in the shell title, unlike a Neovim file path which changes per buffer), words/sec (a diagnostic, not always-on chrome), and the branch badge's `[+n][-n]` insertion/deletion counts (churn that moves constantly and is one `git diff` away; the branch name alone is the stable orientation value).
   - **Width degradation ladder** — drop lowest value first, badge never drops:
     1. full: `▐LEVEL▌  provider · model` … `⎇ branch · tokens ctx% · CH%  status`
     2. drop CH% and the token count: `▐LEVEL▌  provider · model` … `⎇ branch · ctx%  status`
     3. drop provider and branch: `▐LEVEL▌ model` … `ctx%  status`
     4. badge plus model only.
     The ladder drops **chrome** segments only. The extension status is never dropped by the ladder — it is truncated with `…` as the last step, matching `renderGeminiFooter`, so another extension's output degrades gracefully instead of disappearing. Verified to fit exactly at widths 100 / 80 / 60 / 44 / 32.
   - **The block is coloured by mode, not by thinking level** — the same rule Neovim's mode block follows. Pi has exactly one real mode switch, bash versus normal, and core itself splits on precisely that when colouring its editor border (`isBashMode ? getBashModeBorderColor() : getThinkingBorderColor(level)`, `interactive-mode.js:2871`, `:2875`). So the badge needs two colours, one per mode:

     | State | Source |
     | --- | --- |
     | normal input | the `accent` token |
     | bash mode | `theme.getBashModeBorderColor()` (the `bashMode` token) |
     | no reasoning support | no badge rendered |

     Probe the theme object for the function rather than assuming which constructor argument carries it (`BoxEditor` receives both `theme` and `uiTheme`), and fall back to leaving the badge uncoloured if neither provides it. The thinking level is carried by the **label text only**; there is no level→colour mapping anywhere in this feature.

   - **Why not the `thinking*` tokens.** They were tried first and rejected on evidence. Those tokens exist to tint a **thin border line**, so every theme keeps them deliberately desaturated; filled into a solid block they render as a muddy slab (average chroma 8 against `accent`'s 48). They also carry less information than expected: every theme collapses `thinkingMinimal` through `thinkingXhigh` to one colour, distinct only from `thinkingOff`, so they never distinguished the six levels anyway.
   - **How the token was chosen.** Reverse video fixes the label colour to whatever the row background is (`selectedBg`), so the contrast between the block token and `selectedBg` is not a matter of taste — it decides whether the label is **readable**. Every candidate token in all 26 companion themes was scored on three measurable criteria: label contrast ≥ 3:1 (the WCAG threshold for bold UI text), perceptual distance from `bashMode` (ΔE ≥ 15, so the mode switch is always visible), and chroma (a desaturated fill reads as a smudge, not a block).

     | token | readable ≥ 3:1 | differs from `bashMode` | chroma |
     | --- | --- | --- | --- |
     | **`syntaxNumber`** | **25/26** | **26/26** | **46** |
     | `warning` | 24/26 | 26/26 | 46 |
     | `syntaxType` | 24/26 | 26/26 | 44 |
     | `syntaxKeyword` | 23/26 | 26/26 | 47 |
     | `accent` | 24/26 | 21/26 | 48 |

     `syntaxNumber` scores highest on those three columns and was trialled. **It was rejected on sight.** Being a syntax token, it lands wherever a theme happens to put numeric literals — warm orange in `tokyo-dark`, plum in `gruvbox-light` — which made the badge read as a foreign sticker pasted onto the bar rather than as part of the theme's chrome. The measurements were sound; they simply did not capture *belonging*, which turned out to be the property that mattered.

     `accent` is the chosen token. It is the theme's designated general-purpose highlight, which makes it the only candidate whose coupling is **meaningful rather than arbitrary**: a theme author retuning `accent` intends every highlighted chrome element to move with it, the badge included. It scores 24/26 on readability and 48 on chroma — within noise of the leaders — and loses only on `bashMode` distinctness.
   - **Accepted costs, stated plainly.** Cycling the thinking level no longer changes the badge colour, only its label — correct, because a level is a *setting*, and Neovim does not recolour its mode block for settings either. And `accent` is **identical to `bashMode` in 5 of 26 themes** (`everforest`, `everforest-deep`, `gruvbox-light`, `neapple-light`, `qoder`): entering bash mode there changes the label from a level to `BASH`, but not the colour. Accepted, because the label is the authoritative signal and colour only reinforces it — the same rule that governs every other decision in this feature. Do **not** special-case those themes and do **not** synthesize a colour outside the palette; a per-theme override table is exactly the kind of hardcoding this story spent its refactor budget removing. If the lost colour channel ever matters enough, the clean fix is a dedicated statusline-mode token in `pi-themes`, not a workaround here.
   - **Badge shape: a solid block**, ` LABEL ` rendered with reverse video so the theme colour becomes the block and the bar background becomes the text — the lualine mode block, built from theme tokens with no colour invented. Toggle reverse with `\x1b[7m` … `\x1b[27m`; **never emit a full `\x1b[0m` reset inside the bar**, which would clear the row's background for everything after the badge.
   - **Move, do not duplicate**: the level is already appended to the model segment in the other layouts — `" (high)"` in droid/gemini (`box-editor.ts:406`) and `" · high"` in cli-dock (`:656`). In `nvim` it lives in the badge and the suffix is not rendered.
   - **Extension statuses sit at the far right of the bar, on the same row.** This extension patches core's `FooterComponent` to render nothing (`footer-patch.ts` returns `[]`) and re-renders the captured statuses only through `getFooterStatus()`, whose only call sites are the three layout rows (`box-editor.ts:575`, `:667`, `:712`). A new layout that never calls it makes every *other* extension's status vanish silently.
     Follow the convention the other presets already established rather than inventing a placement: both `cli-dock` (`:704`) and `gemini` (`:712`) build their right cluster as `[tokenUsage, footerStatus].filter(Boolean).join("  ")` — status **outermost right**, two spaces of separation — and both **truncate** the cluster instead of ever wrapping it onto another line. `renderNvimLayout()` does the same: the status is appended after `CH%` and the combined right cluster is truncated with `…` if it still overflows. A second row is wrong; the bar stays exactly one row.
   - No new data sources: `thinkingLevel` already flows `pi.getThinkingLevel()` → `currentThinkingLevel` (`index.ts:81`, `:114`, `:188`) → `BoxEditor` model info (`index.ts:289`); branch, tokens, and context % are already rendered by the other layouts.

2. **Input frame `line`.** The rule-above/rule-below frame instead of a full outline box — the shape that reads as a Neovim window. The renderer already exists (`box-editor.ts:621`); the preset just sets `inputFrame: "line"`. An explicit `inputBoxStyle` in user config still wins, exactly as it does for every other preset. The two preset-name overrides at the end of `resolveInputFrame()` key on `cli-dock` and `droid`, so they do not affect `nvim` and are left alone (see Design Notes).

3. **Empty-input placeholder.** When the buffer is empty the input row shows a dim hint that disappears on the first keystroke. The behaviour already exists (`box-editor.ts:793-797`, gated on `text.length === 0`, truncation already handled) but is hardcoded to `editorStyle.layout === "cli-dock"` together with its literal string. Lift it into a style property (`editor.placeholder?: string`) so the name check disappears:
   - `cli-dock` keeps `" Type a prompt or / for commands"` byte-identical; `droid` and `gemini` keep no placeholder.
   - `nvim` uses `"Type a prompt  ·  / commands  ·  ! bash"` — **no leading spaces**. The prompt gap and the empty-buffer cursor cell already supply the separation; measured against a real render, a zero-lead string puts the text exactly where `cli-dock`'s shipping placeholder sits today, while a two-space lead pushes it two columns further out. The `!` hint earns its width because it is the key that flips the badge to `BASH`, so the chrome teaches its own affordance; `!` is a documented core key hint (`interactive-mode.js:450`).

All colours come from active theme tokens. No hardcoded hex, no emoji, and no nerd-font/powerline glyphs — only plain unicode (`▌`, `─`, `·`) that renders in any terminal, plus `⎇` which the existing branch badge already uses.

### Why this is a user zone style, not a presentation style

The first draft of this story made `nvim` a `presentationStyle` and reached into the editor through a `Partial<UserZoneEditorStyle>` merge layer. That was the wrong axis, and it was discovered by asking a simple question: what does `nvim` actually change in the conversation?

**Nothing.** The draft's headline conversation feature was line numbers in tool bodies — but `tool-tags/read.ts:185` already draws a `N │ ` gutter with **real file line numbers** for every presentation style today, and `split-diff.ts:404+` does the same for quick-edit diffs. The only bodies left unnumbered are shell outputs (bash, grep, ls), where numbers would be a meaningless 1..N counter — the same decorative-noise failure as the rejected tilde filler, plus a second number column stacked on Read's existing gutter.

With that dropped, the conversation delta against `reasonix` is zero and every remaining change lives in the user zone. Putting it on the axis that owns it deletes, rather than solves, four problems the draft had to handle:

| Draft problem | On the correct axis |
| --- | --- |
| `editorChrome` merge layer and its precedence chain | Not needed — `nvim` is a peer preset |
| Enumerating which rows to suppress per preset | Nothing to suppress — `nvim` renders its own rows |
| `renderGeminiFooter` (`:757`) has no visibility flag | Not touched |
| A `line` frame colliding with droid's divider (double rule) | Cannot happen |

`UserZoneEditorStyle` already carries every field required (`layout`, `prompt`, `showHostBorder`, `showMetadataRow`, `showRuntimeRow`, `showDivider`, `showTrailingBlankLine`, `inputFrame`, colours), and presets are already pure data in `USER_ZONE_STYLES`. Adding `nvim` is filling in a table, plus one layout function beside `renderDroidLayout()` and `renderGeminiLayout()`.

The cost is that the full look needs two config values. That is the honest shape: they are two independent choices, and one silently implying the other would be a hidden rule for no real gain.

### Verified render

Real render output (Pi core components + real `BoxEditor`, theme `tokyo-dark`), showing the empty-buffer placeholder:

```
─────────────────────────────────────────────────────────────────────────────
 ❯  Type a prompt  ·  / commands  ·  ! bash
─────────────────────────────────────────────────────────────────────────────
▌HIGH  anthropic · claude-sonnet-4        ⎇ main · 84k/200k 42% · CH 91%
```

The same zone after the first keystroke (placeholder gone, no other row changes):

```
─────────────────────────────────────────────────────────────────────────────
 ❯  sửa giúp tao file config
─────────────────────────────────────────────────────────────────────────────
▌HIGH  anthropic · claude-sonnet-4        ⎇ main · 84k/200k 42% · CH 91%
```

## Relevant Product Docs

- `docs/product/overview.md` (`userZoneStyle` section)
- `README.md` (config table)
- `docs/ARCHITECTURE.md` (user-zone/ and editor/ boundaries; footer ownership)
- `docs/TEST_MATRIX.md` (US-020 user-zone row is the template for the new US-022 row)

## Acceptance Criteria

- `userZoneStyle: "nvim"` validates, persists, survives session reload; unknown values still fall back to `droid` with the raw string preserved on disk (existing forward-compat behaviour untouched).
- `droid`, `gemini`, and `cli-dock` render byte-identically to today — rows, footer, frame, placeholder, and model badge.
- Presentation rendering (prose, markers, tool call rows, tool bodies) is **completely untouched** by this story under every `presentationStyle`.
- Statusline: exactly one chrome bar in the zone, with no value (provider, model, level, branch, tokens, context %, CH%) rendered twice.
- Extension statuses published by other extensions still reach the screen: appended to the far right of the bar after `CH%`, separated by two spaces, on the same single row. The zone never grows a second status row, and a long status is truncated with `…` rather than dropped or wrapped.
- Badge: a single leading reverse-video block shows the thinking level verbatim (or `BASH` while the input starts with `!`), its label updating when the level is cycled and its colour switching between the `accent` and `bashMode` tokens as the `!` prefix is gained or lost. No level→colour mapping exists. No trailing badge. For a model without reasoning support (including `reasoning: undefined`) there is **no badge and no invented label** — the bar starts with the model identity. No label outside Pi's own six levels plus `BASH` appears anywhere.
- Bar layout: the badge block then `provider · model` on the left (provider `dim`, separator `dim`, model id `muted`), `⎇ branch · tokens ctx% · CH%` then any extension status right-aligned; `·` is the single separator used across the whole bar, and the wide gap — not a second glyph — divides the clusters. cwd, words/sec, and `[+n][-n]` are not on the bar. The degradation ladder is applied in order and the rendered row occupies the full terminal width exactly (verified at 100 / 80 / 60 / 44 / 32).
- Input frame: `nvim` resolves to `line`; an explicit `inputBoxStyle` still wins; frame resolution for the other three presets is byte-identical to today for every `inputBoxStyle` value (`auto`, `line`, `solid`, `halfblock`, `none`, `outline`).
- Placeholder: shown only while the buffer is empty and gone on the first keystroke; truncates instead of overflowing at narrow widths; supplied by style data with no layout-name check left in `render()`; `cli-dock` output stays byte-identical and `droid`/`gemini` still show none.
- No emoji and no nerd-font/powerline glyphs anywhere in the new chrome; only `─`, `·`, the existing `⎇`, and reverse-video for the badge block.

## Design Notes

- Phase 1 — data and config. Add `nvim` to `USER_ZONE_STYLE_NAMES` and `USER_ZONE_STYLES` (`user-zone/designs.ts`), widen `UserZoneEditorStyle["layout"]`, add the optional `placeholder` field, and move the cli-dock placeholder literal out of `render()` into preset data. Config validation, backfill, and fallback follow the existing `userZoneStyle` path (`config.ts:159-167`). **Gate: all existing smokes pass unchanged** — this phase must be invisible to the other three presets.
- Phase 2 — `renderNvimLayout()` beside `renderDroidLayout()`/`renderGeminiLayout()`, wired into the layout dispatch map (`box-editor.ts:808`). Emits: input frame, statusline bar, and the extension-status row when non-empty. Both badge inputs are already inside `BoxEditor` — `thinkingLevel`/`reasoning` from the model info provider and buffer text from `getText()` (`box-editor.ts:775`) — so no new state tracker and no new patch surface.
- Agent activity (`WorkingLoaderState`) is deliberately **not** in the badge: the working message above the input already renders it, and repeating it would be pure noise.
- Phase 3 — validation (smokes below) and docs (product overview, README table, TEST_MATRIX row, ARCHITECTURE if boundary descriptions change). While editing the README config table, close the pre-existing gap in the `inputBox.style` row, which omits `outline` and `none` even though `resolveInputFrame()` accepts both.
- **Left alone on purpose**: the two preset-name overrides at the end of `resolveInputFrame()` (`cli-dock` → `outline`; `droid` + `line` → `none`). They are a real smell — name checks that should be preset data, and the droid one blocks only `line` while letting `solid`/`halfblock` through — but they key on other presets and cannot affect `nvim`. Fixing them here would be an unrelated refactor. Worth a separate story.
- Commands/Queries/API/Tables: n/a (rendering-only).
- UI surfaces: user zone (input frame + status rows). No conversation surfaces.

## Non-goals

- **Line numbers in tool bodies.** Already implemented where it matters: `read.ts:185` draws real file line numbers, `split-diff.ts:404+` numbers quick-edit diffs, both for every presentation style. The only remaining bodies are shell outputs where a 1..N counter carries no meaning, and adding an outer gutter there would stack a second number column on Read's existing one.
- **Tilde (`~`) filler between turns.** Evaluated against real multi-turn output: it fires once per block, so a normal conversation becomes a column of decorative tildes, and it is not what Neovim does (Neovim shows `~` only past end-of-buffer, never between content). Dropped.
- Agent activity in the badge: already shown by the working message above the input.
- Input cursor `line:col` ruler: the chat input is usually one line, so it would read `1:x` almost always.
- Eol markers (`¬`), relative numbering, cursorline/git-blame virtual text.
- New footer data sources (git status polling, diagnostics counts) — the bar only restyles values the zone already shows.
- Any new colour/theme JSON — this is a chrome preset, not a colorscheme.
- Auto-pairing `userZoneStyle: "nvim"` with a presentation style. The axes stay independent.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | New `scripts/nvim-user-zone-smoke.mjs` (mirror `user-zone-style-smoke.mjs`): config validation/fallback/backfill; statusline badge label per level + `BASH` prefix + **no badge and no invented label** for a non-reasoning model (including `reasoning: undefined`); badge colour is the `accent` token in normal input and `bashMode` under a `!` prefix, identical across all six levels, with no level→colour table anywhere; the badge emits no full `\x1b[0m` reset, so the bar background survives to the end of the row; leading badge only; exact row width and the degradation ladder at 100/80/60/44/32; exactly one chrome bar with zero duplicated values; a non-empty extension status renders on the **same row**, outermost right, and the zone height does not change when a status appears; a status longer than the free space is truncated with `…` rather than dropped or wrapped; input frame resolves to `line` while an explicit `inputBoxStyle` still wins; placeholder present when empty and gone after one keystroke; every companion theme in `../pi-themes/themes` resolves the tokens used by the chrome, including `accent` and `bashMode`; no emoji or nerd-font glyph in any rendered row. Wire as `test:nvim-user-zone` into `npm test`. |
| Integration | `test:user-zone-style` and the footer smoke pass unchanged: `droid`/`gemini`/`cli-dock` byte-identical, including the cli-dock placeholder after it moves into preset data. `test:session-resume-styling` extended: `userZoneStyle: "nvim"` survives reload. Presentation smokes (`test:reasonix-conversation`) must be untouched by this story. |
| E2E | Manual Pi smoke in Ghostty/kitty/iTerm2: nvim zone with level cycling, `!` bash prefix toggling, narrow terminal, theme switch across 2+ companion themes, and a second extension publishing a status line. |
| Platform | n/a |
| Release | Full `npm run check` green; `git diff --check`; CHANGELOG entry; version bump per repo release flow. |

## Harness Delta

Story recorded via `scripts/bin/harness-cli story add` (US-022); title and scope updated when the axis changed. Update proof status via `story update` as evidence lands.

## Evidence

Design validated before implementation with a throwaway real-render harness (`/tmp/nvim-real-preview.mjs`): compiles the extension with `tsc`, loads real Pi core message components, and instantiates the real `BoxEditor` headless (the stub TUI needs only `terminal.rows`; `editor.borderColor` must be assigned a colorizer exactly as core does at `interactive-mode.js:2874`).

Findings that changed the design, in order:
1. The tilde option was disproved on real multi-turn output.
2. The real editor rows already render the thinking level, which turned the badge from "new information" into "moved information".
3. Peer review found that removing editor rows would silently delete other extensions' status lines (`footer-patch.ts` → `[]`, `getFooterStatus()` at `box-editor.ts:575`/`:667`/`:712`).
4. `read.ts:185` and `split-diff.ts:404+` already render real file line numbers, which removed the story's only conversation-side feature and moved the whole story from `presentationStyle` to `userZoneStyle`.

A contrast measurement (`dim` on `selectedBg` below 3:1 in 16 of 26 themes) was discarded as unsound: pi-themes declares no page-background token at all (42 colour keys, no `background`), so the ratio had no baseline to be compared against.

If implementation starts, promote the harness to a proper `scripts/` preview or fold its cases into the smoke.

Add validation evidence after implementation.
