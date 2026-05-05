# Tasks: Soma Module Cookbook Commands

**Feature ID:** 005-soma-module-cookbook
**Spec:** `specs/005-soma-module-cookbook/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: every test file committed in RED phase BEFORE implementation. RED commit verified via `validateRedPhase` against `/tmp/phase4c-work/` scratch git repo (since `~/.soma-v2/` is not git-tracked).

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/phase4c-work/` scratch git repo + copy `~/.soma-v2/scripts/doctor.cjs` baseline; capture shasum baseline of 6 canonical+lib files; confirm 315/315 SOMA + 48/48 hooks pass pre-work; capture `~/.soma-v2/docs/module-cookbook.md` original 449-byte content for AC-14 preservation check. | [CONTRACT:module-commands] | `/tmp/phase4c-work/{git-init,doctor.cjs}`, `/tmp/phase4c-shasum-before.txt`, `/tmp/module-cookbook-original.md` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:module-commands] Write contract test stub (RED commit) covering all 4 subcommands + doctor extension per CONTRACT-MODULE-CMDS-01. Initial tests fail intentionally (validateRedPhase asserts RED). | [CONTRACT:module-commands] [SPEC:AC-01..AC-15] | `~/.soma-v2/scripts/__tests__/contract-module-cmds.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Each task: write integration test `// @spec AC-XX` → RED commit → minimal impl → GREEN commit. Per-AC granularity preserves traceability.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 `module add {keyword}` creates `.soma/modules/{slug}.md` from template `module.md.tmpl` with `status: hypothesis`, `initialized_at: ISO8601`, `name: {keyword}`. | [SPEC:AC-01] | `~/.soma-v2/scripts/__tests__/ac-01-module-add-creates.test.cjs`, `scripts/module.cjs` (add subcmd), `scripts/lib/module-store.cjs` (NEW) | T-02 | TODO |
| T-04 | [P] AC-02 `module add` w/ existing slug returns `MODULE_EXISTS` exit 1. | [SPEC:AC-02] | `~/.soma-v2/scripts/__tests__/ac-02-module-add-exists.test.cjs`, `scripts/lib/module-store.cjs` (collision check) | T-02 | TODO |
| T-05 | [P] AC-03 `module promote {slug}` updates front-matter `status: hypothesis → active` + adds `promoted_at`/`last_verified` ISO. Body preserved verbatim. | [SPEC:AC-03] | `~/.soma-v2/scripts/__tests__/ac-03-promote-hypothesis-to-active.test.cjs`, `scripts/module.cjs` (promote subcmd), `scripts/lib/module-store.cjs` (front-matter rewrite) | T-02 | TODO |
| T-06 | [P] AC-04 `module promote` on already-active returns `ALREADY_ACTIVE` exit 1, no modification. | [SPEC:AC-04] | `~/.soma-v2/scripts/__tests__/ac-04-promote-already-active.test.cjs`, `scripts/lib/module-store.cjs` | T-02 | TODO |
| T-07 | [P] AC-05 `module promote` on non-existent slug returns `MODULE_NOT_FOUND` exit 1. | [SPEC:AC-05] | `~/.soma-v2/scripts/__tests__/ac-05-promote-not-found.test.cjs`, `scripts/lib/module-store.cjs` (existence check) | T-02 | TODO |
| T-08 | [P] AC-06 `module remove {slug}` w/ `--yes` flag deletes module file + companion snippet. Without flag, prompt confirmation. | [SPEC:AC-06] | `~/.soma-v2/scripts/__tests__/ac-06-module-remove.test.cjs`, `scripts/module.cjs` (remove subcmd) | T-02 | TODO |
| T-09 | [P] AC-07 `module deprecate {slug}` updates front-matter `status: deprecated` + `deprecated_at`. File preserved on disk. | [SPEC:AC-07] | `~/.soma-v2/scripts/__tests__/ac-07-module-deprecate.test.cjs`, `scripts/module.cjs` (deprecate subcmd) | T-02 | TODO |
| T-10 | [P] AC-08 `doctor` surfaces `severity: warning, code: stale_hypothesis` for modules ≥90d old. Doctor exit 0 (non-blocking per D6). Existing doctor checks unchanged. | [SPEC:AC-08] | `~/.soma-v2/scripts/__tests__/ac-08-doctor-stale-hypothesis.test.cjs`, `scripts/doctor.cjs` (extension) | T-02 | TODO |
| T-11 | [P] AC-09 `module add --with-snippet` creates `~/.soma-v2/cookbook/snippets/{slug}.json` w/ schema `{schema, slug, keywords, snippets: []}` skeleton. | [SPEC:AC-09] | `~/.soma-v2/scripts/__tests__/ac-09-with-snippet.test.cjs`, `scripts/lib/module-store.cjs` (snippet emit) | T-02 | TODO |
| T-12 | [P] AC-10 `module add` WITHOUT `--with-snippet` does NOT create snippet JSON (lazy/opt-in). | [SPEC:AC-10] | `~/.soma-v2/scripts/__tests__/ac-10-no-snippet-default.test.cjs`, `scripts/lib/module-store.cjs` (flag gate) | T-02 | TODO |
| T-13 | [P] AC-11 slug derivation table-driven: `"Auth System"` → `auth-system`; `"foo  bar!"` → `foo-bar`; `"--leading"` → `leading`; trim/collapse all variants. Slug printed to stdout pre-creation. | [SPEC:AC-11] | `~/.soma-v2/scripts/__tests__/ac-11-slug-derivation.test.cjs`, `scripts/lib/module-store.cjs` (deriveSlug fn) | T-02 | TODO |
| T-14 | [P] AC-12 reserved slug rejection: `manifest`, `snapshots`, `evidence`, `modules`, `cookbook`, `config` all return `RESERVED_SLUG` exit 1. | [SPEC:AC-12] | `~/.soma-v2/scripts/__tests__/ac-12-reserved-slug.test.cjs`, `scripts/lib/module-store.cjs` (RESERVED set) | T-02 | TODO |
| T-15 | [P] AC-13 integration with Phase 4a `init --existing` output: simulate detected modules from inference (e.g. `app`, `lib`, `components`), run `module add` for each, verify `.soma/modules/{slug}.md` populated via public command (not direct write). | [SPEC:AC-13] | `~/.soma-v2/scripts/__tests__/ac-13-init-existing-populate.test.cjs`, integration entry | T-02 | TODO |
| T-16 | [P] AC-14 `~/.soma-v2/docs/module-cookbook.md` evolution: original 449 bytes preserved as-is; `## Cookbook commands (Phase 4c)` section appended at end. Diff first 449 bytes pre/post — must be byte-identical. | [SPEC:AC-14] | `~/.soma-v2/scripts/__tests__/ac-14-cookbook-md-preserve-append.test.cjs`, edit `~/.soma-v2/docs/module-cookbook.md` (append section) | T-02 | TODO |
| T-17 | [P] AC-15 backward compat regression: 315/315 SOMA tests + 48/48 hooks regression preserved + 6 canonical+lib shasums match `/tmp/phase4c-shasum-before.txt`. | [SPEC:AC-15] | `~/.soma-v2/scripts/__tests__/phase4c-regression.test.cjs` (NEW, bridge wrapper pattern) | T-02 | TODO |
| T-18 | [P] D4 `module promote` w/ schema-broken front-matter (extra unknown fields, malformed YAML, missing required keys) aborts `SCHEMA_INVALID` exit 1. | [SPEC:AC-03 + D4] | `~/.soma-v2/scripts/__tests__/d4-promote-schema-invalid.test.cjs`, `scripts/lib/module-store.cjs` (schema validate) | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-19 | E2E integration smoke: synthetic SOMA_HOME in `/tmp/soma-mod-e2e-{slug}/`, run init→module add×3 (incl. --with-snippet)→promote 1→deprecate 1→remove 1→doctor (verify stale-hypothesis findings absent because freshly created). Validates full pipeline. | [CONTRACT:module-commands] | `~/.soma-v2/scripts/__tests__/e2e-module-cmds.test.cjs` | T-03..T-18 | TODO |
| T-20 | Copy-back from `/tmp/phase4c-work/` scratch repo to `~/.soma-v2/scripts/` + `~/.soma-v2/docs/module-cookbook.md` (D2 append section). Re-verify all tests pass in destination. RED+GREEN commits visible in scratch repo via git log; report SHAs. | [CONTRACT:module-commands] | `~/.soma-v2/scripts/module.cjs`, `~/.soma-v2/scripts/lib/module-store.cjs`, `~/.soma-v2/scripts/doctor.cjs`, `~/.soma-v2/docs/module-cookbook.md` | T-19 | TODO |

---

## Coverage Verification

- AC-01 → T-03 ✓
- AC-02 → T-04 ✓
- AC-03 → T-05 ✓
- AC-04 → T-06 ✓
- AC-05 → T-07 ✓
- AC-06 → T-08 ✓
- AC-07 → T-09 ✓
- AC-08 → T-10 ✓
- AC-09 → T-11 ✓
- AC-10 → T-12 ✓
- AC-11 → T-13 ✓
- AC-12 → T-14 ✓
- AC-13 → T-15 ✓
- AC-14 → T-16 ✓
- AC-15 → T-17 ✓
- D4 (promote schema-invalid) → T-18 ✓

**Coverage: 15/15 ACs (100%) + D4 explicit task. 20 tasks total: 1 foundation + 1 contract test + 16 impl + 2 integration/wiring/copy-back.**
