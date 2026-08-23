# Spec: Gate de Operador — o SOMA mede o artefato e não mede quem opera

**Feature ID:** 024-gate-de-operador
**Branch:** `feature/024-gate-de-operador`
**Created:** 2026-08-23
**Status:** DRAFT

---

## §0 Superfície fixada (medida em 2026-08-23, `main` = `cbd95a7`)

Toda afirmação abaixo carrega como foi obtida. Número sem lastro é achado, mesmo quando está certo.

| fato | valor | como foi obtido |
|---|---|---|
| Hooks instalados em `core/hooks/` | **19** | `ls core/hooks/*.cjs \| wc -l` |
| Que bloqueiam (`exit(2)`) vs só avisam | **10 / 9** | `grep -c 'exit(2)'` por arquivo |
| Hooks que já leem `tool_input.command` | **3** — `framework-guard`, `pre-commit-gate`, `spec-completeness-gate` | `grep -lE "tool_input.*command"` |
| Hooks que tratam comando destrutivo (`rm -rf`, `pkill`, `kill`) | **0** | `grep -rlE "rm -rf\|pkill\|\bkill\b" core/hooks/*.cjs` → vazio |
| `thermal-guard` — escopo real | só `Agent`; `matcher=Agent` no `settings.json` | `thermal-guard.cjs:143` (`if (!/^Agent$/i.test(toolName)) return`) |
| `hyd-gate` — eventos / bloqueios reais | **8.747 / 0** (4.985 `WOULD_BLOCK`) | parse de `~/.claude/logs/hyd-gate.log`, 2026-04-14 → 2026-08-23 |
| Telemetria Article XII — entradas / de trabalho real | **11.811 / ~6** (80% fixtures, 2.361 `/etc/hosts`) | parse dos `article-xii-*.jsonl` |
| Defeitos do orquestrador em 1 sessão (2026-08-23) | **12**, dos quais **0** cobertos por qualquer hook | classificação manual contra os 19 hooks |
| `CLAUDE.md` carregado toda sessão | **51,8k tokens** (`## Failure Log` = 65,8% dos bytes) | `/context` + `wc -c` |

**Corolário que motiva a spec:** o SOMA gateia o **artefato** (spec tem AC? AC tem teste? commit limpo?) e não tem
superfície para o **operador** (a régua que ele usou conseguiria acusar? ele leu a ferramenta antes de decidir sobre
ela? esse `pkill` pega mais do que ele quer?).

---

## User Stories

- Como **operador de uma sessão longa**, quero que um comando de verificação cuja saída eu vou usar como prova seja
  barrado quando ele é de uma forma **sabidamente cega**, pra eu não concluir "0 achados" de uma régua que não tinha
  como acusar.
- Como **dono da máquina**, quero que um comando destrutivo de escopo amplo (`pkill -f`, `rm -rf`, `kill -9`) exija
  declaração de escopo antes de rodar, pra que matar processo de outro projeto seja impossível por acidente e não
  apenas detectável depois.
- Como **mantenedor do SOMA**, quero uma régua que meça se este gate reduziu a taxa dessa classe de erro, pra poder
  **matar a feature** se não reduzir.

---

## Outcome & Guardrails

**OUTCOME** — como o usuário SABE que deu certo, em comportamento observável:
numa sessão de trabalho real de duração comparável à de 2026-08-23, a contagem de defeitos da classe
"régua cega" cai de **8** para **≤2**, e a de "destrutivo de escopo amplo" cai de **1** para **0**.
A medição sai do ledger de defeitos da sessão, não de impressão.

**APPETITE** — **uma sessão**. Se estourar, corta o AC-03 (é o único que precisa de `PostToolUse`) e o AC-04.
Não corta o AC-01: sem o gate destrutivo, o dano da classe mais cara continua possível.

**NO-GOS** — o que esta feature explicitamente NÃO vai fazer:
1. **Não vai gatear todo `grep`/`find`/`diff`.** Um gate que dispara em toda verificação vira ruído, e ruído é
   desligado. O alvo são **construções enumeradas e sabidamente cegas**, cada uma derivada de um incidente medido.
