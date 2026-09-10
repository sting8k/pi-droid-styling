# US-025 Assistant stream state: activate the presentation buffer and finished-cache bypass

## Status

planned

## Lane

normal (2 risk flags: existing behavior — the streaming render path of every assistant message changes for real, because the presentation buffer has never actually run outside tests; weak proof — `performance/debounce-update.ts` and `performance/finished-render-cache.ts` have no smoke of their own). Stronger validation required.

## Product Contract

Assistant text and thinking reveal at the presentation cadence the extension already promises (33 ms ticks; small deltas shown at once, large chunks drip-fed over ~8 ticks at 12–120 graphemes per tick) **during real streaming**, and the finished-render cache stays out of the way while a message is streaming.

Today neither happens. Both modules decide "this message is streaming" with `message.stopReason === undefined`, but `pi-ai` creates every streaming partial with `stopReason: "stop"` from the first delta (`providers/anthropic.js:298`, same in every provider). So in production the buffer's streaming branch is dead code (every delta takes the immediate path) and the finished cache engages during streaming (harmless only because `updateContent` invalidates it each time). Found while live-testing US-024; US-024 introduced the correct signal.

Contract:

- `debounce-update`: a component receiving the live stream goes through the presentation buffer on every `updateContent`; any other `updateContent` (final message after `message_end`, history components, resize/theme/Ctrl+T re-renders, aborted/error finals) takes the immediate path exactly as today and cancels any pending tick for that component.
- `finished-render-cache`: `render` bypasses the cache while the component is receiving the live stream; once the stream has ended the existing keyed cache behaves as today.
- Reveal parameters (`STREAM_FLUSH_MS`, `TARGET_CATCHUP_FRAMES`, `MIN_REVEAL_CHARS`, `MAX_REVEAL_CHARS`) are **not** changed by this story.
- No new timers beyond the buffer's existing per-component tick; reload/shutdown disposal semantics unchanged (`setAssistantUpdateRenderRequester(undefined)` + requester generation guard).
- Order of prototype wrappers unchanged: `debounce-update` remains the outermost `updateContent` wrapper (installed after `assistant-prefix` and `streaming-markdown-cache`).

## Relevant Product Docs

- `docs/product/overview.md` — render hot-path patches for streaming assistant output.
- `docs/ARCHITECTURE.md` — `performance/` boundary; add that streaming state is owned by `messages/assistant-streaming-state.ts` and consumed by `assistant-prefix`, `debounce-update`, and `finished-render-cache`.

## Acceptance Criteria

