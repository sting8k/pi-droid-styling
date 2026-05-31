# Trace Specification

The `trace` table records what happened during a Harness task. This document defines the expected depth and format for each field so traces are useful for review, failure attribution, and future harness evolution.

The current schema lives in `scripts/schema/001-init.sql` under the `trace` table.

## Field Reference

| Field | Type | Required | Format | Example |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | Automatic | SQLite autoincrement primary key. Do not set manually. | `42` |
| `created_at` | TEXT | Automatic | SQLite `datetime('now')`. Do not set manually. | `2026-05-31 09:24:37` |
| `task_summary` | TEXT | Yes | One sentence, at least 10 characters, naming the outcome or attempted outcome. | `Normalized Harness docs for pi-droid-styling` |
| `intake_id` | INTEGER | Standard+ when an intake was recorded | Integer id from the related `intake` row. | `1` |
| `story_id` | TEXT | Standard+ when work maps cleanly to one story | Story id from the `story` table. Use the main story when one trace covers several; list the rest in `notes`. | `H-001` |
| `agent` | TEXT | Optional for minimal; Standard+ expected | Short agent/tool name. | `droid` |
| `actions_taken` | TEXT | Standard+ | JSON array text. With the current CLI, pass a comma-separated list and the CLI stores JSON text. | `["read Harness docs","updated product overview","queried matrix"]` |
| `files_read` | TEXT | Standard+ | JSON array text of paths or command names. With the current CLI, pass a comma-separated list. | `["README.md","docs/HARNESS.md","scripts/bin/harness-cli query matrix"]` |
| `files_changed` | TEXT | Standard+ | JSON array text of changed file paths. With the current CLI, pass a comma-separated list; omit only when no files changed. | `["docs/ARCHITECTURE.md","docs/product/overview.md"]` |
| `decisions_made` | TEXT | Detailed | JSON array text of decision strings. Include scope decisions, validation choices, and explicit non-goals. | `["Kept scripts/bin/harness-cli ignored because it is a local prebuilt binary"]` |
| `errors` | TEXT | Standard+ if errors occurred; Detailed always | JSON array text of error or blocker strings. Until the CLI supports empty arrays directly, use `none` when a detailed trace needs explicit no-error evidence. | `["tsc unavailable because typescript is not installed"]` |
| `outcome` | TEXT | Yes before final response | One of `completed`, `blocked`, `partial`, or `failed`. | `completed` |
| `duration_seconds` | INTEGER | Detailed when available | Positive integer estimate or measured duration. Leave null if unknown. | `1800` |
| `token_estimate` | INTEGER | Detailed when available | Positive integer estimate. Leave null if unknown. | `24000` |
| `harness_friction` | TEXT | Standard+ when friction exists; Detailed always | Free text naming what was hard, missing, ambiguous, or repeated. Use `none` only when the agent actively checked and found no friction. | `No formal TypeScript check script exists; validation is limited to source review and import checks.` |
| `notes` | TEXT | Optional | Free text for review context that does not fit other fields. | `Trace covers Harness docs normalization only; no product runtime code changed.` |

## Quality Tiers

### Minimal (score: 1)

Minimum fields:

- `task_summary` is filled and at least 10 characters.
- `outcome` is filled before the final response.

Acceptable for:

- Tiny-lane tasks with no file changes or only low-risk copy/doc edits.

Not acceptable for:

- Normal or high-risk work.
- Any work that discovered friction, errors, or a missing validation path.

### Standard (score: 2)

Minimum fields:

- All Minimal fields.
- `intake_id` when an intake was recorded.
- `story_id` when the work maps cleanly to one story.
- `agent`.
- `actions_taken` as JSON array text.
- `files_read` as JSON array text.
- `files_changed` as JSON array text.
- At least one of `errors` or `harness_friction`.

Required for:

- Normal-lane tasks.
- Tiny tasks that changed Harness instructions, validation expectations, or durable records.

Standard traces may leave `duration_seconds`, `token_estimate`, and `decisions_made` empty when those details are not useful.

### Detailed (score: 3)

Minimum fields:

