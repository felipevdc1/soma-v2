# SOMA Run Crash-Safety Plan

**Goal:** fechar os três defeitos residuais do rollout sem criar novo subsistema: rollback conjunto de arquivo+ledger, recuperação em `INT`/`TERM` e backup sem colisão.

**Architecture:** `sync` continua como único writer. `install.sh` apenas protege os bytes preexistentes de `soma-run.md` e `.soma/install-state.json`, arma uma transação shell durante a Phase 7 e restaura ambos em qualquer saída não concluída. O diretório de backup é criado com `mktemp -d`; dry-run não escreve.

## Task única — Phase 7 crash-safe

**Arquivos autorizados:**

- `install.sh`
- `install/__tests__/synthetic-env.test.sh`
- testes Node de instalação apenas se necessários para fixar o contrato estrutural

### RED obrigatório

1. Forçar conflito de bloco depois que `sync` já atualizou `installedFiles`; exigir exit não-zero e igualdade byte a byte do comando e do ledger anteriores.
2. Interromper a Phase 7 com `SIGTERM`; exigir status não-zero e os dois pre-states restaurados.
3. Executar duas instalações com o mesmo segundo observado; exigir diretórios distintos e o primeiro backup intacto.

Os testes precisam falhar no commit `1bb7ff8` pelas três causas acima antes da mudança de produção.

### Implementação mínima

1. Criar a raiz de backups e obter um diretório exclusivo por `mktemp -d` somente fora de dry-run.
2. Antes de remover o target, preservar existência e bytes exatos do target e do ledger do projeto.
3. Armar handlers idempotentes para `INT`, `TERM` e `EXIT`. Enquanto a transação estiver ativa, qualquer saída não concluída restaura target e ledger; se não existiam, remove somente os artefatos criados pela tentativa.
4. Rodar o `sync` canônico. Validar que target e entry do ledger correspondem aos bytes canônicos.
5. Marcar commit da transação e desarmar apenas os handlers novos; manter a política preexistente de `PIPE`.

### GREEN e auditoria

```bash
bash install/__tests__/synthetic-env.test.sh
node --test core/scripts/__tests__/efficient-rollout.test.cjs core/scripts/__tests__/install-sh-rsync-origins.test.cjs core/scripts/__tests__/install-targets-set.test.cjs
bash -n install.sh
git diff --check
```

Uma revisão independente deve reproduzir os três fixtures adversariais. Uma única onda de correção é permitida; nova falha encerra em diagnóstico, sem mutação live.

