# Spec: soma spec-lint — artefatos de spec checáveis por máquina

**Feature ID:** 017-soma-spec-lint
**Branch:** `feature/017-soma-spec-lint`
**Created:** 2026-08-16
**Status:** APPROVED
**Gate 1:** aprovado por Felipe em 2026-08-16, sem cortes além do `path-exists` que ele mesmo mandou cortar.

---

## User Stories

- Como orquestrador que escreve spec, quero que o documento acuse meus próprios defeitos antes de um executor esbarrar neles, pra que o erro custe um comando e não um dispatch.
- Como executor que implementa contra a spec, quero que a invocação de CLI citada no quickstart seja a mesma que o plano fixou, pra não precisar escolher qual das duas está certa no meio da task.

---

## Outcome & Guardrails

**OUTCOME** — como o usuário SABE que deu certo, em comportamento observável:
Rodo `soma spec-lint core/specs/016-artifact-gated-trilho/` contra o estado do repo **anterior** aos commits de correção e vejo, na saída, os defeitos que a auditoria manual de 2026-08-15 levou horas pra achar à mão.

**APPETITE** — quanto vale investir nisto:
Uma wave de implementação. Se passar disso, corta check — não estende. Restam dois, e o `cli-surface` é o último a cair: é o único com defeito real demonstrado nos commits de correção da 016.

**NO-GOS**:
- Não vira hook nem bloqueia `git commit` nesta feature. Ferramenta primeiro, gatilho depois de medir contra o corpus real.
- Não checa "número não medido em prosa". Pra verificar uma contagem o script teria que saber o que está sendo contado — não é mecanizável, e a versão que seria (proibir cardinal nu) é regra de forma, não de verdade.
- Não checa "AC com cobertura só nominal". O lado nominal o `spec-completeness-gate.cjs` já cobre; o lado semântico exige lembrar *por que* o AC existe, e isso foi achado por leitura humana depois de um agente delegado não produzir nada duas vezes.
- **Não checa existência de path citado.** Removido do escopo em 2026-08-16 por medição, não por conforto — ver §"O check que foi cortado".
- Não checa alcançabilidade de passo de quickstart. Viável, e é onde moram 3 dos 8 defeitos reais da 016 — mas exige grafo produz/consome e não cabe neste appetite. Candidato declarado a v2.
- Não toca na spec 016 além de uma marcação de cerca, nem nas 5 falhas pré-existentes da suíte.
- Não adiciona dependência de pacote.

---

## O check que foi cortado, e a evidência que o cortou

Esta seção existe porque a decisão contraria a escolha inicial de escopo, e o registro da razão vale mais que o registro da conclusão.

`path-exists` — "path citado que não existe nem é deliverable declarado" — entrou no escopo inicial porque **existia um protótipo**, não porque existia um defeito. Três medições independentes, todas de 2026-08-16:

| Medição | Resultado |
|---|---|
| Dos 8 defeitos reais corrigidos na 016 (`git show --stat` de `626936b`, `9ba54b2`, `8def879`), quantos eram path quebrado | **0** — foram 4 afirmações numéricas, 3 defeitos de execução no quickstart, 1 cobertura nominal de AC |
| Achados do protótipo contra a 016 corrigida | **4, todos falso-positivo** |
| Achados contra a própria spec 017 | **28, todos falso-positivo** |

Os 28 não eram bug de implementação: são estruturais. Uma spec cujo assunto **é** referência a arquivo cita paths como exemplo em quase toda linha, e nenhuma regra de resolução distingue "path que afirmo existir" de "path que uso como exemplo". Toda spec que discuta arquivos cairia no mesmo buraco.

Um check sem verdadeiro-positivo demonstrado e com falso-positivo estrutural não é um check incompleto — é ruído com nome de ferramenta.

---

## Acceptance Criteria

### AC-01: WHEN `soma spec-lint <spec-dir>` termina sem achado, the CLI SHALL sair com código 0 e não imprimir nenhuma linha de achado

Given uma spec sem violações / When o comando roda apontando pra ela / Then o exit code é 0 e a saída não lista achados.

### AC-02: WHEN `soma spec-lint <spec-dir>` encontra ao menos uma violação, the CLI SHALL sair com código 1 e imprimir cada achado com nome do check, arquivo e linha

Given uma spec com violação conhecida / When o comando roda / Then o exit code é 1 e cada achado nomeia check, arquivo e linha.

### AC-03: IF o argumento de diretório está ausente ou não existe, THEN the CLI SHALL sair com código 2 nomeando o erro e não executar nenhum check

Given argumento faltando ou path inexistente / When o comando roda / Then exit 2, erro nomeado na stderr, nenhum check executado.

### AC-04: The dispatcher `soma` SHALL listar `spec-lint` na sua tabela de uso

Given `soma --help` / When executado / Then `spec-lint` aparece com descrição de uma linha.

