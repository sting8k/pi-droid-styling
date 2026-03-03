# Context & Environment
_Last updated: 2026-02-25_

## Project
- Name: `@anthropic/pi-droid-styling`
- Description: Custom UI styling extension for pi coding agent — boxed editor, tool badges, message prefixes, chat virtualization
- Entry: `index.ts`
- Dependencies: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`
- Package wiring: `package.json` exports extension via `pi.extensions: ["./index.ts"]`

## Structure
```
pi-droid-styling/
├── index.ts                  # Entry point, registers all patches on session_start
├── ansi.ts                   # ANSI helpers: strip, fgHex, color conversion, text manipulation
├── theme-extras.ts           # Reads "extras" from theme JSON on disk (not exposed by framework)
├── tui-padding.ts            # 1col left/right padding on TUI output
├── render-throttle.ts        # Throttle renders to ~60fps
├── virtualize-chat.ts        # Only render last 50 chat children
├── editor/
│   └── box-editor.ts         # BoxEditor extends CustomEditor — bordered input with prompt chars
├── messages/
│   ├── assistant-prefix.ts   # Monkey-patch AssistantMessageComponent — prefix + divider
│   └── user-prefix.ts        # Monkey-patch UserMessageComponent — prefix + divider + bold
└── tool-tags/
    ├── register-tool-call-tags.ts  # Registry dispatch for 7 built-in tools
    ├── common.ts                   # Shared: badge(), parens(), renderLines(), path helpers
    ├── compact-tool-spacing.ts     # Patch ToolExecutionComponent — remove paddingY, add divider
    ├── default-badge.ts            # Badge for non-built-in tools
    ├── loader-accent.ts            # Braille spinner frames, 40ms interval
    ├── bash.ts, read.ts, write.ts, edit.ts, ls.ts, find.ts, grep.ts  # Per-tool custom renderers
```

## Theme Extras (configurable via theme JSON `extras` field)
Keys with hardcoded defaults in `theme-extras.ts`:
- `assistantPrefix` ("•"), `assistantPrefixColor`
- `userPrefix` ("»"), `userPrefixColor`
- `dividerChar` ("─"), `dividerColor`
- `inputBorderColor`, `bashPromptColor`
- `tagBgColor`
- `parensTextColor`, `parensBracketColor` — tool call parens styling
- `slashSelectedColor`, `slashCommandColor`, `slashDescriptionColor`, `slashHintColor`
- `userBoxBorderColor`
