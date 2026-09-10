# US-024 Collapsed thinking tail

## Status

implemented (uncommitted, awaiting review)

## Lane

normal (2 risk flags: existing behavior — the collapsed-thinking row that every preset renders today changes deliberately; weak proof — collapsed thinking is only pinned by two `hideThinking=true` fixtures in the Reasonix smoke and no fixture exercises streaming updates of a hidden run). Stronger validation required.

## Product Contract

When thinking blocks are hidden (Pi `hideThinkingBlock`, toggled by Ctrl+T / settings), the collapsed row is no longer a static label. It shows the label followed by a live peek at the **tail of the last line** of the thinking run, so a hidden run still reads as streaming while the model thinks, then settles when the run is done.

Approved mockup (user-approved 2026-09-06):

```
live:     ◆ Thinking... ▸ …nên child index phải đi theo rendered run, không phải raw block
settled:  ◆ Thinking... · …nên child index phải đi theo rendered run, không phải raw block
narrow:   ◆ Thinking...                       (byte-identical to today when no room for a tail)
expanded: (Pi 0.85 click on the row)          (full thinking render, byte-identical to today)
```

Decisions made during design (all final):

- **Variant A, one row.** The collapsed row is always exactly one line high, so no layout jump between live and settled states and no physical-sync repaint.
- **Tail fills the width.** No source cap: the tail takes every column left after the prefix/gutter, label, and marker, and is clamped by the terminal width only.
- **Left-truncated.** New tokens append at the end of the line, so the visible part is the *end* of the last line; when truncated the tail starts with `…`. When the whole last line fits, no `…`.
- **Two styled segments, not one.** The label keeps today's thinking styling (see Design Notes). The tail and the marker are **not italic** and use the `collapsedThinkingTailColor` theme extra (default token `muted`).
- **Marker encodes state.** `▸` while the run is live, `·` once settled. Same tail text, one glyph changes.
- **Settled = frozen tail.** No `Thought for Ns`, no line count: zero extra state, deterministic on session resume.
- **No new timer.** Motion comes from the existing presentation buffer (`performance/debounce-update.ts`, 33 ms drip-feed of every text/thinking delta) plus the render throttle. A stalled model shows a still row; the footer working loader already signals liveness.
- **Label is not ours.** The label text is `component.hiddenThinkingLabel` verbatim (default `Thinking...` from Pi core), so `ctx.ui.setHiddenThinkingLabel(...)` from any other extension keeps working. Never hardcode the label.
- **Opt-out, on by default.** Config key `collapsedThinking: "tail" | "label"`, default `"tail"`. `"label"` reproduces today's output byte-for-byte.

## Relevant Product Docs

- `docs/product/overview.md` — configuration table (add `collapsedThinking`), presentation section (collapsed thinking row).
- `README.md` — configuration table.
- `docs/ARCHITECTURE.md` — `messages/` boundary; note that collapsed-thinking rendering is owned by `messages/assistant-prefix.ts` on top of the rendered-run model from `messages/assistant-content-runs.ts`.

## Acceptance Criteria

