# Tasks: SOMA v2.1 Phase 3 — Init Command + Sample Project

**Feature ID:** 002-soma-init
**Spec:** `specs/002-soma-init/spec.md`
**Created:** 2026-05-01

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Step 4 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

All paths relative to `~/.soma-v2/` unless absolute. Sources canônicos `~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `~/.claude/CLAUDE.md` são **read-only** durante toda Phase 3 (Phase 3 toca apenas `target_path` user-supplied + `/tmp/` fixtures).

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] (a) Implement `scripts/lib/template-engine.cjs` exporting `renderTemplate(templateContent, vars)` (regex substitution `{{KEY}}` → `vars[KEY]`; throws if any `{{` remains post-substitution) + `nowISO8601()` helper. (b) Implement `scripts/lib/agents-md-injector.cjs` exporting `injectBootloader({existingContent, blockBody, blockId, version})` returning `{newContent, action: "create"\|"inject", blockSha256}` — uses `lib/anchored-blocks.cjs#parseAnchorAttrs` + `computeBlockSha256` for block detection + sha computation; throws `AGENTS_MD_PARSE_ERROR` if existing AGENTS.md has block already. (c) Unit tests `scripts/__tests__/lib-template-engine.test.cjs` covering: substitution, throw on unresolved placeholder, ISO8601 format validation. (d) Unit tests `scripts/__tests__/lib-agents-md-injector.test.cjs` covering: create-from-empty, append-to-existing-no-block, throw-when-block-already-present, blank-line-separator. | [SPEC:AC-05] [SPEC:AC-04] | `scripts/lib/template-engine.cjs` (new), `scripts/lib/agents-md-injector.cjs` (new), `scripts/__tests__/lib-template-engine.test.cjs` (new), `scripts/__tests__/lib-agents-md-injector.test.cjs` (new) | TODO |

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

<!-- Per Article III: contract tests BEFORE implementation. RED phase: these tests must fail before any impl is written. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] Write contract tests for `contracts/init.md`: assert CLI accepts `[path]` positional + `--with-agents-md`/`--dry-run`/`--json`/`--quiet`/`--verbose`/`--soma-home` flags, output JSON matches schema (greenfield, --with-agents-md, --dry-run, redirect modes), invalid flag combinations return INVALID_ARGS (exit 2), redirect mode returns exit 1 with `error: ALREADY_INITIALIZED` + `suggested_commands` array. Tests use `/tmp/soma-init-test-{uuid}/` fixture. **RED phase: these MUST fail until T-03 lands.** | [CONTRACT:init] [SPEC:AC-08] | `scripts/__tests__/init.contract.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

<!-- One task per AC (or AC group). Each task implements code that makes Wave 1 contract tests pass + adds spec-traceability test. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | Implement `scripts/init.cjs` (full CLI: greenfield create, --with-agents-md inject, --dry-run preview, redirect on existing .soma/, --json/--quiet/--verbose output, exit codes 0/1/2). Parse args (per CONTRACT-INIT-01), resolve target path (default cwd), check `.soma/` existence → if exists emit redirect; else read 4 templates from `$SOMA_HOME/templates/project/`, render via `lib/template-engine.cjs`, write to target, write `installed-state.json` (schema soma-installed-state/v1). If `--with-agents-md`: invoke `lib/agents-md-injector.cjs` against `$path/AGENTS.md`. Add integration test `// @spec AC-01` in `scripts/__tests__/init.greenfield.test.cjs`: invoke against `/tmp/` fixture, assert exit 0, assert exatamente 4 files created (`.soma/{project.md, CONTEXT.md, modules/index.md, installed-state.json}`), assert installed-state.json schema valido + soma_version=`2.1.0-draft`. | [SPEC:AC-01] | `scripts/init.cjs` (new), `scripts/__tests__/init.greenfield.test.cjs` (new) | T-02 | TODO |
| T-04 | [P] Add integration test `// @spec AC-02` in `scripts/__tests__/init.redirect.test.cjs`: setup fixture com `.soma/` pré-existente (vazio ou populado), capture shasum -a 256 do directory tree pre-run, invoke `node scripts/init.cjs $fixture` (sem flags) e `--with-agents-md`, capture shasums post-run, assert all `OK` (zero modification), exit code = 1, JSON output contém `mode: "redirect"`, `error: "ALREADY_INITIALIZED"`, `suggested_commands` array com 2 commands ref to doctor + sync. | [SPEC:AC-02] | `scripts/__tests__/init.redirect.test.cjs` (new) | T-03 | TODO |
| T-05 | [P] Add integration tests `// @spec AC-03 AC-04` in `scripts/__tests__/init.with-agents-md.test.cjs`: (a) Test path sem AGENTS.md pré-existente — invoke `init --with-agents-md`, assert AGENTS.md created, contém `<!-- soma-v2:start id=project.AGENTS.bootloader version=2.1.0-draft sha256=` (real hex, não FILL_AT_INSTALL), `installed-state.json.agents_md_managed === true`. (b) Test path com AGENTS.md pré-existente contendo conteúdo arbitrário (e.g., `"# My Project Notes\nLine that must persist.\n"`), invoke `init --with-agents-md`, assert: pré-existing content preserved byte-for-byte (substring match + diff), anchored block adicionado separado por blank line, sha256 attribute = sha real do block content. | [SPEC:AC-03] [SPEC:AC-04] | `scripts/__tests__/init.with-agents-md.test.cjs` (new) | T-03 | TODO |
| T-06 | [P] Add integration test `// @spec AC-05` in `scripts/__tests__/init.placeholders.test.cjs`: invoke init em fixture `/tmp/soma-init-test-{slug}/`, assert `grep -L '{{' $fixture/.soma/* $fixture/AGENTS.md` retorna todos os files (zero placeholders unresolved), assert `{{PROJECT_NAME}}` replaced por basename do path (verificável via grep do basename em project.md), assert `{{ISO8601_DATE}}` replaced por string que valida regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`. | [SPEC:AC-05] | `scripts/__tests__/init.placeholders.test.cjs` (new) | T-03 | TODO |
| T-07 | [P] Add integration test `// @spec AC-06` in `scripts/__tests__/init.dry-run.test.cjs`: setup fixture limpo, capture shasum tree pre-run, invoke `init --dry-run` (greenfield) + `init --dry-run --with-agents-md` (greenfield) + `init --dry-run` em fixture com `.soma/` existing (redirect dry-run), capture shasum post-run em todos casos, assert all `OK` (zero modification em qualquer cenário), output (JSON e human) lista files que seriam criados em `summary.files_planned` (greenfield) ou retorna redirect (existing). | [SPEC:AC-06] | `scripts/__tests__/init.dry-run.test.cjs` (new) | T-03 | TODO |
| T-08 | [P] Add integration test `// @spec AC-07` in `scripts/__tests__/init.sample-pipeline.test.cjs`: gera `$SAMPLE = /tmp/soma-sample-${randomBytes(4).hex}/`, executa pipeline `init $SAMPLE --with-agents-md` → `doctor --soma-home $SAMPLE/.soma` → `sync --dry-run --soma-home $SAMPLE/.soma`, assert init exit=0, doctor exit=0 com `summary.findings_count === 0`, sync exit=0 com `summary.actionable === 0` (ou equivalent — sample is in-sync com seu próprio template baseline). Cleanup com `fs.rmSync($SAMPLE, {recursive, force})` em `t.afterEach`. | [SPEC:AC-07] | `scripts/__tests__/init.sample-pipeline.test.cjs` (new) | T-03 | TODO |
| T-09 | [P] Add integration test `// @spec AC-08` in `scripts/__tests__/init.exit-codes.test.cjs`: invoke init em 4 cenários (greenfield success → exit 0, already-initialized → exit 1, --json --quiet conflict → exit 2 + INVALID_ARGS, target_path inválido (e.g., escapando `..` muito) → exit 2 + TARGET_PATH_INVALID), assert exit codes corretos + JSON parseable em todos os 4 cenários (`jq empty` retorna 0). | [SPEC:AC-08] | `scripts/__tests__/init.exit-codes.test.cjs` (new) | T-03 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-10 | Add regression smoke test in `scripts/__tests__/phase3-regression.test.cjs`: (a) capture pre-state via `shasum -a 256` of all canonical sources (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `~/.soma-v2/manifest.json`, `~/.soma-v2/adapters/codex/install-targets.json`); (b) run full init pipeline em `/tmp/soma-init-regression-{uuid}/` (init + init --with-agents-md + init --dry-run + init redirect); (c) verify post-state shasums match pre-state (zero modification em sources canônicos OR lab); (d) execute `node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs` and assert "tests 38 / pass 38 / fail 0"; (e) cleanup `/tmp/soma-init-regression-*` fixtures. Smoke validates Phase 3 não regride Phase 2 (110 tests pass) + zero side effects em the user's actual setup. | [SPEC:AC-02] [SPEC:AC-04] [SPEC:AC-06] | `scripts/__tests__/phase3-regression.test.cjs` (new) | T-03, T-05 | TODO |

---

## Coverage matrix (verification)

| AC | Task(s) | Coverage |
|---|---|---|
| AC-01 (greenfield init creates 4 files) | T-03 | ✓ |
| AC-02 (re-run redirect) | T-04 | ✓ |
| AC-03 (--with-agents-md no pre-existing) | T-05 | ✓ |
| AC-04 (--with-agents-md preservation) | T-05 | ✓ |
| AC-05 (placeholder substitution) | T-01 (lib unit), T-06 (integration) | ✓ |
| AC-06 (--dry-run zero side effects) | T-07 | ✓ |
| AC-07 (sample project pipeline) | T-08 | ✓ |
| AC-08 (exit codes + JSON schema) | T-02 (contract), T-09 (integration) | ✓ |

**Coverage: 8/8 ACs (100%).**

---

## Dispatch notes

- **Wave 2 [P] tasks (T-04..T-09) são paralelizáveis** — cada um toca file de teste único + depende de T-03 (init.cjs implementation). T-03 é sequencial (single impl, all CLI behavior).
- **TDD ordering enforced**: T-02 (contract test) MUST fail RED before T-03 implements. Verifiable via git log: T-02 commit `red:` prefix landing before T-03 `impl:` commit.
- **No file overlap dentro de waves**: T-04..T-09 cada um toca apenas seu test file unique → [P] safe.
- **T-01 unit tests** podem ser red-then-green dentro do próprio T-01 (Sonnet implement libs + tests no mesmo task; OK).
- **Sample project cleanup**: T-08 e T-10 fazem cleanup explícito de `/tmp/soma-sample-*` e `/tmp/soma-init-test-*` em `t.afterEach`. NUNCA deixar /tmp leak entre tests (Article V hygiene).
- **Real templates source**: tests precisam que `~/.soma-v2/templates/project/` esteja intact pre-run. Sonnet deve verificar via `ls ~/.soma-v2/templates/project/` antes de impl.
- **Snapshot baseline**: Sonnet captura `shasum -a 256` de canonical sources + `manifest.json` + `adapters/codex/install-targets.json` + `adapters/claude/install-targets.json` antes de qualquer task e usa como AC-02/AC-06 + T-10 oracle. **Baseline já capturada pelo orchestrator em `/tmp/phase3-baseline.sha256`** (5 shasums: codex AGENTS, ~/AGENTS, constitution, manifest, codex install-targets).
- **Reuse de Phase 2 libs**: T-03 e T-01 fazem `require('./lib/anchored-blocks.cjs')` (sibling) + `require('./lib/manifest.cjs')` (sibling). NÃO duplicate code; NÃO modify Phase 2 libs (lock per AD-04 Phase 2 manifest frozen).
