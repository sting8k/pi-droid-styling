# US-010 Terminal-safe Theme Backgrounds

## Status

implemented

## Lane

normal

## Product Contract

`pi-droid-styling` should preserve the user's terminal profile defaults instead of mutating terminal default foreground/background colors. Extension-owned surfaces that need a themed background should paint that background explicitly at the component level.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- The extension does not send OSC 10/11 foreground/background mutation sequences during normal session startup or theme reload sync.
- Theme extras still reload when Pi updates editor border/theme state.
- Boxed tool-call surfaces use explicit theme background tokens for success, pending, error, and partial states.
- Explicit boxed backgrounds preserve the outer background across inner SGR foreground/background resets where possible.
- The change does not add root/full-frame background fill.

## Design Notes

- UI surfaces: `tool-tags/common.ts` boxed tool renderers.
- Lifecycle seam: `index.ts` keeps theme extras sync but no longer owns terminal dynamic color resources.
- Theme seam: terminal default mutation helpers were removed; component renderers apply background only to padded lines they own.
- Full-frame/root renderer background remains out of scope because this extension does not own Pi's root renderer.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused `boxBg` smoke verifies explicit background wrapping, fallback `theme.bg`, and background restoration across reset SGR sequences. |
| Integration | Source grep verifies no OSC 10/11 default-color mutation helpers/calls remain in source. Scoped TypeScript check covers `index.ts`, `tool-tags/common.ts`, and `theme/theme-extras.ts`. |
| E2E | Not run; requires manual Pi terminal smoke. |
| Platform | Manual Windows Terminal/macOS/Linux visual smoke recommended for exact terminal rendering. |
| Release | Not run. |

## Harness Delta

No Harness policy changes. This story records the normal-lane terminal-safe renderer behavior change and validation evidence.

## Evidence

- `boxBg` focused smoke passed.
- Source grep passed: no `applyTerminalBg`, `restoreTerminalBg`, `terminal-bg`, `getThemeVar`, or OSC 10/11 source sequences remain in `index.ts`, `theme/`, or `tool-tags/`.
- `git diff --check` passed.
- Scoped TypeScript check passed for `index.ts`, `tool-tags/common.ts`, and `theme/theme-extras.ts`.
- `semantic_review` passed for working tree and focused `tool-tags/common.ts` review.
