# Plan: Orquestração eficiente

## Tese

Fechar o desperdício na fronteira já existente é suficiente. `dispatch-record.cjs` bloqueia bytes/tentativas; os documentos canônicos limitam topologia, auditoria, correção e mensagens.

## Mudanças

1. Escrever testes RED em `core/scripts/__tests__/run-dispatch-record.test.cjs` para AC-01..03.
2. Implementar constantes e validação pré-escrita em `core/scripts/run/dispatch-record.cjs`.
3. Adicionar testes estáticos focados do protocolo em `core/scripts/__tests__/efficient-orchestration-protocol.test.cjs`.
4. Atualizar `core/adapters/claude/commands/soma-run.md`, `core/docs/soma-stsd.md` e o bloco espelhado em `core/adapters/codex/AGENTS.md`.
5. Rodar testes focados, diff check e uma suíte completa final.

## Invariantes

- Nenhum novo verbo ou store.
- Rejeição ocorre antes de qualquer escrita.
- Tentativas 1 e 2 preservam o layout atual.
- Compatibilidade dos payloads `soma-dispatch-record/v1`.
- Os limites têm uma única fonte numérica no runtime; o teste estático impede drift documental.

## Unidade de execução

Um executor implementa todos os arquivos porque runtime e texto formam um único contrato. Um revisor integrado avalia a mesma commit candidate. Há no máximo uma correção; finding residual bloqueia.

## Verificação

```bash
node --test core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs
git diff --check
npm test
```

## Stop conditions

- Mesmo teste falha duas vezes após mudança de implementação.
- A solução exige novo store, nova CLI ou alteração do schema persistido.
- O protocolo Claude e a fonte Codex não podem expressar a mesma regra sem duplicação divergente.
