# 0005 Prebuilt Rust Harness CLI

Date: 2026-05-23

## Status

Accepted, amended 2026-05-31

## Context

The durable layer started as a thin shell wrapper around SQLite. That wrapper
is now large enough to carry meaningful architecture risk: it mixes command
parsing, SQL construction, migrations, import behavior, query rendering, and
help text in one script.

The previous installer copied a shell wrapper into target repositories. That
kept Harness easy to install, but it also meant a Rust rewrite was not only an
implementation change. It changed the distribution contract for every project
that receives Harness.

## Decision

The future Rust implementation of the Harness CLI should be shipped as a
prebuilt binary downloaded by the installer.

The command path for users and agents is the installed Rust binary:

```bash
scripts/bin/harness-cli <command>
```

The installer should download, verify, and install the platform-specific Rust
binary directly at that path. There should be no shell wrapper command contract.

The Rust CLI should follow the existing architecture rules:

- Domain: harness records, statuses, lanes, and value types.
- Application: use cases for intake, stories, decisions, backlog, traces, and
  queries.
- Infrastructure: SQLite repositories and schema migrations.
- Interface: command-line parsing, terminal output, and installer integration.

## Alternatives Considered

1. Keep the shell CLI permanently. Rejected because the script has crossed from
   a thin wrapper into a growing application surface with weak testability.
2. Copy Rust source into every target project and build locally. Rejected
   because it makes Harness installation depend on a local Rust toolchain and
   increases setup friction for projects that only need the harness.
3. Require users to install a global `harness` binary separately. Rejected
   because Harness should remain repository-local for agents.
4. Download a prebuilt binary through the installer. Accepted because it keeps
   target repos simple while allowing the CLI internals to become typed,
   testable, and platform-aware.

## Consequences

Positive:

- The durable-layer CLI can move to typed command parsing and tested use cases.
- Target projects do not need a Rust toolchain just to use Harness.
- The `scripts/bin/harness-cli` command is the stable entrypoint for agents.
- Prebuilt releases can include a known SQLite linkage strategy.

Tradeoffs:

- The installer must learn platform detection and binary download behavior.
- Release artifacts need checksums or another integrity check.
- Unsupported platforms need a clear error path.
- The project needs a repeatable release process for supported platforms.

## Follow-Up

- Implement the migration through `US-002 Rust Harness CLI`.
- Remove the old shell wrapper from installed project payloads.
- Add checksum verification for downloaded binaries.
- Treat the Rust CLI as the primary durable-layer implementation.
