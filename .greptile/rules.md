# Greptile Review Rules

- Focus on correctness, regressions, validation gaps, runtime reload safety, render hot-path performance, terminal state safety, and maintainability. Avoid low-signal style nits unless they hide a real bug.
- Respect the Harness workflow in `AGENTS.md`: keep product docs, architecture notes, validation expectations, and story/decision docs current when behavior or operational workflow changes.
- Keep `index.ts` as Pi lifecycle wiring. Feature logic should live in the nearest domain folder (`performance/`, `fixed-zone/`, `tool-tags/`, `messages/`, `editor/`, `theme/`, or `core/`).
- Runtime patches must be idempotent across extension reloads. If a patch replaces host methods or terminal state, check that it avoids double-wrapping and restores state on dispose when a dispose path exists.
- For render/streaming/tool-output changes, check bounded per-frame work, terminal control-sequence ordering, cursor/autowrap/scroll-region restoration, and whether debug flags remain safe defaults.
- For fixed-zone changes, check scroll-region boundaries, terminal split ownership, input listener cleanup, and interactions with the main conversation stream.
- For build, profile, trace, or debug script changes, check that commands remain generic and do not bake in local machine paths, private project names, or one-off artifacts.
