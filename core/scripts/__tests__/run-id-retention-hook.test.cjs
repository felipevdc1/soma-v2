'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
  aliasSharesInode,
} = require('./helpers/run-identity-fixture.cjs');
const { sweepExpiredArtifacts, RETENTION_MS } = require('../run/retention.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_HOOK = path.join(REPO_ROOT, 'core', 'hooks', 'spec-completeness-gate.cjs');
const RUN_ID_MODULE = path.join(REPO_ROOT, 'core', 'scripts', 'run', 'run-id.cjs');
const PATHS_MODULE = path.join(REPO_ROOT, 'core', 'scripts', 'run', 'paths.cjs');
const PERSIST_CONTRACT = path.join(
  REPO_ROOT,
  'core',
  'specs',
  '016-artifact-gated-trilho',
  'contracts',
  'persist-run-state.md'
);
const SOMA_RUN_DOC = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'references', 'soma-run-orchestration.md');
const INSTALL_TARGETS = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'install-targets.json');
const NFC = 'run-\u00e9';
const NFD = 'run-e\u0301';
const NOW = new Date('2026-08-26T12:00:00.000Z');
const OLD = new Date(NOW.getTime() - RETENTION_MS - 24 * 60 * 60 * 1000);
const DELETE_ORDER = ['reports', 'dispatches', 'recovery', 'state', 'marker'];
let fixtureSequence = 0;

function makeProject(prefix = 'soma-run-id-d-') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(projectRoot, '.soma'), { recursive: true });
  return projectRoot;
}

function writeBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

