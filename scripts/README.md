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

## Render Frame Log Debug

Use frame logs for visual render bugs such as duplicated/stale rows, cursor drift, viewport jumps, or diff-render leaks. This is the preferred workflow over synthetic PTY stream scripts because it records Pi TUI logical state, final terminal writes, physical-sync raw/final anchoring metadata, and self-heal reasons/ranges per frame.

Capture a live Pi session:

```bash
rm -rf /tmp/pi-droid-render-debug
PI_DROID_RENDER_DEBUG=1 PI_DROID_RENDER_DEBUG_DIR=/tmp/pi-droid-render-debug pi
```

Summarize the newest log:

```bash
npm run debug:render-log -- --dir /tmp/pi-droid-render-debug
```

Manual marker: while `PI_DROID_RENDER_DEBUG=1` is active, run `kill -USR2 <pi-pid>` when a visual stale row is observed. The frame log records a marker with the nearest frame number for later correlation.

Useful A/B flags:

- `PI_DROID_RENDER_PHYSICAL_SYNC=0` disables the whole physical terminal sync wrapper.
- `PI_DROID_RENDER_ABSOLUTE_ANCHOR=0` disables only leading relative-cursor rewrite.
- `PI_DROID_RENDER_AUTOWRAP_GUARD=1` enables the render-wide autowrap guard for right-edge/pending-wrap A/B testing, especially long tool-output rows; default remains off because physical-sync repaint already wraps its own writes locally.
- `PI_DROID_RENDER_SHAPE_REPAINT=0` disables the default visual line-change/cursor-band and viewport-remap repaint for A/B testing.
- `PI_DROID_RENDER_FULL_REPAINT=1` enables extra same-shape interval repaint and periodic full sweep; default is off.
- `PI_DROID_RENDER_SELF_HEAL_MODE=band` uses targeted risk-band repaint; `viewport` restores full-viewport self-heal.
- `PI_DROID_RENDER_FULL_REPAINT_INTERVAL_MS=200` controls same-shape streaming band fallback cadence; `0` restores every-frame self-heal.
- `PI_DROID_RENDER_FULL_SWEEP_INTERVAL_MS=1000` controls periodic full-viewport sweep cadence in band mode; `0` disables periodic sweeps.

Interpretation guide:

- `logical_dup_frames=0` with visible duplicates means the logical render tree is probably clean.
- `leading_relative_move_frames>0` means final terminal writes still rely on cursor-relative anchoring.
- `raw_leading_relative_move_frames>0` with `leading_relative_move_frames=0` means physical-sync rewrote raw relative moves to absolute anchors successfully.
- `physical_self_heal_frames` appears by default on visible line changes/viewport remaps; with `PI_DROID_RENDER_FULL_REPAINT=1` it can also appear from interval fallback or periodic full sweeps. `self_heal_reason_counts` explains why each repaint happened.
- `band_repaint_frames` is the default targeted mode for visible line changes plus the active cursor band; `full_viewport_repaint_frames` should appear on viewport remaps, opt-in periodic full sweeps, or when `PI_DROID_RENDER_SELF_HEAL_MODE=viewport`.
- `row_coverage_risk_frames>0` means logical changed rows were not touched by parsed final writes; this is a stale-risk/dirty-range signal, not physical screen readback proof.
- `screen_simulation_risk_frames>0` means replaying final ANSI writes into the debug simulator diverged from logical `previousLines`; this narrows protocol/state drift but still is not terminal readback proof.
- Duplicates that disappear after scrolling usually indicate a stale physical terminal row, not duplicated message content.

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
