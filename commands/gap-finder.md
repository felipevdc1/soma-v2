Audite o trabalho recém-completado procurando gaps sutis em 5 categorias. Siga EXATAMENTE estes passos:

---

## Step 1 — Identificar o escopo do audit

Determine qual trabalho auditar:
- Se o usuário passou um argumento ao invocar o comando → use ele como escopo.
- Se não → use o trabalho principal da sessão atual: a última implementação completada ou a task mais recente do plano marcada como done.
- Se o escopo for ambíguo → pergunte ao usuário: "Qual trabalho devo auditar? [último commit / plano X / descreva]"

---

## Step 2 — Escanear as 5 categorias de gap

Para cada categoria abaixo, liste gaps concretos e específicos. Se nenhum gap for encontrado numa categoria → diga explicitamente "nenhum detectado" — nunca pule a categoria.

**1. Edge cases não testados**
Caminhos do código exercitados apenas no happy path. Pergunte: o que acontece com input vazio? input gigante? caracteres especiais? acesso concorrente? timeout? Quais branches de if/switch nunca foram exercitados num teste real?

**2. LLM-dependency**
Steps que dependem de interpretação em linguagem natural em vez de estrutura. Pergunte: algum passo assume que o modelo vai "entender" corretamente? Há schema explícito ou é free-text? Se dois LLMs diferentes rodassem o mesmo step, produziriam output equivalente?

**3. Context-dependency**
Comportamento que muda com o tamanho ou histórico da sessão. Pergunte: o step funciona numa sessão fresh igual a uma sessão com 500K tokens? Depende de informação que pode ter saído do context window?

**4. Silent failures**
Erros que não quebrariam testes mas produziriam output degradado. Pergunte: há try/catch que engole erro? Operações que continuam com valor default na falha? Validações ausentes entre boundaries de sistemas?

**5. Validation gaps**
Success criteria que não foram de fato verificados. Pergunte: o "done" foi confirmado por leitura do output real ou só porque o agente reportou OK? Arquivos criados foram lidos de volta? Testes rodaram com verificação do exit code?

---

## Step 3 — Reportar

Apresente o relatório ao usuário neste formato exato:

```
# Gap audit: {escopo}

## 1. Edge cases não testados
- {gap específico} → sugestão: {ação concreta}
- ...

## 2. LLM-dependency
- {gap específico} → sugestão: {ação concreta}
- ...

## 3. Context-dependency
- {gap específico} → sugestão: {ação concreta}
- ...

## 4. Silent failures
- {gap específico} → sugestão: {ação concreta}
- ...

## 5. Validation gaps
- {gap específico} → sugestão: {ação concreta}
- ...

## Priorização sugerida
1. {gap mais crítico — critério: probabilidade × impacto}
2. ...
```

---

## Step 4 — Perguntar next action

Ao final do relatório, pergunte ao usuário:

"Quer que eu dispatch um agente pra corrigir algum desses gaps? [número do gap / não]"

---

## Regras do gap-finder

- É um **audit tool**, não um fixer — nunca edita código sozinho. Apenas lista gaps e sugere.
- Não é substituto de testes — complementa.
- Não invente gaps — se a categoria não se aplica ao escopo, diga "nenhum detectado".
- Não substitui `/quality-check` — rode os dois em sequência para cobertura completa.

NÃO proponha fixes automaticamente. O usuário decide.
