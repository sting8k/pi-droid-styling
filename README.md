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
- Boxed editor and adjusted TUI padding.
- Cleaner assistant/user message spacing and prefixes.
- Compact tool tags with badges, elapsed time, and dimmed output support.
- Footer stats including token speed and compact session context.
- Optional true fixed user zone that keeps status/widgets/editor/footer at the bottom while chat/feed scrolls above.
- Reload/session-safe patches to avoid stacked padding or spacing.

## Config

Config is stored at `~/.pi/agent/pi-droid-styling.json`:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 50,
  "dimToolOutput": false,
  "customWorkingMessage": false,
  "fixedUserZone": false,
  "fixedUserZoneMouseScroll": true
}
```

`alwaysExpanded` only sets the initial tool-output expansion state for a session; Pi core Ctrl+O remains authoritative afterward.
`fixedUserZone` is opt-in. When enabled, the status/widgets/editor/footer cluster is kept fixed at the bottom while chat/feed output renders in the scrollable region above it.

## Notes

- Works with the active Pi theme; it does not force a theme.
- Compatible color schemes: https://github.com/sting8k/pi-themes
- `customWorkingMessage` is off by default to keep Pi core loader behavior stable.

## License

MIT
