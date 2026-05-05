# Quickstart: Soma Module Cookbook Commands (Phase 4c)

Manual validation steps per AC after implementation. Run through to confirm Phase 4c candidate-done.

---

## Prerequisites

```bash
# Confirm baseline
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5  # 315/315 + new Phase 4c
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5  # 47/47 (hooks/*.test.cjs)

shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/module-cmds-qs-before.txt

# Capture original module-cookbook.md (AC-14 verification)
cp ~/.soma-v2/docs/module-cookbook.md /tmp/module-cookbook-original.md
wc -c /tmp/module-cookbook-original.md  # expected 449
```

---

## Setup synthetic SOMA project

```bash
PROJECT=/tmp/soma-modules-qs-$(date +%s)
mkdir -p "$PROJECT"
cd "$PROJECT"
node ~/.soma-v2/scripts/init.cjs --soma-home ~/.soma-v2  # bootstrap .soma/
ls -la .soma/modules/  # initially empty
```

---

## AC-01: module add creates .soma/modules/{slug}.md

```bash
cd "$PROJECT"
node ~/.soma-v2/scripts/module.cjs add "auth-system" --json
```

**Expected:**
- `out.slug === 'auth-system'`
- `out.status === 'hypothesis'`
- `out.module_path` exists; `cat .soma/modules/auth-system.md` shows front-matter `schema: soma-module/v1`, `status: hypothesis`, `name: "auth-system"`, `initialized_at: <ISO>`

---

## AC-02: module add MODULE_EXISTS

```bash
node ~/.soma-v2/scripts/module.cjs add "auth-system" --json
echo "exit=$?"
```

**Expected:** exit 1, `out.error.code === 'MODULE_EXISTS'`, original file untouched.

---

## AC-03: promote hypothesis→active

```bash
node ~/.soma-v2/scripts/module.cjs promote "auth-system" --json
cat .soma/modules/auth-system.md | head -10
```

**Expected:**
- `out.from_status === 'hypothesis'`, `out.to_status === 'active'`, `out.promoted_at` ISO populated
- Front-matter shows `status: active`, `promoted_at: <ISO>`, `last_verified: <ISO>`
- Body of markdown unchanged

---

## AC-04: promote ALREADY_ACTIVE

```bash
node ~/.soma-v2/scripts/module.cjs promote "auth-system" --json
echo "exit=$?"
```

**Expected:** exit 1, `out.error.code === 'ALREADY_ACTIVE'`.

---

## AC-05: promote MODULE_NOT_FOUND

```bash
node ~/.soma-v2/scripts/module.cjs promote "nonexistent-slug" --json
echo "exit=$?"
```

**Expected:** exit 1, `out.error.code === 'MODULE_NOT_FOUND'`.

---

## AC-06: module remove (with --yes)

```bash
node ~/.soma-v2/scripts/module.cjs add "tmp-mod" --with-snippet --json
node ~/.soma-v2/scripts/module.cjs remove "tmp-mod" --yes --json
ls .soma/modules/tmp-mod.md ~/.soma-v2/cookbook/snippets/tmp-mod.json 2>&1
```

**Expected:** both files "No such file or directory". `out.deleted` array contains both paths.

---

## AC-07: deprecate

```bash
node ~/.soma-v2/scripts/module.cjs add "legacy-mod" --json
node ~/.soma-v2/scripts/module.cjs deprecate "legacy-mod" --json
cat .soma/modules/legacy-mod.md | head -10
```

**Expected:**
- `out.to_status === 'deprecated'`, `out.deprecated_at` populated
- File still exists; front-matter shows `status: deprecated`, `deprecated_at: <ISO>`

---

## AC-08: doctor stale-hypothesis warning

```bash
# Create a module with backdated initialized_at (>90d ago)
node ~/.soma-v2/scripts/module.cjs add "old-hyp" --json
# Manually edit front-matter to backdate (or use test fixture)
# Then run doctor
node ~/.soma-v2/scripts/doctor.cjs --json | jq '.findings[] | select(.code == "stale_hypothesis")'
```

**Expected:**
- Doctor exit 0 (non-blocking)
- One finding: `{ severity: "warning", code: "stale_hypothesis", module: "old-hyp", age_days: ≥90 }`

---

## AC-09: --with-snippet creates JSON skeleton

```bash
node ~/.soma-v2/scripts/module.cjs add "with-snip-test" --with-snippet --json
cat ~/.soma-v2/cookbook/snippets/with-snip-test.json
```

