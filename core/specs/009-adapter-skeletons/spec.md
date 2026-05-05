# Spec: Adapter Skeletons — Cursor / Aider / ChatGPT-desktop

**Feature ID:** 009-adapter-skeletons
**Branch:** `feature/009-adapter-skeletons`
**Created:** 2026-05-02
**Status:** APPROVED (2026-05-02 — 6/6 D resolutions locked via defaults-all pattern, user ratified "aceito")

---

## User Stories

- Como dev SOMA expanding ecosystem cross-LLM, quero adapter skeletons cursor/aider/chatgpt-desktop pré-existentes em `~/.soma-v2/adapters/`, pra Phase 5+ adapter rollout poder install em diferentes hosts sem refactor SOMA core (Adapter Contract Cláusula C unblock).
- Como dev externo avaliando SOMA pra integration com diferentes harnesses, quero ver adapter folders com structure consistente (install-targets.json + bootloader.md) per Adapter Contract Cláusula A/C, pra entender o pattern de extensão sem ler código.
- Como `soma doctor` running drift checks, quero processar new adapters folders sem erro, pra cobertura de adapters ficar visível em fast health check.
- Como `soma bootstrap` (Spec 008) enumerating adapters, quero ver os 3 novos adapters em output `adapters: [...]`, pra dev externo ver `install_targets_count: 0` indicando "skeleton present, install Phase 5+".

---

## Acceptance Criteria

### Folder structure

- **AC-01:** Given Sprint 009 shipped, when `ls ~/.soma-v2/adapters/`, then output inclui directories `cursor/`, `aider/`, `chatgpt-desktop/` (kebab-case naming consistent com `codex/` + `claude/` precedent).
- **AC-02:** Given each new adapter folder, when `ls {folder}`, then folder contém minimum 2 files: `install-targets.json` + `bootloader.md`.

### install-targets.json schema conformance

- **AC-03:** Given each new adapter `install-targets.json`, when JSON parsed, then root object tem keys: `schema`, `tool`, `entries` (matching schema `soma-install-targets/v1`).
- **AC-04:** Given each new adapter `install-targets.json`, when validated, then `schema === "soma-install-targets/v1"`, `tool === <folder-basename>` (cursor/aider/chatgpt-desktop), `entries` is array (may be empty `[]` MVP per D1 lock).

### bootloader.md structure

- **AC-05:** Given each new adapter `bootloader.md`, when parsed, then file contém H1 title `# {Tool} Adapter — Bootloader`, H2 `## Responsibilities` section com numbered list (≥3 items), H2 `## Non-responsibilities` section com bulleted list (≥2 items). Mirror codex/bootloader.md structural pattern.

### Tool-name conventions

- **AC-06:** Given new adapters folder names, when verified, then names = `cursor`, `aider`, `chatgpt-desktop` (NO underscores, NO PascalCase, lowercase kebab-case per existing codex/claude precedent + D6 lock).

### Doctor + bootstrap integration

- **AC-07:** Given Sprint 009 shipped, when `node ~/.soma-v2/scripts/doctor.cjs --check-context-routing` é executado em SOMA-enabled project, then exit 0 + zero ERROR-level findings caused pelos novos adapters (skeletons válidos, doctor processa sem falha).
- **AC-08:** Given Sprint 009 shipped, when `node ~/.soma-v2/scripts/bootstrap.cjs --quiet` é executado em SOMA-enabled project, then output JSON `adapters[]` array tem ≥5 entries (claude + codex pré-existentes + cursor + aider + chatgpt-desktop novos).

### Test infrastructure

- **AC-09:** Given new adapter test file `~/.soma-v2/scripts/__tests__/adapter-skeletons.test.cjs`, when `node --test {test-file}` é executado, then ≥10 tests pass cobrindo: folder existence, file existence per adapter, JSON schema conformance, bootloader.md structure validation, tool-name kebab-case enforcement.
- **AC-10:** Given full SOMA test suite is rerun post-Sprint-009, then 655+ tests cumulative still pass-or-skip (zero regression em existing tests; ~10-15 new added by AC-09).

### Read-only canonical preservation

