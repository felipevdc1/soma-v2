# Global Install Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development` for every production change and `verification-before-completion` before each receipt. The root orchestrator does not implement production code.

**Goal:** Tornar `install.sh` independente de projeto/worktree, transacional e recuperável após crash, preservando o ledger local da Spec 018 e instalando o SOMA global com rollback exato.

**Architecture:** O `sync` mantém ownership exclusivo dos targets `kind:"file"`, mas recebe uma raiz explícita de ledger para a instalação global. Um módulo Node built-ins publica e recupera a transação durável antes de qualquer mutação live. O instalador apenas ordena: recovery, snapshot, adoção comprovada, cópia do core, sync, settings/anchors, verificação e commit. A adoção de target novo exige `--force-overwrite` e prova no journal PREPARED.

**Tech Stack:** Bash 3.2+, Node.js 22 built-ins, `node:test`, JSON atômico, filesystem local macOS. Windows e chezmoi estão fora de escopo.

---

## Regras de execução

- Cada task recebe `TaskContract` e dispatch duráveis em `.soma/runs/run-260824-global-install-transaction/` antes do agente iniciar.
- Cada executor grava receipt com commits, paths, comandos e resultados. O orquestrador só despacha, integra e verifica.
- RED precisa ser commitado antes de produção. GREEN fica em commit separado.
- Uma revisão integrada de spec e uma revisão de qualidade/crash após Task 4. A Emenda A-026-01 autoriza uma segunda e última onda somente para blockers novos descobertos na primeira revalidação.
- Falha repetida, conflito de ownership ou rollback não comprovado termina em `PAUSED_DIAGNOSTIC`; nenhuma mutação live é autorizada.

### Task 1: Fixar a raiz do ledger sem quebrar a Spec 018

**Files:**
- Modify: `core/scripts/sync.cjs`
- Modify: `core/scripts/__tests__/sync-file-entries.test.cjs`
- Modify: `core/scripts/__tests__/install-files-ledger.test.cjs`
- Modify: `core/specs/018-install-whole-files/contracts/installed-files-ledger.md`

- [ ] **Step 1: commit RED da seleção de raiz**

Adicionar testes que executam o `sync` real em dois `cwd` diferentes e exigem:

```js
assert.equal(fs.existsSync(path.join(globalRoot, '.soma', 'install-state.json')), true);
assert.equal(fs.existsSync(path.join(projectA, '.soma', 'install-state.json')), false);
assert.equal(fs.existsSync(path.join(projectB, '.soma', 'install-state.json')), false);
assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
```

Sem `--ledger-root`, manter o teste atual que exige `<cwd>/.soma/install-state.json`. Path relativo e raiz existente que seja symlink retornam `INVALID_ARGS`, exit 2, sem escrita.

- [ ] **Step 2: implementar a menor interface**

Estender `parseArgs()` com `ledgerRoot: null` e ambas as formas:

```js
--ledger-root=/absolute/path
--ledger-root /absolute/path
```

Adicionar um único resolver:

```js
function resolveLedgerRoot(flags) {
  const root = flags.ledgerRoot || process.cwd();
  if (!path.isAbsolute(root)) throw Object.assign(new Error('ledger root must be absolute'), { code: 'INVALID_ARGS' });
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw Object.assign(new Error('ledger root must not be a symlink'), { code: 'INVALID_ARGS' });
  }
  return root;
}
```

Passar a mesma raiz para `runFileApplyMode()` e para o read-only de dry-run. Não mudar `ledgerFilePath`, `readLedger` ou `writeLedger`: eles continuam recebendo uma raiz explícita.

- [ ] **Step 3: documentar os dois domínios**

Qualificar `CONTRACT-FILES-LEDGER-02`: o default continua sendo o projeto; a única exceção é a raiz explícita da Spec 026 para targets globais. Não criar fallback nem cópia entre ledgers.

- [ ] **Step 4: GREEN e commit**

```bash
node --test core/scripts/__tests__/sync-file-entries.test.cjs core/scripts/__tests__/install-files-ledger.test.cjs core/scripts/__tests__/contract-files-ledger.test.cjs
git diff --check
git commit -m "feat(sync): support explicit global ledger root"
```

### Task 2: Implementar o journal e rollback duráveis

**Files:**
- Create: `install/global-transaction.cjs`
- Create: `install/__tests__/global-transaction.test.cjs`

- [ ] **Step 1: commit RED da máquina de estados**

Cobrir no mínimo:

```js
PREPARING -> PREPARED -> ADOPTED -> CORE_COPIED -> FILES_SYNCED
          -> SETTINGS_MERGED -> ANCHORS_SYNCED -> VERIFIED -> COMMITTED
ROLLING_BACK -> ROLLBACK_VERIFIED -> ROLLED_BACK
```