**Expected:**
```json
{
  "schema": "soma-snippet/v1",
  "slug": "with-snip-test",
  "keywords": ["with-snip-test"],
  "snippets": []
}
```

---

## AC-10: no --with-snippet → no JSON

```bash
node ~/.soma-v2/scripts/module.cjs add "no-snip-test" --json
ls ~/.soma-v2/cookbook/snippets/no-snip-test.json 2>&1
```

**Expected:** "No such file or directory" — snippet NOT created.

---

## AC-11: slug derivation rules

```bash
node ~/.soma-v2/scripts/module.cjs add "Auth System" --json | jq -r '.slug'
node ~/.soma-v2/scripts/module.cjs add "foo  bar!" --json | jq -r '.slug'
node ~/.soma-v2/scripts/module.cjs add "--leading-dash" --json | jq -r '.slug'
node ~/.soma-v2/scripts/module.cjs add "trailing-" --json | jq -r '.slug'
```

**Expected slugs (in order):** `auth-system`, `foo-bar`, `leading-dash`, `trailing`.

---

## AC-12: reserved slugs rejected

```bash
for reserved in manifest snapshots evidence modules cookbook config; do
  node ~/.soma-v2/scripts/module.cjs add "$reserved" --json | jq -r '.error.code'
done
```

**Expected:** all output `RESERVED_SLUG`. exit 1 each.

---

## AC-13: init --existing → module add integration

Run on a real codebase (read-only validation):

```bash
TEST_PROJECT=/tmp/soma-real-test-$(date +%s)
cp -r ${HOME}/Documents/-\ projetos\ codex/[project E] "$TEST_PROJECT"  # or any real Next.js project
cd "$TEST_PROJECT"
node ~/.soma-v2/scripts/init.cjs --existing --soma-home ~/.soma-v2 --json > /tmp/init-existing-out.json
# Detected modules in init output
DETECTED=$(jq -r '.modules[]?.slug' /tmp/init-existing-out.json)
for slug in $DETECTED; do
  node ~/.soma-v2/scripts/module.cjs add "$slug" --json
done
ls .soma/modules/  # all detected slugs as .md files
```

**Expected:** each detected slug has `.soma/modules/{slug}.md` created via public `module add` (not direct file write in init).

---

## AC-14: module-cookbook.md preserved + appended

```bash
diff <(head -c 449 ~/.soma-v2/docs/module-cookbook.md) /tmp/module-cookbook-original.md
echo "exit=$?"  # 0 = byte-identical first 449 bytes
grep "^## Cookbook commands (Phase 4c)" ~/.soma-v2/docs/module-cookbook.md
```

**Expected:** first 449 bytes byte-identical to original. Section header `## Cookbook commands (Phase 4c)` present after byte 449.

---

## AC-15: backward compat regression

```bash
cd ~/.soma-v2 && node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/module-cmds-qs-after.txt
diff /tmp/module-cmds-qs-before.txt /tmp/module-cmds-qs-after.txt
```

**Expected:** SOMA tests cumulative count = 315 + N (Phase 4c additions) all passing. 47/47 hooks subset still green. Shasum diff empty.

---

## D4: promote SCHEMA_INVALID

```bash
# Manually corrupt front-matter
node ~/.soma-v2/scripts/module.cjs add "broken-yaml" --json
echo "rogue: extra field not in schema" >> .soma/modules/broken-yaml.md  # or break YAML structure
node ~/.soma-v2/scripts/module.cjs promote "broken-yaml" --json
echo "exit=$?"
```

**Expected:** exit 1, `out.error.code === 'SCHEMA_INVALID'`, file untouched.

---

## Cleanup

```bash
rm -rf "$PROJECT"
# Restore docs file if any test polluted (shouldn't but defensive)
diff /tmp/module-cookbook-original.md <(head -c 449 ~/.soma-v2/docs/module-cookbook.md)
```

---

## Phase 4c candidate-done checklist

- [ ] All 15 ACs validated above
- [ ] D4 SCHEMA_INVALID working
- [ ] 315/315 SOMA tests pass (post-4c cumulative count)
- [ ] 48/48 hooks aggregate regression preserved
- [ ] 6 canonical+lib shasums diff empty
- [ ] `module-cookbook.md` original 449 bytes byte-identical preserved
- [ ] Sonnet RED+GREEN commits visible in `/tmp/phase4c-work/` git log
- [ ] `~/.soma-v2/cookbook/snippets/` cleaned up post-quickstart (no test residue)
