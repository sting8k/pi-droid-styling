# US-011 Pi Tasks Widget Styling

## Status

implemented

## Lane

normal

## Product Contract

When `@tintinweb/pi-tasks` registers its persistent `tasks` widget, `pi-droid-styling` restyles the widget through the Pi `setWidget("tasks")` seam so task status lines match the extension's compact UI language and active-task animation does not flash rapidly.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- The pi-tasks widget keeps using the upstream `tasks` widget key and placement.
- Active task spinner frames are rendered as a stable icon instead of rapidly blinking glyphs.
- Task rows use consistent indentation aligned with the BoxEditor footer/status row, status icons, ID alignment, and dim/accent coloring.
- The wrapper is idempotent and disposable across session reload/shutdown.
- Tool execution semantics and Task* tool registration remain owned by `pi-tasks`.

## Design Notes

- Commands: none.
- Queries: none.
- API: wraps `ctx.ui.setWidget` only for key `tasks`.
- Tables: none.
- Domain rules: do not import or mutate `@tintinweb/pi-tasks` internals; parse rendered widget lines as a compatibility boundary.
- UI surfaces: persistent widget above the editor.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused style function smoke for header, active, completed, pending, overflow lines. |
| Integration | TypeScript check/import-resolution for `index.ts` module wiring and `setWidget("tasks")` wrapper lifecycle. |
| E2E | Manual Pi smoke with `pi-tasks` installed. |
| Platform | Existing terminal render paths remain unchanged outside `tasks` widget. |
| Release | Not applicable. |

## Harness Delta

None.

## Evidence

- Focused pi-tasks widget smoke passed: header, active, completed, pending, overflow lines use the 3-space footer-aligned inset; spinner frames normalize to stable `●`.
- Scoped TypeScript check passed for `index.ts`, `widgets/pi-tasks-widget.ts`, and direct dependencies with node stubs.
- `git diff --check` passed.
- `semantic_review` passed for focused `widgets/pi-tasks-widget.ts` and `index.ts` wiring.
