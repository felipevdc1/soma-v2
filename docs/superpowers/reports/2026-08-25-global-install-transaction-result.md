# Resultado da ativação global transacional

Status: `INSTALLED_VERIFIED`

Data: 2026-08-25

Run: `run-260824-global-install-transaction`

Candidato: `0e2c48e2228296a9b8011853ab836b238f6d3cfd`

## Decisão e pré-condições

O usuário autorizou decisões operacionais e uma ativação live. O contrato permitia uma única chamada mutante, com rollback pertencente à própria transação e sem retry.

Antes da mutação:

- HEAD era exatamente o candidato e não havia mudança rastreada. Os arquivos não rastreados estavam restritos a `.soma/` operacional.
- R1-SPEC attempt 3 e R2-CRASH attempt 3 estavam `approved`.
- Não havia processo Claude ou claude ativo.
- `bash -n install.sh` passou.
- O gate focado passou 72/72 e o gate de integração passou 35/35, ambos com HOME temporário.
- Recovery era `NONE`; o ponteiro ativo, o ledger global e `.soma/install-state.json` deste worktree estavam ausentes.

## Prestate registrado

Os modos são octais. Para `~/.soma-v2`, o SHA-256 cobre recursivamente tipo, caminho relativo, modo, conteúdo e destino de symlink em ordem determinística.

| Alvo | Existia | Modo | SHA-256 |
|---|---:|---:|---|
| `~/.claude/settings.json` | sim | 0644 | `aaac4d3d265847a1197803ed0eb8db2f5a10472cdeeb69e6aaf0d547346b0c11` |
| `~/.claude/CLAUDE.md` | sim | 0644 | `3ba984a9ccf878aa95682f1651dd6f2346a6c8b56d438efac708507978579f44` |
| `~/.codex/AGENTS.md` | sim | 0644 | `f490996472b31df9d2551793c0f3715baa764adb99767f715f406bc11530943c` |
| `~/AGENTS.md` | sim | 0644 | `cad7fef544f9311788ef1f27b2816f743cbab1ae42c00aecb3da0b14003cd027` |
| `~/.claude/commands/soma-run.md` | sim | 0644 | `909244aea39394434dc4cac58a956257a6c8421fb3f1f1aff8ae1a458d304b7b` |
| `~/.claude/hooks/framework-guard.cjs` | sim | 0644 | `cd4a20ddb6053a159ed7d8d1a1ca630f131348238586aca99260fbff215b7f02` |
| `~/.claude/commands/handoff.md` | sim | 0644 | `31ffa032c6e346a3bf59d676e059d1a5f57af3d84d2f8cc46ffa9add9adac2b6` |
| `~/.claude/commands/sonar-audit.md` | sim | 0644 | `d386a61e3db9ff2d64bb4a65debc53d5f8f2b92d8557ea21a6757eae4b5de214` |
| `~/.soma-v2` | sim | 0755 | `d68b940e3ea4b12d2ce10c5ae44de45f03f378732e25b07a58e90064a28d502c` |
| ledger global | nao | n/a | n/a |
| ponteiro ativo | nao | n/a | n/a |
| ledger do worktree | nao | n/a | n/a |

## Ativação única

Comando executado exatamente uma vez:

```bash
bash install.sh --force-overwrite
```

Exit: 0. O instalador imprimiu `VERIFIED` e `COMMITTED`.

Transação e backup:

`/Users/felipevdc1/.soma-v2-backups/1787630804278-91966-0151ec12d8b528e8`

Journal:

`/Users/felipevdc1/.soma-v2-backups/1787630804278-91966-0151ec12d8b528e8/transaction.json`

Estado final do journal: `COMMITTED`, geração 9. SHA-256 do journal: `4d3f95a95aa487da8220ff5cb3592876233283de1433594ee522e243e998c46e`.

## Verificação pós-instalação

- Ponteiro ativo ausente; recovery read-only retornou `{"status":"NONE"}`.
- `~/.soma-v2/.soma/install-state.json` existe, modo 0644, SHA-256 `b2cde4f342a2355561cb3ed3f9b3eaf1128905902984db1a1e560900753df077`.
- Os 32 `kind:"file"` declarados têm o mesmo SHA-256 no candidato, na fonte instalada, no alvo live e no ledger. Mismatches: 0.
- `.soma/install-state.json` deste worktree continuou ausente.
- A partir de `~/.soma-v2`, os dry-runs Claude e Codex saíram 0 e responderam `All entries in sync. No actions needed.`
- O doctor saiu 0. `errors` e `warnings` estão vazios; todos os findings de Claude e Codex têm severity `ok`.

## Poststate dos alvos observados

| Alvo | Modo | SHA-256 |
|---|---:|---|
| `~/.claude/settings.json` | 0644 | `979e44bfd590306830e50216030619a4f819157a4dcbe4b148cb6e4f718423c5` |
| `~/.claude/CLAUDE.md` | 0644 | `d179792fed9382026eace719769e06a9a891331cb5033d4eaaf4fdf372feafc7` |
| `~/.codex/AGENTS.md` | 0644 | `f490996472b31df9d2551793c0f3715baa764adb99767f715f406bc11530943c` |
| `~/AGENTS.md` | 0644 | `cad7fef544f9311788ef1f27b2816f743cbab1ae42c00aecb3da0b14003cd027` |
| `~/.claude/commands/soma-run.md` | 0644 | `016906b4e1d064b2d324527307fa203c5dd51b3c412217163a24b8bfb3121f4b` |
| `~/.claude/hooks/framework-guard.cjs` | 0644 | `0bc16bc3b915e5f8db73c80c482a20c185bd41eaaad6d3e3b6efe5e5131e7d83` |
| `~/.claude/commands/handoff.md` | 0644 | `351ac3b509d0644ad8be4b2a792548b3d6d0873eadf05c0fa941258755a4910a` |
| `~/.claude/commands/sonar-audit.md` | 0644 | `71fc3ca515dab4c9567c3ab2273beb197eddb5c7638277ea0589b46cfaceb0db` |
| `~/.soma-v2` | 0755 | `aa989f798411a29027618c2d7a7db20fa1f3619e86e384db3957e1825c130dc8` |

O resultado terminal desta ativação é `INSTALLED_VERIFIED`. A repetição do install permaneceu proibida.
