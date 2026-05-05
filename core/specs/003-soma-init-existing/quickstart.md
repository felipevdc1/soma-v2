# Quickstart: Soma Init Existing — Manual Validation Per AC

**Feature ID:** 003-soma-init-existing
**Created:** 2026-05-01

This quickstart provides manual steps to exercise each AC of `soma init --existing` after Sonnet implementation lands. Use these to validate Phase 4a candidate-done before merging to main.

---

## Prerequisites

```bash
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs  # baseline must pass — Phase 4a count + Phase 2+3 (238) cumulative
```

Confirm 4 canonical shasums unchanged from Phase 3 baseline:

```bash
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.soma-v2/manifest.json 2>/dev/null
```

---

## AC-01 — H2 detects src/ subdirs as modules

```bash
TARGET=/tmp/soma-quickstart-ac01-$$
mkdir -p $TARGET/src/{app,components,lib}
echo "// stub" > $TARGET/src/app/page.tsx
echo "// stub" > $TARGET/src/components/btn.tsx
echo "// stub" > $TARGET/src/lib/utils.ts

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json | jq '.summary, .modules[].name'
```

**Expect:**
- `summary.modules_detected: 3`, `modules_emitted: 3`
- module names: `app`, `components`, `lib`
- `.soma/modules/{app,components,lib}.md` files exist

```bash
ls $TARGET/.soma/modules/
rm -rf $TARGET
```

---

## AC-02 — package.json workspaces detection

```bash
TARGET=/tmp/soma-quickstart-ac02-$$
mkdir -p $TARGET/packages/{foo,bar}
cat > $TARGET/package.json <<EOF
{"name": "monorepo-test", "workspaces": ["packages/foo", "packages/bar"]}
EOF
echo "// stub" > $TARGET/packages/foo/index.ts
echo "// stub" > $TARGET/packages/bar/index.ts

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json | jq '.modules[].name'
```

**Expect:** module names include `foo` and `bar`.

```bash
rm -rf $TARGET
```

---

## AC-03 — framework dirs (no src/) + NC-1 src/-first priority

**Case A — no src/, framework dirs at root:**
```bash
TARGET=/tmp/soma-quickstart-ac03a-$$
mkdir -p $TARGET/{app,components,lib}
echo "// stub" > $TARGET/app/page.tsx
echo "// stub" > $TARGET/components/btn.tsx
echo "// stub" > $TARGET/lib/utils.ts

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json | jq '.modules[].name'
```

**Expect:** `app`, `components`, `lib`.

**Case B — src/ AND framework dirs at root coexist (NC-1 lock src/-first):**
```bash
TARGET=/tmp/soma-quickstart-ac03b-$$
mkdir -p $TARGET/src/{app,components}
mkdir -p $TARGET/{app,pages}  # legacy/coexisting framework dirs at root
echo "// stub" > $TARGET/src/app/page.tsx
echo "// stub" > $TARGET/src/components/btn.tsx
echo "// stub" > $TARGET/app/legacy.tsx
echo "// stub" > $TARGET/pages/index.tsx

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json | jq '.modules[].name'
```

**Expect:** ONLY `app`, `components` (from src/). NOT `pages` (root, ignored due to src/-first per NC-1).

```bash
rm -rf /tmp/soma-quickstart-ac03*
```

---

## AC-04 — Module file schema fields

```bash
TARGET=/tmp/soma-quickstart-ac04-$$
mkdir -p $TARGET/src/app
echo "// stub" > $TARGET/src/app/page.tsx

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json > /dev/null
cat $TARGET/.soma/modules/app.md
```

**Expect** module file contains (front-matter or body):
- `schema: soma-module/v1`
- `status: hypothesis`
- `source_confidence: low`
- `owners: []`
- `last_verified: null`
- `verification.command: null`
- `verification.files_checked` includes `src/app/page.tsx`

```bash
rm -rf $TARGET
```

---

## AC-05 — `--deep` ranks by git commit count (90d window)

