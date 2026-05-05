# Quickstart: SOMA v2.1 Phase 3 — Init Command + Sample Project

**Feature ID:** 002-soma-init
**Created:** 2026-05-01
**Purpose:** manual validation steps for each AC após implementação completa.

---

## Pre-flight

```bash
# 1. Verify lab integrity (Phase 1 manifest sources untouched)
cd ~/.soma-v2
shasum -a 256 -c <(jq -r '.files[] | "\(.sha256)  \(.path)"' manifest.json | sed 's|^|./|') 2>&1 | grep -v ': OK$'
# Expected: empty (all OK).

# 2. Verify hooks baseline (38/38 expected)
rm -f /tmp/soma-state-trap* /tmp/ck/* 2>/dev/null
node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs 2>&1 | tail -8
# Expected: "# tests 38 / # pass 38 / # fail 0"

# 3. Verify Phase 2 baseline (110/110 expected)
node --test ~/.soma-v2/scripts/__tests__/*.test.cjs 2>&1 | tail -5
# Expected: "# tests 110 / # pass 110 / # fail 0" (or higher count if Phase 3 tests added)

# 4. Capture canonical source shasums pra later regression check
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.soma-v2/manifest.json ~/.soma-v2/adapters/codex/install-targets.json > /tmp/qs-pre-phase3.sha256

# 5. Verify templates intact
ls -la ~/.soma-v2/templates/project/ ~/.soma-v2/templates/project/.soma/
# Expected: AGENTS.md.tmpl + .soma/{project.md.tmpl, CONTEXT.md.tmpl, modules/index.md.tmpl}
```

---

## Validar AC-01 — greenfield init cria 4 files exatos

```bash
SAMPLE=/tmp/soma-sample-$(uuidgen | cut -c1-8)
mkdir -p $SAMPLE
cd ~/.soma-v2
node scripts/init.cjs $SAMPLE --json | jq '.summary, .files_created'
```

**Esperado:**
- `summary.files_created === 4`
- `summary.agents_md_managed === false`
- `files_created` array com exatamente 4 paths terminando em: `.soma/project.md`, `.soma/CONTEXT.md`, `.soma/modules/index.md`, `.soma/installed-state.json`
- exit 0

```bash
# Verificar files realmente existem
ls -la $SAMPLE/.soma/
test -f $SAMPLE/.soma/project.md && echo "project.md ok"
test -f $SAMPLE/.soma/CONTEXT.md && echo "CONTEXT.md ok"
test -f $SAMPLE/.soma/modules/index.md && echo "modules/index.md ok"
test -f $SAMPLE/.soma/installed-state.json && echo "installed-state.json ok"

# Verificar installed-state.json schema
jq '.schema, .soma_version, .agents_md_managed' $SAMPLE/.soma/installed-state.json
# Expected: "soma-installed-state/v1", "2.1.0-draft", false
```

---

## Validar AC-02 — re-run em projeto inicializado redireciona

```bash
# Continuação de AC-01 ($SAMPLE já tem .soma/)
shasum -a 256 $SAMPLE/.soma/* > /tmp/qs-redirect-pre.sha256

# Re-run sem flags
node scripts/init.cjs $SAMPLE --json
echo "Exit: $?"

# Esperado:
# - JSON output com mode=redirect, error=ALREADY_INITIALIZED
# - message contém "doctor" e "sync"
# - suggested_commands array com 2 commands
# - exit 1

# Re-run com --with-agents-md (também redireciona)
node scripts/init.cjs $SAMPLE --with-agents-md --json | jq '.mode, .error'
echo "Exit: $?"
# Expected: "redirect", "ALREADY_INITIALIZED", exit 1

# Verificar zero modification
shasum -a 256 -c /tmp/qs-redirect-pre.sha256
# Expected: all OK
```

---

## Validar AC-03 — --with-agents-md em path sem AGENTS.md cria file novo

