# SOMA Bootstrap — Onboarding Guide

**Audience:** External devs + SOMA agents setting up a SOMA-enabled project.
**Version:** v1 (Sprint 008, 2026-05-02)

---

## Prerequisites

- **Node.js** v22+ — `node --version` must report `v22.x.x` or higher
- **git** — any recent version (git 2.x+)
- **SOMA_HOME** — the SOMA framework installed at `~/.soma-v2/` (or custom path via `SOMA_HOME` env var)

### Install SOMA_HOME

SOMA_HOME is the framework installation directory. Bootstrap assumes it already exists.

To verify your installation:

```bash
ls ~/.soma-v2/manifest.json   # must exist
node -e "require('fs').readFileSync(require('os').homedir() + '/.soma-v2/manifest.json')" && echo "OK"
```

If missing, install SOMA_HOME using the automated install command — see [`../INSTALL.md`](../INSTALL.md) for step-by-step instructions and verification checklist.

To use a custom installation path:

```bash
export SOMA_HOME=/path/to/soma-installation
soma bootstrap
```

---

## Quickstart

Clone a SOMA-enabled project and bootstrap it in one flow:

```bash
# Step 1 — Clone the project
git clone https://github.com/your-org/your-soma-project.git
cd your-soma-project

# Step 2 — Verify .soma/ exists (SOMA-enabled repos ship this directory)
ls .soma/modules/

# Step 3 — Bootstrap (validates SOMA_HOME + detects modules + checks drift)
node ~/.soma-v2/scripts/bootstrap.cjs

# Expected output:
# SOMA Bootstrap
#
#   Project ready — 4 module(s) detected, 0 findings (312ms)
#
# {
#   "schema": "soma-bootstrap/v1",
#   "status": "ready",
#   ...
# }
```

If you need machine-parseable JSON only (orchestrator mode):

```bash
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.status, .modules | length'
```

---

## Common Workflows

### Revalidate after branch switch

```bash
git checkout feature/auth-refactor
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.status'
```

Exit 0 = project usable. Exit 1 = blocking error (see `error_code`).

### Agent/Codex integration

```bash
# Bootstrap emits structured JSON for orchestrator parsing
node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bs.json
# Parse modules detected
jq '.modules[] | select(.status == "active") | .slug' /tmp/bs.json
```

### Custom SOMA_HOME

```bash
node ~/.soma-v2/scripts/bootstrap.cjs --soma-home=/custom/soma-home --quiet
```

---

## Troubleshooting

### SOMA_HOME missing or invalid (`INVALID_SOMA_HOME`)

**Symptom:**

```json
{
  "error_code": "INVALID_SOMA_HOME",
  "message": "SOMA_HOME at /Users/x/.soma-v2 does not exist.",
  "suggestion": "See ~/.soma-v2/docs/onboarding.md or set SOMA_HOME env var..."
}
```

**Cause:** `~/.soma-v2/` not installed, or `manifest.json` absent/corrupt.

**Fix:**

```bash
# Verify what path bootstrap tried
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.soma_home_attempted'

# Override with correct path
export SOMA_HOME=/correct/path && node ~/.soma-v2/scripts/bootstrap.cjs --quiet

# Verify manifest exists at new path
ls "$SOMA_HOME/manifest.json"
cat "$SOMA_HOME/manifest.json" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); JSON.parse(d); console.log('valid JSON')"
```

---

### No SOMA project in current dir (`NO_SOMA_PROJECT`)

**Symptom:**

```json
{
  "error_code": "NO_SOMA_PROJECT",
  "message": "No .soma/ directory found in current working directory: /Users/x/myproject",
  "suggestion": "Run 'soma init --existing' in a SOMA-enabled repo..."
}
```

**Cause:** You ran `bootstrap` in a directory that is not a SOMA-enabled project (`.soma/` missing).

**Fix:**

```bash
# Option A — Initialize an existing project as SOMA-enabled
cd /path/to/your-project
node ~/.soma-v2/scripts/init.cjs --existing --soma-home ~/.soma-v2
node ~/.soma-v2/scripts/bootstrap.cjs --quiet

# Option B — Navigate to an already SOMA-enabled repo
cd /path/to/soma-enabled-project   # one that has .soma/ checked in
node ~/.soma-v2/scripts/bootstrap.cjs --quiet
```