```bash
TARGET=/tmp/soma-quickstart-ac05-$$
mkdir -p $TARGET/src/{active,dormant}
cd $TARGET
git init -q
echo "// stub" > src/active/code.ts
echo "// stub" > src/dormant/old.ts
git add . && git -c user.email=t@t -c user.name=T commit -qm initial

# Bump active 5x
for i in 1 2 3 4 5; do
  echo "// v$i" > src/active/code.ts
  git add . && git -c user.email=t@t -c user.name=T commit -qm "v$i"
done

cd -
node ~/.soma-v2/scripts/init.cjs --existing $TARGET --deep --json | jq '.heuristic, .modules[]'
```

**Expect:**
- `heuristic: "H1"`
- `git_repo_detected: true`
- both `active` and `dormant` modules present (both have ≥1 commit in 90d)
- `active.commit_count_90d >= 5`, `dormant.commit_count_90d == 1`

```bash
rm -rf $TARGET
```

---

## AC-06 — `--deep` fallback when no .git/

```bash
TARGET=/tmp/soma-quickstart-ac06-$$
mkdir -p $TARGET/src/app
echo "// stub" > $TARGET/src/app/page.tsx
# NO git init

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --deep --json | jq '.heuristic, .git_repo_detected, .warnings'
echo "Exit: $?"
```

**Expect:**
- `heuristic: "H2"`
- `git_repo_detected: false`
- warnings array contains `"no git history available, falling back to filesystem heuristic"`
- exit code: 0 (NOT 1)

```bash
rm -rf $TARGET
```

---

## AC-07 — `.soma/` already exists redirect (exit 1)

```bash
TARGET=/tmp/soma-quickstart-ac07-$$
mkdir -p $TARGET/src/app/.soma
echo "// stub" > $TARGET/src/app/page.tsx

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json
echo "Exit: $?"
```

**Expect:**
- output JSON: `mode: "redirect"`, `error: "ALREADY_INITIALIZED"`, `suggested_commands` array with `doctor` and `sync --dry-run` commands
- exit code: **1** (not 0, not 2)

```bash
rm -rf $TARGET
```

---

## AC-08 — Phase 2/3 libs untouched

```bash
LIB_DIR=~/.soma-v2/scripts/lib
SHA_BEFORE=$(shasum -a 256 $LIB_DIR/anchored-blocks.cjs $LIB_DIR/manifest.cjs $LIB_DIR/template-engine.cjs)

TARGET=/tmp/soma-quickstart-ac08-$$
mkdir -p $TARGET/src/app
echo "// stub" > $TARGET/src/app/page.tsx
node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json > /dev/null

SHA_AFTER=$(shasum -a 256 $LIB_DIR/anchored-blocks.cjs $LIB_DIR/manifest.cjs $LIB_DIR/template-engine.cjs)

[ "$SHA_BEFORE" = "$SHA_AFTER" ] && echo "AC-08 PASS" || echo "AC-08 FAIL — libs modified!"

rm -rf $TARGET
```

**Expect:** `AC-08 PASS` (shasums match exactly).

---

## AC-09 — Fixture validation suite (3 fixtures, hit rate ≥60%)

This is automated via `scripts/__tests__/init-existing.fixture-validation.test.cjs`. Manual validation:

```bash
cd ~/.soma-v2
node --test scripts/__tests__/init-existing.fixture-validation.test.cjs 2>&1 | tail -20
```

**Expect:** all 3 fixture tests PASS with `hit_rate >= 0.6` per fixture. Output messages include:
- `framework-heavy: detected=N, expected=M, hit_rate=K.K (>= 0.6 OK)`
- `cli-library: ...`
- `monorepo: ...`

Verify evidence file written (D-C10):

```bash
ls ~/.soma-v2/evidence/$(date +%Y-%m-%d)/
cat ~/.soma-v2/evidence/$(date +%Y-%m-%d)/init-existing-framework-heavy.md
```

