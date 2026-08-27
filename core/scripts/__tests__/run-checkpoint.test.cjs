'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');

function run(args, cwd) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function spawnRun(args, cwd) {
  return new Promise(resolve => {
    const child = spawn('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function makeFixture(runId = 'run-lean-checkpoint') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-lean-checkpoint-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'soma@example.test']);
  git(root, ['config', 'user.name', 'SOMA Test']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'baseline\n');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '-qm', 'baseline']);

  const proofRelative = `.soma/proofs/${runId}/T-1.txt`;
  const proofPath = path.join(root, proofRelative);
  fs.mkdirSync(path.dirname(proofPath), { recursive: true });
  fs.writeFileSync(proofPath, 'node --test: pass\n');

  const state = {
    $schema: 'soma-state/v2', runId, sessionId: 'old-session',
    startedAt: '2026-08-27T10:00:00.000Z', currentState: 'STEP_4_WAVES',
    previousState: 'STEP_3_FOUNDATION', lastTransitionAt: '2026-08-27T10:05:00.000Z',
    featureSlug: 'lean-continuity', specPath: null, planPath: null, tasksPath: null,
    contractsDir: null, teammateNamePrefix: null, activeDispatchIds: [],
    failureCountsByStep: {}, fixLoopIterations: 0, snapshots: [],
    humanGatesApproved: {}, constitutionVersion: null, constitutionSnapshotPath: null,
    lastSuccessfulState: 'STEP_3_FOUNDATION', baselineSha: null, pausedDiagnostic: null,
    decisions: [],
    reports: [{ step: 'T-1', status: 'pass', path: proofRelative, finished_at: '2026-08-27T10:04:00.000Z' }],
  };
  fs.mkdirSync(path.join(root, '.soma'), { recursive: true });
  const statePath = path.join(root, '.soma', `run-state-${runId}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  const dispatchDir = path.join(root, '.soma', 'dispatches', runId, 'T-1');
  fs.mkdirSync(dispatchDir, { recursive: true });
  fs.writeFileSync(path.join(dispatchDir, 'prompt.md'), 'Implement T-1.\n');
  fs.writeFileSync(path.join(dispatchDir, 'output.md'), 'done at commit abc1234\n');
  fs.writeFileSync(path.join(dispatchDir, 'metadata.json'), JSON.stringify({
    schema: 'soma-dispatch-record/v1', run_id: runId, task_id: 'T-1', attempt: 1,
    model: 'test-model', base_sha: 'abc1234', started_at: '2026-08-27T10:01:00.000Z',
    finished_at: '2026-08-27T10:04:00.000Z', ac_refs: ['AC-1'], executor_agent: 'agent-1', result: 'done',
  }, null, 2) + '\n');

  const input = {
    $schema: 'soma-checkpoint-input/v1', runId, sequence: 1,
    currentState: 'STEP_4_WAVES', nextTask: 'T-2',
    tasks: [{ id: 'T-1', status: 'passed', attempts: 1 }, { id: 'T-2', status: 'pending', attempts: 0 }],
    blocker: null, nextDecision: null,
  };
  const inputPath = path.join(root, 'checkpoint-input.json');
  fs.writeFileSync(inputPath, JSON.stringify(input));
  return { root, runId, input, inputPath, statePath, proofPath, dispatchDir };
}

test('checkpoint derives hashes, closed dispatches, proofs and Git facts into immutable canonical JSON', () => {
  const fixture = makeFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, 'working.txt'), 'dirty\n');
    const result = run(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root);
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    const expectedPath = path.join(fs.realpathSync(fixture.root), '.soma', 'checkpoints', fixture.runId, '1.json');
    assert.equal(response.path, expectedPath);
    const bytes = fs.readFileSync(expectedPath);
    const checkpoint = JSON.parse(bytes);
    assert.equal(checkpoint.$schema, 'soma-checkpoint/v1');
    assert.equal(checkpoint.runId, fixture.runId);
    assert.equal(checkpoint.sequence, 1);
    assert.equal(checkpoint.lastCompletedTask, 'T-1');
    assert.deepEqual(checkpoint.tasks.map(task => task.id), ['T-1', 'T-2']);
    assert.equal(checkpoint.runState.sha256, sha(fs.readFileSync(fixture.statePath)));
    assert.equal(checkpoint.dispatches.length, 1);
    assert.equal(checkpoint.dispatches[0].taskId, 'T-1');
    assert.match(checkpoint.dispatches[0].components.prompt.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(checkpoint.commitProofs, [{ baseSha: 'abc1234', taskId: 'T-1', attempt: 1 }]);
    assert.equal(checkpoint.proofs[0].path, `.soma/proofs/${fixture.runId}/T-1.txt`);
    assert.equal(checkpoint.proofs[0].sha256, sha(fs.readFileSync(fixture.proofPath)));
    assert.equal(checkpoint.git.head, git(fixture.root, ['rev-parse', 'HEAD']));
    assert.ok(checkpoint.git.dirtyEntries.some(entry => entry.path === 'working.txt'));
    assert.equal(bytes.toString('utf8'), JSON.stringify(checkpoint), 'checkpoint bytes must be canonical JSON without presentation whitespace');

    fs.writeFileSync(fixture.inputPath, JSON.stringify({ ...fixture.input, nextTask: 'T-OTHER' }));
    const overwrite = run(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root);
    assert.notEqual(overwrite.status, 0);
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), bytes.toString('utf8'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('checkpoint rejects active dispatches, decreasing sequences and proof paths outside the project without publishing', () => {
  const active = makeFixture('run-active-dispatch');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-proof-outside-'));
  try {
    fs.unlinkSync(path.join(active.dispatchDir, 'output.md'));
    let result = run(['checkpoint', '--run', active.runId, '--input-file', active.inputPath], active.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DISPATCH_ACTIVE/);
    assert.equal(fs.existsSync(path.join(active.root, '.soma', 'checkpoints')), false);

    fs.writeFileSync(path.join(active.dispatchDir, 'output.md'), 'done\n');
    const externalProof = path.join(outside, 'proof.txt');
    fs.writeFileSync(externalProof, 'external\n');
    const state = JSON.parse(fs.readFileSync(active.statePath, 'utf8'));
    state.reports[0].path = externalProof;
    fs.writeFileSync(active.statePath, JSON.stringify(state, null, 2) + '\n');
    result = run(['checkpoint', '--run', active.runId, '--input-file', active.inputPath], active.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PROOF_PATH_OUTSIDE_PROJECT/);

    state.reports[0].path = `.soma/proofs/${active.runId}/T-1.txt`;
    fs.writeFileSync(active.statePath, JSON.stringify(state, null, 2) + '\n');
    const sequence2 = { ...active.input, sequence: 2 };
    fs.writeFileSync(active.inputPath, JSON.stringify(sequence2));
    assert.equal(run(['checkpoint', '--run', active.runId, '--input-file', active.inputPath], active.root).status, 0);
    fs.writeFileSync(active.inputPath, JSON.stringify({ ...active.input, sequence: 1 }));
    result = run(['checkpoint', '--run', active.runId, '--input-file', active.inputPath], active.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CHECKPOINT_SEQUENCE_DECREASED/);
  } finally {
    fs.rmSync(active.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('checkpoint accepts only the exact soma-checkpoint-input/v1 shape and matching run id', () => {
  const fixture = makeFixture('run-checkpoint-schema');
  try {
    for (const input of [
      { ...fixture.input, extra: true },
      { ...fixture.input, runId: 'run-different' },
      { ...fixture.input, tasks: [{ id: 'T-1', status: 'passed', attempts: -1 }] },
    ]) {
      fs.writeFileSync(fixture.inputPath, JSON.stringify(input));
      const result = run(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root);
      assert.notEqual(result.status, 0, JSON.stringify(input));
      assert.equal(fs.existsSync(path.join(fixture.root, '.soma', 'checkpoints')), false);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('checkpoint refuses nextTask null while work remains unless blocker and named nextDecision make the pause explicit', () => {
  const fixture = makeFixture('run-checkpoint-task-coherence');
  try {
    for (const invalid of [
      { ...fixture.input, nextTask: null },
      { ...fixture.input, nextTask: null, blocker: 'waiting', nextDecision: null },
      { ...fixture.input, nextTask: 'T-missing' },
      { ...fixture.input, nextTask: 'T-1' },
    ]) {
      fs.writeFileSync(fixture.inputPath, JSON.stringify(invalid));
      const result = run(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root);
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
      assert.match(result.stderr, /CHECKPOINT_INPUT_INVALID/);
    }
    fs.writeFileSync(fixture.inputPath, JSON.stringify({
      ...fixture.input, nextTask: null, blocker: 'awaiting policy', nextDecision: 'Choose policy A or B',
    }));
    assert.equal(run(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root).status, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('same-sequence concurrent checkpoint publishers produce one immutable winner', async () => {
  const fixture = makeFixture('run-checkpoint-concurrent');
  try {
    const { reserveRunIdentity } = require('../run/run-id.cjs');
    reserveRunIdentity({ projectRoot: fixture.root, runId: fixture.runId, allowNew: true });
    const results = await Promise.all([
      spawnRun(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root),
      spawnRun(['checkpoint', '--run', fixture.runId, '--input-file', fixture.inputPath], fixture.root),
    ]);
    assert.deepEqual(results.map(item => item.status).sort(), [0, 2]);
    const loser = results.find(item => item.status === 2);
    assert.match(loser.stderr, /CHECKPOINT_IMMUTABLE/);
    const checkpointPath = path.join(fixture.root, '.soma', 'checkpoints', fixture.runId, '1.json');
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(checkpointPath, 'utf8')));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('dirty filtering ignores a nested projectRoot .soma relative to the actual Git root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-checkpoint-workspace-'));
  const workspace = path.join(root, 'packages', 'app');
  fs.mkdirSync(path.join(workspace, '.soma', 'runtime'), { recursive: true });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'soma@example.test']);
  git(root, ['config', 'user.name', 'SOMA Test']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'baseline\n');
  git(root, ['add', 'tracked.txt']); git(root, ['commit', '-qm', 'baseline']);
  fs.writeFileSync(path.join(workspace, '.soma', 'runtime', 'state.json'), '{}\n');
  try {
    const { readContinuityGitFacts } = require('../run/checkpoint.cjs');
    const facts = readContinuityGitFacts(workspace);
    assert.equal(facts.dirtyEntries.some(entry => entry.path.startsWith('packages/app/.soma/')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
