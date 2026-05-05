# Quickstart: Foundation Primitive (Phase 4d)

Manual validation steps per AC after implementation. Run through to confirm Phase 4d candidate-done.

---

## Prerequisites

```bash
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5  # baseline 454 + Phase 4d additions
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5  # 47/47

shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/foundation-qs-before.txt
```

---

## Setup synthetic project

```bash
PROJECT=/tmp/soma-foundation-qs-$(date +%s)
mkdir -p "$PROJECT"
cd "$PROJECT"
node ~/.soma-v2/scripts/init.cjs --soma-home ~/.soma-v2  # bootstrap .soma/
```

Manually edit `$PROJECT/.soma/project.md` to add Phase 4d fields:
```yaml
foundation_layers: ["roots", "trunk"]
expansion_layers: ["leaves"]
tech_stack:
  - { name: "Node.js", version: "22", role: "runtime" }
  - { name: "TypeScript", version: "5", role: "language" }
test_command: "npm test"
build_command: "npm run build"
typecheck_command: "npx tsc --noEmit"
lint_command: "npx eslint ."
decisions: ["adr-0001-stack-choice"]
```

---

## AC-01 + AC-02: schema migration

```bash
cd "$PROJECT"
# Add a module with layer: trunk
mkdir -p .soma/modules
cat > .soma/modules/auth.md << 'EOF'
---
schema: soma-module/v1
name: "auth"
layer: trunk
status: active
---
# auth module
EOF
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.foundation_layers'
```

**Expected:** `["roots", "trunk"]`. Module `auth` parsed with `layer: trunk`.

---

## AC-03: 9-criterion output

```bash
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.criteria | length'
```

**Expected:** 9. Each criterion has `{id, name, status, message}`.

---

## AC-04 — Criterion 1 (padrões claros)

```bash
# Path A — ADR file
mkdir -p docs/architecture-decisions
echo "# ADR-0001: Stack Choice" > docs/architecture-decisions/0001-stack-choice.md
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.criteria[0]'
```

**Expected:** `{id: 1, status: "pass", message: "1 ADR file detected: ..."}`.

Path B (without ADR file but with `decisions` populated): rerun with `decisions: ["adr-0001"]` set in project.md — also pass.

---

## AC-07 + D1 — Criterion 4 (zero hardcoded, Bruno strict)

```bash
mkdir -p src
echo 'const url = "http://localhost:3000";' > src/config.ts  # hardcoded URL
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.criteria[3]'
```

**Expected:** `{id: 4, status: "fail", message: "1 hit in foundation source: src/config.ts:1 (hardcoded URL)"}`.

```bash
# Fix by replacing with env var
echo 'const url = process.env.API_URL;' > src/config.ts
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.criteria[3]'
```

**Expected:** `{id: 4, status: "pass", ...}`.

---

## AC-15 + D7 — `--gate` mode

```bash
# Make all 9 criteria pass first (synthetic project setup)
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --gate --project "$PROJECT"
echo "exit=$?"
```

**Expected (when all 9 pass):**
- Final stdout line: `fundação sólida o suficiente?`
- exit 0

```bash
# Break criterion 4 again
echo 'const x = "http://localhost";' > src/config.ts
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --gate --project "$PROJECT"
echo "exit=$?"
```

**Expected:** exit 1, same rhetorical line.

---

## AC-17 + D6 — Legacy state

```bash
LEGACY=/tmp/soma-legacy-qs-$(date +%s)
mkdir -p "$LEGACY"
cd "$LEGACY"
node ~/.soma-v2/scripts/init.cjs --soma-home ~/.soma-v2
# Do NOT add foundation_layers to project.md
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$LEGACY"
```

**Expected:**
- exit 0
- stdout warning: `foundation_layers not configured ... use 'soma init --foundation' to set up Phase 4d primitive`
- No criteria evaluated; `summary: null`

---

## D3 — Invalid layer name

Manually edit `.soma/project.md`:
```yaml
foundation_layers: ["custom-layer"]  # invalid
```

```bash
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.error.code'
```

**Expected:** `"INVALID_LAYER"`. exit 1.

---

## Security — Command injection

Manually edit `.soma/project.md` with malicious commands:
```yaml
test_command: "npm test; rm -rf /"  # injection attempt
```

```bash
node ~/.soma-v2/scripts/doctor.cjs --foundation-check --project "$PROJECT" --json | jq '.criteria[5]'
```

**Expected:** rejected via shell metacharacter detection (clear error message); criterion 6 either skipped with warning OR fail with `INVALID_COMMAND` reason. NO `rm -rf /` execution.

---

## Cleanup

```bash
rm -rf "$PROJECT" "$LEGACY"
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/foundation-qs-after.txt
diff /tmp/foundation-qs-before.txt /tmp/foundation-qs-after.txt
```

**Expected:** empty diff (real canonical+libs untouched throughout quickstart).

---

## Phase 4d candidate-done checklist

- [ ] All 17 ACs validated above
- [ ] D1-D7 resolutions verified
- [ ] 454 + Phase 4d cumulative SOMA tests pass
- [ ] 47/47 hooks (subset) preserved
- [ ] 6 canonical+lib shasums diff empty
- [ ] Sonnet RED+GREEN commits visible in `/tmp/phase4d-work/` git log
- [ ] AC-14 (Step 5 VALIDATE in foundation territory) deferred Phase 5+ — `xtest()` skip stub in place
