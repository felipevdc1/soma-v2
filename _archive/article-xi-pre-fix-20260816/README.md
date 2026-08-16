# Telemetria do Article XI — arquivo pré-fix

**Arquivado em:** 2026-08-16, depois de estancar o vazamento (não antes).

## Por que está aqui

22.424 eventos, dos quais a esmagadora maioria é **fixture de teste**, não uso
humano. Amostragem do arquivo de 2026-08-16: as "sessions" mais frequentes eram
`ac01-a`, `ac01-b`, `ac01-c`… com 350 eventos cada, e havia 3.178 sessions
distintas num único dia.

Ratificar o Article XI (Capture Imperative) exige medir taxa de captura real.
Num log em que 95%+ é teste, essa medição não significa nada.

## A causa, e ela não era a que se supunha

O diagnóstico corrente era "os testes não setam `ARTICLE_XI_LOG_DIR`". Falso — o
executor provou setando: o delta não mudou e o diretório de override nunca foi
criado.

A causa real: `~/.claude/hooks/capture-defer-gate.cjs`, o hook **vivo**, era uma
cópia de **5 de maio de 2026**, anterior ao commit `1d467af` (2026-08-15) que
criou o mecanismo de isolamento. O binário não sabia ler a variável.

E não era um hook: eram **seis** defasados, mais seis arquivos de teste.

## O que foi feito

1. Backup de `~/.claude/hooks/` em `~/.claude/backups/hooks-20260816-201439` (36 arquivos)
2. Sincronizados 6 hooks e 6 testes do repo para a instalação viva
3. Adaptação de layout: os testes do repo vivem em `hooks/__tests__/` e referenciam
   o alvo por `../`; a instalação viva é **plana** e precisa de `./`. Duas sintaxes
   distintas — `path.join(__dirname, '..', X)` e `require('../X')`
4. Verificado nos dois sentidos: os gates de commit bloqueiam com marker aberto e
   liberam com spec limpa; suíte de volta ao baseline de 27 fails; delta de
   telemetria **0** (era 190 por rodada)

## O que ficou em aberto

**Não existe instalador que faça a adaptação de layout do passo 3.** Foi por isso
que a instalação viva ficou três meses defasada — sincronizar é trabalho manual e
ninguém sabia que precisava ser feito. Pior: `soma doctor` reporta
`No drift detected`, porque confere `~/.soma-v2` e **não olha `~/.claude/hooks/`**.

A defasagem era invisível para a ferramenta construída para detectar defasagem.

## Janela limpa

A coleta de telemetria real começa em 2026-08-16, depois deste arquivamento.
