# Changelog

All notable changes to SOMA v2.1 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-05-05

### Initial Release

First public release of SOMA v2.1.

### Added
- Core framework with 12 specs (001-soma-doctor → 012-soma-audit)
- 17 SOMA-CORE hooks for anti-shallowness enforcement
- 11 slash commands (`/soma:run`, `/soma:specify`, `/soma:plan-sdd`, ...)
- 7 templates (decision, spec, plan, tasks, handoff, FAMILY_DOC, contracts)
- Multi-adapter architecture (Codex, Claude — production; cursor, aider, chatgpt-desktop — EXPERIMENTAL)
- SOMA Voxel output-style theme (18 bar-block types — inspired by [@zbrunomoreira](https://instagram.com/zbrunomoreira))
- Snapshot-based rollback (2ms byte-identical restore validated)
- Article XII Discover-Before-Specify enforcement (3 layers — Constitution + slash hook + telemetry)
- Insight→Action Coupling (Layer 4 hook + telemetry)

### Acknowledgments
- **Bruno Moreira** ([@zbrunomoreira](https://instagram.com/zbrunomoreira)) — SOMA Voxel theme inspiration, original SomaCanvas family aesthetic, fundação sólida 8-item checklist
