Avalie o Depth Decay Score da sessão atual, comparando o que foi planejado contra o que foi implementado.

## Passos

### 1. Localize o plano ativo

Encontre o plano da sessão (em `~/.claude/plans/` ou informado pelo usuário).

### 2. Extraia os requisitos

Leia o plano e extraia TODOS os checkboxes:
- `- [x]` = item completado
- `- [ ]` = item pendente

### 3. Calcule o score

```
Depth Score = (items completados / total de items) × 100%
```

### 4. Avalie por camada (se possível)

Se o plano tem seções/fases identificáveis, calcule o score por camada:
- Camada 1 (planejamento/estrutura): items de setup, scaffolding
- Camada 2 (specs/design): items de spec, design, architecture
- Camada 3 (implementação): items de código, testes
- Camada 4 (verificação): items de review, quality check, polish

Se o depth decay está presente, espere scores progressivamente menores por camada.

### 5. Apresente o relatório

```
## Depth Score Report

**Plano**: [path]
**Data**: [data]

### Score Geral
[X]/[Total] items completados — **[N]%**

### Por Camada (se aplicável)
| Camada | Items | Completados | Score |
|--------|-------|-------------|-------|
| 1 - Setup | N | N | N% |
| 2 - Design | N | N | N% |
| 3 - Implementação | N | N | N% |
| 4 - Verificação | N | N | N% |

### Análise
- [Se score cai por camada: "Depth decay detectado — qualidade degradou de X% (camada 1) para Y% (camada 4)"]
- [Se score estável: "Sem depth decay significativo — qualidade consistente across layers"]

### Tendência (se houver histórico)
Compare com sessões anteriores se o dado estiver disponível no MemPalace.
```

### 6. Salve no MemPalace

Após calcular, salve o score no MemPalace para tracking cross-session:
```
mempalace_diary_write(
  agent_name="claude",
  entry="Depth Score: [N]% ([X]/[Total]). Projeto: [nome]. Decay: [sim/não].",
  topic="depth-score"
)
```

## Regras

- Score é objetivo — baseado em checkboxes, não em opinião
- Se não há checkboxes no plano, sugira rodar `/hyd` primeiro
- Todo output em português do Brasil