2. **Não vai nascer em warn-only.** O `hyd-gate` prova o custo dessa escolha: 8.747 eventos, 4.985 `WOULD_BLOCK`,
   **zero** bloqueios, 4 meses sem a auditoria que decidiria o enforce.
3. **Não vai tentar julgar intenção.** O hook não sabe se eu vou usar a saída como prova; ele só sabe a forma do
   comando. Toda regra tem de ser decidível pelo texto do comando.
4. **Não vai reescrever nem mover o `CLAUDE.md`.** Isso é a spec 023.
5. **Não vai emitir telemetria que mede a si mesma.** Se a única coisa que o log registrar for a suíte se exercitando,
   o log é ruído (medido: 80% da telemetria do Article XII é fixture).

---

## Acceptance Criteria

### AC-01: WHEN um comando Bash casa um padrão destrutivo de escopo amplo, the framework SHALL bloquear com exit 2 e imprimir a lista concreta do que seria atingido.

Padrões no escopo, cada um com incidente medido ou dano óbvio: `pkill -f`, `pkill -9`, `killall`, `kill -9` com
múltiplos PIDs, `rm -rf` fora do scratchpad da sessão, `git clean -fdx`, `git reset --hard`.
A mensagem de bloqueio SHALL nomear **quantos e quais** processos/arquivos casam **antes** de qualquer destruição, e
SHALL oferecer a forma estreita equivalente quando houver (ex.: `pkill -f "<padrão-mais-específico>"`).
Incidente que originou: 2026-08-23, `pkill -9 -f "^npm test"` matou o `npm test` de outro projeto (PID 9022, 16 min
de execução). O controle escrito na mesma chamada **detectou depois do dano**.

### AC-02: WHEN um comando Bash casa uma construção enumerada como sabidamente cega, the framework SHALL bloquear com exit 2 e nomear por que aquela forma não consegue acusar.

O corpus inicial é fechado e cada entrada cita o incidente que a produziu:
- `find ... -newermt` — GNU-ism que o `find` do macOS ignora silenciosamente (deu `0` em janela de 24h com arquivo
  escrito no mesmo dia).
- `git diff <A>..<B>` onde `A` e `B` resolvem para o **mesmo objeto** — vazio por construção.
- `git log -- <path>` usado para provar ausência — simplificação de histórico esconde commits.
- `stat`/`ls` com formato de tempo **sem data** usado para ordenar — mistura dias.
- `for X in $VAR` em `zsh` sem `${=VAR}` — não faz word-splitting, o laço roda uma vez.
- `grep -c <padrão>` num repositório que documenta os próprios mecanismos, sem excluir comentário/prosa.

A lista SHALL viver num arquivo de dados versionado, não no código do hook, para que acrescentar regra seja
acrescentar linha.

### AC-03: WHILE uma sessão está ativa, the framework SHALL, quando um comando de forma verificadora retornar saída vazia ou contagem zero, injetar um lembrete nomeando o controle que ainda não foi rodado.

"Forma verificadora" é decidível pelo texto: `grep -c`, `grep -l`, `find`, `diff`, `git diff --name-only`,
`wc -l`, `ps | grep`. O lembrete SHALL citar a régua específica e a pergunta única: *"esta régua conseguiria acusar,
se houvesse o quê acusar?"*.
Incidente que originou: **8 dos 12** defeitos de 2026-08-23 são exatamente isto — vazio/zero lido como prova.

### AC-04: WHEN duas ou mais suítes de teste do mesmo projeto estão vivas simultaneamente, the framework SHALL bloquear o lançamento de uma nova.

Hoje o `thermal-guard` cobre apenas `tool_name === 'Agent'` (`thermal-guard.cjs:143`) e nunca vê `Bash`. Em 2026-08-23
quatro `npm test` do mesmo repo se empilharam, travaram nos mesmos três testes disputando `~/.soma-v2`, e produziram
três diagnósticos errados antes de alguém olhar o `ps`.

