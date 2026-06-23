# US-019 Compact Tasks Widget Style

## Status

implemented

## Lane

normal

## Product Contract

`pi-droid-styling` offers a `tasksWidgetStyle` config (`"default" | "compact"`, default `"compact"`) that selects how the `tasks` widget is restyled. In `compact` mode the whole widget collapses to a single summary line `Tasks ▶ <current task>  (done/total)` with `idle`/`done`/`N blocked` variants; counts are preserved under width truncation while the current-task text is cut first. `default` mode keeps the existing multi-line per-task list. The key auto-scaffolds into the config file on first load and backfills into existing configs missing it.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- A new `tasksWidgetStyle` key exists in `DroidStylingConfig` with accepted values `"default"` and `"compact"`.
- Default value is `"compact"` so new installs and scaffolded configs get the compact one-line widget.
- Invalid/missing values normalize to `"compact"`; existing configs without the key are backfilled and persisted.
- Compact render produces exactly one line for running, all-done, idle, blocked, and overflow inputs.
- Current-task text is truncated before counts when width is constrained; `(done/total)` and blocked indicator are never cut.
- `default` style still renders the multi-line per-task list unchanged.
- The widget patch stays idempotent and disposable across session reload; cache key distinguishes the two styles.

## Design Notes

- Commands: none.
- Queries: none.
- API: `installPiTasksWidgetStyling(sessionUi, style)` threads the chosen style through the `setWidget("tasks")` wrapper into `stylePiTasksWidgetLines` / `wrapTaskWidgetComponent` / `wrapTaskWidgetFactory`.
- Tables: none.
- Domain rules: compact parsing reuses the existing `parseTaskWidgetLine` text-scraping boundary; `pickCurrentTask` prefers `running` then `active`; overflow increments `total` but counts reflect only visible tasks.
- UI surfaces: persistent `tasks` widget above the editor.
- Rationale for compact default: the multi-line list is verbose for a glanceable sidebar slot; a one-line summary surfaces progress and the active task with less vertical cost. Users who want the legacy list set `tasksWidgetStyle: "default"`.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `npm run test:tasks-widget-compact` smoke covers renderer variants (running, all-done, idle, blocked, overflow, width truncation, default multi-line) and config normalize/scaffold/backfill. |
| Integration | Focused TypeScript check for `config.ts`, `widgets/pi-tasks-widget.ts`, `index.ts` wiring; `semantic_review` of working tree. |
| E2E | Manual Pi smoke with `pi-tasks` installed, toggling `tasksWidgetStyle` between `compact` and `default`. |
| Platform | Existing terminal render paths and other widgets remain unchanged outside `setWidget("tasks")`. |
| Release | Bump patch version on next release. |

## Harness Delta

- Intake #19 recorded (change_request, normal, flags: existing-behavior, public-contracts).
- Story US-019 packet added.
- Standard trace recorded.

## Evidence

- `npm run test:tasks-widget-compact` passed: 8 renderer cases + 5 config cases.
- Focused `tsc` passed for changed files; only pre-existing `messages/assistant-prefix.ts:225` error remains (unrelated, present on main).
- `semantic_review` working-tree passed with no findings.
- Commit `fa4303a` on branch `feat/tasks-widget-compact`.