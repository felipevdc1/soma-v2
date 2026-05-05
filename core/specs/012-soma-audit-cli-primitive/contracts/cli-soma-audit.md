# Contract: CLI `soma audit --module <path>`

**Type:** CLI command interface
**Spec ACs served:** AC-01, AC-02, AC-03, AC-04, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14

---

## Invocation

```bash
soma audit --module <path> [--check-red-phase] [--no-claude] [--timeout-ms <ms>]
```

**Required env (consumed):**
- `SOMA_SAFE_PATHS_ONLY` (optional, default `0`) — when `1`, enforces module path within `~/.soma-v2/scripts/`
- `SOMA_RED_PHASE_STRICT` (optional, default `0`) — when `1`, enforces RED phase test commits per Article II
- `SOMA_SESSION_ID | CLAUDE_SESSION_ID | CK_SESSION_ID | ITERM_SESSION_ID` (optional, hierarchy per Q3 lock)
- `SOMA_AUDIT_E2E` (optional, default `0`) — when `1`, allows real `claude` CLI calls em test suite

---

## Args

| Arg | Required | Description |
|---|---|---|
| `--module <path>` | yes | Absolute or relative path to `.cjs` file. Relative resolved via `path.resolve(process.cwd(), arg)` per Q4 lock. |
| `--check-red-phase` | no | Enforce Article II HARD discipline (calls `validateRedPhase` on test files matching module). |
| `--no-claude` | no | Skip sense-making layer entirely (deterministic-only). Equivalent to `claude` CLI absent. |
| `--timeout-ms <ms>` | no | Override claude CLI timeout. Default 30000 (30s). |

---

## Stdout (success — exit 0)

JSON matching schema `soma-audit/v1`:

```json
{
  "schema": "soma-audit/v1",
  "module": {
    "path": "${SOMA_HOME}/scripts/sync.cjs",
    "loc": 663,
    "exports": ["sync", "applyAdapter", "loadInstallTargets"],
    "recent_commits": [
      {"sha": "82c6d5e", "date": "2026-05-02", "subject": "Phase 4b: --apply write-mode shipped"}
    ],
    "test_count": 28,
    "help_text": "Usage: sync [options]\n  --apply  Execute writes...",
    "header_comment": "// Phase 4b: --apply write-mode\n// Article XII (c) integration..."
  },
  "capabilities": [
    "dry-run preview",
    "--apply write-mode (Phase 4b shipped)",
    "auto-snapshot pre-write"
  ],
  "bugs": [
    {
      "description": "Position append-end vs Q3 lock BEFORE Failure Log",
      "severity": "high",
      "source": "BF-03 spec 011 empirical"
    }
  ],
  "recent_changes": [
    "Phase 4b --apply mode added 2026-05-02",
    "Snapshot manifest schema v1 introduced"
  ],
  "recommended_spec_scope": "Delta spec for bug fixes (BF-01..BF-07) + missing AC-09 manifest schema validator. Avoid re-implementing --apply.",
  "warnings": [],
  "duration_ms": 3421,
  "session_id": "73bb4c40-8bd5-4f84-868e-38c16683d050",
  "session_id_source": "CK_SESSION_ID",
  "claude_cli_used": true
}
```

**Required top-level fields (AC-11):** `schema`, `module`, `capabilities`, `bugs`, `recent_changes`, `recommended_spec_scope`, `warnings`, `duration_ms`.

**Optional (always present in success):** `session_id`, `session_id_source`, `claude_cli_used`.

---

## Stdout (graceful degradation — exit 0 with warnings)

When `claude` CLI absent OR fails:

```json
{
  "schema": "soma-audit/v1",
  "module": { /* deterministic fields populated */ },
  "capabilities": null,
  "bugs": null,
  "recent_changes": null,
  "recommended_spec_scope": null,
  "warnings": [
    {"code": "CLAUDE_CLI_NOT_FOUND", "message": "claude binary not in PATH; sense-making skipped"}
  ],
  "duration_ms": 187,
  "claude_cli_used": false
}
```

Warning codes (AC-07, AC-08):
- `CLAUDE_CLI_NOT_FOUND`
- `CLAUDE_CLI_TIMEOUT`
- `CLAUDE_CLI_FAILED`
- `CLAUDE_CLI_INVALID_JSON`
- `NOT_GIT_REPO` (Q5 fallback)
- `SESSION_ID_FALLBACK` (AC-10)

---

## Stderr (failure — exit non-zero)

Single-line JSON matching shape `{code, message, hint}` (AC-12):

```json
{"code":"SANDBOX_VIOLATION","message":"--module path /etc/passwd outside sandbox","hint":"Set SOMA_SAFE_PATHS_ONLY=0 to disable, or pass path within ~/.soma-v2/scripts/"}
```

Error codes:
- `SANDBOX_VIOLATION` (AC-02, AC-14) — exit 1
- `MODULE_NOT_FOUND` (AC-04) — exit 1
- `INVALID_ARGS` — exit 2 (missing `--module`, etc.)

---

## Side effects

1. **Marker file** (AC-09): `touch /tmp/soma-discovery-done-{sessionId}` on success exit 0.
2. **Telemetry** (AC-13): JSONL append to `~/.claude/logs/article-xii-{YYYY-MM-DD}.jsonl`:
   ```json
   {"ts":"2026-05-03T12:34:56.789Z","schema":"article-xii-telemetry/v1","action":"audit-completed","module_path":"...","exit_code":0,"duration_ms":3421,"warnings_count":0,"claude_cli_used":true,"session_id_source":"CK_SESSION_ID"}
   ```

---

## Performance contract

- Deterministic layer: p95 ≤500ms
- Claude CLI sense-making: hard timeout 30s (configurable via `--timeout-ms`)
- Total audit: p95 ≤35s

---

## Test fixtures required

- `scripts/tests/fixtures/audit/module-cli.cjs` — fake CLI module with `--help`
- `scripts/tests/fixtures/audit/module-lib.cjs` — fake library module (no CLI)
- `scripts/tests/fixtures/audit/module-empty.cjs` — minimal module
