# Design do gate de triagem pré-remediação

**Status:** aprovado para documentação
**Data:** 2026-08-28
**Escopo:** Constituição do SOMA e adapters Claude/Codex

## Contexto

Uma run pode acumular falhas de identidades de teste ou falhas herdadas entre
componentes. Corrigir a primeira ocorrência sem entender a dependência entre
elas favorece dupla contagem, correções conflitantes e novos desvios. A regra
de triagem deve orientar a decisão antes de qualquer remediação, sem criar um
novo gate no CLI.

## Decisão

Adotar uma regra normativa testada. Ela será propagada à Constituição e aos
adaptadores Claude e Codex, preservando o contrato de adapter e o fluxo já
existente. O gatilho ocorre quando há pelo menos 10 identidades de teste
falhando, ou quando um conjunto de falhas herdadas ou compartilhadas só pode
ser integrado por meio de uma exceção.

A triagem usa exatamente um agente, uma tentativa e apenas evidências já
existentes. O executor pode ler somente a allowlist de evidências deste
contrato, usando parsers locais determinísticos, e pode escrever somente o
relatório de triagem. São proibidos rede, mutação Git, package manager, test
runner, build, lint, install, product CLI, execução do produto e qualquer outro
arquivo alterado. Dispatch, checkpoint e handoff são posteriores e pertencem
ao coordinator. O limite global de tokens por run fica fora do escopo.

## Alternativas rejeitadas

- Criar um gate novo no CLI. Isso duplicaria a autoridade normativa e ampliaria
  a superfície desta mudança.
- Rodar uma nova suíte para descobrir a causa. Isso viola o caráter somente
  observacional da triagem e confunde diagnóstico com remediação.
- Delegar a triagem a vários agentes ou permitir retries. Isso quebra o limite
  de uma evidência única e pode produzir clusters incompatíveis.
- Corrigir automaticamente quando a causa parece provável. Sem causa conhecida
  e risco de acoplamento registrado, a ação correta é adiar.
- Usar um limite global de tokens como critério adicional. Esse limite não faz
  parte desta decisão.

## Contrato operacional

O gatilho herdado ou por exceção é o predicado: a full suite não é zero; uma
comparação semântica registra ao menos uma identidade `shared`; a integração
seria bloqueada pelo gate; e o operador considera integrar sem tornar a full
suite verde. A triagem ocorre antes da autorização da exceção.

O agente deve consolidar identidades em clusters sem dupla contagem. A chave de
cluster é `(componente proprietário, assinatura normalizada, causa candidata)`.
Duas causas são independentes quando não compartilham essa chave nem uma
dependência causal documentada. Para cada cluster, a saída registra a contagem,
os arquivos de prova, a confiança `VERIFIED`, `INFERENCE` ou `HYPOTHESIS`, a
causa raiz ou candidata e o risco de acoplamento.

Acoplamento baixo significa um módulo sem contrato compartilhado. Médio
significa vários arquivos de um módulo ou um contrato compartilhado com
consumidores enumerados. Alto significa múltiplos módulos, estado,
orquestração ou schema com blast radius não enumerado. `HYPOTHESIS` ou
identidade não mapeada bloqueia `GO`.

## Evidência e relatório

A allowlist contém apenas arquivos existentes sob
`.soma/diagnostics/<source-run>/` ou artefatos de dispatch, checkpoint e
handoff referenciados por esse run. O relatório registra `path` e `sha256` de
cada input. Cada identidade falha deve ser mapeada exatamente uma vez. Cada
cluster cita um artefato com identidade normalizada e `expected`/`actual` ou
assinatura de erro. A soma das contagens dos clusters deve ser igual ao total e
`unmappedCount` deve ser zero.

O relatório estruturado mínimo é:

```json
{
  "runId": "...",
  "sourceRunId": "...",
  "inputs": [{"path": "...", "sha256": "..."}],
  "totalFailures": 0,
  "clusters": [{
    "id": "...",
    "count": 0,
    "identities": ["..."],
    "evidence": [{"path": "...", "sha256": "..."}],
    "confidence": "VERIFIED",
    "cause": "...",
    "coupling": "low"
  }],
  "unmappedCount": 0,
  "decision": "GO",
  "blockers": []
}
```

