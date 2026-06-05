# US-014 Custom Working Message Config

## Status

implemented

## Lane

normal

## Product Contract

`customWorkingMessage` is enabled by default and is configured as a JSON object of loader labels instead of a boolean. Existing legacy `true` or `false` values are automatically rewritten to the default label object when config loads.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- New scaffolded `~/.pi/agent/pi-droid-styling.json` writes `customWorkingMessage` as an object with `working`, `thinking`, `answering`, and `running` labels.
- Existing `customWorkingMessage: true` is transformed in-place to the default label object.
- Existing `customWorkingMessage: false` is transformed in-place to the default label object.
- Partial custom label objects preserve user strings and backfill missing/invalid labels with defaults.
- The session loader is installed by default and renders configured labels while preserving the existing spinner/layout behavior.

## Design Notes

- Commands: `npm run test:working-message`.
- Queries: `semantic_search` for `customWorkingMessage` config and loader flow.
- API: `DroidStylingConfig.customWorkingMessage` is now a label object; `createWorkingLoaderController` accepts the normalized labels.
- Tables: none.
- Domain rules: config normalization/backfill stays in `config.ts`; Pi lifecycle wiring in `index.ts` only passes normalized config into `tool-tags/loader-accent.ts`.
- UI surfaces: Pi working/status loader text.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused smoke for default scaffold, legacy boolean migration, partial object backfill, and custom label rendering. |
| Integration | Focused TypeScript compile for `config.ts`, `tool-tags/loader-accent.ts`, and `index.ts`; `git diff --check`. |
| E2E | Manual Pi reload smoke recommended for configured label text. |
| Platform | Config rewrite is filesystem-only and should be host-independent; terminal visual smoke remains manual. |
| Release | Not run. |

## Harness Delta

Added reusable `npm run test:working-message` so future working-message config changes can run the same scaffold/migration/render smoke without copying ad hoc shell blocks.

## Evidence

- `npm run test:working-message` passed: focused TypeScript compile, default scaffold object, legacy `true` transform, legacy `false` transform, partial custom-label backfill, and custom loader render.
- `git diff --check` passed.
- `semantic_review` passed for working-tree changed files.
