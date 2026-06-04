# Agent Instructions

This repository is a TypeScript ESM Pi extension for UI styling. Keep `index.ts` focused on Pi lifecycle wiring, put feature logic in the nearest domain folder, and make runtime patches idempotent because sessions/extensions can reload.

## Feature Context

- `fixed-zone/` owns the fixed user zone, sidebar, selection/copy UX, notice footer, scrollbar, and smooth wheel behavior. Preserve terminal state and clear stale physical rows on install/dispose.
- `theme/` and `performance/` own frame/page background rendering, render debug/physical sync, and OSC 11 terminal background sync. Keep Windows/WSL OSC 11 gated unless `forceOSC11` is enabled.
- `widgets/` and `tool-tags/` own pi-tasks styling, tool result accents, and working/thinking loader states. Dispose timers and patched UI methods on reload/shutdown.

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
