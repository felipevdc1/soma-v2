# Spec: Os gates que não pegam — lacunas medidas em campo

**Feature ID:** 019-gates-que-nao-pegam
**Branch:** `feature/019-gates-que-nao-pegam`
**Created:** 2026-08-19
**Status:** DRAFT

> **Origem:** sessão do projeto `hermes` em 2026-08-19 (~12 h). O orquestrador produziu **13 defeitos
> próprios** e, sobre artefatos que o **próprio validador do SOMA aprovou** com `100% cobertura · 0 ACs
> órfãos · 0 violações de ordem`, três auditorias adversariais acharam **15 defeitos adicionais** — um
> crítico de segurança. Nenhum deles foi erro de conhecimento; todos passaram por baixo de algum gate.
>
> **Este spec não é sobre o Hermes.** É sobre o que o SOMA deixou passar. Cada lacuna abaixo tem o
> incidente concreto que a revelou e a verificação que a confirma. Nada aqui é hipótese de melhoria:
> é defeito observado, com data.

---

## Estado empírico (Discover Before Specify)

Verificado em 2026-08-19 contra `soma-v2` e `~/.claude/`:

| lacuna | onde vive hoje | confirmada por |
|---|---|---|
⚠️ **Nota de proveniência acrescentada em 2026-08-21 pela spec 018 (T-04), sem alterar nenhum achado desta spec.**

Os caminhos `commands/plan-sdd.md` e `commands/specify.md` citados na tabela abaixo referem-se às cópias que viviam na **raiz do repositório**. Elas **não existem mais**: a T-04 da spec 018 consolidou os comandos num lugar só (AC-11), movendo os 6 órfãos e removendo os 5 duplicados stale da raiz. Recuperáveis por `git show 295dc2f:commands/plan-sdd.md`.

🔴 **Não reponte estes caminhos para `core/adapters/claude/commands/` sem re-verificar.** As duas cópias **divergiam** — `plan-sdd.md` em **43** linhas e `specify.md` em **42**, medido em 2026-08-21. Os achados G1, G5 e G9 foram medidos contra a cópia da **raiz**; repontar sem medir de novo faria esta spec afirmar sobre um arquivo que ela nunca examinou. **Antes de agir sobre eles, reproduza a medição contra o adapter, que é agora o canônico.**

| G1 precondição vs template | `commands/plan-sdd.md` §1 × `templates/spec.md:100` | grep — o template contém a string que a precondição aborta |
| G2 AC com sufixo invisível | `hooks/spec-test-traceability.cjs:51`, `soma-run.md:107` | regex `AC-\d+:` não casa `AC-01b:` |
| G3 cobertura mede referência | `core/scripts/lib/spec-lint/context.cjs:114` | `[SPEC:AC-XX]` conta presença, não adequação |
| G4 SONAR tarde demais | `soma-run.md` §11 (STEP_8, pós-waves) | leitura da máquina de estados |
| G5 sem porta de entrada pra trabalho existente | `commands/specify.md` | não há modo "adotar plano em andamento" |
| G6 decisão em formato errado é invisível | parser do projeto consumidor | 2 decisões escritas e não parseadas |
| G7 canônico pode se contradizer | — | `DECISOES.md` afirmava A e não-A |
| G8 sem exigência de proveniência | `templates/spec.md`, `templates/plan.md` | — |
| G9 comando não exercitado | `commands/plan-sdd.md` §5 | 3 defeitos graves de comando num tasks.md |
| G10 agente encerrado segue notificando | runtime | 4 ocorrências numa sessão |

---

## User Stories

- Como orquestrador, quero que o gate **recuse** o que ele hoje aprova em silêncio, pra eu parar de
  descobrir defeito só quando um subordinado tenta executar minha instrução.
- Como Felipe, quero que trabalho que **já começou fora do SOMA** possa ser adotado por ele, pra eu não
  ter que escolher entre governança e continuidade.
- Como qualquer sessão futura, quero que "100%" signifique **evidência adequada**, não referência
  presente, pra que o número não me dê confiança que ele não sustenta.

---

## Outcome & Guardrails

**OUTCOME** — rodar o pipeline sobre um conjunto de artefatos com os defeitos deste incidente plantados,
e ver o SOMA **recusar** cada um, nomeando qual. Hoje ele aprova todos.

