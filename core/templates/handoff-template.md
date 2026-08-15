# Handoff: {project} — {date}

**From session**: {session_description}
**Context health when handed off**: {context_percent}%
**Next Claude**: Read this file first, then execute the relevant bucket.

---

## State Snapshot

{1-paragraph denso: o que tá vivo, o que tá funcionando, o que tá pendente}

---

## Open Buckets

### Bucket A: {name}
**Resume prompt**: `"{exact words user will type}"`

**Context**: {por que isso tá pendente — omita se óbvio}

**Next steps** (literal checklist):
1. {command ou ação}
2. {command ou ação}
3. {command ou ação}

**Success criteria**: {how next Claude knows it's done}

**Next command** (D18): `{comando literal que a próxima sessão roda primeiro, ou "nenhum — {o que fazer}"}`

**Possíveis blockers**: {se aplicável}

---

### Bucket B: {name}
**Resume prompt**: `"{exact words user will type}"`

**Context**: {por que isso tá pendente — omita se óbvio}

**Next steps** (literal checklist):
1. {command ou ação}
2. {command ou ação}
3. {command ou ação}

**Success criteria**: {how next Claude knows it's done}

**Next command** (D18): `{comando literal que a próxima sessão roda primeiro, ou "nenhum — {o que fazer}"}`

---

## Critical Context (do NOT re-decide)

### Decisões técnicas
- {decisão + reasoning curto}

### Traps conhecidas
- {bug/limitação documentada}

### O que NÃO fazer
- {guardrails}

---

## Resume Commands (copy-paste ready)

```bash
# Bucket A
{comandos shell literais}
```

---

## Session Chain

- **Previous handoff**: {path ou "none"}
- **Created by session**: {summary}
- **Expires**: {date + 14 dias}

---

## Meta Note

{opcional — contexto extra pra próximo Claude}
