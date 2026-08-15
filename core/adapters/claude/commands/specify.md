Gere um `spec.md` estruturado a partir de uma descrição de feature em linguagem natural (SDD fase 1).

O argumento passado é a descrição da feature. Se nenhum argumento foi passado, pergunte ao usuário o que quer especificar.

## Prereqs

- `.soma/` directory present in project root (project bootstrapped via `soma install`)
- `.soma/install-state.json` shows `status: "complete"`

If either condition is missing, run from the project root:

```bash
soma install . --tool=claude
```

## Passos

### 0. Discover Before Specify (NEW 2026-05-02 per Constitution Article XII + Failure Mode #9)

ANTES de Step 1, scan ARGUMENTS for trigger words: "extends X", "extend module Y", "Phase N+1", "Phase X of Y", "operationalize Z", "add to existing W", "enhance Y module|command|impl".

Se trigger detectado → MANDATORY pre-discovery (não pular, não rationalize past):

1. Identify target module/file path from ARGUMENTS context (e.g., "extends sync.cjs" → target = `~/.soma-v2/scripts/sync.cjs`)
2. Read full source: use Read tool (limit ≤1000 lines) OR `cat <module-path>` via Bash
3. If CLI command: run `<module> --help` if available
4. List recent test files: `ls <module-dir>/__tests__/ -t | head -5`
5. Output discovery summary com section header "Phase N Empirical State" contendo:
   - Existing capabilities map (what already works)
   - Existing bugs/gaps (empirical state)
   - Recent changes (git log se applicable)
6. **If discovery surfaces "feature already partial-implemented"** → STOP + report ao usuário com discovery summary structurado; usuário decide: (a) spec for delta only OR (b) re-confirm new spec scope OR (c) cancel
7. ONLY THEN proceed to Step 1

**Bypass mecanismo** (legitimate exception, e.g., greenfield feature misclassified as "extends"): create marker file `touch /tmp/soma-discover-bypass-{sessionId}` BEFORE invoking /specify. Bypass is logged em telemetry pra audit.

**Why this exists**: Phase 5 SOMA spec 011 (2026-05-02) escrita sem ler `~/.soma-v2/scripts/sync.cjs` (Phase 4b shipped 2 dias antes). Resultado: 30% scope redundante + 7 bugs empíricos missed. Failure Mode #9 doc'd em `~/.claude/CLAUDE.md`. Constitution Article XII enforces.

### 1. Determine o project root

Use o diretório de trabalho atual (`cwd`). Se houver um `.git` num diretório pai, use esse pai como root.

### 2. Determine o próximo número de feature

Procure por `{projectRoot}/specs/*/spec.md` (glob). Extraia o prefixo numérico de cada diretório encontrado (ex: `003-auth-flow` → `3`). O próximo número é `max + 1`, zero-padded para 3 dígitos (ex: `004`). Se `specs/` não existir ou estiver vazia, comece em `001`.

### 3. Derive o slug

A partir da descrição passada como argumento:
- Lowercase
- Substitua espaços e caracteres especiais por `-`
- Remova stopwords curtas (a, o, e, de, para, com, the, an, a, of, for, with)
- Truncate para ≤30 caracteres
- Remova hifens no início ou fim

Exemplo: `"add user profile page with email verification"` → `user-profile-email-verification`

### 4. Monte os valores dos placeholders

- `{FEATURE_TITLE}` = title case do argumento original
- `{NNNN-slug}` = `{NNN}-{slug}` (ex: `001-user-profile-email-verification`)
- `{branch-name}` = `feature/{NNN}-{slug}`
- `{YYYY-MM-DD}` = data atual em formato ISO (ex: `2026-04-19`)
- `{Status}` = `DRAFT`

### 5. Carregue o template

Leia `~/.claude/templates/spec.md`. Substitua todos os placeholders pelos valores acima.

### 6. Preencha User Stories e Acceptance Criteria

Esta é a etapa mais crítica. Com base na descrição da feature:

**User Stories:**
- Escreva mínimo 1 user story concreta no formato: `"Como {user}, quero {action}, pra {outcome}"`
- Substitua `{user}`, `{action}`, `{outcome}` por valores reais derivados da descrição
- Se o tipo de usuário for ambíguo, insira `[NEEDS CLARIFICATION: qual tipo de usuário é o principal desta feature?]`

**Acceptance Criteria:**
- Escreva ACs concretos no formato `Given / When / Then`
- Cada AC deve ser **binário** (pass/fail) — observable, sem detalhes de implementação (sem HOW, só WHAT)
- Para cada aspecto da feature que tenha ambiguidade de comportamento, insira `[NEEDS CLARIFICATION: pergunta específica]` como AC ou em Open Questions
- Exemplos de quando inserir NEEDS CLARIFICATION:
  - Comportamento em edge cases não especificado
  - Permissões ou roles não claras
  - Limites (quantidade, tamanho, tempo) não definidos
  - Estados de erro não descritos

**Non-Functional Requirements:**
- Preencha com valores razoáveis baseados no tipo de feature
- Se não houver informação suficiente, insira `[NEEDS CLARIFICATION: ...]`

**Out of Scope:**
- Liste pelo menos 1 exclusão óbvia derivada da descrição

### 7. Crie o arquivo

1. Crie o diretório `{projectRoot}/specs/{NNN}-{slug}/` se não existir
2. Escreva o spec preenchido em `{projectRoot}/specs/{NNN}-{slug}/spec.md`

### 8. Exiba o resumo

Mostre ao usuário:

```
✓ Spec gerado: specs/{NNN}-{slug}/spec.md

  Feature ID : {NNN}-{slug}
  Branch     : feature/{NNN}-{slug}
  ACs        : {count} acceptance criteria
  Pendentes  : {count} [NEEDS CLARIFICATION] markers

Próximo passo: resolva os markers de NEEDS CLARIFICATION e rode /plan-sdd quando o spec estiver APPROVED.
```

## Exemplo esperado

Descrição: `"add user profile page with email verification"`

- Número: `001`
- Slug: `user-profile-email-verification`
- Diretório: `specs/001-user-profile-email-verification/`
- Branch: `feature/001-user-profile-email-verification`

ACs esperados incluiriam:
- `AC-01: Given an authenticated user, when they navigate to /profile, then they see their name, email, and avatar.`
- `AC-02: Given an unverified email, when the user views their profile, then a verification banner is displayed.`
- `[NEEDS CLARIFICATION: o email de verificação expira? Em quanto tempo?]`

## Regras

- NUNCA invente comportamento — descreva o que a feature claramente implica, marque o resto com NEEDS CLARIFICATION
- NUNCA coloque detalhes de implementação (framework, biblioteca, SQL) nos ACs
- O spec deve poder ser validado por alguém sem contexto técnico
- Todo output ao usuário em português do Brasil
