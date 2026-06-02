# US-007 Fixed User Zone Sidebar

## Status

implemented

## Lane

normal

## Product Contract

When `fixedUserZone` and `fixedUserZoneSidebar` are both enabled, wide terminals reserve a right sidebar for session/project metadata while the chat/feed and fixed user zone render in the remaining left content area. If the terminal is too narrow, the sidebar is hidden and the fixed footer keeps the compact metadata fallback.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- `fixedUserZoneSidebar` defaults to `false` and is validated/backfilled from `~/.pi/agent/pi-droid-styling.json`.
- Sidebar is a child behavior of `fixedUserZone`; it never appears when `fixedUserZone` is disabled.
- Sidebar auto-hides on narrow terminals so content keeps a minimum usable width.
- When sidebar is active, it reserves the full right rail across the terminal height, including beside the fixed user zone.
- Sidebar shows session id, session name, cwd, current git branch, modified files, and Pi version when available.
- When sidebar is active, duplicated cwd/branch/footer metadata is hidden from the fixed footer; when inactive, the fixed footer falls back to the existing compact metadata.
- Mouse selection in the sidebar rail does not select/copy chat text.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Not available; no test runner exists yet. |
| Integration | Passed: `git diff --check`, full TypeScript no-emit check, import-resolution check (`ok: 74 relative .js imports checked`), fixed-zone sidebar fake TUI smoke, `srcwalk review --scope .`. |
| E2E | Manual Pi smoke: fixed zone with sidebar on/off, wide/narrow resize, wheel scroll, selection, modified files, and footer fallback. |
| Platform | Terminal behavior should be manually tested because right rail is compositor-painted, not true terminal column isolation. |

## Evidence

- `git diff --check`: passed.
- `npm exec --package typescript -- tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --strict false --allowJs false ...`: passed.
- Import-resolution script: `ok: 74 relative .js imports checked`.
- Fixed-zone sidebar fake TUI smoke: `fixed-zone sidebar smoke ok`; verifies sidebar activates at 120 columns, auto-hides at 100 columns, and root/fixed cluster render with reserved content width.
- `srcwalk review --scope .`: reviewed working tree evidence.
- Manual Pi terminal smoke not run in this environment.

## Harness Delta

No harness policy change expected. This story records a normal-lane extension of fixed user zone because terminal compositor changes have runtime risk and weak automated proof.
