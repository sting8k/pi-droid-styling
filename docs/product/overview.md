# Product Overview

`pi-droid-styling` is an opinionated Pi UI styling extension.

## User-Facing Behavior

The extension provides:

- Compact startup header and loaded resources display.
- Boxed editor with selectable `userZoneStyle` presets for project, model, context, git, footer status, and input presentation.
- Assistant and user message prefixes with cleaner spacing.
- Compact tool call tags with badges, elapsed time, dimmed output support, and specialized renderers for common tools.
- Footer stats including assistant token/word speed and compact session context.
- Active-theme integration without forcing a specific theme; non-Windows hosts may sync terminal background with OSC 11 to cover terminal-owned padding/remainder areas.
- Explicit root-frame and component-level background painting for the active theme page background, tool boxes, and fixed-zone notices.
- Render hot-path patches for streaming assistant output and noisy tool output.
- Opt-in render profiling for request/render/repaint/update/git metrics without changing UI behavior when disabled.
- Optional fixed user zone that keeps the status/widgets/editor/footer cluster at the bottom while chat/feed output scrolls above it, including mouse drag selection, double-click word selection, triple-click line selection, fixed-zone-local bottom notice feedback, and OSC 52 clipboard propagation for terminal proxies in the fixed-zone view.
- Optional fixed user zone right sidebar for session id/name, cwd, current branch, modified files, and Pi version metadata on wide terminals.

## Configuration

Configuration is stored at `~/.pi/agent/pi-droid-styling.json`.

Current options:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 50,
  "dimToolOutput": false,
  "customWorkingMessage": {
    "working": "Working",
    "thinking": "Thinking",
    "answering": "Answering",
    "running": "Cooking"
  },
  "presentationStyle": "droid",
  "userZoneStyle": "gemini",
  "inputBox": {
    "style": "auto"
  },
  "fixedUserZone": false,
  "forceOSC11": false
}
```

`alwaysExpanded` only sets the initial tool-output expansion state for a session; Pi core Ctrl+O remains authoritative afterward.
`customWorkingMessage` is on by default and accepts `working`, `thinking`, `answering`, and `running` strings for themed loader labels.
Legacy `customWorkingMessage: true` or `false` values are normalized back to the default label object.
`presentationStyle` accepts `droid` or `reasonix`. `droid` is the default and preserves existing conversation cards and tool boxes. `reasonix` removes turn dividers/user cards, aligns user text, assistant text/thinking, and tool names one space after their top-level marker, keeps the themed assistant marker inline with italic theme-native `thinkingText` thinking, renders a semantic colored status/name/subject header, keeps Droid-compact tools (`Read`, `Find`, `Search`, `List`, and `Write`) on one status/subject/metrics row, and places non-compact collapsed metrics on a second `└─` row in the first output position. Collapsed compact rows, non-compact call rows, and status rows use the full width through 40 columns, then one shared 80% width cap. `Ctrl+O` replaces that collapsed metrics position with full corner-connected output, uses the same semantic-dim color for the column-3 connector and status/footer, aligns body continuations and footer metrics in column 6, and clamps every physical row without treating upstream ANSI padding as real content. User, assistant, and tool blocks each retain one trailing blank row so adjacent blocks do not crowd together. Quick-edit split diffs remain available within existing render budgets; theme colors, Markdown, and streaming still use Pi's active semantics.
`userZoneStyle` accepts `gemini`, `droid`, `cli-dock`, or `nvim` and changes built-in user-zone presentation in both normal and fixed modes; themes keep the same extras/color format; the `❯` prompt consistently uses `userPrefixColor` (accent by default) instead of inheriting `bashPromptColor`. `gemini` is the default layout and renders compact `provider model · level` model info before unchanged token stats on the top status row with branch status on the right, renders an always-visible divider before the status row using the same theme border color as tool-call boxes, keeps a borderless droid prompt row with `❯` and Gemini-style half-line background padding, right-aligns fixed-zone shortcut hints on the footer/status row, and renders dim wrapped workspace/status values without labels, sandbox, or quota columns. `droid` remains available as the boxed legacy layout. `cli-dock` is an opt-in Droid CLI-style bottom dock that preserves the existing theme/extras contract while rendering a true outlined `›` prompt box with placeholder copy, dynamic model/`Ctx`/branch/project status on the left and MCP/footer status on the right, both inset to the input-text column instead of the box edges. `nvim` is an opinionated Neovim-style dock: a `line`-framed input with a placeholder, and one full-width statusline bar directly below it. A leading solid-block badge (reverse video, lualine-style) shows the thinking level uppercased verbatim from Pi's own six levels, or `BASH` while the input starts with `!`; a non-reasoning model (including `reasoning: undefined`) renders no badge at all and the bar starts with the model identity. The block is coloured by mode, not by thinking level: the `accent` token for normal input, `theme.getBashModeBorderColor()` for bash mode. `accent` is the theme's own general highlight token, so a theme author retuning it deliberately carries every accented UI element — including this badge — along with it; measured alternatives (`syntaxNumber`, `syntaxType`) scored better on raw contrast/distinctness but borrow meaning from an unrelated part of the theme (syntax highlighting), leaving the badge feeling like a foreign sticker rather than the theme's own chrome. Known and accepted: in 5 of 26 companion themes `accent` equals `bashMode`, so entering bash mode there recolours only the `BASH` label, not the block — not special-cased per theme, no off-palette colour invented. `getThinkingBorderColor` tokens exist to tint a thin border line, so every theme keeps them deliberately desaturated — filled into a solid block they render as a muddy slab — so the level lives in the label text only; cycling the level changes the word, never the colour. The rest of the bar shows `provider · model` on the left and `branch · tokens ctx% · CH%` right-aligned with a width-based degradation ladder that keeps the row at exactly the terminal width; any other extension's status is appended at the far right of that same row and truncated with `…` if it overflows, never wrapped onto a second row. Conversation rendering (prose, tool calls, tool bodies) is unaffected by `userZoneStyle` under every `presentationStyle`.
`inputBox.style` accepts `auto`, `halfblock`, `line`, or `solid`; `auto` keeps each preset default. The `cli-dock` preset always keeps its outline frame so an existing `inputBox.style: "line"` setting cannot collapse the box into top/bottom-only lines.
`fixedUserZone` is off by default; enabling it activates terminal scroll isolation for the user zone rather than a cosmetic-only layout change.
`forceOSC11` keeps OSC 11 disabled on Windows/WSL/Windows Terminal unless explicitly enabled for user testing.

## Compatibility Expectations

- The extension should use explicit frame/component rendering for terminal cells and keep OSC 11 disabled on Windows/WSL/Windows Terminal unless `forceOSC11` is enabled.
- Patch installers should be reload/session safe and avoid stacked patches.
- Performance patches should preserve final message/tool correctness while coalescing partial updates.
- Profiling should be opt-in and should emit aggregate JSONL summaries rather than per-render logs.
- Git status and assistant speed are best-effort UI hints, not correctness-critical product state.

## Validation Expectations

Until a formal test script exists, validate changes with the smallest available proof:

- Source review with `srcwalk review` for changed code.
- Import resolution for relative `.js` specifiers.
- Manual Pi smoke test for user-visible rendering changes.
- Harness matrix updates for story-sized behavior.