function writeText(file, text) {
  return writeBytes(file, Buffer.from(text, 'utf8'));
}

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId,
  }, null, 2)}\n`, 'utf8');
}

function validState(runId, overrides = {}) {
  return {
    $schema: 'soma-state/v2',
    runId,
    sessionId: 'pair-d-red',
    startedAt: '2026-08-01T12:00:00.000Z',
    currentState: 'DONE',
    lastTransitionAt: '2026-08-01T12:01:00.000Z',
    activeDispatchIds: [],
    failureCountsByStep: {},
    fixLoopIterations: 0,
    snapshots: [],
    humanGatesApproved: {
      gate1_spec: { approved: true },
      gate2_deploy: { approved: true },
    },
    decisions: [],
    reports: [],
    ...overrides,
  };
}

function stateBytes(runId, overrides = {}) {
  return Buffer.from(`${JSON.stringify(validState(runId, overrides), null, 2)}\n`, 'utf8');
}

function runPaths(projectRoot, runId) {
  const somaDir = path.join(projectRoot, '.soma');
  return {
    somaDir,
    reports: path.join(somaDir, 'reports', runId),
    dispatches: path.join(somaDir, 'dispatches', runId),
    recovery: path.join(somaDir, 'recovery', runId),
    state: path.join(somaDir, `run-state-${runId}.json`),
    marker: path.join(somaDir, 'run-identities', `${runId}.json`),
  };
}

function seedOldDoneRun({
  filenameRunId,
  markerRunId = filenameRunId,
  stateRunId = filenameRunId,
}) {
  const projectRoot = makeProject('soma-run-id-d-retention-');
  const paths = runPaths(projectRoot, filenameRunId);
  writeText(path.join(paths.reports, 'STEP_10_SONAR-report.json'), 'report sentinel\n');
  writeText(path.join(paths.dispatches, 'T-D', 'prompt.md'), 'dispatch sentinel\n');
  writeBytes(path.join(paths.recovery, 'claims', 'claim.bin'), Buffer.from([0, 82, 49, 49, 255]));
  writeBytes(paths.state, stateBytes(stateRunId));
  writeBytes(paths.marker, canonicalMarkerBytes(markerRunId));
  fs.utimesSync(paths.state, OLD, OLD);
  return { projectRoot, paths, now: NOW };
}

function classifyTarget(paths, target) {
  const resolved = path.resolve(String(target));
  for (const kind of DELETE_ORDER) {
    if (resolved === path.resolve(paths[kind])) return kind;
  }
  return `unexpected:${resolved}`;
}

function observeRetention(paths, failAt) {
  const removed = [];
  const originalRm = fs.rmSync;
  fs.rmSync = function observedRm(target, options) {
    const kind = classifyTarget(paths, target);
    removed.push(kind);
    if (kind === failAt) {
      const error = new Error(`injected ${kind} failure`);
      error.code = 'EACCES';
      throw error;
    }
    return originalRm.call(this, target, options);
  };
  return {
    removed,
    restore() {
      fs.rmSync = originalRm;
    },
  };
}

function assertNoRetentionMutation(fx, label) {
  const before = snapshotTree(fx.projectRoot);
  const observation = observeRetention(fx.paths);
  let result;
  try {
    result = sweepExpiredArtifacts({ projectRoot: fx.projectRoot, now: fx.now });
  } finally {
    observation.restore();
  }
  assert.deepEqual(observation.removed, [], `${label}: retention attempted a delete`);
  assert.deepEqual(result.swept, [], `${label}: retention reported a sweep`);
  assertTreeUnchanged(fx.projectRoot, before, `${label}: durable bytes changed`);
}

test('R11 retention deletes reports, dispatches, recovery, state, then marker after exact proof', () => {
  const fx = seedOldDoneRun({ filenameRunId: 'run-exact' });
  try {
    const observation = observeRetention(fx.paths);
    let result;
    try {
      result = sweepExpiredArtifacts({ projectRoot: fx.projectRoot, now: fx.now });
    } finally {
      observation.restore();
    }
    assert.deepEqual(result.swept.map(entry => entry.runId), ['run-exact']);
    assert.deepEqual(observation.removed, DELETE_ORDER);
    for (const target of Object.values(fx.paths).filter(value => value !== fx.paths.somaDir)) {
      assert.equal(fs.existsSync(target), false, `retained ${target}`);
    }
  } finally {
    fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  }
});

test('R11 filename NFC with NFD state performs zero deletes on an aliasing host', t => {
  const fx = seedOldDoneRun({ filenameRunId: NFC, markerRunId: NFC, stateRunId: NFD });
  try {
    const alias = runPaths(fx.projectRoot, NFD);
    if (!aliasSharesInode(t, fx.paths.state, alias.state, 'filesystem preserves distinct NFC/NFD state pathnames')) return;
    if (!aliasSharesInode(t, fx.paths.marker, alias.marker, 'filesystem preserves distinct NFC/NFD marker pathnames')) return;
    assertNoRetentionMutation(fx, 'filename NFC/state NFD');
  } finally {
    fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  }
});

test('R11 filename NFD with NFC state performs zero deletes on an aliasing host', t => {
  const fx = seedOldDoneRun({ filenameRunId: NFD, markerRunId: NFD, stateRunId: NFC });
  try {
    const alias = runPaths(fx.projectRoot, NFC);
    if (!aliasSharesInode(t, fx.paths.state, alias.state, 'filesystem preserves distinct NFD/NFC state pathnames')) return;
    if (!aliasSharesInode(t, fx.paths.marker, alias.marker, 'filesystem preserves distinct NFD/NFC marker pathnames')) return;
    assertNoRetentionMutation(fx, 'filename NFD/state NFC');
  } finally {
    fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  }
});

test('R11 ordinary ASCII filename/state mismatch performs zero deletes', () => {
  const fx = seedOldDoneRun({
    filenameRunId: 'run-filename-owner',
    markerRunId: 'run-filename-owner',
    stateRunId: 'run-different-owner',
  });
  try {
    assertNoRetentionMutation(fx, 'ASCII filename/state mismatch');
  } finally {
    fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  }
});

test('R11 exact filename/state with a different canonical marker performs zero deletes', () => {
  const fx = seedOldDoneRun({
    filenameRunId: 'run-marker-path',
    markerRunId: 'run-marker-owner',
    stateRunId: 'run-marker-path',
  });
  try {
    assertNoRetentionMutation(fx, 'exact marker mismatch');
  } finally {
    fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  }
});

for (const [failureIndex, failureKind] of DELETE_ORDER.entries()) {
  test(`R11 deletion failure at ${failureKind} stops immediately and preserves retry semantics`, () => {
    const runId = `run-failure-${failureKind}`;
    const fx = seedOldDoneRun({ filenameRunId: runId });
    try {
      const first = observeRetention(fx.paths, failureKind);
      let firstResult;
      try {
        firstResult = sweepExpiredArtifacts({ projectRoot: fx.projectRoot, now: fx.now });
      } finally {
        first.restore();
      }

      assert.deepEqual(first.removed, DELETE_ORDER.slice(0, failureIndex + 1));
      assert.deepEqual(firstResult.swept, [], 'a failed marker-last sequence cannot be swept');
      assert.equal(firstResult.errors.length, 1, JSON.stringify(firstResult));
      assert.match(firstResult.errors[0].reason, new RegExp(`injected ${failureKind} failure`));

      const retry = observeRetention(fx.paths);
      let retryResult;
      try {
        retryResult = sweepExpiredArtifacts({ projectRoot: fx.projectRoot, now: fx.now });
      } finally {
        retry.restore();
      }

      if (failureKind === 'marker') {
        assert.deepEqual(retry.removed, [], 'state-less retry must not touch an orphan marker');
        assert.deepEqual(retryResult.swept, []);
        assert.equal(fs.existsSync(fx.paths.marker), true, 'orphan marker must remain');
      } else {
        assert.deepEqual(retry.removed, DELETE_ORDER.slice(failureIndex));
        assert.deepEqual(retryResult.swept.map(entry => entry.runId), [runId]);
        assert.equal(fs.existsSync(fx.paths.marker), false, 'authorized retry must finish with marker');
      }
    } finally {
      fs.rmSync(fx.projectRoot, { recursive: true, force: true });
    }
  });
}

test('R11 a marker orphan with no state is never deleted', () => {
  const projectRoot = makeProject('soma-run-id-d-orphan-');
  const paths = runPaths(projectRoot, 'run-orphan');
  try {
    writeText(path.join(paths.reports, 'sentinel.txt'), 'report survives\n');
    writeText(path.join(paths.dispatches, 'sentinel.txt'), 'dispatch survives\n');
    writeText(path.join(paths.recovery, 'sentinel.txt'), 'recovery survives\n');
    writeBytes(paths.marker, canonicalMarkerBytes('run-orphan'));
    const fx = { projectRoot, paths, now: NOW };
    assertNoRetentionMutation(fx, 'state-less marker orphan');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

function createHookFixture(prefix = 'soma-run-id-d-hook-') {
  const projectRoot = makeProject(prefix);
  const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-id-d-hook-harness-'));
  const sessionId = `pair-d-${process.pid}-${++fixtureSequence}`;
  const bypass = path.join(os.tmpdir(), `soma-spec-bypass-${sessionId}.marker`);
  const oldState = path.join(os.tmpdir(), `soma-state-${sessionId}.json`);
  const spec = writeText(path.join(harnessRoot, 'spec-sentinel.md'), '### AC-01: The system SHALL remain exact\n');
  const tasks = writeText(path.join(harnessRoot, 'tasks-sentinel.md'), '- exact [SPEC:AC-01]\n');
  return { projectRoot, harnessRoot, sessionId, bypass, oldState, spec, tasks };
}

function cleanupHookFixture(fx) {
  for (const file of [fx.bypass, fx.oldState]) {
    try {
      fs.unlinkSync(file);
    } catch (_error) {
      // Already absent is the expected state for a consumed bypass.
    }
  }
  fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  fs.rmSync(fx.harnessRoot, { recursive: true, force: true });
}

function hookState(fx, runId, overrides = {}) {
  return stateBytes(runId, {
    currentState: 'STEP_1A_SPECIFY',
    specPath: fx.spec,
    tasksPath: fx.tasks,
    ...overrides,
  });
}

function writeHookState(fx, pathnameRunId, embeddedRunId = pathnameRunId, overrides = {}) {
  const state = runPaths(fx.projectRoot, pathnameRunId).state;
  writeBytes(state, hookState(fx, embeddedRunId, overrides));
  return state;
}

function writeHookMarker(fx, pathnameRunId, embeddedRunId = pathnameRunId) {
  const marker = runPaths(fx.projectRoot, pathnameRunId).marker;
  writeBytes(marker, canonicalMarkerBytes(embeddedRunId));
  return marker;
}

function writeLock(fx, runId) {
  return writeText(
    path.join(fx.projectRoot, '.soma.lock'),
    `${JSON.stringify({ sessionId: fx.sessionId, runId, startedAt: '2026-08-26T12:00:00.000Z' })}\n`
  );
}

function installHookLayout(fx) {
  const somaHome = path.join(fx.harnessRoot, 'installed-soma-home');
  const hook = path.join(fx.harnessRoot, 'installed-hooks', 'spec-completeness-gate.cjs');
  const runDir = path.join(somaHome, 'scripts', 'run');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(SOURCE_HOOK, hook);
  fs.copyFileSync(RUN_ID_MODULE, path.join(runDir, 'run-id.cjs'));
  fs.copyFileSync(PATHS_MODULE, path.join(runDir, 'paths.cjs'));
  return { hook, somaHome };
}

function writeObservationPreload(fx, watched) {
  const preload = path.join(fx.harnessRoot, 'observe-hook-order.cjs');
  const eventFile = path.join(fx.harnessRoot, 'hook-events.jsonl');
  const source = String.raw`
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const descriptors = new Map();
    const originalOpenSync = fs.openSync;
    const originalCloseSync = fs.closeSync;
    const originalReadFileSync = fs.readFileSync;
    const originalUnlinkSync = fs.unlinkSync;
    const watched = new Set(JSON.parse(process.env.SOMA_TEST_WATCHED_PATHS).map(value => path.resolve(value)));
    const eventFile = process.env.SOMA_TEST_EVENT_FILE;
    function watchedPath(target) {
      if (typeof target === 'number') return descriptors.get(target) || null;
      if (typeof target !== 'string') return null;
      const resolved = path.resolve(target);
      return watched.has(resolved) ? resolved : null;
    }
    function record(kind, target) {
      const resolved = watchedPath(target);
      if (!resolved) return;
      fs.appendFileSync(eventFile, JSON.stringify({ kind, path: resolved }) + '\n');
    }
    fs.openSync = function observedOpen(target, ...args) {
      const descriptor = Reflect.apply(originalOpenSync, this, [target, ...args]);
      const resolved = watchedPath(target);
      if (resolved) descriptors.set(descriptor, resolved);
      return descriptor;
    };
    fs.closeSync = function observedClose(descriptor, ...args) {
      try {
        return Reflect.apply(originalCloseSync, this, [descriptor, ...args]);
      } finally {
        descriptors.delete(descriptor);
      }
    };
    fs.readFileSync = function observedRead(target, ...args) {
      record('read', target);
      return Reflect.apply(originalReadFileSync, this, [target, ...args]);
    };
    fs.unlinkSync = function observedUnlink(target, ...args) {
      record('unlink', target);
      return Reflect.apply(originalUnlinkSync, this, [target, ...args]);
    };
  `;
  writeText(preload, source);
  return { preload, eventFile, watched };
}

function readEvents(eventFile) {
  try {
    return fs.readFileSync(eventFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function runHook(fx, {
  layout = 'source',
  watched = [],
  extraEnv = {},
} = {}) {
  const selected = layout === 'installed'
    ? installHookLayout(fx)
    : { hook: SOURCE_HOOK, somaHome: undefined };
  const observation = writeObservationPreload(fx, watched);
  const input = JSON.stringify({ tool_input: { command: 'git commit -m test' } });
  const env = {
    ...process.env,
    CK_SESSION_ID: fx.sessionId,
    NODE_OPTIONS: `--require=${observation.preload}`,
    SOMA_TEST_WATCHED_PATHS: JSON.stringify(watched),
    SOMA_TEST_EVENT_FILE: observation.eventFile,
    ...extraEnv,
  };
  if (selected.somaHome) env.SOMA_HOME = selected.somaHome;
  const result = spawnSync(process.execPath, [selected.hook], {
    cwd: fx.projectRoot,
    env,
    input,
    encoding: 'utf8',
    timeout: 15_000,
  });
  return { result, events: readEvents(observation.eventFile), selected };
}

function eventIndex(events, kind, target) {
  const resolved = path.resolve(target);
  return events.findIndex(event => event.kind === kind && event.path === resolved);
}

function assertIdentityFailureBeforeProtectedAccess({ result, events, fx, identity }) {
  assert.equal(result.status, 0, `hook compatibility is fail-open: ${result.stderr}`);
  assert.match(result.stderr, identity);
  assert.equal(fs.existsSync(fx.bypass), true, 'identity failure consumed bypass');
  assert.equal(eventIndex(events, 'unlink', fx.bypass), -1, 'identity failure attempted bypass unlink');
  assert.equal(eventIndex(events, 'read', fx.spec), -1, 'identity failure read spec sentinel');
  assert.equal(eventIndex(events, 'read', fx.tasks), -1, 'identity failure read tasks sentinel');
}

test('R12 lock NFC/state NFD warns before bypass unlink and source reads on an aliasing host', t => {
  const fx = createHookFixture();
  try {
    const state = writeHookState(fx, NFD, NFD);
    writeLock(fx, NFC);
    writeText(fx.bypass, 'bypass sentinel\n');
    const nfcState = runPaths(fx.projectRoot, NFC).state;
    if (!aliasSharesInode(t, state, nfcState, 'filesystem preserves distinct NFC/NFD hook state pathnames')) return;
    const { result, events } = runHook(fx, {
      watched: [fx.bypass, fx.spec, fx.tasks, state, nfcState, runPaths(fx.projectRoot, NFC).marker],
    });
    assertIdentityFailureBeforeProtectedAccess({ result, events, fx, identity: /RUN_ID_MISMATCH/ });
  } finally {
    cleanupHookFixture(fx);
  }
});

test('R12 scan filename NFC/state NFD rejects before source reads and legacy fallback', t => {
  const fx = createHookFixture();
  try {
    const state = writeHookState(fx, NFC, NFD);
    const nfdState = runPaths(fx.projectRoot, NFD).state;
    if (!aliasSharesInode(t, state, nfdState, 'filesystem preserves distinct NFC/NFD scan state pathnames')) return;
    writeText(fx.bypass, 'bypass sentinel\n');
    writeText(fx.oldState, JSON.stringify({ specPath: fx.spec, tasksPath: fx.tasks }));
    const { result, events } = runHook(fx, {
      watched: [fx.bypass, fx.spec, fx.tasks, state, runPaths(fx.projectRoot, NFC).marker, fx.oldState],
    });
    assertIdentityFailureBeforeProtectedAccess({ result, events, fx, identity: /RUN_ID_MISMATCH/ });
    assert.equal(eventIndex(events, 'read', fx.oldState), -1, 'new candidate fell back to old temp state');
  } finally {
    cleanupHookFixture(fx);
  }
});

test('R12 an unsafe present lock is terminal and cannot fall through to a valid scan candidate', () => {
  const fx = createHookFixture();
  try {
    const runId = 'run-valid-scan';
    const state = writeHookState(fx, runId);
    const marker = writeHookMarker(fx, runId);
    writeLock(fx, '../unsafe-lock');
    writeText(fx.bypass, 'bypass sentinel\n');
    const { result, events } = runHook(fx, {
      watched: [fx.bypass, fx.spec, fx.tasks, state, marker],
    });
    assertIdentityFailureBeforeProtectedAccess({ result, events, fx, identity: /RUN_ID_INVALID/ });
    assert.equal(eventIndex(events, 'read', state), -1, 'unsafe lock fell through to scanned state');
    assert.equal(eventIndex(events, 'read', marker), -1, 'unsafe lock fell through to scanned marker');
  } finally {
    cleanupHookFixture(fx);
  }
});

test('R12 a present safe lock without its candidate cannot fall back to old temp state', () => {
  const fx = createHookFixture();
  try {
    writeLock(fx, 'run-authoritative-missing');
    writeText(fx.oldState, JSON.stringify({ specPath: fx.spec, tasksPath: fx.tasks }));
    writeText(fx.bypass, 'bypass sentinel\n');
    const { result, events } = runHook(fx, {
      watched: [fx.bypass, fx.spec, fx.tasks, fx.oldState],
    });
    assertIdentityFailureBeforeProtectedAccess({
      result,
      events,
      fx,
      identity: /RUN_ID_IDENTITY_UNPROVABLE|RUN_ID_MARKER_INVALID/,
    });
    assert.equal(eventIndex(events, 'read', fx.oldState), -1, 'authoritative lock used old temp fallback');
  } finally {
    cleanupHookFixture(fx);
  }
});

test('R12 exact legacy state adds only its canonical marker before consuming bypass', () => {
  const fx = createHookFixture();
  try {
    const runId = 'run-legacy-adoption-bypass';
    const state = writeHookState(fx, runId);
    const stateBefore = fs.readFileSync(state);
    const marker = runPaths(fx.projectRoot, runId).marker;
    writeLock(fx, runId);
    writeText(fx.bypass, 'bypass sentinel\n');
    const { result, events } = runHook(fx, {
      watched: [fx.bypass, fx.spec, fx.tasks, state, marker],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(state), stateBefore, 'legacy adoption changed state bytes');
    assert.deepEqual(fs.readFileSync(marker), canonicalMarkerBytes(runId));
    assert.equal(fs.existsSync(fx.bypass), false, 'proved bypass was not consumed');
    assert.equal(eventIndex(events, 'read', fx.spec), -1, 'bypass route read spec');
    assert.equal(eventIndex(events, 'read', fx.tasks), -1, 'bypass route read tasks');
    assert.deepEqual(fs.readdirSync(path.dirname(marker)), [`${runId}.json`], 'adoption left temp marker files');
  } finally {
    cleanupHookFixture(fx);
  }
});

test('R12 exact legacy state adds only its marker before reading spec and tasks', () => {
  const fx = createHookFixture();
  try {
    const runId = 'run-legacy-adoption-sources';
    const state = writeHookState(fx, runId);
    const marker = runPaths(fx.projectRoot, runId).marker;
    writeLock(fx, runId);
    const { result, events } = runHook(fx, {
      watched: [fx.spec, fx.tasks, state, marker],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(marker), canonicalMarkerBytes(runId));
    assert.notEqual(eventIndex(events, 'read', fx.spec), -1, 'proved state did not lead to spec read');
    assert.notEqual(eventIndex(events, 'read', fx.tasks), -1, 'proved state did not lead to tasks read');
    assert.deepEqual(fs.readdirSync(path.dirname(marker)), [`${runId}.json`], 'adoption left temp marker files');
  } finally {
    cleanupHookFixture(fx);
  }
});

for (const layout of ['source', 'installed']) {
  test(`R12 exact marker/state proves identity before bypass unlink in ${layout} layout`, () => {
    const fx = createHookFixture(`soma-run-id-d-${layout}-`);
    try {
      const runId = `run-exact-${layout}`;
      const state = writeHookState(fx, runId);
      const marker = writeHookMarker(fx, runId);
      writeLock(fx, runId);
      writeText(fx.bypass, 'bypass sentinel\n');
      const { result, events } = runHook(fx, {
        layout,
        watched: [fx.bypass, fx.spec, fx.tasks, state, marker],
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(fx.bypass), false, 'proved bypass was not consumed');
      const unlink = eventIndex(events, 'unlink', fx.bypass);
      const stateRead = eventIndex(events, 'read', state);
      const markerRead = eventIndex(events, 'read', marker);
      assert.notEqual(stateRead, -1, 'identity proof did not read state');
      assert.notEqual(markerRead, -1, 'identity proof did not read marker');
      assert.notEqual(unlink, -1, 'hook did not unlink bypass');
      assert.ok(stateRead < unlink, `state read must precede unlink: ${JSON.stringify(events)}`);
      assert.ok(markerRead < unlink, `marker read must precede unlink: ${JSON.stringify(events)}`);
      assert.equal(eventIndex(events, 'read', fx.spec), -1, 'bypass route read spec');
      assert.equal(eventIndex(events, 'read', fx.tasks), -1, 'bypass route read tasks');
    } finally {
      cleanupHookFixture(fx);
    }
  });
}

test('R12 old temp state remains a fallback only when no new candidate or lock exists', () => {
  const fx = createHookFixture();
  try {
    fs.rmSync(path.join(fx.projectRoot, '.soma'), { recursive: true, force: true });
    writeText(fx.oldState, JSON.stringify({ specPath: fx.spec, tasksPath: fx.tasks }));
    writeText(fx.bypass, 'bypass sentinel\n');
    const { result, events } = runHook(fx, {
      watched: [fx.bypass, fx.spec, fx.tasks, fx.oldState],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(fx.bypass), false, 'legacy-only fallback did not consume bypass');
    assert.equal(eventIndex(events, 'read', fx.spec), -1, 'legacy bypass route read spec');
    assert.equal(eventIndex(events, 'read', fx.tasks), -1, 'legacy bypass route read tasks');
  } finally {
    cleanupHookFixture(fx);
  }
});

test('R12 hook imports the universal identity predicate in both layouts without a local duplicate', () => {
  const source = fs.readFileSync(SOURCE_HOOK, 'utf8');
  assert.match(source, /run-id\.cjs/);
  assert.match(source, /paths\.cjs/);
  assert.doesNotMatch(source, /function\s+(?:safeRunId|assertSafeRunId)\s*\(/);
  assert.match(source, /SOMA_HOME/);
});

test('Pair D docs and selective ignore freeze canonical marker and marker-last cleanup', () => {
  const markerIgnored = spawnSync('git', [
    'check-ignore', '--no-index', '-q', '.soma/run-identities/run-exact.json',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  const installStateIgnored = spawnSync('git', [
    'check-ignore', '--no-index', '-q', '.soma/install-state.json',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(markerIgnored.status, 0, '.soma/run-identities/ is not selectively ignored');
  assert.equal(installStateIgnored.status, 1, '.soma/install-state.json must remain trackable');

  const contract = fs.readFileSync(PERSIST_CONTRACT, 'utf8');
  assert.match(contract, /soma-run-identity\/v1/);
  assert.match(contract, /"\$schema"\s*:\s*"soma-run-identity\/v1"[\s\S]{0,120}"runId"\s*:/);
  assert.match(contract, /Buffer\.from\([\s\S]{0,240}JSON\.stringify|JSON\.stringify\([\s\S]{0,240}Buffer\.from/);
  assert.match(contract, /adop(?:ç|c|t)[\s\S]{0,200}(?:exat|exact)[\s\S]{0,200}state/i);
  assert.match(contract, /reports[\s\S]{0,120}dispatches[\s\S]{0,120}recovery[\s\S]{0,120}state[\s\S]{0,120}marker/i);

  const runDoc = fs.readFileSync(SOMA_RUN_DOC, 'utf8');
  assert.match(runDoc, /state --init[\s\S]{0,500}(?:reserva|instala|cria)[\s\S]{0,180}marker[\s\S]{0,180}antes[\s\S]{0,180}(?:state|run-state)/i);
  assert.match(runDoc, /reports[\s\S]{0,120}dispatches[\s\S]{0,120}recovery[\s\S]{0,120}state[\s\S]{0,120}marker/i);

  const targets = JSON.parse(fs.readFileSync(INSTALL_TARGETS, 'utf8'));
  assert.ok(
    targets.entries.some(entry => entry.source_path === 'hooks/spec-completeness-gate.cjs'),
    'existing hook mapping disappeared'
  );
  assert.equal(
    targets.entries.some(entry => /run-id\.cjs$/.test(entry.source_path || '')),
    false,
    'Pair D must not require a new per-file install manifest entry'
  );
});
