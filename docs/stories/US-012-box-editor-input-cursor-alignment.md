# US-012 Box Editor Input Cursor Alignment

## Status

implemented

## Lane

normal

## Product Contract

The boxed user input field aligns with the editor panel's horizontal padding, so the prompt, cursor, and wrapped continuation lines sit inside the same visual column system as the panel metadata rows.

## Relevant Product Docs

- `docs/product/overview.md`
- `docs/ARCHITECTURE.md`

## Acceptance Criteria

- The user input prompt starts inside the panel padding instead of column zero.
- The cursor column is computed inside the same padded content width.
- Wrapped input continuation lines align under the typed text area.
- Slash autocomplete behavior remains outside the editor box behavior unless custom autocomplete is active.

## Design Notes

- Commands: none.
- Queries: none.
- API: no public API change.
- Tables: none.
- Domain rules: keep the change inside `editor/box-editor.ts`; do not alter base `CustomEditor` behavior.
- UI surfaces: boxed user input field.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Not available. |
| Integration | Import-resolution and syntax/type check where available. |
| E2E | Manual Pi smoke with empty input, typed input, wrapped input, and slash autocomplete. |
| Platform | Terminal render width stays bounded to `width`. |
| Release | Not applicable. |

## Harness Delta

None.

## Evidence

Pending validation commands in this session.
