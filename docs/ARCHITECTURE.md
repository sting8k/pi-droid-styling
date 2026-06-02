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

## Validation Ladder

No formal build/test script exists yet. Current available checks are:

- `srcwalk review` for changed-code evidence.
- `srcwalk overview --scope . --depth 2` for organization sanity.
- Import-resolution script for relative `.js` specifiers resolving to `.ts` files.
- Manual smoke test inside Pi for editor, tool tags, prefixes, theme sync, and footer status.

A future `check` script should add TypeScript verification with `tsc --noEmit` once `typescript` is added to dev dependencies.
