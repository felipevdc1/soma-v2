# Quickstart: Auto-Load Module Docs Primitive (C-1 Option A)

Manual validation steps per AC after implementation.

---

## Prerequisites

```bash
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5  # 571/571 + C-1 additions
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5  # 47/47 (subset) + C-1 additions

shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/c1-qs-before.txt
```

---

## Setup synthetic project

```bash
PROJECT=/tmp/soma-c1-qs-$(date +%s)
mkdir -p "$PROJECT"
cd "$PROJECT"
node ~/.soma-v2/scripts/init.cjs --soma-home ~/.soma-v2

# Create .soma/CONTEXT.md
cat > .soma/CONTEXT.md << 'EOF'
---
schema: soma-context/v1
project: c1-qs-test
last_updated: 2026-05-02T00:00:00Z
---

# Module Context Routing

| Keyword       | Module Slug   |
|---------------|---------------|
| auth          | auth-system   |
| billing       | billing       |
| webhook       | webhooks      |
EOF

# Create 3 modules
node ~/.soma-v2/scripts/module.cjs add "auth-system"
node ~/.soma-v2/scripts/module.cjs add "billing"
node ~/.soma-v2/scripts/module.cjs add "webhooks"

# Promote auth-system to active + set layer:trunk
node ~/.soma-v2/scripts/module.cjs promote "auth-system"
# (manually edit .soma/modules/auth-system.md to add `layer: trunk` to front-matter)
```

---

## AC-01 + AC-02 + AC-12: hook reads task + parses CONTEXT.md

Simulate subagent-init.cjs invocation with task description (mode/protocol per Sonnet's research findings):

```bash
# Run subagent-init.cjs with task = "fix the authentication flow in auth-system module"
TASK="fix the authentication flow in auth-system module" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test 2>&1 | head -30
```

**Expected:** stdout/log shows `auth-system` matched (via "auth" keyword), front-matter parsed (status: active, layer: trunk).

---

## AC-03: keyword matching (substring case-insensitive — D1)

```bash
# "Authenticate" matches "auth" keyword
TASK="Authenticate the user via OAuth" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test 2>&1 | grep "matched_keywords"
```

**Expected:** `matched_keywords: ["auth"]` (case-insensitive substring catches "Authenticate" → "auth").

---

## AC-04 + AC-05: max 2 modules + token budget exceed

```bash
# Task with 3 keyword matches
TASK="auth + billing + webhook fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq '.loaded_modules | length'
```

**Expected:** `2` (max cap enforced; 1 module dropped via tie-break or token budget).

---

## AC-06: status filter

```bash
# Set billing to status: hypothesis (manually edit front-matter)
# Re-run with task matching billing keyword
TASK="billing reconciliation" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq '.loaded_modules'
```

**Expected:** billing NOT loaded (status filter); empty if no other matches.

---

## AC-07: layer priority tie-break (D4)

Setup: 2 modules with same keyword score, different layers.

```bash
# auth-system (layer:trunk) + auth-helper (layer:leaves) both match "auth"
TASK="auth fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq '.loaded_modules[0].slug'
```

**Expected:** `"auth-system"` (trunk > leaves; auth-system wins).

---

## AC-08: injection format (D5)

```bash
TASK="auth fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq -r '.injection_text'
```

**Expected output (delimited markdown blocks):**
```
--- soma-auto-loaded-module: auth-system (layer: trunk) ---
# Auth System
[module body content]
--- end module ---
```

---

## AC-09: no CONTEXT.md → silent skip

```bash
LEGACY=/tmp/soma-c1-legacy-$(date +%s)
mkdir -p "$LEGACY"
node ~/.soma-v2/scripts/init.cjs --soma-home ~/.soma-v2 --project "$LEGACY"
# Do NOT create .soma/CONTEXT.md

TASK="auth fix" \
SOMA_PROJECT="$LEGACY" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test 2>&1 | grep -i "skipped\|no.*context"
```

**Expected:** stderr line "no .soma/CONTEXT.md found; auto-load skipped". stdout empty injection. exit 0.

---

## AC-10: zero matches → silent skip

```bash
TASK="something completely unrelated to known keywords" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq '.loaded_modules'
```

**Expected:** `[]` (empty array; no auto-load).

---

## AC-11: all candidates filtered → warning loud

```bash
# Manually set ALL modules to status: hypothesis
# Re-run with keyword match
TASK="auth fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test 2>&1 | grep -i "warning"
```

**Expected:** stderr WARNING line about all candidates filtered out by status.

---

## AC-13 + AC-14: doctor --check-context-routing

```bash
# Add a broken keyword routing (slug pointing to nonexistent module)
sed -i '' 's/| auth          | auth-system   |/| auth          | auth-system   |\n| nonexistent   | does-not-exist|/' "$PROJECT/.soma/CONTEXT.md"

node ~/.soma-v2/scripts/doctor.cjs --check-context-routing --project "$PROJECT" --json | jq '.findings'
```

**Expected:** finding `{severity: "warning", code: "BROKEN_CONTEXT_ROUTING", keyword: "nonexistent", slug: "does-not-exist", reason: "module file not found"}`. Doctor exit 0 (D7 non-blocking).

---

## AC-17: SOMA_AUTO_LOAD_TOKEN_CAP env var

```bash
# Default 5KB
TASK="auth fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq '.token_cap_used'

# Override to 8KB
SOMA_AUTO_LOAD_TOKEN_CAP=8192 \
TASK="auth fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test --json | jq '.token_cap_used'
```

**Expected:** first 5120, second 8192.

---

## AC-18: defensive degrade

```bash
# Corrupt CONTEXT.md (invalid YAML)
echo "invalid: yaml: this is broken" > "$PROJECT/.soma/CONTEXT.md"

TASK="auth fix" \
SOMA_PROJECT="$PROJECT" \
node ~/.claude/hooks/subagent-init.cjs --auto-load-test 2>&1; echo "exit=$?"
```

**Expected:** exit 0 (NOT blocked). stderr error log about parse failure. Empty injection. Hook continues.

---

## Cleanup

```bash
rm -rf "$PROJECT" "$LEGACY"
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/c1-qs-after.txt
diff /tmp/c1-qs-before.txt /tmp/c1-qs-after.txt
```

**Expected:** empty diff (canonical+libs untouched).

---

## C-1 candidate-done checklist

- [ ] All 18 ACs validated above
- [ ] D1-D8 resolutions verified
- [ ] 571 + C-1 cumulative SOMA tests pass
- [ ] 47/47 hooks (subset) + 48/48 hooks aggregate preserved
- [ ] 6 canonical+lib shasums diff empty
- [ ] Sonnet RED+GREEN commits visible in `/tmp/c-1-work/` git log
- [ ] D8 research findings documented in `/tmp/research-notes.md` (subagent-init.cjs injection pattern empirically validated)
