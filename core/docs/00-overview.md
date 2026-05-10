# SOMA v2.1 — Overview

## Purpose
SOMA is a 10-step Spec+Test+Steps Driven (STSD) execution discipline for autonomous agentic work, fusing SDD + TDD + Agent Teams with HYD cognitive guard and SONAR audit, governed by a 10-Article Constitution.

## Layout
- `docs/` — canonical references (constitution, hyd-v2, soma-stsd, 10-step-protocol, plus 5 stubs)
- `templates/` — project + module + contracts
- `adapters/` — codex / claude / _global
- `scripts/` — install CLI (soma install, soma sync, soma doctor, soma bootstrap)
- `benchmarks/` — REPORT.md copies from Codex workspace

## Status
SOMA v2.2 — install pipeline operational. Executable: `node scripts/install.cjs <project> --tool=claude` instruments a target project with SOMA discipline.

## Index
- Constitution → `docs/constitution.md`
- HYD v2 → `docs/hyd-v2.md`
- SOMA/STSD → `docs/soma-stsd.md`
- 10-step protocol → `docs/10-step-protocol.md`
- 5 reference stubs → `docs/{sdd,sonar,context-routing,module-cookbook,evidence}.md`

## Next Phase
Phase 2 (separate session): doctor + sync --dry-run + manifest validation.
