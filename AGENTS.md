# Agent Instructions

This repository is a TypeScript ESM Pi extension for UI styling. Keep `index.ts` focused on Pi lifecycle wiring, put feature logic in the nearest domain folder, and make runtime patches idempotent because sessions/extensions can reload.

<!-- HARNESS:BEGIN -->
## Harness

This repo uses Harness. Before work, read:

- `README.md`
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- `scripts/bin/harness-cli query matrix`

Use the Rust Harness CLI at `scripts/bin/harness-cli` as the main operational
tool.
<!-- HARNESS:END -->
