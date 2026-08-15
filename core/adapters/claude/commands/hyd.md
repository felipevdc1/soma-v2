Aplique o protocolo HYD (How Would You Do) para prevenir depth decay antes de qualquer planejamento ou implementação.

O argumento passado com o comando é a descrição da tarefa. Se nenhum argumento foi passado, pergunte ao usuário o que ele quer fazer.

## Passos

### 1. Identifique o tipo de tarefa

`ui` · `api` · `refactor` · `bugfix` · `infra` · `skill` (skills, hooks, commands) · `general`

### 2. Avalie a complexidade

- **Trivial** (renomear variável, typo, ajuste pontual): 2-3 dimensões
- **Médio** (novo componente, endpoint simples): 4-6 dimensões
- **Complexo** (feature completa, migração, sistema novo): todas as relevantes

Complexidade escala o checklist. Não liste dimensões mecanicamente.

### 3. Liste as dimensões de qualidade aplicáveis

Use a tabela como **cardápio, não como checklist**. Escolha só o que se aplica a ESTA tarefa e reescreva cada item contextualizado — a lista genérica é ponto de partida, nunca a saída.

| Tipo | Dimensões |
|---|---|
| **ui** | funcionalidade completa (qual operação CRUD?) · estados (loading/error/empty/success/disabled) · validação · design system (tokens, tipografia, espaçamento) · responsividade · acessibilidade (teclado, leitor de tela, contraste, ARIA) · navegação (como entra e sai da tela?) · feedback visual (toast, confirmação, undo) |
| **api** | endpoints completos (todos os verbos) · validação de input · autenticação e autorização · error handling (códigos, mensagens, edge cases) · rate limiting · paginação e filtros · testes (unit + integration) · documentação (OpenAPI) |
| **refactor** | preservação de comportamento (zero mudança funcional) · cobertura de testes antes e depois · performance não degrada · backward compatibility · migration path se breaking · remoção de dead code |
| **bugfix** | reprodução (steps claros) · root cause, não sintoma · fix mínimo e focado · teste de regressão · edge cases relacionados · o fix não quebra outra coisa |
| **infra** | segurança (secrets, permissions, exposição) · plano de rollback · monitoramento e alertas · logging · scaling · documentação |
| **skill** | edge cases (input vazio/inválido, arquivo ausente) · fail-open (nunca travar o sistema no erro) · rate limiting (não spammar) · integração com hooks/skills existentes · como testar manualmente · documentação inline |
| **general** | escopo claro (dentro e fora) · dependências (o que precisa existir antes) · resultado verificável (como saber que funcionou) · reversibilidade (dá pra desfazer?) |

### 4. Tese e pressure-test

*(As dimensões dizem COMO fazer bem. Este passo pergunta se a abordagem está CERTA — sem ele o HYD vira checklist bonito em cima de premissa errada.)*

**4a. Declare a tese** em uma frase: qual abordagem você vai seguir, e por quê essa e não outra.

**4b. Pontue a tese** nos critérios abaixo. Cada um recebe `strong | adequate | weak | unknown` **e uma linha de justificativa concreta** — sem justificativa, a nota não vale.

| Critério | Pergunta |
|---|---|
| Entendimento do estado atual | Eu li o código/arquivo/sistema que vou mexer, ou estou inferindo? |
| Clareza do resultado | Sei descrever o comportamento observável que prova que funcionou? |
| Blast radius | Sei o que quebra se isto der errado, e quem depende disso? |
| Reversibilidade | Dá pra desfazer? Em quantos passos? |
| Evidência da abordagem | O que sustenta que ESTA é a abordagem certa — precedente, teste, doc, ou só intuição? |
| Custo de estar errado | Se a tese furar, perco minutos, horas, ou confiança? |

**4c. Regra dura de evidência** — se QUALQUER critério ficou `weak` ou `unknown`, **é proibido seguir direto pro plano**. A saída obrigatória vira *"preciso verificar X antes"*, com a verificação nomeada. Verificar é quase sempre mais barato que refazer. Só depois de subir a nota o item destrava.

**4d. Nomeie 1 falsificador**: "o que eu veria acontecer se esta abordagem estivesse errada?" Se não existe observação capaz de refutar a tese, ela não é tese — é torcida.

**4e. Separe o que você sabe** em três baldes, explicitamente rotulados:
- **Fato verificado** — eu li / rodei / testei nesta sessão
- **Inferência** — deduzi de algo que verifiquei
- **Hipótese** — acho, mas não checei

Qualquer coisa no balde *hipótese* que sustente a tese é candidata automática à verificação do 4c.

### 5. Monte o reframe

Apresente neste formato exato:

---

## HYD Reframe: [Descrição da Tarefa]

**Tipo**: [ui|api|refactor|bugfix|infra|skill|general] · **Complexidade**: [trivial|médio|complexo]

### Tese
[uma frase: a abordagem, e por que essa]

### Pressure-test

| Critério | Nota | Justificativa |
|---|---|---|
| Entendimento do estado atual | strong/adequate/weak/unknown | ... |
| Clareza do resultado | ... | ... |
| Blast radius | ... | ... |
| Reversibilidade | ... | ... |
| Evidência da abordagem | ... | ... |
| Custo de estar errado | ... | ... |

**Falsificador**: [o que eu veria se a tese estivesse errada]

**Baldes**: Fato verificado — [...] · Inferência — [...] · Hipótese — [...]

**Veredito**: `seguir` | `verificar antes` — [se "verificar antes": o que verificar, e como]

### Dimensões de Qualidade

Como eu faria [tarefa resumida] garantindo:

- [ ] [Dimensão 1 — específica desta tarefa, não genérica]
- [ ] [Dimensão 2 — específica desta tarefa]
(continuar para todas as relevantes)

### Próximo Passo
[Se veredito = `verificar antes`: a verificação nomeada. Se `seguir`: usar as dimensões como base do plano.]

---

### 6. Regras de ouro

- Cada checkbox deve ser **verificável objetivamente** (sim/não, não "verificar se está ok")
- Dimensões **contextualizadas** — não copie a tabela, adapte
- Dimensão que claramente não se aplica: **não inclua**
- O output é **insumo para o plano**, não o plano
- Nota `weak`/`unknown` sem verificação nomeada é violação do passo 4c
- Todo output em **português do Brasil**

### 7. Marcar execução do /hyd

Após apresentar o reframe, crie o marker de evidência desta sessão rodando via Bash:

```bash
touch "/tmp/claude-hyd-${CLAUDE_SESSION_ID:-$CK_SESSION_ID}.marker"
```

Isso desbloqueia edits subsequentes e silencia lembretes do hyd-gate. O marker morre junto com a sessão.
