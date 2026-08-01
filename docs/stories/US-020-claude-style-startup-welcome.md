# US-020 Claude-style Startup Welcome

## Status

completed

## Lane

normal

## Product Contract

New Pi sessions show the PR's rounded, theme-aware welcome banner with live model/cwd, Tips, Context, and What's new content. Resumed sessions do not inject the banner. The full nine-line Pi mark uses the upstream theme-derived gradient inside the banner without restoring the superseded standalone startup header.

## Relevant Product Docs

- `docs/product/overview.md`
- `README.md`

## Acceptance Criteria

- The rounded two-column/stacked welcome layout from PR #17 remains intact.
- The full nine-line logo uses a gradient derived from the active accent color.
- Logo rows are centered as one block and retain a shared left edge so connected glyphs do not drift.
- Every rendered line stays within narrow and wide terminal widths.
- Resumed sessions skip the welcome banner.
- Reload-safe patch keys and true-original restoration behavior remain unchanged.

## Design Notes

- UI surface: `startup-ui.ts`
- Shared color conversion: `theme/ansi.ts`
- The standalone upstream gradient header is intentionally not restored because PR #17 places its full Pi glyph inside the richer in-chat welcome.
- Multi-line glyph centering uses the maximum logo-row width rather than centering each row independently.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `npm run test:startup-resources` |
| Integration | Not available |
| E2E | Manual Pi startup smoke when available |
| Platform | Width checks at 12, 24, 40, and 96 columns plus shared logo-row left-edge proof in the smoke script |
| Release | `srcwalk review` and relative import-resolution check |

## Harness Delta

Added this story because the conflict resolution combines an upstream visual update with existing PR behavior. The local Harness CLI binary is unavailable in this checkout, so the durable matrix could not be updated.

## Evidence

- PR: https://github.com/sting8k/pi-droid-styling/pull/17
- `node.exe scripts/startup-resources-smoke.mjs` passed, including gradient, shared logo-row alignment, resumed-session, and 12/24/40/96-column checks.
- All existing focused smoke scripts passed.
- `srcwalk review upstream/main..HEAD` and the relative `.js` import-resolution check passed.