**APPETITE** — os gates baratos (G1, G2, G6) valem uma sessão. G3 e G4 mudam a máquina de estados e
merecem spec própria se crescerem. Se estourar, corta G5 e G10 primeiro.

**NO-GOS**
- Não transformar o SOMA em ferramenta de auditoria genérica: o alvo são os artefatos que ele mesmo gera.
- Não adicionar gate que só sabe dizer "ok" — todo gate novo nasce com caso conhecido-ruim que o dispara.
- Não mexer no regex `AC-\d+` em si: a spec 016 já investigou e concluiu que ele **está correto**. A
  lacuna é a ausência de lint para o que *parece* AC e não casa.

---

## Acceptance Criteria

### AC-01: IF o spec estiver corretamente preenchido a partir do template oficial, THEN the sistema SHALL prosseguir para o plano

Given `templates/spec.md:100`, que contém a linha literal ``- [ ] Zero `[NEEDS CLARIFICATION]` markers
remaining`` no Completeness Checklist, e a precondição do `/plan-sdd` que aborta com
`grep -c "\[NEEDS CLARIFICATION"` / When uma spec sem nenhuma pergunta em aberto é submetida / Then o
pipeline avança. **Hoje ele aborta**: o template dispara o próprio gate, e toda spec bem preenchida
falha na precondição. Medido em 2026-08-19: precondição acusou `1` marker numa spec com zero perguntas.

### AC-02: WHEN um heading se parecer com um critério de aceite mas não casar a forma canônica, the sistema SHALL recusar

Given `hooks/spec-test-traceability.cjs:51` (`/^\s*#{0,6}\s*-?\s*\*{0,2}(AC-\d+)\*{0,2}:/`) e
`soma-run.md:107` (`^### AC-\d+:`) / When a spec contém `### AC-01b: ...` / Then o lint acusa. **Hoje é
silêncio**: o critério fica sem lint, sem cobertura e sem teste, e nada avisa. Ocorreu em 2026-08-19,
**uma hora depois** de o orquestrador citar em voz alta esse exato defeito da spec 016.

### AC-03: The sistema SHALL recusar rastreabilidade em que a task referenciada não possa provar o AC

Given uma task cuja asserção declarada é **falhar** (fase RED do TDD) / When ela é a única referência de
um AC que exige comportamento observável em produção / Then a cobertura **não** conta esse AC como
coberto. Medido: `AC-15` ("o servidor sobe de fato") mapeado a `T-02`, cuja própria condição de parada é
*"parar se o teste passar"*. Cobertura reportou **100%**.

### AC-04: The sistema SHALL submeter artefatos normativos a leitura adversarial antes do gate de aprovação

Given que hoje o SONAR roda em `STEP_8`, **depois** das waves / When spec, plano, tasks e contratos
ficam prontos / Then a auditoria adversarial roda **antes** do Gate 1. Evidência: em 2026-08-19, três
lentes adversariais sobre artefatos pré-implementação acharam **15 defeitos** — 3 graves de comando
(imagem construída na máquina errada, build context resolvido pelo diretório do arquivo e não pelo `cd`,
três tasks que verificam sem instalar) e 1 crítico de segurança (a trava central do projeto ausente do
spec que introduzia o risco). Zero desses defeitos foi achado pelo autor.

### AC-05: WHEN uma decisão for registrada num arquivo com parser próprio, the sistema SHALL confirmar que o parser a enxerga

Given um projeto cujo `DECISOES.md` é lido por parser dedicado / When uma decisão nova é escrita / Then
o registro só é dado por concluído se o parser a retorna. Medido: duas decisões escritas em
2026-08-19 (`### D-H78`, `### D-H79`) num formato que o parser não reconhece — **existiam no arquivo e
não no sistema** — descobertas só porque uma contagem contradisse um número conhecido.

### AC-06: The sistema SHALL acusar afirmações mutuamente contraditórias dentro de um mesmo arquivo canônico

Given `docs/DECISOES.md` do projeto hermes, que afirmava simultaneamente *"o reboot foi o teste de
persistência, e passou: regras `DOCKER-USER` carregadas"* e *"**Aberto**: nenhuma das 5 regras do
`DOCKER-USER` persiste em reboot"* / When o arquivo é validado / Then a contradição é sinalizada. Ficou
mais de um dia no arquivo canônico sem ninguém notar; foi achada de raspão por uma auditoria de outro
assunto.

