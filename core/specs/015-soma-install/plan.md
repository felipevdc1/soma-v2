# Plan: SOMA v2.2 — Soma Install Canonical Command

<!-- guidance: Technical HOW. Never restate spec WHAT. Plan serves spec — if plan contradicts spec, fix plan. Read spec.md + constitution.md before writing. -->

**Feature ID:** 015-soma-install
**Spec:** `specs/015-soma-install/spec.md` (APPROVED 2026-05-09)
**Created:** 2026-05-09
**Status:** DRAFT — awaiting Phase -1 gates verification

---

## Technical Approach

`soma install <project-path>` is a **thin orchestrator subcommand** added to `core/scripts/soma.cjs` dispatcher that composes 3 existing canonical CLI subcommands (`init`, `manifest baseline`, `sync --apply`) in a single fail-loud, idempotent pipeline. Zero reimplementation: install.cjs invokes existing scripts via `child_process.spawnSync` reading their stable CLI interfaces (argv + exit codes), capturing snapshot-ids for rollback. State persisted to `<project>/.soma/install-state.json` (cross-harness single source of truth). Cross-harness disambiguation handled at the skill layer: Claude `/soma:install` slash command source at `core/adapters/claude/commands/soma-install.md` + Codex equivalent as anchored block `id=block.codex.AGENTS.soma-install` in `core/adapters/codex/AGENTS.md`. Both skills invoke same backbone CLI with identical args schema. Bundled BF-06 fix in `core/scripts/sync.cjs` path D4: warn-and-overwrite → ABORT exit 2 + 5-element error message (closes Spec 011 AC-13 + AC-14).

