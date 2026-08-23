# Spec: Os gates cujo mecanismo ainda não foi decidido

**Feature ID:** 021-mecanismos-por-decidir
**Branch:** `feature/021-mecanismos-por-decidir`
**Created:** 2026-08-22
**Status:** DRAFT — **não é para executar.** Sete decisões de arquitetura em aberto, duas delas de segurança.

> **Origem:** extraída da spec 019 pela **D-019-05** em 2026-08-22. O critério do corte foi: fica na 019 o
> que tem **régua medida e espécime nomeado**; sai para cá o que tem **incidente real e mecanismo
> indefinido**.
>
> 🔴 **Nenhum destes ACs saiu por falta de mérito.** Cada um nomeia um defeito observado, medido e datado.
> Saíram porque um leitor adversarial em contexto isolado — encarregado de *derivar as tasks e
> implementar* — mostrou, para cada um, **duas ou mais leituras incompatíveis** que dois executores
> entregariam de formas diferentes. Especificar antes de executar é o ponto da 019 inteira; esta spec
> existe para não violá-lo.
>
> **A ordem de trabalho aqui é: decidir primeiro, especificar depois.** Cada AC abaixo está escrito como
> *incidente + o que falta decidir*, não como Given/When/Then pronto — porque escrever o Then antes da
> decisão seria inventar, que é exatamente o defeito catalogado.

---

## §0 Superfície fixada

Medições feitas em 2026-08-22 contra `origin/main` = `91c1b27`.

| valor | é | medido por |
|---|---|---|
| cópias completas de `STEP_ORDER` em código | **3**, sem fonte única | `gate.cjs:60-73`, `resume.cjs:63-76`, `run-resume.test.cjs:189-193` |
| pontos totais a tocar para inserir um step | **15** | 3 arrays + 4 comentários com adjacência/contagem + 13 headers a renumerar + 4 fixtures que quebram |
| eventos mapeados em `core/hooks/hooks.json` | **nenhum** — o conteúdo é `"_TODO_phase_6_4"` | `cat core/hooks/hooks.json` |
| ocorrências de `TaskStop` no repo | **1**, e em prosa | grep |
| comandos do adapter com modo de adoção | **0 de 13** | grep de vocabulário de adoção em `core/adapters/claude/commands/` |
| vocabulário de proveniência nos templates | **ausente** | `core/templates/spec.md`, `core/templates/plan.md` |
| as duas formas canônicas de heading de AC | **divergem** | `spec-test-traceability.cjs:51` × `soma-run.md:51`; `- **AC-01:**` casa só a primeira |

---

## Os seis mecanismos, e o que falta decidir em cada um

### M-01 — auditoria adversarial como estado próprio (`STEP_1D_AUDIT`)

**Incidente, medido:** em 2026-08-19, três lentes adversariais sobre artefatos pré-implementação acharam
**15 defeitos** — 3 graves de comando (imagem construída na máquina errada, build context resolvido pelo
diretório do arquivo e não pelo `cd`, três tasks que verificam sem instalar) e 1 crítico de segurança (a
trava central do projeto ausente do spec que introduzia o risco). **Zero deles foi achado pelo autor.**
Em 2026-08-22 o mesmo mecanismo, aplicado à spec 019, achou 35.

**Decisão já tomada (D-019-01, Felipe, 2026-08-22, permanece válida):** é estado próprio, não um passo
dentro do `STEP_1C_TASKS`, e não é opcional por tamanho. Estado separado força **ator** separado, e
produz **artefato** que o `soma run gate` pode exigir.

**O que falta decidir:**
1. **Nome, schema e caminho do artefato.** Sem isso, `"auditei"` volta a ser prosa no campo `notes`, que é
   o que o estado próprio existe para matar.
2. **Critério de aprovação.** O que faz o `STEP_1D` passar? Existir o relatório, ou o relatório não conter
   achado acima de um limiar?
3. **Semântica de bloqueio.** A D-019-01 diz que o gate *"pode exigir"* — permissivo. Um achado CRITICAL
   impede a transição para o Gate 1, ou só informa?
