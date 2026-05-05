# SOMA v2.1 — Quickstart

**Audience:** You just ran `bash install.sh` and want your first hands-on SOMA experience.
**Time to first workflow:** ~10 minutes.

---

## Step 0 — Confirm install

Re-run the smoke pack to confirm everything is working:

```bash
node install/verify-portability.cjs
# Expected: 12/12 gates pass
```

If any gate fails, check `docs/TROUBLESHOOTING.md` before proceeding.

Restart Claude Code (close and reopen) if you haven't already.

---

## Your first SOMA workflow

SOMA is a Spec + Test + Steps Driven (STSD) protocol. You specify what you want, approve the plan, and let the state machine handle the rest. There are exactly **2 places you need to intervene** — everything else is autonomous.

### Step 1 — Specify the feature

In Claude Code, type:

```
/soma:specify "add a JSON output mode to my CLI"
```

SOMA generates `specs/001-add-json-output/spec.md` containing:

- User stories
- Numbered acceptance criteria (AC-01, AC-02, ...)
- `[NEEDS CLARIFICATION]` markers for anything ambiguous

Open `specs/001-add-json-output/spec.md` and fill in any `[NEEDS CLARIFICATION]` markers before continuing. The next step is blocked until all markers are resolved.

### Step 2 — Derive the plan

```
/soma:plan-sdd
```

This derives `plan.md`, `contracts/`, `tasks.md`, and `quickstart.md` from the spec. It also runs three Phase -1 gates: Simplicity (≤3 new components), Anti-Abstraction (no speculative futures), and Integration-First (real environments over mocks).

Review the generated `plan.md` to confirm the approach looks right.

### Step 3 — Approve the spec (Gate 1)

SOMA pauses at `AWAITING_SPEC_APPROVAL`. Create the gate marker to proceed:

```bash
touch /tmp/soma-spec-approved-<runId>
# runId is printed in the terminal when SOMA pauses
```

From this point, SOMA runs autonomously through Steps 2–9 (TEAM → WAVES → VALIDATE → CONSOLIDATE → INTEGRATE → SONAR).

### Step 4 — Approve deploy (Gate 2)

When SOMA reaches the final commit and is ready to deploy, it pauses at `AWAITING_DEPLOY_APPROVAL`:

```bash
touch /tmp/soma-deploy-approved-<runId>
```

SOMA then finalizes the commit and reports back with SHA, files changed, and test results.

---

## The 2 human gates

| Gate | When | Marker file |
|---|---|---|
| **Gate 1 — Spec Approval** | After spec + plan + tasks are generated, before agents start coding | `/tmp/soma-spec-approved-{runId}` |
| **Gate 2 — Deploy Approval** | After all tests pass and commit is ready, before deploy to production | `/tmp/soma-deploy-approved-{runId}` |

Everything between the two gates is autonomous. SOMA will pause at `PAUSED_DIAGNOSTIC` if it hits 3 consecutive failures on the same step (see the Recovery Protocol section in `docs/ARCHITECTURE.md`).

---

## Where state lives

After a SOMA run, here is what exists on disk:

| Location | Contents |
|---|---|
| `specs/{NNN}-{slug}/spec.md` | The approved spec — source of truth for the feature |
| `specs/{NNN}-{slug}/plan.md` | Technical plan, contracts, task breakdown |
| `~/.soma-v2/.snapshots/{ISO-timestamp}/` | Rollback artifacts — byte-identical restore available via `rollback.cjs` |
| `~/.claude/plans/handoff-{project-slug}.md` | Cross-session handoff: what was done, open buckets, resume prompts |
| `~/.claude/projects/.../memory/` | Project memory: decisions, feedback, patterns accumulated over sessions |

---

## Common workflow patterns

### Parallel team dispatch

When your spec has 3+ independent components, `/soma:run` automatically uses `TeamCreate` to dispatch parallel agents. Thermal Guard limits simultaneous compile/test agents to 3 to avoid CPU contention.

### Single targeted dispatch

For a small fix or isolated change that does not need the full 10-step pipeline:

```
/soma:dispatch "fix the --quiet flag not suppressing banner output"
```

This dispatches a single Sonnet executor in an isolated worktree.

### Multi-territory audit

Before merging a large change, run a read-only SONAR scan across 5 territories simultaneously (architecture, modules, tests, config, spec adherence):

```
/soma:sonar-audit
```

Results are returned as structured findings with severity levels. No code is modified.

### Cognitive discipline loop

Before planning a non-trivial task, run the HYD v2 anti-shallowness loop:

```
/soma:hyd "migrate the auth module to use JWT refresh tokens"
```

This classifies the task, selects quality dimensions, pressure-tests your initial approach, and surfaces counterexamples before you commit to a plan.

---

## Where to go next

- **`docs/ARCHITECTURE.md`** — internals: hook chain, slash commands, adapter system, state machine, frozen libs philosophy, telemetry, and the JFLOW complementary system
- **`docs/TROUBLESHOOTING.md`** — symptom → cause → fix for install issues, runtime errors, audit failures, and update scenarios
- **`core/docs/constitution.md`** — the 10 constitutional articles that govern every SOMA run (ratified v1.0.0)
- **`core/docs/onboarding.md`** — bootstrap guide for setting up SOMA-enabled projects