---

### Drift warnings in output (`status: "drift"`)

**Symptom:**

```json
{
  "status": "drift",
  "findings": [{"severity": "warning", "code": "BROKEN_CONTEXT_ROUTING", ...}],
  "suggestion": "Run 'soma sync --apply' to remediate drift findings."
}
```

**Cause:** `.soma/CONTEXT.md` references a module slug that no longer exists, or a module's status changed from `active` to `hypothesis`/`deprecated`.

**Note:** Drift warnings are **non-blocking** (exit 0). The project is still usable; drift is advisory only.

**Fix:**

```bash
# Option A — Auto-remediate via sync
node ~/.soma-v2/scripts/sync.cjs --apply

# Option B — Manual: check which module refs are broken
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.findings'

# Option C — Update CONTEXT.md manually
# Remove stale keyword→slug entries from .soma/CONTEXT.md
```

---

### Schema version unsupported (`SCHEMA_VERSION_UNSUPPORTED`)

**Symptom:**

```json
{
  "error_code": "SCHEMA_VERSION_UNSUPPORTED",
  "message": "manifest.json schema \"soma-manifest/v2\" is not supported. Expected \"soma-manifest/v1\"."
}
```

**Cause:** SOMA_HOME was upgraded to v2+ schema but bootstrap v1 only supports `soma-manifest/v1` (D8 lock).

**Fix:**

```bash
# Check your SOMA_HOME version
cat ~/.soma-v2/manifest.json | jq '.schema, .version'

# Downgrade to v1-compatible SOMA_HOME, or upgrade bootstrap.cjs to v2 (see team docs)
# Interim: use --soma-home to point to a v1-compatible installation
node ~/.soma-v2/scripts/bootstrap.cjs --soma-home=/path/to/v1-soma-home --quiet
```

---

### Modules directory empty (`MODULES_MISSING`)

**Symptom:** `status: "ready"` but `modules: []` — no modules reported.

**Cause:** `.soma/modules/` directory exists but contains no `.md` files. This happens if `soma init --existing` was not run.

**Fix:**

```bash
# Run init --existing to populate .soma/modules/ via H1+H2 inference
node ~/.soma-v2/scripts/init.cjs --existing --soma-home ~/.soma-v2

# Verify modules were detected
ls .soma/modules/

# Re-run bootstrap
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.modules | length'
```

---

## Output Reference

### Success (`status: "ready"` or `status: "drift"`) — exit 0

```json
{
  "schema": "soma-bootstrap/v1",
  "status": "ready",
  "soma_home": "/Users/x/.soma-v2",
  "project_root": "/Users/x/my-project",
  "modules": [
    {"slug": "auth-system", "status": "active"},
    {"slug": "billing", "status": "hypothesis"}
  ],
  "adapters": [
    {"tool": "codex", "install_targets_count": 5},
    {"tool": "claude", "install_targets_count": 0}
  ],
  "findings": [],
  "duration_ms": 312,
  "suggestion": null
}
```

### Error — exit 1

```json
{
  "schema": "soma-bootstrap/v1",
  "status": "error",
  "error_code": "NO_SOMA_PROJECT",
  "message": "No .soma/ directory found...",
  "suggestion": "Run 'soma init --existing'...",
  "duration_ms": 8
}
```

### Error codes

| Code | Exit | When |
|---|---|---|
| `NO_SOMA_PROJECT` | 1 | cwd lacks `.soma/` |
| `INVALID_SOMA_HOME` | 1 | SOMA_HOME missing or manifest.json invalid |
| `SCHEMA_VERSION_UNSUPPORTED` | 1 | manifest.json schema != `soma-manifest/v1` |
| `MODULES_MISSING` | 1 | `.soma/modules/` empty |
| `CRITICAL_DRIFT` | 1 | doctor returns critical findings |
| `INVALID_ARGS` | 2 | unknown flag or arg error |

---

## Flags

| Flag | Description |
|---|---|
| `--quiet` | Emit only JSON on stdout (orchestrator-friendly mode) |
| `--soma-home=PATH` | Override SOMA_HOME path (also respects `SOMA_HOME` env var) |