- All Standard fields.
- `decisions_made` as JSON array text.
- `errors` as JSON array text, using `none` with the current CLI when no errors occurred.
- `harness_friction`, using `none` only after checking for friction.
- `duration_seconds` or a note explaining why duration is unavailable.
- `token_estimate` or a note explaining why token estimate is unavailable.
- `notes` when one trace covers multiple stories, multiple risk flags, or skipped validation.

Required for:

- High-risk tasks.
- Changes touching architecture direction, source-of-truth hierarchy, validation requirements, auth, authorization, data loss, audit/security, or external provider behavior.
- Release work where later review needs precise proof.

## Lane Mapping

| Lane | Expected Tier | Minimum Trace Behavior |
| --- | --- | --- |
| Tiny | Minimal | Record summary and outcome; use Standard if friction or Harness docs changed. |
| Normal | Standard | Record intake, actions, files read, files changed, outcome, and friction/errors. |
| High-risk | Detailed | Record all fields or explicitly explain unavailable duration/token estimates. |

## Friction Capture Protocol

Populate `harness_friction` when any of these occur:

- The agent had to infer a missing rule or source of truth.
- Required validation was unclear, unavailable, or too expensive to run.
- A document, durable record, or story packet was stale or contradictory.
- The task revealed a repeated manual step that should become a template, command, or checklist.
- A requested change was out of scope but likely important later.
- A review failure could not be attributed to a component.

How to write friction:

- Name the concrete pain, not a vague mood.
- Include the missing capability or contradiction.
- If the friction should become work, also add or update a backlog item with `scripts/bin/harness-cli backlog add`.
- If there was no friction, use `none` only for Detailed traces.

Good friction:

```text
No formal TypeScript check script exists; validation used srcwalk review and import-resolution checks instead.
```

Weak friction:

```text
docs confusing
```

## Examples

### Good Trace (Detailed)

```bash
scripts/bin/harness-cli trace \
  --summary "Completed high-risk terminal theme behavior change with manual smoke proof" \
  --intake 12 \
  --story US-014 \
  --agent droid \
  --outcome completed \
  --duration 4200 \
  --tokens 52000 \
  --actions "read architecture docs,patched terminal theme sync,ran source review,performed Pi smoke test" \
  --read "docs/ARCHITECTURE.md,docs/product/overview.md,theme/terminal-bg.ts,index.ts" \
  --changed "theme/terminal-bg.ts,index.ts,docs/product/overview.md" \
  --decisions "kept theme sync best-effort,avoided forcing a theme" \
  --errors "none" \
  --friction "No automated Pi smoke runner exists; platform proof was manual." \
  --notes "Detailed trace required because the task changed terminal/platform behavior."
```

### Adequate Trace (Standard)

```bash
scripts/bin/harness-cli trace \
  --summary "Normalized Harness docs for pi-droid-styling" \
  --intake 1 \
  --story H-001 \
  --agent droid \
  --outcome completed \
  --actions "read Harness guidance,updated architecture docs,updated product overview,queried matrix" \
  --read "README.md,docs/HARNESS.md,docs/FEATURE_INTAKE.md,docs/ARCHITECTURE.md,scripts/bin/harness-cli query matrix" \
  --changed "AGENTS.md,docs/ARCHITECTURE.md,docs/product/overview.md,docs/TEST_MATRIX.md" \
  --friction "No formal TypeScript check script exists; validation was docs review and matrix query."
```

### Insufficient Trace

```bash
scripts/bin/harness-cli trace \
  --summary "did docs" \
  --outcome completed
```

Why this is insufficient for normal-lane Harness work:

- It does not identify actions.
- It does not list files read or changed.
- It does not connect to intake or stories.
- It gives no friction or error signal.

## Review Checklist

Before the final response, check:

- The trace tier matches the lane.
- Run `scripts/bin/harness-cli score-trace` after recording the trace to mechanically verify that the latest trace meets its linked intake lane requirement. Use `scripts/bin/harness-cli score-trace --id N` when reviewing a specific trace.
- `files_changed` matches the actual changed-file set at a useful level.
- `errors` names real blockers or is `none` for Detailed traces when the current CLI is used.
- `harness_friction` either names a concrete issue or is intentionally `none`.
- Any friction that should become future work is recorded in the backlog.
