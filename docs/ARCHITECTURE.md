# Architecture

`pi-droid-styling` is a TypeScript ESM extension for Pi. It customizes the Pi terminal UI by installing reload-safe patches, custom renderers, message prefixes, a boxed editor, theme helpers, and lightweight runtime status providers.

## Runtime Surface

- Runtime: Pi extension loaded from `index.ts` through the `package.json` `pi.extensions` entry.
- Language: TypeScript with ESM-style `.js` import specifiers.
- Hosts: `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
- State: in-memory per process/session; no product database.
- Harness durable state: local `harness.db`, managed only by `scripts/bin/harness-cli` and ignored by git.

## Current Module Boundaries

```text
index.ts
  Pi lifecycle wiring and module installation

core/
  Pure-ish runtime helpers that do not own UI rendering
  - assistant speed tracking
  - cached git branch status provider

editor/
  BoxEditor component and editor-specific rendering

messages/
  Assistant/user message prefix patches

tool-tags/
  Tool call renderers, badges, elapsed metrics, and tool-output formatting

theme/
  ANSI helpers, theme discovery/extras, and terminal background sync

performance/
  Debounce, throttle, and virtualization patches for render hot paths

fixed-zone/
  Opt-in terminal compositor for the true fixed user zone
  - install/dispose lifecycle
  - terminal split/scroll-region patching
  - fixed cluster rendering
  - optional right sidebar rendering for fixed user zone metadata
  - reserved bottom notice footer rendering for fixed-zone-local feedback

startup-ui.ts, footer-patch.ts, tui-padding.ts, split-diff.ts
  Focused UI patches/components that are still small enough to stay at root
```

## Design Rules

1. `index.ts` should stay an orchestrator: install modules, wire Pi events, and pass providers into UI components.
2. Feature logic belongs in the closest domain folder, not inline in `index.ts`.
3. Patch installers must be idempotent because sessions and extensions can reload.
   Terminal compositor patches must also restore `terminal.write`, `terminal.rows`, `tui.render`, scroll regions, and input listeners on dispose.
4. Tool rendering belongs in `tool-tags/` until that domain grows enough to justify subfolders.
5. Theme and ANSI behavior belongs in `theme/`; performance wrappers belong in `performance/`.
6. Runtime providers used by UI components should be cheap on render paths and cache background work when needed.

## Dependency Direction

```text
index.ts
  -> core, editor, fixed-zone, messages, performance, theme, tool-tags, root UI modules

editor/messages/tool-tags/root UI modules
  -> theme helpers when they need color or ANSI behavior

core
  -> Node/Pi primitives only; avoid depending on UI render components
```

Avoid adding dependencies from `core/` back into UI components. If a core helper needs host behavior, pass it in as a provider instead of importing UI classes.

## Render Drift / Stale Row Incident

> Context: this took a full debugging day; keep this note close to render architecture.

Observed symptom: during assistant/tool streaming, one conversation row could appear duplicated or stuck. The duplicate disappeared after scrolling up/down because scrolling forced a broader terminal repaint.

Root cause direction: Pi TUI logical render state was clean, but the physical terminal buffer could retain a stale row. The default differential renderer only repaints rows it believes changed, so an unchanged logical row could remain stale on screen.

Confirmed non-causes:

- working/status loader
- scrollbar visual overlay
- fixedUserZone seam row
- fixedUserZone scroll-region

Current mitigation lives in `performance/render-physical-sync.ts`:

```text
after each doRender
  normalize leading relative cursor movement to an absolute row anchor
  self-heal physical rows with a targeted risk band, or full viewport on remap/sweep
```

The post-render repaint is intentionally self-healing: it rewrites physical rows from the current logical `previousLines` snapshot instead of trusting terminal diff/cache state. By default, changed visual rows use a targeted risk band plus the hardware-cursor band, and viewport remaps use a full viewport repaint. Periodic interval fallback and slower full-viewport sweep remain opt-in so assistant streaming stays bounded while still repainting the active streaming row.

Important cursor invariant: leading relative cursor moves are normalized to absolute anchors even when the relative move is followed by `\r\n`. The `\n` is intentionally preserved after the absolute anchor so multi-line append writes keep their line-feed semantics without leaking a final relative cursor dependency.

Debug-only row coverage compares logical rows changed in `previousLines` with physical screen rows touched by the final ANSI writes. A coverage miss is a stale-risk signal for dirty-range bugs, not proof of terminal state, because the terminal buffer cannot be read back. Frame debug also keeps a lightweight ANSI screen simulation that replays final writes into a simulated viewport and compares it to logical `previousLines`; simulator mismatches narrow terminal-protocol drift but still do not prove the real emulator buffer.

Useful debug/env flags:

- `PI_DROID_RENDER_DEBUG=1` writes JSONL frame logs to `/tmp/pi-droid-render-debug` by default.
- `kill -USR2 <pi-pid>` writes a debug marker record near the current frame so visual stale observations can be correlated with logs.
- `PI_DROID_RENDER_PHYSICAL_SYNC=0` disables the whole physical-sync wrapper for A/B testing.
- `PI_DROID_RENDER_ABSOLUTE_ANCHOR=0` disables only the absolute-anchor rewrite for A/B testing.
- `PI_DROID_RENDER_AUTOWRAP_GUARD=1` enables the render-wide autowrap guard for right-edge/pending-wrap A/B testing, especially long tool-output rows; default remains off because physical-sync repaint already wraps its own writes locally.
- `PI_DROID_RENDER_SHAPE_REPAINT=0` disables the default visual line-change/cursor-band and viewport-remap repaint for A/B testing.
- `PI_DROID_RENDER_FULL_REPAINT=1` enables extra same-shape interval repaint and periodic full sweep; default is off.
- `PI_DROID_RENDER_SELF_HEAL_MODE=band` uses targeted risk-band repaint; `viewport` restores full-viewport self-heal.
- `PI_DROID_RENDER_FULL_REPAINT_INTERVAL_MS=200` controls same-shape streaming band fallback cadence; `0` restores every-frame self-heal for A/B testing.
- `PI_DROID_RENDER_FULL_SWEEP_INTERVAL_MS=1000` controls periodic full-viewport sweep cadence in band mode; `0` disables periodic sweeps.
- `npm run debug:render-log -- --dir /tmp/pi-droid-render-debug` summarizes frame logs, including markers, raw/final cursor anchoring, self-heal reasons/ranges, changed-row write coverage misses, and ANSI screen simulation mismatches.

Tradeoff: the default shape repaint adds bounded output when visible line content changes, including same-line assistant streaming ticks. The cursor-band repaint fixes active-row stale leaks without enabling periodic full sweeps. The opt-in interval/sweep mitigation increases terminal output on self-heal frames; targeted band reduces bytes versus full viewport repaint, but it is heuristic and can miss stale rows outside the risk band. `PI_DROID_RENDER_SELF_HEAL_MODE=viewport` is the safer fallback if visual leaks return.

## Validation Ladder

No formal build/test script exists yet. Current available checks are:

- `srcwalk review` for changed-code evidence.
- `srcwalk overview --scope . --depth 2` for organization sanity.
- Import-resolution script for relative `.js` specifiers resolving to `.ts` files.
- Manual smoke test inside Pi for editor, tool tags, prefixes, theme sync, and footer status.

A future `check` script should add TypeScript verification with `tsc --noEmit` once `typescript` is added to dev dependencies.
