# Diagnóstico da ativação live eficiente

Status original: `ROLLED_BACK / PAUSED_DIAGNOSTIC`

Status atual: `RESOLVED / INSTALLED_VERIFIED` em 2026-08-25

Data: 2026-08-24

Candidato aprovado: `0220a8714c611fe35e5fcbd6c842d3429af2e227`

## Resultado

A primeira tentativa parou antes da escrita porque duas sessões Claude estavam ativas e `~/.claude/CLAUDE.md` havia mudado. A segunda tentativa começou depois de duas leituras estáveis com zero processo Claude. O instalador saiu com `FILE_CONFLICT` na Phase 7. O limite de duas tentativas impede retry automático.

Backup preservado:

`/Users/felipevdc1/.soma-v2-backups/1787619716.udXQh2`

## Causa confirmada

`sync.cjs` lê o ledger de arquivos em `${PWD}/.soma/install-state.json`. O worktree da ativação não tinha esse arquivo. Os 32 arquivos globais Claude já existiam, então o `sync` classificou todos como estrangeiros, mesmo quando seus bytes eram canônicos.

Esse contrato não sobrevive a troca de worktree. O destino é global em `~/.claude`, mas a prova de ownership fica presa ao diretório de projeto que executou o comando.

## Estado live após a falha

Os três arquivos protegidos pela ativação conservaram seus pre-states:

- `~/.claude/CLAUDE.md`: `3ba984a9ccf878aa95682f1651dd6f2346a6c8b56d438efac708507978579f44`
- `~/.claude/commands/soma-run.md`: `909244aea39394434dc4cac58a956257a6c8421fb3f1f1aff8ae1a458d304b7b`
- `~/.codex/AGENTS.md`: `f490996472b31df9d2551793c0f3715baa764adb99767f715f406bc11530943c`

O instalador não é atômico antes da Phase 7. Estas mudanças parciais ocorreram:

- `~/.claude/settings.json` passou de zero para 15 entries `_soma_managed`.
- `~/.claude/hooks/framework-guard.cjs` recebeu o candidato.
- `~/.claude/commands/handoff.md` recebeu o candidato.
- `~/.claude/commands/sonar-audit.md` recebeu o candidato.
- `~/.soma-v2` recebeu o framework candidato.

Entre os 32 `kind:file` Claude, 31 agora são byte-idênticos ao candidato. `soma-run.md` é o único diferente. Nenhum processo Claude estava ativo durante a tentativa.

## Próxima decisão

Não abrir Claude enquanto o ambiente estiver parcial.

A opção segura imediata é restaurar settings, os três arquivos alterados e `~/.soma-v2` a partir do backup. Depois, uma nova run deve corrigir dois contratos antes de tentar ativação:

1. o ledger de assets globais precisa de uma raiz estável entre projetos e worktrees;
2. o instalador precisa validar ownership e preparar rollback antes de qualquer cópia ou merge live, não apenas na Phase 7.

Não criar ledger manual nem adotar arquivos por hash sem um contrato explícito. Isso esconderia o defeito que a run acabou de provar.

## Rollback concluído

O usuário autorizou a restauração. A run `run-260824-efficiency-rollback` restaurou o pre-state do backup e preservou o estado parcial em:

`/Users/felipevdc1/.soma-v2-backups/1787619716.udXQh2/failed-attempt-dot-soma-v2-a2`

Verificação independente confirmou:

- zero processo Claude;
- zero entry `_soma_managed` em settings;
- os sete hashes de settings, anchors, comando e arquivos alterados iguais ao backup ou à `.soma-v2` antiga;
- `.soma-v2` byte-idêntica a uma extração fresca de `dot-soma-v2.tgz`;
- ledger do worktree ausente e tracked diff limpo.

O ambiente live voltou ao estado anterior. A correção do ledger global e da atomicidade continua pendente em uma nova run. Nenhuma nova ativação está autorizada por este receipt.

## Resolução transacional em 2026-08-25

A run `run-260824-global-install-transaction` corrigiu as duas causas acima antes de uma nova ativação. O ledger de arquivos passou a usar `~/.soma-v2/.soma/install-state.json`, independente do worktree, e o instalador passou a preparar snapshot, journal autenticado, ponteiro ativo e rollback antes da primeira mutação.

Os reviews independentes R1-SPEC e R2-CRASH, ambos na terceira tentativa, aprovaram o candidato `0e2c48e2228296a9b8011853ab836b238f6d3cfd`. Os gates isolados passaram com 72/72 e 35/35 testes. Não havia processo Claude ativo.

A ativação autorizada ocorreu uma única vez com `bash install.sh --force-overwrite`. O comando saiu com código 0 e publicou `VERIFIED` e `COMMITTED`. A transação e seu backup estão em:

`/Users/felipevdc1/.soma-v2-backups/1787630804278-91966-0151ec12d8b528e8`

Depois do commit transacional, o ponteiro ativo ficou ausente, recovery retornou `NONE`, os 32 arquivos inteiros declarados ficaram idênticos entre candidato, instalação global, alvos e ledger, e o ledger deste worktree continuou ausente. Os dry-runs Claude e Codex não propuseram ações. O doctor saiu com código 0, sem errors, warnings, drift ou missing.

O relatório completo da resolução está em `docs/superpowers/reports/2026-08-25-global-install-transaction-result.md`.
