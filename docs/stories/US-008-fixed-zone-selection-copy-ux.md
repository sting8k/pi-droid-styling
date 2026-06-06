# US-008 Fixed Zone Selection Copy UX

## Status

implemented

## Lane

normal

## Product Contract

When `fixedUserZone` is enabled, mouse selection in the fixed-zone scrollable/root, fixed user zone cluster, and sidebar regions should feel closer to native chat selection: drag selects a range, double-click selects a visual word, triple-click selects a visual line, release copies the selected text, and the highlight clears after copy with user-visible feedback.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`
- `docs/stories/US-005-fixed-user-zone.md`

## Acceptance Criteria

- Selection state and text/highlight helpers live in a dedicated fixed-zone selection module instead of being embedded in `terminal-split.ts`.
- Existing drag-to-copy behavior remains scoped to the clicked root/sidebar/fixed cluster region.
- Releasing a non-empty selection copies it, emits an OSC 52 clipboard sequence for terminal proxies such as jump, clears the highlight, and emits fixed-zone-local copied feedback.
- Double-click selects the visual word under the pointer before release-copy.
- Triple-click selects the visual line under the pointer before release-copy.
- Root/sidebar/fixed cluster boundaries and existing scroll/sidebar behavior remain unchanged.

## Design Notes

- Commands: none user-facing.
- Queries: none.
- API: extends fixed-zone internal selection behavior; clipboard still uses Pi core `copyToClipboard` and emits best-effort OSC 52 through the active terminal so browser/terminal proxies can receive selection copies.
- Tables: none.
- Domain rules: selection works over rendered visual lines, not raw logical message content.
- UI surfaces: fixed user zone scrollable root, fixed editor/user zone cluster, optional right sidebar, fixed-zone-local notice footer feedback.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused selection module smoke or TypeScript compile proof for word/line/range helpers. |
| Integration | `git diff --check`, scoped/full TypeScript no-emit, `srcwalk review` of changed fixed-zone files. |
| E2E | Manual Pi smoke still required: drag, double-click word, triple-click line, sidebar selection, release-copy notification. |
| Platform | Terminal mouse packet behavior should be manually checked in target terminal. |
| Release | Harness matrix/story evidence updated after validation. |

## Harness Delta

No harness policy change expected. This story records a normal-lane UX refinement with weak automated terminal proof.

## Evidence

- `git diff --check`: passed.
- New-file whitespace check for `fixed-zone/selection.ts`: passed via `git diff --no-index --check /dev/null fixed-zone/selection.ts`.
- Scoped TypeScript no-emit: `npm exec tsc -- --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --strict false --allowJs false index.ts fixed-zone/install.ts fixed-zone/terminal-split.ts fixed-zone/selection.ts` passed.
- Focused selection runtime smoke: drag range, double-click word, triple-click line, and empty-space word miss passed (`selection smoke ok`).
- Fixed cluster selection regression smoke: `npm run test:user-zone-style` passed with cluster drag highlight, release-copy, terminal-scoped OSC 52 coverage, long root selection release inside the fixed cluster, and auto-scroll smoke.
- `npm run profile:render`: passed.
- OSC 52 terminal-proxy patch validation: `srcwalk review --scope .`, scoped TypeScript no-emit for `index.ts fixed-zone/install.ts fixed-zone/terminal-split.ts fixed-zone/selection.ts`, `git diff --check`, and `PI_DROID_PROFILE_BENCH_ROOT_LINES=6000 PI_DROID_PROFILE_BENCH_ITERATIONS=30 npm run profile:render` passed.
- Release-copy transport fix: selection copy now emits terminal-scoped OSC 52 after host `copyToClipboard()` succeeds, because Pi/core clipboard fallback can resolve after writing OSC 52 to `process.stdout` instead of the active terminal stream.
- Long-selection release fix: active selections now clamp drag/release mouse points to the anchor region, so releasing a root selection inside the fixed user cluster still finishes and copies the root range.
- Selection auto-scroll: dragging past the root viewport top/bottom edge triggers a timer that scrolls the viewport at 40ms intervals with speed proportional to overshoot (1-4 lines per tick), updating selection focus to the scroll boundary and preserving the existing copy-on-release flow.
- `semantic_review` working tree: passed for changed files.
- Manual Pi smoke still pending for real terminal mouse packets, jump/browser OSC 52 clipboard propagation, and notification UX.
