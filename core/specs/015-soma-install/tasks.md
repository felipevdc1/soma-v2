# Tasks: SOMA v2.2 — Soma Install Canonical Command

<!-- Derived from plan.md + 5 contracts/ + spec.md (19 ACs). Every task has spec_ref or contract_ref. Coverage: 19/19 ACs = 100%. -->

**Feature ID:** 015-soma-install
**Spec:** `specs/015-soma-install/spec.md`
**Created:** 2026-05-09

---

## Conventions

- `[P]` — parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:NN]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- All paths relative to `core/` unless absolute. Source repo: `Documents/- projetos claude code/soma-v2/`.

---

## Foundation

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Scaffold install.cjs skeleton + soma.cjs `case 'install':` route + test harness baseline (verify what test runner v2.1.4 uses; reuse). NO logic yet — just argv parsing stub returning exit 0 + dispatcher integration. | [CONTRACT:01] | `core/scripts/install.cjs`, `core/scripts/soma.cjs`, `core/scripts/__tests__/install.test.js` (stub) | TODO |

---

## Wave 1 — Contract Tests (RED phase, BEFORE implementation per Article II)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] Write contract test for `install-cli.md`: argv schema validation, all 7 flags parsed, mutual exclusion enforced, exit codes per contract table. **Tests MUST FAIL** until T-09. | [CONTRACT:01] | `core/scripts/__tests__/install-cli.contract.test.js` | T-01 | TODO |
| T-03 | [P] Write contract test for `install-state-schema.md`: validate JSON schema, required fields, enum constraints, atomic write semantics. **Tests MUST FAIL** until T-10. | [CONTRACT:02] | `core/scripts/__tests__/install-state.contract.test.js` | T-01 | TODO |
| T-04 | [P] Write contract test for `sync-bf06-abort.md`: 3 cases (sha match / mismatch no flag / mismatch with --allow-local-edits) + AC-19 5-element error msg grep. **Tests MUST FAIL** until T-15. | [CONTRACT:03] | `core/scripts/__tests__/sync-bf06-abort.test.js` | T-01 | TODO |
| T-05 | [P] Write contract test for `skill-cross-harness.md`: parse Claude frontmatter + Codex anchored block Args table, assert parity (7 args, triggers, backbone CLI literal). **Tests MUST FAIL** until T-12+T-13. | [CONTRACT:04] | `core/scripts/__tests__/cross-harness-parity.test.js` | T-01 | TODO |
| T-06 | [P] Write contract test for `install-lockfile.md`: lock acquire/release, stale detection 60min, ABORT on contention. **Tests MUST FAIL** until T-09. | [CONTRACT:05] | `core/scripts/__tests__/install-lockfile.test.js` | T-01 | TODO |

---

## Wave 2 — Implementation (per AC, GREEN phase makes Wave 1 tests pass)

### Wave 2a — install.cjs orchestrator core (Layer 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-07 | [P] Implement install.cjs argv parser + flags validator + path resolution (handles spaces+hyphens). Add `// @spec AC-06` integration test (path `/tmp/- soma test fresh hyphen`). | [SPEC:AC-06] [CONTRACT:01] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-02, T-06 | TODO |
| T-08 | [P] Implement greenfield install pipeline: spawnSync init.cjs → manifest.cjs baseline → sync.cjs --apply --tool=. Add `// @spec AC-01` integration test (greenfield in /tmp/soma-test-fresh). | [SPEC:AC-01] [CONTRACT:01] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-02 | TODO |
| T-09 | [P] Implement install-state.json writer (atomic) + lockfile acquire/release with 60min stale detection. Add `// @spec AC-16` integration test (state file invariants) + `// @spec lockfile` test (concurrency). | [SPEC:AC-16] [CONTRACT:02] [CONTRACT:05] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js`, `core/scripts/__tests__/install-lockfile.test.js` | T-03, T-06 | TODO |
| T-10 | [P] Implement idempotent re-run (clean): detect via state file + sha verification → emit "no changes" + exit 0. Add `// @spec AC-02` integration test. | [SPEC:AC-02] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-08, T-09 | TODO |
| T-11 | [P] Implement drift detection (depends on T-15 BF-06 abort): catch sync.cjs exit 2 → propagate + write state.status='drift-detected'. Add `// @spec AC-03` integration test (manual edit inside anchored block). | [SPEC:AC-03] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-08, T-15 | TODO |
| T-12 | [P] Implement partial state recovery: detect `.soma/` exists but no anchor → resume from sync step. Add `// @spec AC-04` integration test. | [SPEC:AC-04] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-08 | TODO |
| T-13 | [P] Implement mid-pipeline failure rollback: catch baseline failure → write state.status='partial-failed' + surface snapshot-id. Add `// @spec AC-05` integration test (simulated EACCES). | [SPEC:AC-05] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-09 | TODO |

