# Spec: Soma Audit CLI Primitive

**Feature ID:** 012-soma-audit-cli-primitive
**Branch:** `feature/012-soma-audit-cli-primitive`
**Created:** 2026-05-03
**Status:** APPROVED

---

## Context

NEW CLI command `soma audit --module <path>` em `~/.soma-v2/scripts/audit.cjs`. Parte da chain de enforcement do **Constitution Article XII (c)** ("Discover Before Specify") — γ (Article ratificada), α (skill `/specify` Step 0 NEW), β (hook `discover-before-specify.cjs` registered) já shipados em commits anteriores. Esta spec entrega **δ**: a primitive que produz discovery output estruturado e cria marker file que destrava o hook β.

Hybrid approach: **deterministic layer** (filesystem reads — facts mecânicos sobre o módulo) + **sense-making layer** (spawn `claude` CLI headless one-shot pra LLM analysis sobre capabilities/bugs/changes/spec-scope).

Greenfield primitive — `audit.cjs` não existe ainda. Step 0 Discover Before Specify não aplica (verified: zero trigger words em ARGUMENTS).

---

## User Stories

- Como orchestrator antes de `/specify` em feature que estende módulo existente, quero rodar `soma audit --module ~/.soma-v2/scripts/sync.cjs`, pra obter JSON estruturado com (capabilities, bugs, recent_changes, recommended_spec_scope) e prevenir failure mode #9 (spec divergence vs real ecosystem state).
- Como hook `discover-before-specify.cjs`, quero detectar marker file `/tmp/soma-discovery-done-{sessionId}` post-audit, pra desbloquear `/specify` Step 0 sem abort estrutural.
- Como dev em ambiente sem `claude` CLI no PATH, quero `soma audit` degradar graciosamente pra deterministic-only output com warning field, pra não block workflow.

---

## Acceptance Criteria

### Deterministic layer

- **AC-01:** Given `--module <path>` aponta pra `.cjs` file dentro de `~/.soma-v2/scripts/`, when `soma audit` roda, then exit 0 + stdout JSON contém `module.path`, `module.loc` (integer), `module.exports[]` (array of exported names parsed via static AST or regex), `module.recent_commits[]` (array length ≤ 10 com `{sha, date, subject}`), `module.test_count` (integer count de files em `<module-dir>/__tests__/` matching `*<basename>*.test.cjs`).
- **AC-02:** Given `--module <path>` fora de `~/.soma-v2/scripts/` AND `SOMA_SAFE_PATHS_ONLY=1`, when `soma audit` roda, then exit 1 + stderr structured error `{code: "SANDBOX_VIOLATION", message, hint}`.
- **AC-03:** Given módulo é CLI command (file contains `process.argv` parsing OR `require.main === module` block), when `soma audit` roda, then stdout JSON inclui `module.help_text` (raw output de `node <module> --help` capturado, ou `null` se exit non-zero).
- **AC-04:** Given módulo path não existe ou não é file, when `soma audit` roda, then exit 1 + stderr structured error `{code: "MODULE_NOT_FOUND", message, hint}`.

### Sense-making layer (Claude CLI invocation)

- **AC-05:** Given `claude` binary no PATH AND deterministic layer succeeded, when `soma audit` invoca sense-making, then `claude -p <prompt> --output-format json` é spawnado com prompt contendo deterministic context (path, LOC, exports, recent commits, help_text) + instruction asking pra retornar JSON com keys `capabilities[]`, `bugs[]`, `recent_changes[]`, `recommended_spec_scope`.
- **AC-06:** Given claude CLI invocation succeeds + output JSON parses, when audit completes, then stdout JSON merge inclui fields `capabilities[]` (array of strings), `bugs[]` (array of `{description, severity, source}`), `recent_changes[]` (array of strings), `recommended_spec_scope` (string).
- **AC-07:** Given `claude` NOT no PATH (`which claude` exit non-zero), when `soma audit` roda, then exit 0 + stdout JSON contém deterministic fields + sense-making fields = `null` + `warnings[]` includes `{code: "CLAUDE_CLI_NOT_FOUND", message}`.
- **AC-08:** Given claude CLI invocation timeout (>30s) OR returns non-JSON OR exit non-zero, when audit completes, then exit 0 + deterministic fields preserved + sense-making fields = `null` + `warnings[]` includes `{code: "CLAUDE_CLI_FAILED" | "CLAUDE_CLI_TIMEOUT" | "CLAUDE_CLI_INVALID_JSON", message}`.

