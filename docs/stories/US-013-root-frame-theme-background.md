# US-013 Root Frame Theme Background

## Status

implemented

## Lane

normal

## Product Contract

`pi-droid-styling` should paint the active Pi theme page background across the rendered TUI frame with explicit ANSI backgrounds, while any OSC 11 terminal background sync remains platform-gated by US-010 and opt-in on Windows via `forceOSC11`.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- The frame painter itself does not rely on OSC 10/11; OSC 10 remains disabled, and OSC 11 terminal background sync is platform-gated by US-010.
- The root frame background is painted with explicit ANSI background SGR derived from the active theme page background.
- Frame rows are painted by emitting the active background plus `ESC[2K`, preserving that background through resets, and filling printable spaces through the terminal width instead of relying on terminal defaults.
- Blank frame rows are added up to the visible terminal height only when a page background can be resolved.
- Kitty/iTerm image render lines are left untouched.
- Default left/right TUI padding and blank row gutters are painted with the page background.
- Existing component backgrounds preserve their own background spans and return to page background after resets.
- Fixed-zone direct paints for cluster/sidebar/scrollbar rows use the same shared row background painter.
- Render-write line clears (`ESC[2K`) are prefixed with the page background so terminals without synchronized-output buffering do not momentarily clear to terminal default background.

## Design Notes

- Commands: none.
- Queries: none.
- API: wraps Pi TUI `applyLineResets` after overlay composition/cursor marker extraction and wraps terminal writes to color render-time line clears.
- Tables: none.
- Domain rules: root frame background patching belongs in `performance/render-frame-background.ts`; shared SGR background/reset behavior belongs in `theme/ansi.ts`; shared row painting belongs in `theme/frame-background.ts`.
- UI surfaces: full Pi TUI frame rows, default side padding/gutters, fixed-zone direct paint rows, and existing tool-box component backgrounds.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused smoke for ANSI background wrapping, 8-digit theme hex, reset preservation, row-start `ESC[2K` paint, image-line skip, segment paint, and shared row painter behavior. |
| Integration | Source grep verifies no OSC 10 and only the platform-gated OSC 11 helper owns terminal background mutation. Scoped TypeScript check covers index, frame painter, theme helpers, and tool box backgrounds. |
| E2E | Manual Pi visual smoke recommended on macOS/Windows Terminal/Linux. |
| Platform | Manual terminal visual smoke required for exact color perception. |
| Release | Not run. |

## Harness Delta

No Harness policy changes. This story extends US-010 from component-only background painting to root frame painting while keeping ANSI frame rendering independent from terminal default-color support.

## Evidence

- Focused frame background smoke passed for row-start `ESC[2K` painter, width-fill painter, clear-sequence painter, segment painter, reset preservation, image-line skip, and box background preservation.
- Real Pi Theme smoke passed for `toolSuccessBg` tool-box lines and sourcePath-based page background resolution.
- Source grep passed: no OSC 10; only `theme/terminal-background.ts` owns platform-gated OSC 11/111 terminal background sync.
- `git diff --check` passed.
- Scoped TypeScript check passed for `index.ts`, frame background patch, theme helpers, tool box backgrounds, and fixed-zone compositor/theme.
- `semantic_review` passed for `theme`, `performance`, `tool-tags/common.ts`, and `fixed-zone` scopes.
- Harness US-013 evidence updated; manual Pi terminal visual smoke remains pending.
