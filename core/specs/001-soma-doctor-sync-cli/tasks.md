# Tasks: SOMA v2.1 Phase 2 — Doctor and Sync Dry-Run CLI

**Feature ID:** 001-soma-doctor-sync-cli
**Spec:** `specs/001-soma-doctor-sync-cli/spec.md`
**Created:** 2026-05-01

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Step 4 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

All paths relative to `~/.soma-v2/` unless absolute. Sources canônicos `~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `~/.claude/CLAUDE.md` são read-only durante toda Phase 2.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] (a) Edit `adapters/codex/install-targets.json` adicionando 2 entries duplicadas com `target_path: "~/AGENTS.md"` (CBM + soma-stsd) — total 5 entries, schema v1 preserved (per AD-02). (b) Remove sentinel `scripts/.phase-1-empty`. (c) Implement `scripts/lib/anchored-blocks.cjs` (functions: `extractBlock(filepath, blockId)`, `parseAnchorAttrs(content)`, `computeBlockSha256(content)`). (d) Implement `scripts/lib/manifest.cjs` (functions: `loadManifest(somaHome)`, `loadInstallTargets(somaHome, tool)`, schema v1 validation). (e) Unit tests `scripts/__tests__/lib-anchored-blocks.test.cjs` + `scripts/__tests__/lib-manifest.test.cjs` covering parser edge cases (lowercase, missing attrs, malformed JSON). | [SPEC:AC-01] | `adapters/codex/install-targets.json` (edit), `scripts/.phase-1-empty` (delete), `scripts/lib/anchored-blocks.cjs` (new), `scripts/lib/manifest.cjs` (new), `scripts/__tests__/lib-anchored-blocks.test.cjs` (new), `scripts/__tests__/lib-manifest.test.cjs` (new) | TODO |

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

<!-- Per Article III: contract tests BEFORE implementation. RED phase: these tests must fail before any impl is written. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] Write contract tests for `contracts/check-doctor.md`: assert CLI accepts `--json`/`--quiet`/`--verbose`/`--soma-home` flags, output JSON matches schema (tool/mode/summary/findings shape), invalid flag combinations return INVALID_ARGS, exit codes (0/1/2). Tests use `/tmp/soma-test-{uuid}/` fixture. **RED phase: these MUST fail until T-04 lands.** | [CONTRACT:check-doctor] [SPEC:AC-06] | `scripts/__tests__/doctor.contract.test.cjs` | T-01 | TODO |
| T-03 | [P] Write contract tests for `contracts/sync-dry-run.md`: assert CLI rejects without `--dry-run` flag, accepts `--dry-run`/`--json`/`--verbose`/`--soma-home`/`--tool` flags, output JSON schema (tool/mode/adapters_scanned/summary/findings with action enum), exit codes (0/1/2). **RED phase.** | [CONTRACT:sync-dry-run] [SPEC:AC-06] | `scripts/__tests__/sync.contract.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

