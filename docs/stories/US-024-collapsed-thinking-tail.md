# US-024 Collapsed thinking tail

## Status

in-progress (round 2: liveness rework after live test; round 1 committed locally as f9c7e1a, not pushed)

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
- **Two styled segments, not one.** The label is a short upright tag: bold `thinkingText`, never italic, identical under every preset (round 4, operator decision 2026-09-10 — with the progress dots gone the label no longer reads as "content in progress"). The tail and the marker are **not italic** and use the `collapsedThinkingTailColor` theme extra (default token `muted`).
- **Marker encodes state.** `▸` while the run is live, `·` once settled. Same tail text, one glyph changes.
- **Settled = frozen tail.** No `Thought for Ns`, no line count: zero extra state, deterministic on session resume.
- **No new timer.** Motion comes from the existing presentation buffer (`performance/debounce-update.ts`, 33 ms drip-feed of every text/thinking delta) plus the render throttle. A stalled model shows a still row; the footer working loader already signals liveness.
- **Label is not ours.** The label text comes from `component.hiddenThinkingLabel` (default `Thinking...` from Pi core) with its trailing progress dots (`.`/`…`/whitespace) trimmed — the marker carries the state now, so `Thinking... ·` would contradict itself, so `ctx.ui.setHiddenThinkingLabel(...)` from any other extension keeps working. Never hardcode the label.
- **Opt-out, on by default.** Config key `collapsedThinking: "tail" | "label"`, default `"tail"`. `"label"` reproduces today's output byte-for-byte.

## Relevant Product Docs

- `docs/product/overview.md` — configuration table (add `collapsedThinking`), presentation section (collapsed thinking row).
- `README.md` — configuration table.
- `docs/ARCHITECTURE.md` — `messages/` boundary; note that collapsed-thinking rendering is owned by `messages/assistant-prefix.ts` on top of the rendered-run model from `messages/assistant-content-runs.ts`.

## Acceptance Criteria

