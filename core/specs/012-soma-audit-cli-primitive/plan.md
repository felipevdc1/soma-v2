# Plan: Soma Audit CLI Primitive

**Feature ID:** 012-soma-audit-cli-primitive
**Spec:** `specs/012-soma-audit-cli-primitive/spec.md`
**Created:** 2026-05-03
**Status:** APPROVED

---

## Technical Approach

Single CLI command (`~/.soma-v2/scripts/audit.cjs`) com 2 layers internas: **deterministic** (filesystem reads + git log spawn → fatos mecânicos sobre módulo target) + **sense-making** (`child_process.spawnSync('claude', ['-p', prompt, '--output-format', 'json'])` → LLM analysis sobre capabilities/bugs/changes/spec-scope). Output: structured JSON to stdout matching schema `soma-audit/v1`. Side effects: marker file `/tmp/soma-discovery-done-{sessionId}` (Article XII β hook signal) + JSONL telemetry append em `~/.claude/logs/article-xii-{date}.jsonl`. Graceful degradation: claude CLI absent OR fails → deterministic-only output + warning field. Sandbox: `SOMA_SAFE_PATHS_ONLY=1` enforces module path within `~/.soma-v2/scripts/`.

**Stack:**
- Runtime: Node 22 (matches existing `~/.soma-v2/scripts/` ecosystem)
- Module system: CommonJS (`.cjs` extension, matches existing scripts)
- Test runner: `node:test` (matches existing `scripts/__tests__/` pattern)
- Dependencies: zero new npm packages — `child_process`, `fs`, `path` from Node stdlib only
- External binary: `claude` (via `which`/PATH lookup, optional)

**Rationale:** Match existing SOMA scripts ecosystem 100% — zero stack divergence, zero new install steps, zero `package.json` creation (handoff confirmed `~/.soma-v2/package.json` doesn't exist e não devemos criar). Article VII (Simplicity) — direct `child_process` API usage, no SDK wrapper.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **Use `claude` CLI via spawn (não Anthropic SDK)** | User feedback ratificado 2026-05-03; sem API key extra; sem `package.json` creation; reuses the user's authenticated session. | Anthropic SDK direct: requires `npm install @anthropic-ai/sdk` + `ANTHROPIC_API_KEY` setup + adiciona node_modules a um repo não-tracked. Rejected. |
| **Hybrid deterministic + LLM (não LLM-only)** | Determinístico cobre 80% do failure mode #9 sozinho (path/LOC/exports/commits). LLM agrega só o que heurística não captura (bug intuition, scope recommendation). | Pure LLM: lento + custo + unreliable em fact recall. Rejected. |
| **Prompt template em file separado (não inline)** | Q1 lock: `~/.soma-v2/templates/audit-prompt.md`. Editável pós-MVP sem code change. | Inline string em audit.cjs: simpler MVP mas freezes prompt evolution. Rejected. |
| **Session ID fallback hierarchy 6-deep** | Q3 empirical: `CLAUDE_SESSION_ID` NÃO exposed. Hierarchy `SOMA_SESSION_ID > CLAUDE_SESSION_ID > CK_SESSION_ID > ITERM_SESSION_ID > marker-file > hostname-pid` cobre todos cenários. | Hard-fail se nenhum disponível: bloqueia desenvolvimento sem motivo. Rejected. |
| **Sub-module decomposition (lib/audit-*.cjs helpers)** | Permite Wave 2 paralelização por arquivo (sem overlap). Cada lib testável isoladamente. | Monolithic audit.cjs: tudo um arquivo, Wave 2 forçadamente sequencial. Rejected. |
| **Mock claude CLI em unit tests via fixture** | Real `claude` calls em CI = $$ + flaky + non-deterministic. Fixture pattern matches existing SOMA test conventions. | Real calls em unit tests: fail mode em CI. Rejected. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — ≤3 new components: (1) `audit.cjs` main + (2) `lib/audit-*.cjs` helpers (counted as 1 component) + (3) `templates/audit-prompt.md`. ✅ PASS.
- [x] **Anti-Abstraction Gate** — `child_process` API used directly; no SDK wrapper class; no "ClaudeCLIClient" abstraction. ✅ PASS.
- [x] **Integration-First Gate** — Real filesystem operations in tests (tmp dirs); real git log spawn in tests; only `claude` CLI mocked (per NFR Test style — real claude CLI is $$ + flaky em CI, mock via fixture pattern matches SOMA convention). E2E real call gated por `SOMA_AUDIT_E2E=1` env. ✅ PASS with documented exception.

---

## Complexity Tracking

| Gate violated | Reason (must ref AC-XX) | Revisit trigger |
|---|---|---|
| _none_ | — | — |

---

## Dependencies

- **Node 22** — already installed (existing SOMA ecosystem)
- **`claude` CLI** — the user's existing Claude Code install (optional dependency; graceful fallback per AC-07)
- **`git`** — system binary (used by deterministic layer for log spawn)
- Zero npm packages — no `package.json` creation, no `node_modules`

---

## References

- Contracts: `contracts/cli-soma-audit.md`, `contracts/cli-claude-invocation.md`
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles II (TDD HARD), VII (Simplicity), IX (Spec Approval Gate), XII (Discover Before Specify — esta feature DELIVERS δ enforcement)
- Spec 012: `spec.md` (15 ACs, 6 questions resolved)
- Failure Mode #9: `~/.claude/CLAUDE.md` (esta feature é mitigation operacional)
- Article XI capture-defer-gate (`~/.claude/hooks/capture-defer-gate.cjs`) — referência de pattern pra telemetry JSONL + hook structure