- With `collapsedThinking: "tail"` and thinking hidden, every collapsed thinking row renders `<label> <marker> <tail>` on exactly one line, with `visibleWidth(row) <= width` at every width 1..200, on both the Pi 0.78 per-block layout and the Pi 0.84+ grouped layout (`getAssistantContentRuns` already resolves which one the host uses).
- `tail` is the last non-empty line of the run text (`run.text`, i.e. the grouped thinking text Pi core hands to that child), after stripping a leading Markdown block marker (`#`×1–6, `-`, `*`, `+`, `N.`, `>`) and collapsing internal whitespace. No Markdown rendering; inline emphasis characters stay as-is.
- When the cleaned last line is wider than the tail budget, the row shows the **last** `budget − 1` columns of it prefixed with `…`; a double-width grapheme is never split (drop it whole, the row may end one column short). When it fits, no `…`.
- Tail budget = `bodyWidth − 1 (core Text paddingX) − visibleWidth(label) − 1 − visibleWidth(marker) − 1`. If the budget is `< 16`, the row is the label alone and is byte-identical to `collapsedThinking: "label"` at that width.
- Live iff `message.stopReason === undefined` **and** no content block of any type (`text`, `thinking`, `toolCall`) follows the run's last block. Otherwise settled. This makes aborted/errored/resumed messages settled with `·`, and a run whose text answer or tool call has started settled while the answer streams.
- The row text is derived only from the `message` passed into our patched `updateContent` — the presentation-buffered message — never from `message_update` events or any other source, so the tail advances at the same drip-fed cadence as visible text.
- Hidden-state detection honours Pi 0.85 per-run overrides: `component.thinkingVisibilityOverrides?.get(runOrdinal) ?? component.hideThinkingBlock`, where `runOrdinal` is the 0-based index of the thinking run among the message's thinking runs. A run expanded by click renders exactly as today (existing visible-thinking path, untouched). Pi 0.78 has no override map and falls through to `hideThinkingBlock`.
- Prefix/gutter behaviour is unchanged: the row is emitted at `bodyWidth` with the same 1-column leading padding Pi core's `Text(label, 1, 0)` has, so the existing `prefix` / `gutter` / `plain` modes in `patchThinkingChildren` and the outer `patchedAssistantMessageRender` keep placing the `◆` marker and gutter indent exactly as they do today under `droid` and `reasonix`.
- Styling: the label carries the same escapes as today's collapsed label after `styleThinkingLine` (under `reasonix` compact: `thinkingText` + italic; under `droid`: `thinkingText`, italic stripped). The marker and tail carry the resolved `collapsedThinkingTailColor` escape and **no** `\x1b[3m` anywhere inside them. Segments are styled independently and joined afterwards; `styleThinkingLine` must not be applied to the whole row (its compact branch strips all ANSI and would recolour the tail).
- `collapsedThinking: "label"` and visible thinking (`hideThinkingBlock=false`) are byte-identical to the output at base commit `2382b24` for every existing fixture.
- Config: `collapsedThinking` is scaffolded into new config files, backfilled when missing, and any invalid value normalises to `"tail"`, following the `tasksWidgetStyle` pattern in `config.ts`.
- Theme extra `collapsedThinkingTailColor` resolves like every other colour extra (token alias or hex, via the existing theme-extras resolver), default `muted`; all 26 companion themes resolve it.
- Idempotent on reload/resume: no new prototype patch; the per-child `__plainThinkingPatched` flag and the existing `PATCHED` symbol remain the only guards. No new timers, no new listeners in `index.ts`.

## Design Notes