<!-- One task per AC. Each task implements code that makes Wave 1 contract tests pass + adds spec-traceability test. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-04 | [P] Implement `scripts/doctor.cjs`: parse args (per CONTRACT-DOCTOR-01), load manifest+install-targets, iterate sources, detect 3 known drifts (D1: `~/AGENTS.md` missing `block.codex.AGENTS.soma-stsd`; D2: missing `block.codex.AGENTS.codebase-memory-mcp`; D3: anchors in `~/.codex/AGENTS.md` lack `id=`/`version=`/`sha256=`), emit findings categorized by `kind` (target_drift/source_staleness/lab_corruption). Add integration test `// @spec AC-01` in `scripts/__tests__/doctor.drift-detection.test.cjs` using `/tmp/` fixture replicating real `~/`: assert exatamente 3 findings (kind=target_drift; severities = missing/missing/drift), zero false positive. | [SPEC:AC-01] | `scripts/doctor.cjs` (new), `scripts/__tests__/doctor.drift-detection.test.cjs` (new) | T-02 | TODO |
| T-05 | [P] Add integration test `// @spec AC-02` in `scripts/__tests__/doctor.read-only.test.cjs`: capture shasum -a 256 of all canonical sources + entire `~/.soma-v2/` tree pre-run, invoke `node scripts/doctor.cjs` against `/tmp/` fixture, capture shasums post-run, assert all `OK` (zero modification). Test runs against fixtures cloned via `cp -R`. | [SPEC:AC-02] | `scripts/__tests__/doctor.read-only.test.cjs` (new) | T-02 | TODO |
| T-06 | [P] Implement `scripts/sync.cjs`: parse args (per CONTRACT-SYNC-DRYRUN-01), enforce `--dry-run` mandatory, load manifest+install-targets+sources, per entry compute action (`insert`/`replace`/`skip`/`drift`) by extracting target anchor + comparing sha256, emit findings with target_path/target_anchor_id/source_doc/expected_sha256/actual_sha256. Add integration test `// @spec AC-03` in `scripts/__tests__/sync.dry-run-edits.test.cjs` using `/tmp/` fixture: assert sync reports 2 `insert` actions for `~/AGENTS.md` (CBM + soma-stsd) + 3 `skip` actions for `~/.codex/AGENTS.md` entries (or `drift` if D3 still present). | [SPEC:AC-03] | `scripts/sync.cjs` (new), `scripts/__tests__/sync.dry-run-edits.test.cjs` (new) | T-03 | TODO |
| T-07 | [P] Add integration test `// @spec AC-04` in `scripts/__tests__/sync.read-only.test.cjs`: same shape as T-05 — capture shasums pre, invoke `node scripts/sync.cjs --dry-run` against `/tmp/` fixture, capture post, assert all `OK`. | [SPEC:AC-04] | `scripts/__tests__/sync.read-only.test.cjs` (new) | T-03 | TODO |
| T-08 | [P] Add test `// @spec AC-07` in `scripts/__tests__/exit-codes.test.cjs`: invoke doctor + sync in 3 fixture states (drift-present, in-sync, hard-error) and assert exit codes (1/0/2 respectively for each tool). | [SPEC:AC-07] | `scripts/__tests__/exit-codes.test.cjs` (new) | T-04, T-06 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-09 | Add hooks regression smoke test `// @spec AC-05` in `scripts/__tests__/hooks-regression.test.cjs`: (a) capture pre-state via `shasum -a 256` of all canonical sources, (b) run `node scripts/doctor.cjs` against real `~/.soma-v2/` (no `--soma-home` override) — note this test is itself read-only so safe, (c) run `node scripts/sync.cjs --dry-run` against real `~/.soma-v2/`, (d) verify post-state shasums match pre-state, (e) execute `node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs` and assert "tests 38 / pass 38 / fail 0" in output. Smoke validates real-world idempotence + zero side-effects on the user's actual setup. | [SPEC:AC-05] | `scripts/__tests__/hooks-regression.test.cjs` (new) | T-04, T-06 | TODO |

---

## Coverage matrix (verification)

| AC | Task(s) | Coverage |
|---|---|---|
| AC-01 (3 known drifts) | T-04 | ✓ |
| AC-02 (doctor read-only) | T-05 | ✓ |
| AC-03 (sync dry-run output) | T-06 | ✓ |
| AC-04 (sync read-only) | T-07 | ✓ |
| AC-05 (hooks regression preserved) | T-09 | ✓ |
| AC-06 (JSON output) | T-02, T-03 (contract tests assert JSON schema) + T-04, T-06 (impl) | ✓ |
| AC-07 (exit codes) | T-08 | ✓ |

**Coverage: 7/7 ACs (100%).**

---

## Dispatch notes

- **Wave 1 + Wave 2 são paralelizáveis dentro de cada wave** mas não entre waves (T-04 depends on T-02, T-06 depends on T-03).
- **TDD ordering enforced**: T-02/T-03 (contract tests) MUST fail RED before T-04/T-06 implement. Verifiable via git log: T-02/T-03 commits with `red:` prefix landing before T-04/T-06 `impl:` commits.
- **No file overlap dentro de waves**: T-02 toca apenas `__tests__/doctor.contract.test.cjs`; T-03 apenas `__tests__/sync.contract.test.cjs` — [P] safe. Wave 2 tasks each touch unique file → [P] safe.
- **install-targets edit em T-01** afeta `adapters/codex/install-targets.json` — Sonnet deve usar Edit (not Write) preservando schema/formatting; verificação: `jq empty < adapters/codex/install-targets.json && jq '.entries | length' < ... = 5`.
- **No deletion check (Step 5 Validate)**: T-01 deleta `scripts/.phase-1-empty` (sentinel) — esperado, rationale em commit message.
- **Snapshot baseline**: Sonnet captura `shasum -a 256` de canonical sources antes de qualquer task e usa como AC-02/AC-04/AC-05 oracle.
