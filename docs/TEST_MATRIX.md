# Test Matrix

Current proof status is stored in the Harness durable layer and queried with:

```bash
scripts/bin/harness-cli query matrix
```

This markdown file is a human-readable fallback for the initial brownfield baseline.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H-001 | Harness docs describe the existing TypeScript Pi UI styling extension accurately | no | no | no | yes | implemented | `srcwalk review --limit 10`, `srcwalk overview --scope . --depth 2`, `scripts/bin/harness-cli query matrix`, docs placeholder/upstream grep checks |

## Evidence Rules

- Unit proof covers pure helpers such as formatting, parsing, and status calculations when tests exist.
- Integration proof covers behavior that depends on Pi component APIs or Node process interactions.
- E2E proof covers user-visible Pi flows when an automated Pi runner exists.
- Platform proof covers terminal rendering, theme sync, shell/process behavior, and manual Pi smoke checks.
- Do not mark automated proof columns as passing until corresponding commands exist and have been run.
