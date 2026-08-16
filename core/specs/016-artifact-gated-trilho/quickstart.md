# Quickstart: Trilho V3 — validação manual

**Feature ID:** 016-artifact-gated-trilho
**Created:** 2026-08-15

Passos para validar a feature à mão depois de implementada. Cada seção exercita um ou mais ACs e diz **o que observar** para considerar que passou.

---

## 0. Ambiente

```bash
cd "$HOME/Documents/- projetos claude code/soma-v2"
git log --oneline -1          # anote o SHA — é o baseline para reverter
npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"
```

**Esperado antes de começar:** 5 fails pré-existentes e nenhum a mais. Se houver fail diferente dos 5 conhecidos (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`), pare — o ambiente não está limpo.

Trabalhe num projeto de laboratório, não no repo de produção:

```bash
LAB=$(mktemp -d)/lab && mkdir -p "$LAB" && cd "$LAB" && git init -q && echo "# lab" > README.md && git add -A && git commit -qm "init"
```

---

## 1. AC-01 / AC-02 — prosa não passa, só artefato passa

O coração da fase: o SOMA para de acreditar na palavra do agente.

```bash
soma run state --init --run run-lab-001
soma run gate --step STEP_1B_PLAN ; echo "exit=$?"
```

**Observar:** `exit=2`. A mensagem tem que **nomear o report que falta**, não dizer só "bloqueado". Nenhum report foi emitido, então não há transição — mesmo que um agente tivesse escrito "concluído com sucesso".

```bash
soma run report --run run-lab-001 --step STEP_1A_SPECIFY --status pass
soma run gate --step STEP_1B_PLAN ; echo "exit=$?"
```

**Observar:** `exit=0`. E o arquivo existe:

```bash
cat .soma/reports/run-lab-001/STEP_1A_SPECIFY-report.json
```

Agora o caso que separa "bloqueia" de "bloqueia pela razão certa":

```bash
soma run report --run run-lab-001 --step STEP_1B_PLAN --status fail --reason "contracts/ vazio"
soma run gate --step STEP_1C_TASKS ; echo "exit=$?"
```

**Observar:** `exit=2` **e a mensagem cita `contracts/ vazio`**. Bloquear sem citar a causa não conta como passar — é o falso-verde que o `plan.md` descreve.

---

## 2. AC-10 — check que não roda é REJECT, nunca pass

```bash
echo "{ isto não é json" > .soma/reports/run-lab-001/STEP_1C_TASKS-report.json
soma run gate --step STEP_2_TASKS ; echo "exit=$?"
```

**Observar:** `exit=2`, com causa de não-legibilidade. **Nunca `exit=0`.** Um report ilegível não é ausência de problema.

---

## 3. AC-03 / AC-11 — estado durável e versionamento seletivo

```bash
ls .soma/
cat .soma/run-state-run-lab-001.json | head -30
git status --short
```

**Observar:** o state está em `.soma/` dentro do projeto (não em `/tmp`), tem `"$schema": "soma-state/v2"`, e **todos os campos do v1.0 continuam lá**. O `git status` não mostra `reports/`, `dispatches/`, `run-state-*.json` nem `.soma.lock`.

```bash
git check-ignore -v .soma/reports/ .soma/run-state-run-lab-001.json
git check-ignore .soma/install-state.json ; echo "install-state ignorado? exit=$?"
```

**Observar:** os dois primeiros são ignorados. O `install-state.json` **não** é — `exit=1` aqui é o resultado correto.

---

## 4. AC-04 — matar e retomar, de outra sessão

O critério que você sente no dia a dia.

```bash
soma run report --run run-lab-001 --step STEP_2_TASKS --status pass
soma run report --run run-lab-001 --step STEP_3_FOUNDATION --status pass
```

Feche o terminal por inteiro. Abra outro (sessão nova, `sessionId` diferente):

```bash
cd "$LAB"
soma run resume --run run-lab-001
```

**Observar:** retoma de `STEP_4_WAVES` — o step seguinte ao último com report `pass`. Não repete nada de `STEP_1A` a `STEP_3`, e não reclama de sessão diferente.

---

## 5. AC-05 / AC-06 — proveniência de dispatch

Primeiro **produza** o registro — as seções anteriores só exercitaram `state`, `report`, `gate` e `resume`, então não existe dispatch nenhum em disco ainda:

```bash
printf 'implemente X seguindo o contrato Y' > /tmp/lab-prompt.md
soma run dispatch-record begin --run run-lab-001 --task T-03 --prompt-file /tmp/lab-prompt.md

printf 'feito, 3 testes verdes' > /tmp/lab-output.md
cat > /tmp/lab-meta.json <<'JSON'
{ "schema": "soma-dispatch-record/v1", "run_id": "run-lab-001", "task_id": "T-03",
  "attempt": 1, "model": "sonnet", "base_sha": "abc1234",
  "started_at": "2026-08-16T00:00:00.000Z", "finished_at": "2026-08-16T00:05:00.000Z",
  "ac_refs": ["AC-05"], "executor_agent": "soma-lab-T-03", "result": "done" }
JSON
soma run dispatch-record end --run run-lab-001 --task T-03 \
  --output-file /tmp/lab-output.md --metadata-file /tmp/lab-meta.json
```

Agora inspecione:

```bash
ls -R .soma/dispatches/run-lab-001/
cat .soma/dispatches/run-lab-001/T-03/metadata.json
diff <(cat .soma/dispatches/run-lab-001/T-03/prompt.md) /tmp/lab-prompt.md && echo "prompt byte-a-byte OK"
```

**Observar:** três arquivos por task (`prompt.md`, `output.md`, `metadata.json`). O `prompt.md` é o prompt **exato** enviado, não um resumo. O `metadata.json` tem `model` preenchido — campo obrigatório, model pinning.

Invariante executor ≠ validador:

```bash
soma run gate --validate T-03 --validator soma-lab-T-03 ; echo "exit=$?"
```

**Observar:** recusa, porque `soma-lab-T-03` é o `executor_agent` que você acabou de gravar no `metadata.json`. Agora o outro lado, que é obrigatório:

```bash
soma run gate --validate T-03 --validator soma-lab-T-99 ; echo "exit=$?"
```

**Observar:** aceita. Se aceitar nos dois casos, o invariante não existe; se recusar nos dois, virou "recusa tudo". **Os dois lados precisam ser observados** — um só não prova nada.

---

## 5b. AC-12 — retenção de 7 dias

Não dá pra esperar 7 dias, então envelheça o artefato à mão:

```bash
# empurra o run-dir e o state para 8 dias atrás
find .soma/dispatches/run-lab-001 .soma/run-state-run-lab-001.json -exec touch -t "$(date -v-8d +%Y%m%d%H%M)" {} \;
soma run state --run run-lab-001 --set DONE
ls .soma/dispatches/ ; echo "exit=$?"
```

**Observar:** o run-dir de `run-lab-001` foi varrido, e a mesma janela valeu para o state — uma regra só, não duas. Se os dispatches sobreviverem e o state não (ou vice-versa), a retenção está duplicada em vez de compartilhada, que é justamente o que o AC-12 proíbe.

⚠️ `date -v-8d` é sintaxe **BSD/macOS**. Em Linux é `date -d '8 days ago' +%Y%m%d%H%M`.

---

## 6. AC-07 / AC-13 — framework-guard

```bash
cd "$HOME/Documents/- projetos claude code/soma-v2"
echo "// teste" >> hooks/thermal-guard.cjs
git add hooks/thermal-guard.cjs
git commit -m "teste do guard"
```

**Observar:** bloqueado, `exit 2`, e a saída **lista `hooks/thermal-guard.cjs`**. Não basta dizer "bloqueado".

Override:

```bash
SID="${CK_SESSION_ID:-$CLAUDE_SESSION_ID}"; [ -n "$SID" ] || { echo "ABORTE: nenhuma das duas env vars de sessão está setada"; }
touch "$(node -p 'require("os").tmpdir()')/claude-framework-guard-bypass-${SID}.marker"
git commit -m "teste do guard com override"
```

**Observar:** passa, **e a stderr declara que um override foi aplicado**, listando os paths liberados. Override silencioso é falha, não sucesso.

⚠️ **Duas armadilhas neste passo, as duas produzem falso-verde:**

1. Use `node -p 'require("os").tmpdir()'` de verdade — neste Mac o tmpdir **não é `/tmp`**.
2. O `sessionId` vem de `CK_SESSION_ID` **ou** `CLAUDE_SESSION_ID`, e **neste ambiente a segunda está vazia** (medido em 2026-08-15). Usar `${CLAUDE_SESSION_ID}` direto cria um marker com nome truncado, o guard não o encontra, e o passo "falha" por motivo errado — ou pior, você conclui que o override não funciona quando o problema é o nome do arquivo. Resolva as duas com fallback, como no bloco acima.

Limpe depois:

```bash
rm "$(node -p 'require("os").tmpdir()')/claude-framework-guard-bypass-${CLAUDE_SESSION_ID}.marker"
git reset --hard HEAD
```

---

## 7. AC-09 — o traceability voltou a rodar

O check que nunca rodou.

```bash
node hooks/spec-test-traceability.cjs validate core/specs/016-artifact-gated-trilho/spec.md ; echo "exit=$?"
grep -c "spec-test-traceability" install/soma-hooks-map.json
```

**Observar:** o comando **executa** (não morre com erro de sintaxe do `bash`) e emite payload com `coverage`, `orphan_tests`, `uncovered_ac`, `red_phase_evidence`. E o grep retorna ≥1 — sem registro no map, o hook é copiado e nunca dispara.

---

## 8. AC-08 — projeto antigo não quebra

```bash
OLD=$(mktemp -d) && cd "$OLD" && git init -q
soma run state --init --run run-legacy-001 ; echo "exit=$?"
```

**Observar:** roda em modo legado, com warning nomeando o que está degradado. **Não** é erro fatal.

---

## 9. Fechamento

```bash
cd "$HOME/Documents/- projetos claude code/soma-v2"
npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"
wc -l core/adapters/claude/commands/soma-run.md
```

**Observar:** ainda **5 fails** e nenhum a mais — os mesmos 5 conhecidos. E o `soma-run.md` em **≤300 linhas** (eram 492 em `2929f50`): é a poda obrigatória do §B.10, cobrada no Gate 2.

---

## Limpeza

```bash
rm -rf "$LAB" "$OLD"
cd "$HOME/Documents/- projetos claude code/soma-v2" && git status --short
```

Se algo tiver dado errado no repo de produção:

```bash
git reset --hard <SHA anotado no passo 0>
```
