# Scripts

This directory contains Harness automation assets for this repository.

## Harness CLI

Use the repo-local Rust Harness CLI at `scripts/bin/harness-cli` for normal Harness work.

```bash
scripts/bin/harness-cli init          # Create harness.db
scripts/bin/harness-cli migrate       # Apply pending schema migrations
scripts/bin/harness-cli intake ...    # Record a feature intake classification
scripts/bin/harness-cli story ...     # Add or update a story/test-matrix row
scripts/bin/harness-cli decision ...  # Add a decision or run decision verification
scripts/bin/harness-cli backlog ...   # Add or close a backlog item
scripts/bin/harness-cli trace ...     # Record an agent execution trace
scripts/bin/harness-cli score-trace   # Score trace quality against docs/TRACE_SPEC.md
scripts/bin/harness-cli query ...     # Query matrix, backlog, decisions, intakes, traces, friction, stats, or SQL
```

Run `scripts/bin/harness-cli --help` or `scripts/bin/harness-cli <command> --help` for command details.

## Render Profiling Bench

Run the synthetic render profiling bench with:

```bash
npm run profile:render
```

It enables `PI_DROID_PROFILE=1`, writes JSONL to `/tmp` unless `PI_DROID_PROFILE_OUT` is set, and exercises sidebar rendering, fixed-zone compositor repaint, render throttle, assistant/tool debounce, and git status refresh. It reports memory, CPU delta, event-loop utilization, and CPU/string/layout evidence; terminal emulator paint cost still needs a real Pi TUI capture.

## Pi Runtime Trace

Use the Pi runtime trace helper when a live `pi` process shows high RAM or CPU:

```bash
npm run trace:pi -- --cwd pi-droid-styling
npm run trace:pi -- --pid 12345
npm run trace:pi -- --top 15 --sample-sec 3
```

The helper prints process/RSS samples, parent chain, cwd, vmmap summary, native stack symbol counts, and session JSONL metadata by role/tool/bytes. It writes full `vmmap` and `sample` reports to `/tmp` and does not print message or tool-result content.

## Durable Layer

- Schema files live in `scripts/schema/`.
- Runtime state lives in `harness.db`.
- `harness.db`, WAL/SHM files, and `scripts/bin/harness-cli` are ignored by git.
- The schema is version-controlled; the local database and prebuilt binary are machine-local operational files.

## Current Validation Gap

This repository does not yet define a package-level `check` script. Until that exists, validation should use the smallest available proof for the task:

- `srcwalk review` for changed source evidence.
- `srcwalk overview --scope . --depth 2` for structure checks.
- Import-resolution checks for TypeScript ESM `.js` specifiers when imports move.
- Manual Pi smoke testing for editor, tool tags, theme sync, and footer/status rendering.

Do not claim formal typecheck, unit, integration, E2E, or platform automation passes until those commands exist and have been run.