**Expect** evidence file with front-matter `modules: [...]`.

---

## AC-10 — Empty repo "no modules inferred"

```bash
TARGET=/tmp/soma-quickstart-ac10-$$
mkdir -p $TARGET  # zero source files

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json | jq '.summary, .message'
echo "Exit: $?"
ls $TARGET/.soma/
cat $TARGET/.soma/modules/index.md
```

**Expect:**
- `summary.modules_detected: 0`
- `message: "no modules inferred"`
- exit code 0
- `.soma/modules/index.md` exists with empty modules list

```bash
rm -rf $TARGET
```

---

## AC-11 — Single-file module valid (≥1 file threshold, NOT ≥3)

```bash
TARGET=/tmp/soma-quickstart-ac11-$$
mkdir -p $TARGET/src/app
echo "// only one file" > $TARGET/src/app/single.ts

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json | jq '.modules'
```

**Expect:** module `app` emitted with `files_count: 1`. NOT filtered out.

```bash
rm -rf $TARGET
```

---

## AC-12 — Cross-LLM portability schema validation

```bash
TARGET=/tmp/soma-quickstart-ac12-$$
mkdir -p $TARGET/src/app
echo "// stub" > $TARGET/src/app/page.tsx

node ~/.soma-v2/scripts/init.cjs --existing $TARGET --json > /dev/null

# These greps must return ZERO matches (Claude-specific primitives must be absent):
grep -E '/specify|/plan-sdd|/sonar-audit|/soma-run|thermal-guard\.cjs|spec-completeness-gate\.cjs|skill_id:|hook_id:' $TARGET/.soma/project.md $TARGET/.soma/modules/app.md
echo "AC-12 PASS (zero matches)" || echo "AC-12 FAIL — Claude-specific primitive leaked"
```

**Expect:** `AC-12 PASS (zero matches)`. The grep must exit non-zero (no matches found).

```bash
rm -rf $TARGET
```

---

## E2E Smoke (real project — [project F])

```bash
TARGET="${HOME}/Documents/projetos claude code/[project F]"
# Make sure NO .soma/ exists (this is a real project — backup current state if needed)
[ -d "$TARGET/.soma" ] && echo "WARN: .soma/ exists, will redirect" || echo "OK: greenfield --existing applicable"

node ~/.soma-v2/scripts/init.cjs --existing "$TARGET" --json --verbose 2>&1 | tee /tmp/soma-e2e-real.log
```

**Expect:**
- Modules detected match expected: at least 4-5 of [`app`, `components`, `lib`, `scripts`, `config`] from real codebase structure
- Hit rate vs the user's validation criteria ≥60% (this is the validation the user will use to decide if Phase 4a passes)
- 9 files created in `.soma/`
- All tests in `node --test scripts/__tests__/*.test.cjs` STILL PASS (cumulative + Phase 4a additions)

---

## Cleanup after validation

```bash
# Remove the .soma/ from real project after validation:
TARGET="${HOME}/Documents/projetos claude code/[project F]"
rm -rf "$TARGET/.soma"

# Remove all /tmp/ quickstart fixtures:
rm -rf /tmp/soma-quickstart-*
```

---

## Verification gate before marking Phase 4a DONE

- [ ] All 12 ACs pass per quickstart steps above
- [ ] `node --test scripts/__tests__/*.test.cjs` returns cumulative tests pass (Phase 2: 110 + Phase 3: 128 + Phase 4a: N) all green
- [ ] 38/38 hooks regression preserved (`scripts/__tests__/hooks-regression.test.cjs` PASS)
- [ ] 4 canonical shasums unchanged (codex AGENTS / ~/AGENTS / constitution / manifest)
- [ ] AC-09 fixture validation: all 3 fixtures hit rate ≥0.6
- [ ] E2E real-project smoke: [project F] produces 4-5+ modules with user-confirmed ≥60% hit rate
- [ ] Evidence files written per D-C10 in `~/.soma-v2/evidence/{date}/`
