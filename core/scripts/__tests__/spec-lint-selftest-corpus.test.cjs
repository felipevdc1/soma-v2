'use strict';
/**
 * spec-lint-selftest-corpus.test.cjs — AC-10 meta-test: EVERY check
 * registered in lib/spec-lint/registry.cjs must have both a known-bad
 * fixture (proves it acuses — sensibilidade) and a known-good fixture
 * (proves it stays quiet against real, non-trivial content — especificidade)
 * somewhere in the repo's fixture corpus. A check with only one side is not
 * merely "incomplete" — per plan.md/contract, it is indistinguishable from
 * the four ad hoc validators of 2026-08-15 that reported plausible
 * "0 conflitos" while wrong. This meta-test is what would have caught that:
 * a check that ONLY has the good side would pass every "runs without
 * throwing" smoke test while being silently blind.
 *
 * Design: the loop below drives off `registry.cjs` itself — it never lists
 * "cli-surface" / "parallel-collision" as two hand-written top-level test
 * blocks. A third check added to the registry without a matching CORPUS
 * entry fails loudly, by name, in the first test below — that IS the
 * completeness proof the AC asks for, not a side effect of it.
 *
 * This file does not own or edit the cli-surface/ or parallel/ fixture
 * corpora (T-04 / T-05 territory) — it only reads one bad + one good
 * fixture from each, already exercised in full by
 * contract-check-cli-surface.test.cjs and contract-check-parallel.test.cjs.
 * The ONE fixture this file's task DOES add is new:
 * fixtures/spec-lint/parallel/10-pair-sharing-multiple-files/ — see Part 2
 * below.
 *
 * Article III HARD: real fs, zero mocks, `check.run(ctx)` called directly
 * (no CLI spawn — this is a check-logic meta-test, not an output-format
 * test; CONTRACT-LINT-OUTPUT-01 is T-03's territory).
 *
 * @spec [SPEC:AC-10]
 * @task T-08
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContext } = require('../lib/spec-lint/context.cjs');
const checks = require('../lib/spec-lint/registry.cjs');

const CLI_SURFACE_DIR = path.join(__dirname, 'fixtures/spec-lint/cli-surface');
const PARALLEL_DIR = path.join(__dirname, 'fixtures/spec-lint/parallel');
const HEADING_NEAR_MISS_DIR = path.join(__dirname, 'fixtures/spec-lint/heading-near-miss');

// One known-bad + one known-good fixture per registered check, drawn from
// each check's own contract corpus (T-04 for cli-surface, T-05 for
// parallel-collision — both fully exercised elsewhere). This map is the
// thing that "screams": a check present in registry.cjs but absent here
// fails the completeness test below by name, not silently.
const CORPUS = {
  'cli-surface': {
    bad: path.join(CLI_SURFACE_DIR, '01-unknown-verb'),
    good: path.join(CLI_SURFACE_DIR, '05-exact-match'),
  },
  'parallel-collision': {
    bad: path.join(PARALLEL_DIR, '01-two-parallel-same-file'),
    // Fixture 07, not 05: both T-A/T-B here ARE [P] and DO share a file —
    // the check has to actually walk the depends_on graph and find B
    // reaches A (different level) to correctly abstain. Fixture 05 (no
    // task is [P] at all) would make "zero achados" vacuous — condition 1
    // alone rules out every pair there regardless of whether the check's
    // depends_on-graph logic works at all.
    good: path.join(PARALLEL_DIR, '07-parallel-direct-dependency'),
  },
  'heading-near-miss': {
    bad: path.join(HEADING_NEAR_MISS_DIR, '01-mixed-near-miss-forms'),
    good: path.join(HEADING_NEAR_MISS_DIR, '02-real-content-non-vacuous'),
  },
};

/**
 * Proves the "good" fixture was not near-empty before trusting its zero
 * findings. A check that never truly examined the input would ALSO report
 * zero findings against a blank fixture — that would make "zero achados"
 * vacuous instead of evidence of specificity. Pattern per team-lead
 * guidance: contract-check-parallel.test.cjs asserts ctx.tasks shape
 * before trusting zero; contract-check-cli-surface.test.cjs (T-06 hardened
 * version) asserts the loaded artifact's content before trusting zero.
 */
