# US-016 Theme Extra Token Colors

## Status

implemented

## Lane

normal

## Product Contract

Color-valued theme extras may use semantic token names from the active theme instead of hardcoded hex values. `getThemeExtra()` resolves `*Color` extras through cached theme `vars` and `colors` aliases before callers pass the value to ANSI helpers. Non-color extras remain literal strings.

## Relevant Product Docs

- `README.md`
- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- A color extra such as `assistantPrefixColor: "blue"` resolves through theme variables to a hex value before `fgHex()` sees it.
- Alias chains such as `blue -> softBlue -> #89b4fa` resolve within a bounded depth.
- Semantic color keys that live under `colors`, such as `borderMuted`, can resolve through `colors` then `vars`.
- Defaults such as `userPrefixColor: "accent"` resolve when the active theme defines `accent`.
- Non-color extras such as `assistantPrefix` remain literal and are not treated as color tokens.
- Boolean extras such as `showDivider: false` normalize to the existing string contract (`"false"`) used by render callers.
- Unresolved tokens are preserved so existing fallback rendering behavior remains unchanged.

## Design Notes

- Commands: `npm run test:theme-extras`.
- Queries: `semantic_search` for `getThemeExtra`, `cachedExtras`, `cachedVars`, and `fgHex` flow.
- Domain rules: theme token resolution belongs in `theme/theme-extras.ts`, before color strings reach ANSI helpers in `theme/ansi.ts`.
- Scope: no changes to `../pi-themes/themes`; replacing hardcoded theme hex values with semantic extras is separate work.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Focused smoke for `vars` alias chains, `colors` alias fallback, default token resolution, boolean normalization, non-color literal preservation, and unresolved-token preservation. |
| Integration | Focused TypeScript compile for `theme/theme-extras.ts`; `git diff --check`. |
| E2E | Manual Pi theme reload smoke recommended with real theme packages. |
| Platform | Host-independent JSON/theme parsing; no platform-specific terminal behavior changed. |
| Release | Not run. |

## Harness Delta

Added reusable `npm run test:theme-extras` so future theme-extra token changes can verify resolver behavior without ad hoc scripts.

## Evidence

- `npm run test:theme-extras` passed: focused compile, token alias color extras, colors alias fallback, default accent resolution, boolean normalization, non-color literal preservation, and unresolved-token preservation.
- `npm run test:startup-resources` passed.
- `npm run test:working-message` passed.
- `git diff --check` passed.
- `semantic_review` passed for working-tree changed files.
- Harness trace `#55` recorded for `US-016`.