- With `collapsedThinking: "tail"` and thinking hidden, every collapsed thinking row renders `<label> <marker> <tail>` on exactly one line, with `visibleWidth(row) <= width` at every width 1..200, on both the Pi 0.78 per-block layout and the Pi 0.84+ grouped layout (`getAssistantContentRuns` already resolves which one the host uses).
- `tail` is the last non-empty line of the run text (`run.text`, i.e. the grouped thinking text Pi core hands to that child), after stripping a leading Markdown block marker (`#`×1–6, `-`, `*`, `+`, `N.`, `>`) and collapsing internal whitespace. No Markdown rendering; inline emphasis characters stay as-is.
- When the cleaned last line is wider than the tail budget, the row shows the **last** `budget − 1` columns of it prefixed with `…`; a double-width grapheme is never split (drop it whole, the row may end one column short). When it fits, no `…`. If the cut lands on whitespace, the whitespace directly after `…` is dropped (`…0.84+ groups`, never `… 0.84+ groups`); the row may end one more column short. This trim is done at the call site in `buildCollapsedThinkingRow`, not inside `safeTakeTailToWidth`, whose contract stays "keep the last N columns".
- Tail budget = `bodyWidth − 1 (core Text paddingX) − visibleWidth(label) − 1 − visibleWidth(marker) − 1`. If the budget is `< 16`, the row is the label alone and is byte-identical to `collapsedThinking: "label"` at that width.
- Live iff **the component is receiving the assistant stream the extension is currently tracking** **and** no content block of any type (`text`, `thinking`, `toolCall`) follows the run's last block. Otherwise settled. `message.stopReason` is **not** a signal: `pi-ai` creates every streaming partial with `stopReason: "stop"` from the first delta (`providers/anthropic.js:298`, same in every provider), so a rule keyed on `stopReason === undefined` renders `·` for the whole stream (live-test finding 2026-09-10; the original contract had this wrong). The stream is tracked by the extension: it begins on assistant `message_start`, is refreshed on assistant `message_update`, and ends on `message_end`, `agent_end`, and `session_shutdown`. `agent-session` emits every event to extensions **before** UI listeners, so the flag is already correct when Pi core calls `updateContent` — including the final `updateContent(finalMessage)` after `message_end`, which therefore renders settled. Consequences: aborted/errored/resumed messages are settled with `·`; older components re-rendered during a newer stream (resize, theme change, Ctrl+T) stay settled; a run whose text answer or tool call has started is settled while the answer streams.
- The row text is derived only from the `message` passed into our patched `updateContent` — never from `message_update` events or any other source. (Note: the 33 ms presentation buffer in `performance/debounce-update.ts` keys its streaming branch on the same wrong `stopReason === undefined` test and is therefore inactive during real streaming today; the tail advances at the provider's raw delta cadence until that follow-up lands. Not fixed here.)
- Hidden-state detection honours Pi 0.85 per-run overrides: `component.thinkingVisibilityOverrides?.get(runOrdinal) ?? component.hideThinkingBlock`, where `runOrdinal` is the 0-based index of the thinking run among the message's thinking runs. A run expanded by click renders exactly as today (existing visible-thinking path, untouched). Pi 0.78 has no override map and falls through to `hideThinkingBlock`.
- Prefix/gutter behaviour is unchanged: the row is emitted at `bodyWidth` with the same 1-column leading padding Pi core's `Text(label, 1, 0)` has, so the existing `prefix` / `gutter` / `plain` modes in `patchThinkingChildren` and the outer `patchedAssistantMessageRender` keep placing the `◆` marker and gutter indent exactly as they do today under `droid` and `reasonix`.
- Styling: the label is `theme.bold(theme.fg("thinkingText", label))` — bold, upright, the same under `reasonix` and `droid` (`styleThinkingLine` is not applied to it). The marker and tail carry the resolved `collapsedThinkingTailColor` escape and **no** `\x1b[3m` anywhere inside them. Segments are styled independently and joined afterwards; `styleThinkingLine` must not be applied to the whole row (its compact branch strips all ANSI and would recolour the tail).
- `collapsedThinking: "label"` and visible thinking (`hideThinkingBlock=false`) are byte-identical to the output at base commit `2382b24` for every existing fixture.
- Config: `collapsedThinking` is scaffolded into new config files, backfilled when missing, and any invalid value normalises to `"tail"`, following the `tasksWidgetStyle` pattern in `config.ts`.
- Theme extra `collapsedThinkingTailColor` resolves like every other colour extra (token alias or hex, via the existing theme-extras resolver), default `muted`; all 26 companion themes resolve it.
- Idempotent on reload/resume: no new prototype patch; the per-child `__plainThinkingPatched` flag and the existing `PATCHED` symbol remain the only guards. No new timers, no new listeners in `index.ts`.

## Design Notes

- Seam: `makeThinkingChildPlain(child, mode)` in `messages/assistant-prefix.ts` already owns the render of the collapsed child (Pi 0.78: `Text`; Pi 0.85: `MouseRegion(Text)` — overriding `render` on the wrapper keeps the click handler intact). Extend it to receive the `run`, its ordinal, and the live flag; when the run is hidden and config is `"tail"`, build the row from `run.text` instead of calling `baseRender`. Everything else (`prefixFirstNonEmptyLine`, `addAssistantGutter`, compact layout) stays as-is.
- `patchThinkingChildren(component, runs, message)` computes `hidden` and `live` per run; it already iterates runs in order and knows what follows. The "no block after the run" test uses `endBlockIndex` on `AssistantContentRun` in `messages/assistant-content-runs.ts` (both `buildRuns` branches set it; the probe/child-count logic is untouched).
- Streaming state seam (added after the live-test finding): new module `messages/assistant-streaming-state.ts` is the single owner of "which assistant component is receiving the live stream". API: `beginAssistantStream(message)` creates a fresh token object (`activeToken = {}`) and records `activeMessage = message`; `trackAssistantStreamMessage(message)` (from `message_update`) refreshes `activeMessage` and begins if inactive; `endAssistantStream()` clears both. `attachComponentToStream(component, message): boolean` must be called by every `updateContent` wrapper **before** delegating to the base method, with the message object it received: on the component's first-ever call it stores a tag under `Symbol.for("pi-droid-styling.assistant-stream")` — the active token iff a stream is active **and `message === activeMessage`** (Pi passes the very `event.message` object the extension saw at `message_start`/`message_update` into the streaming component's `updateContent` — `interactive-mode.js:2224-2233` — whereas a history component is constructed with its own historical message object), otherwise a frozen `NONE` sentinel; on later calls the tag is never rewritten. It returns `activeToken !== null && tag === activeToken`. `isComponentOnActiveStream(component)` is the read-only form (never tags). Why not `lastMessage === undefined` as the "fresh component" test: the core constructor calls `updateContent(message)` while `lastMessage` is still `undefined` too, so it cannot separate the streaming component from a history component rebuilt mid-stream (the residual gap Xi flagged in round 2). Why message identity does not break with presentation-buffer clones: the buffer is the outermost wrapper and tags with the original message before it clones; every inner wrapper then reads the existing tag (tag-once). Token identity (not a counter) means tags from a previous extension load can never collide after reload. `index.ts` wires the seam into the handlers that already exist: `message_start` (assistant role only) → `beginAssistantStream(event.message)`; `message_update` (assistant) → `trackAssistantStreamMessage(event.message)`; `message_end`, `agent_end`, `session_shutdown` → `endAssistantStream()`. No timer, no new prototype patch. `patchedAssistantUpdateContent` calls `attachComponentToStream(this, message)` first (before the base call), and a run is live iff that returned `true` **and** `!hasBlockAfter(...)`. Known, accepted: an extension reload in the middle of a stream leaves the current streaming component tagged with the previous load's token, so it renders settled until the next message. US-025 reuses the same call from `debounce-update` and `finished-render-cache`.
- Helper: a width-safe "keep the last N columns" function does not exist yet. Add `safeTakeTailToWidth(text, maxWidth, ellipsis = "…")` next to `safeTruncateToWidth` in `render-budget.ts` (same grapheme/width primitives). Input is plain text (no ANSI) by construction.
- Config: `CollapsedThinkingStyle = "tail" | "label"` in `config.ts`, wired exactly like `TasksWidgetStyle` (type guard, normaliser, `DEFAULTS`, scaffold/backfill in `loadConfig`). Read through `getConfig()` at render time like other presentation switches.
- Theme extra: add `collapsedThinkingTailColor: "muted"` to `HARDCODED_DEFAULTS` in `theme/theme-extras.ts`; resolve with `fgHex(activeTheme, color, text)` like `assistantPrefixColor`.
- Not in scope, record as follow-ups (do not fix here): (1) our three `updateContent` wrappers drop Pi 0.85's second `isStreaming` argument, so `component.isStreaming` and `createMarkdownTransform(..., isStreaming)` are always `false` through our chain — separate maintenance story; (2) `streaming-markdown-cache.ts:284` skips thinking runs on `hideThinkingBlock` only and ignores 0.85 per-run overrides — harmless cache miss, separate story if ever needed; (3) `performance/debounce-update.ts` (streaming branch) and `performance/finished-render-cache.ts:91` both treat `stopReason === undefined` as "streaming", which never holds against real `pi-ai` partials — the presentation buffer is dead code and the finished cache engages during streaming (invalidated on every `updateContent`, so correct but pointless). Handled by US-025 on top of this seam (`attachComponentToStream`).
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

