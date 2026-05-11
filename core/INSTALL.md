# SOMA Install

> Install guide for SOMA v2.2 onto a target project.
> This installs SOMA discipline into your project — it is separate from installing the SOMA framework itself (see `../docs/INSTALL.md`).

---

## Prerequisites

- **Node.js v22+** (verify: `node --version` must report `v22.x.x` or higher). Older versions not supported.
- **SOMA framework installed** at `~/.soma-v2/` (verify: `ls ~/.soma-v2/manifest.json`). If missing, run `bash install.sh` from the soma-v2 repo root first.
- **macOS or Linux** (Windows via WSL2 untested but compatible with Node v22+).
- A target project directory where SOMA will inject discipline (`CLAUDE.md` or `AGENTS.md` anchored block).

---

## Quickstart

Three steps to instrument a target project with SOMA:

```bash
# Step 1 — Navigate to your target project
cd /path/to/your-project

# Step 2 — Run the install command
node ~/.soma-v2/scripts/install.cjs . --tool=claude

# Step 3 — Verify install succeeded (see Verification section below)
ls .soma/install-state.json && grep -c '<!-- soma-v2:start' CLAUDE.md
```

**Flags available:**

| Flag | Effect |
|---|---|
| `--tool=claude` | Target Claude Code adapter (writes CLAUDE.md anchored block) |
| `--tool=codex` | Target Codex adapter (writes AGENTS.md anchored block) |
| `--dry-run` | Show what would be installed without modifying anything |
| `--merge-claude-md` | Append SOMA block after existing CLAUDE.md content (preserves your lines) |
| `--replace-claude-md` | Snapshot original CLAUDE.md then replace with SOMA block only |
| `--allow-local-edits` | Proceed with sync even if local edits detected in anchored region (intentional override) |

Install is idempotent — re-running on an already-installed project is a no-op (exits 0, logs "no changes").

---

## Verification

After install, confirm SOMA is properly wired:

- [ ] `<project>/.soma/install-state.json` exists with `"status": "complete"`:
  ```bash
  cat .soma/install-state.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).status)"
  # Expected: complete
  ```
- [ ] `<project>/CLAUDE.md` contains exactly one SOMA anchored block:
  ```bash
  grep -c '<!-- soma-v2:start' CLAUDE.md
  # Expected: 1
  ```
- [ ] `<project>/.soma/manifest.json` is present and valid JSON:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('.soma/manifest.json','utf8')); console.log('valid')"
  # Expected: valid
  ```
- [ ] `.soma/install.lock` has been cleaned up (transient — should not exist post-install):
  ```bash
  ls .soma/install.lock 2>/dev/null && echo "STALE LOCK — see Troubleshooting" || echo "OK"
  # Expected: OK
  ```
- [ ] Doctor exits 0 (no drift):
  ```bash
  node ~/.soma-v2/scripts/doctor.cjs
  # Expected: exit 0
  ```

---

## Troubleshooting

### Error: drift detected (exit 2, "soma rollback" in stderr)

**Symptoms:** Install aborts with exit code 2. Stderr includes a snapshot ID and recovery options.

**Cause:** The anchored block in `CLAUDE.md` has been edited locally since last install — sha mismatch detected (BF-06 protection).

**Remediation:**
```bash
# Option A — Keep your edits, mark as approved local state
node ~/.soma-v2/scripts/install.cjs . --tool=claude --allow-local-edits

# Option B — Roll back to snapshot then re-install
node ~/.soma-v2/scripts/soma.cjs rollback --snapshot-id <id-from-stderr>
node ~/.soma-v2/scripts/install.cjs . --tool=claude
```

---

### Error: CLAUDE.md has free-text without anchors (exit 2, flags named in stderr)

**Symptoms:** Install aborts naming `--merge-claude-md` and `--replace-claude-md` as options.

**Cause:** `CLAUDE.md` exists with content but no `<!-- soma-v2:start -->` anchor markers. Install refuses to silently overwrite your file.

**Remediation:**
```bash
# Option A — Append SOMA block after your existing content (non-destructive)
node ~/.soma-v2/scripts/install.cjs . --tool=claude --merge-claude-md

# Option B — Replace file entirely (snapshot saved first)
node ~/.soma-v2/scripts/install.cjs . --tool=claude --replace-claude-md
# Snapshot written to ~/.soma-v2/.snapshots/<timestamp>/ — rollback available
```

---

### Error: lockfile contention (exit 2, PID in stderr)

**Symptoms:** Install aborts mentioning an active PID and lock timestamp.

**Cause:** Another `soma install` process is running (or a stale lock was left by a crashed process).

**Remediation:**
```bash
# Check if the other process is actually running
ps aux | grep install.cjs

# If no matching process → lock is stale. Wait for auto-cleanup (60min TTL)
# or remove manually:
rm .soma/install.lock
node ~/.soma-v2/scripts/install.cjs . --tool=claude
```

Stale locks older than 60 minutes are auto-cleaned on the next install attempt.
