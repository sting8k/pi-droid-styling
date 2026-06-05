# US-017 User Zone Style Presets

## Status

implemented

## Lane

normal

## Product Contract

Users can select a built-in user-zone presentation preset with `userZoneStyle`. The selected style applies to the BoxEditor/user input area in both normal and `fixedUserZone` modes, and also styles fixed-zone-only shell affordances when `fixedUserZone` is enabled. Theme JSON format remains unchanged: themes continue to customize colors through the existing `extras` keys and semantic theme tokens, not arbitrary layout or glyph configuration.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`
- `docs/stories/US-005-fixed-user-zone.md`
- `docs/stories/US-016-theme-extra-token-colors.md`

## Acceptance Criteria

- `userZoneStyle` defaults to `"droid"` and is scaffolded/backfilled in `~/.pi/agent/pi-droid-styling.json`.
- Supported styles are a small code-defined preset set rather than independent layout booleans.
- Invalid or non-string `userZoneStyle` values normalize to the default style.
- The default `droid` style preserves the existing BoxEditor/user zone layout and fixed-zone shell affordances.
- Non-default styles change user-zone presentation in normal mode because BoxEditor consumes the resolved style directly.
- When `fixedUserZone` is enabled, the same resolved style is also passed into fixed-zone composition for visual shell affordances such as scroll hints and scrollbar visibility/colors.
- Theme format does not change; colors continue to come from the active Pi theme and existing theme extras/semantic tokens.
- `index.ts` remains lifecycle wiring only: it loads config, resolves one style object, and passes it into editor/fixed-zone installers.

## Design Notes

- Commands: `npm run test:user-zone-style`.
- Queries: semantic search for config, BoxEditor constructor/render flow, and fixed-zone compositor options.
- API: new user config key `userZoneStyle`; built-in style names are code-defined.
- Tables: none.
- Domain rules: `fixedUserZone` remains terminal scroll isolation; `userZoneStyle` is visual presentation; theme extras remain skin/colors.
- UI surfaces: BoxEditor input/status area in all modes, fixed-zone scroll hint and scrollbar affordances when fixed mode is active.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused smoke for default scaffold, valid style preservation, invalid fallback/backfill, style resolver identity, BoxEditor render row differences, and fixed-zone style options. |
| Integration | Focused TypeScript compile for config, user-zone style module, BoxEditor, fixed-zone installer/compositor, and index; `git diff --check`; semantic review. |
| E2E | Manual Pi smoke recommended for all presets in fixed and non-fixed modes. |
| Platform | Terminal visual/manual smoke still recommended because fixed-zone shell uses compositor painting. |
| Release | Harness trace records changed files and verification. |

## Harness Delta

Added US-017 normal-lane story and reusable `npm run test:user-zone-style` smoke coverage for future style-preset changes.

## Evidence

- `npm run test:user-zone-style` passed: focused TypeScript compile, default scaffold/backfill, valid style preservation, invalid/non-string fallback, inherited-key guard, style resolver checks, BoxEditor row-shape smoke for `droid`/`compact`/`minimal`, and fixed-zone scrollbar style smoke.
- `npm run test:working-message` passed after config surface changed.
- `npm run test:theme-extras` passed to confirm existing theme extras/color format remains valid.
- `PI_DROID_PROFILE_BENCH_ITERATIONS=20 PI_DROID_PROFILE_BENCH_ROOT_LINES=120 npm run profile:render` passed.
- `git diff --check` passed.
- `semantic_review` passed for the working tree.
