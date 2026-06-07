# Test Matrix

Current proof status is stored in the Harness durable layer and queried with:

```bash
scripts/bin/harness-cli query matrix
```

This markdown file is a human-readable fallback for the initial brownfield baseline.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H-001 | Harness docs describe the existing TypeScript Pi UI styling extension accurately | no | no | no | yes | implemented | `srcwalk review --limit 10`, `srcwalk overview --scope . --depth 2`, `scripts/bin/harness-cli query matrix`, docs placeholder/upstream grep checks |
| US-008 | Fixed-zone selection supports drag range, double-click word, triple-click line, release-to-copy feedback, fixed cluster selection, OSC 52 clipboard propagation for terminal proxies, and auto-scroll on drag past viewport edges | no | yes | no | pending | implemented | `npm run test:user-zone-style` covers fixed cluster drag highlight/release-copy, terminal-scoped OSC 52 emission, long root selection release inside the fixed cluster, and auto-scroll content after drag past viewport edge with throttled/no-op scroll renders; repeated-copy transport uses immediate OSC 52 plus serialized host clipboard writes; `srcwalk review --scope .`; scoped TypeScript no-emit for `index.ts`, fixed-zone install/split/selection; `git diff --check`; `PI_DROID_PROFILE_BENCH_ROOT_LINES=6000 PI_DROID_PROFILE_BENCH_ITERATIONS=30 npm run profile:render`; manual jump/browser OSC 52 smoke pending |
| US-009 | Fixed-zone notices render in a reserved themed bottom footer row and copy feedback uses that local surface | yes | yes | no | pending | implemented | Pending validation for notice render smoke, scoped TypeScript no-emit, render profile, and srcwalk review; manual Pi themed pill smoke pending |
| US-014 | `customWorkingMessage` defaults to an object of loader labels, migrates legacy booleans, backfills partial objects, and renders configured loader labels | yes | yes | no | pending | implemented | `npm run test:working-message`; `git diff --check`; `semantic_review` |
| US-016 | Theme extras ending in `Color` resolve semantic theme tokens/aliases while non-color extras remain literal | yes | yes | no | no | implemented | `npm run test:theme-extras`; `npm run test:startup-resources`; `npm run test:working-message`; `git diff --check`; `semantic_review` |
| US-017 | `userZoneStyle` defaults to `gemini` and can select `droid` or `gemini` presets without changing theme format, with Gemini status/input/footer and fixed-zone footer hint behavior | yes | yes | no | pending | implemented | `npm run test:user-zone-style`; `npm run test:working-message`; `npm run test:theme-extras`; `git diff --check`; `semantic_review` |
| US-018 | Pi core special message blocks (Compaction, Skill, Branch, and Custom) render as boxed blocks with page-surface background, reload-safe patches, custom fallback deduplication, no-box fallback background, and distinct special titles | yes | yes | no | no | implemented | `npm run test:core-message-blocks`; `npm run test:user-zone-style`; `semantic_review working-tree` |

## Evidence Rules

- Unit proof covers pure helpers such as formatting, parsing, and status calculations when tests exist.
- Integration proof covers behavior that depends on Pi component APIs or Node process interactions.
- E2E proof covers user-visible Pi flows when an automated Pi runner exists.
- Platform proof covers terminal rendering, theme sync, shell/process behavior, and manual Pi smoke checks.
- Do not mark automated proof columns as passing until corresponding commands exist and have been run.
