# Spec: Instalação global transacional

**Feature ID:** 026-global-install-transaction  
**Status:** REVIEW_REQUIRED  
**Design aprovado em conversa:** 2026-08-24  
**Incidente de origem:** `run-260824-efficiency-live`

## Problema

O `install.sh` modifica assets globais em `~/.claude`, `~/.codex` e `~/.soma-v2`, mas o ledger usado por `sync.cjs` vive em `${PWD}/.soma/install-state.json`. Trocar de projeto ou worktree perde a prova de ownership dos mesmos destinos globais. O sync então classifica arquivos canônicos como estrangeiros e retorna `FILE_CONFLICT`.

O instalador também começa a copiar framework, hooks, commands e settings antes de armar um rollback completo. A ativação de 2026-08-24 falhou na Phase 7 depois de já atualizar `~/.soma-v2`, settings e três arquivos Claude. O rollback manual recuperou o pre-state, mas provou que a transação atual cobre somente uma parte do efeito.

## Resultado

Uma instalação global pode partir de qualquer diretório ou worktree e converge para o mesmo estado. Antes da primeira escrita live, o instalador prova ownership, captura todos os pre-states e publica uma transação durável. Sucesso atualiza assets e ledger juntos. Erro, sinal ou crash restaura os bytes anteriores, inclusive quando a recuperação ocorre em outro processo ou sessão.

## Fronteiras de ownership

Há dois domínios distintos:

| Domínio | Destinos | Ledger |
|---|---|---|
| instalação de projeto, via `soma install` | arquivos dentro do projeto e estado da instalação | `<project>/.soma/install-state.json` |
| instalação global, via `install.sh` | `~/.claude`, `~/.codex`, `~/.soma-v2` | `~/.soma-v2/.soma/install-state.json` |

O ledger de projeto continua com o contrato da Spec 018. O ledger global não é fallback nem cópia daquele arquivo. Cada ledger governa destinos diferentes. `sync.cjs` recebe a raiz explicitamente; o default continua `process.cwd()` para não alterar `soma install`.

## Decisões normativas

### D-026-01: raiz explícita do ledger global

`sync.cjs` aceita `--ledger-root=<path absoluto>`. Apply e dry-run usam a mesma raiz. `install.sh` sempre passa `--ledger-root=${HOME}/.soma-v2`. Chamadas sem a flag mantêm o comportamento de projeto atual.

Path relativo, symlink como raiz, raiz fora de `$HOME` no instalador global ou divergência entre apply e verificação falham antes de escrita.

### D-026-02: adoção exige prova anterior

Uma instalação anterior é reconhecida somente quando `~/.soma-v2/manifest.json` e o adapter antigo existem e são válidos. Antes de substituir o framework, o modo de adoção compara cada target live com sua fonte antiga:

| Situação | Resultado |
|---|---|
| target ausente | não adota; instalação normal poderá criar |
| target presente e hash igual à fonte antiga | grava ownership no ledger global |
| target presente e hash diferente da fonte antiga | `GLOBAL_OWNERSHIP_CONFLICT`, sem escrita |
| target novo no adapter candidato e ausente no adapter antigo | estrangeiro por padrão |

`--force-overwrite` só autoriza substituir um target novo no adapter candidato, ausente no adapter antigo. O instalador precisa preservar os bytes exatos antes. A flag nunca libera arquivo antigo modificado, symlink ou path fora do manifest.

O caso `soma-run.md` usa essa regra de migração. Não existe exceção codificada pelo nome do arquivo.

### D-026-03: sync é o único writer de `kind:"file"`

`install.sh` deixa de copiar hooks e commands declarados com `rsync`. O pipeline de arquivos do `sync` escreve target e ledger. O instalador apenas prepara a transação, invoca o sync e valida o resultado.

Templates e output styles que não estão no adapter continuam sob o instalador, mas entram no snapshot exato da transação antes de qualquer cópia.

### D-026-04: transação antes da primeira escrita live