### AC-05: WHERE um `plan.md` contém um bloco cercado `soma-cli-surface`, the linter SHALL executar o check de superfície contra os artefatos daquela spec

Given uma spec cujo plan.md tem a cerca / When o lint roda / Then o check `cli-surface` é executado e reportado como executado.

### AC-06: IF um `plan.md` não contém o bloco cercado `soma-cli-surface`, THEN the linter SHALL pular o check de superfície e reportá-lo como pulado

Given uma spec sem a cerca / When o lint roda / Then `cli-surface` aparece como pulado e não gera achado.

### AC-07: WHEN um artefato cita uma invocação cujo verbo é desconhecido à superfície, omite flag que a superfície marca obrigatória, ou usa flag que a superfície não declara, the linter SHALL emitir um achado por divergência

Given a cerca declarando a superfície / When um artefato diverge dela / Then há um achado por divergência, nomeando o verbo e a flag.

### AC-08: WHEN duas tasks marcadas `[P]` no mesmo nível de dependência declaram a mesma entrada na coluna `files`, the linter SHALL emitir um achado nomeando as duas tasks e o arquivo compartilhado

Given um tasks.md com colisão / When o lint roda / Then o achado nomeia ambos os IDs de task e o arquivo.

### AC-09: IF duas tasks compartilham arquivo mas não são ambas `[P]`, ou são `[P]` em níveis de dependência distintos, THEN the linter SHALL não emitir achado de colisão

Given tasks que compartilham arquivo mas rodam em sequência / When o lint roda / Then nenhum achado de colisão.

### AC-10: WHEN a suíte de testes roda, the linter SHALL provar cada check contra um fixture conhecido-ruim que ele reporta e um fixture conhecido-bom que ele ignora

Given a suíte / When executada / Then cada check tem os dois fixtures e ambos passam — um check com só um dos lados falha a suíte.

### AC-11: WHEN executado contra os artefatos da 016 no estado anterior aos commits de correção, the linter SHALL reportar os defeitos que aqueles commits corrigiram

Given o estado pré-`626936b` obtido por `git worktree` / When o lint roda / Then aparecem como achados os defeitos de invocação de CLI que `9ba54b2` corrigiu, entre eles a flag inventada que nunca existiu.

### AC-12: WHEN executado contra a spec 016 no estado corrigido, the linter SHALL não reportar nenhum achado

Given HEAD com a 016 corrigida / When o lint roda contra ela / Then exit 0 e zero achados.

### AC-13: The módulo `spec-completeness-gate.cjs` SHALL exportar suas primitivas de parsing para que o linter as consuma em vez de reimplementá-las

Given o linter precisando de parsing de AC e de marker / When ele é implementado / Then ele importa do gate, e nenhuma primitiva do gate aparece duplicada no código do linter.

### AC-14: The linter SHALL executar sem nenhuma dependência de pacote adicionada ao `package.json`

Given o `package.json` sem as chaves `dependencies` e `devDependencies` / When o linter roda / Then ele funciona e essas chaves continuam ausentes.

---

## Non-Functional Requirements

- **Performance:** o lint de um diretório de spec completa em menos de 2s numa máquina de desenvolvimento. É I/O de alguns arquivos de texto; se passar disso, algo está errado no desenho.
- **Security:** read-only. O linter lê artefatos de spec, escreve só em stdout/stderr, e não executa nada que leia do documento.
- **Test style:** `node --test`, sem mock de filesystem. Fixtures são diretórios de spec reais em tmpdir. **`os.tmpdir()` neste ambiente não é `/tmp`** — hardcodar `/tmp` produz falso-verde.
- **Monitoring:** nenhum. Não emite telemetria nesta versão — o log do Article XI ainda está sendo saneado e poluí-lo agora atrapalharia aquela medição.

---

## Out of Scope

- Wiring em hook, bloqueio de `git commit`, e qualquer forma de enforcement automático.
- Os três checks recusados: "número não medido", "AC com cobertura só nominal" e "path citado que não existe" — os dois primeiros por não serem mecanizáveis, o terceiro por medição registrada em §"O check que foi cortado".
- O check de alcançabilidade de passo de quickstart.
- **Promessa de silêncio nas specs 001 a 015.** O piso de ruído dessas 15 nunca foi medido. Varrê-las é uma medição prevista no plano, e o resultado dela é que decide entre allowlist, correção ou v2. Afirmar silêncio agora seria asserir especificidade não medida — que é o defeito que este linter existe para caçar.
- Qualquer alteração na spec 016 além de adicionar o info-string à cerca de um bloco de código que já existe.

---

## Open Questions

Nenhuma em aberto. As quatro decisões que estariam aqui foram fechadas antes ou durante a escrita: escopo de checks, formato imposto aos artefatos, ferramenta-antes-de-gatilho, e o corte do `path-exists`.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero markers de clarificação restantes
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry
- [x] Feature ID + Branch filled in
- [x] OUTCOME/APPETITE/NO-GOS preenchidos
