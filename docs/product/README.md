# Product Docs

This directory contains the living product contract for `pi-droid-styling`.

Start with:

- `overview.md`: current user-facing behavior and configuration surface.

## Update Rule

When behavior changes:

1. Update the affected product doc.
2. Update or create the story packet when the work is more than a tiny docs/code change.
3. Update durable proof status with `scripts/bin/harness-cli story add` or `scripts/bin/harness-cli story update`.
4. Record a decision if the change affects architecture, scope, risk, or a previously settled product rule.

Do not add speculative product docs. Add new files only when the product surface exists or an accepted story needs a stable contract.
