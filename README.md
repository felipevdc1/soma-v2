# SOMA v2.1

**Spec-Test-Steps-Driven orchestration for LLM workflows**

**Created by [@o.felipecarneiro](https://instagram.com/o.felipecarneiro) · Inspired by [@zbrunomoreira](https://instagram.com/zbrunomoreira)**

---

## What is SOMA?

SOMA is a disciplined orchestration framework for LLM-driven development. It enforces a 10-step STSD (Spec + Test + Steps Driven) pipeline that prevents the most common failure modes: shallow pattern-matching, skipped verification, and deferred work that never gets done.

At its core, SOMA installs a set of structural gates — hooks that run at key points in your workflow — to enforce spec-first thinking, test traceability, and anti-rationalization. Every change goes through: Specify → Plan → Tasks → Execute in Waves → Validate → Audit → Commit.

Cross-session continuity is built in: snapshot-based rollback, handoff buckets, and a SOMA Voxel output-style theme ensure that agent state is preserved and legible across sessions, adapters, and LLMs.

---

## Key Features

- **17 SOMA-CORE hooks** — anti-shallowness gates covering cognitive discipline, spec completeness, test traceability, capture-before-defer, and insight-action coupling
- **11 slash commands** — `/soma:run`, `/soma:specify`, `/soma:plan-sdd`, `/soma:sonar-audit`, `/soma:dispatch`, and more, covering the full 10-step pipeline
- **Idempotent install** — `soma sync --apply` applies adapter config with snapshot-based rollback (2ms, byte-identical restore validated)
- **Snapshot-based rollback** — every apply captures pre-state; rollback is instant and deterministic
- **SOMA Voxel output-style theme** — 18 semantic bar-block types for structured agent output (inspired by [@zbrunomoreira](https://instagram.com/zbrunomoreira))
- **Multi-adapter** — Codex and Claude Code (production); cursor, aider, and chatgpt-desktop (EXPERIMENTAL)

---

## Quick Install

> **Phase 6.4 — install.sh not yet shipped.**
>
> TODO: This section will be filled in when `INSTALL.md` is available (Phase 6.4 of the distribution sequence).
> For now, see `core/docs/` for manual setup guidance.

**Requirements:**
- Node.js ≥ 22
- macOS, Linux, or WSL2

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Contributing

Issues and PRs welcome at [github.com/felipevdc1/soma-v2](https://github.com/felipevdc1/soma-v2/issues).

Please read the internal design history in `core/specs/README.md` before proposing architectural changes — many decisions have non-obvious rationale baked into the spec history.