- Seam: `makeThinkingChildPlain(child, mode)` in `messages/assistant-prefix.ts` already owns the render of the collapsed child (Pi 0.78: `Text`; Pi 0.85: `MouseRegion(Text)` — overriding `render` on the wrapper keeps the click handler intact). Extend it to receive the `run`, its ordinal, and the live flag; when the run is hidden and config is `"tail"`, build the row from `run.text` instead of calling `baseRender`. Everything else (`prefixFirstNonEmptyLine`, `addAssistantGutter`, compact layout) stays as-is.
- `patchThinkingChildren(component, runs)` computes `hidden` and `live` per run; it already iterates runs in order and knows what follows. Add the "no block after the run" test on `message.content`; if the run model needs the run's last block index, add `endBlockIndex` to `AssistantContentRun` in `messages/assistant-content-runs.ts` (both `buildRuns` branches set it; the probe/child-count logic is untouched).
- Helper: a width-safe "keep the last N columns" function does not exist yet. Add `safeTakeTailToWidth(text, maxWidth, ellipsis = "…")` next to `safeTruncateToWidth` in `render-budget.ts` (same grapheme/width primitives). Input is plain text (no ANSI) by construction.
- Config: `CollapsedThinkingStyle = "tail" | "label"` in `config.ts`, wired exactly like `TasksWidgetStyle` (type guard, normaliser, `DEFAULTS`, scaffold/backfill in `loadConfig`). Read through `getConfig()` at render time like other presentation switches.
- Theme extra: add `collapsedThinkingTailColor: "muted"` to `HARDCODED_DEFAULTS` in `theme/theme-extras.ts`; resolve with `fgHex(activeTheme, color, text)` like `assistantPrefixColor`.
- Not in scope, record as follow-ups (do not fix here): (1) our three `updateContent` wrappers drop Pi 0.85's second `isStreaming` argument, so `component.isStreaming` and `createMarkdownTransform(..., isStreaming)` are always `false` through our chain — separate maintenance story; (2) `streaming-markdown-cache.ts:284` skips thinking runs on `hideThinkingBlock` only and ignores 0.85 per-run overrides — harmless cache miss, separate story if ever needed.
- Base commit: `2382b24` (v2.12.1). No version bump, no CHANGELOG section in this story; the release step adds them.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `npm run test:reasonix-conversation` extended with the P1–P11 cases below, run against the real Pi 0.78 core in `node_modules` plus the existing grouped-layout stub for 0.84+. |
| Integration | Existing Reasonix, session-resume, core-message-blocks, and streaming-cache cases stay green unchanged; `npm run check`; `srcwalk review`; `git diff --check`. |
| E2E | One real-core run of the same smoke inside a throwaway sandbox on Pi/TUI 0.85.1 (same recipe as issue #20), evidence pasted into the story. |
| Platform | n/a |
| Release | Deferred to the release step (version bump, CHANGELOG, tag, npm). |

Verification contract (red-first where marked, then green):

- P1 live tail (red-first): hidden run, `stopReason` undefined, no block after it → row is `<label> ▸ <tail>`, tail equals the cleaned last line, `visibleWidth <= width`; for both core layouts and for 1/2/3 consecutive thinking blocks (grouped layout: tail comes from the last block of the group).
- P2 settled: same fixtures with `stopReason: "stop"`, `"aborted"`, `"error"` → marker `·`, identical tail.
- P3 answer-follows: thinking → text (streaming, no `stopReason`) → the thinking row is settled (`·`); thinking → toolCall → settled.
- P4 truncation: last line of 300 ASCII columns at widths 40/80/160 → tail starts with `…`, ends with the last columns of the line, `visibleWidth === bodyWidth` budget math holds; CJK and emoji last lines → no split grapheme, never over budget. Monotonic: widening never shows fewer trailing characters.
- P5 narrow: widths where the budget `< 16` → byte-identical to `collapsedThinking: "label"`.
- P6 opt-out and visible-thinking pins: capture the base-commit output of every existing `hideThinking=true` and `hideThinking=false` fixture at 46/80 columns; `"label"` and visible thinking must match byte-for-byte.
- P7 override (0.85): stub component with `thinkingVisibilityOverrides = new Map([[0, false]])` and `hideThinkingBlock=true` → run 0 renders the visible-thinking path, run 1 renders the tail row. 0.78 (no map) → both collapsed.
- P8 label verbatim (red-first): `hiddenThinkingLabel = "Reasoning…"` → appears verbatim; the string `Thinking...` must not appear anywhere in the module source as a literal.
- P9 presentation-buffered source: call `updateContent` with thinking `"alpha\nbeta"` then `"alpha\nbeta gamma"` on the same component → row tail follows the second message; feeding a different text through a simulated event must not change the row.
- P10 style split: label segment contains the `thinkingText` escape (and `\x1b[3m` only under `reasonix`); the marker+tail segment contains the resolved `muted` escape and never `\x1b[3m`; a theme extra `collapsedThinkingTailColor: "#ff0000"` recolours the tail only.
- P11 interleaved runs: thinking → text → thinking(live) → first row `·`, last row `▸`; `prefix`/`gutter` modes put the `◆` and the indent exactly where they are today.
- Mutation ritual (each must turn at least one case red; record which): M1 marker never switches to `·`; M2 truncate from the right instead of the left; M3 live ignores `stopReason`; M4 label hardcoded; M5 tail styled with `styleThinkingLine` (italic leaks into the tail); M6 budget threshold removed (narrow widths overflow); M7 `endBlockIndex`/"block after run" check removed (toolCall-follows stays live).
- Config smoke: scaffold default `"tail"`, invalid value → `"tail"`, `"label"` preserved, missing key backfilled — in the same smoke, following the existing config-case helper.

## Harness Delta

None expected. If the smoke grows past what `scripts/reasonix-conversation-smoke.mjs` can hold readably, split the collapsed-thinking cases into `scripts/collapsed-thinking-smoke.mjs` and wire `test:collapsed-thinking` into `npm test` — report it here.

## Evidence

Implementation is uncommitted on branch `feat/us-024-collapsed-thinking-tail` (base `2382b24`), awaiting review.

**Unit — `npm run test:collapsed-thinking`** (`scripts/collapsed-thinking-smoke.mjs`, real Pi 0.78 core + grouped-layout stub):
- P1 live tail: real 0.78 per-block row renders `<label> ▸ <tail>`; grouped layout 1/2/3 consecutive blocks tails from the last block of the group.
- P2 settled: `stop` / `aborted` / `error` → `·`, same tail.
- P3 thinking→text (streaming) and thinking→toolCall → settled `·`.
- P4 truncation: 300-col ASCII at 40/80/160 → leading `…`, visible part is a suffix of the line, within width, monotonic; CJK and emoji tails are whole-grapheme suffixes (no split).
- P5 narrow (`budget < 16`) rows are byte-identical to `collapsedThinking: "label"`.
- P6 `"label"` and `hideThinkingBlock=false` are byte-identical to base-commit goldens for 7 fixtures × {hidden, visible} × {46, 80} (`scripts/fixtures/collapsed-thinking-base.json`).
- P7 `thinkingVisibilityOverrides = Map([[0, false]])` → run 0 takes the visible path, run 1 the tail row; a host with no override map collapses both.
- P8 custom `hiddenThinkingLabel` appears verbatim; `assistant-prefix.ts` contains no `Thinking...` literal.
- P9 the tail follows only the message passed into `updateContent`; no event/timer source is added.
- P10 style split: reasonix label stays italic + `thinkingText`, droid label has italics stripped; marker/tail resolve `collapsedThinkingTailColor` (default `muted`) and never contain `\x1b[3m`; an explicit `#ff0000` extra recolours only the tail.
- P11 interleaved runs keep the `•` / gutter column placement and settle independently.
- Config: scaffold `"tail"`, invalid value → `"tail"` (backfilled on disk), `"label"` preserved, missing key backfilled.
- `safeTakeTailToWidth` unit cases (short pass-through, left-truncate, width 1, width 0, whole wide grapheme).

**Mutation ritual (M1–M7)** — each mutation turns at least one case red; recorded per mutation:
| Mutation | Cases that went red |
| --- | --- |
| M1 marker never switches to `·` | P2, P3, P11 |
| M2 truncate from the right instead of the left | P4 (ASCII + wide grapheme) |
| M3 live ignores `stopReason` | P2 |
| M4 label hardcoded | P8 |
| M5 tail styled with `styleThinkingLine` | P10 (style split + theme extra) |
| M6 budget threshold removed | P5 |
| M7 `endBlockIndex` / block-after check removed | P3, P11 |

**Integration**: `npm run check` green (typecheck + all smokes + `npm pack --dry-run`); `npm run test:theme-extras` extended to prove all 26 bundled companion themes resolve `collapsedThinkingTailColor`; `npm run test:reasonix-conversation`, `test:core-message-blocks`, `test:session-resume-styling` stay green unchanged; `srcwalk review`; `git diff --check`.

**E2E (Pi/TUI 0.85.1 sandbox)** — throwaway (`git archive HEAD` + working-tree overlay + `npm ci` + `npm install --no-save @earendil-works/pi-coding-agent@0.85.1 @earendil-works/pi-tui@0.85.1`):
```text
node scripts/collapsed-thinking-smoke.mjs   -> collapsed thinking smoke ok
npm run test:reasonix-conversation          -> reasonix conversation presentation smoke ok
```
Base-commit 0.85.1 goldens were captured from a second clean `git archive HEAD` sandbox pinned to 0.85.1, so P6 proves byte-identity on the 0.85.1 grouped layout too. (`npm run typecheck` on 0.85.1 still reports the pre-existing `editor/box-editor.ts` `CustomEditor` private-member incompatibility — unrelated to this story.) The E2E smoke drives real Pi/TUI 0.85.1 components in a sandbox; it is not a live interactive TUI session.

## Notes for review

- Grouped-layout coverage needed an optional `componentClass` parameter on `installAssistantMessagePrefix` (mirrors `installAssistantStreamingMarkdownCache(ComponentClass)`); the one-argument call in `index.ts` is unchanged and no product behavior depends on it.
- Liveness is literal to the contract: on the per-block (0.78) layout a thinking block followed by another thinking block is settled (`·`), while the grouped (0.84+) layout folds them into one live row (`▸`). Both read correctly, but it is a visible per-host difference — flagged for review.
- `safeTakeTailToWidth` guards `maxWidth <= 0`, so a removed budget threshold cannot overflow; it instead drops the tail and P5 catches the difference.