O instalador pode criar um diretório novo de backup antes de `PREPARED`, pois isso não altera targets live. Nenhuma destas operações pode ocorrer antes de `PREPARED` durável:

- migração cbm/legacy;
- rename de colisão;
- cópia para `~/.soma-v2`, hooks, commands, templates ou output styles;
- merge de settings;
- alteração de CLAUDE.md ou AGENTS.md;
- escrita de ledger.

O preflight de permissão passa a ser somente leitura. O snapshot registra existência, hash, modo e origem de recuperação para cada target. Diretórios são representados pelos arquivos candidatos que podem ser sobrescritos; o instalador não varre nem arquiva arquivos alheios.

### D-026-05: journal durável e recuperação idempotente

Cada execução usa um diretório no-clobber em `~/.soma-v2-backups/`. O controle está em:

- `~/.soma-v2-backups/.active-transaction.json`: ponteiro atômico para a transação;
- `<backup>/transaction.json`: estado, source SHA, manifest de pre-state, fases e hashes.

Estados válidos:

```text
PREPARING -> PREPARED -> ADOPTED -> CORE_COPIED -> FILES_SYNCED
          -> SETTINGS_MERGED -> ANCHORS_SYNCED -> VERIFIED -> COMMITTED

qualquer estado mutante -> ROLLING_BACK -> ROLLBACK_VERIFIED -> ROLLED_BACK
```

Antes de uma nova instalação, o startup resolve qualquer ponteiro ativo:

- `COMMITTED`: remove o ponteiro de forma idempotente;
- `ROLLBACK_VERIFIED`: conclui release e publica `ROLLED_BACK`;
- outro estado não terminal: retoma rollback até `ROLLED_BACK`;
- journal ausente, corrompido ou com hash inválido: `RECOVERY_BLOCKED`, sem nova mutação.

Cada transição usa replace atômico e sincroniza arquivo e diretório no envelope de filesystem local suportado. `INT`, `TERM` e `EXIT` chamam o mesmo rollback. Crash sem trap é recuperado no próximo startup.

### D-026-06: rollback exato

Rollback restaura o conteúdo e modo anteriores ou remove somente o target que não existia. O estado que falhou fica em quarantine dentro do backup. O instalador não apaga backup nem quarantine automaticamente.

Rollback precisa cobrir:

- `~/.soma-v2` completo ou sua ausência;
- `~/.claude/settings.json`;
- `~/.claude/CLAUDE.md`;
- `~/.codex/AGENTS.md`;
- todos os targets `kind:"file"` dos adapters envolvidos;
- cada template e output style que a execução pode sobrescrever;
- arquivos auxiliares criados pela execução, como backup de settings.

### D-026-07: commit fail-closed

`COMMITTED` só é publicado depois de:

1. todos os targets live baterem com suas fontes candidatas;
2. o ledger global conter os mesmos hashes;
3. `sync` read-only não reportar conflito ou drift;
4. `doctor` não reportar erro nos adapters instalados;
5. Codex e Claude solicitados concluírem sem warning convertido em sucesso.

Phase 8 e doctor não podem engolir exit não-zero durante a transação.

## Máquina operacional

```text
startup recovery
  -> read-only preflight
  -> create unique backup
  -> capture exact pre-state
  -> PREPARED
  -> adopt proven old ownership, when applicable
  -> copy candidate core
  -> sync global file targets with explicit ledger root
  -> merge settings and sync anchors
  -> verify target, ledger, sync and doctor
  -> COMMITTED
  -> release pointer
```

Qualquer seta depois de `PREPARED` pode sofrer fault injection. O estado final permitido é candidato completo ou pre-state completo. Estado parcial nunca é sucesso.

## Acceptance Criteria

### AC-01: troca de worktree preserva ownership

Given uma instalação global concluída no worktree A  
When dry-run e apply são executados no worktree B com a mesma fonte  
Then os dois usam `~/.soma-v2/.soma/install-state.json`, não criam ledger em A ou B e não reportam `FILE_CONFLICT` falso.

