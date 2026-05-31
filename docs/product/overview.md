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

## Configuration

Configuration is stored at `~/.pi/agent/pi-droid-styling.json`.

Current options:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 80,
  "dimToolOutput": false,
  "customWorkingMessage": false
}
```

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
