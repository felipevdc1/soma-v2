# SOMA v2.1

**Spec-Test-Steps-Driven orchestration for LLM workflows**

**Created by [@o.felipecarneiro](https://instagram.com/o.felipecarneiro) · Inspired by [@zbrunomoreira](https://instagram.com/zbrunomoreira)**

---

## What is SOMA?

SOMA is a disciplined orchestration framework for LLM-driven development. It enforces a 10-step STSD (Spec + Test + Steps Driven) pipeline that prevents the most common failure modes: shallow pattern-matching, skipped verification, and deferred work that never gets done.

At its core, SOMA installs a set of structural gates — hooks that run at key points in your workflow — to enforce spec-first thinking, test traceability, and anti-rationalization. Every change goes through: Specify → Plan → Tasks → Execute in Waves → Validate → Audit → Commit.

Cross-session continuity is built in: snapshot-based rollback, handoff buckets, and a SOMA Voxel output-style theme ensure that agent state is preserved and legible across sessions, adapters, and LLMs.

The primary Claude Code entrypoint is `/soma-run`. From any project directory, use `/soma-run "objective"` to start. It adopts projects that do not have `.soma/`, dispatches the baseline to an executor and starts the workflow. Use `/soma-run --status` for a read-only inspection and `/soma-run --resume <runId>` in a new session. Resume validates the immutable handoff, checkpoint, proofs and Git state before it returns the exact next task; passed tasks are not repeated.

---

## Key Features

- **17 SOMA-CORE hooks** — anti-shallowness gates covering cognitive discipline, spec completeness, test traceability, capture-before-defer, and insight-action coupling
- **11 slash commands** — `/soma:run`, `/soma:specify`, `/soma:plan-sdd`, `/soma:sonar-audit`, `/soma:dispatch`, and more, covering the full 10-step pipeline
- **Idempotent install** — `soma sync --apply` applies adapter config with snapshot-based rollback (2ms, byte-identical restore validated)
- **Snapshot-based rollback** — every apply captures pre-state; rollback is instant and deterministic
- **SOMA Voxel output-style theme** — 18 semantic bar-block types for structured agent output (inspired by [@zbrunomoreira](https://instagram.com/zbrunomoreira))
- **Multi-adapter** — Codex and Claude Code (production); cursor, aider, and chatgpt-desktop (EXPERIMENTAL)

---

## SOMA For Dummies (a 2-minute explainer)

### The problem SOMA solves

You use Claude Code. You prompt a feature. The agent starts, loses context mid-way, skips a test, hands back 80% and says "done!". You catch the gap two days later. Again.

Or: next session, Claude doesn't remember yesterday's plan. You re-explain. It does it differently. Inconsistency.

This is normal — vanilla Claude Code has no structural cross-session memory, no plan-before-code requirement, and no audit gate before declaring "done".

### What SOMA actually does

SOMA is a framework that **installs discipline** on top of Claude Code:

1. **You describe what you want** — `/soma:specify "endpoint X that accepts Y"`
   → SOMA generates a structured spec with acceptance criteria, marking `[NEEDS CLARIFICATION]` wherever ambiguous.

2. **You review and approve** (1st human gate)
   → SOMA derives the technical plan, contracts, and dependency-aware tasks.

3. **You run `/soma:run` and go grab coffee**
   → A state machine runs 10 steps autonomously: dispatches parallel agents in waves, validates each wave, runs a multi-territory audit, fixes findings, commits.

4. **SOMA pings you at the 2nd gate**: "ready to deploy?"
   → You review proof-of-work (tests, diffs, evidence) and decide.

### Day-to-day difference

| Without SOMA | With SOMA |
|---|---|
| "Claude, do X" → it does it but skips tests | Spec requires a test per AC; hook blocks commit without it |
| Agent loses context between sessions | Handoff buckets persist; next session resumes exactly |
| You forget to audit before merging | Step 8 SONAR audit is mandatory |
| Bug returns because no repro test | Spec generates test FROM acceptance criteria |
| Agent says "done" with no evidence | Gate requires proof-of-work |

### "Doesn't Claude Code already do this?"

It can, but optionally. SOMA makes it **structural**: hooks fire automatically, gates block if you try to skip. The difference between trusting willpower and having a guardrail.

### When to use SOMA

✅ Features with 3+ parallel components
✅ Risky / multi-file refactors
✅ Work that spans more than one session
✅ Teams of 2+ where cross-author audit matters

❌ A 30-line script to delete files
❌ Quick questions ("how do I do X?")
❌ Throwaway prototyping

### In one sentence

**SOMA takes Claude Code's "vibe coding" and puts it on autopilot — with a seatbelt.**

---

## SOMA Pra Leigos (explicação em 2 minutos) 🇧🇷

### O problema que o SOMA resolve

Você usa Claude Code. Solta um prompt pedindo uma feature. O agente começa, perde contexto no meio, pula um teste, te entrega 80% e fala "pronto!". Você descobre o gap 2 dias depois. De novo.

Ou: próxima sessão, Claude não lembra do plano de ontem. Você re-explica. Ele faz diferente. Inconsistência.

Isso é normal — Claude Code vanilla não tem memória estrutural cross-session, não exige plano antes de codar, não tem audit gate antes de declarar "pronto".

### O que o SOMA faz na prática

SOMA é um framework que **instala disciplina** em cima do Claude Code:

1. **Você descreve o que quer** — `/soma:specify "endpoint X que aceita Y"`
   → SOMA gera uma spec estruturada com critérios de aceite, marcando `[NEEDS CLARIFICATION]` onde tá ambíguo.

2. **Você revisa e aprova** (1º gate humano)
   → SOMA deriva o plano técnico, contracts e tasks com dependências.

3. **Você roda `/soma:run` e vai tomar café**
   → State machine roda 10 passos sozinha: dispatch agentes paralelos em waves, valida cada wave, roda audit multi-território, fixa achados, commita.

4. **SOMA te chama no 2º gate**: "tá pronto pra deploy?"
   → Você revisa a proof-of-work (testes, diffs, evidência) e decide.

### Diferença no dia a dia

| Sem SOMA | Com SOMA |
|---|---|
| "Claude, faz X" → ele faz mas pula testes | Spec exige teste por AC; hook bloqueia commit sem isso |
| Agente perde contexto entre sessões | Handoff buckets persistem; próxima sessão retoma exato |
| Você esquece de auditar antes de mergear | Step 8 SONAR audit é obrigatório |
| Bug volta porque não tinha repro test | Spec gera teste DOS critérios de aceite |
| Agente fala "pronto" sem evidência | Gate exige proof-of-work |

### "Mas Claude Code já não faz isso?"

Pode fazer, mas opcional. SOMA torna **estrutural**: hooks rodam automaticamente, gates bloqueiam se você tenta pular. É a diferença entre confiar em willpower e ter um corrimão.

### Quando usar SOMA

✅ Features com 3+ componentes paralelos
✅ Refactors arriscados / multi-arquivo
✅ Trabalho que dura mais de uma sessão
✅ Times de 2+ pessoas onde audit cruzado importa

❌ Script de 30 linhas pra deletar arquivos
❌ Pergunta rápida ("como faço X?")
❌ Prototipação descartável

### Em uma frase

**SOMA pega o "vibe coding" do Claude Code e bota no piloto automático — com cinto de segurança.**

---

## Quick Install

```bash
git clone https://github.com/felipevdc1/soma-v2.git
cd soma-v2
bash install.sh
```

**Requirements:**
- Node.js ≥ 22
- macOS, Linux, or WSL2
- Claude Code CLI (or Codex)

Install is idempotent — re-running is a byte-identical no-op.
Uninstall via `bash uninstall.sh` (snapshot-based, fully reversible).

See [docs/INSTALL.md](./docs/INSTALL.md) for full options and [docs/QUICKSTART.md](./docs/QUICKSTART.md) for a first-feature walkthrough.

## Install SOMA on a Project

Once the SOMA framework is installed, use the project-install command to instrument any target project:

```bash
node core/scripts/install.cjs <project-path> --tool=claude
```

This writes `.soma/`, `manifest.json`, `.soma/install-state.json`, and a SOMA bootloader anchored block into `<project>/CLAUDE.md`.

See [`core/INSTALL.md`](core/INSTALL.md) for prerequisites, verification checklist, and troubleshooting.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Contributing

Issues and PRs welcome at [github.com/felipevdc1/soma-v2](https://github.com/felipevdc1/soma-v2/issues).

Please read the internal design history in `core/specs/README.md` before proposing architectural changes — many decisions have non-obvious rationale baked into the spec history.
