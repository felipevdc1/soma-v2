Gere um `spec.md` estruturado a partir de uma descrição de feature em linguagem natural (SDD fase 1).

O argumento passado é a descrição da feature. Se nenhum argumento foi passado, pergunte ao usuário o que quer especificar.

## Passos

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
