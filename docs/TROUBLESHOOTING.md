# SOMA v2.1 — Troubleshooting

**Format:** Each entry follows Symptom → Cause → Fix. Headers are scannable.
**Log locations:** See §Log file paths at the bottom of this document.

---

## Install issues

### Symptom: `.bak` files appeared in `~/.claude/hooks/`

**Cause:** You had custom hooks in `~/.claude/hooks/` that SOMA also ships (hook name collision). `install/detect-collisions.cjs` detected the conflict and prompted you during Phase 1.5.

**Fix:** The original files are preserved as `{filename}.pre-soma-{timestamp}.bak`. Review them:

```bash
ls ~/.claude/hooks/*.bak
```

If your custom hook had unique logic you want to keep, manually merge it into the corresponding SOMA hook. Then remove the `.bak` file. SOMA hooks are designed to be extended — the `hooks.json` hook entries can reference multiple commands per event.

To suppress the collision prompt on future re-installs (auto-rename without asking):

```bash
FORCE_OVERWRITE=1 bash install.sh
```

---

### Symptom: Warning "MCP server X not found" during install

**Cause:** One or more optional MCP servers (mempalace, vault, codebase-memory-mcp) are not registered in your Claude Code MCP configuration. `install/check-mcp-deps.cjs` emits a warning at Phase 0.5.

**Fix:** Install is not blocked. SOMA works without MCP servers — the dependent hooks fall back to warn-and-continue mode:

- Without `mempalace`: `session-init.cjs` and `session-end.cjs` skip diary and KG operations; memory is session-scoped only
- Without `vault`: `/soma:specify` Reuse Gate check is skipped
- Without `codebase-memory-mcp`: code graph features in SONAR audit are unavailable

To install MCP servers, follow each server's documentation and re-run `bash install.sh` to register them in `settings.json`.

---

### Symptom: `settings.json` shows duplicate SOMA entries after re-install

**Cause:** The idempotency token (`_soma_managed: true`) was not present in the existing entries — this can happen if a previous version of SOMA was installed before v2.1.

**Fix:** Run the uninstaller to strip SOMA-managed entries, then reinstall:

```bash
bash uninstall.sh
bash install.sh
```

The uninstaller only removes entries tagged `_soma_managed: true`. If entries exist without the tag (from a pre-v2.1 install), remove them manually from `~/.claude/settings.json` before reinstalling.

---

### Symptom: `JSON.parse` error or `plugin.json` invalid during install or smoke pack

**Cause:** The `.claude-plugin/plugin.json` file is malformed. This can happen if the clone was incomplete (network interruption) or if the file was accidentally modified.

**Fix:**

```bash
# Verify the file
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('valid')"

# If invalid, re-clone the repo
cd ..
rm -rf soma-v2
git clone https://github.com/felipevdc1/soma-v2.git
cd soma-v2
bash install.sh
```

Smoke pack gate 10 (`plugin manifest valid`) confirms this check passes.

---

## Runtime issues

### Symptom: Task stuck after the initial attempt plus one correction

**Cause:** The initial attempt plus one correction exhausted the task budget, so SOMA entered `PAUSED_DIAGNOSTIC`. This is expected behavior, not an error in the system.

**Fix:** Inspect the durable project evidence first: `.soma/diagnostics`, `.soma/checkpoints/<runId>/`, and `.soma/handoffs/<runId>/`. Then create a marker to direct the recovery:

```bash
# Option A — Resume with a hint (add context about what went wrong)
touch /tmp/soma-diagnostic-{runId}-continue

# Option B — Roll back all commits from this run and start fresh
touch /tmp/soma-diagnostic-{runId}-rollback

# Option C — Return to Step 1 and amend the spec
touch /tmp/soma-diagnostic-{runId}-replan
```

If the failure is a code logic issue, re-read the spec and amend `[NEEDS CLARIFICATION]` markers before using `-replan`. If it is an environment issue (missing dependency, wrong path), fix the environment first then use `-continue`.

---

### Symptom: `thermal-guard.cjs` blocked a dispatch with "max compile/test agents reached"

**Cause:** There are already 3 compile/test agents running simultaneously (Article V). Dispatch of a 4th is blocked with exit 2. This is intentional — parallel compilation causes CPU thermal throttling.

**Fix:** Wait for one of the running agents to complete before dispatching the next. Check in-flight agents:

```bash
cat .soma/run-state-<runId>.json | jq '.in_flight_agents'
```

If you are on a machine where the thermal limit does not apply (e.g., a CI server or remote compute), create a bypass marker (requires explicit authorization):

```bash
touch /tmp/claude-thermal-bypass-{sessionId}.marker
```

The bypass is logged in `/tmp/soma-log-{runId}.jsonl` for audit purposes.

---

### Symptom: `hyd-gate.cjs` fired a warning about action verbs

**Cause:** The hook detected action verbs (implement, build, create, migrate, refactor, etc.) in your prompt without a prior HYD v2 loop for the task. This is a soft warning — your prompt is not blocked.

**Fix:** Run the HYD loop first:

```
/soma:hyd "your task description here"
```

HYD v2 classifies the task, selects quality dimensions, states an initial thesis, and pressure-tests it for counterexamples. Total overhead: roughly 2–3 minutes for non-trivial tasks. For tiny tasks, a one-sentence reframe is sufficient.

---

### Symptom: `cognitive-gate.cjs` blocked a direct file edit

**Cause:** You are in Orchestrator Mode and attempted to write implementation code directly (Edit or Write tool on a source file). The cognitive gate enforces the orchestrator principle: plan + dispatch, never implement directly.

