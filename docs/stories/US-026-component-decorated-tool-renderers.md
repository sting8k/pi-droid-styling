# US-026 Decorate builtin tool renderers at the component layer

## Status

done (backfilled — implemented before this packet was written; see ADR 0006)

## Lane

normal (2 risk flags: existing behavior — every builtin tool call/result render path changes ownership from registry definitions to a prototype patch; weak proof — renderer resolution is only observable in the TUI, smoke tests assert module-level identity and precedence, not pixels). Validated by `test:builtin-tool-renderers` smoke plus full existing suite.

## Product Contract

Styling builtin tools must not require owning them.

pi dedups same-name tools across extensions first-wins by `settings.json` package order (`ExtensionRunner.getAllRegisteredTools`, pi 0.85.1). Re-registering `read/write/ls/find/grep/bash/edit` to attach renderers shadowed same-name tools from later packages — concretely pi-utils shell-bg `bash` (no `background` param at the wire) and fs-search `grep` (GitHub issue #24).

Contract after this story:

- `read`, `write`, `ls`, `find`, `grep`, `bash` are never registered by this extension. Their droid renderers are attached by patching `ToolExecutionComponent.prototype.getCallRenderer/getResultRenderer/getRenderShell` keyed on `toolName` (same technique as `installQuickEditRenderer`), name-first, shell forced `"default"`. Whichever tool wins the registry dedup gets droid styling; its definition and executor reach the model untouched.
- `edit` keeps its registration: it is the activation bridge for pi-ctx-kit's enhanced edit (`edit-core.ts` schema/description/execute when present, builtin fallback otherwise). Its renderers are also exported into the component patch map.
- Elapsed metrics no longer depend on execute wrappers: resolved per tool call from frozen renderer state → `tool_execution_start/end` event records (512-id eviction) → `result.details.__elapsedMs` (edit wrapper, pi-utils `withTiming`). Footers degrade to `--` for calls that predate all three sources (e.g. resumed history).
- `tool-tags/common.js` exports keep their signatures (new params are optional) because pi-utils `loadDroidRenderers` imports them.
- Patches are idempotent across reloads (Symbol.for guards), per AGENTS.md.

## Relevant Product Docs

- `docs/ARCHITECTURE.md` — tool-tags module boundary ("tool call renderers, badges, elapsed metrics")
- `CHANGELOG.md` — Unreleased entry
- GitHub issue #24 (mechanism and evidence)

## Implementation Notes

- `tool-tags/builtin-tool-renderers.ts` (new): the 7-name map + installer.
- `tool-tags/{read,write,ls,find,grep,bash,edit}.ts`: renderers extracted to exported `renderXxxCall/renderXxxResult`; registrations deleted except edit.
- `tool-tags/elapsed.ts`: state/event timing store (`recordToolCallTimingStart/End`, `markToolCallExecutionStarted`, `resolveToolCallElapsedMs`).
- `tool-tags/common.ts`: `formatBoxedFooter(…, context?)`, `renderCompactBoxedFooter({ toolCallId })`.
- `index.ts`: install patch at `session_start` after `installQuickEditRenderer`; timing records wired into existing `tool_execution_start/end` handlers.
- `scripts/builtin-tool-renderers-smoke.mjs`: mkdtemp-isolated smoke (concurrent-run safe); asserts 7-name resolution + renderer identity vs per-tool module exports, unknown-name fallthrough with exactly-once base calls, double-install no re-wrap, timing precedence, and that `registerToolCallTags` registers only `edit`.

## Validation

- `npm run typecheck` exit 0; full `npm test` (14 smokes incl. new one) exit 0; smoke verified 2× sequential + 2× parallel.
- `grep -rn "pi.registerTool" tool-tags/` → exactly one match (edit bridge).
- Live check: with this branch installed from a local path **before** pi-utils in `settings.json` packages, `bash` must offer `background:true` (shell-bg wins dedup) while keeping droid boxed rendering.
