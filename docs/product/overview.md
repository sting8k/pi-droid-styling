# Product Overview

`pi-droid-styling` is an opinionated Pi UI styling extension.

## User-Facing Behavior

The extension provides:

- Compact startup header and loaded resources display.
- Boxed editor with project, host, model, context, git, and footer status details.
- Assistant and user message prefixes with cleaner spacing.
- Compact tool call tags with badges, elapsed time, dimmed output support, and specialized renderers for common tools.
- Footer stats including assistant token/word speed and compact session context.
- Active-theme integration without forcing a specific theme.
- Terminal background synchronization with the active theme when supported.
- Render hot-path patches for streaming assistant output and noisy tool output.
- Optional fixed user zone that keeps the status/widgets/editor/footer cluster at the bottom while chat/feed output scrolls above it.
- Optional fixed user zone right sidebar for session id/name, cwd, current branch, modified files, and Pi version metadata on wide terminals.

## Configuration

Configuration is stored at `~/.pi/agent/pi-droid-styling.json`.

Current options:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 50,
  "dimToolOutput": false,
  "customWorkingMessage": false,
  "fixedUserZone": false,
  "fixedUserZoneSidebar": false
}
```

`alwaysExpanded` only sets the initial tool-output expansion state for a session; Pi core Ctrl+O remains authoritative afterward.
`fixedUserZone` is off by default; enabling it activates terminal scroll isolation for the user zone rather than a cosmetic-only layout change.
`fixedUserZoneSidebar` is off by default and only applies when `fixedUserZone` is enabled. If requested and the terminal is wide enough, it reserves a right rail and moves duplicated session/project/git metadata out of the fixed footer.

## Compatibility Expectations

- The extension should use the active Pi theme rather than overriding it.
- Patch installers should be reload/session safe and avoid stacked patches.
- Performance patches should preserve final message/tool correctness while coalescing partial updates.
- Git status and assistant speed are best-effort UI hints, not correctness-critical product state.

## Validation Expectations

Until a formal test script exists, validate changes with the smallest available proof:

- Source review with `srcwalk review` for changed code.
- Import resolution for relative `.js` specifiers.
- Manual Pi smoke test for user-visible rendering changes.
- Harness matrix updates for story-sized behavior.
