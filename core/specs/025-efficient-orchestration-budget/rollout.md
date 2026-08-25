# Rollout autorizado: Claude live + anchor Codex

**Run:** `run-260824-efficiency-rollout`  
**Base:** `01f757769da44c925aa0848618aecf4962463cb9`  
**Autoridade:** autorização do usuário em 2026-08-24 para fechar os dois blockers do diagnóstico anterior.

## Escopo fechado

1. Corrigir o marker `block.codex.AGENTS.soma-stsd` com `computeBlockSha256` sobre o corpo extraído, nunca com hash do arquivo inteiro.
2. Remover a exclusão histórica de `soma-run.md` agora revogada pelo usuário e instalá-lo como whole-file Claude.
3. Tornar o bloco STSD instalado explicitamente prevalente sobre qualquer seção Recovery unmanaged anterior no mesmo arquivo; não criar migrador nem envolver chezmoi.
4. Provar em HOME temporário que sync/install atualiza o bloco Claude e o comando `soma-run.md`, e que doctor reconhece o anchor Codex como íntegro.
5. Depois de revisão aprovada, aplicar o mesmo caminho canônico no ambiente live, com snapshot/rollback existente.

## Acceptance Criteria

- **R-01:** `extractBlock(AGENTS, id).attrs.sha256 === computeBlockSha256(content)`.
- **R-02:** `install-targets.json` contém uma entry `kind:"file"` para `adapters/claude/commands/soma-run.md` e não o lista em `excluded`.
- **R-03:** `install.sh` não exclui `soma-run.md` do rsync.
- **R-04:** o bloco STSD declara precedência sobre Recovery unmanaged anterior e continua dentro dos limites 8 KB/4 KB, duas tentativas e uma correção.
- **R-05:** canary em HOME temporário prova bloco, comando e doctor/sync sem tocar o ambiente live.
- **R-06:** ativação live só ocorre depois das revisões e deixa prova de snapshot, hashes pós-aplicação e doctor verde.
- **R-07 (amenda pós-revisão):** `sync` é o único writer de `soma-run.md` e de sua entry em `installedFiles`; `install.sh` protege o pre-state, delega a escrita ao sync e restaura automaticamente se ele falhar. Esta garantia substitui o detalhe anterior de R-03 que atribuía a cópia ao rsync genérico.
- **R-08 (crash safety):** a Phase 7 trata `soma-run.md` e `.soma/install-state.json` como uma única transação: qualquer erro, `INT` ou `TERM` restaura exatamente os dois pre-states antes de sair; sucesso só é publicado depois de validar target+ledger. Cada invocação usa backup no-clobber único, inclusive dentro do mesmo segundo.

## Execução eficiente

Um executor, um commit, uma revisão de spec e uma revisão de qualidade. Uma correção somente se um reviewer apontar blocker. Retornos e prompts ficam no `dispatch-record` desta run.

## Stop

Pare se for necessário criar migrador, alterar chezmoi, sobrescrever arquivo live sem snapshot ou tocar qualquer escopo além dos dois blockers.
