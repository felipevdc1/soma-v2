# Quickstart: Adapter Skeletons (Sprint 009)

Manual validation steps per AC after implementation. Run through to confirm Sprint 009 candidate-done.

---

## Prerequisites

```bash
# Confirm baseline
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5  # expected ≥665 (655 baseline + ≥10 new)

# Capture shasum baseline
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/sprint009-qs-before.txt
```

---

## AC-01 + AC-06: 3 adapter folders exist with kebab-case names

```bash
ls -d ~/.soma-v2/adapters/cursor/ ~/.soma-v2/adapters/aider/ ~/.soma-v2/adapters/chatgpt-desktop/
echo "exit=$?"
```

**Expected:** all 3 dirs exist; exit 0.

```bash
# Naming convention: kebab-case lowercase
ls ~/.soma-v2/adapters/ | grep -E '^[a-z]+(-[a-z0-9]+)*$' | wc -l
# expected: 5 (codex, claude, _global, cursor, aider, chatgpt-desktop) — but _global has underscore. Let me check pattern:
ls ~/.soma-v2/adapters/ 
# Should see: _global  aider  chatgpt-desktop  claude  codex  cursor
```

**Expected:** `_global` plus 5 tool-named adapters with kebab-case (cursor, aider, chatgpt-desktop, codex, claude).

---

## AC-02: Each new adapter has install-targets.json + bootloader.md

```bash
for adapter in cursor aider chatgpt-desktop; do
  test -f ~/.soma-v2/adapters/$adapter/install-targets.json && echo "$adapter install-targets.json ✓" || echo "$adapter install-targets.json MISSING"
  test -f ~/.soma-v2/adapters/$adapter/bootloader.md && echo "$adapter bootloader.md ✓" || echo "$adapter bootloader.md MISSING"
done
```

**Expected:** 6 ✓ lines (2 per adapter).

---

## AC-03 + AC-04: install-targets.json schema conformance

```bash
for adapter in cursor aider chatgpt-desktop; do
  echo "--- $adapter ---"
  jq '.schema, .tool, (.entries | type)' ~/.soma-v2/adapters/$adapter/install-targets.json
done
```

**Expected per adapter:**
```
"soma-install-targets/v1"
"<adapter-name>"
"array"
```

```bash
# Verify entries[] is empty MVP (D1 lock)
for adapter in cursor aider chatgpt-desktop; do
  jq '.entries | length' ~/.soma-v2/adapters/$adapter/install-targets.json
done
```

**Expected:** `0` per adapter (empty array).

---

## AC-05: bootloader.md structure conformance

```bash
for adapter in cursor aider chatgpt-desktop; do
  echo "--- $adapter ---"
  head -1 ~/.soma-v2/adapters/$adapter/bootloader.md   # H1 title check
  grep -c "^## Responsibilities" ~/.soma-v2/adapters/$adapter/bootloader.md   # expect 1
  grep -c "^## Non-responsibilities" ~/.soma-v2/adapters/$adapter/bootloader.md   # expect 1
  
  # Numbered list items count under Responsibilities (≥3)
  awk '/^## Responsibilities/,/^## /' ~/.soma-v2/adapters/$adapter/bootloader.md | grep -cE '^[0-9]+\.'
  # Bulleted list items count under Non-responsibilities (≥2)
  awk '/^## Non-responsibilities/,/^---|^## (?!Non)|^# /' ~/.soma-v2/adapters/$adapter/bootloader.md | grep -cE '^- '
done
```

**Expected per adapter:**
- H1 = `# {Tool} Adapter — Bootloader`
- 1 occurrence of `## Responsibilities`
- 1 occurrence of `## Non-responsibilities`
- ≥3 numbered items
- ≥2 bulleted items

---

## AC-07: doctor processes new adapters without ERROR

```bash
PROJECT=/tmp/soma-spec009-doctor-$(date +%s)
mkdir -p "$PROJECT/src" && cd "$PROJECT" && touch src/index.js
node ~/.soma-v2/scripts/init.cjs --existing --soma-home=$HOME/.soma-v2

node ~/.soma-v2/scripts/doctor.cjs --check-context-routing --json | jq '.summary, [.findings[] | select(.severity == "error")]'
```

**Expected:** exit 0; zero ERROR-severity findings.

```bash
rm -rf "$PROJECT"
```

---

## AC-08: bootstrap enumerates 5 adapters

```bash
PROJECT=/tmp/soma-spec009-bootstrap-$(date +%s)
mkdir -p "$PROJECT/src" && cd "$PROJECT" && touch src/index.js
node ~/.soma-v2/scripts/init.cjs --existing --soma-home=$HOME/.soma-v2 >/dev/null

node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.adapters | length, [.adapters[].tool] | sort'
rm -rf "$PROJECT"
```

**Expected:**
- `5` (length)
- `["aider", "chatgpt-desktop", "claude", "codex", "cursor"]` sorted

---

## AC-09: ≥10 tests in adapter-skeletons.test.cjs

```bash
node --test ~/.soma-v2/scripts/__tests__/adapter-skeletons.test.cjs 2>&1 | tail -5
```

**Expected:** ≥10 tests, all pass, 0 fail.

---

## AC-10: SOMA cumulative regression preserved

```bash
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -8
```

**Expected:** ≥665 pass (655 baseline + ≥10 new), 0 fail, 2 skip preserved.

---

## AC-11: canonical+lib shasum unchanged

```bash
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/sprint009-qs-after.txt

diff /tmp/sprint009-qs-before.txt /tmp/sprint009-qs-after.txt && echo "✓ canonical+lib UNTOUCHED"
```

**Expected:** empty diff.

---

## AC-12: hooks aggregate preserved

```bash
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5
```

**Expected:** 48+/48+ pass (Sprint 010 may have added 1 hook test independently).

---

## AC-13: NO integration.md per adapter (D3 lock)

```bash
for adapter in cursor aider chatgpt-desktop; do
  test -f ~/.soma-v2/adapters/$adapter/integration.md && echo "✗ $adapter has integration.md (UNEXPECTED)" || echo "✓ $adapter no integration.md"
done
```

**Expected:** 3 ✓ lines.

---

## Cleanup

```bash
rm -f /tmp/sprint009-qs-before.txt /tmp/sprint009-qs-after.txt
rm -rf /tmp/soma-spec009-*
```

---

## Sign-off

Sprint 009 candidate-done when:
- [ ] All 13 ACs pass quickstart manual validation
- [ ] `node --test scripts/__tests__/adapter-skeletons.test.cjs` reports ≥10 tests pass
- [ ] SOMA cumulative ≥665 pass-or-skip
- [ ] 6 canonical+lib shasums match baseline
- [ ] Each new adapter has install-targets.json + bootloader.md only (no integration.md)
- [ ] User E2E ACCEPTED on synthetic project