### Side effects

- **AC-09:** Given audit completes successfully (exit 0, deterministic OR hybrid), when command terminates, then file `/tmp/soma-discovery-done-{sessionId}` is created (touched), where `sessionId = process.env.CLAUDE_SESSION_ID || <fallback>`.
- **AC-10:** Given `CLAUDE_SESSION_ID` env var unset, when audit roda, then `sessionId` fallback = `hostname-${process.pid}` AND audit logs warning `{code: "SESSION_ID_FALLBACK", message}` in stderr (not in JSON output).

### Output contract

- **AC-11:** Given audit completes (any path), when stdout is parsed as JSON, then matches schema `soma-audit/v1` with required top-level fields: `schema`, `module`, `capabilities`, `bugs`, `recent_changes`, `recommended_spec_scope`, `warnings`, `duration_ms`.
- **AC-12:** Given audit fails (exit non-zero), when stderr is parsed, then contains line matching JSON `{code, message, hint}` shape (single line, machine-parseable).

### Telemetry

- **AC-13:** Given any audit invocation (success OR failure), when command terminates, then JSONL line is appended to `~/.claude/logs/article-xii-{YYYY-MM-DD}.jsonl` with fields `{ts, schema: "article-xii-telemetry/v1", action: "audit-completed" | "audit-failed", module_path, exit_code, duration_ms, warnings_count, claude_cli_used: boolean}`.

### Sandbox + safety

- **AC-14:** Given `SOMA_SAFE_PATHS_ONLY=1` AND `--module` resolves to absolute path outside `~/.soma-v2/scripts/`, when audit roda, then SANDBOX_VIOLATION (per AC-02) — even if path exists.
- **AC-15:** Given audit invocation, when claude CLI is spawned, then sense-making prompt does NOT include raw module source code (only deterministic facts: path, LOC, exports, help_text, recent_commits) — prevents leaking sensitive inline config/secrets.

---

## Non-Functional Requirements

- **Performance:** deterministic layer p95 ≤500ms (filesystem reads + git log spawn); sense-making layer claude CLI timeout = 30s hard limit; total audit p95 ≤35s.
- **Security:** never log raw module file contents in stdout/telemetry; only deterministic facts + LLM-derived analysis. ANTHROPIC_API_KEY (if used by claude CLI) never appears in audit output ou telemetry.
- **Test style:** TDD strict (Article II HARD enforced via `SOMA_RED_PHASE_STRICT=1` + `--check-red-phase` flag). RED commits separate from GREEN. Claude CLI invocation mocked in unit tests via fixture pattern (`scripts/tests/fixtures/audit/claude-cli-{success,timeout,invalid-json,not-found}.fixture.js`). Real claude CLI call só em E2E gated por env flag (e.g., `SOMA_AUDIT_E2E=1`, default OFF).
- **Monitoring:** telemetry JSONL logging mirroring Article XI capture-defer-gate pattern. Doctor command future enhancement: `soma doctor --check-audit-staleness` reports last audit timestamp per module (Phase 5+ scope, not this spec).

---

## Out of Scope

