# Plan: soma spec-lint

**Feature ID:** 017-soma-spec-lint
**Spec:** `core/specs/017-soma-spec-lint/spec.md`
**Created:** 2026-08-16

---

## Tese

Os artefatos de spec são prosa normativa, e prosa não tem compilador. Duas classes de defeito que apareceram na 016 são estruturais o bastante para virar predicado sobre o texto: **invocação que diverge da superfície declarada** e **tasks paralelas escrevendo no mesmo arquivo**. Esta fase constrói o compilador dessas duas, e recusa explicitamente as classes que exigiriam entender o *significado* do documento.

O risco desta fase não é falhar em achar — é **achar demais**. Um linter que cospe ruído é abandonado na segunda semana e some com o sinal real junto. Por isso a especificidade é requisito de primeira classe (AC-10), e não uma preocupação de polimento. O terceiro check proposto foi cortado exatamente por reprovar nesse critério, com medição registrada no `spec.md`.

---

## Superfície de CLI do `soma spec-lint` (fixada em 2026-08-16, ANTES de qualquer exemplo)

Esta seção existe primeiro por decisão de processo. Na 016, exemplos foram escritos antes de a superfície existir, dois executores inventaram interfaces divergentes, e uma flag que nunca existiu entrou no quickstart. Aqui a superfície vem antes, e todo exemplo neste plano, nos contratos, no `tasks.md` e no `quickstart.md` é conferível contra ela — **pelo próprio linter**.

```soma-cli-surface
soma spec-lint <spec-dir>
```

Um argumento posicional, zero flags. Não há `--format`, `--check`, `--fix` nem `--json`: nenhum AC pede, e cada flag inventada aqui seria exatamente o defeito que a fase combate. A prova de aceitação contra estado histórico (AC-11) usa `git worktree` e um diretório temporário — não precisa de flag.

**Exit codes** — herdados de `doctor.cjs` e `sync.cjs`, os dois subcomandos existentes que reportam achados:

| Código | Significado |
|---|---|
| `0` | nenhum achado |
| `1` | ≥1 achado |
| `2` | argumento inválido, diretório inexistente, ou erro fatal |

`audit.cjs` usa `1` para erro fatal e não é o precedente aqui: ele não é um reportador de achados.

---

## Formato de achado (fixado aqui, referenciado em todo lugar)

Uma linha por achado, na **stdout**:

```
{check}: {arquivo}:{linha}: {mensagem}
```

E uma linha de rodapé, sempre, mesmo com zero achados:

```
checks executados: {lista}  |  pulados: {lista ou "-"}  |  achados: {n}
```

O rodapé existe por causa do AC-06: um check que não roda precisa ser **visivelmente** pulado. Silêncio de check pulado é indistinguível de silêncio de check limpo — é a mesma classe de defeito que o AC-10 da 016 cura no gate.

`{arquivo}` é relativo ao `<spec-dir>`. `{linha}` é 1-indexado.

---

## Interface de check (fixada aqui — cada check é um módulo, e todos têm a mesma forma)

```javascript
// core/scripts/lib/spec-lint/checks/{nome}.cjs
module.exports = {
  name: 'cli-surface',
  // Retorna { status: 'ran'|'skipped', reason?: string, findings: Finding[] }
  // Finding = { check, file, line, message }
  run(ctx),
};
```

`ctx` é montado uma vez por execução por `lib/spec-lint/context.cjs` e passado a todos os checks:

```javascript
{
  specDir,                  // path absoluto
  artifacts: [ { file, text, lines } ],   // spec.md, plan.md, tasks.md, quickstart.md, contracts/*.md
  tasks,                    // linhas do tasks.md ja parseadas (id, parallel, files[], dependsOn[], specRefs[])
}
```

**Nenhum check lê o disco por conta própria.** Um único carregador significa um único lugar onde o parse quebra quando o formato do `tasks.md` mudar — e é o que torna os fixtures dos testes construíveis sem tocar no repo real.

Esta seção existe porque na 016 dois contratos descreveram o artefato e omitiram a chamada que o produz, e cada executor inventou a sua. Aqui a forma do módulo é contrato, não convenção oral.

---

## Os dois checks

### `cli-surface`

**Autoridade**: o bloco cercado com o info-string `soma-cli-surface` no `plan.md` da spec sob análise. Gramática, já em uso nesta própria seção acima: `--flag <valor>` é obrigatória, `[--flag <valor>]` é opcional, tokens posicionais antes das flags são subverbos.

**Opt-in é requisito, não conveniência.** Medido em 2026-08-16: dos 16 `plan.md` do repo, **1** tem seção de superfície de CLI. Um check que rodasse por padrão acenderia 15 specs no primeiro dia e nasceria como ruído.

