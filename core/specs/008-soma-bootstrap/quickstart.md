# Quickstart: Soma Bootstrap CLI + Onboarding Doc (Sprint 008)

Manual validation steps per AC after implementation. Run through to confirm Sprint 008 candidate-done.

---

## Prerequisites

```bash
# Confirm baseline
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5  # 579/579 + new Sprint 008
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5    # 48/48 hooks aggregate

# Capture shasum baseline (AC-14)
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/sprint008-qs-before.txt
```

---

## Setup synthetic SOMA-enabled project

```bash
PROJECT=/tmp/soma-bootstrap-qs-$(date +%s)
mkdir -p "$PROJECT"
cd "$PROJECT"

# Init existing — emulates a fresh-cloned SOMA-enabled repo
mkdir src && touch src/index.js
node ~/.soma-v2/scripts/init.cjs --existing --soma-home ~/.soma-v2

ls -la .soma/                # .soma/ + manifest.json + modules/
ls -la .soma/modules/        # modules from H2 inference
```

---

## AC-01: bootstrap detects `.soma/` and proceeds

```bash
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bootstrap-out.json
echo "exit=$?"
jq '.status' /tmp/bootstrap-out.json
```

**Expected:**
- `exit=0`
- `.status === "ready"` OR `"drift"` (depending on synthetic state)
- `.schema === "soma-bootstrap/v1"`

---

## AC-02: NO_SOMA_PROJECT when `.soma/` missing

```bash
EMPTY=/tmp/no-soma-$(date +%s)
mkdir "$EMPTY"
cd "$EMPTY"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bootstrap-no-soma.json
echo "exit=$?"
jq '.error_code, .suggestion' /tmp/bootstrap-no-soma.json
```

**Expected:**
- `exit=1`
- `.error_code === "NO_SOMA_PROJECT"`
- `.suggestion` non-empty (mentions `soma init`)

---

## AC-03 + AC-04: SOMA_HOME validation

```bash
# Valid SOMA_HOME (default)
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.soma_home'
# expected: "/Users/{user}/.soma-v2"

# Invalid SOMA_HOME (override)
SOMA_HOME=/nonexistent/path node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bootstrap-bad-home.json
echo "exit=$?"
jq '.error_code, .suggestion' /tmp/bootstrap-bad-home.json
```

**Expected (invalid):**
- `exit=1`
- `.error_code === "INVALID_SOMA_HOME"`
- `.suggestion` references onboarding.md + env var override

---

## AC-05 + AC-06: doctor delegation + zero findings

```bash
# Healthy fixture (modules present, no drift)
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.findings | length, .status'
```

**Expected:**
- `.findings | length === 0` if SOMA_HOME pristine and `.soma/manifest.json` matches
- `.status === "ready"`

---

## AC-07: drift findings → status:drift + suggestion

```bash
# Inject synthetic drift in SOMA_HOME copy
DRIFT_HOME=/tmp/drift-soma-home-$(date +%s)
cp -r ~/.soma-v2 "$DRIFT_HOME"
echo "INJECTED_DRIFT_LINE" >> "$DRIFT_HOME/docs/sdd.md"

cd "$PROJECT"
SOMA_HOME="$DRIFT_HOME" node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bootstrap-drift.json
echo "exit=$?"
jq '.status, .findings | length, .suggestion' /tmp/bootstrap-drift.json
```

**Expected:**
- `exit=0` (warnings non-blocking per AC-07)
- `.status === "drift"`
- `.findings | length >= 1`
- `.suggestion` references `soma sync --apply`

---

## AC-08: critical drift → exit 1

```bash
# Corrupt manifest schema
CRIT_HOME=/tmp/critical-soma-home-$(date +%s)
cp -r ~/.soma-v2 "$CRIT_HOME"
jq '.schema = "soma-manifest/v999"' "$CRIT_HOME/manifest.json" > /tmp/m.json && mv /tmp/m.json "$CRIT_HOME/manifest.json"

cd "$PROJECT"
SOMA_HOME="$CRIT_HOME" node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bootstrap-crit.json
echo "exit=$?"
jq '.error_code, (.critical_findings // []) | length' /tmp/bootstrap-crit.json
```

**Expected:**
- `exit=1`
- `.error_code === "CRITICAL_DRIFT"` OR `"SCHEMA_VERSION_UNSUPPORTED"`
- critical findings populated

---

## AC-09: output schema completeness

```bash
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq 'keys'
```

**Expected fields present:** `schema`, `status`, `soma_home`, `project_root`, `modules`, `adapters`, `findings`, `duration_ms`, `suggestion`.

```bash
node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.modules[0] | keys'
# expected: ["slug", "status"]

node ~/.soma-v2/scripts/bootstrap.cjs --quiet | jq '.adapters[0] | keys'
# expected: ["tool", "install_targets_count"]
```