- **AC-11:** Given Sprint 009 ship event, when 6 canonical+lib files são shasum-compared pre/post (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `lib/anchored-blocks.cjs`, `lib/manifest.cjs`, `lib/template-engine.cjs`), then diff is empty (zero modification — Cláusula B HARD enforced).
- **AC-12:** Given Sprint 009 ship event, when hooks aggregate `node --test ~/.claude/hooks/*.test.cjs` is rerun, then 48+/48+ pass (Sprint 010 may add 1 hook test independently, but that's separate; aqui asserting baseline preserved).

### Optional integration.md not in MVP

- **AC-13:** Given new adapters em MVP, when `ls {adapter-folder}/integration.md` é executado, then file does NOT exist (D3 lock — integration.md deferred to Phase 5+ when tool-specific runtime is actually scoped per adapter).

---

## Non-Functional Requirements

- **Performance:** N/A (pure artifact creation, no runtime impact)
- **Security:** No external network calls. No credential handling. Files are static markdown + JSON.
- **Test style:** Integration tests use real `~/.soma-v2/adapters/` filesystem reads (no mocks). Tests file-based assertions only (existence, JSON parse, content patterns). Phase 2/3/4 lib reuse for JSON validation if needed.
- **Test count target:** ≥10 tests (smaller scope than 008/010 since pure artifact-level)
- **Output convention:** N/A (no CLI command added)
- **TDD discipline:** RED commits separated from GREEN per Article II + C-2 enforcement (`SOMA_RED_PHASE_STRICT=1`).
- **Monitoring:** N/A (artifact-only)

---

## Out of Scope

- **Phase 5 operacional install** — `sync --apply --tool=cursor` (or aider, chatgpt-desktop) em real targets. Skeleton ships entries: [] empty; Phase 5+ populates real entries com source_doc + target_path.
- **Per-adapter integration.md runtime detail** — D3 lock: integration.md NOT created MVP. Phase 5+ when each tool's hook/MCP/extension API is actually scoped + implementable.
- **Tool-specific install-target paths research** — e.g., does Cursor have a `~/.cursor/rules.md` equivalent? Aider's `.aiderignore` integration? ChatGPT desktop config location? All deferred Phase 5+ where research informs entries[] population.
- **CLI commands específicos por adapter** — Cursor IDE has its own CLI; Aider has commands; ChatGPT desktop has its own UX. SOMA não wraps them; SOMA provides bootloader docs each tool consumes.
- **Test infrastructure for tool-runtime integration** — adapter unit tests (à la Phase 4 module testing). Adapters are artifacts; runtime behavior fica scope of Phase 5+ adapter-rollout spec.
- **Adapter authoring docs / "how to add adapter N+1" tutorial** — Adapter Contract D-C11 documented em `~/.soma-v2/docs/adapter-contract.md` covers the contract; tutorial doc é Phase 5+ if external community contributions surface.

---

## Resolved Decisions

6/6 NCs sentenced 2026-05-02 by the user ("aceito" = accept defaults all path mirror Spec 008/010):

- **D1 — install-targets.json entries pre-populated?**: `entries: []` empty array MVP, mirror claude precedent. Real entries[] populated Phase 5+ when each tool's user-facing config path is researched + locked. Empty array still validates schema-conformant (per AC-04).
- **D2 — bootloader.md content authoring**: structure mirrors codex/bootloader.md literal (Responsibilities + Non-responsibilities sections), wording adapted to tool nature (e.g., Cursor IDE bootloader mentions "extension-loaded behavior" vs Codex CLI mentions "headless agentic"). Avoid copy-paste literal — each adapter says "Read .soma/CONTEXT.md and module docs" mas with tool-specific framing.
- **D3 — integration.md included MVP?**: NO. integration.md deferred Phase 5+. AC-13 explicitly enforces absence. Avoids shipping empty placeholder file.
- **D4 — doctor.cjs extension required?**: NO new code. Existing doctor (post-Sprint-008 with `enumerateAdapters` exposed) processes new folders identically to codex/claude. Pure artifact addition = zero code changes em scripts/.
- **D5 — Test resilience pattern**: bootstrap test from Sprint 008 currently asserts ≥2 adapters (claude+codex). Sprint 009 increases to ≥5. New `adapter-skeletons.test.cjs` asserts existence + schema + structure per AC-09. Sprint 008 existing tests will see 5 adapters em fixtures pero Sprint 008 fixtures are synthetic isolation (own `/tmp/`) — should NOT regress.
- **D6 — Tool-name conventions**: kebab-case lowercase. `cursor`, `aider`, `chatgpt-desktop`. NO underscores, NO PascalCase. Matches codex/claude precedent.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] All `[NEEDS CLARIFICATION]` markers replaced by Proposed Decisions awaiting user ratification
- [x] NFR section has performance + security + test style + monitoring
- [x] Out of Scope section has 6 entries
- [x] Feature ID + Branch filled in