- P1 live tail (red-first): `beginAssistantStream()`, then `updateContent` of a hidden run with **`stopReason: "stop"`** (the real partial shape) and no block after it → row is `<label> ▸ <tail>`, tail equals the cleaned last line, `visibleWidth <= width`; for both core layouts and for 1/2/3 consecutive thinking blocks (grouped layout: tail comes from the last block of the group).
- P2 settled: (a) same fixtures after `endAssistantStream()` with `stopReason: "stop"`, `"aborted"`, `"error"` → `·`, identical tail; (b) a fixture with `stopReason` **undefined** and no active stream → `·` (pins that `stopReason` is not the signal); (c) event order: begin → `updateContent(partial)` is `▸` → end → `updateContent(final)` on the same component is `·`; (d) an older component (tagged during a previous stream token) re-rendered via `updateContent(lastMessage)` while a newer stream is active stays `·`; (e) a history component constructed **with** its own message object **while a stream is active** (Pi rebuilding history mid-stream) stays `·` — its message is not the tracked stream message; (f) the streaming component: first `updateContent` with the tracked message object during an active stream → `▸`; a later `updateContent` with a structural clone (`{ ...message, content: [...] }`) of the tracked message on the same component stays `▸` (tag-once; pins clone tolerance for US-025); (g) after `endAssistantStream()` and a new `beginAssistantStream(other)`, the previous component re-updated with its own `lastMessage` stays `·`.
- P3 answer-follows: thinking → text while the stream is active → the thinking row is settled (`·`); thinking → toolCall → settled.
- P4 truncation: last line of 300 ASCII columns at widths 40/80/160 → tail starts with `…`, ends with the last columns of the line, `visibleWidth <= bodyWidth` budget math holds; CJK and emoji last lines → no split grapheme, never over budget. Monotonic: widening never shows fewer trailing characters. Whitespace pin: a fixture whose cut lands exactly on a space renders `…` immediately followed by a non-space character (mutation M8: trim removed → red).
- P5 narrow: widths where the budget `< 16` → byte-identical to `collapsedThinking: "label"`.
- P6 opt-out and visible-thinking pins: capture the base-commit output of every existing `hideThinking=true` and `hideThinking=false` fixture at 46/80 columns; `"label"` and visible thinking must match byte-for-byte.
- P7 override (0.85): stub component with `thinkingVisibilityOverrides = new Map([[0, false]])` and `hideThinkingBlock=true` → run 0 renders the visible-thinking path, run 1 renders the tail row. 0.78 (no map) → both collapsed.
- P8 label source (red-first): `hiddenThinkingLabel = "Reasoning…"` → row shows `Reasoning ▸` (trailing dots trimmed, no `Reasoning…` left); the string `Thinking...` must not appear anywhere in the module source as a literal.
- P9 `updateContent` is the only source: with the stream active, call `updateContent` with thinking `"alpha\nbeta"` then `"alpha\nbeta gamma"` on the same component → row tail follows the second message; feeding a different text through a simulated event must not change the row.
- P10 style split: label segment contains the `thinkingText` escape (and `\x1b[3m` only under `reasonix`); the marker+tail segment contains the resolved `muted` escape and never `\x1b[3m`; a theme extra `collapsedThinkingTailColor: "#ff0000"` recolours the tail only.
- P11 interleaved runs (stream active): thinking → text → thinking(live) → first row `·`, last row `▸`; `prefix`/`gutter` modes put the `◆` and the indent exactly where they are today.
- Mutation ritual (each must turn at least one case red; record which): M1 marker never switches to `·`; M2 truncate from the right instead of the left; M3 live keyed on `stopReason === undefined` instead of the stream seam (must be red on P1 and P2b); M3b live ignores the component tag (older/history component during a newer stream goes `▸`; must be red on P2d); M3c first-call tag ignores message identity (any first call during a stream tags the active token; must be red on P2e); M3d tag rewritten on every call instead of once (must be red on P2f clone case or P2d); M4 label hardcoded; M5 tail styled with `styleThinkingLine` (italic leaks into the tail); M6 budget threshold removed (narrow widths overflow); M7 `endBlockIndex`/"block after run" check removed (toolCall-follows stays live); M9 label dots not trimmed (P1 grouped, P4 whitespace pin, P8 red); M10 label bold removed (P10 red).
- Config smoke: scaffold default `"tail"`, invalid value → `"tail"`, `"label"` preserved, missing key backfilled — in the same smoke, following the existing config-case helper.

