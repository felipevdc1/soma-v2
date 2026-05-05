# Quickstart: Article XI Capture-or-Defer Gate Hook (Sprint 010)

Manual validation steps per AC after implementation. Run through to confirm Sprint 010 candidate-done.

---

## Prerequisites

```bash
# Confirm baseline
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5  # expected 49/49 (was 48 + 1 new from this sprint)

# Capture shasum baseline
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.claude/CLAUDE.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs > /tmp/sprint010-qs-before.txt

# Ensure logs dir exists
mkdir -p ~/.claude/logs

# Snapshot existing telemetry log (avoid contaminating history)
TODAY=$(date +%Y-%m-%d)
cp ~/.claude/logs/article-xi-${TODAY}.jsonl ~/.claude/logs/article-xi-${TODAY}.bak 2>/dev/null || true
```

---

## AC-01: en defer-phrase detection

```bash
# Synthetic stdin: assistant turn with "we'll do X later"
TRANSCRIPT=/tmp/qs-transcript-en.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"We'll do the cache invalidation later."}]}}
EOF

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs 2>&1 >/dev/null
{"session_id":"qs-en","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

# Check telemetry
tail -1 ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl | jq '.phrase_locale, .status'
```

**Expected:** `exit=0` (soft-warn default), telemetry entry with `phrase_locale: "en"` and `status: "uncaptured"` (no capture target referenced).

---

## AC-02: pt-br defer-phrase detection

```bash
TRANSCRIPT=/tmp/qs-transcript-ptbr.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Vamos resolver o cache depois, fica pra próxima sessão."}]}}
EOF

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs 2>&1 >/dev/null
{"session_id":"qs-ptbr","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

tail -1 ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl | jq '.phrase_locale, .phrase_matched'
```

**Expected:** `phrase_locale: "pt-br"` + matched phrase logged.

---

## AC-03: no defer → no telemetry

```bash
TRANSCRIPT=/tmp/qs-transcript-clean.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Implemented and tested. All ACs pass."}]}}
EOF

LINES_BEFORE=$(wc -l < ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl 2>/dev/null || echo 0)

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs 2>&1
{"session_id":"qs-clean","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

LINES_AFTER=$(wc -l < ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl 2>/dev/null || echo 0)
echo "lines: $LINES_BEFORE → $LINES_AFTER"
```

**Expected:** `exit=0`, zero stderr, line count unchanged (no detection = no telemetry write).

---

## AC-04: captured target → status:captured

```bash
TRANSCRIPT=/tmp/qs-transcript-captured.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"We'll do the migration later. Captured in specs/008-soma-bootstrap/spec.md Out of Scope section."}]}}
EOF

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs
{"session_id":"qs-captured","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

tail -1 ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl | jq '.status, .capture_target'
```

**Expected:** `exit=0`, `status: "captured"`, `capture_target: "specs/008-soma-bootstrap/spec.md"`.

---

## AC-05: uncaptured + soft-warn → stderr only

```bash
TRANSCRIPT=/tmp/qs-transcript-uncaptured.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"That's out of scope for now."}]}}
EOF

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs 2> /tmp/qs-stderr.txt
{"session_id":"qs-uncaptured","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"
cat /tmp/qs-stderr.txt
```

**Expected:** `exit=0`, stderr contains "Article XI WARN" + phrase context.

---

## AC-06: uncaptured + hard-block → exit 1 + JSON decision

```bash
TRANSCRIPT=/tmp/qs-transcript-hardblock.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"We'll do the auth refactor later."}]}}
EOF

ARTICLE_XI_HARD=1 cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs > /tmp/qs-stdout.txt
{"session_id":"qs-hardblock","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"
jq '.decision, .reason' /tmp/qs-stdout.txt
```

**Expected:** `exit=1`, `.decision === "block"`, `.reason` mentions Article XI + phrase.

---

## AC-07: marker file bypass

```bash
SESSION=qs-bypass-$(date +%s)
touch /tmp/article-xi-bypass-${SESSION}

TRANSCRIPT=/tmp/qs-transcript-bypass.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"We'll do X later."}]}}
EOF

LINES_BEFORE=$(wc -l < ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl)

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs
{"session_id":"$SESSION","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

LINES_AFTER=$(wc -l < ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl)
echo "telemetry: $LINES_BEFORE → $LINES_AFTER (expect unchanged — bypass skips telemetry)"

rm /tmp/article-xi-bypass-${SESSION}
```

**Expected:** `exit=0`, telemetry unchanged.

---

## AC-08: env var disabled bypass

