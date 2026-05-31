# US-005 Fixed User Zone

## Status

implemented

## Lane

normal

## Product Contract

When `fixedUserZone` is enabled, the editor/user zone stays fixed at the bottom of the terminal while the chat/feed renders and scrolls only in the area above it. The feature is opt-in and must restore terminal/TUI patches cleanly on session shutdown or extension reload.

## Relevant Product Docs

- `README.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- `fixedUserZone` defaults to `false` and is validated from `~/.pi/agent/pi-droid-styling.json`.
- `fixedUserZoneMouseScroll` defaults to `true` and is validated independently.
- Fixed-zone logic lives under `fixed-zone/`; `index.ts` only wires lifecycle/install.
- When enabled, the status/widgets/editor/footer zone is removed from normal root flow, terminal rows are reserved, terminal writes are constrained to the scrollable region, and the fixed zone is repainted at the bottom.
- Runtime patches are idempotent and disposable.

## Design Notes

- Commands: none user-facing in this slice.
- Queries: none.
- API: config flags `fixedUserZone`, `fixedUserZoneMouseScroll`.
- Tables: none.
- Domain rules: fixed means scroll-isolated, not cosmetic.
- UI surfaces: Pi interactive TUI editor/status/widget/footer area.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Not available; no test runner exists yet. |
| Integration | Passed: namespace check, import-resolution script, `tsc --noEmit`, `srcwalk review`, `git diff --check`, fixed-zone fake TUI smoke, fixed-zone streaming cursor smoke. |
| E2E | Manual Pi smoke still required after merge: long chat/tool output, resize, reload/shutdown. |
| Platform | Terminal behavior should be manually tested in target terminals. |
| Release | Harness trace records changed files, verification, and smoke-test gap. |

## Harness Delta

No harness policy change expected. This story records the normal-lane product behavior because proof is weak and terminal patches have runtime risk.

## Evidence

- `srcwalk review --scope . --limit 8 --budget 7000`
- `srcwalk review --scope . --offset 8 --limit 20 --budget 12000`
- `srcwalk review --scope . --offset 28 --limit 20 --budget 7000`
- Namespace check: no legacy Pi package namespace references outside lockfile.
- Import-resolution script: `ok: 71 relative .js imports checked`.
- `npm exec --package typescript -- tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --strict false --allowJs false ...`: passed.
- Fixed-zone fake TUI smoke with `tsx`: `fixed-zone smoke ok`; follow-up smoke covers cluster render cache, batched SGR wheel packets, non-forced scroll render, and mouse mode restore.
- Fixed-zone streaming cursor smoke with `tsx`: `fixed-zone streaming smoke ok`; verifies render-pass writes move the cursor back to Pi TUI's logical scrollable row before streaming text and do not inline-reset the scroll region ahead of the payload.
- `git diff --check`: passed.
- Manual Pi terminal smoke not run in this environment.
