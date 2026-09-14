# 0006 Decorate builtin tool renderers instead of re-registering builtin tools

Date: 2026-09-15

## Status

Accepted

## Context

Since the initial commit (2026-02-20), builtin tool styling worked by re-registering
`read/write/ls/find/grep/bash/edit` under their builtin names via `pi.registerTool`,
copying the builtin definition and wrapping execute purely to attach
`renderCall`/`renderResult` (and annotate elapsed metrics). That was the only official
rendering path at the time — pi has no renderer-only API — and custom tools overriding
builtins by name is a designed feature.

The cost surfaced in a multi-writer ecosystem (issue #24): pi dedups same-name tools
across extensions **first-wins by package order**, so this extension silently shadowed
same-name tools from later packages. pi-utils shell-bg `bash` lost its `background`
parameter at the wire; fs-search `grep` was dropped the same way. Ordering workarounds
move the failure around instead of removing it, and only droid-aware packages (pi-utils)
can cooperate.

Meanwhile the repo had already invented the correct seam: `installQuickEditRenderer`
(2026-05-06) styles other packages' tools by patching
`ToolExecutionComponent.prototype.getCallRenderer/getResultRenderer` keyed on
`toolName`, without registering anything. Rendering is decided at render time by the
component, not at registration time by the registry — the two concerns were never
actually coupled.

## Decision

1. Builtin tool styling attaches at the component layer (`tool-tags/builtin-tool-renderers.ts`),
   name-first for the seven builtin names, with `renderShell` forced `"default"`. The
   extension stops claiming builtin names; dedup order becomes irrelevant.
2. `edit` is the single exception: its registration remains because it is the activation
   bridge for pi-ctx-kit's enhanced edit (schema/execute swap), i.e. a behavior provider,
   not styling. Its renderers are also exported into the patch map.
3. Elapsed metrics move out of execute wrappers: frozen renderer state, then
   `tool_execution_start/end` event records, then `result.details.__elapsedMs`.
4. `tool-tags/common.js` remains a stable primitive library for other packages
   (pi-utils `loadDroidRenderers`); signature changes are additive-optional only.

## Consequences

- Same-name tool providers keep their definitions and executors regardless of package
  order; every winner (builtin, pi-utils, third-party) still renders with droid styling.
- Name-first precedence means a provider shipping its own renderer for one of the seven
  names is visually overridden (its schema/execute still win). This matches today's
  behavior in every working configuration and keeps builtin `edit`'s native renderer
  from regressing the droid look.
- Tool-call footers show `--` elapsed for calls with no live timing source (e.g.
  history resumed from disk that predates this change). Acceptable: cosmetic, and
  bounded by session lifetime.
- The component patch depends on prototype method names (`getCallRenderer`,
  `getResultRenderer`, `getRenderShell`) that are not a public pi API. This risk is
  already accepted repo-wide (same pattern as quick-edit, default-badge, footer patch);
  smoke tests fail loudly if the seam moves.