```bash
SAMPLE2=/tmp/soma-sample-$(uuidgen | cut -c1-8)
mkdir -p $SAMPLE2
test ! -f $SAMPLE2/AGENTS.md && echo "no pre-existing AGENTS.md (correct)"

node scripts/init.cjs $SAMPLE2 --with-agents-md --json | jq '.summary'
# Expected: files_created=5, agents_md_managed=true, agents_md_action="create"

# Verificar AGENTS.md criado com anchored block + sha256 real
cat $SAMPLE2/AGENTS.md | grep -E '<!-- soma-v2:start id=project.AGENTS.bootloader version=2.1.0-draft sha256=[a-f0-9]{64} -->'
echo "Block markers ok"

# Verificar sha256 não é literal FILL_AT_INSTALL
grep -c "FILL_AT_INSTALL" $SAMPLE2/AGENTS.md
# Expected: 0
```

---

## Validar AC-04 — --with-agents-md preserva conteúdo existente

```bash
SAMPLE3=/tmp/soma-sample-$(uuidgen | cut -c1-8)
mkdir -p $SAMPLE3
echo "# My Project Notes" > $SAMPLE3/AGENTS.md
echo "" >> $SAMPLE3/AGENTS.md
echo "Line that MUST persist." >> $SAMPLE3/AGENTS.md
echo "Another line that MUST persist." >> $SAMPLE3/AGENTS.md
shasum -a 256 $SAMPLE3/AGENTS.md > /tmp/qs-preserve-pre.sha256

node scripts/init.cjs $SAMPLE3 --with-agents-md --json | jq '.summary.agents_md_action'
# Expected: "inject"

# Verificar conteúdo original preservado
grep -c "My Project Notes" $SAMPLE3/AGENTS.md
# Expected: 1
grep -c "Line that MUST persist" $SAMPLE3/AGENTS.md
# Expected: 1
grep -c "Another line that MUST persist" $SAMPLE3/AGENTS.md
# Expected: 1

# Verificar block anchored adicionado (1x — não duplicado)
grep -c "soma-v2:start id=project.AGENTS.bootloader" $SAMPLE3/AGENTS.md
# Expected: 1
grep -c "soma-v2:end id=project.AGENTS.bootloader" $SAMPLE3/AGENTS.md
# Expected: 1
```

---

## Validar AC-05 — placeholders substituídos corretamente

