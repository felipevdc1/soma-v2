# SOMA v2.2 — Core

SOMA v2.2 context operating system — executable install pipeline. See `docs/00-overview.md` for purpose, layout, and index.

## Layout

```
~/.soma-v2/
  manifest.json          — file inventory (sha256, sourceSha256, sourceMtime)
  README.md              — this file
  docs/                  — canonical references (constitution, hyd-v2, soma-stsd, 10-step-protocol, 5 stubs)
  templates/             — project/ + module/ + contracts/
  adapters/              — codex/ + claude/ + _global/
  scripts/               — install CLI (soma install, soma sync, soma doctor, soma bootstrap)
  benchmarks/            — REPORT.md copies from Codex workspace
```

## Status

SOMA v2.2 — install pipeline operational. Run `node scripts/install.cjs <project-path> --tool=claude` to instrument a target project. See `manifest.json` for full file inventory with sha256 hashes.

## Install

See [`INSTALL.md`](INSTALL.md) for setup instructions.

Quick start: `node core/scripts/install.cjs <project> --tool=claude`

## Reference

Plan file: `${CLAUDE_HOME}/plans/tem-mais-conte-do-aqui-iridescent-perlis.md`
