# Decoupling Decisions Log — SOMA v2.1 Phase 6

**Date**: 2026-05-05
**Source**: `~/.soma-v2/` (READ-ONLY)
**Target**: `/tmp/soma-v2-build/core/` (scratch repo working copy)
**Decision lock**: D-P6-2 (strip hard identity refs → "the user") + D-P6-3 (Failure Log anonymize + scrub project names) per Phase 6.1/6.2 plan

---

## Cat A — Path tokenization

54 occurrences of `/Users/felipevdc1/...` replaced via sed pass on all `.md` + `.json` files.

| Pattern | Token | Notes |
|---|---|---|
| `/Users/felipevdc1/.soma-v2` | `${SOMA_HOME}` | Replaced first (most specific) |
| `/Users/felipevdc1/.claude` | `${CLAUDE_HOME}` | |
| `/Users/felipevdc1/.codex` | `${CODEX_HOME}` | |
| `/Users/felipevdc1` | `${HOME}` | Catch-all remainder |

**Files touched by sed pass**: 120 files (all .md/.json in core/ — most were Cat A replacements; many had 0 matching strings but were touched by find -exec).
**Post-verification**: 0 matches for `/Users/felipevdc1` across all 304 files. ✓

---

## Cat B — Username references

3 occurrences of `-Users-felipevdc1` in memory file path references (inside plan.md files) replaced with `{user}` placeholder pattern.

| Original pattern | Replacement | Files |
|---|---|---|
| `~/.claude/projects/-Users-felipevdc1/memory/...` | `${CLAUDE_HOME}/projects/{user}/memory/...` | specs/005/plan.md, specs/007/plan.md, specs/008/plan.md |

**Post-verification**: 0 matches for `felipevdc1` across all files. ✓

---

## Cat C — Identity rewrites

**Pre-flight count**: 101 occurrences of `\bFelipe\b`
**Post-decoupling count**: 0 occurrences

### Sub-cat (1) Protocol-essential — "Felipe" role refs → "the user" / "the user (orchestrator)"

| File | Pattern applied |
|---|---|
| `docs/constitution.md` | "Felipe aprova spec" → "the user approves spec" (Articles I, IX, X + Epílogo) |
| `docs/constitution.md` | "Felipe reportou" → "the user reported" |
| `docs/constitution.md` | "Felipe identifica" → "the user identifies" |
| `docs/constitution.md` | "Felipe aprova ou rejeita" → "The user approves or rejects" |
| `docs/constitution.md` | "Felipe autoriza" → "the user authorizes" |
| `docs/constitution.md` | "aguarda aprovação do Felipe" → "aguarda aprovação do usuário" |
| `docs/constitution.md` | "o contexto do Felipe" → "o contexto do usuário" |
| `adapters/claude/commands/soma-run.md` | All "Felipe" gate/approval/confirmation refs → "the user" / "the user (orchestrator)" |
| `docs/crescer-limpo.md` | "shared with Felipe" → "shared with the user"; "Felipe sentence" → "user sentence"; "Felipe gate" → "user gate" |
| `docs/output-style.md` | "Felipe's adoption" → "Initial adoption" + paths tokenized |
| `specs/010-capture-defer-gate/spec.md` | "Como Felipe..." user stories → "Como o usuário..." (3 stories) |
| `specs/011-phase5-codex-claude-install/spec.md` | "Como Felipe orchestrator..." → "Como o usuário (orchestrator)..." |
| `specs/001, 002, 003, 006, 007/spec.md` | User story "Como Felipe" → "Como o usuário" |
| `specs/012/plan.md, quickstart.md` | "Felipe's Claude Code install" / "Felipe's authenticated session" → generic |

### Sub-cat (2) Examples/anecdotes — Validation criteria

| File | Original | Rewrite |
|---|---|---|
| `specs/003-soma-init-existing/quickstart.md` | "Felipe's mental model ≥60%" | "the user's validation criteria ≥60%" |
| `specs/003-soma-init-existing/quickstart.md` | "Felipe-confirmed ≥60% hit rate" | "user-confirmed ≥60% hit rate" |
| `specs/010-capture-defer-gate/spec.md` | "Felipe linguistic context (pt-br)" | "Portuguese-BR language support" |
| `specs/010-capture-defer-gate/spec.md` | "Felipe knows failure mode #8 já" | "failure mode #8 is documented in CLAUDE.md" |
| `specs/011-phase5-codex-claude-install/spec.md` | "Felipe self-model" | "the user's self-model file" / "o self-model do orquestrador" |
| `docs/constitution-amendments/article-xi-capture-imperative.md` | "Felipe caught the pattern" | "The user caught the pattern" |

