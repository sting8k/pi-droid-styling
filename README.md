# pi-droid-styling

Opinionated Pi UI styling extension: compact startup UI, boxed editor, cleaner tool tags, message prefixes, footer stats, and reload-safe render patches.

## Screenshot

![pi-droid-styling screenshot](./screenshots/image.png)

## Install

```sh
pi install git:github.com/sting8k/pi-droid-styling
```

For project-local install:

```sh
pi install -l git:github.com/sting8k/pi-droid-styling
```

## Features

- Compact startup header and loaded resources table.
- Boxed editor with selectable `userZoneStyle` presets and adjusted TUI padding.
- Cleaner assistant/user message spacing and prefixes.
- Compact tool tags with badges, elapsed time, and dimmed output support.
- Footer stats including token speed and compact session context.
- Optional true fixed user zone that keeps status/widgets/editor/footer at the bottom while chat/feed scrolls above, with mouse selection/copy support, themed bottom-row feedback, and OSC 52 clipboard propagation for terminal proxies.
- Reload/session-safe patches to avoid stacked padding or spacing.

## Config

Config is stored at `~/.pi/agent/pi-droid-styling.json`:

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
  "userZoneStyle": "gemini",
  "fixedUserZone": false,
  "forceOSC11": false
}
```

`alwaysExpanded` only sets the initial tool-output expansion state for a session; Pi core Ctrl+O remains authoritative afterward.
`userZoneStyle` selects a built-in presentation preset for the user input zone in both normal and fixed modes. Supported values are `gemini` and `droid`; theme files keep using the existing extras/color format. `gemini` is the default Gemini-like status/input/footer layout with compact `provider model · level` model info before the unchanged token stats on the top row, branch status on the right, an always-visible divider before the status row using the same theme border color as tool-call boxes, a borderless `❯` input row with Gemini-style half-line background padding, fixed-zone shortcut hints right-aligned on the footer/status row, and dim wrapped workspace/status footer values without labels, sandbox, or quota columns. `droid` remains available as the boxed legacy layout.
`fixedUserZone` is opt-in. When enabled, the status/widgets/editor/footer cluster is kept fixed at the bottom while chat/feed output renders in the scrollable region above it.
`forceOSC11` is off by default on Windows/WSL/Windows Terminal. Set it to `true` only if you want to test OSC 11 terminal background sync there.

## Profiling

Render profiling is disabled by default. To capture render/update/git/sidebar metrics plus memory, CPU delta, and event-loop utilization:

```sh
PI_DROID_PROFILE=1 PI_DROID_PROFILE_OUT=/tmp/pi-droid-profile.jsonl pi
```

Useful environment variables:

- `PI_DROID_PROFILE=1` enables profiling.
- `PI_DROID_PROFILE_OUT=/path/profile.jsonl` writes JSONL output. Use `stderr` or `stdout` for stream output.
- `PI_DROID_PROFILE_INTERVAL_MS=5000` controls summary cadence.

Synthetic self-check:

```sh
npm run profile:render
```

The synthetic bench exercises sidebar rendering, fixed-zone compositor repaint, render throttle, assistant/tool debounce, and git status refresh. Runtime terminal paint/GPU cost still needs a real Pi TUI capture.

## Notes

- Works with the active Pi theme; it paints TUI cells explicitly and uses OSC 11 terminal background sync on non-Windows hosts to cover terminal-owned padding/remainder areas. Windows/WSL/Windows Terminal skip OSC 11 unless `forceOSC11` is enabled.
- Compatible color schemes: https://github.com/sting8k/pi-themes
- `customWorkingMessage` is on by default. Set `working`, `thinking`, `answering`, and `running` strings to customize the themed loader labels.
- Existing legacy `customWorkingMessage: true` or `false` values are normalized back to the default label object.

## License

MIT
