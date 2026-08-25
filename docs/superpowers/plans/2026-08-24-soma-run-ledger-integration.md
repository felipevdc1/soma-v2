# SOMA Run Ledger Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o rollout de `soma-run.md` convergir pelo writer canônico de `installedFiles`, de modo que `install.sh` seguido de `sync` seja idempotente e recuperável.

**Architecture:** `sync.cjs` continua sendo o único owner do ledger e da escrita whole-file. `install.sh` coordena uma pequena transação: backup do arquivo anterior, não o copia no rsync genérico, deixa Phase 7 `sync --apply` instalar+registrar e restaura o backup se o sync falhar. Nenhum novo comando, módulo ou formato.

**Tech Stack:** Bash, Node.js built-ins, `soma sync`, `soma-install-state/v1`.

---

### Task 1: Instalação transacional pelo writer canônico

**Files:**
- Modify: `install.sh`
- Modify: `install/__tests__/synthetic-env.test.sh`
- Modify: `core/scripts/__tests__/install-sh-rsync-origins.test.cjs`
- Modify: `core/scripts/__tests__/efficient-rollout.test.cjs` somente se a assertion R-03 precisar refletir ownership único

- [ ] **Step 1: escrever o RED de upgrade seguido de sync**

No HOME/projeto sintético, semear `~/.claude/commands/soma-run.md` customizado e um `.soma/install-state.json` válido com todas as entries antigas, mas sem `~/.claude/commands/soma-run.md`. Após `install.sh`, exigir:

```js
assert.equal(installedFiles['~/.claude/commands/soma-run.md'].sha256, canonicalSha);
assert.equal(fs.readFileSync(livePath), fs.readFileSync(canonicalPath));
assert.equal(runSyncAgain().status, 0);
```

Executar o teste e confirmar `FILE_CONFLICT` por ausência da entry antes de mudar produção.

- [ ] **Step 2: escrever o RED de rollback**

Forçar falha da Phase 7 depois que o arquivo anterior foi protegido. Exigir exit não-zero, bytes antigos restaurados no live path e backup preservado.

- [ ] **Step 3: implementar a menor transação em `install.sh`**

Reintroduzir `--exclude=soma-run.md` apenas no rsync genérico, pois `sync` passa a ser o owner exclusivo. Imediatamente antes da Phase 7, se houver arquivo anterior, movê-lo para staging após o backup já provado. Rodar `soma sync --apply --tool=claude` sem engolir falha. Em sucesso, confirmar target+ledger; em falha, restaurar o staging e sair não-zero. `--no-claude-md` não move nem altera o arquivo.

- [ ] **Step 4: GREEN focado**

```bash
bash install/__tests__/synthetic-env.test.sh
node --test core/scripts/__tests__/efficient-rollout.test.cjs core/scripts/__tests__/install-sh-rsync-origins.test.cjs core/scripts/__tests__/install-targets-set.test.cjs
bash -n install.sh
git diff --check
```

Esperado: upgrade+ledger+segundo sync verdes; rollback restaura bytes; nenhuma mutação live.

- [ ] **Step 5: commit único e handoff**

```bash
git add install.sh install/__tests__/synthetic-env.test.sh core/scripts/__tests__/install-sh-rsync-origins.test.cjs core/scripts/__tests__/efficient-rollout.test.cjs
git commit -m "fix(install): let sync own soma run ledger"
```

## Self-review

- Cobertura: upgrade, ledger, idempotência e rollback são provados.
- Não há placeholder, módulo novo, chezmoi ou writer paralelo.
- A antiga R-03 (“rsync copia”) é substituída pela garantia mais forte: install coordena, sync escreve e registra.
