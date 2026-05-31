# Harness Components

This taxonomy maps the installed Harness surface in `pi-droid-styling` to the responsibilities it serves for agents and humans.

Status values:

- **Covered**: the repository has an explicit file, command, or record for this responsibility.
- **Partial**: support exists but is manual, incomplete, or not measured.
- **Missing**: no meaningful support exists yet.

## Responsibility Map

| # | Responsibility | Status | Harness Files | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 | Task specification | Covered | `AGENTS.md`, `docs/FEATURE_INTAKE.md`, `docs/templates/*`, `docs/stories/*`, `intake` and `story` tables | Requests are classified by type/lane and story-sized work can be recorded. | Keep story records synchronized with product docs. |
| 2 | Context selection | Covered | `AGENTS.md`, `docs/CONTEXT_RULES.md`, `docs/ARCHITECTURE.md`, `docs/product/*` | Agents have a required reading list and phase-by-lane retrieval rules. | No automated context budget enforcement. |
| 3 | Tool access | Partial | `scripts/bin/harness-cli`, `scripts/README.md`, `scripts/schema/001-init.sql` | Repo-local CLI manages intake, stories, backlog, decisions, traces, and queries. | The binary is ignored and must be installed locally; no machine-readable tool registry. |
| 4 | Project memory | Covered | `docs/decisions/*`, `docs/GLOSSARY.md`, `docs/product/*`, `docs/stories/*`, `harness.db` | Product docs, decisions, stories, and durable records preserve project context. | Older task history before Harness install is not imported. |
| 5 | Task state | Covered | `scripts/bin/harness-cli query matrix`, `docs/TEST_MATRIX.md`, `story` and `trace` tables | Matrix rows and traces can record current proof state. | No CI gate enforces stale story status. |
| 6 | Observability | Partial | `docs/TRACE_SPEC.md`, `trace` table, `scripts/bin/harness-cli score-trace` | Tasks can leave structured traces and score them. | No dashboard or automatic benchmark ingestion. |
| 7 | Failure attribution | Partial | `docs/HARNESS_COMPONENTS.md`, `docs/TRACE_SPEC.md`, `trace.errors`, `trace.harness_friction`, backlog records | Failures can be tied to missing docs, proof, context, or tooling. | Attribution is manual. |
| 8 | Verification | Partial | `docs/TEST_MATRIX.md`, story proof columns, `docs/templates/validation-report.md` | Proof expectations are documented per story. | This repo has no formal `check` script or automated test suite yet. |
| 9 | Permissions | Partial | `AGENTS.md`, `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`, `docs/ARCHITECTURE.md` | Docs state when agents may patch directly or should ask before policy/architecture changes. | Instruction-level only; no enforced allowlist. |
| 10 | Entropy auditing | Partial | `docs/HARNESS_BACKLOG.md`, `backlog` table, `trace.harness_friction`, `docs/HARNESS_MATURITY.md` | Harness friction can become backlog items. | No drift detector or stale-doc audit. |
| 11 | Intervention recording | Partial | `trace` table, `docs/decisions/*`, `docs/stories/*` | Actions, decisions, and outcomes can be recorded. | Human interventions are not separately typed. |

## Repo File Inventory

| File | Primary Responsibility | Secondary Responsibilities |
| --- | --- | --- |
| `.gitignore` | Tool access | Task state |
| `AGENTS.md` | Context selection | Task specification, permissions |
| `README.md` | Product memory | Task specification |
| `CHANGELOG.md` | Product memory | Release history |
| `package.json` | Tool access | Product metadata |
| `package-lock.json` | Tool access | Dependency reproducibility |
| `docs/ARCHITECTURE.md` | Context selection | Permissions, task specification |
| `docs/CONTEXT_RULES.md` | Context selection | Permissions, task specification |
| `docs/FEATURE_INTAKE.md` | Task specification | Permissions, context selection |
| `docs/GLOSSARY.md` | Project memory | Context selection |
| `docs/HARNESS.md` | Task specification | Project memory, task state, permissions |
| `docs/HARNESS_BACKLOG.md` | Entropy auditing | Project memory, failure attribution |
| `docs/HARNESS_COMPONENTS.md` | Failure attribution | Observability, entropy auditing |
| `docs/HARNESS_MATURITY.md` | Entropy auditing | Observability, verification |
| `docs/README.md` | Project memory | Context selection |
| `docs/TEST_MATRIX.md` | Verification | Task state |
| `docs/TRACE_SPEC.md` | Observability | Failure attribution, intervention recording |
| `docs/product/README.md` | Product contract | Context selection |
| `docs/product/overview.md` | Product contract | Verification expectations |
| `docs/decisions/*` | Project memory | Permissions |
| `docs/stories/*` | Task specification | Verification, project memory |
| `docs/templates/*` | Task specification | Verification |
| `scripts/README.md` | Tool access | Context selection |
| `scripts/schema/001-init.sql` | Task state | Observability, project memory |
| `scripts/bin/harness-cli` | Tool access | Task state, observability |

## Coverage Summary

- Covered: task specification, context selection, project memory, task state.
- Partial: tool access, observability, failure attribution, verification, permissions, entropy auditing, intervention recording.
- Missing: none at the installed Harness policy level.

The largest current gap for this repository is verification: `pi-droid-styling` does not yet have a formal TypeScript check script or automated Pi smoke runner.