## Harness Delta

None expected. If the smoke grows past what `scripts/reasonix-conversation-smoke.mjs` can hold readably, split the collapsed-thinking cases into `scripts/collapsed-thinking-smoke.mjs` and wire `test:collapsed-thinking` into `npm test` — report it here.

## Evidence

Round 1 is committed locally as `f9c7e1a`; the round-2/3 liveness rework is uncommitted on `feat/thinking-tail-stream-state`, awaiting review.

**Live-test finding that drove round 2:** `pi-ai` builds every streaming partial with `stopReason: "stop"` from the first delta (`providers/anthropic.js` and every provider), so the original `stopReason === undefined` rule rendered `·` for a whole real stream. Round 3 closes the residual gap round 2 flagged: `lastMessage === undefined` cannot separate the streaming component from a history component rebuilt mid-stream (the core constructor calls `updateContent(message)` while `lastMessage` is still undefined), so the tag discriminator is **message identity**.

**Streaming seam** — `messages/assistant-streaming-state.ts`: `beginAssistantStream(message)` (fresh token + tracked message), `trackAssistantStreamMessage(message)` (refresh + begin if inactive), `endAssistantStream()`, `attachComponentToStream(component, message)` (tag-once, called before the base delegate), `isComponentOnActiveStream(component)` (read-only, for US-025). Wired into the existing `index.ts` handlers (`message_start` → begin, `message_update` → track, `message_end`/`agent_end`/`session_shutdown` → end); no new listener, timer, or prototype patch. Identity is real, not assumed: `agent-session._emitExtensionEvent` builds `{ type, message: event.message }` and `_emit(event)` then hands the same `event.message` object to the UI listener, which passes it into the streaming component's `updateContent` (`interactive-mode.js:2224-2233`). A history component is built with its own historical object. Clones stay live because the outer presentation buffer tags with the original before cloning (tag-once). Known, accepted: an extension reload mid-stream leaves the current component tagged with the previous load's token and renders settled until the next message.