**É o único check com verdadeiro-positivo demonstrado.** Dos 8 defeitos que os commits de correção da 016 consertaram, os 3 de `9ba54b2` eram defeitos de execução no quickstart, e a fatia de invocação divergente é exatamente o que este check pega.

### `parallel-collision`

Tasks marcadas `[P]` **no mesmo nível de dependência** que declaram a mesma entrada na coluna `files`.

"Mesmo nível" é derivado do grafo `depends_on`, não do cabeçalho da wave — cabeçalho é prosa, e prosa é o que estamos parando de confiar. Duas tasks colidem se são ambas `[P]` e nenhuma alcança a outra por caminho de dependência.

⚠️ **O validador ad hoc que fez isto à mão em 2026-08-15 errou três versões seguidas** — lia o próprio ID da task como dependência, o que fazia toda task alcançar a si mesma, e reportou **"0 conflitos"** num `tasks.md` com 8 tasks `[P]` escrevendo no mesmo arquivo. A quarta acertou. O corpus de fixtures da T-05 nasce dessas quatro versões.

---

## O que esta fase recusa, e por quê

| Classe de defeito | Por que fica de fora |
|---|---|
| Número afirmado em prosa não bate com a realidade | Para verificar uma contagem, o script precisaria saber **o que** está sendo contado. A versão mecanizável — proibir cardinal nu — checa forma, não verdade, e o remédio real é escrever enumerando |
| AC com cobertura apenas nominal | O lado nominal o `spec-completeness-gate.cjs` já cobre. O lado semântico exige lembrar **por que** o AC existe; foi achado por leitura humana em 2026-08-15, depois de um agente delegado para isso não produzir nada duas vezes |
| Path citado que não existe | Cortado em 2026-08-16 por medição: zero verdadeiro-positivo em 8 defeitos reais, 4/4 falso-positivo na 016, 28/28 na própria 017. O falso-positivo é estrutural, não de implementação — ver `spec.md` §"O check que foi cortado" |
| Passo de quickstart inalcançável | Exige grafo produz/consome sobre os passos. É onde moram 3 dos 8 defeitos reais da 016, o que faz dele **o melhor candidato a v2** — mas não cabe neste appetite |

---

## A única edição fora da 017 — declarada, não escondida

O `spec.md` da 017 limita o que se pode tocar na 016. **A T-09 usa exatamente essa exceção**, e ela é deliberada:

Para o AC-11 e o AC-12 exercitarem o `cli-surface` contra a 016, o `plan.md` da 016 precisa do info-string `soma-cli-surface` na abertura de um bloco de código que **já existe**, sem alterar uma linha do conteúdo, do escopo ou de qualquer AC da 016.

Alternativas descartadas: (a) inferir a superfície pelo cabeçalho `## Superfície de CLI` — é a heurística que a decisão de formato rejeitou; (b) testar `cli-surface` só contra fixture sintético — o AC-11 perde o defeito real, que é a razão de o check existir.

---

## Constitution Gates (Phase -1)

- [x] **Simplicity Gate** — componentes novos: `core/scripts/spec-lint.cjs` e a pasta `lib/spec-lint/`. 2 ≤ 3 (Article VII)
- [x] **Anti-Abstraction Gate** — a decomposição em `checks/{nome}.cjs` não é especulativa: as tasks de implementação são `[P]` e, em arquivo único, ambas escreveriam no mesmo lugar. É exigência de paralelismo, o mesmo raciocínio que decompôs os verbos do `soma run` na 016
- [x] **Integration-First Gate** — a fronteira é o filesystem (arquivos de spec entram, linhas de achado saem). Nenhum mock de `fs`; fixtures são diretórios de spec reais em `os.tmpdir()`
- [x] **Zero-dep** — validação e parsing à mão. As chaves `dependencies` e `devDependencies` continuam **ausentes** do `package.json`

---

## Traps que já custaram tempo neste repo

- **`os.tmpdir()` neste Mac não é `/tmp`** (é `/var/folders/...`). Hardcodar `/tmp` produz teste que passa sem testar.
- **Contagem total da suíte é móvel.** Meça antes e depois da sua task e reconcilie a diferença; não compare com constante. As 5 falhas pré-existentes não devem ser consertadas.
- **`hooks/spec-completeness-gate.cjs` não tem `module.exports`** — verificado em 2026-08-16. É a T-01, e é dependência de todas as outras.
- **Nunca usar `||`, `?.` ou `catch{}` silencioso dentro de verificação.** Fallback fabrica o resultado que se espera ver.
- **Um verificador só vale depois de provado nos dois sentidos.** Todo script de checagem desta fase roda antes contra um caso conhecido-ruim (tem que acusar) e um conhecido-bom (tem que calar). "0 conflitos" lê como sucesso.