- `performance/debounce-update.ts` `patchedUpdateContent` decides the branch with `attachComponentToStream(this, message)` (called before anything else, with the original message object — before any clone): `true` → streaming buffer; `false` → immediate path (`clearPresentationState`, `orig.call(this, message)` with the original message object, not a clone). `stopReason` is no longer read for this decision.
- `performance/finished-render-cache.ts` `getAssistantFinishedKey` returns `undefined` (bypass) when `isComponentOnActiveStream(component)`; the `stopReason === undefined` test is removed. The rest of the key is unchanged.
- `messages/assistant-streaming-state.ts` (from US-024) gains the read-only query `isComponentOnActiveStream(component): boolean` (returns whether the component's existing tag equals the active token; never tags). `attachComponentToStream` semantics are exactly as specified in US-024 (tag-once, message-identity rule at first tag, token identity).
- The final `updateContent(finalMessage)` that Pi core issues after `message_end` reaches `orig` immediately with the full message, and no later tick delivers a stale clone for that component.
- A history component constructed with its message while no stream is active, then re-updated via `updateContent(lastMessage)` during a later stream, never enters the buffer.
- `npm run profile:render` still runs; all existing suites stay green (the collapsed-thinking smoke installs only `assistant-prefix`, so US-024 goldens are unaffected).

## Design Notes

- Change surface: two conditionals plus one small read-only query. Do not restructure the buffer or the cache.
- `attachComponentToStream` is idempotent and tag-once, so calling it from both `debounce-update` (outermost) and `assistant-prefix` (inner) is correct by construction; whichever runs first tags, the other reads.
- Base: branch `feat/thinking-tail-stream-state`, on top of the US-024 round-2 commit. Separate commit so the buffer activation can be reverted independently if the operator's live test dislikes the cadence.
- No version bump / CHANGELOG here; the release step (2.13.0) covers US-024 + US-025 together.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | New `scripts/presentation-buffer-smoke.mjs` wired as `test:presentation-buffer` in `npm test`, driving the real Pi 0.78 `AssistantMessageComponent` with `installAssistantUpdateDebounce` + `installFinishedRenderCache` installed in the same order as `index.ts`. Cases B1–B7 below. |
| Integration | `npm run check`; `npm run profile:render`; `srcwalk review`; `git -c core.whitespace=-blank-at-eol diff --check`. |
| E2E | Same 0.85.1 sandbox recipe as US-024 for the new smoke; plus operator live test of streaming feel (Anthropic; a chunky provider if available). |
| Platform | n/a |
| Release | Deferred to the release step. |

Verification contract (red-first where marked):

- B1 drip (red-first): `beginAssistantStream()`, fresh component, `updateContent` with a 600-grapheme text partial shaped like a real `pi-ai` partial (**`stopReason: "stop"`**) → the first `orig` call receives a clone with fewer graphemes than the source; after awaiting ticks the displayed text converges to the full source; `orig` was called more than once. Red before the change because the immediate path delivers the full text in one call.
- B2 immediate when not streaming: no active stream → `orig` receives the **same object** (`===`) synchronously and no tick is scheduled; also with a message whose `stopReason` is `undefined` (pins that `stopReason` no longer matters).
- B3 final flush: begin → partial (buffer engaged, tick pending) → `endAssistantStream()` → `updateContent(final)` → `orig` called synchronously with the full final message; after waiting longer than one tick, no further `orig` call happens (pending tick cancelled).
- B4 history component: constructed **with** a message while no stream is active; begin a new stream; `updateContent(lastMessage)` on it → immediate path, `orig` gets the same object, no tick.
- B5 small delta: a partial growing by fewer than `MIN_REVEAL_CHARS` graphemes converges on the first tick (existing behavior preserved).
- B6 cache bypass: while on the active stream, two consecutive `render(80)` calls return different array instances and reflect a mutation of `lastMessage` made between them; after `endAssistantStream()` + a final `updateContent`, two consecutive `render(80)` calls return the same cached instance.
- B7 disposal: with a tick pending, `setAssistantUpdateRenderRequester(undefined)`; awaiting past the tick neither throws nor calls the requester.
- Mutation ritual (record which case goes red): MB1 branch keyed on `stopReason` again (B1, B2); MB2 final path does not cancel the pending tick (B3); MB3 cache bypass removed (B6); MB4 `attachComponentToStream` ignores message identity and tags any first in-stream call (B4 with a history component constructed mid-stream).

## Harness Delta

`test:presentation-buffer` added to `npm test`. The smoke uses real 33 ms waits (no fake clock); each case uses a fresh component so pending ticks cannot leak between cases, and it runs in ~2.3 s. No harness change beyond the new script.

## Evidence

Implementation uncommitted on `feat/thinking-tail-stream-state` (on top of US-024 commit `00ea809`), awaiting review.

**Change surface**: `performance/debounce-update.ts` — `patchedUpdateContent` now branches on `attachComponentToStream(this, message)` (called first, before any clone); `performance/finished-render-cache.ts` — `getAssistantFinishedKey` returns `undefined` when `isComponentOnActiveStream(component)`, and its `stopReason === undefined` test is gone. Reveal parameters, wrapper order, and the cache key are unchanged. `messages/assistant-streaming-state.ts` already shipped `isComponentOnActiveStream` in US-024.

**Unit — `npm run test:presentation-buffer`** (`scripts/presentation-buffer-smoke.mjs`, real Pi 0.78 `AssistantMessageComponent` + a delegate spy, `installAssistantUpdateDebounce` then `installFinishedRenderCache` in index.ts order):
- B1 drip (red-first): a 600-grapheme `stopReason: "stop"` partial is not delivered synchronously; the first delegate call is a clone with fewer graphemes, later ticks converge to the full source, and the delegate ran more than once. Red under MB1.
- B2 non-streaming update calls the delegate synchronously with the **same object** and schedules no tick; also for a message with `stopReason` undefined (pins stopReason out of the branch).
- B3 `endAssistantStream()` + final `updateContent` flushes the original object synchronously and cancels the pending tick (no later delegate call).
- B4 history components never enter the buffer: (i) constructed while no stream is active, re-updated during a later stream → immediate; (ii) constructed mid-stream with its own message object → immediate. Red under MB4.
- B5 a delta under `MIN_REVEAL_CHARS` converges on the first tick with no extra tick.
- B6 finished cache bypass: during the stream two renders separated by an in-place `lastMessage` mutation return different array instances, and the mutation is reflected after the next `updateContent`; after `endAssistantStream()` + final update two renders return the same instance. Red under MB3.
- B7 disposal: with a tick pending, `setAssistantUpdateRenderRequester(undefined)` neither throws nor calls the requester.
- Covers all 7 B cases listed in the story Validation (B1–B7; the story's B1–B7 list is exactly these).

**Mutation ritual**:
| Mutation | Cases that went red |
| --- | --- |
| MB1 branch keyed on `stopReason` again (red-first revert) | B1, B2 (+B3/B4/B5/B6/B7 collateral) |
| MB2 final path does not cancel the pending tick | B3 |
| MB3 cache bypass removed | B6 |
| MB4 tag ignores message identity | B4 (mid-stream) |

**Integration**: `npm run check` green (typecheck + all smokes + `npm pack --dry-run`); `npm run profile:render` runs (120 iterations); `npm run test:collapsed-thinking` and the other suites stay green (the collapsed-thinking smoke installs only `assistant-prefix`, so US-024 goldens are unaffected); `srcwalk review`; `git -c core.whitespace=-blank-at-eol diff --check` clean.

**E2E (Pi/TUI 0.85.1 sandbox)** — same throwaway recipe as US-024:
```text
node scripts/presentation-buffer-smoke.mjs  -> presentation buffer smoke ok
node scripts/collapsed-thinking-smoke.mjs   -> collapsed thinking smoke ok
npm run test:reasonix-conversation          -> reasonix conversation presentation smoke ok
```
The E2E smoke drives real Pi/TUI 0.85.1 in a sandbox; it is not a live interactive TUI session. Operator live test of the streaming feel (Anthropic, chunky provider if available) is the product-cadence proof.
