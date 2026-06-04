# US-010 Terminal-safe Theme Backgrounds

## Status

implemented

## Lane

normal

## Product Contract

`pi-droid-styling` should keep ANSI-rendered frame backgrounds as the cross-platform default mechanism, while using OSC 11 on non-Windows hosts to cover terminal-owned padding/remainder areas that ANSI cell painting cannot reach. Windows, WSL, and Windows Terminal sessions should skip OSC 11 unless the user explicitly opts into `forceOSC11`.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- The extension does not send OSC 10 foreground mutation sequences.
- The extension sends OSC 11 background sync only when the runtime is not Windows, WSL, or Windows Terminal, unless `forceOSC11` is enabled.
- Windows, WSL, and Windows Terminal sessions use ANSI frame/component background painting by default.
- Non-Windows OSC 11 sync restores the terminal default background with OSC 111 on session shutdown/restart.
- Theme extras still reload when Pi updates editor border/theme state.
- Boxed tool-call surfaces use explicit page background tokens and preserve the outer background across inner SGR resets where possible.

## Design Notes

- UI surfaces: `tool-tags/common.ts` boxed tool renderers and root frame painting via `theme/frame-background.ts`.
- Lifecycle seam: `index.ts` applies terminal page background sync when the editor component is created and restores it on session shutdown/restart.
- Platform seam: `theme/terminal-background.ts` gates OSC 11 off for `win32`, WSL, and Windows Terminal (`WT_SESSION`) unless `forceOSC11` is passed from config.
- ANSI frame painting remains the cross-platform fallback and owns renderable terminal cells; OSC 11 only covers terminal-owned padding/remainder regions on non-Windows hosts.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused OSC11 smoke verifies non-Windows emit/restore, Windows/WSL/Windows Terminal default no-op, `forceOSC11` Windows override, and color normalization. |
| Integration | Source grep verifies no OSC 10 and only platform-gated OSC 11/111 helper sequences remain. Scoped TypeScript check covers the terminal background helper. |
| E2E | Not run; requires manual Pi terminal smoke. |
| Platform | Ghostty/macOS visual smoke recommended for border coverage; Windows Terminal smoke should confirm no OSC11 mutation. |
| Release | Not run. |

## Harness Delta

No Harness policy changes. This story records the normal-lane terminal-safe renderer behavior change and validation evidence.

## Evidence

- OSC11 focused smoke passed: darwin/linux emit OSC 11 and restore OSC 111; win32, `WT_SESSION`, `WSL_DISTRO_NAME`, and `WSL_INTEROP` no-op by default; `forceOSC11` overrides win32 default skip.
- Source grep passed: no OSC 10; only `theme/terminal-background.ts` contains platform-gated OSC 11/111 sequences.
- `git diff --check` passed for `index.ts`, `theme/terminal-background.ts`, and `tui-padding.ts`.
- Scoped TypeScript check passed for `theme/terminal-background.ts` and its direct dependencies with node stubs.
- `semantic_review` passed for working tree, `index.ts`, and `theme/terminal-background.ts`.