- Multi-module batch audit (single `--module` per invocation; iteration is caller's responsibility).
- Caching audit results (every invocation runs fresh; staleness handling is doctor's job).
- Real claude CLI calls em unit/integration test suite (mocked via fixture; E2E gated).
- Auto-cleanup of `/tmp/soma-discovery-done-{sessionId}` markers (caller responsibility OR Phase 5+ enhancement).
- Audit of non-`.cjs` files (markdown docs, json configs) — single language scope MVP.
- `soma audit --all` or recursive directory audit — single file MVP.

---

## Open Questions

_All resolved 2026-05-03 — locked decisions:_

- **Q1 RESOLVED**: claude CLI prompt template = **separate file** at `~/.soma-v2/templates/audit-prompt.md`. Editable sem code change. Audit.cjs reads via `fs.readFileSync` + interpolates deterministic context.
- **Q2 RESOLVED**: marker `/tmp/soma-discovery-done-{sessionId}` policy = **single-use**. β hook (`discover-before-specify.cjs`) deletes marker on consume. Semantics: "discovery happened pra esta /specify invocation; next /specify needs fresh audit."
- **Q3 RESOLVED 2026-05-03 (empirical)**: `CLAUDE_SESSION_ID` env is **NOT exposed** by Claude Code CLI (verified empty in current session). Fallback hierarchy locked:
  1. `SOMA_SESSION_ID` env (caller-provided override) — highest priority
  2. `CLAUDE_SESSION_ID` env (future-proof if Anthropic exposes later)
  3. `CK_SESSION_ID` env (ClaudeKit-provided UUID, e.g., `73bb4c40-8bd5-4f84-868e-38c16683d050`) — verified available
  4. `ITERM_SESSION_ID` env (stable per terminal tab) — verified available
  5. Marker file `/tmp/soma-session-id` (created on first soma invocation if absent, content = `${hostname}-${timestamp}-${pid}`)
  6. `${hostname}-${process.pid}` last resort
  Audit.cjs walks hierarchy top-down, uses first non-empty. Telemetry logs which source was picked (`session_id_source` field).
- **Q4 RESOLVED**: `--module` path resolution = **expand relative via `path.resolve(process.cwd(), arg)`**. SANDBOX_VIOLATION check runs AFTER resolve (compares resolved absolute path against allowlist).
- **Q5 RESOLVED**: git log timing = **per-file last 10**: `git log -n 10 --pretty=format:'{sha, date, subject}' -- <module-path>`. If module dir não é git repo (e.g., ~/.soma-v2/ untracked), `recent_commits[]` = `[]` + warning `{code: "NOT_GIT_REPO", message}`.
- **Q6 RESOLVED**: AC-15 sense-making prompt redaction = **header + signatures allowed**. Audit.cjs extracts (a) top comment block (lines until first non-comment line), (b) `module.exports` signatures (parsed via regex or static analysis). Raw function bodies NEVER included. Inline secrets risk: low (config conventions are env-var based, not inline literals).

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT) — AC-01 mentions "regex or AST" como hint, mas escolha de impl é livre
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining — todos resolvidos 2026-05-03
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry (6 entries)
- [x] Feature ID + Branch filled in

---

## Constitution alignment

- **Article II (HARD)** — TDD strict via `SOMA_RED_PHASE_STRICT=1`. Dispatch prompt sets env. RED commit separate from GREEN.
- **Article IX (HARD)** — spec marker `/tmp/soma-spec-approved-012` required pre-implementation.
- **Article XII (HARD)** — esta spec ENTREGA δ enforcement primitive. Once shipped, hook β can escalate from soft-warn to hard-block (post 30-day telemetry per Article XII Ratification).
- **Article X — Capture Before Defer** — out-of-scope items captured explicitly (multi-module batch, caching, E2E real calls, marker auto-cleanup, non-`.cjs` modules) com Phase 5+ pointers.

---

## Dispatch hints (for Sonnet executor — derived in /plan-sdd)

- Estimated LOC: ~250 (audit.cjs main + lib helpers + fixtures).
- Estimated tests: ~20 (15 ACs + edge cases).
- Sandbox: scratch repo (`/tmp/c-12-work` or similar) — `~/.soma-v2/` not git-tracked, copy back pattern.
- Forbidden files: `~/.soma-v2/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs` (D-C lock + AC-08 shasum invariant).
- Required env in dispatch: `SOMA_RED_PHASE_STRICT=1`, `SOMA_SAFE_PATHS_ONLY=1`.