**Unit — `npm run test:collapsed-thinking`** (`scripts/collapsed-thinking-smoke.mjs`, real Pi 0.78 core + grouped-layout stub; `withActiveStream(message, fn)` marks the stream with the same message object fed to `updateContent`):
- P1 live tail: `beginAssistantStream(message)` + `stopReason: "stop"` renders `<label> ▸ <tail>`; real 0.78 per-block and grouped stub 1/2/3 blocks (tail from the last block).
- P2a after `endAssistantStream()` with `stop`/`aborted`/`error` → `·`, same tail.
- P2b `stopReason` undefined with no active stream → `·`.
- P2c begin → `updateContent(partial)` `▸` → end → `updateContent(final)` `·` on one component.
- P2d an older component (tagged in a previous token) re-updated during a newer stream stays `·`.
- P2e a history component constructed with its own message while a stream is active stays `·` (the round-2 gap).
- P2f the streaming component stays `▸` after a structural clone `{ ...message, content: [...] }` (tag-once clone tolerance).
- P2g after end + `beginAssistantStream(other)`, the previous component re-updated with its own `lastMessage` stays `·`.
- P3 thinking→text and thinking→toolCall while the stream is active → settled `·`.
- P4 truncation: 300-col ASCII at 40/80/160 → leading `…`, suffix of the line, within width, monotonic; CJK/emoji tails are whole-grapheme suffixes; whitespace pin (cut on a space → `…` immediately followed by non-space).
- P5 narrow (`budget < 16`) rows byte-identical to `collapsedThinking: "label"`.
- P6 `"label"` and `hideThinkingBlock=false` byte-identical to base-commit goldens for 7 fixtures × {hidden, visible} × {46, 80} (`scripts/fixtures/collapsed-thinking-base.json`, keyed by core version).
- P7 `thinkingVisibilityOverrides = Map([[0, false]])` → run 0 visible path, run 1 tail row; no override map collapses both.
- P8 custom `hiddenThinkingLabel` is the source with trailing progress dots trimmed (`Reasoning…` → `Reasoning ▸`); no `Thinking...` literal in `assistant-prefix.ts`.
- P9 the tail follows only the message passed into `updateContent`; no event or timer source.
- P10 style split: label bold + `thinkingText` and never italic under both reasonix and droid, bold never leaks into the tail; marker/tail resolve `collapsedThinkingTailColor` and never contain `\x1b[3m`; `#ff0000` recolours only the tail.
- P11 thinking→text→thinking (first run `·` at the `•` column, trailing run `▸`) and thinking→text→thinking→text (gutter indent, both `·`).
- Config: scaffold `"tail"`, invalid → `"tail"` (backfilled), `"label"` preserved, missing key backfilled; plus `safeTakeTailToWidth` unit cases.

