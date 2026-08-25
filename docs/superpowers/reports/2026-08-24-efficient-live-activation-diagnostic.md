# Diagnóstico da ativação live eficiente

Status: `PAUSED_DIAGNOSTIC`

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
