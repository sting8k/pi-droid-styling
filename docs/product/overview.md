# Product Overview

`pi-droid-styling` is an opinionated Pi UI styling extension.

## User-Facing Behavior

The extension provides:

- Compact startup header and loaded resources display.
- Boxed editor with selectable `userZoneStyle` presets for project, host, model, context, git, footer status, and input presentation.
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
  "userZoneStyle": "droid",
  "fixedUserZone": false,
  "forceOSC11": false
}
```

`alwaysExpanded` only sets the initial tool-output expansion state for a session; Pi core Ctrl+O remains authoritative afterward.
`customWorkingMessage` is on by default and accepts `working`, `thinking`, `answering`, and `running` strings for themed loader labels.
Legacy `customWorkingMessage: true` or `false` values are normalized back to the default label object.
`userZoneStyle` accepts `droid`, `compact`, or `minimal` and changes built-in user-zone presentation in both normal and fixed modes; themes keep the same extras/color format.
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
