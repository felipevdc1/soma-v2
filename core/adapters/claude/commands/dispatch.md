Gere um prompt de dispatch estruturado para um agente Sonnet, baseado no plano ativo.

O argumento passado é o nome ou descrição da task a despachar. Se nenhum argumento foi passado, liste as tasks pendentes (checkboxes `- [ ]`) do plano ativo e pergunte qual despachar.

## Passos

### 1. Localize o plano ativo

Procure o plano da sessão atual em `~/.claude/plans/`. Se não encontrar, pergunte ao usuário.

### 2. Identifique a task

- Se argumento fornecido → encontre o checkbox mais relevante no plano
- Se sem argumento → liste todos os `- [ ]` pendentes e pergunte qual

### 3. Extraia o contexto do plano

Leia o plano e extraia:
- **Contexto geral**: seção de Context ou descrição do projeto
- **Arquivos envolvidos**: qualquer path mencionado na task ou seção de arquivos
- **Critérios de aceitação**: o texto do checkbox + checkboxes relacionados
- **Stack/tecnologias**: se mencionados no plano

### 4. Monte o prompt estruturado

Use este formato EXATO (baseado no SOMA Orchestrator Template):

```
## sonnet-[nome-curto] — [Título da Task]

### CONTEXT
[2-3 frases extraídas do plano: o que existe, o que foi feito, o que falta]

### TASK
[1-3 frases: O QUE fazer, não COMO. Extraído do checkbox e contexto ao redor]

### FILES TO MODIFY
- [path/to/file1.ext]
- [path/to/file2.ext]

### DONE WHEN
- [ ] [Critério 1 — extraído do checkbox original]
- [ ] [Critério 2 — se houver sub-items]
- [ ] Tests pass
- [ ] Build succeeds

### RULES
- ZERO deletion of existing code — wire, document, disable. Never remove.
- Follow existing patterns and design system
- Report: files changed + evidence of completion
- If blocked, STOP and ask — don't guess
```

### 5. Apresente o resultado

Mostre o prompt formatado E o comando Agent() pronto pra executar:

```
Agent({
  model: 'sonnet',
  prompt: `[prompt completo aqui]`
})
```

## Regras

- NUNCA invente contexto que não está no plano — extraia literalmente
- Se o plano não tem informação suficiente, diga o que falta
- O prompt deve ser auto-contido — o agente não deve precisar ler outros arquivos pra entender a task
- Mantenha o prompt under 500 tokens (lean prompt, como o Brunão ensina)
- Se a task é complexa demais pra um agente → sugira decompor em sub-tasks
- Todo output em português do Brasil (exceto o template que é em inglês por convenção técnica)
