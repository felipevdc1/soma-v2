# Quickstart: validar a spec 018 à mão

Passos manuais para exercitar cada AC depois da implementação. Tudo em `$HOME` temporário — **nunca rode contra o seu `~/.claude` real enquanto valida**, porque o AC-04 vai abortar de propósito e o AC-03 sobrescreve.

---

## 0. Ambiente isolado

```bash
export SOMA_LAB="$(mktemp -d)"
export HOME_REAL="$HOME"
mkdir -p "$SOMA_LAB/home/.claude/hooks" "$SOMA_LAB/home/.claude/commands"
cd "$HOME_REAL/Documents/- projetos claude code/soma-v2"
```

⚠️ **`mktemp -d` neste Mac devolve `/var/folders/...`, não `/tmp`.** Se algum passo abaixo só funcionar com `/tmp` hardcodado, isso é bug — reporte.

---

## 1. Primeira instalação (AC-01, AC-10)

Antes de instalar, confirme que o `doctor` distingue "nunca instalado" de "sem drift":

```bash
HOME="$SOMA_LAB/home" soma doctor
```

**Observar:** a saída diz explicitamente que **não há registro de instalação**. Se ela disser `No drift detected`, o AC-10 falhou — é exatamente o silêncio que escondeu 6 hooks defasados por 3 meses.

Agora instale:

```bash
HOME="$SOMA_LAB/home" soma install --tool claude
```

**Observar:** exit 0, e os arquivos declarados aparecem no destino. Confira byte a byte:

```bash
diff "$SOMA_LAB/home/.claude/hooks/framework-guard.cjs" hooks/framework-guard.cjs
```

`diff` sem saída e exit 0 = AC-01 satisfeito.

---

## 2. Idempotência

```bash
HOME="$SOMA_LAB/home" soma install --tool claude
```

**Observar:** a segunda rodada **não escreve nada** — nenhuma ação de escrita reportada. Se escrever de novo, a decisão limpo-vs-divergido não está consultando o ledger.

---

## 3. Sobrescreve quando limpo (AC-03)

Simule o repo avançando, sem tocar no destino:

```bash
HOME="$SOMA_LAB/home" soma sync --tool claude --dry-run
```

**Observar:** o arquivo cuja fonte mudou aparece com ação de atualização; os demais, como sem-mudança.

```bash
HOME="$SOMA_LAB/home" soma sync --tool claude --apply
```

**Observar:** o destino foi atualizado sem pedir confirmação. Esse é o caminho "não editado desde a instalação".

---

## 4. Aborta quando divergiu (AC-04) — o passo mais importante

Edite **dois** arquivos instalados à mão, pra provar que a saída nomeia os dois:

```bash
echo "// editado por mim" >> "$SOMA_LAB/home/.claude/hooks/thermal-guard.cjs"
echo "// editado por mim" >> "$SOMA_LAB/home/.claude/hooks/depth-guard.cjs"
HOME="$SOMA_LAB/home" soma install --tool claude
```

**Observar, e os quatro importam:**
1. exit code sinaliza **abort**, nunca sucesso
2. a saída nomeia **os dois** paths, não só o primeiro
3. **nenhum** arquivo foi escrito — nem os limpos. Confirme comparando o `mtime` de um arquivo que **não** foi editado, antes e depois
4. o status no `install-state` **não** é `partial-failed` — nada foi aplicado parcialmente

Se apenas o primeiro divergido for nomeado, o AC-04 está pela metade: você tem 2 divergidos na sua máquina real hoje, e descobriria um por rodada.

---

## 5. Arquivo não-declarado sobrevive (AC-05)

```bash
echo "// hook que o SOMA nao possui" > "$SOMA_LAB/home/.claude/hooks/meu-hook-pessoal.cjs"
HOME="$SOMA_LAB/home" soma install --tool claude
cat "$SOMA_LAB/home/.claude/hooks/meu-hook-pessoal.cjs"
```

**Observar:** o arquivo continua lá, com o conteúdo intacto. Este é o AC que separa uma ferramenta de um acidente — na sua máquina real são **17** hooks nessa condição.

---

## 6. `doctor` acusa e cala nos dois sentidos (AC-08, AC-09)

Com tudo idêntico:

```bash
HOME="$SOMA_LAB/home" soma doctor
```

**Observar:** **silêncio** quanto a arquivos. Check específico não é ruidoso — ruído faz gente desligar check.

Agora desatualize um destino à mão e rode de novo. **Observar:** o arquivo defasado é **nomeado**. Se o `doctor` continuar dizendo `No drift detected`, ele é cego — que é o estado de hoje e a razão do AC-08.

---

## 7. `soma-run.md` está fora (AC-12)

```bash
grep -c "soma-run.md" core/adapters/claude/install-targets.json
```

**Observar:** zero. E o comando não aparece no destino depois de instalar. A exclusão é intencional — o `soma-run.md` de 296 linhas só vira default depois do run de laboratório do Felipe.

---

## 8. Comando em fonte única (AC-11)

```bash
ls commands/ core/adapters/claude/commands/
```

**Observar:** nenhum nome aparece nos dois. Os 6 órfãos (`depth-score`, `dispatch`, `encerrar`, `gap-finder`, `handoff`, `quality-check`) estão no adapter; os 5 duplicados stale sumiram da raiz.

---

## 9. Limpeza

```bash
rm -rf "$SOMA_LAB"
```

O `$HOME` real nunca foi tocado — todo passo acima usou `HOME="$SOMA_LAB/home"`.

---

## O que NÃO validar aqui

- **A instalação real na máquina do Felipe.** Ela **vai abortar** por causa de `spec-completeness-gate.cjs` e `spec-test-traceability.cjs`, que divergiram com o repo à frente (o primeiro curado pelo K2 da spec 016, o segundo consertado pela T-15). Isso é o AC-04 funcionando, e a reconciliação é decisão dele.
- **O adapter `codex`.** Esta spec entrega o mecanismo e o conjunto do `claude`; entries de arquivo pro `codex` são spec futura.