### AC-07: The sistema SHALL exigir proveniência declarada para afirmação factual em documento normativo

Given números, caminhos, flags, assinaturas e comportamentos de ferramenta citados em spec/plan/tasks /
When o documento é validado / Then cada afirmação carrega como foi obtida — medido, inferido ou herdado.
Evidência de que funciona: na sessão de 2026-08-19 o autor improvisou uma seção "superfície fixada" com
coluna *"medido por"*; a auditoria encontrou **zero** afirmações inventadas onde ela foi aplicada, e os
**dois** valores defeituosos eram exatamente os que ficaram **fora** dela.

### AC-08: WHEN o plano gerar tasks com comandos, the sistema SHALL exigir que cada comando tenha sido exercitado

Given que `/plan-sdd` hoje exige `[SPEC:AC-XX]` mas nada sobre executabilidade / When as tasks são
geradas / Then cada bloco de comando tem verificação de forma registrada (`bash -n`, `--help`,
`docker compose config`, dry-run) ou está marcado como não verificável e por quê. Evidência: três
defeitos graves de comando num único `tasks.md`, **todos** detectáveis por verificação read-only barata.

### AC-09: WHERE existir trabalho já em andamento fora do SOMA, the sistema SHALL oferecer adoção sem reespecificar o que já shippou

Given um plano em markdown com 8 fases, 6 já entregues / When o usuário quer trazê-lo para governança /
Then existe caminho que cobre o restante e **verifica** o entregue, sem `/specify` do zero. Hoje não
existe: o plano do hermes rodou fora do SOMA, o gate nunca engajou, e o desvio (instalação nativa contra
um plano que mandava container) só apareceu quando o usuário perguntou.

### AC-10: IF um agente já foi encerrado, THEN the sistema SHALL parar de emitir notificação de ociosidade em nome dele

Given agentes encerrados via `TaskStop` / When a sessão continua / Then não chegam mais notificações
deles. Medido: **4 notificações** de 2 agentes já encerrados em 2026-08-19, cada uma custando uma
verificação para confirmar que não era pedido real.

---

## Non-Functional Requirements

- **Performance:** todo gate novo roda em < 5 s sobre uma spec típica. Gate lento vira gate desligado.
- **Security:** o incidente crítico foi um spec que ligava ~995 mil mensagens de terceiros a um agente
  com terminal **sem** especificar a trava que a decisão canônica do projeto nomeia como a mitigação.
  Um gate de aderência a decisões travadas teria pego.
- **Test style:** cada gate novo nasce com **dois** testes — um caso conhecido-ruim que ele acusa e um
  conhecido-bom que ele deixa passar. Gate sem o segundo vira ruído; sem o primeiro, é cego.
- **Monitoring:** telemetria por gate — quantas vezes disparou, quantas foram falso-positivo.

## Out of Scope

- Consertar os defeitos do projeto `hermes`. Já foram corrigidos lá; aqui só interessa por que passaram.
- Reescrever o regex `AC-\d+` (spec 016 já concluiu que está correto).
- Auditoria adversarial de código de aplicação — o alvo são os artefatos normativos do próprio SOMA.

## Open Questions

- [NEEDS CLARIFICATION: AC-04 muda a máquina de estados — a auditoria pré-Gate 1 vira um estado novo
  (`STEP_1D_AUDIT`), ou vira parte do `STEP_1C_TASKS`? A primeira é mais explícita e mais cara.]
- [NEEDS CLARIFICATION: AC-03 exige distinguir task que *pode* provar um AC de task que não pode. Isso é
  decidível por heurística (task marcada RED não conta como prova de AC de comportamento) ou precisa de
  julgamento de agente?]
- [NEEDS CLARIFICATION: AC-05 e AC-06 pressupõem que o SOMA conheça o parser e o arquivo canônico do
  projeto consumidor. Isso é configuração por projeto (`manifest.json`) ou convenção fixa?]

## Completeness Checklist

- [x] Todo AC é testável (Given/When/Then, observável, sem HOW)
- [x] Nenhum detalhe de implementação vazou para os ACs
- [ ] Zero perguntas em aberto — **3 em aberto**
- [x] NFR com performance, segurança e estilo de teste
- [x] Out of Scope com ao menos uma entrada
- [x] Feature ID + Branch preenchidos
- [x] OUTCOME/APPETITE/NO-GOS preenchidos