Testes devem provar: journal/pointer inexistentes antes de `prepare`; `PREPARED` com snapshots completos; transição inválida bloqueada; pointer hash acompanha cada journal; arquivo, modo, ausência e diretório `~/.soma-v2` restaurados; quarantine preservado; `recover` retoma qualquer estado não terminal; journal corrompido retorna `RECOVERY_BLOCKED`; dry-run só reporta.

- [ ] **Step 2: implementar API pequena e CLI**

Exportar apenas:

```js
module.exports = {
  prepareTransaction,
  advanceTransaction,
  recoverActiveTransaction,
  rollbackTransaction,
  verifyPreparedAuthorization,
  hashFile,
  hashTree,
};
```

CLI fechada:

```text
prepare --repo-root ABS --home ABS --backup-root ABS --source-sha SHA [--no-codex] [--no-claude-md]
advance --transaction ABS --to STATE
rollback --transaction ABS
recover --backup-root ABS [--dry-run]
status --backup-root ABS
```

`prepare` calcula o allowlist a partir dos manifests antigo+candidato, templates/output styles e paths fixos da Spec 026. Ele copia somente paths declarados, registra ancestrais ausentes e rejeita symlink. Escritas de journal e pointer usam temp no mesmo diretório, `fsync` do arquivo e diretório e rename atômico. O pointer contém path absoluto e SHA-256 dos bytes correntes do journal.

- [ ] **Step 3: implementar rollback idempotente**

Para cada target: mover o parcial para `quarantine/`, restaurar snapshot+modo se existia ou remover apenas o que a tentativa criou. Repetir rollback deve produzir o mesmo pre-state. Depois publicar `ROLLBACK_VERIFIED`, liberar o pointer e publicar `ROLLED_BACK`; crash entre esses passos é retomável.

- [ ] **Step 4: GREEN e commit**

```bash
node --test install/__tests__/global-transaction.test.cjs
node install/global-transaction.cjs --help
git diff --check
git commit -m "feat(install): add durable global transaction"
```

### Task 3: Adoção comprovada e target novo autorizado

**Files:**
- Modify: `core/scripts/install/files.cjs`
- Modify: `core/scripts/sync.cjs`
- Modify: `core/scripts/__tests__/install-files.test.cjs`
- Modify: `core/scripts/__tests__/sync-file-entries.test.cjs`

- [ ] **Step 1: commit RED da matriz de ownership**

Exigir uma decisão total antes de escrever ledger:

```text
old target ausente                         -> skip
old target == old source                   -> adopt old hash
old target divergente/ilegível/symlink     -> GLOBAL_OWNERSHIP_CONFLICT
new target presente sem force              -> GLOBAL_OWNERSHIP_CONFLICT
new target presente com force+journal      -> adopt current hash
new target com force sem PREPARED ativo    -> RECOVERY_BLOCKED
```

O teste de múltiplos conflitos exige todos os paths e zero escrita.

- [ ] **Step 2: implementar o planner puro**

Adicionar:

```js
function planFileAdoption(candidateEntries, {
  candidateRoot,
  previousRoot,
  previousEntries,
  allowNewTargets = false,
  authorizeNewTarget = () => false,
}) { /* retorna { ok, conflicts, ledgerEntries } sem escrever */ }
```

Chaves continuam `target_path` verbatim. Entry antiga usa bytes de `previousRoot`; entry nova autorizada registra o hash live atual, para que o apply seguinte possa substituí-la pelo candidato.

- [ ] **Step 3: adicionar modo interno do sync**

CLI:

```text
--adopt-from=ABS --transaction-journal=ABS [--allow-new-target-overwrite]
```

Válida somente com `--apply`, `--tool` e `--ledger-root`. O sync valida o journal/pointer via `verifyPreparedAuthorization`; não aceita autorização declarada pelo payload. O modo só escreve o ledger depois do preflight total e nunca escreve target/bloco.

Adicionar também `--files-only` para o instalador poder respeitar `--no-claude-md` sem voltar ao rsync. O modo processa `kind:"file"` e não toca blocos.

- [ ] **Step 4: GREEN e commit**

```bash
node --test core/scripts/__tests__/install-files.test.cjs core/scripts/__tests__/sync-file-entries.test.cjs install/__tests__/global-transaction.test.cjs
git diff --check
git commit -m "feat(sync): adopt proven global file ownership"
```

### Task 4: Integrar o instalador e provar crash safety

**Files:**
- Modify: `install.sh`
- Modify: `install/__tests__/synthetic-env.test.sh`
- Create: `install/__tests__/global-install-transaction.test.cjs`
- Modify: `core/scripts/__tests__/efficient-rollout.test.cjs`
- Modify: `core/scripts/__tests__/install-sh-rsync-origins.test.cjs`

- [ ] **Step 1: commit RED end-to-end**

Em HOME temporário, cobrir: worktree A instala e B converge; project ledgers permanecem ausentes; legacy idêntico é adotado; legacy modificado bloqueia; `soma-run.md` novo exige force e mantém pre-state; `--no-claude-md`; instalação fresca; segunda instalação não reescreve; dry-run byte-idêntico.

