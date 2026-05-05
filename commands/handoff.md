Crie um handoff file estruturado para a sessão atual. Siga EXATAMENTE estes passos:

---

## Prerequisites

Este command **requer mempalace MCP server** (diary + knowledge graph).

**Antes de executar qualquer step**, verifique se as tools `mempalace_diary_write` e `mempalace_kg_add` estão disponíveis nesta sessão. Se NÃO estiverem:

> "Este command requer o mempalace MCP server (diary + knowledge graph), que ainda não é público. Se você não tem `~/.local/bin/mempalace` nem entry `mempalace` em `~/.claude.json` mcpServers → este command não pode ser executado. Abortando."

**PARE imediatamente**. Não execute nenhum step. Não tente workaround.

---

## Princípios do protocolo (leia antes de executar)

- **Resume prompts devem ser LITERAIS** — são as palavras exatas que o usuário vai digitar na próxima sessão. Não escreva descrições, escreva o prompt real. Exemplo correto: `"bora fazer npm publish do vault-mcp"`. Exemplo errado: `"Continuar com o publish do pacote"`.
- **Next steps devem ser ACIONÁVEIS** — commands shell, nomes de arquivos, chamadas de tool. Nunca vagueza como "configurar o ambiente" ou "verificar o estado".
- **Critical Context existe pra evitar re-decidir** — liste decisões já tomadas com reasoning curto. O próximo Claude não deve rediscutir o que já foi resolvido.

---

## Step 1 — Detectar projeto ativo

Execute no terminal:

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

- Se retornar um path de repo git → o nome do projeto é o basename desse path
- Se não houver git → use o nome do diretório atual (`basename $(pwd)`)
- Se o contexto da conversa deixar claro qual é o projeto → use esse nome
- Se ainda não for claro → pergunte ao usuário: "Qual é o nome do projeto desse handoff?"

---

## Step 2 — Gerar project-slug

A partir do nome do projeto:
- Converter pra lowercase
- Substituir espaços e underscores por hífens
- Remover caracteres especiais (manter apenas letras, números e hífens)

Exemplo: `Vault MCP` → `vault-mcp`, `my_project 2` → `my-project-2`

---

## Step 3 — Verificar se handoff já existe (guard obrigatório)

Antes de qualquer outra coisa, execute:

```bash
ls -la ~/.claude/plans/handoff-{project-slug}.md 2>/dev/null
```

Se o arquivo **já existir**:
- Mostre ao usuário: "Handoff para `{project}` já existe em `~/.claude/plans/handoff-{project-slug}.md` (criado em `{mtime}`). Sobrescrever? [y/N]"
- **Default é N**. Se o usuário não confirmar com "y" ou "sim" → PARE e informe que o handoff existente foi preservado.
- Só continue se o usuário confirmar explicitamente.

---

## Step 4 — Reunir contexto da sessão

Execute os comandos a seguir (dentro do diretório do projeto, se houver):

```bash
# Uncommitted changes
git status --short 2>/dev/null || echo "(sem repo git)"

# Commits recentes
git log --oneline -10 2>/dev/null || echo "(sem commits)"
```

Também verifique:
- Existe algum plan file ativo em `~/.claude/plans/`? (buscar por arquivos modificados recentemente que não sejam handoffs)
- Há tasks in_progress na conversa atual?
- Qual é o resumo do que foi feito nessa sessão?

### Branch de sessão longa (condicional)

Se a sessão atual parecer longa — qualquer um destes critérios: > 100 tool calls executados, ou > 300K tokens estimados no contexto, ou a conversa abrangeu múltiplas tarefas ou pivots significativos — ANTES de redigir o State Snapshot, escaneie explicitamente o histórico de tool calls buscando:

- **Arquivos escritos/editados**: liste os 10 mais recentemente tocados
- **Comandos relevantes**: busque por migrações, deploys, execuções de teste, builds
- **Decisões registradas**: diary entries ou KG writes feitos durante a sessão
- **Buckets implicitamente resolvidos vs. ainda abertos**: identifique o que foi concluído versus o que ficou em aberto

Isso previne que o State Snapshot reflita apenas o que está visível no context window atual. Sessões curtas pulam este branch inteiramente.

---

## Step 5 — Coletar buckets abertos do usuário

Apresente ao usuário o schema abaixo e peça que preencha um bloco por bucket aberto:

