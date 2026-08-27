'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const { routeEntryRequest } = require('../entry/request.cjs');

function command(args, cwd) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(runId = 'run-entry-resume', options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-resume-'));
  git(root, ['init', '-q']); git(root, ['config', 'user.email', 'soma@example.test']);
  git(root, ['config', 'user.name', 'SOMA Test']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'baseline\n');
  let scope = root;
  if (options.monorepo) {
    scope = path.join(root, 'packages', 'app');
    fs.mkdirSync(scope, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    fs.writeFileSync(path.join(scope, 'package.json'), JSON.stringify({ name: 'app' }));
  }
  git(root, ['add', 'tracked.txt']); git(root, ['commit', '-qm', 'baseline']);
  fs.mkdirSync(path.join(root, '.soma'), { recursive: true });
  const proof = `.soma/proofs/${runId}/T-1.txt`;
  fs.mkdirSync(path.join(root, path.dirname(proof)), { recursive: true });
  fs.writeFileSync(path.join(root, proof), 'proof\n');
  const statePath = path.join(root, '.soma', `run-state-${runId}.json`);
  fs.writeFileSync(statePath, JSON.stringify({
    $schema: 'soma-state/v2', runId, sessionId: 'dead-session', startedAt: '2026-08-27T10:00:00Z',
    currentState: 'STEP_4_WAVES', previousState: 'STEP_3_FOUNDATION', lastTransitionAt: '2026-08-27T10:01:00Z',
    activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0, snapshots: [], humanGatesApproved: {}, decisions: [],
    reports: [{ step: 'T-1', status: 'pass', path: proof, finished_at: '2026-08-27T10:01:00Z' }],
  }, null, 2) + '\n');
  const dispatch = path.join(root, '.soma', 'dispatches', runId, 'T-1');
  fs.mkdirSync(dispatch, { recursive: true });
  fs.writeFileSync(path.join(dispatch, 'prompt.md'), 'do it\n');
  fs.writeFileSync(path.join(dispatch, 'output.md'), 'done\n');
  fs.writeFileSync(path.join(dispatch, 'metadata.json'), JSON.stringify({
    schema: 'soma-dispatch-record/v1', run_id: runId, task_id: 'T-1', attempt: 1, model: 'test', base_sha: 'abc1234',
    started_at: '2026-08-27T10:00:00Z', finished_at: '2026-08-27T10:01:00Z', ac_refs: ['AC-1'], executor_agent: 'agent-1', result: 'done',
  }, null, 2) + '\n');
  const input = path.join(root, 'checkpoint-input.json');
  fs.writeFileSync(input, JSON.stringify({
    $schema: 'soma-checkpoint-input/v1', runId, sequence: 1, currentState: 'STEP_4_WAVES', nextTask: 'T-2',
    tasks: [{ id: 'T-1', status: 'passed', attempts: 1 }, { id: 'T-2', status: 'pending', attempts: 0 }], blocker: null, nextDecision: null,
  }));
  assert.equal(command(['checkpoint', '--run', runId, '--input-file', input], root).status, 0);
  const handoff = command(['handoff', '--run', runId], root);
  assert.equal(handoff.status, 0, handoff.stderr);
  return { root, runId, scope, proof, statePath, handoff: JSON.parse(handoff.stdout) };
}

function resume(fx, runId = fx.runId) {
  return routeEntryRequest(
    { mode: 'resume', runId, project: fx.root },
    { cwd: fx.root, home: path.join(fx.root, 'not-home'), sessionId: 'new-session' }
  );
}

test('a new session resumes the exact unfinished task and never returns passed tasks', () => {
  const fx = fixture();
  try {
    const result = resume(fx);
    assert.deepEqual(result, {
      status: 'RESUME_READY', runId: fx.runId, reentryState: 'STEP_4_WAVES',
      nextTask: 'T-2', handoffGeneration: 1, executionScope: fs.realpathSync(fx.root),
    });
    assert.notEqual(result.nextTask, 'T-1');
    const lock = JSON.parse(fs.readFileSync(path.join(fx.root, '.soma.lock'), 'utf8'));
    assert.equal(lock.runId, fx.runId);
    assert.equal(lock.sessionId, 'new-session');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('declared workspace resumes from repository continuity while preserving workspace execution scope', () => {
  const fx = fixture('run-resume-workspace', { monorepo: true });
  try {
    const result = routeEntryRequest(
      { mode: 'resume', runId: fx.runId, project: fx.scope },
      { cwd: fx.root, home: path.join(fx.root, 'not-home'), sessionId: 'workspace-session' }
    );
    assert.equal(result.status, 'RESUME_READY');
    assert.equal(result.executionScope, fs.realpathSync(fx.scope));
    assert.equal(fs.existsSync(path.join(fx.root, '.soma.lock')), true);
    assert.equal(fs.existsSync(path.join(fx.scope, '.soma.lock')), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('run lock is idempotent for one session, busy for a competitor, and never clobbered', () => {
  const fx = fixture('run-resume-lock');
  try {
    const first = resume(fx);
    assert.equal(first.status, 'RESUME_READY');
    const lockPath = path.join(fx.root, '.soma.lock');
    const bytes = fs.readFileSync(lockPath);
    const stat = fs.statSync(lockPath, { bigint: true });
    const same = resume(fx);
    assert.equal(same.status, 'RESUME_READY');
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    assert.equal(fs.statSync(lockPath, { bigint: true }).mtimeNs, stat.mtimeNs);
    const competitor = routeEntryRequest(
      { mode: 'resume', runId: fx.runId, project: fx.root },
      { cwd: fx.root, home: path.join(fx.root, 'not-home'), sessionId: 'other-session' }
    );
    assert.equal(competitor.status, 'RESUME_BUSY');
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('newer immutable handoff replaces only same-run legacy or prior-generation locks', () => {
  for (const [name, lock] of [
    ['legacy', runId => ({ runId, sessionId: 'old-session', startedAt: '2026-08-26T00:00:00Z' })],
    ['prior', runId => ({
      $schema: 'soma-run-lock/v1', runId, sessionId: 'old-session', startedAt: '2026-08-26T00:00:00Z',
      handoffGeneration: 0, executionScope: '/old/scope',
    })],
  ]) {
    const fx = fixture(`run-resume-stale-${name}`);
    try {
      const lockPath = path.join(fx.root, '.soma.lock');
      fs.writeFileSync(lockPath, JSON.stringify(lock(fx.runId)));
      const result = resume(fx);
      assert.equal(result.status, 'RESUME_READY', name);
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      assert.equal(current.$schema, 'soma-run-lock/v1');
      assert.equal(current.handoffGeneration, 1);
      assert.equal(current.sessionId, 'new-session');
    } finally {
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  }
});

test('malformed and conflicting locks fail closed and remain byte-identical', () => {
  for (const [name, value] of [
    ['malformed', '{not-json'],
    ['conflicting', JSON.stringify({ runId: 'run-other', sessionId: 'holder', startedAt: '2026-08-27T00:00:00Z' })],
  ]) {
    const fx = fixture(`run-resume-closed-${name}`);
    try {
      const lockPath = path.join(fx.root, '.soma.lock');
      fs.writeFileSync(lockPath, value);
      const before = fs.readFileSync(lockPath);
      const result = resume(fx);
      assert.equal(result.status, 'RESUME_BUSY');
      assert.deepEqual(fs.readFileSync(lockPath), before);
    } finally {
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  }
});

function spawnResume(fx, sessionId) {
  const continuity = path.resolve(__dirname, '..', 'entry', 'continuity.cjs');
  const payload = {
    projectRoot: fs.realpathSync(fx.root), requestedRunId: fx.runId,
    executionScope: fs.realpathSync(fx.scope), sessionId,
  };
  const script = `
    const { resumeContinuity } = require(${JSON.stringify(continuity)});
    process.stdout.write(JSON.stringify(resumeContinuity(${JSON.stringify(payload)})));
  `;
  return new Promise(resolve => {
    const child = spawn('node', ['-e', script], { cwd: fx.root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('concurrent resume contenders yield one ready owner and one stable busy result', async () => {
  const fx = fixture('run-resume-concurrent-lock');
  try {
    const children = await Promise.all([spawnResume(fx, 'session-a'), spawnResume(fx, 'session-b')]);
    assert.deepEqual(children.map(child => child.status), [0, 0]);
    const statuses = children.map(child => JSON.parse(child.stdout).status).sort();
    assert.deepEqual(statuses, ['RESUME_BUSY', 'RESUME_READY']);
    const lock = JSON.parse(fs.readFileSync(path.join(fx.root, '.soma.lock'), 'utf8'));
    assert.ok(['session-a', 'session-b'].includes(lock.sessionId));
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('resume rereads durable inputs and persists RESUME_DRIFT before creating a lock', () => {
  for (const [name, mutate] of [
    ['Git dirty content', fx => fs.writeFileSync(path.join(fx.root, 'tracked.txt'), 'changed\n')],
    ['Git HEAD', fx => {
      fs.writeFileSync(path.join(fx.root, 'tracked.txt'), 'new commit\n');
      git(fx.root, ['add', 'tracked.txt']); git(fx.root, ['commit', '-qm', 'new head']);
    }],
    ['run state bytes', fx => fs.appendFileSync(fx.statePath, ' ')],
    ['dispatch bytes', fx => fs.appendFileSync(path.join(fx.root, '.soma', 'dispatches', fx.runId, 'T-1', 'prompt.md'), 'changed\n')],
    ['run identity', fx => fs.unlinkSync(path.join(fx.root, '.soma', 'run-identities', `${fx.runId}.json`))],
    ['proof bytes', fx => fs.writeFileSync(path.join(fx.root, fx.proof), 'changed proof\n')],
    ['checkpoint bytes', fx => fs.appendFileSync(path.join(fx.root, '.soma', 'checkpoints', fx.runId, '1.json'), ' ')],
    ['handoff bytes', fx => fs.appendFileSync(fx.handoff.jsonPath, ' ')],
  ]) {
    const fx = fixture(`run-drift-${name.replace(/\W+/g, '-').toLowerCase()}`);
    try {
      mutate(fx);
      const result = resume(fx);
      assert.equal(result.status, 'RESUME_DRIFT', name);
      assert.equal(fs.existsSync(path.join(fx.root, '.soma.lock')), false, name);
      if (name === 'run identity') {
        assert.equal(
          fs.existsSync(path.join(fx.root, '.soma', 'run-identities', `${fx.runId}.json`)),
          false,
          'rejected resume must not recreate identity evidence before continuity passes'
        );
      }
      const diagnostic = path.join(fx.root, '.soma', 'diagnostics', `${fx.runId}-resume-drift.json`);
      assert.equal(fs.existsSync(diagnostic), true, name);
      assert.equal(JSON.parse(fs.readFileSync(diagnostic, 'utf8')).$schema, 'soma-resume-drift/v1');
    } finally {
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  }
});

test('missing and ambiguous resume are stable read-only errors; help and status create no lock', () => {
  const fx = fixture('run-resume-one');
  try {
    let result = resume(fx, 'run-does-not-exist');
    assert.equal(result.status, 'RESUME_NOT_FOUND');
    assert.equal(fs.existsSync(path.join(fx.root, '.soma.lock')), false);
    result = routeEntryRequest({ mode: 'help' }, { cwd: fx.root });
    assert.equal(result.status, 'HELP_SHOWN');
    assert.equal(fs.existsSync(path.join(fx.root, '.soma.lock')), false);
    result = routeEntryRequest({ mode: 'status', project: fx.root }, { cwd: fx.root, home: path.join(fx.root, 'not-home') });
    assert.equal(result.status, 'STATUS_SHOWN');
    assert.equal(fs.existsSync(path.join(fx.root, '.soma.lock')), false);

    const second = path.join(fx.root, '.soma', 'handoffs', 'run-resume-two', '1');
    fs.mkdirSync(second, { recursive: true });
    result = routeEntryRequest(
      { mode: 'resume', runId: null, project: fx.root },
      { cwd: fx.root, home: path.join(fx.root, 'not-home') }
    );
    assert.equal(result.status, 'RESUME_AMBIGUOUS');
    assert.equal(fs.existsSync(path.join(fx.root, '.soma.lock')), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