### AC-05: The framework SHALL registrar, por sessão, quantas vezes cada regra bloqueou e quantas passou, num formato que permita responder se a taxa de defeito caiu.

O registro SHALL excluir execuções cujo alvo seja fixture ou caminho de teste, para não repetir o defeito medido na
telemetria do Article XII (80% de fixture, ~6 entradas reais em 11.811). Se após uma sessão de trabalho real a
contagem de defeitos da classe não cair, **a tese cai e a feature é removida** — isso é critério de morte, não de
sucesso.

---

## Non-Functional Requirements

- **Custo por chamada**: o hook roda antes de **todo** comando Bash. Orçamento: **< 50 ms** por invocação, medido.
- **Fail closed**: exceção inesperada dentro do hook SHALL bloquear com mensagem acionável, nunca `exit 0` mudo —
  precedente: o `catch` externo do `framework-guard` fazia isso e foi consertado em `ef39505`.
- **Bypass**: SHALL existir, SHALL ser por marker de sessão, e SHALL ser registrado. Gate sem escape vira gate
  desligado.
- **Zero dependência nova**: Node puro, como os outros 18 hooks.

---

## Out of Scope

- Reescrever, particionar ou mover o `CLAUDE.md` — é a spec **023**.
- Qualquer regra sobre conteúdo de spec, AC ou cobertura de teste — já coberto por `spec-completeness-gate` e
  `spec-test-traceability`.
- Detectar "o operador raciocinou mal". Só forma de comando é decidível.
- Migrar o `hyd-gate` para enforce — decisão própria, com auditoria própria, pendente desde 2026-04-20.

---

## Open Questions

Numeradas como `QA-NN` de propósito: o marcador padrão de clarificação bloqueia `git commit` pelo
`spec-completeness-gate`, e esta spec precisa ser commitada como DRAFT. (Escrever o token aqui, mesmo para
explicar que não o uso, dispararia o gate — a régua casa a menção, não o fato. Medido: com o token nesta
frase, o gate acusava 1.)

- **QA-1 (bloqueante)** — O AC-02 bloqueia (`exit 2`) ou avisa? Bloquear uma construção cega é correto quando ela é
  usada como prova, e **errado** quando é exploração casual. O hook não distingue os dois. Sem resposta, ou o gate é
  ruidoso ou é inútil.
- **QA-2 (bloqueante)** — O AC-03 exige `PostToolUse`, que só existe depois do comando rodar. Um lembrete pós-fato é
  a mesma família do `WOULD_BLOCK` que falhou por 4 meses. Vale construir?
- **QA-3** — Onde mora o corpus do AC-02: arquivo de dados no repo, ou entrada no `install-targets`? Se não for
  instalado, o hook vivo do Felipe não o enxerga.
- **QA-4** — O AC-01 precisa **executar** o padrão em modo seco (`pgrep -f` antes de `pkill -f`) para listar o que
  seria atingido. Isso é execução dentro de um hook `PreToolUse`. Aceitável dentro do orçamento de 50 ms?
- **QA-5** — O AC-04 precisa saber "mesmo projeto". Por `cwd` do payload, ou por match no comando? O `cwd` é o dado
  confiável (lição do K4 do `framework-guard`), mas duas suítes podem rodar do mesmo `cwd` legitimamente?
- **QA-6** — Qual é a régua do OUTCOME? "Contar defeitos numa sessão" depende de **eu** contá-los, e eu sou o objeto
  medido. Existe contagem que não dependa da minha honestidade?

---

## Completeness Checklist

- [x] Cada AC é binário e observável
- [x] Cada AC cita o incidente medido que o originou
- [x] Todo número da §0 tem procedência declarada
- [x] NO-GOS ≥ 2 (são 5)
- [x] Critério de **morte** declarado (AC-05)
- [ ] QA-1 e QA-2 resolvidas — **bloqueantes, a spec não vai a APPROVED sem elas**
- [ ] Leitura adversarial + leitor em contexto isolado antes do Gate
