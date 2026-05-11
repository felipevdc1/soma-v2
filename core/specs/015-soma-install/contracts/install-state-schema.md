# Contract: File Schema — install-state.json

**Contract ID:** CONTRACT-02
**spec_ref:** [SPEC:AC-16] [SPEC:AC-05]
**Created:** 2026-05-09
**Type:** internal file format (cross-harness state file)

---

## File Path

```
<project-path>/.soma/install-state.json
```

NOT in `/tmp/` (lost on reboot). NOT harness-local memory. Single source of truth readable by Claude Code, Codex, future harnesses.

---

## Schema

```json
{
  "$schema": "soma-install-state/v1",
  "type": "object",
  "required": ["status", "timestamp", "snapshotId", "harness", "installedVersion"],
  "additionalProperties": false,
  "properties": {
    "status": {
      "type": "string",
      "enum": ["complete", "partial-failed", "drift-detected"],
      "description": "Result of last install attempt"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO-8601 of last install completion or failure"
    },
    "snapshotId": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$",
      "description": "ISO timestamp matching ~/.soma-v2/.snapshots/<id>/ for rollback"
    },
    "harness": {
      "type": "string",
      "enum": ["claude", "codex", "both"],
      "description": "Which harness was --tool target on this install"
    },
    "installedVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+",
      "description": "SOMA version installed (e.g., 2.2.0)"
    },
    "lastError": {
      "type": "string",
      "description": "Present only if status != complete; brief error description"
    },
    "blockIds": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Anchored block IDs injected (e.g., 'block.claude.bootloader.cbm', 'block.codex.AGENTS.soma-stsd')"
    }
  }
}
```

---

## Examples

**status=complete (greenfield success):**
```json
{
  "$schema": "soma-install-state/v1",
  "status": "complete",
  "timestamp": "2026-05-09T14:50:00Z",
  "snapshotId": "2026-05-09T14:49:55Z",
  "harness": "claude",
  "installedVersion": "2.2.0",
  "blockIds": ["block.claude.bootloader.cbm", "block.claude.bootloader.hyd-v2", "block.claude.bootloader.soma-stsd"]
}
```

**status=partial-failed (mid-pipeline failure):**
```json
{
  "$schema": "soma-install-state/v1",
  "status": "partial-failed",
  "timestamp": "2026-05-09T14:50:00Z",
  "snapshotId": "2026-05-09T14:49:55Z",
  "harness": "claude",
  "installedVersion": "2.2.0",
  "lastError": "manifest baseline failed: EACCES on .soma/manifest.json (fs perms)"
}
```

**status=drift-detected (BF-06 abort):**
```json
{
  "$schema": "soma-install-state/v1",
  "status": "drift-detected",
  "timestamp": "2026-05-09T14:50:00Z",
  "snapshotId": "2026-05-09T14:49:55Z",
  "harness": "claude",
  "installedVersion": "2.1.4",
  "lastError": "BF-06: anchored block block.claude.bootloader.cbm sha256 mismatch (expected 7cd6..., actual a233...). Recovery: soma rollback --snapshot-id 2026-05-09T14:49:55Z OR --allow-local-edits"
}
```

---

## Invariants

- File MUST be valid JSON parseable
- Status `complete` MUST have non-empty `blockIds` array
- Status `partial-failed` AND `drift-detected` MUST have non-empty `lastError`
- File written atomically (write-to-temp + rename) to avoid mid-write corruption
- File mode: 0644 (user read+write, group/other read)
