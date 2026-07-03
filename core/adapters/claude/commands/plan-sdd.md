Execute SDD phases 2 and 3: derive technical plan, contracts, and tasks from a completed spec.md.

The argument is a path to `spec.md`. If no argument is passed, auto-detect by searching `specs/*/spec.md` — if exactly one exists in the current directory tree, use it; if multiple exist, list them and ask the user to pick.

---

## Prereqs

- `.soma/` directory present in project root (project bootstrapped via `soma install`)
- `.soma/install-state.json` shows `status: "complete"`

If either condition is missing, run from the project root:

```bash
soma install . --tool=claude
```

---

## Passos

### 1. Localizar e validar a spec

Resolve o path da spec:
- Se argumento fornecido: usar diretamente (suporta path relativo ou absoluto)
- Se não fornecido: rodar via Bash:
  ```bash
  find . -path "*/specs/*/spec.md" 2>/dev/null
  ```
  Se exatamente 1 resultado → usar. Se 0 → abortar com "Nenhuma spec.md encontrada. Rode `/specify` primeiro." Se >1 → listar e pedir ao usuário que escolha.

**Precondition checks** (abortar em qualquer falha):

```bash
# Verificar que spec existe
test -f "$SPEC_PATH" || echo "ABORT: spec.md não encontrada em $SPEC_PATH"

# Verificar ausência de markers em aberto
grep -c "\[NEEDS CLARIFICATION" "$SPEC_PATH" 2>/dev/null && echo "ABORT: spec tem N marker(s) [NEEDS CLARIFICATION] em aberto. Resolva-os antes de prosseguir."

# Verificar constitution
test -f "$HOME/.claude/constitution.md" || echo "ABORT: constitution.md não encontrada em ~/.claude/constitution.md"
```

Se qualquer check falhar: **PARAR**, exibir a mensagem de erro e não produzir nenhum artefato.

### 2. Ler artefatos de referência

Antes de gerar qualquer output, ler:
1. A `spec.md` completa — extrair: feature title, feature ID (slug), acceptance criteria (todos os AC-XX), user stories, Non-Functional Requirements, e quaisquer notas de stack
2. `~/.claude/constitution.md` — especialmente Articles III (Integration-First), IV (Proof Before Done), e VII (Simplicity Gate)
3. `~/.claude/templates/plan.md` — template base para plan.md
4. `~/.claude/templates/tasks.md` — template base para tasks.md
5. `~/.claude/templates/contracts/rest-endpoint.md`, `contract-event.md`, `contract-tool-call.md` — templates de contracts

Derivar `{specDir}` = diretório onde spec.md está localizada.

### 3. Gerar `{specDir}/contracts/`

Criar o diretório `{specDir}/contracts/` se não existir.

Para cada boundary de integração identificado na spec (endpoint HTTP, evento publicado/consumido, tool call de LLM), instanciar o template correspondente:
- Endpoint HTTP → `rest-endpoint.md`
- Evento assíncrono → `contract-event.md`
- Tool call (LLM function) → `contract-tool-call.md`

**Regra de nomeação:** `{specDir}/contracts/{verb}-{recurso}.md` (ex: `create-user.md`, `user-created.md`, `search-vault.md`).

Cada contract preenchido com:
- Nome do contrato derivado da spec
- Request/payload schema derivado das user stories + ACs
- Response/output schema
- Referências explícitas aos AC-XX que esse contrato serve

**Mínimo de 1 contract obrigatório.** Se a spec não evidenciar nenhuma boundary de integração, criar ao menos 1 contract de interface para a operação principal da feature.

### 4. Gerar `{specDir}/plan.md`

Instanciar `~/.claude/templates/plan.md` preenchendo:
- `{FEATURE_TITLE}` e `{NNNN-slug}` — da spec
- `{YYYY-MM-DD}` — data de hoje
- **Technical Approach** — em 3-5 frases: componentes envolvidos, fluxo de dados, fronteira de integração. Derivar stack da spec; se spec não especifica, escolher stack mínima e documentar o raciocínio.
- **Architecture Decisions** — pelo menos 1 decisão com alternativa rejeitada
- **Phase -1 Gates** (checklist — aplicar enforcement):
  - **Simplicity Gate**: contar novos projetos/libs propostos. Se >3 → deixar gate `[ ]` e documentar em Complexity Tracking com referência ao AC que justifica
  - **Anti-Abstraction Gate**: se plan propõe wrapper layer não referenciada em nenhum AC → deixar gate `[ ]` e documentar
  - **Integration-First Gate**: se tests usam mocks para DB/services onde real é viável → deixar gate `[ ]` e documentar

  Gates com violação sem rationale válida = **BLOQUEIO**: não marcar plan como aprovado, exibir warning ao usuário.

- **Complexity Tracking** — preencher apenas se algum gate foi violado
- **Dependencies** — pacotes/serviços necessários, versões quando conhecidas

