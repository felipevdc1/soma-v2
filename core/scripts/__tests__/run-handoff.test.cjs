'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');

function run(args, cwd) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function spawnRun(args, cwd) {
  return new Promise(resolve => {
    const child = spawn('node', [RUN_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(runId = 'run-lean-handoff') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-lean-handoff-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'soma@example.test']);
  git(root, ['config', 'user.name', 'SOMA Test']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'baseline\n');
  git(root, ['add', 'tracked.txt']); git(root, ['commit', '-qm', 'baseline']);
  const proof = `.soma/proofs/${runId}/T-1.txt`;
  fs.mkdirSync(path.join(root, path.dirname(proof)), { recursive: true });
  fs.writeFileSync(path.join(root, proof), 'proof\n');
  const state = {
    $schema: 'soma-state/v2', runId, sessionId: 'session-a', startedAt: '2026-08-27T10:00:00Z',
    currentState: 'STEP_4_WAVES', previousState: 'STEP_3_FOUNDATION', lastTransitionAt: '2026-08-27T10:01:00Z',
    activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0, snapshots: [], humanGatesApproved: {},
    decisions: [], reports: [{ step: 'T-1', status: 'pass', path: proof, finished_at: '2026-08-27T10:01:00Z' }],
  };
  fs.mkdirSync(path.join(root, '.soma'), { recursive: true });
  fs.writeFileSync(path.join(root, '.soma', `run-state-${runId}.json`), JSON.stringify(state, null, 2) + '\n');
  const dispatch = path.join(root, '.soma', 'dispatches', runId, 'T-1');
  fs.mkdirSync(dispatch, { recursive: true });
  fs.writeFileSync(path.join(dispatch, 'prompt.md'), 'do it\n');
  fs.writeFileSync(path.join(dispatch, 'output.md'), 'done\n');
  fs.writeFileSync(path.join(dispatch, 'metadata.json'), JSON.stringify({
    schema: 'soma-dispatch-record/v1', run_id: runId, task_id: 'T-1', attempt: 1, model: 'test',
    base_sha: 'abc1234', started_at: '2026-08-27T10:00:00Z', finished_at: '2026-08-27T10:01:00Z',
    ac_refs: ['AC-1'], executor_agent: 'agent-1', result: 'done',
  }, null, 2) + '\n');
  const inputPath = path.join(root, 'checkpoint.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    $schema: 'soma-checkpoint-input/v1', runId, sequence: 1, currentState: 'STEP_4_WAVES', nextTask: 'T-2',
    tasks: [{ id: 'T-1', status: 'passed', attempts: 1 }, { id: 'T-2', status: 'pending', attempts: 0 }],
    blocker: null, nextDecision: null,
  }));
  const checkpoint = run(['checkpoint', '--run', runId, '--input-file', inputPath], root);
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  return { root, runId, dispatch };
}

test('handoff publishes immutable authoritative JSON and derived Markdown with exact resume command', () => {
  const fx = fixture();
  try {
    const result = run(['handoff', '--run', fx.runId], fx.root);
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.generation, 1);
    const generation = path.join(fs.realpathSync(fx.root), '.soma', 'handoffs', fx.runId, '1');
    const jsonPath = path.join(generation, 'handoff.json');
    const markdownPath = path.join(generation, 'handoff.md');
    assert.equal(response.jsonPath, jsonPath);
    const bytes = fs.readFileSync(jsonPath);
    const handoff = JSON.parse(bytes);
    assert.equal(handoff.$schema, 'soma-handoff/v1');
    assert.equal(handoff.runId, fx.runId);
    assert.equal(handoff.generation, 1);
    assert.equal(handoff.nextTask, 'T-2');
    assert.equal(handoff.lastCompletedTask, 'T-1');
    assert.equal(handoff.tasks.find(task => task.id === 'T-1').status, 'passed');
    assert.match(handoff.checkpoint.sha256, /^[a-f0-9]{64}$/);
    assert.match(handoff.runState.sha256, /^[a-f0-9]{64}$/);
    assert.match(handoff.dispatches[0].components.metadata.sha256, /^[a-f0-9]{64}$/);
    assert.equal(handoff.resumeCommand, `/soma-run --resume ${fx.runId}`);
    assert.equal(bytes.toString('utf8'), JSON.stringify(handoff));
    assert.match(fs.readFileSync(markdownPath, 'utf8'), new RegExp(`/soma-run --resume ${fx.runId}`));

    const firstJson = fs.readFileSync(jsonPath);
    const second = run(['handoff', '--run', fx.runId], fx.root);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).generation, 2);
    assert.deepEqual(fs.readFileSync(jsonPath), firstJson, 'prior handoff generations must remain immutable');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('handoff ignores bounded private crash residue but fails closed on unexpected entries', () => {
  const residue = fixture('run-handoff-residue');
  try {
    const handoffs = path.join(residue.root, '.soma', 'handoffs', residue.runId);
    fs.mkdirSync(path.join(handoffs, '.1.999.a1b2c3d4e5f6.tmp'), { recursive: true });
    let result = run(['handoff', '--run', residue.runId], residue.root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).generation, 1);
    fs.mkdirSync(path.join(handoffs, 'unexpected-entry'));
    result = run(['handoff', '--run', residue.runId], residue.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HANDOFF_STORAGE_INVALID/);
  } finally {
    fs.rmSync(residue.root, { recursive: true, force: true });
  }
});

test('concurrent handoff publishers never overwrite a generation', async () => {
  const fx = fixture('run-handoff-concurrent');
  try {
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      spawnRun(['handoff', '--run', fx.runId], fx.root)
    ));
    const successes = results.filter(item => item.status === 0).map(item => JSON.parse(item.stdout));
    assert.ok(successes.length >= 1);
    assert.equal(new Set(successes.map(item => item.generation)).size, successes.length);
    for (const result of results.filter(item => item.status !== 0)) {
      assert.match(result.stderr, /HANDOFF_IMMUTABLE/);
    }
    for (const success of successes) {
      const handoff = JSON.parse(fs.readFileSync(success.jsonPath, 'utf8'));
      assert.equal(handoff.generation, success.generation);
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('handoff refuses publication when a dispatch became active after checkpoint', () => {
  const fx = fixture('run-handoff-active');
  try {
    fs.unlinkSync(path.join(fx.dispatch, 'output.md'));
    const result = run(['handoff', '--run', fx.runId], fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DISPATCH_ACTIVE/);
    assert.equal(fs.existsSync(path.join(fx.root, '.soma', 'handoffs')), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