Adicionar fault matrix para `ADOPTED`, `CORE_COPIED`, `FILES_SYNCED`, `SETTINGS_MERGED`, `ANCHORS_SYNCED` e `VERIFIED`, por exit, `INT`, `TERM` e um `SIGKILL` representativo. Cada caso compara hashes, modos e ausências ao pre-state e exige `ROLLED_BACK` após recovery em outro processo.

- [ ] **Step 2: tornar o preflight read-only**

Remover `mkdir/touch/rm` de Phase 0. Checar permissões dos ancestrais existentes sem criar path. Em startup, `recover --dry-run` apenas reporta; modo normal resolve o pointer antes de nova instalação.

- [ ] **Step 3: ordenar a transação**

Fluxo único em `install.sh`:

```text
read-only preflight
prepare -> PREPARED
adopt from snapshot antigo -> ADOPTED
copy core -> CORE_COPIED
sync --ledger-root "$HOME/.soma-v2" -> FILES_SYNCED
merge settings -> SETTINGS_MERGED
sync anchors -> ANCHORS_SYNCED
sync --dry-run + doctor + target/ledger verification -> VERIFIED
COMMITTED -> release pointer
```

Armar `EXIT`, `INT` e `TERM` logo depois de PREPARED; todos chamam o mesmo rollback. `SOMA_INSTALL_FAULT_AFTER=<STATE>` e `SOMA_INSTALL_CRASH_AFTER=<STATE>` existem apenas para canários.

- [ ] **Step 4: remover writers e warnings falsos**

Remover rsync genérico de hooks/commands declarados. Manter rsync apenas para `~/.soma-v2` e assets fora dos adapters, todos já no snapshot. Toda chamada Claude/Codex/doctor solicitada falha fechado; nenhuma usa `|| echo WARN` para converter falha em sucesso.

- [ ] **Step 5: GREEN focado e global**

```bash
node --test install/__tests__/global-transaction.test.cjs install/__tests__/global-install-transaction.test.cjs
bash install/__tests__/synthetic-env.test.sh
node --test core/scripts/__tests__/sync-file-entries.test.cjs core/scripts/__tests__/install-files.test.cjs core/scripts/__tests__/install-files-ledger.test.cjs core/scripts/__tests__/efficient-rollout.test.cjs core/scripts/__tests__/install-sh-rsync-origins.test.cjs
bash -n install.sh
npm test
git diff --check
git commit -m "fix(install): make global activation transactional"
```

### Task 5: Revisão, correção limitada e ativação live

**Files:**
- Modify only if review requires: paths authorized in Tasks 1–4
- Modify: `docs/superpowers/reports/2026-08-24-efficient-live-activation-diagnostic.md`
- Create: `docs/superpowers/reports/2026-08-25-global-install-transaction-result.md`

- [ ] **Step 1: duas revisões independentes**

Reviewer A verifica AC-01..AC-12, ownership e compatibilidade Spec 018. Reviewer B executa fault/crash matrix e procura perda de bytes, path/symlink escape e sucesso falso. Ambos recebem somente spec, plano, diff e receipts; não recebem narrativa privada.

- [ ] **Step 2: uma onda de correção**

Se houver blocker, um executor recebe somente findings reproduzidos, cria RED, corrige e retorna receipt. Os mesmos reviewers revalidam. Blocker residual pausa sem tocar HOME real.

- [ ] **Step 3: ativação live transacional**

Com worktree limpo e reviews `approved`, um agente de ativação:

```bash
bash install.sh --force-overwrite
cd "$HOME/.soma-v2"
node scripts/soma.cjs sync --dry-run --tool=claude --ledger-root="$HOME/.soma-v2"
node scripts/soma.cjs sync --dry-run --tool=codex --ledger-root="$HOME/.soma-v2"
node scripts/soma.cjs doctor --json --soma-home="$HOME/.soma-v2"
```

Antes do install, registra hashes do pre-state e ausência de processo Claude ativo. Depois, prova target hashes, ledger global, pointer ausente, sync/doctor verdes e ledger do projeto intocado. Se qualquer gate falhar, a própria transação restaura o HOME e o resultado fica `ROLLED_BACK / PAUSED_DIAGNOSTIC`.

- [ ] **Step 4: handoff durável**

Registrar source commit, receipts, comandos, resultados, backup/quarantine e estado live no relatório. Atualizar o diagnóstico antigo sem apagar a causa original.

## Self-review do plano

- AC-01..AC-12 têm owner e teste explícitos.
- Não existe Windows, chezmoi, daemon, dependência externa ou segundo writer de `kind:"file"`.
- Adoção perigosa depende de journal PREPARED ativo; `--force-overwrite` não libera target antigo divergente.
- Crash sem trap é recuperado por outro processo; dry-run nunca recupera nem escreve.
- O caminho crítico é sequencial e usa quatro tasks de implementação, dois reviewers e, pela Emenda A-026-01, no máximo duas correções; a segunda fica restrita à autoridade do journal e barreiras de durabilidade.
