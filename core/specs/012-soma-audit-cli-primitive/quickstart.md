# Quickstart: Soma Audit CLI Primitive

Manual validation steps post-implementation. Run after Sonnet dispatch completes.

---

## Prerequisites

- `~/.soma-v2/scripts/audit.cjs` exists + executable via `node`
- `~/.soma-v2/templates/audit-prompt.md` exists
- `claude` CLI in PATH (the user's Claude Code install) — optional, fallback tested separately

---

## Smoke 1 — Hybrid path (deterministic + claude CLI)

Goal: verify full audit on real SOMA module returns valid JSON with both layers populated.

```bash
cd ~/.soma-v2
SOMA_SAFE_PATHS_ONLY=1 node scripts/audit.cjs --module scripts/sync.cjs > /tmp/audit-smoke-1.json
echo "exit=$?"
jq -e '.schema == "soma-audit/v1"' /tmp/audit-smoke-1.json
jq -e '.module.path | contains("sync.cjs")' /tmp/audit-smoke-1.json
jq -e '.module.loc > 100' /tmp/audit-smoke-1.json
jq -e '.module.exports | length > 0' /tmp/audit-smoke-1.json
jq -e '.capabilities | length > 0' /tmp/audit-smoke-1.json
jq -e '.recommended_spec_scope | length > 0' /tmp/audit-smoke-1.json
jq -e '.warnings | length == 0' /tmp/audit-smoke-1.json
jq -e '.claude_cli_used == true' /tmp/audit-smoke-1.json
```

**Expected**: exit 0, all jq assertions pass, marker file `/tmp/soma-discovery-done-{sessionId}` exists, telemetry line appended em `~/.claude/logs/article-xii-2026-05-03.jsonl`.

**Validates ACs**: AC-01, AC-03, AC-05, AC-06, AC-09, AC-11, AC-13.

---

## Smoke 2 — Graceful degradation (claude absent)

Goal: verify audit completes successfully when `claude` CLI absent, returning deterministic-only output.

```bash
PATH=/usr/bin:/bin node scripts/audit.cjs --module scripts/sync.cjs > /tmp/audit-smoke-2.json
echo "exit=$?"
jq -e '.warnings | map(.code) | contains(["CLAUDE_CLI_NOT_FOUND"])' /tmp/audit-smoke-2.json
jq -e '.capabilities == null' /tmp/audit-smoke-2.json
jq -e '.module.loc > 100' /tmp/audit-smoke-2.json   # deterministic preserved
jq -e '.claude_cli_used == false' /tmp/audit-smoke-2.json
```

**Expected**: exit 0, deterministic fields populated, sense-making fields null, warning present.

**Validates ACs**: AC-07, AC-11.

---

## Smoke 3 — Sandbox violation

Goal: verify SOMA_SAFE_PATHS_ONLY enforcement blocks paths outside ~/.soma-v2/scripts/.

```bash
SOMA_SAFE_PATHS_ONLY=1 node scripts/audit.cjs --module /etc/hosts 2>/tmp/audit-smoke-3.err
echo "exit=$?"   # expect 1
cat /tmp/audit-smoke-3.err
jq -e '.code == "SANDBOX_VIOLATION"' /tmp/audit-smoke-3.err
jq -e '.hint | length > 0' /tmp/audit-smoke-3.err
```

**Expected**: exit 1, stderr contains structured JSON error.

**Validates ACs**: AC-02, AC-12, AC-14.

---

## Smoke 4 — Module not found

```bash
node scripts/audit.cjs --module scripts/nonexistent.cjs 2>/tmp/audit-smoke-4.err
echo "exit=$?"   # expect 1
jq -e '.code == "MODULE_NOT_FOUND"' /tmp/audit-smoke-4.err
```

**Validates ACs**: AC-04, AC-12.

---

## Smoke 5 — Session ID fallback

Goal: verify 6-deep hierarchy works when env vars unset.

```bash
env -i HOME=$HOME PATH=$PATH node scripts/audit.cjs --module scripts/sync.cjs > /tmp/audit-smoke-5.json 2>/tmp/audit-smoke-5.err
jq -e '.session_id_source' /tmp/audit-smoke-5.json   # expect "marker-file" or "hostname-pid"
ls /tmp/soma-discovery-done-* 2>/dev/null | head -1   # marker created
```

**Validates ACs**: AC-09, AC-10.

---

## Smoke 6 — Article XII β hook integration (end-to-end)

Goal: confirm marker file unblocks `discover-before-specify.cjs` hook.

```bash
# Pre: marker absent
rm -f /tmp/soma-discovery-done-*

# Try /specify with trigger word — should HARD BLOCK or SOFT WARN
ARTICLE_XII_HARD=1 echo "test specify trigger 'extends sync.cjs'" | \
  node ~/.claude/hooks/discover-before-specify.cjs 2>&1 | grep -i "discover" && echo "BLOCKED OK"

# Run audit to create marker
node scripts/audit.cjs --module scripts/sync.cjs >/dev/null

# Now /specify hook should pass
ARTICLE_XII_HARD=1 echo "test specify trigger 'extends sync.cjs'" | \
  node ~/.claude/hooks/discover-before-specify.cjs 2>&1
echo "exit=$?"   # expect 0 (no block, marker present)
```

**Validates ACs**: AC-09 + Constitution Article XII (c) operational chain.

---

## Cleanup

```bash
rm -f /tmp/soma-discovery-done-* /tmp/audit-smoke-*.json /tmp/audit-smoke-*.err /tmp/c-12-shasum-*.txt
```

---

## Regression check (mandatory pré-merge)

```bash
cd ~/.soma-v2 && node --test scripts/__tests__/*.test.cjs 2>&1 | tail -10
# Expected: 671→~696 pass (+~25 new), 0 fail (or +stale RED only — investigate before merge)

shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/c-12-shasum-after.txt
diff /tmp/c-12-shasum-before.txt /tmp/c-12-shasum-after.txt
# Expected: no differences (canonical+lib files unchanged)
```

---

## Failure recovery

If smoke fails:
1. Check stderr for structured error (`{code, message, hint}`)
2. Check telemetry log: `tail ~/.claude/logs/article-xii-$(date +%Y-%m-%d).jsonl`
3. Check marker file: `ls -la /tmp/soma-discovery-done-*`
4. Re-run with `DEBUG=1` env if implementation supports verbose mode