4. **Quantas lentes, quais, e com que modelo.** A medição de 2026-08-22 mostra que **um** leitor em
   contexto isolado achou o que **cinco** lentes adversariais não acharam. Isso sugere que a composição
   importa mais que o número, mas não está decidido.
5. **Fonte única de `STEP_ORDER`.** Inserir o estado custa 15 pontos de edição e **nenhum teste hoje
   acusa se algum for esquecido**. A decisão razoável é criar a fonte única *antes* de inserir o estado,
   mas isso é trabalho próprio e não está orçado.

### M-02 — confirmar que o parser de decisões do projeto enxerga a decisão

**Incidente, medido:** duas decisões escritas em 2026-08-19 (`### D-H78`, `### D-H79`) num formato que o
parser dedicado do projeto não reconhece — **existiam no arquivo e não no sistema**. Descobertas só porque
uma contagem contradisse um número conhecido.

**Decisão já tomada (D-019-03, Felipe, 2026-08-22, parcial):** é configuração por projeto, vive no
`.soma/` do projeto consumidor, e ausência de configuração faz o gate **recusar em voz alta**.

🔴 **O que falta decidir, e uma delas é de segurança:**
1. **Como o SOMA invoca o parser de outro projeto.** Confirmar que um parser de terceiro *enxerga* a
   decisão exige executar código desse projeto. Três formas, com superfícies de risco completamente
   diferentes: (a) a config carrega um comando de shell que o SOMA executa — **execução de código
   arbitrário a partir de arquivo de repositório possivelmente clonado**; (b) a config carrega um caminho
   de módulo que o SOMA faz `require` — mesmo risco, outra forma; (c) o SOMA não executa nada e exige que
   o autor cole a saída do parser — reduz o gate a checagem de presença de texto. **Nenhuma foi escolhida.**
2. **Nome do arquivo, formato e chaves.** `.soma/config.json`? `.soma/decisions.json`? Chaves
   `decisions_file`, `decisions_parser`, `parser_cmd`?
3. **Contradição interna da D-019-03.** O título diz *"RECUSAR em voz alta"* (bloqueia); o corpo diz que
   o gate *"diz, nomeando, que não rodou"* (avisa e segue). São exit codes opostos, e a segunda leitura é
   funcionalmente a alternativa (b) que a própria decisão rejeita, acrescida de um print. Como o
   `soma-v2` **não tem `.soma/`**, a escolha decide se o pipeline do próprio `soma-v2` fica travado.

### M-03 — acusar contradição dentro de um arquivo canônico

**Incidente, medido:** o `docs/DECISOES.md` do projeto hermes afirmava simultaneamente *"o reboot foi o
teste de persistência, e passou: regras `DOCKER-USER` carregadas"* e *"**Aberto**: nenhuma das 5 regras do
`DOCKER-USER` persiste em reboot"*. Ficou mais de um dia no arquivo canônico sem ninguém notar; foi achada
de raspão por uma auditoria de outro assunto.

**O que falta decidir:** **tudo do mecanismo.** A versão anterior deste AC nomeava a intenção e nenhum
observável — sem heurística, sem padrão léxico, sem algoritmo. Detectar contradição semântica em prosa
arbitrária é problema aberto. Medido: `grep -rln "contradi" core/scripts/lib/spec-lint/ core/hooks/` →
**nenhum resultado**; não existe mecanismo de detecção em lugar nenhum do codebase para o AC se apoiar.

Caminho plausível não decidido: restringir a contradições **estruturais e decidíveis** — por exemplo, o
mesmo identificador de decisão declarado com dois estados diferentes (`Aberto` e `Fechado`), ou o mesmo
`AC-NN` aparecendo duas vezes como chave numa tabela de cobertura, que é um defeito real já ocorrido na
spec 001 do hermes. Isso é muito menor que "contradição", e é mecanizável.

### M-04 — exigir proveniência declarada para afirmação factual