function assertNonTrivialContent(checkName, ctx) {
  if (checkName === 'cli-surface') {
    const quickstart = ctx.artifacts.find((a) => a.file === 'quickstart.md');
    assert.ok(quickstart, `[${checkName}] good fixture must have a quickstart.md to examine`);
    assert.match(
      quickstart.text,
      /```bash[\s\S]*```/,
      `[${checkName}] good fixture's quickstart.md must contain a real fenced invocation — an empty or ` +
        `prose-only file would trivially yield zero findings without the check having examined anything`
    );
  } else if (checkName === 'parallel-collision') {
    assert.ok(ctx.tasks.length >= 2, `[${checkName}] good fixture must parse >=2 tasks, not an empty tasks.md`);
    const parallelTasks = ctx.tasks.filter((t) => t.parallel);
    assert.ok(
      parallelTasks.length >= 2,
      `[${checkName}] good fixture must contain at least two [P] tasks — otherwise "zero achados" is vacuous: ` +
        `condition 1 alone (both must be [P]) already rules out every pair regardless of whether the ` +
        `depends_on-graph logic (condition 3) works at all`
    );
    const anyOverlap = parallelTasks.some((a, i) =>
      parallelTasks.slice(i + 1).some((b) => a.files.some((f) => b.files.includes(f)))
    );
    assert.ok(
      anyOverlap,
      `[${checkName}] good fixture must have at least two [P] tasks that SHARE a file — otherwise condition 2 ` +
        `alone already rules out every pair, and "zero achados" would not exercise condition 3 (the ` +
        `depends_on-graph check) at all`
    );
  } else if (checkName === 'heading-near-miss') {
    const specArtifact = ctx.artifacts.find((a) => a.file === 'spec.md');
    assert.ok(specArtifact, `[${checkName}] good fixture must have a spec.md to examine`);
    assert.match(
      specArtifact.text,
      /^### AC-\d+:/m,
      `[${checkName}] good fixture's spec.md must contain a REAL canonical AC heading — an empty or ` +
        `near-miss-free file would trivially yield zero findings without the check having examined a heading at all`
    );
    const planArtifact = ctx.artifacts.find((a) => a.file === 'plan.md');
    assert.ok(planArtifact, `[${checkName}] good fixture must have a plan.md with a fenced near-miss example`);
    assert.match(
      planArtifact.text,
      /```\n#{1,6}\s*-?\s*\*{0,2}AC-[\s\S]*?```/,
      `[${checkName}] good fixture's plan.md must contain a near-miss-shaped heading INSIDE a fenced block — ` +
        `proving the fence exclusion is exercised, not just absent from the fixture`
    );
    const quickstartArtifact = ctx.artifacts.find((a) => a.file === 'quickstart.md');
    assert.ok(
      quickstartArtifact,
      `[${checkName}] good fixture must have a quickstart.md full of legitimate near-miss-shaped headings`
    );
    assert.match(
      quickstartArtifact.text,
      /^#{1,6}\s*-?\s*\*{0,2}AC-/m,
      `[${checkName}] good fixture's quickstart.md must contain near-miss-shaped headings — proving the ` +
        `quickstart.md file-name exclusion is exercised, not just absent from the fixture`
    );
  } else {
    assert.fail(
      `no non-trivial-content guard defined for check "${checkName}" in this meta-test — add one in ` +
        `assertNonTrivialContent() before trusting its good fixture's zero findings`
    );
  }
}

// ── Part 1: AC-10 meta-test, driven by registry.cjs ────────────────────────

test('AC-10 meta-teste: todo check em registry.cjs tem entrada no corpus deste teste', () => {
  const registered = [...checks.map((c) => c.name)].sort();
  const covered = Object.keys(CORPUS).sort();
  assert.deepEqual(
    registered,
    covered,
    `registry.cjs lista ${JSON.stringify(registered)} mas o corpus deste meta-teste cobre ${JSON.stringify(covered)} — ` +
      `um check registrado sem par de fixtures aqui é exatamente o "check cego" que o AC-10 existe para prevenir`
  );
});

test('AC-10 meta-teste: SENSIBILIDADE — cada check em registry.cjs acusa o seu fixture conhecido-RUIM', () => {
  for (const check of checks) {
    const entry = CORPUS[check.name];
    assert.ok(entry, `check "${check.name}" sem entrada no corpus deste meta-teste`);
    const ctx = buildContext(entry.bad);
    const result = check.run(ctx);
    assert.equal(
      result.status,
      'ran',
      `[${check.name}] fixture conhecido-ruim (${path.basename(entry.bad)}) veio com status "${result.status}" — ` +
        `um fixture pulado não prova sensibilidade nenhuma`
    );
    assert.ok(
      result.findings.length >= 1,
      `[${check.name}] fixture conhecido-ruim (${path.basename(entry.bad)}) produziu ZERO achados — este check ` +
        `só tem o lado bom do corpus, exatamente o "0 conflitos" que o AC-10 existe para pegar`
    );
  }
});