**Stack:**
- Runtime: Node v22+ (host machine prereq; install command itself; target project's runtime independent — Bun/Python/etc OK)
- Language: CommonJS (.cjs) — matches existing soma-v2 lab convention
- No new dependencies — uses only Node stdlib (`fs`, `path`, `child_process`, `crypto`)
- Test runner: existing soma-v2 test harness (mocha-style assertions per existing `__tests__/` patterns)

**Rationale:** v2.1.4 lab is pure Node stdlib — adding deps would fail Article VII Simplicity Gate. install.cjs is orchestration only (~150-200 LOC), no domain logic. Cross-harness handled via existing adapter system (`core/adapters/{claude,codex}/`) which already has `bootloader.md` + skill files — Layer 5 just adds one more file per harness.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **D-01:** install.cjs orchestrates via `child_process.spawnSync` of existing CLI commands | Stable interface contract; respects Article VIII (Anti-Abstraction); reuses tested code | `require()` of init.cjs/manifest.cjs/sync.cjs as modules — rejected: tighter coupling, would expose internals as implicit API, would fail if those scripts run as entry points |
| **D-02:** State file at `<project>/.soma/install-state.json` (NOT `/tmp/`) | Cross-harness single source of truth (Claude + Codex see same file); persists across reboots; reuses `.soma/` dir already created by init | `~/.soma-v2/runs/<runId>/state.json` — rejected: harness-local, lost on reboot, splits state from project |
| **D-03:** Custom CLAUDE.md handling via 3 explicit flags (`--merge-claude-md` default interactive, `--replace-claude-md`, `--abort` default non-interactive) | User intent disambiguated explicitly; preserves user content by default in interactive; safe in CI (abort) | Auto-detect + always-merge — rejected: silent overwrite is exactly the BF-06 anti-pattern we're fixing |
| **D-04:** Layer 6 BF-06 fix surgical — edit `sync.cjs` path D4 only, preserve `--allow-local-edits` escape hatch | Minimal blast radius (~30 LOC); honors existing flag semantics; Spec 011 AC-13 intent finally enforced | Rewrite full sync conflict handling — rejected: scope creep, would touch frozen-libs invariant |
| **D-05:** Codex skill registered as anchored block `block.codex.AGENTS.soma-install` in AGENTS.md | Matches existing pattern (cbm/hyd-v2/soma-stsd blocks); leverages existing `soma sync --apply --tool=codex` propagation; zero new mechanism | New file `core/adapters/codex/skills/soma-install.md` — rejected: Codex CLI doesn't load arbitrary skill files, AGENTS.md is the registry |
| **D-06:** Lockfile at `<project>/.soma/install.lock` (file-based, 60min stale auto-clean) | Simple (~10 LOC); robust to crashes (timestamp check); per-project scope avoids global lock contention | Process check (`ps grep`) — rejected: race-y, doesn't survive reboots; `flock(2)` syscall — rejected: not portable to Windows/WSL2 cleanly |
| **D-07:** Discovery artifact (Layer 0) used for spec, NOT shipped as runtime script | Failure mode #9 prevention is one-shot pre-spec audit; not a recurring runtime concern; saves 1 file in `core/scripts/` | Ship `discovery-audit.cjs` as permanent script — rejected: no runtime use case beyond initial spec |

---

## Phase -1 Gates

<!-- guidance: Constitution Article III (Integration-First) and Article VII (Simplicity). Gates MUST be checked before this plan is marked approved. Violation without rationale = plan is blocked. -->

- [x] **Simplicity Gate** — ≤3 new components/projects (Article VII)
  Components added: (1) `install.cjs` orchestrator; (2) `soma.cjs` route addition (1-line dispatcher edit); (3) cross-harness skill files (Claude + Codex anchored block). 3 ≤ 3 ✅. Zero new external dependencies ✅. install.cjs ≤200 LOC budget enforced via SONAR audit Step 8.

- [x] **Anti-Abstraction Gate** — framework used directly, no custom wrappers (Article VII / VIII)
  install.cjs uses `child_process.spawnSync` directly against existing CLI commands. NO wrapper class, NO abstract `CommandRunner`, NO middleware. Each step (init/manifest/sync) invoked with explicit argv. Error propagation = literal exit code propagation. ✅

- [x] **Integration-First Gate** — tests use real DB / real services, not mocks (Article III)
  All test fixtures use real `/tmp/soma-test-*` directories with real `.soma/` creation, real `manifest.json` writes, real `CLAUDE.md` anchored block injection. Zero mocks for fs operations. Test isolation via per-test temp dirs. Cross-harness skill smoke test uses real Claude Code session (manual or future hook test); Codex equivalent stubbed in v2.2 with real test deferred per NCL-1 resolution path. ✅

---

## Complexity Tracking

<!-- guidance: If any Phase -1 gate is OFF, document rationale here. -->

All 3 gates PASS. No complexity tracking entries needed.

---

## Dependencies

<!-- guidance: External packages, services, or tools this feature requires. Pin versions where possible. -->

- **Node v22+** (host machine, not project) — `child_process.spawnSync` with modern semantics + native crypto.subtle for sha256
- **Existing soma-v2 scripts** (no version pin — internal coupling): `core/scripts/{init,manifest,sync,bootstrap,doctor}.cjs`
- **Existing soma-v2 frozen libs** (HARD invariant — byte-identical to f3c2f0b baselines): `core/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs`
- **`core/adapters/{claude,codex}/`** — existing adapter system for slash command + AGENTS.md propagation
- **Test runner** — existing test infrastructure in `core/scripts/__tests__/` (whatever harness v2.1.4 uses; verify in T-01 foundation)

---

## Layer 0 Discovery Findings (Cited Per AC-18)

This plan derives specific values from `discovery.json` (audited 2026-05-09, sourceRepoSha 51c3272):

- **`.no-execute` orphan** (verdict: orphan-safe-to-delete, zero consumers found): drives AC-13 + Wave 6 cleanup task
- **Adapter layout confirmed**: `core/adapters/claude/commands/{run,specify,plan-sdd,sonar-audit,hyd}.md` + `core/adapters/claude/bootloader.md`; Codex `core/adapters/codex/{AGENTS.md, bootloader.md}` (registry pattern, no separate commands/ dir): drives Wave 4 + Wave 5 file paths
- **BF-06 evidence quote** (`syncBehavior.bf06Evidence`): "sync.cjs line 765-766 says 'BF-06: abort on sha256 mismatch' BUT line 482-489 path D4 emits WARNING and writes anyway. Spec 011 AC-13 requires ABORT": drives Wave 6 surgical edit target
- **Hydra CLAUDE.md sha** (`hydraConflictPreview.currentClaudeMdSha`: `d388fcc2c80207798aefbec38cc2fd1cd6e922986e1949de039db25b925546c2`): drives Wave 7 Layer 4 retroactive flag choice (`--merge-claude-md` confirmed)
- **Bucket A NOT-blocking verdict** (`bucketAStatus.blocking: false`): authorizes parallel ship per NCL-8 resolution; v2.1.5 deferred post-v2.2

---

## References

- **Spec:** `specs/015-soma-install/spec.md`
- **Discovery:** `specs/015-soma-install/discovery.json`
- **Contracts:** `specs/015-soma-install/contracts/`
- **Tasks:** `specs/015-soma-install/tasks.md`
- **Quickstart:** `specs/015-soma-install/quickstart.md`
- **Constitution:** `~/.claude/constitution.md` Articles I (Spec as Source), II (Test-First), III (Integration-First), VII (Simplicity), VIII (Anti-Abstraction), XII (Frozen Libs HARD)
- **Original plan:** `~/.claude/plans/o-que-acontece-eu-precious-tulip.md` (6 layers, 7 waves)
- **Spec 011** (closure context): `core/specs/011-phase5-codex-claude-install/spec.md` — AC-13+AC-14 closed by v2.2; AC-03/AC-05/AC-21 deferred v2.3
