# Notes
_Last updated: 2025-02-21_

## Architecture
- Extension works by monkey-patching prototypes (`AssistantMessageComponent`, `UserMessageComponent`, `ToolExecutionComponent`, `Loader`) — order matters, patches are guarded by flags to avoid double-patching
- Theme extras are read directly from JSON files on disk because the framework doesn't expose the `extras` field via `theme.definition`
- All color extras default to `""` (empty string), which triggers fallback to semantic theme colors
