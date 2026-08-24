# Spec: Orquestração eficiente

**Feature ID:** 025-efficient-orchestration-budget  
**Status:** APPROVED — decisão do usuário em 2026-08-24

## Problema

O SOMA preserva rastreabilidade, mas hoje permite multiplicar agentes, revisões e correções sem ganho proporcional de confiança. O caminho observado no Track R chegou a uma terceira tentativa de tooling e continuou abrindo novas superfícies de validação. Foi eficaz, mas não eficiente.

O defeito não é falta de ledger: `soma run dispatch-record` já preserva prompt, output, metadata e tentativas. Falta um envelope que limite o trabalho antes do dispatch e encerre recursão improdutiva.

## Resultado

Para cada unidade de trabalho, o orquestrador usa o menor caminho que mantém SDD, TDD, separação de papéis e retomada durável:

1. um executor;
2. validação determinística focada;
3. uma auditoria integrada, com segundo revisor apenas quando houver uma dimensão de risco independente;
4. no máximo uma onda de correção e uma revalidação;
5. se ainda houver blocker, `PAUSED_DIAGNOSTIC` com handoff durável — nunca uma cadeia a3/a4/a5.

O orquestrador coordena e decide; não implementa código de aplicação. Cada agente recebe contrato fechado, trabalha em isolamento e deixa o rastro no `dispatch-record` existente.

## Decisões normativas

### D-025-01 — Eficiência é gate próprio

Uma entrega pode ser correta e ainda violar o workflow por usar agentes, contexto ou rodadas além do envelope. Eficácia e eficiência são avaliadas separadamente no sumário da run.

### D-025-02 — Proxies determinísticos

O SOMA não tenta contar tokens do provedor. Mede UTF-8 bytes, tentativas, agentes, ondas de correção e execuções da suíte completa. Esses valores são reproduzíveis entre Claude, Codex e futuras integrações.

### D-025-03 — Envelope padrão

| Dimensão | Limite |
|---|---:|
| prompt exato de um dispatch | 8.000 bytes |
| retorno conversacional do agente | 4.000 bytes |
| tentativas por task | 2 (inicial + uma correção) |
| executores simultâneos por task | 1 |
| revisores por candidato | 1 por padrão; 2 no máximo |
| ondas de correção | 1 |
| auditorias do mesmo candidato | 1 inicial + 1 final |

Se um prompt não cabe, a task deve ser reduzida ou as fontes informativas devem virar referências. Restrições bloqueantes não podem ser truncadas: overflow bloqueia o dispatch.

O retorno conversacional contém apenas status, commit/artefato, provas executadas e blockers. Logs e findings detalhados ficam em arquivos referenciados no retorno.

### D-025-04 — Registro antes de conversa

Todo `Agent` executado por `soma-run` exige:

- `dispatch-record begin` antes do spawn, com o prompt exato;
- `dispatch-record end` antes da transição, com output e metadata;
- tentativa anterior preservada;
- nenhum heartbeat textual. Atualizações ao usuário só em início, gate humano, blocker, mudança de fronteira ou conclusão.

### D-025-05 — Auditoria proporcional

Checks determinísticos rodam primeiro. Um único revisor integrado cobre arquitetura, testes, configuração e aderência à spec. Um segundo revisor só é permitido quando o plano nomeia uma dimensão independente que o primeiro não cobre. Os dois leem o mesmo commit imutável e rodam em paralelo.

### D-025-06 — Stop eficiente

Após uma correção, qualquer blocker residual encerra a unidade em `PAUSED_DIAGNOSTIC`. O handoff registra candidato, provas, finding residual e próxima decisão. Trocar modelo ou criar nova tentativa automática é proibido.

### D-025-07 — Suítes proporcionais

Testes focados rodam durante RED/GREEN e correção. A suíte completa roda no baseline quando barato ou necessário para distinguir regressão preexistente, e uma vez no gate final. Repeti-la sem mudança relevante de código é desperdício e deve ser evitado.

## Acceptance Criteria

### AC-01: Dispatch acima do orçamento falha antes de gravar

Given um prompt com mais de 8.000 bytes ou `attempt > 2`  
When `soma run dispatch-record begin` é chamado  
Then retorna exit 2 com causa legível e não cria nem altera artefato da tentativa.

### AC-02: Retorno acima do orçamento falha sem estado parcial

Given um output com mais de 4.000 bytes  
When `soma run dispatch-record end` é chamado  
Then retorna exit 2 e não grava `output.md` nem `metadata.json`.

### AC-03: Limites exatos são aceitos

Given prompt de 8.000 bytes, output de 4.000 bytes e tentativa 2  
When begin/end são executados  
Then os três artefatos são preservados normalmente.

### AC-04: O protocolo Claude torna o rastro obrigatório

Given qualquer step que despacha agente  
When o `soma-run` descreve a operação  
Then ele exige begin antes do spawn, end antes da transição e retorno curto com detalhes em arquivo.

### AC-05: Uma correção residual encerra a recursão

Given um candidato já corrigido uma vez  
When a revalidação ainda encontra blocker  
Then o workflow transita para `PAUSED_DIAGNOSTIC`, sem escalation ou novo agente automático.

### AC-06: SONAR usa no máximo dois revisores

Given um candidato pronto para auditoria  
When STEP_8 roda  
Then checks determinísticos antecedem uma auditoria integrada; um segundo revisor exige risco independente declarado, e não há fan-out fixo de cinco agentes.

### AC-07: Codex e Claude recebem a mesma regra operacional

Given a fonte canônica `core/docs/soma-stsd.md` e o comando Claude  
When os adapters são instalados  
Then ambos declaram orçamento, rastro obrigatório, uma correção e stop eficiente sem criar ledger paralelo.

## Fora de escopo

- Contabilidade financeira por provedor ou tokenizer.
- Novo event store, schema de continuidade ou substituto para P1–P6.
- Resolver a completude de contexto da spec 022/P4.
- Reescrever toda a máquina de estados do SOMA.

## Prova de não-complexidade

Esta feature altera o protocolo canônico e o produtor existente do dispatch. Não adiciona comando, daemon, banco, dependência ou formato de persistência.
