# pi-droid-styling

Opinionated Pi UI styling extension: compact startup UI, boxed editor, cleaner tool tags, message prefixes, footer stats, and reload-safe render patches.

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
- Footer stats including token speed.
- Reload/session-safe patches to avoid stacked padding or spacing.

## Config

Config is stored at `~/.pi/agent/pi-droid-styling.json`:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 80,
  "dimToolOutput": false,
  "customWorkingMessage": false
}
```

## Notes

- Works with the active Pi theme; it does not force a theme.
- `customWorkingMessage` is off by default to keep Pi core loader behavior stable.

## License

MIT
