'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { routeEntryRequest } = require('../entry/request.cjs');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'SOMA test']);
  git(dir, ['config', 'user.email', 'soma@example.test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'fixture']);
}

function snapshotFiles(dir) {
  const result = new Map();
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const child = relative ? path.join(relative, entry.name) : entry.name;
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (entry.isFile()) result.set(child, { bytes: fs.readFileSync(absolute).toString('base64'), mtimeNs: stat.mtimeNs.toString() });
      else if (entry.isDirectory()) visit(absolute, child);
    }
  }
  visit(dir);
  return result;
}

test('help returns before project resolution', () => {
  let resolutions = 0;
  const result = routeEntryRequest(
    { mode: 'help' },
    { resolveProject: () => { resolutions += 1; throw new Error('must not run'); } }
  );
  assert.equal(result.status, 'HELP_SHOWN');
  assert.equal(resolutions, 0);
});

test('status is read-only across project bytes, mtimes, and Git index mtime', () => {
  const project = temp('soma-entry-status-');
  initRepo(project);
  const before = snapshotFiles(project);
  const cwdBefore = process.cwd();
  try {
    const result = routeEntryRequest({ mode: 'status', project }, { cwd: os.tmpdir(), home: os.homedir() });
    assert.equal(result.status, 'STATUS_SHOWN');
    assert.equal(result.projectRoot, fs.realpathSync(project));
    assert.deepEqual(result.run, { state: 'NO_DURABLE_RUN' });
    assert.deepEqual(snapshotFiles(project), before);
    assert.equal(process.cwd(), cwdBefore);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('status reports durable state and handoff facts without changing any byte or mtime', () => {
  const project = temp('soma-entry-status-facts-');
  initRepo(project);
  const runId = 'run-status-facts';
  const soma = path.join(project, '.soma');
  fs.mkdirSync(path.join(soma, 'handoffs', runId, '3'), { recursive: true });
  fs.mkdirSync(path.join(soma, 'checkpoints', runId), { recursive: true });
  const statePath = path.join(soma, `run-state-${runId}.json`);
  const stateBytes = JSON.stringify({
    $schema: 'soma-state/v2', runId, sessionId: 's', startedAt: '2026-08-27T00:00:00Z',
    currentState: 'PAUSED_DIAGNOSTIC', lastTransitionAt: '2026-08-27T00:01:00Z',
    activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
    snapshots: [], humanGatesApproved: {}, decisions: [], reports: [],
  }) + '\n';
  fs.writeFileSync(statePath, stateBytes);
  const identityPath = path.join(soma, 'run-identities', `${runId}.json`);
  const identityBytes = `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  fs.writeFileSync(identityPath, identityBytes);
  const { canonicalJson } = require('../run/checkpoint.cjs');
  const checkpointPath = path.join(soma, 'checkpoints', runId, '7.json');
  const checkpointBytes = canonicalJson({
    $schema: 'soma-checkpoint/v1', runId, sequence: 7, currentState: 'PAUSED_DIAGNOSTIC',
    blocker: 'tests red', nextDecision: 'repair fixture', nextTask: 'T-9',
  });
  fs.writeFileSync(checkpointPath, checkpointBytes);
  const crypto = require('node:crypto');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const zero = '0'.repeat(64);
  const handoff = {
    $schema: 'soma-handoff/v1', runId, generation: 3, currentState: 'PAUSED_DIAGNOSTIC',
    blocker: 'tests red', nextDecision: 'repair fixture', nextTask: 'T-9',
    checkpoint: { path: `.soma/checkpoints/${runId}/7.json`, sequence: 7, sha256: hash(checkpointBytes) },
    commitProofs: [], dispatches: [], git: { dirtyDigest: zero, head: null },
    lastCompletedTask: 'T-8', proofs: [], resumeCommand: `/soma-run --resume ${runId}`,
    runIdentity: { path: `.soma/run-identities/${runId}.json`, sha256: hash(identityBytes) },
    runState: { path: `.soma/run-state-${runId}.json`, sha256: hash(stateBytes) }, tasks: [],
  };
  const { renderHandoffMarkdown } = require('../run/handoff-schema.cjs');
  fs.writeFileSync(path.join(soma, 'handoffs', runId, '3', 'handoff.json'), canonicalJson(handoff));
  fs.writeFileSync(path.join(soma, 'handoffs', runId, '3', 'handoff.md'), renderHandoffMarkdown(handoff));
  const index = path.join(project, '.git', 'index');
  const before = snapshotFiles(project);
  const indexBefore = fs.statSync(index, { bigint: true }).mtimeNs;
  try {
    const result = routeEntryRequest({ mode: 'status', project }, { cwd: project, home: os.homedir() });
    assert.equal(result.status, 'STATUS_SHOWN');
    assert.deepEqual(result.run, {
      runId, currentState: 'PAUSED_DIAGNOSTIC', checkpointSequence: 7, handoffGeneration: 3,
      blocker: 'tests red', nextDecision: 'repair fixture', nextTask: 'T-9',
    });
    assert.deepEqual(snapshotFiles(project), before);
    assert.equal(fs.statSync(index, { bigint: true }).mtimeNs, indexBefore);
    const staleState = JSON.parse(stateBytes);
    staleState.currentState = 'STEP_5_VALIDATE';
    fs.writeFileSync(statePath, `${JSON.stringify(staleState)}\n`);
    const staleBefore = snapshotFiles(project);
    const stale = routeEntryRequest({ mode: 'status', project }, { cwd: project, home: os.homedir() });
    assert.equal(stale.run.state, 'DURABLE_STATUS_INVALID');
    assert.match(stale.run.diagnostic, /run state/i);
    assert.deepEqual(snapshotFiles(project), staleBefore);
    fs.writeFileSync(statePath, stateBytes);
    fs.writeFileSync(checkpointPath, `${checkpointBytes}\n`);
    const corruptBefore = snapshotFiles(project);
    const corrupt = routeEntryRequest({ mode: 'status', project }, { cwd: project, home: os.homedir() });
    assert.equal(corrupt.run.state, 'DURABLE_STATUS_INVALID');
    assert.match(corrupt.run.diagnostic, /checkpoint/i);
    assert.deepEqual(snapshotFiles(project), corruptBefore);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('status rejects every invalid pre-handoff run identity without mutating the project', () => {
  const project = temp('soma-entry-status-identity-invalid-');
  initRepo(project);
  const runId = 'run-status-identity-invalid';
  const soma = path.join(project, '.soma');
  const identityPath = path.join(soma, 'run-identities', `${runId}.json`);
  const state = {
    $schema: 'soma-state/v2', runId, sessionId: 's', startedAt: '2026-08-27T00:00:00Z',
    currentState: 'PAUSED_DIAGNOSTIC', lastTransitionAt: '2026-08-27T00:01:00Z',
    activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
    snapshots: [], humanGatesApproved: {}, decisions: [], reports: [],
  };
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  fs.writeFileSync(path.join(soma, `run-state-${runId}.json`), `${JSON.stringify(state)}\n`);
  const cases = [
    ['missing', () => fs.rmSync(identityPath, { force: true })],
    ['malformed', () => fs.writeFileSync(identityPath, '{broken')],
    ['wrong run', () => fs.writeFileSync(identityPath, `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId: 'run-other' }, null, 2)}\n`)],
    ['noncanonical', () => fs.writeFileSync(identityPath, `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId })}\n`)],
    ['nonregular', () => { fs.rmSync(identityPath, { force: true }); fs.mkdirSync(identityPath); }],
  ];
  try {
    for (const [label, arrange] of cases) {
      fs.rmSync(identityPath, { recursive: true, force: true });
      arrange();
      const before = snapshotFiles(project);
      const result = routeEntryRequest({ mode: 'status', project }, { cwd: project });
      assert.equal(result.run.state, 'DURABLE_STATUS_INVALID', label);
      assert.match(result.run.diagnostic, /identity/i, label);
      assert.deepEqual(snapshotFiles(project), before, label);
    }
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('status preserves a valid pre-handoff run with null durable generations', () => {
  const project = temp('soma-entry-status-pre-handoff-');
  initRepo(project);
  const runId = 'run-status-pre-handoff';
  const soma = path.join(project, '.soma');
  const state = {
    $schema: 'soma-state/v2', runId, sessionId: 's', startedAt: '2026-08-27T00:00:00Z',
    currentState: 'PAUSED_DIAGNOSTIC', lastTransitionAt: '2026-08-27T00:01:00Z',
    activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
    snapshots: [], humanGatesApproved: {}, decisions: [], reports: [],
  };
  fs.mkdirSync(path.join(soma, 'run-identities'), { recursive: true });
  fs.writeFileSync(path.join(soma, `run-state-${runId}.json`), `${JSON.stringify(state)}\n`);
  fs.writeFileSync(
    path.join(soma, 'run-identities', `${runId}.json`),
    `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2)}\n`
  );
  const before = snapshotFiles(project);
  try {
    const result = routeEntryRequest({ mode: 'status', project }, { cwd: project });
    assert.equal(result.status, 'STATUS_SHOWN');
    assert.deepEqual(result.run, {
      runId, currentState: 'PAUSED_DIAGNOSTIC', checkpointSequence: null, handoffGeneration: null,
      blocker: null, nextDecision: null, nextTask: null,
    });
    assert.deepEqual(snapshotFiles(project), before);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('status rejects symlinked durable ancestors and leaf identity without mutating either tree', () => {
  const project = temp('soma-entry-status-symlink-');
  const external = temp('soma-entry-status-external-');
  initRepo(project);
  const runId = 'run-status-symlink';
  const state = {
    $schema: 'soma-state/v2', runId, sessionId: 's', startedAt: '2026-08-27T00:00:00Z',
    currentState: 'PAUSED_DIAGNOSTIC', lastTransitionAt: '2026-08-27T00:01:00Z',
    activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
    snapshots: [], humanGatesApproved: {}, decisions: [], reports: [],
  };
  const identity = `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2)}\n`;
  const writeRun = soma => {
    fs.mkdirSync(path.join(soma, 'run-identities'), { recursive: true });
    fs.writeFileSync(path.join(soma, `run-state-${runId}.json`), `${JSON.stringify(state)}\n`);
    fs.writeFileSync(path.join(soma, 'run-identities', `${runId}.json`), identity);
  };
  const cases = [
    ['soma root', () => {
      const externalSoma = path.join(external, 'soma-root');
      writeRun(externalSoma);
      fs.symlinkSync(externalSoma, path.join(project, '.soma'), 'dir');
    }],
    ['run identities ancestor', () => {
      const soma = path.join(project, '.soma');
      fs.mkdirSync(soma, { recursive: true });
      fs.writeFileSync(path.join(soma, `run-state-${runId}.json`), `${JSON.stringify(state)}\n`);
      const externalIdentities = path.join(external, 'identities-ancestor');
      fs.mkdirSync(externalIdentities, { recursive: true });
      fs.writeFileSync(path.join(externalIdentities, `${runId}.json`), identity);
      fs.symlinkSync(externalIdentities, path.join(soma, 'run-identities'), 'dir');
    }],
    ['identity leaf', () => {
      const soma = path.join(project, '.soma');
      fs.mkdirSync(path.join(soma, 'run-identities'), { recursive: true });
      fs.writeFileSync(path.join(soma, `run-state-${runId}.json`), `${JSON.stringify(state)}\n`);
      const externalIdentity = path.join(external, 'identity-leaf.json');
      fs.writeFileSync(externalIdentity, identity);
      fs.symlinkSync(externalIdentity, path.join(soma, 'run-identities', `${runId}.json`));
    }],
  ];
  try {
    for (const [label, arrange] of cases) {
      fs.rmSync(path.join(project, '.soma'), { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
      fs.mkdirSync(external, { recursive: true });
      arrange();
      const projectBefore = snapshotFiles(project);
      const externalBefore = snapshotFiles(external);
      const result = routeEntryRequest({ mode: 'status', project }, { cwd: project });
      assert.equal(result.run.state, 'DURABLE_STATUS_INVALID', label);
      assert.match(result.run.diagnostic, /symlink|durable|identity/i, label);
      assert.deepEqual(snapshotFiles(project), projectBefore, label);
      assert.deepEqual(snapshotFiles(external), externalBefore, label);
    }
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('status diagnoses corrupt or ambiguous durable state without guessing or mutating', () => {
  const project = temp('soma-entry-status-invalid-');
  initRepo(project);
  fs.mkdirSync(path.join(project, '.soma'));
  fs.writeFileSync(path.join(project, '.soma', 'run-state-run-a.json'), '{broken');
  let before = snapshotFiles(project);
  let result = routeEntryRequest({ mode: 'status', project }, { cwd: project });
  assert.equal(result.run.state, 'DURABLE_STATUS_INVALID');
  assert.match(result.run.diagnostic, /invalid/i);
  assert.deepEqual(snapshotFiles(project), before);
  fs.writeFileSync(path.join(project, '.soma', 'run-state-run-a.json'), '{}');
  fs.writeFileSync(path.join(project, '.soma', 'run-state-run-b.json'), '{}');
  before = snapshotFiles(project);
  result = routeEntryRequest({ mode: 'status', project }, { cwd: project });
  assert.equal(result.run.state, 'DURABLE_STATUS_AMBIGUOUS');
  assert.deepEqual(snapshotFiles(project), before);
  fs.rmSync(project, { recursive: true, force: true });
});

test('start returns PROJECT_UNRESOLVED for an invalid target without throwing', () => {
  const missing = path.join(os.tmpdir(), `soma-entry-missing-${process.pid}`);
  const result = routeEntryRequest({ mode: 'start', objective: 'ship it', project: missing }, { cwd: os.tmpdir(), home: os.homedir() });
  assert.equal(result.status, 'PROJECT_UNRESOLVED');
  assert.equal(result.retrySafe, true);
});

test('start routes resolved project into adoption and preserves the objective as data', () => {
  const project = temp('soma-entry-route-start-');
  initRepo(project);
  let received = null;
  try {
    const result = routeEntryRequest(
      { mode: 'start', objective: 'ship $(touch NEVER) ; | `bad`', project },
      {
        cwd: os.tmpdir(), home: os.homedir(),
        adoptProject: (resolution) => {
          received = resolution;
          return { status: 'READY', adopted: true, baselineRequired: true, ...resolution, facts: {} };
        },
      }
    );
    assert.equal(result.status, 'READY');
    assert.equal(result.objective, 'ship $(touch NEVER) ; | `bad`');
    assert.equal(received.projectRoot, fs.realpathSync(project));
    assert.equal(fs.existsSync(path.join(project, 'NEVER')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('resume requires a durable owner identity before project resolution', () => {
  let resolutions = 0;
  const result = routeEntryRequest(
    { mode: 'resume', runId: 'run-routing-identity', project: '/unused' },
    { resolveProject: () => { resolutions += 1; throw new Error('must not run'); } }
  );
  assert.deepEqual(result, {
    status: 'RESUME_IDENTITY_REQUIRED', retrySafe: true,
    diagnostic: 'RESUME_IDENTITY_REQUIRED: ownerPid must be a positive safe integer',
  });
  assert.equal(resolutions, 0);
});

test('resume passes the validated native session and owner PID to continuity', () => {
  const project = temp('soma-entry-route-resume-');
  initRepo(project);
  let received = null;
  try {
    const result = routeEntryRequest(
      { mode: 'resume', runId: 'run-routing-owner', project },
      {
        cwd: project, home: path.join(project, 'not-home'), sessionId: 'claude.native:42', ownerPid: 4242,
        resumeContinuity: value => { received = value; return { status: 'RESUME_READY' }; },
      }
    );
    assert.equal(result.status, 'RESUME_READY');
    assert.equal(received.sessionId, 'claude.native:42');
    assert.equal(received.ownerPid, 4242);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