```bash
# Usando $SAMPLE de AC-01
grep -L '{{' $SAMPLE/.soma/project.md $SAMPLE/.soma/CONTEXT.md $SAMPLE/.soma/modules/index.md
# Expected: lista todos os 3 files (zero placeholders)

# {{PROJECT_NAME}} substituído pelo basename
SAMPLE_NAME=$(basename $SAMPLE)
grep -c "$SAMPLE_NAME" $SAMPLE/.soma/project.md
# Expected: ≥1 (replaced placeholder)

# {{ISO8601_DATE}} substituído por timestamp ISO8601 UTC
grep -E '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z' $SAMPLE/.soma/project.md
# Expected: ≥1 match

# Verify nenhum literal `{{` remanescente em qualquer file
grep -rn '{{' $SAMPLE/.soma/ $SAMPLE/AGENTS.md 2>/dev/null
# Expected: empty (zero remaining placeholders)
```

---

## Validar AC-06 — --dry-run zero side effects

```bash
SAMPLE4=/tmp/soma-sample-$(uuidgen | cut -c1-8)
mkdir -p $SAMPLE4
echo "" > /tmp/qs-dryrun-pre.sha256
shasum -a 256 $SAMPLE4/* 2>/dev/null > /tmp/qs-dryrun-pre.sha256 || true

# Dry-run greenfield
node scripts/init.cjs $SAMPLE4 --dry-run --json | jq '.summary, .files_planned'
# Expected: mode="dry-run", summary.files_planned=4, files_planned array com 4 paths

# Dry-run with --with-agents-md
node scripts/init.cjs $SAMPLE4 --dry-run --with-agents-md --json | jq '.summary'
# Expected: mode="dry-run", summary.files_planned=5, agents_md_managed=true

# Verificar zero side effects
test -d $SAMPLE4/.soma/ && echo "ERROR: .soma/ created (should not exist after dry-run)"
test -f $SAMPLE4/AGENTS.md && echo "ERROR: AGENTS.md created (should not exist after dry-run)"
ls -la $SAMPLE4
# Expected: directory empty (or unchanged from pre-run state)
```

---

## Validar AC-07 — sample project pipeline init→doctor→sync

```bash
SAMPLE5=/tmp/soma-sample-$(uuidgen | cut -c1-8)

# Step 1: init
node scripts/init.cjs $SAMPLE5 --with-agents-md --json | jq '.summary'
echo "init exit=$?"
# Expected: exit 0, files_created=5

# Step 2: doctor on the sample
node scripts/doctor.cjs --soma-home $SAMPLE5/.soma --json | jq '.summary'
echo "doctor exit=$?"
# Expected: exit 0, summary.total_findings === 0 (ou findings_count === 0 — depending on Phase 2 implementation field name)

# Step 3: sync --dry-run on the sample
node scripts/sync.cjs --dry-run --soma-home $SAMPLE5/.soma --json | jq '.summary'
echo "sync exit=$?"
# Expected: exit 0, summary.actionable === 0 OR summary.by_action.skip === N (everything in-sync)
```

---

## Validar AC-08 — exit codes consistency + JSON schema

```bash
# Greenfield success
SAMPLE6=/tmp/soma-sample-$(uuidgen | cut -c1-8)
node scripts/init.cjs $SAMPLE6 --quiet
echo "greenfield exit=$?"
# Expected: 0

# Already initialized redirect
node scripts/init.cjs $SAMPLE6 --quiet
echo "redirect exit=$?"
# Expected: 1

# Conflicting flags --json --quiet (INVALID_ARGS)
SAMPLE7=/tmp/soma-sample-$(uuidgen | cut -c1-8)
mkdir -p $SAMPLE7
node scripts/init.cjs $SAMPLE7 --json --quiet 2>&1 | grep -i "INVALID_ARGS"
echo "conflict exit=$?"
# Expected: stderr/stdout contém INVALID_ARGS, exit 2

# JSON parseable em todos os modos
node scripts/init.cjs $SAMPLE6 --json | jq empty && echo "redirect JSON ok"
node scripts/init.cjs /tmp/soma-sample-$(uuidgen | cut -c1-8) --json | jq empty && echo "create JSON ok"
node scripts/init.cjs /tmp/soma-sample-$(uuidgen | cut -c1-8) --dry-run --json | jq empty && echo "dry-run JSON ok"
# Expected: 3 "... ok" lines
```

---

## Cleanup pós-validação

```bash
rm -rf /tmp/soma-sample-* /tmp/soma-init-test-* /tmp/soma-init-regression-*
rm -f /tmp/qs-pre-phase3.sha256 /tmp/qs-redirect-pre.sha256 /tmp/qs-preserve-pre.sha256 /tmp/qs-dryrun-pre.sha256
```

---

## Final regression check

```bash
# Confirm canonical sources unchanged through all manual steps above
shasum -a 256 -c /tmp/qs-pre-phase3.sha256 2>&1 | grep -v ': OK$' || echo "WARN: pre-shasum file missing — re-run from Pre-flight"
# Expected: empty (all OK)

# Re-verify hooks regression
node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs 2>&1 | tail -5
# Expected: "# tests 38 / # pass 38 / # fail 0"

# Re-verify Phase 2 + Phase 3 tests all pass cumulative
node --test ~/.soma-v2/scripts/__tests__/*.test.cjs 2>&1 | tail -5
# Expected: "# tests N / # pass N / # fail 0" where N ≥ 110 (Phase 2) + ~30-40 new (Phase 3)
```

---

## Sucesso geral

Todos os 8 ACs validados → Phase 3 está completa. Próximo passo: handoff update + memory write + considerar Phase 4 (`init --existing` module inference + sync write-mode + module cookbook population).
