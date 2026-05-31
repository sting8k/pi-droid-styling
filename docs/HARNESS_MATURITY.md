# Harness Maturity Ladder

This ladder defines how the Harness installation in `pi-droid-styling` can progress from static agent instructions to measurable harness improvement.

A level is achieved only when its criteria can be inspected in repository files, durable Harness records, or validation output.

## Levels

### H0 - Bare Environment

The model operates with no repository harness. It receives a prompt and may produce a patch, but the repo does not tell it how to classify, validate, or record work.

Criteria:

- No `AGENTS.md` Harness block exists.
- No feature intake policy exists.
- No story, decision, validation, or trace artifact exists.

Current status:

- Passed. This repository is beyond H0.

### H1 - Scaffolding And Policy

The repository contains static operating instructions, templates, risk lanes, and source-of-truth rules. Agents can follow a documented workflow, but durable state may still be manual or incomplete.

Criteria:

- `AGENTS.md` points agents to the Harness operating docs.
- `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`, and `docs/ARCHITECTURE.md` exist.
- Story, decision, and validation templates exist under `docs/templates/`.
- `docs/TEST_MATRIX.md` defines proof columns and status meanings.

Current status:

- Achieved. H1 files exist and are used by current Harness instructions.

Activated responsibilities:

- Task specification.
- Permissions.
- Project memory.
- Verification.

### H2 - Durable State And Observability

The repository has structured operational records and explicit observation rules. Agents can record what happened, connect work to stories, and write traces with predictable depth.

Criteria:

- `scripts/bin/harness-cli` can record intake, story, decision, backlog, and trace data in `harness.db`.
- `scripts/schema/001-init.sql` defines durable tables for intake, story, decision, backlog, and trace records.
- `docs/HARNESS_COMPONENTS.md` maps files and responsibilities.
- `docs/HARNESS_MATURITY.md` defines H0-H5 with measurable criteria.
- `docs/TRACE_SPEC.md` defines trace fields, quality tiers, and friction capture.
- `docs/CONTEXT_RULES.md` defines phase-by-lane context rules.

Current status:

- Achieved for local Harness operation. Durable state exists locally, and observability/context docs are installed.

Activated responsibilities:

- Task state.
- Observability.
- Failure attribution.
- Context selection.
- Entropy auditing.

### H3 - Active Observability And Evolution

The harness can evaluate its own operational data and turn repeated failures into prioritized improvements.

Criteria:

- Trace quality can be scored by a repeatable command.
- Harness friction can be queried and grouped for review.
- Backlog items include predicted impact and actual outcome after completion.
- Review output identifies which Harness responsibility moved or regressed.

Current status:

- Partial. `scripts/bin/harness-cli score-trace`, `query friction`, and backlog outcome fields exist, but component-level regression attribution is still manual.

Activated responsibilities:

- Observability.
- Failure attribution.
- Entropy auditing.
- Intervention recording.

### H4 - Automated Verification

The harness can run or orchestrate proof checks consistently and can reject or flag incomplete work before the final response.

Criteria:

- A documented verification command or protocol runs the expected checks for a selected story and lane.
- Story proof columns are updated from command output or a repeatable report.
- Decision verification commands can be run in batch.
- Missing validation evidence is surfaced before a task is marked implemented.

Current status:

- Not achieved. `pi-droid-styling` has no formal TypeScript check script or automated Pi smoke runner yet.

Activated responsibilities:

- Verification.
- Task state.
- Permissions.
- Intervention recording.

### H5 - Self-Improving Harness

The harness can use traces and backlog outcomes to propose or apply safe improvements to itself.

Criteria:

- Repeated friction patterns are summarized into proposed harness changes.
- Proposed changes include predicted impact, risk, validation plan, and rollback criteria.
- Completed changes compare predicted impact with actual trace or validation outcomes.
- High-risk harness changes pause for human confirmation before changing source hierarchy, architecture direction, or validation requirements.

Current status:

- Not achieved. The repository can record friction, but it does not yet summarize or apply improvements automatically.

Activated responsibilities:

- Entropy auditing.
- Failure attribution.
- Intervention recording.
- Permissions.

## Current Assessment

| Level | Status | Evidence |
| --- | --- | --- |
| H0 | Passed | Harness docs, templates, and durable records exist. |
| H1 | Achieved | `AGENTS.md`, `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`, `docs/ARCHITECTURE.md`, `docs/templates/*`, and `docs/TEST_MATRIX.md` exist. |
| H2 | Achieved | `scripts/bin/harness-cli`, `scripts/schema/001-init.sql`, durable story records, `docs/HARNESS_COMPONENTS.md`, `docs/HARNESS_MATURITY.md`, `docs/TRACE_SPEC.md`, and `docs/CONTEXT_RULES.md` exist. |
| H3 | Partial | Trace scoring, friction query, and backlog outcome loop exist; component-level regression attribution remains manual. |
| H4 | Not achieved | No formal verification runner or batch proof updater exists. |
| H5 | Not achieved | No self-improvement protocol or automated evolution loop exists. |

## Responsibility Activation

| Responsibility | H0 | H1 | H2 | H3 | H4 | H5 |
| --- | --- | --- | --- | --- | --- | --- |
| Task specification | Missing | Covered | Covered | Covered | Covered | Covered |
| Context selection | Missing | Partial | Covered | Covered | Covered | Covered |
| Tool access | Missing | Partial | Partial | Partial | Covered | Covered |
| Project memory | Missing | Covered | Covered | Covered | Covered | Covered |
| Task state | Missing | Partial | Covered | Covered | Covered | Covered |
| Observability | Missing | Missing | Partial | Covered | Covered | Covered |
| Failure attribution | Missing | Missing | Partial | Covered | Covered | Covered |
| Verification | Missing | Partial | Partial | Partial | Covered | Covered |
| Permissions | Missing | Partial | Partial | Partial | Covered | Covered |
| Entropy auditing | Missing | Missing | Partial | Covered | Covered | Covered |
| Intervention recording | Missing | Partial | Partial | Covered | Covered | Covered |
