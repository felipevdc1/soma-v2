# Quickstart: soma spec-lint — validação manual

Roteiro para conferir à mão o que a suíte confere sozinha. Cada seção fecha um grupo de ACs.

**Toda invocação abaixo é conferível contra `plan.md` §"Superfície de CLI"** — que é o ponto: se algum passo daqui usar uma flag que a superfície não declara, o próprio `spec-lint` acusa quando rodar contra esta spec. Este documento é o primeiro cliente do linter.

---

## 0. Ambiente

```bash
cd "$HOME/Documents/- projetos claude code/soma-v2"
git log --oneline -1
node --version
```

Medir a suíte **antes** de começar, porque a contagem total é móvel:

```bash
npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"
```

Anote os quatro números. No fim do roteiro, a diferença tem que ser explicável por RED planejado — nenhum fail novo fora dos seus.

---

## 1. AC-04 — o verbo existe e aparece

```bash
node core/scripts/soma.cjs --help
```

**Esperado:** `spec-lint` na tabela de uso, com descrição de uma linha, ao lado de `audit` e `run`.

---

## 2. AC-03 — argumento inválido é exit 2, e nada roda

```bash
node core/scripts/soma.cjs spec-lint ; echo "exit=$?"
node core/scripts/soma.cjs spec-lint /caminho/que/nao/existe ; echo "exit=$?"
```

**Esperado:** os dois saem `exit=2`, com erro nomeado na stderr, e **sem linha de rodapé** — não houve execução para resumir. Rodapé aqui seria o defeito: sugeriria que checks rodaram e nada acharam.

---

## 3. AC-01 / AC-06 — limpo é silencioso, mas nunca mudo

```bash
node core/scripts/soma.cjs spec-lint core/specs/017-soma-spec-lint ; echo "exit=$?"
```

**Esperado:** `exit=0`, nenhuma linha de achado, e o rodapé presente listando os dois checks como executados.

O rodapé é o AC-06 e não é decoração: sem ele, um check que silenciosamente não rodou é indistinguível de um check que rodou e não achou nada. É a mesma classe de falso-verde que o AC-10 da 016 cura no gate.

Para ver o outro lado, rodar contra uma spec **sem** a cerca de superfície:

```bash
node core/scripts/soma.cjs spec-lint core/specs/012-soma-audit-cli-primitive ; echo "exit=$?"
```

**Esperado:** `cli-surface` aparece em `pulados:` com o motivo, e `parallel-collision` em `executados:`.

---

## 4. AC-07 — divergência de CLI, um achado por divergência

Montar uma spec de brinquedo fora do repo (`os.tmpdir()`, **nunca** `/tmp` hardcodado):

```bash
FIXT="$(node -p 'require("os").tmpdir()')/spec-lint-demo"
mkdir -p "$FIXT"
printf '# Spec: demo\n\n**Created:** 2026-08-16\n\n### AC-01: The demo SHALL existir\n' > "$FIXT/spec.md"
cat > "$FIXT/plan.md" <<'EOF'
# Plan: demo

```soma-cli-surface
soma demo run --alvo <path> [--seco]
```
EOF
printf '# Quickstart\n\nRodar `soma demo run --molhado` para comecar.\n' > "$FIXT/quickstart.md"

node core/scripts/soma.cjs spec-lint "$FIXT" ; echo "exit=$?"
```

**Esperado:** `exit=1` e **dois** achados na mesma linha do `quickstart.md` — a flag obrigatória `--alvo` ausente, e a flag `--molhado` não declarada. Um achado só significaria que a implementação colapsou divergências e escondeu trabalho.

Agora o lado da especificidade — prosa que **menciona** o verbo sem invocá-lo:

```bash
printf '\nO verbo `run` decide a transicao.\n' >> "$FIXT/quickstart.md"
node core/scripts/soma.cjs spec-lint "$FIXT" ; echo "exit=$?"
```

**Esperado:** continua com os mesmos dois achados. Menção não é invocação — se subir para três, o check virou `grep`.

---

## 5. AC-08 / AC-09 — colisão de paralelismo

```bash
cat > "$FIXT/tasks.md" <<'EOF'
# Tasks: demo

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-01 | `[P]` primeira | [SPEC:AC-01] | `demo/a.cjs` | | TODO |
| T-02 | `[P]` segunda | [SPEC:AC-01] | `demo/a.cjs` | | TODO |
| T-03 | `[P]` terceira | [SPEC:AC-01] | `demo/b.cjs` | T-01 | TODO |
EOF

node core/scripts/soma.cjs spec-lint "$FIXT" ; echo "exit=$?"
```

**Esperado:** exatamente **um** achado de `parallel-collision`, nomeando `T-01`, `T-02` e o arquivo compartilhado. A `T-03` é `[P]` mas escreve em outro arquivo — e mesmo se escrevesse no mesmo, depende de `T-01` e não colidiria com ela.

O caso que interessa é o negativo. Tirar o `[P]` da `T-02`:

```bash
sed -i '' 's/`\[P\]` segunda/segunda/' "$FIXT/tasks.md"
node core/scripts/soma.cjs spec-lint "$FIXT" ; echo "exit=$?"
```

**Esperado:** o achado de colisão **some**. Duas tasks no mesmo arquivo rodando em sequência não são conflito, e acusar isso seria o linter cobrando disciplina que não existe.

---

## 6. AC-11 / AC-12 — a prova que fecha a fase

O estado corrigido primeiro:

```bash
node core/scripts/soma.cjs spec-lint core/specs/016-artifact-gated-trilho ; echo "exit=$?"
```

**Esperado:** `exit=0`, zero achados.

O estado histórico depois:

```bash
WT="$(node -p 'require("os").tmpdir()')/w016"
git worktree add "$WT" 626936b^
node core/scripts/soma.cjs spec-lint "$WT/core/specs/016-artifact-gated-trilho" ; echo "exit=$?"
```

**Esperado:** `exit=1`, com os defeitos de invocação que `9ba54b2` corrigiu aparecendo como achados — entre eles a flag que nunca existiu.

> ⚠️ O worktree histórico **não tem** o info-string `soma-cli-surface` na cerca do `plan.md`, porque ele é adicionado pela T-09. Sem injetá-lo, `cli-surface` sai como `pulado` e o defeito não é achado. O teste automatizado da T-09 copia os artefatos para `os.tmpdir()` e injeta o info-string antes de rodar; à mão, faça o mesmo antes de concluir que o check falhou.

---

## 7. AC-10 — o corpus dos dois lados

```bash
node --test core/scripts/__tests__/spec-lint-selftest-corpus.test.cjs
```

**Esperado:** passa, e falharia se qualquer check em `registry.cjs` tivesse fixture de um lado só. É a régua da régua: sem isso, um check cego reporta silêncio e silêncio lê como aprovação.

---

## 8. Fechamento

```bash
npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"
```

Comparar com os números do passo 0 e **reconciliar a diferença**, não conferir contra constante. As 5 falhas pré-existentes continuam lá de propósito.

---

## Limpeza

```bash
rm -rf "$(node -p 'require("os").tmpdir()')/spec-lint-demo"
git worktree remove "$(node -p 'require("os").tmpdir()')/w016" --force
git worktree prune
```