```bash
TRANSCRIPT=/tmp/qs-transcript-disabled.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"We'll do X later."}]}}
EOF

LINES_BEFORE=$(wc -l < ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl)

ARTICLE_XI_DISABLED=1 cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs
{"session_id":"qs-disabled","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

LINES_AFTER=$(wc -l < ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl)
echo "telemetry: $LINES_BEFORE → $LINES_AFTER"
```

**Expected:** `exit=0`, telemetry unchanged.

---

## AC-09 + AC-10: telemetry schema + JSONL parseable

```bash
TODAY=$(date +%Y-%m-%d)
LOG=~/.claude/logs/article-xi-${TODAY}.jsonl

# Each line valid JSON + matches schema
cat $LOG | while read -r line; do
  echo "$line" | jq -e '.schema, .timestamp, .session_id, .phrase_matched, .phrase_locale, .status' > /dev/null || echo "INVALID: $line"
done

# Schema field check
cat $LOG | jq -s '.[0] | keys' | jq 'sort'
```

**Expected:** every line parseable; expected keys present.

---

## AC-11: multi-turn search (capture in previous turn)

```bash
# Synthetic: previous turn captures, current turn defers without inline capture
TRANSCRIPT=/tmp/qs-transcript-multiturn.jsonl
cat > "$TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Captured this in specs/010-capture-defer-gate/spec.md Out of Scope."}]}}
{"type":"user","message":"ok"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"OK, we'll do that later."}]}}
EOF

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs
{"session_id":"qs-multiturn","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "exit=$?"

tail -1 ~/.claude/logs/article-xi-$(date +%Y-%m-%d).jsonl | jq '.status, .search_scope'
```

**Expected:** `status: "captured"`, `search_scope: "previous-turn"`.

---

## AC-12 + AC-13: mode toggle

```bash
# Default soft-warn → exit 0
TRANSCRIPT=/tmp/qs-transcript-modetest.jsonl
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"We will defer X."}]}}' > "$TRANSCRIPT"

cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs 2>&1 >/dev/null
{"session_id":"qs-soft","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "soft exit=$?"

# Hard via env → exit 1
ARTICLE_XI_HARD=1 cat <<EOF | node ~/.claude/hooks/capture-defer-gate.cjs 2>&1 >/dev/null
{"session_id":"qs-hard","transcript_path":"$TRANSCRIPT","hookSpecificInput":{"stop_reason":"end_turn"}}
EOF
echo "hard exit=$?"
```

**Expected:** soft=0, hard=1.

---

## AC-14: ≥30 tests pass

```bash
node --test ~/.claude/hooks/capture-defer-gate.test.cjs 2>&1 | tail -10
```

**Expected:** ≥30 tests, all pass.

---

## AC-15: hooks regression aggregate

```bash
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5
```

**Expected:** 49/49 hooks/*.test.cjs (was 48 + 1 new).

---

## Hook registration (manual user step — T-19)

```bash
# Inspect current Stop hooks
jq '.hooks.Stop // []' ~/.claude/settings.json

# Add capture-defer-gate.cjs to Stop hooks (the user runs manually after dispatch ACCEPTED)
# Recommended addition:
# {
#   "hooks": {
#     "Stop": [
#       ...existing...,
#       { "matcher": "*", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/capture-defer-gate.cjs" }] }
#     ]
#   }
# }
```

---

## Final shasum verification

```bash
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.claude/CLAUDE.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs > /tmp/sprint010-qs-after.txt

diff /tmp/sprint010-qs-before.txt /tmp/sprint010-qs-after.txt && echo "✓ canonical+CLAUDE.md UNTOUCHED"
```

---

## Cleanup

```bash
rm -f /tmp/qs-transcript-*.jsonl /tmp/qs-stderr.txt /tmp/qs-stdout.txt /tmp/article-xi-bypass-* /tmp/sprint010-qs-*.txt

# Optionally restore prior telemetry log if quickstart contaminated it
# mv ~/.claude/logs/article-xi-${TODAY}.bak ~/.claude/logs/article-xi-${TODAY}.jsonl
```

---

## Sign-off

Sprint 010 candidate-done when:
- [ ] All 15 ACs pass quickstart manual validation
- [ ] `node --test ~/.claude/hooks/capture-defer-gate.test.cjs` reports ≥30 tests pass
- [ ] Hooks aggregate `node --test ~/.claude/hooks/*.test.cjs` reports 49/49 pass-or-skip
- [ ] 6 canonical+CLAUDE.md shasums unchanged baseline
- [ ] Telemetry log entries match schema `article-xi-telemetry/v1`
- [ ] User E2E ACCEPTED + opt-in: hook registered in `~/.claude/settings.json` Stop array