---

## AC-10: default mode (no --quiet) — human + JSON block

```bash
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs > /tmp/bootstrap-default.txt
echo "exit=$?"

head -3 /tmp/bootstrap-default.txt   # human-readable summary lines
grep -c "Project ready\|Drift detected\|Bootstrap failed" /tmp/bootstrap-default.txt  # ≥1
tail -50 /tmp/bootstrap-default.txt | sed -n '/^{/,/^}$/p' | jq '.schema'  # JSON block parseable
```

**Expected:** human lines + final JSON block both present.

---

## AC-11: --quiet emits ONLY JSON

```bash
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /tmp/bootstrap-quiet.txt
echo "exit=$?"

# Stdout should be pure JSON
head -c 1 /tmp/bootstrap-quiet.txt   # must be '{'
tail -c 2 /tmp/bootstrap-quiet.txt   # must end '}\n' or '}'
jq . /tmp/bootstrap-quiet.txt        # parseable
```

**Expected:** stdout is pure parseable JSON, zero human-readable lines.

---

## AC-12: onboarding.md deliverable

```bash
ls -la ~/.soma-v2/docs/onboarding.md
wc -l ~/.soma-v2/docs/onboarding.md   # expect ≥80 lines (terse but complete)

# Required sections present
grep -c "^## Prerequisites\|^## Quickstart\|^## Troubleshooting" ~/.soma-v2/docs/onboarding.md   # expect 3

# ≥3 error scenarios in Troubleshooting
sed -n '/^## Troubleshooting/,/^## /p' ~/.soma-v2/docs/onboarding.md | grep -c "^### "   # expect ≥3
```

**Expected:** 3 sections + ≥3 error scenarios documented.

---

## AC-13: wallclock ≤5s p95

```bash
cd "$PROJECT"
for i in {1..10}; do
  START=$(node -e 'console.log(Date.now())')
  node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /dev/null
  END=$(node -e 'console.log(Date.now())')
  echo "$((END - START))ms"
done | sort -n
```

**Expected:** p95 (9th value when sorted) ≤4500ms; max ≤5000ms.

---

## AC-14: read-only proof — shasum integrity

```bash
# Pre-bootstrap shasum
SOMA_BEFORE=$(shasum -a 256 -p $(find ~/.soma-v2 -type f -not -path "*/specs/008*" -not -path "*/.snapshots/*" | sort) | shasum -a 256 | cut -d' ' -f1)

# Run bootstrap (success path)
cd "$PROJECT"
node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /dev/null

# Run bootstrap (error path)
cd /tmp/no-soma-fixture-$(date +%s) 2>/dev/null || (mkdir /tmp/no-soma-final && cd /tmp/no-soma-final)
node ~/.soma-v2/scripts/bootstrap.cjs --quiet > /dev/null 2>&1

# Post-bootstrap shasum
SOMA_AFTER=$(shasum -a 256 -p $(find ~/.soma-v2 -type f -not -path "*/specs/008*" -not -path "*/.snapshots/*" | sort) | shasum -a 256 | cut -d' ' -f1)

echo "BEFORE: $SOMA_BEFORE"
echo "AFTER : $SOMA_AFTER"
test "$SOMA_BEFORE" = "$SOMA_AFTER" && echo "✓ READ-ONLY PROVEN" || echo "✗ MUTATION DETECTED"
```

**Expected:** ✓ READ-ONLY PROVEN.

---

## Final shasum verification (Sprint 008 baseline preservation)

```bash
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/sprint008-qs-after.txt

diff /tmp/sprint008-qs-before.txt /tmp/sprint008-qs-after.txt && echo "✓ canonical+lib UNTOUCHED"
```

**Expected:** empty diff. 6 canonical+lib shasums unchanged from session start.

---

## Cleanup

```bash
rm -rf /tmp/soma-bootstrap-qs-* /tmp/no-soma-* /tmp/drift-soma-home-* /tmp/critical-soma-home-* /tmp/bootstrap-*.json /tmp/bootstrap-*.txt /tmp/sprint008-qs-*.txt
```

---

## Sign-off

Sprint 008 candidate-done when:
- [ ] All 14 ACs pass quickstart manual validation
- [ ] `node --test scripts/__tests__/*.test.cjs` reports ≥619 cumulative pass (579 baseline + ≥40 Sprint 008)
- [ ] Hooks regression 48/48 preserved
- [ ] 6 canonical+lib shasums match baseline
- [ ] `~/.soma-v2/docs/onboarding.md` exists + 3 sections + 3 troubleshooting scenarios
- [ ] User E2E ACCEPTED on synthetic project