### 5. Gerar `{specDir}/tasks.md`

Instanciar `~/.claude/templates/tasks.md`. Regras de geração:

**Regra crítica de cobertura:** Todo AC-XX na spec DEVE ter ≥1 task em tasks.md com `[SPEC:AC-XX]`. Ao terminar, fazer contagem de cobertura: `ACs cobertos / total ACs`. Se < 100%, adicionar tasks faltantes antes de finalizar.

**Regra de ordenação TDD (Article III):** Todo contract em `contracts/` DEVE ter uma task de contract-test ANTES de qualquer task de implementação que use esse contract. Nunca inverter essa ordem.

**Estrutura de tasks:**
- **T-01 — Foundation** `[FOUNDATION]`: scaffold, instalação de deps, config base. Bloqueia todos os outros.
- **Wave 1 — Contract Tests**: uma task por contract file, todas marcadas `[P]`, dependem de T-01. Marcadas `[CONTRACT:filename]`.
- **Wave 2 — Implementação**: uma task por AC, todas marcadas `[P]`, dependem das tasks de Wave 1. Cada task inclui "implementar + adicionar integration test `// @spec AC-XX`".
- **Wave 3 — Integração**: wiring, entry point, smoke test.

**Não criar tasks para**: refatoração especulativa, features não cobertas por ACs, melhorias "would be nice".

### 6. Gerar artefatos opcionais

**`{specDir}/research.md`** — criar APENAS se a spec contém algum requisito técnico não-trivial que exige investigação antes de implementar (ex: "Como integrar com API X que não tem SDK?", "Qual abordagem de auth é compatível com o stack?"). Se não há necessidade de investigação, não criar.

**`{specDir}/quickstart.md`** — criar SEMPRE. Conteúdo: passos manuais para validar a feature após implementação. Incluir:
- Como iniciar o ambiente local
- Sequência de ações para exercitar cada AC
- O que observar para confirmar que cada AC passou
- Como reverter/limpar após teste

### 7. Verificação pós-geração

Antes de reportar conclusão, verificar:

```bash
# Contar contracts criados
ls "$SPEC_DIR/contracts/" | wc -l

# Verificar que tasks.md existe
test -f "$SPEC_DIR/tasks.md" && echo "tasks.md ok"

# Verificar que plan.md existe
test -f "$SPEC_DIR/plan.md" && echo "plan.md ok"
```

Fazer verificação manual de cobertura: contar AC-XX no spec.md, contar tasks com `[SPEC:AC-XX]` em tasks.md, calcular `cobertura = tasks_com_ref / total_acs * 100`.

Se cobertura < 100%: **abortar**, adicionar tasks faltantes, repetir verificação.

### 8. Exibir summary

Apresentar ao usuário:

```
## /plan-sdd — Concluído

**Spec lida:** {specDir}/spec.md
**Feature:** {feature title} ({feature-id})

### Artefatos gerados
- plan.md ............... {specDir}/plan.md
- contracts/ ............ {N} contract(s): {lista de nomes}
- tasks.md .............. {specDir}/tasks.md ({total} tasks: T-01 foundation + {W1} contract tests + {W2} impl + {W3} integration)
- quickstart.md ......... {specDir}/quickstart.md
{- research.md ........... {specDir}/research.md  ← incluir só se criado}

### Cobertura de ACs
{ACs cobertos}/{total ACs} — {porcentagem}%

### Phase -1 Gates
{Simplicity Gate: ✅ PASS | ⚠️  WARN — ver Complexity Tracking}
{Anti-Abstraction Gate: ✅ PASS | ⚠️  WARN — ver Complexity Tracking}
{Integration-First Gate: ✅ PASS | ⚠️  WARN — ver Complexity Tracking}

### Próximo passo
Revisar artefatos e aprovar via:
  touch /tmp/soma-spec-approved-{runId}
Após aprovação, prosseguir com Step 2 TASKS (task setup + teammates nomeados via Agent name: ou /dispatch).
```

---

## Regras de ouro

- **Spec é source of truth.** Plan serve à spec — nunca o inverso. Se há conflito entre o que a spec diz e o que parece tecnicamente melhor, o plano documenta a decisão, não altera a spec.
- **Zero abstraction especulativa.** Wrapper layers, helpers genéricos e "infraestrutura que pode ser útil depois" são proibidos a menos que um AC exija explicitamente.
- **Contract tests antes de tudo.** Nenhuma task de implementação começa antes das tasks de contract test correspondentes (Article III).
- **Cobertura 100% antes de terminar.** Cada AC deve ter ao menos uma task. Não finalizar com coverage < 100%.
- **Falhas são visíveis.** Se qualquer gate falha, exibir o problema claramente antes de prosseguir. Silenciar violações é a exata forma de falha que esta estrutura existe para prevenir.
