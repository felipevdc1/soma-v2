# Workflow chains — o mapa de transições do SOMA

**D18 do desenho v3.** Um mapa, não uma engine: os comandos leem esta tabela e sugerem o próximo passo.

O problema que isto resolve: o SOMA tem ~12 comandos e ninguém decora a ordem. Quem não decora, para —
e parar por não saber o nome do próximo comando é o pior tipo de atrito, porque é atrito de memória, não
de trabalho. Cada comando passa a terminar dizendo o que vem depois.

## O mapa

| Você acabou de… | Próximo passo (recomendado) | Alternativas |
|---|---|---|
| ter uma ideia vaga ou travada | `/elicit` | só conversar, se ainda for cedo demais |
| aprovar um brief (veredito `go`) | `/specify` | refinar o brief antes |
| receber veredito `precisa-clarificar` | investigar o que falta | `/elicit` de novo depois |
| receber veredito `kill` | nada — está fechado com motivo | reabrir se o contexto mudar |
| ter uma spec `APPROVED` | `/plan-sdd` | `/elicit` de novo, se mudou de ideia |
| ter plan + tasks prontos | `/soma-run` | `/dispatch` manual, quando é 1 task só |
| ver o `/soma-run` chegar em DONE | `/sonar-audit`, se ainda não rodou | `/handoff` |
| receber findings do SONAR | corrigir → re-auditar | promover finding a proposta (Fase 4) |
| terminar sessão com trabalho aberto | `/handoff` | `/encerrar` |
| pegar um bug | `/hyd` antes de mexer | reproduzir primeiro, se for barato |

## Regras de uso

1. **Sugira, não obrigue.** A última linha do output vira `**Próximo passo**: {comando}` com a
   alternativa entre parênteses quando fizer sentido. O usuário decide.
2. **Sugira pelo estado real, não pelo comando que você rodou.** Uma spec que saiu com
   `[NEEDS CLARIFICATION]` em aberto não está `APPROVED` — o próximo passo dela é resolver os markers,
   não `/plan-sdd`.
3. **Quando não souber, não invente.** Sem estado claro, ofereça as duas transições mais prováveis e
   deixe escolher.
4. **`/handoff` propaga o mapa.** Cada bucket carrega um campo `next_command` com o comando literal que
   a próxima sessão vai digitar — é o mapa atravessando a fronteira da sessão.

## Manutenção

Comando novo entra aqui **antes** de entrar em circulação, senão vira órfão que ninguém encontra. Esta
tabela é a fonte; os comandos a espelham numa linha cada.

*Criado na Fase 1 do SOMA v3 (task F1.4). Consumidores hoje: `/elicit`, `/specify`, `/plan-sdd`,
`/sonar-audit`, `/handoff`.*