### AC-02: projeto mantém o contrato da Spec 018

Given `soma install` sem `--ledger-root`  
When o sync grava o ledger  
Then o path continua `<project>/.soma/install-state.json` e nenhum estado global é criado.

### AC-03: instalação antiga é adotada com prova

Given target live byte-idêntico à fonte do framework antigo e ledger global ausente  
When a adoção roda antes do upgrade  
Then o ledger registra o hash antigo sem reescrever o target e o upgrade seguinte pode substituí-lo.

### AC-04: arquivo antigo modificado bloqueia tudo

Given qualquer target antigo divergente, symlink ou ilegível  
When o preflight de ownership roda  
Then retorna `GLOBAL_OWNERSHIP_CONFLICT`, nomeia todos os paths e nenhum target live, ledger ou settings muda.

### AC-05: novo target exige autorização explícita

Given target candidato ausente no adapter antigo, mas presente no HOME  
When a instalação roda sem `--force-overwrite`  
Then bloqueia antes de escrita. Com a flag, preserva os bytes exatos e permite substituição dentro da transação.

### AC-06: nenhum rsync escreve targets declarados

Given hooks e commands `kind:"file"`  
When `install.sh` executa  
Then somente `sync` os escreve e atualiza o ledger na mesma operação.

### AC-07: PREPARED antecede toda mutação

Given instrumentação nos mutadores do instalador  
When qualquer rename, copy, merge, migration, sync ou ledger write começa  
Then `transaction.json` já está em `PREPARED` e seu hash consta no ponteiro ativo.

### AC-08: fault injection restaura o pre-state

Given fault injection depois de cada fase mutante  
When o processo falha ou recebe `INT`/`TERM`  
Then rollback restaura todos os hashes e ausências anteriores, preserva quarantine e publica `ROLLED_BACK`.

### AC-09: crash é retomado por outro processo

Given processo morto sem executar trap em qualquer fase mutante  
When uma nova sessão inicia `install.sh`  
Then ela conclui o rollback pendente antes de novo preflight e não depende de memória privada.

### AC-10: sucesso é completo e idempotente

Given instalação sem conflito  
When termina e roda novamente de outro diretório  
Then target, ledger, sync e doctor ficam verdes, a segunda execução não reescreve assets inalterados e não cria estado parcial.

### AC-11: dry-run é puro

Given HOME vazio, instalação antiga ou transação pendente  
When `install.sh --dry-run` roda  
Then não cria, move, remove ou altera nenhum path. Transação pendente é reportada, não recuperada em dry-run.

### AC-12: limites da run

Given esta feature  
When implementada  
Then não adiciona Windows, chezmoi, daemon, dependência externa, retry automático acima de duas tentativas ou um segundo writer de `kind:"file"`.

## Testes obrigatórios

- testes unitários do parser e da seleção de ledger root;
- testes de adoção com fonte antiga válida, divergência, symlink, target novo e force;
- canário sintético com dois worktrees e um HOME;
- fault matrix após cada transição mutante, incluindo morte sem trap;
- rollback byte a byte, modos e ausências;
- instalação fresca e upgrade legado;
- segunda instalação sem escrita;
- regressão do ledger de projeto da Spec 018;
- dry-run com snapshot de filesystem antes e depois.

Suítes focadas rodam em RED/GREEN. A suíte global roda uma vez no gate final, com REDs deliberados preexistentes separados do delta desta feature.

## Execução eficiente

- um executor por unidade, sem implementação pelo orquestrador;
- prompts até 8 KB e outputs até 4 KB;
- uma revisão integrada de spec e uma revisão de qualidade focada em crash/ownership;
- uma onda de correção e revalidação;
- blocker residual termina em `PAUSED_DIAGNOSTIC`.

## Fora de escopo

- Windows, PowerShell e chezmoi;
- mudar o ledger de projeto da Spec 018;
- P1 a P6, Chronicle ou um novo sistema de eventos;
- apagar backups automaticamente;
- ativação live antes de implementação e revisões aprovadas.