**Mutation ritual** — each mutation turns at least one case red:
| Mutation | Cases that went red |
| --- | --- |
| M1 marker never switches to `·` | P2a, P2b, P2c, P2d, P2e, P2f, P3, P11 |
| M2 truncate from the right instead of the left | P4 (ASCII + whitespace pin) |
| M3 live keyed on `stopReason === undefined` | P1 (real + grouped), P2a, P2b, P2c, P2d, P2f, P2g, P8, P9, P10 (×2), P11 |
| M3b live ignores the component tag | P2d, P2e, P2g |
| M3c first-call tag ignores message identity | P2e |
| M3d tag rewritten on every call | P2f (clone case) |
| M4 label hardcoded | P8 |
| M5 tail styled with `styleThinkingLine` | P10 (×2) |
| M6 budget threshold removed | P5 |
| M7 block-after check removed | P3, P11 |
| M8 ellipsis whitespace trim removed | P4 whitespace pin |

**Integration**: `npm run check` green (typecheck + all smokes + `npm pack --dry-run`); `npm run test:theme-extras` proves all 26 bundled companion themes resolve `collapsedThinkingTailColor`; `npm run test:reasonix-conversation`, `test:core-message-blocks`, `test:session-resume-styling` stay green unchanged; `srcwalk review`; `git diff --check`. The `index.ts` handler wiring has no automated test — its ordering and message identity are verified against real core reads (`agent-session.js` extension-then-listeners emit order and shared `event.message`; `interactive-mode.js:2224-2233`); the operator live test is its end-to-end proof.

**E2E (Pi/TUI 0.85.1 sandbox)** — throwaway (`git archive HEAD` + working-tree overlay + `npm ci` + `npm install --no-save @earendil-works/pi-coding-agent@0.85.1 @earendil-works/pi-tui@0.85.1`):
```text
node scripts/collapsed-thinking-smoke.mjs   -> collapsed thinking smoke ok
npm run test:reasonix-conversation          -> reasonix conversation presentation smoke ok
```
Base-commit 0.85.1 goldens were captured from a second clean `git archive HEAD` sandbox pinned to 0.85.1, so P6 proves byte-identity on the 0.85.1 grouped layout too. (`npm run typecheck` on 0.85.1 still reports the pre-existing `editor/box-editor.ts` `CustomEditor` private-member incompatibility — unrelated.) The E2E smoke drives real Pi/TUI 0.85.1 components in a sandbox; it is not a live interactive TUI session.

## Notes for review

- Grouped-layout coverage needed an optional `componentClass` parameter on `installAssistantMessagePrefix` (mirrors `installAssistantStreamingMarkdownCache(ComponentClass)`); the one-argument call in `index.ts` is unchanged and no product behavior depends on it.
- Liveness is literal to the contract: on the per-block (0.78) layout a thinking block followed by another thinking block is settled (`·`), while the grouped (0.84+) layout folds them into one live row (`▸`). Both read correctly, but it is a visible per-host difference — flagged for review.
- `safeTakeTailToWidth` guards `maxWidth <= 0`, so a removed budget threshold cannot overflow; it instead drops the tail and P5 catches the difference.
- Round 3 resolves the residual gap flagged in round 2 with message identity: `attachComponentToStream` tags the active token on the component's first call only when the message it receives is the exact object the extension tracked at `message_start`/`message_update`. Verified against core: `agent-session` hands the same `event.message` object to the extension event and to the UI listener, and the UI passes it into the streaming component's `updateContent`; a history component carries its own object. The presentation-buffer clone case stays live because the outer buffer tags with the original before cloning (tag-once).
