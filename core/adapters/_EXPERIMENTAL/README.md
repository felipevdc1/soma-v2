# EXPERIMENTAL Adapters

These adapters are **skeleton-only** stubs shipped at MVP level per Decision D-P6-4.

- **cursor/** — Cursor IDE harness adapter. Structure mirrors `claude/` and `codex/` adapters but `install-targets.json` is empty (`entries: []`). Bootloader format follows the canonical adapter contract in `core/docs/adapter-contract.md`.
- **aider/** — Aider CLI harness adapter, same MVP shape.
- **chatgpt-desktop/** — ChatGPT Desktop harness adapter, same MVP shape.

## Status

These adapters demonstrate the harness-agnostic abstraction layer that SOMA targets in v2.x but are **not yet wired** for production use. The `claude/` and `codex/` adapters under `core/adapters/` are the only production-ready harnesses in v2.1.

## Roadmap

Each EXPERIMENTAL adapter graduates to `core/adapters/` once:

1. `install-targets.json` has at least one verified entry mapping a canonical doc to the harness's config file.
2. End-to-end install flow validated on the harness's real installation.
3. Smoke pack equivalent passing on that harness.

## Contributing

Pull requests welcome. See `core/docs/adapter-contract.md` for the contract each adapter must satisfy.
