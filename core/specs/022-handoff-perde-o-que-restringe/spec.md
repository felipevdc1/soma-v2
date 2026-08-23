# Spec: O `/handoff` perde o que restringe a próxima ação

**Feature ID:** 022-handoff-perde-o-que-restringe
**Branch:** `feature/022-handoff-transporte`
**Created:** 2026-08-22
**Status:** DRAFT — **não é para executar.** 7 decisões de mecanismo em aberto.

> **Origem:** incidente medido na sessão `hermes [4da427]` em 2026-08-22, reportado ao SOMA por ela. O
> espécime é o Hermes; **o defeito é do SOMA** — atinge todo projeto que usa `/handoff`.
>
> **Por que spec própria e não a 021:** a 021 trata do pipeline `spec`/`plan`/`tasks`/`contracts` e já
> carrega 9 questões em aberto. O `/handoff` é outro artefato, outro gerador, outro template, e as 7
> decisões abaixo não tocam nenhum dos 6 mecanismos de lá. Somá-las faria da 021 um depósito — que é
> exatamente o que a **D-019-05** existiu para impedir.
>
> **Por que não a 019:** o critério da D-019-05 é *"fica o que tem régua medida; sai o que só tem
> mecanismo indefinido"*. Aqui o **incidente** está medido com rigor; o **mecanismo** não está decidido.

---

## §0 Superfície fixada

Cada linha diz **quem** mediu. Reproduzi as três que carregam peso; as demais são da sessão `hermes`.

| valor | é | medido por |
|---|---|---|
| `/handoff` é artefato do SOMA | `core/adapters/claude/commands/handoff.md`, **8487 B** | **orquestrador**, `ls` |
| o instalado que roda | `~/.claude/commands/handoff.md`, **byte-idêntico** ao do repo | **orquestrador**, `diff` — sem armadilha de divergência |
| template | `core/templates/handoff-template.md`, 1687 B | **orquestrador**, `ls` |
| a regra do Matt Pocock que produz o bug | literal, em `SKILL.md:12` | **orquestrador**, `grep -n` |
| tamanho do espécime | `handoff-hermes.md` = **3449 linhas / 262.362 B** | **orquestrador**, `wc` |
| o guardrail central da spec do projeto | `caller` = **0 ocorrências** no handoff inteiro | **orquestrador** — régua validada nos dois sentidos: `Hermes`=377 (positivo), termo inventado=0 (negativo) |
| exigências do usuário ausentes | **12 de 16** | sessão `hermes` — régua com controles e refeita com variantes de grafia |
| itens que **restringem execução** não carregados | **30** | sessão `hermes` — 6 fontes + 6 conferentes, 13 agentes |
| correções devolvidas pelos conferentes | **34**, incluindo **3 ausências falsas** dos varredores | sessão `hermes` — a régua sobre a régua funcionou |
| bloco morto no espécime | **48,2%** do arquivo (sessão 5+4) | sessão `hermes` |
| sessões-fantasma sem header | **3** (4, 8, 11) | sessão `hermes` |

🔴 **Números marcados como "sessão `hermes`" não foram reproduzidos por mim.** Antes de virarem critério
de aceite, reproduzir — é a regra que esta família de specs inteira defende.

---

## O incidente

O `handoff-hermes.md` citava o `brief.md` como **nome de arquivo numa lista de artefatos**. O `brief.md`
foi criado a pedido explícito do usuário — *"SALVA ESSA PORRA QUE ISSO DAQUI SÃO MINHAS NECESSIDADES
REAIS"* — e está **commitado e íntegro**. **Nada se perdeu do disco.**

**O que falhou não foi memória, foi transporte.** A sessão seguinte leu o handoff, resumiu dele, e nunca
abriu o brief. O usuário precisou cobrar **3 vezes** antes de alguém medir. Então apareceram: 12 de 16
exigências ausentes, 30 itens que restringem execução não carregados, e o guardrail central da spec do
projeto — *"nenhuma peça é declarada pronta sem o caller provado"* — com **zero** ocorrências no arquivo.

