# Contract: Hook — Framework Guard

**Contract ID:** CONTRACT-FRAMEWORK-GUARD-04
**spec_ref:** [SPEC:AC-07] [SPEC:AC-13]
**Created:** 2026-08-15

---

## Registro

| | |
|---|---|
| Arquivo | `hooks/framework-guard.cjs` |
| Wiring | entrada `PreToolUse` matcher `Bash` em `install/soma-hooks-map.json` (schema `soma-hooks-map/v1`) |
| Distribuição | `hooks/` → `install.sh` (rsync) → `~/.claude/hooks/`; wiring via `install/merge-settings.cjs` |

⚠️ **Hook sem entrada no `soma-hooks-map.json` é copiado e nunca dispara.** Foi assim que o `spec-test-traceability.cjs` (386 linhas + 442 de teste, medido em `2929f50`) ficou morto — presente no disco, ausente de `settings.json`, silenciosamente inerte. O arquivo sem o registro não conta como entregue.

---

## Trigger

Comando `Bash` cuja linha invoca `git commit`.

---

## Paths protegidos (default)

```
hooks/**
core/scripts/**
**/constitution*
**/constitution*/**
install/**
```

> **Correção de 2026-08-17 — `constitution*` cru não protegia a constituição.** O padrão original era `constitution*`, sozinho, entre três padrões que todos carregam prefixo de caminho. A executora da T-12 leu como glob de **um segmento** (`^constitution[^/]*$`), o que é a leitura correta do que estava escrito — e **sinalizou que era decisão dela, não verificação**, porque nenhum teste cobria um `constitution` aninhado.
>
> **A constituição real deste repo está em `core/docs/constitution.md`**, e os amendments em `core/docs/constitution-amendments/`. Nenhum dos quatro padrões originais cobria `core/docs/`. Verificado empiricamente com o hook rodando, régua validada nos dois sentidos antes do veredito: `docs/readme.md` → exit `0` (controle negativo, não é ruído), `hooks/x.cjs` → exit `2` (controle positivo, não é cego), `core/docs/constitution.md` → **exit `0`**.
>
> Ou seja: **o guard anunciava proteção que não entregava**, no artefato mais normativo do projeto — a mesma patologia de silêncio-que-lê-como-aprovação que esta fase inteira existe pra matar, e desta vez dentro do próprio mecanismo de proteção.
>
> São **dois** padrões porque um não basta: `**/constitution*` casa o arquivo em qualquer profundidade, mas **não** casa o conteúdo do diretório `constitution-amendments/` (o último segmento ali é o `.md` do amendment). `**/constitution*/**` fecha essa metade. Preferidos a `core/docs/constitution*` literal porque um guard que **para de proteger em silêncio quando alguém move o arquivo** é a mesma classe de defeito que estamos consertando aqui.

Avaliados contra a saída de `git diff --cached --name-only` — **staged**, não working tree.

---

## Exit contract

| Situação | Exit | Saída |
|---|---|---|
| Nenhum staged casa path protegido | `0` | silêncio |
| ≥1 staged casa, **sem** marker de bypass | `2` | stderr lista **cada path ofensor**, um por linha |
| ≥1 staged casa, **com** marker de bypass | `0` | stderr declara o override aplicado + os paths liberados |
| `git diff --cached` falha (não é repo, git ausente) | `0` | stderr com warning — **não bloqueia** |

Convenção do repo: exit `2` = block, `0` = allow. Segue os outros 18 hooks.

**Nota sobre o último caso** — é a única exceção deliberada ao AC-10 ("não-executável vira REJECT"), e a razão é diferença de blast radius: o AC-10 governa checks de **validação de trabalho**, onde falhar aberto deixa passar trabalho ruim. Aqui, falhar fechado tornaria impossível commitar em qualquer diretório que não seja um repo git, quebrando uso legítimo em troca de nenhuma proteção real. A escolha é registrada aqui para não ser "corrigida" depois por engano.

---

## Override (AC-13)

```
{os.tmpdir()}/claude-framework-guard-bypass-{sessionId}.marker
```

Segue a convenção dos hooks existentes do SOMA. **Nunca silencioso**: quando o marker é encontrado, o hook permite o commit **e** escreve na stderr que um override foi aplicado, listando os paths liberados.

⚠️ **Duas armadilhas que já produziram falso-verde 2× na sessão de 2026-08-14/15** — o teste tem que respeitar as duas, senão passa sem testar nada:

1. **`sessionId` vem de variável de ambiente** (`CK_SESSION_ID` / `CLAUDE_SESSION_ID`), **não do stdin**.
2. **`os.tmpdir()` neste Mac não é `/tmp`.** Nunca hardcodar `/tmp`, nem no hook nem no teste.

**O guard fica ativo também dentro do soma-v2** (decisão do Felipe, Gate 1). Desligá-lo no repo do próprio framework deixaria justamente o repo mais sensível sem proteção. O atrito do desenvolvimento de infra se resolve pelo marker.

---

## Side Effects

Nenhum. O hook é read-only: lê o index do git e o filesystem, escreve só em stderr, decide por exit code. Não reescreve tool input — um hook **não consegue** reescrever tool input, e assumir o contrário foi o defeito que aposentou o `privacy-block.cjs` (o escape `APPROVED:` chegava literal na tool e virava `No such file`).

---

## Contract Test Stub

```javascript
// @spec AC-07
// @spec AC-13
// @contract CONTRACT-FRAMEWORK-GUARD-04

describe('CONTRACT-FRAMEWORK-GUARD-04', () => {
  it('staged em hooks/** sem marker → exit 2 listando o path', () => {
    // repo git REAL em tmpdir (Article III), git add real, sem mock
  });

  it('CONTEÚDO: a stderr nomeia cada path ofensor, não só "bloqueado"', () => {
    // 2 arquivos protegidos staged → os 2 aparecem na saída
  });

  it('staged só em paths não protegidos → exit 0 e silêncio', () => {
    // guarda contra o guard virar "bloqueia tudo"
  });

  it('AC-13: com marker → exit 0 E stderr declara o override', () => {
    // override existe mas nunca é silencioso
  });

  it('marker de OUTRA sessão não libera', () => {
    // sessionId diferente → continua bloqueando
  });

  it('sessionId vem de env var, não de stdin', () => {
    // teste que falha se a implementação ler sessionId do stdin
  });

  it('usa os.tmpdir(), não /tmp hardcoded', () => {
    // executar com TMPDIR alterado e confirmar que o marker é procurado lá
  });

  it('fora de repo git → exit 0 com warning, não bloqueia', () => {});

  it('está registrado em install/soma-hooks-map.json com PreToolUse/Bash', () => {
    // o arquivo existir não basta: sem wiring o hook nunca dispara
  });
});
```