**Incidente, medido:** na sessão de 2026-08-19 o autor improvisou uma seção *"superfície fixada"* com
coluna *"medido por"*. A auditoria encontrou **zero** afirmações inventadas onde ela foi aplicada, e os
**dois** valores defeituosos eram exatamente os que ficaram **fora** dela.

🔴 **O que falta decidir, e a versão anterior errava aqui:** o Then dizia que cada afirmação *"carrega"*
como foi obtida — exigia a **presença** do rótulo, não a sua **veracidade**. Um gate que mede presença de
referência em vez de adequação é o próprio G3 que a spec 019 nomeia, uma camada acima. O AC reproduzia o
defeito que ele descrevia.

1. **Tabela ou anotação por frase?** A evidência que funcionou é uma **tabela** com coluna *"medido por"*.
   O Then anterior dizia *"cada afirmação"*. **Não são a mesma coisa**, e a própria evidência do AC
   registra que a tabela não fecha o buraco — os dois defeitos ficaram fora dela.
2. **Como uma ferramenta reconhece "afirmação factual" em prosa livre?** Números, caminhos, flags,
   assinaturas e comportamentos de ferramenta. Isso é reconhecimento de entidade em texto livre, sem
   critério declarado e com falso-positivo garantido.
3. **O que torna o rótulo verificável**, e não carimbo.

Caminho plausível não decidido, e barato: tornar obrigatória a seção `## §0 Superfície fixada` no
template, com colunas `valor | é | medido por`, e o gate verificar que ela existe e que **todo número que
aparece em prosa também aparece nela**. Isso é decidível e fecha justamente o buraco que a evidência
mediu. As specs 019, 020 e 021 já a adotaram voluntariamente.

### M-05 — adotar trabalho já em andamento fora do SOMA

**Incidente, medido:** o plano do hermes rodou fora do SOMA, o gate nunca engajou, e o desvio (instalação
nativa contra um plano que mandava container) só apareceu quando o usuário perguntou. Medido em
2026-08-22: **0 de 13** comandos do adapter têm qualquer modo de adoção; os únicos 2 hits de *"resume"* em
todo o adapter (`handoff.md`, `soma-run.md`) são resume de **sessão/máquina de estados**, não adoção de
plano pré-existente.

🔴 **O que falta decidir, e há um bloqueio estrutural:**
1. **A máquina de estados recusa entrada em step não-inicial.** O `gate.cjs` é construído sobre a ordem;
   adotar trabalho parcial significa entrar no meio. As duas saídas possíveis são ruins do jeito que
   estão: (a) **sintetizar histórico** — gravar reports `pass` para os steps já entregues fora do SOMA,
   o que faz o artefato **mentir sobre o que aconteceu**, que é a família de defeito que a 019 ataca;
   (b) **run nova de escopo reduzido**, que cobre só o que falta e **descarta** a cláusula
   *"verifica o entregue"*, que era metade do valor.
2. **O nome do verbo.** Os 11 verbos hoje são `bootstrap`/`init`/`install`/`doctor`/`sync`/`rollback`/
   `manifest`/`module`/`audit`/`run`/`spec-lint`. `adopt` não existe, e `init` já significa outra coisa.
3. **O que "verifica o entregue" quer dizer** — verifica contra o quê, com que critério de aprovação.

### M-06 — parar de notificar em nome de agente encerrado

**Incidente, medido:** 4 notificações de 2 agentes já encerrados via `TaskStop`, numa sessão de
2026-08-19, cada uma custando uma verificação para confirmar que não era pedido real.

🔴 **O que falta decidir — e este é o único cuja viabilidade está em dúvida:**
Medido: **quem emite a notificação de ociosidade é o runtime do harness, não o SOMA.** O
`core/hooks/hooks.json` mapeia literalmente `"_TODO_phase_6_4"` — **nenhum evento**. Não há, no repo,
código que emita notificação, nem hook registrado em evento de notificação. `TaskStop` aparece **uma
vez**, em prosa. O único hook de ciclo de vida de subagente é `subagent-stop-thermal.cjs`, que remove
entry do thermal state e sempre sai 0.

