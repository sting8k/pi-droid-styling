# US-023 Nvim input frame branch label

## Status

planned

## Lane

normal (2 risk flags: existing behavior — the nvim statusline chrome ladder and its pinned ladder strings change deliberately; public contracts — `renderInputLineBorder`/`renderInputBoxFrame` gain an optional parameter, other presets must not change one byte). Stronger validation required.

## Product Contract

The nvim preset's `line` input frame embeds the git branch name into the TOP border rule of the input box, and the `⎇ branch` segment is REMOVED from the statusline right cluster (a value must never appear twice in the user zone).

Approved mockup (user-approved 2026-08-25):

```
──────────────────────────────── ⎇ main ─
 ❯  …input…
──────────────────────────────────────────
 HIGH  anthropic · claude-sonnet-4        84k/200k 42% · CH 91%  MCP: …
```

- Top rule = `─`×N + ` ⎇ branch ` + `─`×1, total exactly the terminal width. Label carries 1 space on each side and exactly 1 trailing `─` anchors the right edge.
- Rule keeps its current colour; the label renders `dim` (same token the old statusline branch used); glyph `⎇` kept (existing precedent). **User delta (round 2):** on the nvim rule, `⎇` and the branch name are UNTYLED (terminal-default fg, no tone at all — minimal by design); only the `[+N] [-M]` LOC brackets keep the shared formatter's `success`/`error` tones. `buildBranchBadge` stays ONE source for the FORMAT (order/spaces/brackets); colour is caller-decided via a `tones` map where `null` means unstyled. The other three presets keep their historic styling byte-identical via the default tones.
- No branch (no git / empty) → plain rule, byte-identical to today. Bottom rule unchanged in every case.
- Non-`line` frames (user `inputBoxStyle` override to `solid`/`outline`/`halfblock`) have no rule to embed into → no label, no error. The other three presets pass no label and stay byte-identical.
- Branch comes from the SAME provider the statusline already uses (`getBranch`); no new data source. Normalized like status text (`normalizeSingleLine`) and hard-capped at source: `truncatePlain(branch, NVIM_BRANCH_MAX=24, "…")` — the same source-cap pattern as `NVIM_MODEL_ID_MAX`.
- Long branch: the label needs at least 2 leading `─` + label block + 1 trailing `─`; below that threshold the label is DROPPED entirely (plain rule, no dangling `…`-trơ). Appearance by width is MONOTONIC: once shown, widening never hides it.

Statusline (companion change):

- The `⎇ branch` segment is deleted from the right cluster: old rung `⎇ main · 84k/200k 42% · CH 91%` becomes `84k/200k 42% · CH 91%`. Freed columns flow to the extension status.
- P3 loses its `branch` seen-flag and gains a NEGATIVE assert: no `⎇` may appear in the statusline at any width/fixture.
- The pinned degradation ladder changes DELIBERATELY (baseline change recorded in docs/TEST_MATRIX.md, not a regression).

## Verification Contract

- P7 (new, red-first greenfield: written and run BEFORE implementation, red because the label never appears, then green): sentinel branches (ASCII + CJK), width 1..200 — label appears monotonic, appears exactly once, truncates with `…` at the 24-col cap, below threshold a plain rule with no dangling ellipsis, the rule row carries no `\x1b[0m` and `visibleWidth === width`.
- P7 mutation-proof (ritual, same as P6 round 5b): (a) label with 0 spaces around it (`⎇ main` glued to the rule) must turn P7 red; (b) removing the drop law (label squeezing into narrow widths) must turn P7 red.
- Round-2 additions: RAW negative assert that the `⎇ <name>` portion carries NO SGR (unstyled); mutation M6 (name re-toned dim) must turn P7 red. Total mutations M1-M6 + P3 all proven red.
- P3 negative assert mutation: re-adding `⎇` to the statusline must turn it red.
- P1/P2/P4/P6 must stay green unchanged.

## Implementation Notes

- Seam: `renderInputLineBorder(width, topLabel?)`; `renderInputBoxFrame(inputLines, width, topLabel?)` passes it ONLY to the top rule of the `line` frame; only `renderNvimLayout` supplies a label.
- Deliverable: uncommitted diff + gallery {no-git, `main`, `feature/rename-用戶-flow`, 40-char branch} × {30, 60, 100}; Mark review → user eyeball → Biscuit.
- Base commit: `e37a3d2`.