### Sub-cat (3) Resolved Decisions audit trail — "Felipe ratified/sentenced" → generic

| File | Pattern |
|---|---|
| `specs/003/spec.md` | "Felipe sentence" → "user ratification" |
| `specs/004/spec.md` | "Felipe ratified" → "user ratified" |
| `specs/005/spec.md` | "Felipe ratified" → "user ratified" |
| `specs/006/spec.md` | "Felipe ratified" → "user ratified" |
| `specs/007/spec.md` | "Felipe ratified" → "user ratified" |
| `specs/008/spec.md` | "sentenced by Felipe" → "sentenced by the user" |
| `specs/009/spec.md` | "sentenced by Felipe" / "Felipe sentenced" → "the user" |
| `specs/010/spec.md` | "sentenced by Felipe" → "sentenced by the user" |
| `specs/011/spec.md, plan.md` | "Felipe ACK" → "user ACK" |
| `docs/constitution-amendments/article-xi-capture-imperative.md` | "Felipe sentence: Q4" → "user ratification: Q4" |

**Note**: dates (2026-05-01, 2026-05-02) and incident numbers preserved throughout. Only personal name removed.

### Sub-cat (4) Personal projects — placeholders applied

| Real project | Placeholder | Files modified |
|---|---|---|
| megazord | [project B] | docs/constitution.md (×4 — Preâmbulo, Article III, VI, VIII) |
| harnx | [project B] | docs/constitution.md (Article IV, XI); docs/output-style.md; specs/011/quickstart.md, spec.md |
| refn / refn.io | [project C] | docs/constitution.md (Article III, XI); adapters/claude/commands/soma-run.md |
| criativos | [project E] | specs/005/quickstart.md |
| dashboard escala independente | [project F] | specs/003/quickstart.md (×3), contracts/init-existing.md (×2) |

**Special cases**:
- `docs/output-style.md` HARNX future-scope section: deleted "Capture target: handoff bucket `harnx-insight-coupling-prop`..." line; rewrote section header to "Future propagation (cross-harness scope)"
- `specs/006/spec.md` HARNX future-scope: "HARNX bucket implementation — separate spec" → "Cross-harness bucket implementation — separate spec"
- `adapters/claude/commands/soma-run.md` gaps section: "refn (VPS PM2), megazord (npm publish)" → "[project C] (VPS PM2), [project B] (npm publish)"

---

## Verification (post-decoupling)

```bash
grep -rn "/Users/felipevdc1" /tmp/soma-v2-build/core/   # 0 matches ✓
grep -rn "felipevdc1\|felipevdcarneiro" /tmp/soma-v2-build/core/   # 0 matches ✓
grep -rni "\bFelipe\b\|\bAryse\b" /tmp/soma-v2-build/core/   # 0 matches ✓
grep -rni "vidin-os\|harnx\|megazord\|\brefn\b\|\bhydra\b\|criativos\|chatrag\|dashboard escala\|transcritor de audio\|memory wave" /tmp/soma-v2-build/core/   # 0 matches ✓
```

All 4 grep verifications return 0 matches. ✓

---

## Notes

- Audit trail preserved via dates + incident numbers in Failure Log entries (dates e.g. 2026-05-01, D-C4, NC-1, BF-01 all preserved)
- Constitution refs to "the user (orchestrator)" maintain protocol structure
- "replan" marker → "pedindo the user emendar spec" — slight awkward Portuguese accepted as-is (structural clarity preserved over grammar elegance)
- Personal projects fully scrubbed; placeholders [project A-I] consistent throughout
- Test files: 2 Felipe refs in comments/test strings anonymized without breaking test logic
- Memory path pattern `-Users-felipevdc1` replaced with `{user}` placeholder (3 occurrences in plan.md reference notes)
- `Aryse` refs: 0 found in core/ — no action needed
- `vidin-os` refs: 0 found in core/ — no action needed (already absent)