### A regra publicada É o defeito

`~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.3/skills/productivity/handoff/SKILL.md:12`
manda, literal:

> *"Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits,
> diffs). **Reference them by path or URL instead.**"*

A regra otimiza contra **apodrecimento** — duplicata diverge da fonte — e paga com **invisibilidade**.
**Os dois polos falham**, e falham de modos opostos: duplicar produz declaração que mente (o padrão #14
do Failure Log); referenciar produz declaração que ninguém abre. O defeito não é a regra ser errada; é
ela ser aplicada **sem distinguir o que restringe do que informa**.

### Três que não são falta — são contradição viva

1. **Bucket B contradiz `D-H96` a 58 linhas de distância, no mesmo bloco.** A linha 332 diz *"falta criar
   2 canais no Discord"*; os canais existem desde 22/08 12:15 UTC (IDs conferidos contra a API).
   **Essa contradição fez a sessão dar estado errado ao usuário.**
2. **Regressão não sinalizada sustentando decisão.** Linha 1892 (mais velha): firewall *"8 regras,
   correto"*. Linha 1182 (mais nova): *"sem regras, pendente"*. Um bucket apoiava sua tese na premissa
   que o próprio arquivo já refutara.
3. **48,2% do arquivo é bloco morto**, admitido superado em genérico sem dizer qual linha, mais 3
   sessões-fantasma sem header — impossível isolar para arquivar.

---

## User Stories

- Como a próxima sessão, quero conseguir executar a próxima tarefa **abrindo só o handoff**, pra que o
  que me restringe não dependa de eu adivinhar qual arquivo abrir.
- Como Felipe, quero que uma exigência que eu ditei chegue à sessão seguinte, pra eu não ter que ditá-la
  de novo — nem descobrir 3 cobranças depois que ela sumiu.

---

## Outcome & Guardrails

**OUTCOME** — **teste de aceite proposto pela sessão `hermes`, e é bom**: abrir **só** o handoff e tentar
executar a próxima task. Tudo que exigir abrir outro arquivo **para decidir** estava no lugar errado.

**APPETITE** — a decidir no Gate 1. O escopo depende inteiramente da questão 2 (redação × mecanismo): se
for redação, é uma sessão; se o handoff virar prompt de agente, é bem mais.

**NO-GOS**
- Não trocar um polo pelo outro. Carregar tudo inline reintroduz o apodrecimento que a regra do Pocock
  evita, e o Failure Log deste sistema já tem o padrão #14 (*"consertar o efeito e esquecer a
  declaração"*) medido em três ocorrências numa noite.
- Não inchar o handoff com o que apenas informa — a seção de fatos estáveis existe para isso, por caminho.

---

## A partição proposta — é a decisão que falta

> **Carrega INLINE o que RESTRINGE a próxima ação. Referencia por caminho o que apenas INFORMA.**

⚠️ **Isto é proposta, não decisão.** A fronteira é **julgamento**, e dois executores classificariam itens
de forma diferente — que é precisamente o critério que manda esta spec nascer DRAFT.

---

## Os sete mecanismos por decidir

1. **Onde fica a fronteira RESTRINGE × INFORMA, e quem arbitra caso a caso.** Sem isso, o gate vira
   opinião. Caminho plausível não decidido: enumerar categorias fechadas (NO-GO, stop condition, guardrail
   nomeado, decisão travada, credencial/limite) em vez de tentar definir o predicado geral.
2. **O forçamento é redação ou mecanismo?** Redação: o topo diz *"não resuma a partir daqui — o handoff já
   É o resumo"*. Mecanismo: o handoff vira o **prompt** de um agente (ideia do `claude-handoff` do Pocock),
   e prompt não dá pra pular. **Esta é a questão que decide o tamanho da spec inteira.**
