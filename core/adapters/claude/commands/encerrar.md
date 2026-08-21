Encerre esta sessão de forma organizada. Siga EXATAMENTE estes passos:

---

## Prerequisites

Este command **requer mempalace MCP server** (diary + knowledge graph).

**Antes de executar qualquer step**, verifique se as tools `mempalace_diary_write` e `mempalace_kg_add` estão disponíveis nesta sessão. Se NÃO estiverem:

> "Este command requer o mempalace MCP server (diary + knowledge graph), que ainda não é público. Se você não tem `~/.local/bin/mempalace` nem entry `mempalace` em `~/.claude.json` mcpServers → este command não pode ser executado. Abortando."

**PARE imediatamente**. Não execute nenhum step. Não tente workaround.

---

0. **Verifique se há trabalho aberto** antes de encerrar. Sinais a detectar:
   - Tasks em `in_progress` no TaskList, OU
   - Mudanças não commitadas em repositório ativo, OU
   - Itens de plano não marcados como concluídos, OU
   - Trabalho claramente mencionado na sessão que não foi concluído
   - Se nenhum sinal detectado → pule este passo e vá direto ao passo 1.
   - Se algum sinal detectado → pergunte ao usuário (em pt-br): `"Tem trabalho aberto. Criar handoff file pra próxima sessão? [Y/n]"`
     - Resposta Y ou vazia (padrão) → execute `/handoff` primeiro, depois continue nos passos 1-3.
     - Resposta n → pule e vá direto ao passo 1.

1. **Escreva um diary entry no mempalace** usando `mempalace_diary_write` com:
   - `agent_name`: "claude"
   - `entry`: Um resumo em texto natural da sessão contendo: o que fizemos, decisões tomadas, bugs encontrados, e próximos passos recomendados. Seja específico — nomes de arquivos, projetos, tecnologias.
   - `topic`: o nome do projeto principal da sessão (ou "general" se não houver projeto específico)

2. **Salve fatos novos no Knowledge Graph** se houver decisões ou mudanças relevantes:
   - Novos deploys: `mempalace_kg_add(projeto, "deployed_at", destino, valid_from="YYYY-MM-DD")`
   - Mudanças de stack: `mempalace_kg_add(projeto, "uses_stack", tecnologia)`
   - Decisões: `mempalace_kg_add("the user", "decided", decisão)`
   - Se algo mudou: `mempalace_kg_invalidate` no fato antigo primeiro

3. **Confirme** com uma mensagem curta: "Diary salvo. Pode dar /exit."

NÃO peça confirmação antes de salvar. NÃO faça resumo longo. Seja direto.
