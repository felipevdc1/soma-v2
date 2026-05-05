# Tasks: Soma Init Existing — Module Inference From Existing Project

**Feature ID:** 003-soma-init-existing
**Spec:** `specs/003-soma-init-existing/spec.md`
**Created:** 2026-05-01

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Scaffold `lib/module-inference.cjs` skeleton (exports `detectModulesFilesystem(targetPath, opts)` + `rankByGitCommitCount(modules, targetPath, windowDays)` + `loadGitignore(targetPath)`) + add `--existing` arg parsing branch in `init.cjs` (returns NOT_IMPLEMENTED for now); reuse Phase 2/3 libs via `require('./lib/anchored-blocks.cjs')` `require('./lib/manifest.cjs')` `require('./lib/template-engine.cjs')` (zero modification per AC-08); add `templates/project/.soma/modules/module.md.tmpl` from spec schema if missing | [SPEC:AC-08] | `scripts/init.cjs` (extend), `scripts/lib/module-inference.cjs` (NEW), `templates/project/.soma/modules/module.md.tmpl` (verify exists or NEW) | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] Write contract test suite for CONTRACT-INIT-EXISTING-01 covering all 14 test stubs in `contracts/init-existing.md` (H2 src/ detection, workspaces, framework dirs, src/-first NC-1, schema fields, --deep ranking, --deep fallback no git, redirect AC-07, libs untouched AC-08, empty repo AC-10, single-file AC-11, cross-LLM AC-12, INVALID_ARGS combinations) — TDD RED phase enforced (Article II): all tests fail at this point because impl is stubs only | [CONTRACT:init-existing] | `scripts/__tests__/init-existing.contract.test.cjs` (NEW) | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] Implement H2 `src/` subdirs detection in `module-inference.cjs#detectModulesFilesystem` + add integration test `// @spec AC-01` in `__tests__/init-existing.h2-src.test.cjs` using fixture `tests/fixtures/init-existing/cli-library/` | [SPEC:AC-01] | `scripts/lib/module-inference.cjs`, `scripts/__tests__/init-existing.h2-src.test.cjs`, `scripts/tests/fixtures/init-existing/cli-library/` (NEW fixture) | T-02 | TODO |
| T-04 | [P] Implement H2 `package.json#workspaces` detection + integration test `// @spec AC-02` using fixture `tests/fixtures/init-existing/monorepo/` (with `package.json {workspaces: [...]}` + `packages/foo/index.ts` + `packages/bar/index.ts` + `expected-modules.json`) | [SPEC:AC-02] | `scripts/lib/module-inference.cjs`, `scripts/__tests__/init-existing.h2-workspaces.test.cjs`, `scripts/tests/fixtures/init-existing/monorepo/` (NEW fixture) | T-02 | TODO |
| T-05 | [P] Implement H2 framework dirs detection (`app/`, `pages/`, `components/`, `lib/`, `api/`) + src/-first priority rule (NC-1: when src/ exists, ONLY src/* subdirs detected; framework dirs at root only when no src/) + integration test `// @spec AC-03` using fixture `framework-heavy/` (Next.js shape: src/app/ + src/components/ but NO root app/ pages/) | [SPEC:AC-03] | `scripts/lib/module-inference.cjs`, `scripts/__tests__/init-existing.h2-framework.test.cjs`, `scripts/tests/fixtures/init-existing/framework-heavy/` (NEW fixture) | T-02 | TODO |
| T-06 | [P] Implement module file emission in `init.cjs --existing` branch: instantiate `templates/project/.soma/modules/module.md.tmpl` per detected module, populate `schema=soma-module/v1`, `status=hypothesis`, `source_confidence=low`, `owners=[]`, `last_verified=null`, `verification.command=null`, `verification.files_checked=[detected paths]` + integration test `// @spec AC-04` validating each `.soma/modules/{name}.md` content | [SPEC:AC-04] | `scripts/init.cjs`, `scripts/__tests__/init-existing.module-emit.test.cjs` | T-02 | TODO |
| T-07 | [P] Implement `--deep` git-history-ranked detection in `module-inference.cjs#rankByGitCommitCount` (uses `child_process.execSync('git log --since="90 days ago" --pretty=format:"%H" -- {path}', {cwd: target})` per detected H2 module candidate; filter `commit_count >= 1`) + integration test `// @spec AC-05` using fixture monorepo + `git init` + multi-commit history setup in test | [SPEC:AC-05] | `scripts/lib/module-inference.cjs`, `scripts/__tests__/init-existing.deep-rank.test.cjs` | T-02 | TODO |
| T-08 | [P] Implement `--deep` no-git fallback: when `--deep` flag set but `.git/` absent (or `git log` fails with ENOENT), emit warning "no git history available, falling back to filesystem heuristic" and return H2 result with `git_repo_detected=false` + `heuristic="H2"` + `deep_requested=true` (exit 0 per AC-06, NOT exit 1) + integration test `// @spec AC-06` | [SPEC:AC-06] | `scripts/lib/module-inference.cjs`, `scripts/init.cjs`, `scripts/__tests__/init-existing.deep-fallback.test.cjs` | T-02 | TODO |
| T-09 | [P] Implement `.soma/` already-exists redirect (mirroring Phase 3 D1 lock): when `path.join(target, '.soma')` exists, return `mode=redirect`, `error=ALREADY_INITIALIZED`, `suggested_commands=[doctor, sync --dry-run]`, exit code 1 + integration test `// @spec AC-07` | [SPEC:AC-07] | `scripts/init.cjs`, `scripts/__tests__/init-existing.redirect.test.cjs` | T-02 | TODO |
| T-10 | [P] Implement zero-modification regression test: pre-compute sha256 of `lib/anchored-blocks.cjs` + `lib/manifest.cjs` + `lib/template-engine.cjs` BEFORE invoking `init --existing`; re-compute AFTER; assert deepEqual + integration test `// @spec AC-08` runs after every other Wave 2 test | [SPEC:AC-08] | `scripts/__tests__/init-existing.libs-untouched.test.cjs` | T-02 | TODO |
| T-11 | [P] Build AC-09 fixture validation suite: 3 fixtures (`framework-heavy/`, `cli-library/`, `monorepo/`) under `scripts/tests/fixtures/init-existing/` each with `expected-modules.json` ground-truth list; test invokes `init --existing` per fixture, computes `hit_rate = |detected ∩ expected| / |expected|`, asserts `>= 0.6` per fixture; also validates evidence file `evidence/{date}/init-existing-fixture-{slug}.md` is written per D-C10 sub-clause (front-matter `modules: [list]`) | [SPEC:AC-09] | `scripts/__tests__/init-existing.fixture-validation.test.cjs`, `scripts/tests/fixtures/init-existing/{framework-heavy,cli-library,monorepo}/expected-modules.json` (3 NEW), `~/.soma-v2/evidence/.gitkeep` (NEW dir convention) | T-02, T-03, T-04, T-05 | TODO |
| T-12 | [P] Implement empty/no-source repo handling: when H2 returns empty list, still write `.soma/project.md` + `.soma/CONTEXT.md` + `.soma/manifest.json` + `.soma/modules/index.md` (with empty modules list + message "no modules inferred"), exit 0 + integration test `// @spec AC-10` | [SPEC:AC-10] | `scripts/init.cjs`, `scripts/__tests__/init-existing.empty-repo.test.cjs` | T-02 | TODO |
| T-13 | [P] Implement ≥1 file threshold (NOT ≥3 per AC-11) in `module-inference.cjs#detectModulesFilesystem`: a candidate dir with exactly 1 source file is emitted as valid module + integration test `// @spec AC-11` | [SPEC:AC-11] | `scripts/lib/module-inference.cjs`, `scripts/__tests__/init-existing.threshold.test.cjs` | T-02 | TODO |
| T-14 | [P] Implement cross-LLM portability schema validation: assert generated `.soma/project.md` and `.soma/modules/{name}.md` contain ZERO references to Claude-specific primitives (slash command names like `/specify`, hook IDs like `thermal-guard.cjs`, skill IDs); test scans output via `grep` patterns and rejects matches + integration test `// @spec AC-12` | [SPEC:AC-12] | `scripts/__tests__/init-existing.cross-llm.test.cjs` | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-15 | Wire `--existing` branch as first-class CLI mode in `init.cjs` entry: arg dispatcher routes `--existing` flag to new branch (vs greenfield default); reject `--with-agents-md` combined with `--existing` (INVALID_ARGS); reject `--json --quiet` combination; `--verbose` mode prints per-module detection rationale; full E2E smoke test invoking `node scripts/init.cjs --existing /tmp/soma-real-test/ --json` validates full output schema matches CONTRACT-INIT-EXISTING-01 | [SPEC:AC-01] [SPEC:AC-04] [SPEC:AC-12] [CONTRACT:init-existing] | `scripts/init.cjs`, `scripts/__tests__/init-existing.e2e-smoke.test.cjs` | T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-12, T-13, T-14 | TODO |
| T-16 | Add Phase 4a regression suite: extends `phase3-regression.test.cjs` (or new `phase4a-regression.test.cjs`) to spawn `node --test` over all Phase 4a tests via bridge wrapper pattern (Node v22 NODE_TEST_CONTEXT recursion workaround used in Phase 2/3); verifies cumulative count = 238 (Phase 2+3) + N (Phase 4a) all pass; verifies 38/38 hooks regression also passes via subagent-init.cjs invocation | [SPEC:AC-08] [CONTRACT:init-existing] | `scripts/__tests__/phase4a-regression.test.cjs` (NEW) | T-15 | TODO |

---

## Coverage Verification

12 ACs in spec.md (AC-01 through AC-12). Tasks with `[SPEC:AC-XX]`:
- AC-01 → T-03
- AC-02 → T-04
- AC-03 → T-05
- AC-04 → T-06
- AC-05 → T-07
- AC-06 → T-08
- AC-07 → T-09
- AC-08 → T-01, T-10, T-16
- AC-09 → T-11
- AC-10 → T-12
- AC-11 → T-13
- AC-12 → T-14

**Coverage: 12/12 = 100%** ✓

Plus contract reference: T-02 + T-15 [CONTRACT:init-existing] (covering CONTRACT-INIT-EXISTING-01).

---

## Implementation Notes

- **TDD ordering enforced (Article II)**: Wave 1 (T-02 contract test) MUST execute and FAIL before Wave 2 implementation tasks T-03..T-14 begin. Verifiable via git log: commit containing T-02 must precede commit containing T-03 (or any Wave 2 impl task) AND `node --test scripts/__tests__/init-existing.contract.test.cjs` must show RED in that interval.
- **Parallel safety in Wave 2**: T-03..T-14 are all marked `[P]` because they touch distinct test files + add code to `module-inference.cjs` in distinct functions (detectModulesFilesystem H2-src vs H2-workspaces vs H2-framework vs rankByGitCommitCount vs threshold). Sonnet executor must be careful to merge changes without conflict — recommend Sonnet writes T-03..T-14 sequentially in single dispatch despite [P] flag.
- **Reuse-first**: Phase 2/3 libs (`anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) are imported via `require()` and never modified. AC-08 is verified via shasum pre/post (T-10). Any modification to these libs is a regression and rejects the dispatch.
- **Fixture sources**: 3 fixtures under `scripts/tests/fixtures/init-existing/` are committed with the implementation (not gitignored). Each fixture is a real synthetic mini-project; tests use `fs.cpSync(fixture, tmpdir, {recursive: true})` to copy fresh per test run.
- **Evidence dir convention** (D-C10): `evidence/{YYYY-MM-DD}/init-existing-{fixture-slug}.md` with front-matter `modules: [list]` is written by T-11 fixture validation suite. Creates `~/.soma-v2/evidence/` dir if absent (`.gitkeep`).
- **No `--dry-run` for `--existing` in Phase 4a** (spec Out-of-Scope). Future enhancement, NOT a blocker.
