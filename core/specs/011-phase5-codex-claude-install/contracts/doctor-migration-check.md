# Contract: Tool Call — soma doctor (migration extension)

**Contract ID:** CONTRACT-011-03-doctor-migration-check
**spec_ref:** [SPEC:AC-10] [SPEC:AC-11] [SPEC:AC-12] [SPEC:AC-20]
**Created:** 2026-05-02
**Type:** internal CLI command (extension of existing `~/.soma-v2/scripts/doctor.cjs`)

---

## Tool Name

```
soma doctor [--check-migration] [--check-context-routing]
```

(extension; existing flags preserved per backward-compat)

---

## Description

Extension of existing SOMA doctor command. Adds detection of pre-existing OLD-format markers in target bootloader files (Codex AGENTS.md, Claude CLAUDE.md) that predate soma-v2 anchor format frozen rev 2. Reports migration_needed status with WARNING level (yellow), exit 0 (non-fatal — coexist mode is functional).

---

## Arguments

```json
{
  "check-migration": {
    "type": "boolean",
    "required": false,
    "default": true,
    "description": "If true (default in Phase 5+), scan target bootloader files for OLD-format markers + report migration_needed in output. If false, skip migration scan.",
    "example": true
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--check-migration` | flag | no | Default true. Pass `--check-migration=false` to skip |

---

## Output

**Success — no migration needed (AC-10):**
```json
{
  "checks": {
    "manifest_valid": true,
    "install_targets_valid": true,
    "adapters_count": 5,
    "install_targets_count": 8,
    "migration_check": {
      "migration_needed": false,
      "old_markers_detected": 0,
      "scanned_files": [
        "~/.codex/AGENTS.md",
        "~/AGENTS.md",
        "~/.claude/CLAUDE.md"
      ]
    }
  },
  "errors": [],
  "warnings": [],
  "exit_code": 0
}
```

**Success — migration needed (AC-10):**
```json
{
  "checks": {
    "manifest_valid": true,
    "install_targets_valid": true,
    "adapters_count": 5,
    "install_targets_count": 8,
    "migration_check": {
      "migration_needed": true,
      "old_markers_detected": 3,
      "old_markers_by_file": {
        "~/.codex/AGENTS.md": [
          {"marker_name": "codebase-memory-mcp", "byte_position_start": 245, "byte_position_end": 1832},
          {"marker_name": "hyd-v2", "byte_position_start": 1840, "byte_position_end": 3201},
          {"marker_name": "soma-stsd", "byte_position_start": 3210, "byte_position_end": 5841}
        ]
      },
      "migration_command_hint": "Run `soma sync --apply --tool=codex --migrate` to convert OLD markers to soma-v2 v2 anchors em-place (auto-snapshot preserves OLD content for rollback)."
    }
  },
  "errors": [],
  "warnings": [
    {
      "level": "WARNING",
      "code": "MIGRATION_NEEDED",
      "message": "3 OLD-format markers detected. Migration is OPTIONAL (coexist mode functional). Use --migrate flag with sync --apply to convert."
    }
  ],
  "exit_code": 0
}
```

**Error codes:**
| Code | When |
|---|---|
| `MANIFEST_MISSING` | `~/.soma-v2/manifest.json` missing or unparseable |
| `INSTALL_TARGETS_MISSING` | Adapter folder lacks `install-targets.json` |
| `INSTALL_TARGETS_SCHEMA_INVALID` | install-targets schema does not match `soma-install-targets/v1` |

**Warning codes:**
| Code | Level | When |
|---|---|---|
| `MIGRATION_NEEDED` | WARNING | One or more OLD-format markers detected in target bootloader files |
| `INSTALL_TARGETS_EMPTY` | WARNING | Adapter has `entries: []` (e.g., cursor/aider/chatgpt-desktop pre-Phase 6) |

---

## Side Effects

- None — read-only command (Article V: does NOT count toward compile/test thermal limit).
- Output goes to stdout (JSON) + stderr (human-readable summary).

---

## Idempotency

- **Idempotent:** yes
- **If called twice:** Second call produces identical output (assuming no state changes between calls).

---

## OLD-format marker detection regex

```
<!-- (?<marker_name>[a-z0-9-]+):start -->
... arbitrary content ...
<!-- \1:end -->
```

Where `marker_name` does NOT match `^soma-v2$` (that prefix indicates new format).

Examples of OLD-format detected:
- `<!-- codebase-memory-mcp:start -->` ... `<!-- codebase-memory-mcp:end -->`
- `<!-- hyd-v2:start -->` ... `<!-- hyd-v2:end -->`
- `<!-- soma-stsd:start -->` ... `<!-- soma-stsd:end -->`

NOT detected as OLD (already new format):
- `<!-- soma-v2:start id=block.codex.AGENTS.cbm version=1 sha256=abc... -->`

---

## Constitutional Compliance

- **Article I HARD** — Doctor enforces spec: install-targets schema validated against `soma-install-targets/v1`.
- **Article II HARD** — Migration check feature added via TDD: tests written first for OLD marker detection regex, fail, then impl.
- **Article III HARD** — Tests use real bootloader fixture files at `/tmp/phase5-validation/migration-fixtures/`. Zero mocks for fs/regex.
- **Article V** — Read-only, unlimited concurrent (does not aquece CPU).

---

## Contract Test Stub

```javascript
// @spec AC-10 AC-20
// @contract CONTRACT-011-03-doctor-migration-check
const { test } = require("node:test");
const assert = require("node:assert");

test("doctor reports migration_needed=false when no OLD markers (AC-10)", async () => {
  // Fixture: clean AGENTS.md with only soma-v2 v2 anchors
  const result = runDoctor(["--check-migration"]);
  assert.equal(result.checks.migration_check.migration_needed, false);
  assert.equal(result.checks.migration_check.old_markers_detected, 0);
  assert.equal(result.exit_code, 0);
});

test("doctor reports migration_needed=true with WARNING level when OLD markers exist (AC-10)", async () => {
  // Fixture: AGENTS.md with <!-- codebase-memory-mcp:start -->...
  const result = runDoctor(["--check-migration"]);
  assert.equal(result.checks.migration_check.migration_needed, true);
  assert.ok(result.checks.migration_check.old_markers_detected > 0);
  assert.equal(result.warnings[0].level, "WARNING");
  assert.equal(result.warnings[0].code, "MIGRATION_NEEDED");
  // Critical: exit_code stays 0 (non-fatal)
  assert.equal(result.exit_code, 0);
});

test("doctor reports install_targets_count=8 after Claude population (AC-20)", async () => {
  // Fixture: Claude install-targets.json populated with 3 entries
  const result = runDoctor([]);
  assert.equal(result.checks.install_targets_count, 8);
  assert.equal(result.checks.adapters_count, 5);
});

test("doctor warns INSTALL_TARGETS_EMPTY for cursor/aider/chatgpt-desktop", async () => {
  const result = runDoctor([]);
  const empty_warnings = result.warnings.filter(w => w.code === "INSTALL_TARGETS_EMPTY");
  assert.ok(empty_warnings.length >= 3);
});

test("OLD marker regex correctly distinguishes OLD vs new format", () => {
  // Helper test for the detection regex itself
  const old_input = "<!-- codebase-memory-mcp:start -->\ncontent\n<!-- codebase-memory-mcp:end -->";
  const new_input = "<!-- soma-v2:start id=block.codex.AGENTS.cbm version=1 sha256=abc -->";
  assert.ok(detectOldMarkers(old_input).length === 1);
  assert.ok(detectOldMarkers(new_input).length === 0);
});
```