Consequência dura: **não é possível escrever o caso conhecido-ruim que o NFR de estilo de teste exige** —
não há como fazer o repositório emitir uma notificação de ociosidade para o gate acusar.

Duas leituras, e a segunda pode ser a certa: (a) registrar um hook novo num evento de notificação do
harness, inventando nome do evento, formato do payload e como ele sabe que o agente foi encerrado — nada
disso está no repo nem documentado; (b) **isto não é um gate do SOMA e sim uma regra de operação do
orquestrador**, e o lugar dela é o `CLAUDE.md`, não um AC. Se for (b), este item sai desta spec e vira
uma linha de protocolo.

### M-07 — unificar as duas formas canônicas de heading de AC

**Incidente, medido em 2026-08-22:** as duas regexes que o repositório trata como *"a forma canônica"*
**não concordam entre si**. `core/hooks/spec-test-traceability.cjs:51` usa
`/^\s*#{0,6}\s*-?\s*\*{0,2}(AC-\d+)\*{0,2}:/` e `core/adapters/claude/commands/soma-run.md:51` usa
`^### AC-\d+:`. Testados 8 candidatos: `- **AC-01:**` e `**AC-02**:` casam **só** o hook; `### AC-1:`
casa os dois (dígito único é canônico); `### AC 01:`, `### ac-01:` e `### AC-01 — x` não casam nenhum.

**O que falta decidir:** qual das duas vence, e o que acontece com os artefatos escritos sob a outra. A
spec 019 linta contra a forma do `soma-run.md` e **declara explicitamente que não unifica** — porque
unificar muda o comportamento de um hook que hoje bloqueia commit.

---

## Non-Functional Requirements

- **Nenhum AC desta spec entra em execução antes de a sua decisão estar escrita e datada** na seção
  §Questões resolvidas, com a alternativa rejeitada nomeada. Este é o requisito que a spec 019 aprendeu
  na própria pele.
- **Test style:** quando cada mecanismo for decidido e virar AC, ele nasce com caso conhecido-ruim e
  conhecido-bom. O **M-06 não consegue cumprir isso hoje** — é o sinal de que ele pode não ser um gate.

## Out of Scope

- Gates com régua medida — são a **spec 019**.
- Fail-silent em código e suíte — é a **spec 020**.

## Questões abertas

- [NEEDS CLARIFICATION] M-01: nome, schema, caminho, critério de aprovação e semântica de bloqueio do artefato do `STEP_1D_AUDIT`
- [NEEDS CLARIFICATION] M-01: cria-se fonte única de `STEP_ORDER` antes de inserir o estado?
- [NEEDS CLARIFICATION] M-02 (**segurança**): o SOMA executa o parser de decisões do projeto consumidor? Shell, `require`, ou nenhum dos dois?
- [NEEDS CLARIFICATION] M-02: a D-019-03 se contradiz — ausência de config **bloqueia** ou **avisa e segue**?
- [NEEDS CLARIFICATION] M-03: restringir a contradições estruturais decidíveis, ou abandonar o AC?
- [NEEDS CLARIFICATION] M-04: proveniência por tabela `§0` ou por anotação de frase?
- [NEEDS CLARIFICATION] M-05: adoção sintetiza histórico (artefato mente) ou abre run reduzida (perde a verificação)?
- [NEEDS CLARIFICATION] M-06: é gate do SOMA ou regra de operação do `CLAUDE.md`?
- [NEEDS CLARIFICATION] M-07: qual das duas formas canônicas vence, e o que acontece com o legado?

## Completeness Checklist

- [ ] Gate 1 pendente — **9 questões em aberto**, por desenho
- [x] Todo mecanismo carrega o incidente que o originou, medido e datado
- [x] Todo mecanismo carrega as leituras incompatíveis que o texto anterior permitia
- [x] As duas decisões de segurança estão marcadas como tal