3. **Arquivar bloco velho é manual, comando próprio, ou hook?**
4. **Qual o orçamento de tamanho, e o que acontece ao estourar** — poda automática, recusa, ou aviso? O
   espécime tem 3449 linhas; nem um corte para 10% cobriria o estado atual.
5. **`Estado` + `Última Verificação` viram campos obrigatórios validados por lint, ou convenção?**
6. **O `grep` do valor antigo antes de fechar bucket é hook bloqueante ou item de checklist?** *(É o padrão
   "Grep the Old Value", que nesta mesma data pegou um defeito meu na spec 019 — ele funciona.)*
7. **Muda o `handoff-template.md`, o `handoff.md`, ou os dois?**

---

## Desenho de referência — produzido por 13 agentes, **não aplicado**

Dez seções propostas, cada uma amarrada ao erro concreto que ela impediria: cabeçalho de forçamento ·
próxima ação literal · **restringe (inline, nunca só path)** · estado medido com timestamp e nota de
decaimento · buckets com `Estado` + `Última Verificação` obrigatórios · ledger de abatimento com prova ·
fatos estáveis por caminho · dados sensíveis por existência sem conteúdo · skills sugeridas · histórico
arquivado por caminho, nunca apagado.

Detalhe integral, com os 30 itens tabelados por fonte e estado:
`~/.claude/plans/2026-08-22-incidente-handoff-referencia-decorativa.md`

⚠️ **O desenho é insumo do Gate 1, não decisão.** Foi produzido pela mesma sessão que sofreu o incidente,
e não passou por leitor independente.

---

## Non-Functional Requirements

- **Nenhum AC entra em execução antes de a sua decisão estar escrita e datada**, com a alternativa
  rejeitada nomeada.
- **Test style:** quando cada mecanismo virar AC, nasce com caso conhecido-ruim e conhecido-bom. O
  espécime conhecido-ruim já existe e está preservado: o `handoff-hermes.md` de 3449 linhas.
- **Privacidade:** o handoff é lido por qualquer sessão futura. Dado sensível entra por **existência sem
  conteúdo**, nunca por valor.

## Out of Scope

- Gates sobre `spec`/`plan`/`tasks`/`contracts` — specs **019** e **021**.
- Fail-silent em código e suíte — spec **020**.
- **O roadmap que nunca é revisitado** — achado colhido junto, e **é outra coisa**: não é gate de
  documento, é **aresta faltando na máquina de estados** (o fluxo vai roadmap → spec → plan → tasks →
  execução → handoff → próxima sessão → spec e **nunca volta ao roadmap**). Registrado como **Bucket I**
  no `handoff-forge.md`. Medido no espécime pela sessão `hermes`, **não reproduzido por mim**:
  `README.md` com 1 commit contra `DECISOES.md` 33, `plans/` 18, `specs/` 14.

## Questões abertas

- [NEEDS CLARIFICATION] Fronteira RESTRINGE × INFORMA: categorias fechadas ou predicado geral? Quem arbitra?
- [NEEDS CLARIFICATION] Forçamento por redação ou por mecanismo (handoff-as-prompt)? — decide o tamanho da spec
- [NEEDS CLARIFICATION] Arquivamento de bloco velho: manual, comando, ou hook?
- [NEEDS CLARIFICATION] Orçamento de tamanho e comportamento ao estourar: poda, recusa, ou aviso?
- [NEEDS CLARIFICATION] `Estado` + `Última Verificação`: lint obrigatório ou convenção?
- [NEEDS CLARIFICATION] `grep` do valor antigo antes de fechar bucket: hook bloqueante ou checklist?
- [NEEDS CLARIFICATION] Altera `handoff-template.md`, `handoff.md`, ou os dois?

## Completeness Checklist

- [ ] Gate 1 pendente — **7 questões em aberto**, por desenho
- [x] O incidente está medido, datado e com espécime preservado
- [x] A §0 declara quem mediu cada número, e marca os não reproduzidos
- [x] A partição proposta está marcada como proposta, não como decisão
- [x] O achado do roadmap está separado, com destino nomeado
