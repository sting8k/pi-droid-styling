# 0002 Seed Specification Product Lifecycle

Date: 2026-05-05

## Status

Superseded by `0003-generic-spec-intake-harness.md`

## Context

Harness v0 originally assumed the repository would include one seed
specification file for the first product. This decision explained how agents
should decompose that initial specification into product docs, story packets,
implementation, and validation proof, then continue working after the seed was
exhausted.

That approach fit a single project but made the harness less reusable.

## Decision

Treat the initial specification as a seed and historical snapshot, not the
permanent living product plan.

After the initial specification has been exhausted, new work should enter
through the same harness loop as one of these input types:

- Change request.
- New initiative.
- Maintenance request.
- Harness improvement.

Product docs under `docs/product/`, story packets under `docs/stories/`,
validation evidence in `docs/TEST_MATRIX.md`, and decision records under
`docs/decisions/` become the living operating surface.

Large future product areas should be captured as scoped initiative notes instead
of appended to the seed specification or rewritten as a second monolithic spec.

## Consequences

Positive:

- The original specification remains stable as historical context.
- Product truth moves into smaller, current, maintainable files.
- Future work keeps using the same intake, story, proof, and harness-growth
  loop.
- Large ideas can still be planned without creating another oversized spec.

Tradeoffs:

- The repository will eventually need an initiative template if large new
  product areas become common.
- Agents must be careful to update product docs and tests rather than relying on
  the seed specification after initial buildout.
