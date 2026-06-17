# US-017 User Zone Style Presets

## Status

implemented

## Lane

normal

## Product Contract

Users can select a built-in user-zone presentation preset with `userZoneStyle`. The selected style applies to the BoxEditor/user input area in both normal and `fixedUserZone` modes, and also styles fixed-zone-only shell affordances when `fixedUserZone` is enabled. Users can also choose `inputBox.style` to override the active preset's input-frame treatment across presets. Theme JSON format remains unchanged: themes continue to customize colors through the existing `extras` keys and semantic theme tokens, not arbitrary layout or glyph configuration.

The supported preset set is intentionally small:

- `gemini` is the default Gemini-like status/input/footer layout. Its top status row keeps droid runtime stats without the `[stat]` or `Tokens:` labels, places compact `provider model · level` model info before the unchanged token stats with a theme-muted pipe separator, and moves git branch/status to the right. It renders an always-visible horizontal divider before the status row using the same theme border token as tool-call boxes. Its input row is borderless, keeps the droid `❯` prompt icon, and uses Gemini-style half-line background padding rather than full blank padding rows. Its footer renders dim wrapped workspace/status values without column labels and does not render sandbox or quota columns.
- `droid` remains available as the boxed legacy user-zone layout.
- `droid-cli` is a new opt-in Droid CLI-like bottom dock. It renders a true outlined input box with `›` prompt and empty-input placeholder, then one split status row: dynamic `Model`/`Ctx`/branch/project metadata on the left and MCP/footer status on the right. It intentionally avoids changing existing `gemini` or `droid` behavior.

`inputBox.style` supports `auto`, `halfblock`, `line`, and `solid`. The default `auto` keeps each preset's default input-frame behavior; for the Gemini preset, that means half-block padding normally and a line frame when `NO_COLOR` is set. Explicit `line` renders the Gemini line frame for `gemini`, while `droid` treats `line` as its native boxed/default input presentation rather than adding a separate Gemini-style line frame. The `droid-cli` preset always keeps its outline frame so an existing `line` override cannot collapse it into top/bottom-only borders. Explicit `solid` renders selected-background input plus a bottom padding row without half-block glyphs for terminal renderers that show seams around `▀`/`▄`.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`
- `docs/stories/US-005-fixed-user-zone.md`
- `docs/stories/US-016-theme-extra-token-colors.md`

## Acceptance Criteria

- `userZoneStyle` defaults to `"gemini"` when missing and is scaffolded in `~/.pi/agent/pi-droid-styling.json`; invalid/non-string values fall back to `"droid"` as the safe legacy layout.
- Supported styles are the code-defined preset set `droid`, `gemini`, and `droid-cli`; invalid or non-string values normalize to `droid`.
- The `droid` style preserves the existing BoxEditor/user zone layout and fixed-zone shell affordances when selected explicitly or used as the invalid-value fallback.
- The `droid-cli` style renders a Droid CLI-like normal-mode prompt dock with a true outlined prompt box, `›` prompt glyph, placeholder text for empty input, and a split status row with dynamic model/context/branch/project metadata on the left and MCP/footer status on the right while leaving the default `gemini` and legacy `droid` layouts untouched.
- `inputBox.style` defaults to `"auto"`, is scaffolded/backfilled under `inputBox`, accepts only `auto`, `halfblock`, `line`, and `solid`, and invalid values normalize/backfill to `auto`.
- Explicit `inputBox.style` values apply to the active preset instead of being Gemini-only; `auto` keeps the active preset default, `line` keeps droid's native/default input presentation, and `droid-cli` keeps its outline box regardless of a legacy `line` override.
- The `gemini` style changes user-zone presentation in normal mode because BoxEditor consumes the resolved style directly.
- The `gemini` style renders a top status row without `[stat]` or `Tokens:`, places compact `provider model · level` model info before the unchanged token stats with a theme-muted pipe separator, puts git branch/status on the right of that row, renders an always-visible divider before the status row using the same theme border token as tool-call boxes, keeps a borderless `❯` input row with Gemini-style half-line background padding and without full blank padding rows, and renders dim wrapped workspace/status footer values without column labels.
- The `gemini` style does not render sandbox or quota columns.
- When `fixedUserZone` is enabled, the same resolved style is also passed into fixed-zone composition for visual shell affordances such as scroll hints and scrollbar visibility/colors; gemini scroll hints are right-aligned on the footer/status row instead of the input row.
- Theme format does not change; colors continue to come from the active Pi theme and existing theme extras/semantic tokens.
- `index.ts` remains lifecycle wiring only: it loads config, resolves one style object, and passes it into editor/fixed-zone installers.

## Design Notes

- Commands: `npm run test:user-zone-style`.
- Queries: semantic search for config, BoxEditor constructor/render flow, fixed-zone compositor options, and working loader ownership.
- API: `userZoneStyle`; built-in style names are code-defined. `inputBox.style` is a generic preset override for the input frame only.
- Tables: none.
- Domain rules: `fixedUserZone` remains terminal scroll isolation; `userZoneStyle` is visual presentation; theme extras remain skin/colors.
- UI surfaces: BoxEditor input/status/footer area in all modes, fixed-zone footer/status scroll hint and scrollbar affordances when fixed mode is active.
- Loader row ownership stays with Pi/working-message UI; the gemini preset keeps its divider inside BoxEditor without loader-state wiring.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused smoke for default gemini scaffold, valid gemini and droid-cli preservation, invalid droid fallback/backfill, `inputBox.style` scaffold/backfill, style resolver identity, BoxEditor droid/gemini/droid-cli render markers and omissions, explicit gemini line-frame override, droid native line semantics, droid halfblock override, and fixed-zone style options. |
| Integration | Focused TypeScript compile for config, user-zone style module, BoxEditor, fixed-zone installer/compositor, and index; `git diff --check`; semantic review. |
| E2E | Manual Pi smoke recommended for both presets in fixed and non-fixed modes. |
| Platform | Terminal visual/manual smoke still recommended because fixed-zone shell uses compositor painting. |
| Release | Harness trace records changed files and verification. |

## Harness Delta

US-017 now documents the opt-in `droid-cli` preset alongside the existing `droid` and `gemini` presets, plus reusable `npm run test:user-zone-style` smoke coverage for future style-preset changes.

## Evidence

- `npm run test:user-zone-style` passed: focused TypeScript compile, default gemini scaffold/backfill, valid `gemini` and `droid-cli` preservation, invalid/non-string droid fallback, inherited-key guard, style resolver checks, BoxEditor render smoke for `droid`/`gemini`/`droid-cli`, compact gemini model visual, Droid CLI outline input and split status-row markers, existing `inputBox.style: "line"` override guard, unchanged token stat formatting, always-visible tool-border-colored divider behavior, gemini branch/status/input/footer markers, sandbox/quota omissions, and fixed-zone scrollbar/footer-hint affordance smoke.
- `npm run test:working-message` passed after the config/style surface changed.
- `npm run test:theme-extras` passed to confirm existing theme extras/color format remains valid.
- `npm run test:startup-resources` passed.
- `git diff --check` passed.
- `srcwalk review --limit 10` passed for the working tree evidence packet.