```
Preciso que você preencha cada bucket aberto nesse formato exato:

Bucket N:
  nome: <curto, 2-4 palavras>
  resume_prompt: "<palavras literais que você vai digitar na próxima sessão>"
  next_steps:
    1. <ação concreta com command/file/tool>
    2. <ação concreta>
    3. <ação concreta>
  success_criteria: <1 linha — como saber que terminou>
```

**Regras de coleta:**

- Se o usuário responder em free-text sem seguir o schema → re-apresente o schema completo e peça que preencha de novo. Não tente inferir os campos silenciosamente.
- Se o usuário não souber o `resume_prompt` de algum bucket → sugira um baseado no contexto da conversa, deixe explicitamente visível qual foi sugerido e peça confirmação explícita antes de gravar no arquivo.
- Valide que cada bucket possui os 4 campos preenchidos (`nome`, `resume_prompt`, `next_steps`, `success_criteria`) ANTES de avançar pro Step 6. Se faltar algum → re-pergunte especificamente o campo faltando, não o bucket inteiro.

---

## Step 6 — Preencher o template

Leia o template em `~/.claude/templates/handoff-template.md`.

Substitua cada placeholder com as informações coletadas nos steps anteriores:

| Placeholder | Valor |
|-------------|-------|
| `{project}` | Nome do projeto (legível, não slug) |
| `{date}` | Data atual no formato YYYY-MM-DD |
| `{session_description}` | Descrição curta do que foi feito nessa sessão |
| `{context_percent}` | Estimativa de contexto usado (se souber; se não, omita a linha) |
| State Snapshot | 1 parágrafo denso: o que tá vivo, funcionando e pendente |
| Cada bucket | Nome, resume prompt literal, next steps acionáveis, success criteria |
| Critical Context | Decisões técnicas, traps conhecidas, guardrails |
| Resume Commands | Comandos shell copy-paste pra retomar os principais buckets |
| `{path ou "none"}` em Session Chain | Path do handoff anterior, se existir; caso contrário "none" |
| `{summary}` em Session Chain | Resumo curto de quem criou e quando |
| Expires | Data atual + 14 dias |

Se alguma seção não se aplica (ex: não há traps conhecidas), mantenha o cabeçalho mas escreva "n/a" — não delete seções do template.

---

## Step 7 — Escrever o handoff file

Escreva o conteúdo preenchido em:

```
~/.claude/plans/handoff-{project-slug}.md
```

Após escrever, confirme com:

```bash
ls -la ~/.claude/plans/handoff-{project-slug}.md
```

---

## Step 8 — Persistência cross-session

Após confirmar que o arquivo foi criado com sucesso, execute as seguintes ações de persistência:

**8a. Diary entry no mempalace:**

Chame `mempalace_diary_write` com:
- `agent_name`: "claude"
- `entry`: "Handoff criado para {project} em ~/.claude/plans/handoff-{project-slug}.md. Buckets abertos: {lista de nomes dos buckets}. Resume prompt do Bucket A: '{resume prompt literal}'."
- `topic`: {project-slug}

**8b. Knowledge Graph:**

Chame `mempalace_kg_add` com:
- `subject`: {project} (nome legível)
- `predicate`: "handoff_active_at"
- `object`: `~/.claude/plans/handoff-{project-slug}.md`
- `valid_from`: data atual (formato YYYY-MM-DD)

Se já existia um fato `handoff_active_at` anterior para esse projeto, invalide-o primeiro com `mempalace_kg_invalidate`.

**8c. Atualizar MEMORY.md:**

Edite `${CLAUDE_HOME}/projects/memory/MEMORY.md`:
- Localize a seção `## Active Handoffs`
- Se ela não existir, crie-a após a última seção do arquivo
- Adicione (ou atualize) a linha:
  `- **{project}** → \`~/.claude/plans/handoff-{project-slug}.md\` — {descrição curta de 1 linha}`
- Se já havia uma linha para esse projeto, substitua pela nova

---

## Step 9 — Confirmar ao usuário

Ao final, mostre uma confirmação curta:

> "Handoff criado em `~/.claude/plans/handoff-{project-slug}.md`.
>
> Na próxima sessão, digite: `{resume prompt do Bucket A}` pra retomar."

Se houver múltiplos buckets, liste os resume prompts de todos.

---

## Notas de comportamento

- **Não peça confirmação antes de coletar contexto** — só pergunte sobre buckets (Step 5) e sobre sobrescrita (Step 3 se aplicável).
- **Não resuma a sessão no chat** — tudo vai pro handoff file.
- **Não execute os buckets** — apenas documente-os.
- **Não invente resume prompts** — se o usuário não souber, sugira e confirme antes de usar.
