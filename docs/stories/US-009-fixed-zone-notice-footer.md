# US-009 Fixed Zone Notice Footer

## Status

implemented

## Lane

normal

## Product Contract

When `fixedUserZone` is enabled, transient user feedback should render in a fixed-zone-local bottom footer row using the active Pi theme. The footer should support generic notices, with a full-row themed background plus a prominent inverse semantic label similar to pi-charm status feedback, and copy-selection feedback should use this surface instead of host `sessionUi.notify`.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`
- `docs/stories/US-008-fixed-zone-selection-copy-ux.md`

## Acceptance Criteria

- The fixed user zone reserves one bottom footer row for notices so layout does not jump when a notice appears or clears.
- The footer replaces a trailing fixed-zone spacer line when one exists, avoiding an extra blank line below the input field.
- Notices render as part of normal fixed-zone composition, not as terminal overlay writes.
- Notice visuals use the active Pi theme, including a full-row background and a prominent inverse semantic label using success/accent/warning/error colors.
- The notice surface is generic (`info`, `success`, `warning`, `error`) and not hard-coded only for clipboard copy.
- Selection copy success uses `Selected text copied to clipboard`; copy failure uses a warning notice.
- Existing selection, OSC 52 fallback, sidebar, scroll, and fixed-zone dispose behavior remain unchanged.

## Design Notes

- Commands: none user-facing.
- Queries: none.
- API: extends fixed-zone internal copy context with `showNotice(kind, message, ttlMs?)`; `index.ts` wires Pi theme helpers into fixed-zone options.
- Tables: none.
- Domain rules: latest notice wins; success/info default TTL is 3s, warning/error default TTL is 7s.
- UI surfaces: fixed user zone bottom footer row, optional right sidebar still composes around it.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused notice render smoke for width/theme/fallback behavior, if practical. |
| Integration | `git diff --check`, scoped TypeScript no-emit, `srcwalk review` of changed fixed-zone/index files, render profile bench. |
| E2E | Manual Pi smoke: copy selection shows bottom themed pill, clears after TTL, no layout jump, failure warning if clipboard path fails. |
| Platform | Manual terminal smoke for ANSI/background pill rendering across target terminal/theme. |
| Release | Harness matrix/story evidence updated after validation. |

## Harness Delta

No harness policy change expected. This story records a normal-lane fixed-zone UX refinement with weak automated terminal proof.

## Evidence

- `git diff --check`
- Scoped `tsc --noEmit` for `index.ts`, fixed-zone install/split/selection/notice/theme files
- Focused notice renderer smoke via `tsx`: full-row row background, inverse semantic label, sanitization, fixed visible width
- `npm run profile:render`
- `semantic_review` scoped to `fixed-zone`
- Harness US-009 metadata updated; manual Pi smoke pending
