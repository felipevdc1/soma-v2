Aplique o protocolo HYD (How Would You Do) para prevenir depth decay antes de qualquer planejamento ou implementação.

O argumento passado com o comando é a descrição da tarefa. Se nenhum argumento foi passado, pergunte ao usuário o que ele quer fazer.

## Passos

### 1. Identifique o tipo de tarefa

Classifique a tarefa em uma das categorias abaixo com base na descrição:

- `ui` — Frontend/UI (páginas, componentes, telas, estilos)
- `api` — Backend/API (endpoints, serviços, middleware, banco de dados)
- `refactor` — Reestruturação de código sem mudança de comportamento
- `bugfix` — Correção de bug ou problema específico
- `infra` — DevOps, deploy, configuração, CI/CD
- `skill` — Criação de skills, hooks ou commands do Claude Code
- `general` — Qualquer coisa que não se encaixa acima

### 2. Avalie a complexidade

Antes de listar dimensões, avalie:
- **Trivial** (renomear variável, fix de typo, ajuste de cor pontual): 2-3 dimensões relevantes
- **Médio** (novo componente, endpoint simples): 4-6 dimensões
- **Complexo** (feature completa, migração, sistema novo): todas as dimensões relevantes

Complexidade escala com o checklist. Não liste dimensões mecânicamente — liste apenas as que se aplicam ao contexto específico da tarefa.

### 3. Liste as dimensões de qualidade aplicáveis

Use como referência as dimensões por tipo. Filtre apenas as relevantes para ESTA tarefa específica.

**UI:**
- Funcionalidade completa (CRUD: qual operação se aplica aqui?)
- Estados da UI (loading, error, empty, success, disabled)
- Validação (client-side, formatos, limites de campo)
- Design system (tokens, componentes, tipografia, espaçamento)
- Responsividade (mobile, tablet, desktop)
- Acessibilidade (keyboard nav, screen reader, contraste, ARIA)
- Navegação (como o usuário chega e sai desta tela?)
- Feedback visual (toasts, confirmações, undo)

**API:**
- Endpoints completos (todos os verbos HTTP necessários)
- Validação de input (tipos, limites, formatos)
- Autenticação e autorização
- Error handling (códigos HTTP, mensagens, edge cases)
- Rate limiting e throttling
- Paginação e filtros
- Testes (unit, integration)
- Documentação (OpenAPI/Swagger)

**Refactor:**
- Preservação de comportamento (zero mudança funcional)
- Cobertura de testes (antes e depois)
- Performance (não degradar)
- Backward compatibility
- Migration path (se breaking change)
- Dead code removal

**Bugfix:**
- Reprodução do bug (steps to reproduce claros)
- Root cause analysis (não só o sintoma)
- Fix mínimo e focado
- Teste de regressão
- Edge cases relacionados
- Verificação de que o fix não quebra outra coisa

**Infra:**
- Segurança (secrets, permissions, exposure)
- Rollback plan
- Monitoramento e alertas
- Logging
- Scaling considerations
- Documentação

**Skill/Hook/Command:**
- Edge cases (input vazio, input inválido, arquivos ausentes)
- Fail-open (nunca travar o sistema em caso de erro)
- Rate limiting (não spammar o usuário)
- Integração com hooks/skills existentes
- Como testar manualmente
- Comentários e documentação inline

**General:**
- Escopo claro (o que está dentro e fora?)
- Dependências (o que precisa existir antes?)
- Resultado verificável (como saber que funcionou?)
- Reversibilidade (dá pra desfazer se der errado?)

### 4. Monte o reframe e o checklist

Apresente o resultado neste formato exato:

---

## HYD Reframe: [Descrição da Tarefa]

**Tipo**: [ui|api|refactor|bugfix|infra|skill|general]

### Dimensões de Qualidade

Como eu faria [tarefa resumida] garantindo:

- [ ] [Dimensão 1 — específica para esta tarefa, não genérica]
- [ ] [Dimensão 2 — específica para esta tarefa]
- [ ] [Dimensão 3 — específica para esta tarefa]
(continuar para todas as dimensões relevantes)

### Próximo Passo
Usar estas dimensões como base para o brainstorming e planejamento.
Cada item acima deve aparecer como checkbox verificável no plano final.

---

### 5. Regras de ouro

- Cada checkbox deve ser **verificável objetivamente** (sim/não, não "verificar se está ok")
- Dimensões devem ser **contextualizadas** para a tarefa — não copie a lista genérica, adapte
- Se uma dimensão claramente não se aplica, **não a inclua**
- O output é um **insumo para o plano**, não o plano em si
- Todo o output em **português do Brasil**

### 6. Marcar execução do /hyd

Após apresentar o reframe, crie o marker de evidência desta sessão rodando via Bash:

```bash
touch "/tmp/claude-hyd-${CLAUDE_SESSION_ID:-$CK_SESSION_ID}.marker"
```

Isso desbloqueia edits subsequentes e silencia lembretes do hyd-gate. O marker morre junto com a sessão.