**Fix:** Dispatch a Sonnet executor instead:

```
/soma:dispatch "implement the change described in spec.md AC-03"
```

If you intentionally need to make a small direct edit (e.g., fixing a typo in a config file), create a per-turn unlock:

```bash
touch /tmp/claude-cognitive-unlock-{sessionId}.marker
```

The unlock applies only to the current turn. It does not disable the gate permanently.

---

## Audit and verification issues

### Symptom: `soma audit` exits with code 127 ("command not found")

**Cause:** The Anthropic Claude CLI is not installed or not on your PATH. `soma audit` requires the Claude CLI to run LLM-assisted analysis (D-P6-11 soft requirement).

**Fix:** Install the Claude CLI from https://claude.ai/claude-code and ensure it is on your PATH:

```bash
claude --version
# should print a version string
```

After installing, restart your terminal and run `soma audit` again. If you prefer to continue without the Claude CLI, SOMA functions normally — `soma doctor` will report "audit unavailable" and other commands are unaffected.

---

### Symptom: Smoke pack gate N failing

Common-failure subset of the 12 smoke pack gates (see [`docs/INSTALL.md`](./INSTALL.md) §Verification for the full 12-gate list — the gates not shown here rarely fail in practice):

| Gate | Failing means | Diagnosis command |
|---|---|---|
| Gate 1 (version) | `VERSION` file and `plugin.json` are out of sync | `cat VERSION; cat .claude-plugin/plugin.json \| jq .version` |
| Gate 2 (doctor) | `soma doctor` found a red finding | `node ~/.soma-v2/scripts/soma.cjs doctor` |
| Gate 7 (bootloader) | SOMA anchored block not in CLAUDE.md | `grep "SOMA Bootloader" ~/.claude/CLAUDE.md` |
| Gate 9 (output-style) | File not copied to `~/.claude/output-styles/` | `ls ~/.claude/output-styles/soma-voxel.md` |
| Gate 11 (constitution) | Constitution not ratified | `grep "v1.0.0" core/docs/constitution.md` |
| Gate 12 (no-leak) | Hardcoded machine paths found | `node install/verify-portability.cjs 2>&1 \| grep gate12` |

---

### Symptom: Frozen libs shasum drift detected

**Cause:** One of the three frozen libraries (`anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) has been modified. This is a blocking error — do not proceed.

**Expected checksums:**
```
6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f  core/scripts/lib/anchored-blocks.cjs
08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462  core/scripts/lib/manifest.cjs
f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b  core/scripts/lib/template-engine.cjs
```

**Fix:**

```bash
shasum -a 256 core/scripts/lib/anchored-blocks.cjs core/scripts/lib/manifest.cjs core/scripts/lib/template-engine.cjs
# Compare to expected above
```

If a file differs: check `git log --oneline core/scripts/lib/` to identify what changed. If the change was unintentional, restore from git:

```bash
git checkout HEAD -- core/scripts/lib/anchored-blocks.cjs
# or whichever file drifted
```

If the change is intentional (a legitimate fix), it requires a formal amendment process: open a spec for the change, get Gate 1 approval, and update the expected checksums in your smoke pack configuration and any downstream references.

---

## Update and maintenance issues

### Symptom: `soma sync --check` reports drift

**Cause:** SOMA's local install in `~/.soma-v2/` is out of sync with the repo's canonical content. This is expected after pulling a new version of the repo.

**Fix:** Pull the latest repo and re-run the installer:

```bash
cd soma-v2
git pull
bash install.sh
```

The installer is idempotent — it safely updates existing installations.

For upgrade notes between SOMA versions, check the [GitHub releases page](https://github.com/felipevdc1/soma-v2/releases).

---

### Symptom: Upgrading from an older version of SOMA

**Cause:** Schema or anchor ID conventions may differ between SOMA minor/major versions.

**Fix:** The `install/migration.cjs` script handles version transitions. Run it before the main installer when upgrading:

```bash
node install/migration.cjs
bash install.sh
```

`migration.cjs` detects the current installed version (via `~/.soma-v2/manifest.json`), runs the appropriate migration path, and exits with a report before the main install proceeds.

---

## Where to file bugs

GitHub Issues: https://github.com/felipevdc1/soma-v2/issues

When filing a bug, include:
- Output of `node install/verify-portability.cjs` (all 12 gates)
- Output of `node ~/.soma-v2/scripts/soma.cjs doctor`
- Your platform (`uname -s`, Node version, Claude Code version)
- Steps to reproduce

---

## Log file paths

| File | Contents |
|---|---|
| `~/.claude/logs/insight-coupling-{YYYY-MM-DD}.jsonl` | Insight-action coupling telemetry (schema `insight-coupling/v1`) |
| `~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl` | Capture Before Defer telemetry |
| `{project}/.soma/run-state-{runId}.json` | Durable active run state; diagnostics, checkpoints and handoffs remain under the same project `.soma/` tree |
| `/tmp/soma-log-{runId}.jsonl` | Per-run event log including thermal bypass usage (ephemeral) |
| `~/.soma-v2/.snapshots/{ISO-timestamp}/` | Rollback artifacts created by `rollback.cjs` (per write-mode operation) |
| `~/.soma-v2-backups/{timestamp}/` | Full pre-install backups created by `install.sh` Phase 1 |
| `core/evidence/` | Per-run evidence (gitignored in repo; present on disk after install in `~/.soma-v2/evidence/`) |