### Wave 2b — Custom CLAUDE.md handling

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-14 | [P] Implement `--merge-claude-md` flag (default interactive): preserve free-text + append anchored block. Add `// @spec AC-07` integration test using hydra-like CLAUDE.md fixture. | [SPEC:AC-07] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js`, `core/scripts/__tests__/fixtures/hydra-like-claude.md` | T-08 | TODO |
| T-15 | [P] Implement `--replace-claude-md` flag: snapshot original to `~/.soma-v2/.snapshots/<ts>/` + replace with anchored block. Add `// @spec AC-08` integration test. | [SPEC:AC-08] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-08 | TODO |
| T-16 | [P] Implement abort default in non-interactive: detect TTY + free-text CLAUDE.md → exit 2 naming both flags. Add `// @spec AC-09` integration test (piped invocation). | [SPEC:AC-09] | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | T-08 | TODO |

### Wave 2c — Layer 6 BF-06 sync.cjs fix

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-17 | Edit `core/scripts/sync.cjs` path D4 (LOCAL_EDITS_DETECTED branch): warn-and-overwrite → ABORT exit 2 + 5-element error message per CONTRACT-03. Honor `--allow-local-edits` escape hatch. Update sync.cjs comment to match behavior. **Frozen libs untouched.** Closes Spec 011 AC-13+AC-14 + spec.md AC-14+AC-19. | [SPEC:AC-14] [SPEC:AC-19] [CONTRACT:03] | `core/scripts/sync.cjs`, `core/scripts/__tests__/sync-bf06-abort.test.js` | T-04 | TODO |

---

## Wave 3 — Documentation (Layer 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-18 | [P] Edit `README.md` (root) + `core/README.md`: REMOVE "Lab MVP — structural exhibit, not runtime" claim, REMOVE "scripts currently empty", ADD "## Install" section with one-liner + link to INSTALL.md. | [SPEC:AC-13 sub-effect — clean canonical] | `README.md`, `core/README.md` | T-01 | TODO |
| T-19 | [P] Create `core/docs/INSTALL.md` (~80 lines): pre-reqs (Node v22+ host), 1-shot quickstart, `.soma/`+`manifest.json`+anchored block verification checklist, troubleshooting (3 common errors + recovery via `soma rollback`). Reference INSTALL.md de `soma-v2-build-68-test/docs/INSTALL.md` como base. | [SPEC NFR Host prereq] | `core/docs/INSTALL.md` | T-01 | TODO |
| T-20 | [P] Cross-link consistency check: edit `core/docs/onboarding.md` to remove "Phase 5+ — not automated" phrasing, point to new INSTALL.md. SONAR audit catches breaks. | [SPEC OOS cross-link consistency] | `core/docs/onboarding.md` | T-19 | TODO |

---

## Wave 4 — Slash command prereqs (Layer 3)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-21 | [P] Add Prereq stanza to `core/adapters/claude/commands/soma-run.md`: 5-line block naming `.soma/` check + `soma install` remediation command. | [SPEC:AC-12] | `core/adapters/claude/commands/soma-run.md` | T-01 | TODO |
| T-22 | [P] Add Prereq stanza to `core/adapters/claude/commands/specify.md`. | [SPEC:AC-12] | `core/adapters/claude/commands/specify.md` | T-01 | TODO |
| T-23 | [P] Add Prereq stanza to `core/adapters/claude/commands/plan-sdd.md`. | [SPEC:AC-12] | `core/adapters/claude/commands/plan-sdd.md` | T-01 | TODO |
| T-24 | Edit `core/adapters/claude/bootloader.md`: add "Canonical install command: `soma install`" + skill `/soma:install` reference. | [SPEC:AC-12] | `core/adapters/claude/bootloader.md` | T-21, T-22, T-23 | TODO |
| T-25 | Edit `core/adapters/codex/bootloader.md`: equivalent text for Codex. | [SPEC:AC-12] | `core/adapters/codex/bootloader.md` | T-24 | TODO |
| T-26 | Run `node core/scripts/sync.cjs --apply --tool=claude` (post Wave 4 edits) + verify diff with `--dry-run` first. Adds `core/scripts/__tests__/slash-prereq-guard.test.js` test that asserts each command's body contains "soma install" string post-sync. | [SPEC:AC-12] | (no source edits — runtime check) `core/scripts/__tests__/slash-prereq-guard.test.js` | T-24, T-25, T-17 | TODO |

