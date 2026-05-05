# Plan: Soma Bootstrap CLI + Onboarding Doc

**Feature ID:** 008-soma-bootstrap
**Spec:** `specs/008-soma-bootstrap/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

Sprint 008 ships a new `~/.soma-v2/scripts/bootstrap.cjs` orchestrator that performs a fast 5-step validation pipeline (detect `.soma/` → validate `SOMA_HOME` → delegate to `doctor --check-context-routing` → render findings → emit `soma-bootstrap/v1` JSON). Bootstrap is a thin orchestrator: it reuses Phase 2 `lib/manifest.cjs` for SOMA_HOME validation, Phase 4c `lib/module-store.cjs` for `.soma/modules/` enumeration, and the existing `doctor.cjs` API surface (require + invoke check function) for drift detection — zero new business logic. Companion deliverable `~/.soma-v2/docs/onboarding.md` provides external-dev step-by-step (clone→bootstrap→ready) plus 3+ troubleshooting scenarios, written terse for power-user audience (D5 lock). Adapter Contract Cláusula B HARD enforced via AC-14 integration test (sha256 of every `~/.soma-v2/` file pre/post bootstrap must match — read-only proof).

**Stack:**
- Runtime: Node.js v22 (matches Phase 2/3/4)
- Framework: vanilla CommonJS `.cjs` (D7 from Phase 2: zero npm deps, stdlib only)
- Storage: filesystem only (read-only `SOMA_HOME` + read-only `.soma/`)
- Test runner: `node:test` + `node:assert/strict`

**Rationale:** Same shasum-lock discipline (AC-14 baseline preservation). New `scripts/bootstrap.cjs` follows established orchestrator pattern (init.cjs / doctor.cjs / sync.cjs / module.cjs each handle their command). Lib reuse is HARD — bootstrap requires `lib/manifest.cjs` + `lib/module-store.cjs` (Phase 4c) + doctor's exported check function. Zero new lib.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** New `scripts/bootstrap.cjs` orchestrator (NOT extend `doctor.cjs`) | Each top-level CLI command (init/doctor/sync/module/bootstrap) gets its own `.cjs` per Phase 2/3/4 precedent. doctor.cjs already 671 LOC after Phase 4d; further extension creates monolith + conflates "is this usable now?" vs "full health inspection" intents (D6 lock). | Extend `doctor.cjs` with `--bootstrap` flag. Rejected: command intent conflation + LOC bloat + violates D6 boundary. |
| **AD-02:** Doctor delegation via `require()` + invoke exported function (NOT `spawnSync` shell-out) | Performance (no fork overhead, ~50ms saved); error handling cleaner (in-memory exception vs stderr parse); JSON not string-parsed; respects 5s perf budget AC-13. | `spawnSync('node', ['doctor.cjs', '--check-context-routing', '--json'])`. Rejected: adds 50-150ms per invocation; violates perf budget marginally; double-JSON-parse is fragile. |
| **AD-03:** Module enumeration via direct `lib/module-store.cjs` read of `.soma/modules/*.md` (NO inference re-run) | D4 lock: bootstrap NUNCA re-roda H1+H2 inference. Modules already populated by `init --existing` (Spec 003) OR `module add` (Spec 005). Bootstrap only reads + reports. | Re-run `lib/module-inference.cjs` H1+H2 internally. Rejected: violates D4; perf cost (~3-10s scan) violates D7 budget exclusion. |
| **AD-04:** Output schema versioned `soma-bootstrap/v1` paralelo a `soma-manifest/v1` / `soma-doctor/v1` / `soma-bootstrap/v1` | Consistent versioning across CLI commands; future evolution paths preserved. | No version field. Rejected: Phase 5+ schema evolution becomes ambiguous. |
| **AD-05:** `--quiet` flag (não `--json`) pra orchestrator-friendly mode | Phase 2/3/4 commands have human + JSON-block-final default. Default `--json` would conflict semantics. `--quiet` is clearer intent: "no human noise, machine only" — D1 lock. | Default JSON-only with `--human` flag. Rejected: breaks Phase 2/3/4 default convention; orchestrator parsing already works with block-extraction. |
| **AD-06:** Read-only enforcement via AC-14 shasum test (NOT runtime check) | Test verification covers 100% of cases; runtime sha256 of all SOMA_HOME files would add ~200-500ms per invocation, violating AC-13 perf budget. Cláusula B is design intent + test-enforced. | Runtime shasum every invocation. Rejected: perf killer; redundant with test guarantee. |
| **AD-07:** Onboarding.md = pure markdown (no embedded screenshots) — D5 lock | Power-user audience targets terse text-only doc. Screenshots drift fast; maintenance overhead high; not core to Cláusula B testing. Future audience expansion (verbose+screenshots) deferred to separate spec if external user demand surfaces. | Markdown + screenshots stored in `docs/assets/`. Rejected: maintenance burden; D5 lock. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — adds 1 NEW source file (`scripts/bootstrap.cjs`) + 1 NEW doc file (`docs/onboarding.md`). Reuses 3 existing libs (`manifest.cjs`, `module-store.cjs`, `doctor.cjs` exported function). Total: 2 new components. ≤3 ✓
- [x] **Anti-Abstraction Gate** — uses Node stdlib (`fs`, `path`, `os`, `process`) directly. Calls existing libs via `require()` + invoke. No wrappers, no helpers, no facades.
- [x] **Integration-First Gate** — all tests via tmp fixture dirs (`/tmp/soma-bootstrap-fixture-{slug}/`) + real `init` chain + real SOMA_HOME copies. Zero mocks. TDD HARD per Article II + C-2 enforcement (`SOMA_RED_PHASE_STRICT=1`).

All gates **PASS**.

---

## Complexity Tracking

(No gate violations; section blank.)

---

## Dependencies

**External packages:** none (D7: vanilla CommonJS, stdlib only)

**Internal libs (require + reuse, NOT modified):**
- `~/.soma-v2/scripts/lib/manifest.cjs` (Phase 2) — SOMA_HOME validation + manifest.json schema check
- `~/.soma-v2/scripts/lib/module-store.cjs` (Phase 4c) — `.soma/modules/*.md` enumeration + front-matter parsing
- `~/.soma-v2/scripts/doctor.cjs` (Phase 2 + 3 + 4d extended) — exposes `runDoctorCheck({ somaHome, checkContextRouting: true })` exported function

**Internal extensions (modified):**
- `~/.soma-v2/scripts/doctor.cjs` MAY need a small refactor to expose `runDoctorCheck()` as a clean function (currently `main()` style). If so, this is incidental and verified via shasum delta tracked in plan.

---

## References

- Spec: `specs/008-soma-bootstrap/spec.md`
- Contracts: `contracts/bootstrap.md` (CONTRACT-BOOTSTRAP-01)
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles I (Spec as truth), II (TDD HARD), III (Integration-First), IV (Proof Before Done), VII (Simplicity)
- Adapter Contract: `~/.soma-v2/docs/adapter-contract.md` Cláusula B (read-only access pattern)
- Memory: `${CLAUDE_HOME}/projects/{user}/memory/project_soma_executor.md` §"v2.1 Phase 4 SHIPPED" (precedent + lib stack)