`GO` só é válido quando existem no máximo três causas independentes, todas com
acoplamento baixo ou médio, e nenhuma causa necessária permanece desconhecida.
Em qualquer outro caso, a decisão é `DEFER`. `DEFER` exige checkpoint e
handoff duráveis, além de proibir correção automática.

## Estados e fluxo

```text
falhas elegíveis
      |
      v
triagem read-only, 1 agente, 1 tentativa
      |
      v
clusters deduplicados + evidências + confiança + acoplamento
      |
  critérios GO satisfeitos? ---- não ----> DEFER + checkpoint/handoff
      |
     sim
      v
GO para remediação posterior
```

O estado de triagem não executa remediação. A ausência de evidência para uma
causa necessária é suficiente para `DEFER`, mesmo que o número de clusters
seja pequeno.

## Critérios de aceitação

1. A regra identifica os dois gatilhos: 10 ou mais identidades falhando e o
   predicado herdado/exceção completo.
2. A regra limita a triagem a um agente, uma tentativa, allowlist e parsers
   locais determinísticos.
3. O contrato proíbe rede, mutação Git, package manager, test runner, build,
   lint, install, product CLI, execução do produto e alterações fora do
   relatório.
4. A chave de cluster, independência causal e níveis de acoplamento são
   determinísticos.
5. Cada identidade é mapeada uma vez, cada cluster tem prova suficiente, a
   soma das contagens fecha o total e `unmappedCount=0`.
6. O relatório contém todos os campos mínimos definidos neste documento e
   registra path e sha256 de cada input.
7. O contrato permite `GO` somente sob os limites de independência,
   acoplamento e conhecimento da causa.
8. Todo resultado fora desses limites produz `DEFER`, checkpoint/handoff
   durável e nenhuma correção automática pelo executor.
9. Constituição, Claude e Codex expressam a mesma regra, sem gate novo no CLI.
10. O texto deixa explícito que o limite global de tokens e a full suite estão
    fora do escopo desta mudança.

## Arquivos previstos

- `core/docs/constitution.md`: regra normativa e tratamento da violação.
- `core/docs/constitution-amendments/`: emenda ou seção versionada, conforme o
  padrão vigente de amendments.
- `core/adapters/claude/references/soma-run-orchestration.md`: propagação do
  contrato no fluxo Claude.
- `core/adapters/codex/AGENTS.md`: bloco ancorado equivalente para Codex.
- `core/scripts/__tests__/efficient-orchestration-protocol.test.cjs` e um teste
  de contrato focado: paridade, estados, limites e saída da triagem.

Esses arquivos são alvos de implementação futura; este documento não os
modifica.

## Estratégia TDD

Na implementação futura, escrever primeiro um teste de contrato focado para
cada critério observável, incluindo o limiar 10, o predicado de exceção,
deduplicação, chave de cluster, suficiência, schema do relatório, `GO`,
`DEFER` e a proibição de efeitos colaterais. Registrar a fase RED antes de
alterar as fontes. Implementar então a regra nas fontes canônicas e nos dois
adapters, executar apenas esse teste de contrato e usar o teste de paridade
existente para verificar a propagação. A full suite não é pré-requisito nem
dependência desta mudança.

## Limites e não objetivos

Este design não implementa a regra, não cria comando ou gate no CLI, não
executa diagnóstico novo, não define orçamento global de tokens, não autoriza
correção automática e não substitui o processo posterior de remediação. A
triagem só classifica evidências disponíveis no início da etapa. Dispatch,
checkpoint e handoff não são escritos pelo executor de triagem.

## Self-review

O documento cobre contexto, decisão, alternativas, contrato, fluxo, dez
critérios numerados, arquivos previstos, TDD, limites e não objetivos. Também
define allowlist, predicado de exceção, chave e acoplamento de clusters,
suficiência e schema mínimo do relatório. Os termos de decisão estão restritos
a `GO`, `DEFER`, `VERIFIED`, `INFERENCE` e `HYPOTHESIS`; não há `TBD`, `TODO`,
contradição ou dependência de execução de testes, build ou install.