test('AC-10 meta-teste: ESPECIFICIDADE — cada check em registry.cjs fica quieto no seu fixture conhecido-BOM (não-vácuo)', () => {
  for (const check of checks) {
    const entry = CORPUS[check.name];
    assert.ok(entry, `check "${check.name}" sem entrada no corpus deste meta-teste`);
    const ctx = buildContext(entry.good);
    assertNonTrivialContent(check.name, ctx);
    const result = check.run(ctx);
    assert.equal(
      result.status,
      'ran',
      `[${check.name}] fixture conhecido-bom (${path.basename(entry.good)}) veio com status "${result.status}"`
    );
    assert.equal(
      result.findings.length,
      0,
      `[${check.name}] fixture conhecido-bom (${path.basename(entry.good)}) produziu achado — falso-positivo: ` +
        `${JSON.stringify(result.findings)}`
    );
  }
});

// ── Part 2: o fixture que faltava — par [P] compartilhando >1 arquivo ─────
// CONTRACT-CHECK-PARALLEL-01 §Achado (redação corrigida em 2026-08-16):
// "Um achado por par colidente — não por arquivo." Nenhum dos 9 fixtures
// originais exercita um par com mais de um arquivo em comum, então essa
// divergência de leitura ficava invisível. Este teste prova a leitura
// corrigida contra a implementação real de checks/parallel-collision.cjs.

test('T-08 fixture 10: par [P] compartilhando DOIS arquivos -> 1 achado (não 2), nomeando os dois e nenhum exclusivo', () => {
  const parallelCollision = checks.find((c) => c.name === 'parallel-collision');
  assert.ok(parallelCollision, 'parallel-collision must be registered');

  const ctx = buildContext(path.join(PARALLEL_DIR, '10-pair-sharing-multiple-files'));
  assert.equal(ctx.tasks.length, 2, 'precondition: fixture must parse both tasks');
  const taskA = ctx.tasks.find((t) => t.id === 'T-A');
  const taskB = ctx.tasks.find((t) => t.id === 'T-B');
  assert.ok(taskA && taskB, 'precondition: both T-A and T-B must parse');
  assert.deepEqual(
    taskA.files,
    ['core/a-only.cjs', 'core/shared1.cjs', 'core/shared2.cjs'],
    'precondition: T-A files as the fixture wrote them'
  );
  assert.deepEqual(
    taskB.files,
    ['core/shared1.cjs', 'core/shared2.cjs', 'core/b-only.cjs'],
    'precondition: T-B files as the fixture wrote them'
  );
  assert.ok(taskA.parallel && taskB.parallel, 'precondition: both tasks are [P]');
  assert.equal(taskA.dependsOn.length, 0, 'precondition: T-A declares no depends_on');
  assert.equal(taskB.dependsOn.length, 0, 'precondition: T-B declares no depends_on');

  const result = parallelCollision.run(ctx);
  assert.equal(result.status, 'ran');
  assert.equal(
    result.findings.length,
    1,
    `expected exactly 1 achado (one colliding PAIR, not one per shared file), got ${result.findings.length}: ` +
      JSON.stringify(result.findings)
  );

  const [finding] = result.findings;
  assert.equal(finding.check, 'parallel-collision');
  assert.equal(finding.file, 'tasks.md');
  assert.equal(finding.line, taskB.line, '"task posterior" = maior linha no tasks.md — T-B aparece depois de T-A');
  assert.match(finding.message, /T-A/);
  assert.match(finding.message, /T-B/);
  assert.match(finding.message, /core\/shared1\.cjs/, 'message must name the first shared file');
  assert.match(finding.message, /core\/shared2\.cjs/, 'message must name the second shared file');
  assert.ok(!finding.message.includes('core/a-only.cjs'), `must NOT name T-A's exclusive file. Got: "${finding.message}"`);
  assert.ok(!finding.message.includes('core/b-only.cjs'), `must NOT name T-B's exclusive file. Got: "${finding.message}"`);
});