---

## Wave 5 — Cross-harness skill frontends (Layer 5)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-27 | Create `core/adapters/claude/commands/soma-install.md` per CONTRACT-04 schema: YAML frontmatter (name, description, allowed-tools, triggers, args_schema with 7 args) + body (Bash invocation + 🤖 Agent Report emission instruction). Add `// @spec AC-10` test (transcript inspection for Bash invocation containing `node ~/.soma-v2/scripts/soma.cjs install`). | [SPEC:AC-10] [CONTRACT:04] | `core/adapters/claude/commands/soma-install.md`, `core/scripts/__tests__/install.test.js` | T-08, T-26 | TODO |
| T-28 | Edit `core/adapters/codex/AGENTS.md`: insert anchored block `id=block.codex.AGENTS.soma-install version=2.2.0 sha256={hex64}` per CONTRACT-04 with body (Triggers list + Args table + post-invocation summary instructions). Add `// @spec AC-11` test (parse anchored block, verify backbone CLI literal). | [SPEC:AC-11] [CONTRACT:04] | `core/adapters/codex/AGENTS.md`, `core/scripts/__tests__/install.test.js` | T-08 | TODO |
| T-29 | Validate cross-harness parity per CONTRACT-04: run T-05 contract test (T-05 written in Wave 1, NOW passes after T-27+T-28). Add SONAR pre-check assertion: same triggers + same args + same backbone CLI. | [SPEC:AC-15] [CONTRACT:04] | (test runtime, no new file) | T-27, T-28 | TODO |

---

## Wave 6 — Cleanup + Layer 0 traceability (Layer 0 confirmed orphans)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-30 | Delete `core/.no-execute` (if exists in source) + delete `~/.soma-v2/.no-execute` (lab). Add CI-ish grep test: `grep -rn '\.no-execute' core/` returns 0 matches (scope: soma-controlled repo tree only — user env hooks out of scope per v2.2.1 traceability alignment). | [SPEC:AC-13] | `core/.no-execute` (deleted), `core/scripts/__tests__/no-execute-deletion.test.js` (or one-shot CI assertion) | T-08 | TODO |
| T-31 | [P] Verify frozen libs invariant per AC-17: assert sha256 of `core/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs` matches baselines `6db9bbcb...`/`08a0f164...`/`f13ae144...`. Reuse existing v2.1.4 invariant test if present. | [SPEC:AC-17] | `core/scripts/__tests__/frozen-libs-invariant.test.js` (existing per v2.1.4 — verify present, extend if needed) | T-01 | TODO |
| T-32 | [P] Static AC-18 check: assert `plan.md` cites discovery.json fields. Optional automated check OR manual SONAR step. | [SPEC:AC-18] | (static, plan.md already cites in "Layer 0 Discovery Findings" section) | T-01 | TODO |

---

## Wave 7 — Integration + e2e + Hydra retroactive (Layer 4)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-33 | E2E integration test: full install pipeline against fresh `/tmp/soma-test-fresh` + idempotent re-run + drift detection + `--merge-claude-md` against hydra-fixture. Composite test exercising AC-01 through AC-09. | [SPEC:AC-01..AC-09] | `core/scripts/__tests__/install-e2e.test.js` | T-07 thru T-17 | TODO |
| T-34 | E2E cross-harness smoke (manual or future hook): Claude Code session + prompt "instalar o SOMA neste projeto" → grep agent response for `soma install` literal + absence of "edit CLAUDE.md manually" string. Codex equivalent stubbed (real test deferred — requires Codex env). | [SPEC:AC-10] [SPEC:AC-11] | (manual test artifact OR `core/scripts/__tests__/skill-activation.smoke.md` documenting procedure) | T-27, T-28 | TODO |
| T-35 | SONAR audit Step 8 (5 read-only agents in parallel): architecture, modules, tests, config, **spec-adherence** (test agent verifies AC↔test mapping per sonar-audit.md line 99). Pre-merge gate. | [SPEC:AC-18] (closure) | (audit run, no new file — output report at `~/.claude/logs/sonar-audit-{run-id}.json`) | T-33, T-34 | TODO |
| T-36 | **(POST-MERGE, separate PR in hydra repo)** Run `node ~/.soma-v2/scripts/soma.cjs install '/Users/felipevdc1/Documents/- projetos claude code/hydra' --tool=claude --merge-claude-md`. Verify diff (no removed lines) + anchored block injection + commit hydra changes. | [SPEC:AC-07] (real-world validation) | `Documents/- projetos claude code/hydra/.soma/`, `Documents/- projetos claude code/hydra/manifest.json`, `Documents/- projetos claude code/hydra/CLAUDE.md` | T-33, T-35 (post-merge to soma-v2 main) | TODO |

