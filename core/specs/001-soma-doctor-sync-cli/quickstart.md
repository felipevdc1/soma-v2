# Quickstart: SOMA v2.1 Phase 2 — Doctor and Sync Dry-Run CLI

**Feature ID:** 001-soma-doctor-sync-cli
**Created:** 2026-05-01
**Purpose:** manual validation steps for each AC após implementação completa.

---

## Pre-flight

```bash
# 1. Verify lab integrity (sources untouched per Phase 1 manifest)
cd ~/.soma-v2
shasum -a 256 -c <(jq -r '.files[] | "\(.sha256)  \(.path)"' manifest.json | sed 's|^|./|') 2>&1 | grep -v ': OK$'
# Expected: empty (all OK). Any line shown = drift in lab itself.

# 2. Verify hooks baseline (38/38 expected)
rm -f /tmp/soma-state-trap* /tmp/ck/*  2>/dev/null
node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs 2>&1 | tail -8
# Expected: "# tests 38 / # pass 38 / # fail 0"

# 3. Capture canonical source shasums pra later regression check
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.claude/CLAUDE.md > /tmp/qs-pre.sha256
```

---

## Validar AC-01 — doctor detecta 3 drifts conhecidos

```bash
cd ~/.soma-v2
node scripts/doctor.cjs --json | jq '.summary, .findings[] | {kind, severity, target_anchor_id}'
```

**Esperado:**
- summary mostra `total_findings: 3` (ou ≥3 se source_staleness adiciona findings) e `by_kind: {target_drift: 3}`
- 3 findings com kind=target_drift, target_anchor_ids exatos: `block.codex.AGENTS.soma-stsd`, `block.codex.AGENTS.codebase-memory-mcp`, `block.codex.AGENTS.hyd-v2`
- Severidades = `missing`, `missing`, `drift` (D1, D2, D3 do inventory)
- Zero finding com severity=ok ou kind="other"

```bash
# Human output check
node scripts/doctor.cjs
# Esperado: linhas "[missing]" pra ~/AGENTS.md (2x) + "[drift]" pra ~/.codex/AGENTS.md (1x)
```

---

## Validar AC-02 — doctor é read-only

```bash
cd ~/.soma-v2
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.claude/CLAUDE.md > /tmp/before.sha256
node scripts/doctor.cjs > /dev/null 2>&1
node scripts/doctor.cjs --json > /dev/null 2>&1
shasum -a 256 -c /tmp/before.sha256
```

**Esperado:** todas linhas terminam em `OK`. Zero modificação em qualquer source.

```bash
# Verify lab itself unchanged
cd ~/.soma-v2
shasum -a 256 -c <(jq -r '.files[] | "\(.sha256)  \(.path)"' manifest.json | sed 's|^|./|') 2>&1 | grep -v ': OK$'
# Esperado: empty (all OK)
```

---

## Validar AC-03 — sync --dry-run reporta intended edits

```bash
cd ~/.soma-v2
node scripts/sync.cjs --dry-run --json | jq '.summary, .findings[] | {action, target_path, target_anchor_id}'
```

**Esperado:**
- summary `by_action: {insert: 2, skip: 3}` (3 codex entries em sync + 2 inserts pra ~/AGENTS.md)
- 2 findings com action=insert, target_path terminando `/AGENTS.md`, target_anchor_ids = `block.codex.AGENTS.soma-stsd` + `block.codex.AGENTS.codebase-memory-mcp`
- 3 findings com action=skip pra ~/.codex/AGENTS.md (OU action=drift se D3 ainda presente — depende se T-04 considera D3 como drift via skip vs drift discriminator)
- Cada finding inclui `expected_sha256`, `source_doc`, `target_path`, `target_anchor_id`

---

## Validar AC-04 — sync --dry-run é read-only

```bash
cd ~/.soma-v2
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.claude/CLAUDE.md > /tmp/before.sha256
node scripts/sync.cjs --dry-run > /dev/null 2>&1
node scripts/sync.cjs --dry-run --json > /dev/null 2>&1
shasum -a 256 -c /tmp/before.sha256
```

**Esperado:** todas `OK`.

```bash
# Reject sem --dry-run flag
node scripts/sync.cjs 2>&1 | grep -E "(INVALID_ARGS|--dry-run)"
echo "exit=$?"
```

**Esperado:** mensagem mencionando `INVALID_ARGS` ou `--dry-run` mandatory; exit ≠ 0.

---

## Validar AC-05 — hooks regression preservada

```bash
rm -f /tmp/soma-state-trap* /tmp/ck/*  2>/dev/null

# Pre: confirm 38/38 baseline
node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs 2>&1 | tail -5 | grep -E "tests|pass|fail"

# Run doctor + sync sequencially
cd ~/.soma-v2
node scripts/doctor.cjs > /dev/null 2>&1
node scripts/sync.cjs --dry-run > /dev/null 2>&1

# Cleanup hook state files (doctor/sync should not have created any)
rm -f /tmp/soma-state-trap* 2>/dev/null

# Post: re-run hooks tests
node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs 2>&1 | tail -5 | grep -E "tests|pass|fail"
```

**Esperado:** ambas runs reportam `# tests 38 / # pass 38 / # fail 0`.

---

## Validar AC-06 — JSON output válido

```bash
cd ~/.soma-v2
node scripts/doctor.cjs --json | jq empty && echo "doctor JSON ok"
node scripts/sync.cjs --dry-run --json | jq empty && echo "sync JSON ok"
```

**Esperado:** ambos imprimem `... ok`. `jq empty` retorna exit 0 silenciosamente em JSON válido.

```bash
# Schema validation
node scripts/doctor.cjs --json | jq '.tool == "doctor" and .mode == "check" and (.findings | type == "array")'
node scripts/sync.cjs --dry-run --json | jq '.tool == "sync" and .mode == "dry-run" and (.findings | type == "array")'
```

**Esperado:** ambos imprimem `true`.

---

## Validar AC-07 — exit codes semânticos

```bash
cd ~/.soma-v2

# doctor com drift presente (estado inicial — D1+D2+D3 não resolvidos)
node scripts/doctor.cjs > /dev/null 2>&1; echo "doctor exit=$?"
# Esperado: 1

# sync --dry-run com actions actionable
node scripts/sync.cjs --dry-run > /dev/null 2>&1; echo "sync exit=$?"
# Esperado: 1

# sync sem --dry-run (Phase 2 enforces dry-run-only)
node scripts/sync.cjs > /dev/null 2>&1; echo "sync-no-flag exit=$?"
# Esperado: 2

# To verify exit=0: criar fixture all-in-sync em /tmp e usar --soma-home
# (manual fixture creation; opcional pra MVP)
```

---

## Cleanup pós-validação

```bash
rm -f /tmp/qs-pre.sha256 /tmp/before.sha256
rm -rf /tmp/soma-test-*
```

---

## Final regression check

```bash
# Confirm canonical sources unchanged through all manual steps above
shasum -a 256 -c /tmp/qs-pre.sha256 2>&1 || echo "WARN: pre-shasum file missing — re-run from Pre-flight"
```

**Esperado:** todas `OK`. Se algum source modificou, ABORT — voltar pra T-04/T-06 + investigar.

---

## Sucesso geral

Todos os 7 ACs validados → Phase 2 está completa. Próximo: handoff update + memory write + considerar Phase 3 (`soma init` + sample project).
