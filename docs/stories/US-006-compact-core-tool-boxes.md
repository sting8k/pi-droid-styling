# US-006 Compact Collapsed Core Tool Boxes

## Status

implemented

## Lane

normal

## Product Contract

When Pi core tool calls for `read`, `write`, `ls`, `find`, and `grep` render in collapsed mode, the box should stay compact: one inline call/detail/metrics row. The metrics section is right-aligned in the row, each metric uses a fixed-width slot, and the section does not use square brackets. Collapsed mode must not show output summaries such as read line counts, listed item counts, found match/file counts, or wrote line counts. Expanded mode via Ctrl+O remains the place for output/body details.

## Relevant Product Docs

- `README.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- `read` collapsed call shows `Read`, inline `Path` detail, and right-aligned metrics in one row.
- `write` collapsed call shows `Write`, inline `Path` detail, and right-aligned metrics in one row.
- `ls` collapsed call shows `List`, inline `Path` detail, and right-aligned metrics in one row.
- `find` collapsed call shows `Find`, inline `Query` detail, and right-aligned metrics in one row.
- `grep` collapsed call shows `Search`, inline `Query` detail, and right-aligned metrics in one row.
- Error rendering remains diagnostic instead of hiding useful error output.
- Expanded Ctrl+O behavior keeps the existing output/body detail behavior.

## Design Notes

- UI surfaces: `tool-tags/` core tool renderers.
- Shared seam: compact call/footer helpers live in `tool-tags/common.ts` so the layout remains consistent across tool-specific renderers.
- Tool-specific params remain adapted per tool: `Path` for read/write/list, `Query` for find/search.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `.tmp/compact-metric-slot-smoke.ts` verifies compact helper renders one content row with right-aligned, unbracketed metrics and fixed metric separator columns. |
| Integration | Scoped TypeScript check for changed `tool-tags` files. |
| E2E | Not run; requires manual Pi terminal smoke. |
| Platform | Manual Pi terminal smoke recommended for visual confirmation. |
| Release | Not run. |

## Harness Delta

No Harness policy changes. This story records the normal-lane renderer behavior change and validation evidence.

## Evidence

- `compact metric slot smoke ok`
- `git diff --check` passed
- `semantic_review` passed for `tool-tags`
- Import resolution passed: relative `.js` imports resolve to `.ts`
- Scoped TypeScript check passed for `tool-tags/common.ts`, `tool-tags/read.ts`, `tool-tags/write.ts`, `tool-tags/ls.ts`, `tool-tags/find.ts`, `tool-tags/grep.ts`
- Full explicit TypeScript source check is blocked by pre-existing `messages/assistant-prefix.ts(225,30): Parameter 'renderedLine' implicitly has an 'any' type.`