---

## AC → Task Coverage Matrix (100% required, 100% achieved)

| AC | Task(s) | Status |
|---|---|---|
| AC-01 (greenfield install) | T-08, T-33 | covered |
| AC-02 (idempotent re-run clean) | T-10, T-33 | covered |
| AC-03 (drift detection abort) | T-11, T-33 | covered |
| AC-04 (partial state recovery) | T-12, T-33 | covered |
| AC-05 (mid-pipeline failure) | T-13, T-33 | covered |
| AC-06 (path with space+hyphen) | T-07, T-33 | covered |
| AC-07 (--merge-claude-md) | T-14, T-33, T-36 | covered |
| AC-08 (--replace-claude-md) | T-15, T-33 | covered |
| AC-09 (abort default non-interactive) | T-16, T-33 | covered |
| AC-10 (Claude `/soma:install` activation) | T-27, T-34 | covered |
| AC-11 (Codex equivalent activation) | T-28, T-34 | covered |
| AC-12 (slash command prereq guard) | T-21, T-22, T-23, T-24, T-25, T-26 | covered |
| AC-13 (`.no-execute` deletion) | T-30 | covered |
| AC-14 (BF-06 sync abort) | T-17, T-33 | covered |
| AC-15 (cross-harness args parity) | T-29 | covered |
| AC-16 (state file location) | T-09, T-33 | covered |
| AC-17 (frozen libs invariant) | T-31 | covered |
| AC-18 (Layer 0 traceability) | T-32, T-35 | covered |
| AC-19 (conflict error msg 5 elements) | T-17, T-04 (extended) | covered |

**Total: 19/19 ACs covered = 100%** ✅

---

## Wave Dependency Graph

```
T-01 [FOUNDATION]
  ├─ Wave 1 contract tests (T-02..T-06) [P all]
  │     ├─ T-07..T-16 Wave 2a/2b implementation [P most]
  │     └─ T-17 Wave 2c BF-06 (depends T-04)
  ├─ Wave 3 docs (T-18..T-20) [P most]
  ├─ Wave 4 slash prereqs (T-21..T-26)
  │     └─ T-26 sync apply (depends T-17 — needs BF-06 fix shipped)
  ├─ Wave 5 cross-harness (T-27..T-29) [some P]
  │     ├─ T-27 (depends T-08, T-26)
  │     ├─ T-28 (depends T-08)
  │     └─ T-29 (depends T-27+T-28)
  ├─ Wave 6 cleanup+invariants (T-30..T-32) [P]
  └─ Wave 7 e2e + retroactive
        ├─ T-33 (depends Wave 2 all)
        ├─ T-34 (depends T-27, T-28)
        ├─ T-35 SONAR (depends T-33, T-34) — pre-merge gate
        └─ T-36 hydra retroactive (POST-MERGE in hydra repo)
```

---

## Parallel-safe groups (for `/soma-run` Wave executor)

- **Wave 1 [P]**: T-02, T-03, T-04, T-05, T-06 (5 contract tests, no file overlap)
- **Wave 2a [P]**: T-07, T-08, T-09 (different aspects of install.cjs — coordinate via merge OR sequence if same file)
- **Wave 2b [P]**: T-14, T-15, T-16 (custom CLAUDE.md handling — same install.cjs file, may need to sequence — verify)
- **Wave 3 [P]**: T-18, T-19, T-20 (different doc files)
- **Wave 4 [P]**: T-21, T-22, T-23 (different slash command files)
- **Wave 6 [P]**: T-30, T-31, T-32 (independent)

---

## Notes for `/soma-run` execution

- **Thermal Guard**: max 3 simultaneous compile/test agents. Wave 1 has 5 [P] tests — split into 2 batches if needed.
- **Frozen libs invariant**: T-31 verifies pre-Wave-2 (no edits should break this); SONAR Step 8 re-verifies post-Wave-2 (catches accidental touches).
- **Recovery Protocol**: 3-strike rule per task. After 2 Sonnet failures → escalate Opus. After 3 → STOP AND REPLAN.
- **Capture-Before-Defer**: any item discovered during execution that's NOT in tasks.md → captured in plan.md "Out of Scope" or new spec NEEDS_CLARIFICATION before deferring.
- **Wave 7 T-36 is POST-MERGE in hydra repo** (separate PR), not in soma-v2 PR. Two PRs total: 1 in soma-v2 (Waves 1-7 except T-36) + 1 in hydra (just T-36).
