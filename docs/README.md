# Documentation Map

This directory holds the Harness operating docs and product contract for `pi-droid-styling`.

## Main Files

- `HARNESS.md`: how humans and agents collaborate.
- `FEATURE_INTAKE.md`: how prompts become tiny, normal, or high-risk work.
- `ARCHITECTURE.md`: current TypeScript Pi extension architecture and boundary rules.
- `TEST_MATRIX.md`: legacy proof map; current proof status is queried with `scripts/bin/harness-cli query matrix`.
- `HARNESS_BACKLOG.md`: legacy improvement list; current improvement records are stored with `scripts/bin/harness-cli backlog`.
- `GLOSSARY.md`: shared terms.

## Folders

- `product/`: current product truth for the Pi UI styling extension.
- `stories/`: feature packets and backlog.
- `decisions/`: durable decisions and tradeoffs.
- `templates/`: reusable spec-intake, story, plan, decision, and validation formats.

## Current State

This is a brownfield repository with an existing TypeScript Pi extension. Harness was added after implementation began, so the first documentation goal is to capture the current product behavior, architecture, and validation expectations without inventing fake tests or CI.
