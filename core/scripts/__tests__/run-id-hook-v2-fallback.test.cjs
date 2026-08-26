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
} = require('./helpers/run-identity-fixture.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_HOOK = path.join(REPO_ROOT, 'core', 'hooks', 'spec-completeness-gate.cjs');
const RUN_ID_MODULE = path.join(REPO_ROOT, 'core', 'scripts', 'run', 'run-id.cjs');
const PATHS_MODULE = path.join(REPO_ROOT, 'core', 'scripts', 'run', 'paths.cjs');

let fixtureSequence = 0;

function writeBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function writeText(filePath, value) {
  return writeBytes(filePath, Buffer.from(value, 'utf8'));
}

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId,
  }, null, 2)}\n`, 'utf8');
}

function validV2State(fx, runId) {
  return {
    $schema: 'soma-state/v2',
    runId,
    sessionId: fx.sessionId,
    startedAt: '2026-08-26T12:00:00.000Z',
    currentState: 'STEP_1A_SPECIFY',
    lastTransitionAt: '2026-08-26T12:01:00.000Z',
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
    specPath: fx.cleanSpec,
    tasksPath: fx.tasks,
  };
}

function stateBytes(state) {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function createFixture(prefix = 'soma-run-id-d-hook-fallback-') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-id-d-hook-fallback-harness-'));
  const sessionId = `pair-d-hook-fallback-${process.pid}-${++fixtureSequence}`;
  const bypass = path.join(os.tmpdir(), `soma-spec-bypass-${sessionId}.marker`);
  const oldState = path.join(os.tmpdir(), `soma-state-${sessionId}.json`);
  const cleanSpec = writeText(
    path.join(harnessRoot, 'clean-spec-sentinel.md'),
    '### AC-01: The system SHALL keep identity exact\n'
  );
  const blockingSpec = writeText(
    path.join(harnessRoot, 'blocking-spec-sentinel.md'),
    '[NEEDS CLARIFICATION: identity was not proved]\n### AC-01: The system SHALL keep identity exact\n'
  );
  const tasks = writeText(path.join(harnessRoot, 'tasks-sentinel.md'), '- exact [SPEC:AC-01]\n');
  fs.mkdirSync(path.join(projectRoot, '.soma'));
  return {
    projectRoot,
    harnessRoot,
    sessionId,
    bypass,
    oldState,
    cleanSpec,
    blockingSpec,
    tasks,
  };
}

function cleanupFixture(fx) {
  for (const filePath of [fx.bypass, fx.oldState]) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  fs.rmSync(fx.projectRoot, { recursive: true, force: true });
  fs.rmSync(fx.harnessRoot, { recursive: true, force: true });
}

function runPaths(fx, runId) {
  return {
    state: path.join(fx.projectRoot, '.soma', `run-state-${runId}.json`),
    marker: path.join(fx.projectRoot, '.soma', 'run-identities', `${runId}.json`),
  };
}

function writeState(fx, runId, state) {
  const paths = runPaths(fx, runId);
  writeBytes(paths.state, stateBytes(state));
  return paths;
}

function writeValidState(fx, runId, overrides = {}) {
  return writeState(fx, runId, { ...validV2State(fx, runId), ...overrides });
}

function writePartialState(fx, runId, overrides = {}) {
  const state = { ...validV2State(fx, runId), ...overrides };
  delete state.failureCountsByStep;
  return writeState(fx, runId, state);
}

function writeMarker(fx, runId) {
  const paths = runPaths(fx, runId);
  writeBytes(paths.marker, canonicalMarkerBytes(runId));
  return paths;
}

function writeLock(fx, runId) {
  return writeText(
    path.join(fx.projectRoot, '.soma.lock'),
    `${JSON.stringify({
      sessionId: fx.sessionId,
      runId,
      startedAt: '2026-08-26T12:00:00.000Z',
    })}\n`
  );
}

function installHookLayout(fx) {
  const somaHome = path.join(fx.harnessRoot, 'installed-soma-home');
  const hook = path.join(fx.harnessRoot, 'installed-hooks', 'spec-completeness-gate.cjs');
  const runDirectory = path.join(somaHome, 'scripts', 'run');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.copyFileSync(SOURCE_HOOK, hook);
  fs.copyFileSync(RUN_ID_MODULE, path.join(runDirectory, 'run-id.cjs'));
  fs.copyFileSync(PATHS_MODULE, path.join(runDirectory, 'paths.cjs'));
  return { hook, somaHome };
}

function writeObservationPreload(fx, watchedPaths) {
  const preload = path.join(fx.harnessRoot, 'observe-authority-reads.cjs');
  const eventFile = path.join(fx.harnessRoot, 'authority-events.jsonl');
  const source = String.raw`
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const watched = new Set(
      JSON.parse(process.env.SOMA_TEST_WATCHED_PATHS).map(value => path.resolve(value))
    );
    const eventFile = process.env.SOMA_TEST_EVENT_FILE;
    const descriptors = new Map();
    const originalOpenSync = fs.openSync;
    const originalCloseSync = fs.closeSync;
    const originalReadFileSync = fs.readFileSync;
    const originalWriteFileSync = fs.writeFileSync;
    const originalUnlinkSync = fs.unlinkSync;
    const originalLinkSync = fs.linkSync;

    function watchedPath(target) {
      if (typeof target === 'number') return descriptors.get(target) || null;
      if (typeof target !== 'string' && !Buffer.isBuffer(target)) return null;
      const resolved = path.resolve(String(target));
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
    fs.writeFileSync = function observedWrite(target, ...args) {
      record('write', target);
      return Reflect.apply(originalWriteFileSync, this, [target, ...args]);
    };
    fs.unlinkSync = function observedUnlink(target, ...args) {
      record('unlink', target);
      return Reflect.apply(originalUnlinkSync, this, [target, ...args]);
    };
    fs.linkSync = function observedLink(existingPath, newPath, ...args) {
      record('link', newPath);
      return Reflect.apply(originalLinkSync, this, [existingPath, newPath, ...args]);
    };
  `;
  writeText(preload, source);
  return { preload, eventFile };
}

function readEvents(eventFile) {
  try {
    const content = fs.readFileSync(eventFile, 'utf8').trim();
    return content ? content.split('\n').map(line => JSON.parse(line)) : [];
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function runHook(fx, { layout = 'source', watchedPaths = [] } = {}) {
  const selected = layout === 'installed'
    ? installHookLayout(fx)
    : { hook: SOURCE_HOOK, somaHome: undefined };
  const observation = writeObservationPreload(fx, watchedPaths);
  const env = {
    ...process.env,
    CK_SESSION_ID: fx.sessionId,
    NODE_OPTIONS: `--require=${observation.preload}`,
    SOMA_TEST_WATCHED_PATHS: JSON.stringify(watchedPaths),
    SOMA_TEST_EVENT_FILE: observation.eventFile,
  };
  if (selected.somaHome) env.SOMA_HOME = selected.somaHome;

  const result = spawnSync(process.execPath, [selected.hook], {
    cwd: fx.projectRoot,
    env,
    input: JSON.stringify({ tool_input: { command: 'git commit -m test' } }),
    encoding: 'utf8',
    timeout: 15_000,
  });
  return { result, events: readEvents(observation.eventFile) };
}

function eventsFor(events, kind, target) {
  const resolved = path.resolve(target);
  return events.filter(event => event.kind === kind && event.path === resolved);
}

function firstEventIndex(events, kind, target) {
  const resolved = path.resolve(target);
  return events.findIndex(event => event.kind === kind && event.path === resolved);
}

function lastEventIndex(events, kind, target) {
  const resolved = path.resolve(target);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === kind && events[index].path === resolved) return index;
  }
  return -1;
}

function assertAll(checks) {
  const failures = [];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, failures.map(error => error.message).join(' | '));
  }
}

function assertUnprovedFailOpen({ fx, paths, before, result, events, bypassExpected }) {
  assertAll([
    () => assert.equal(result.error, undefined, `hook spawn failed: ${result.error}`),
    () => assert.equal(result.signal, null, 'hook timed out or was killed'),
    () => assert.equal(result.status, 0, `hook must fail open: ${result.stderr}`),
    () => assert.match(result.stderr, /RUN_ID_IDENTITY_UNPROVABLE/),
    () => assert.equal(eventsFor(events, 'read', paths.state).length, 1,
      `unproved state must be read only by reserveRunIdentity: ${JSON.stringify(events)}`),
    () => assert.equal(eventsFor(events, 'read', fx.blockingSpec).length, 0,
      'unproved identity read the spec sentinel'),
    () => assert.equal(eventsFor(events, 'read', fx.tasks).length, 0,
      'unproved identity read the tasks sentinel'),
    () => assert.equal(fs.existsSync(paths.marker), false, 'partial state created a marker'),
    () => assert.equal(eventsFor(events, 'link', paths.marker).length, 0,
      'partial state attempted marker publication'),
    () => assertTreeUnchanged(fx.projectRoot, before, 'partial state changed project bytes'),
    () => assert.deepEqual(
      fs.readFileSync(fx.blockingSpec),
      Buffer.from('[NEEDS CLARIFICATION: identity was not proved]\n### AC-01: The system SHALL keep identity exact\n'),
      'spec sentinel bytes changed'
    ),
    () => assert.deepEqual(fs.readFileSync(fx.tasks), Buffer.from('- exact [SPEC:AC-01]\n'),
      'tasks sentinel bytes changed'),
    () => assert.equal(fs.existsSync(fx.bypass), bypassExpected, 'bypass existence changed'),
    () => {
      if (bypassExpected) {
        assert.deepEqual(fs.readFileSync(fx.bypass), Buffer.from('bypass sentinel\n'),
          'bypass bytes changed');
        assert.equal(eventsFor(events, 'unlink', fx.bypass).length, 0,
          'unproved identity attempted to consume bypass');
      }
    },
  ]);
}

test('partial v2 selected by authoritative lock warns and preserves bypass before all protected access', () => {
  const fx = createFixture();
  try {
    const runId = 'run-partial-lock';
    const paths = writePartialState(fx, runId, { specPath: fx.blockingSpec });
    writeLock(fx, runId);
    writeText(fx.bypass, 'bypass sentinel\n');
    const before = snapshotTree(fx.projectRoot);
    const { result, events } = runHook(fx, {
      watchedPaths: [paths.state, paths.marker, fx.bypass, fx.blockingSpec, fx.tasks],
    });

    assertUnprovedFailOpen({ fx, paths, before, result, events, bypassExpected: true });
  } finally {
    cleanupFixture(fx);
  }
});

test('partial v2 selected by scan warns without letting spec contents block the commit', () => {
  const fx = createFixture();
  try {
    const runId = 'run-partial-scan';
    const paths = writePartialState(fx, runId, { specPath: fx.blockingSpec });
    writeText(fx.oldState, JSON.stringify({ specPath: fx.blockingSpec, tasksPath: fx.tasks }));
    const before = snapshotTree(fx.projectRoot);
    const { result, events } = runHook(fx, {
      watchedPaths: [
        paths.state,
        paths.marker,
        fx.oldState,
        fx.bypass,
        fx.blockingSpec,
        fx.tasks,
      ],
    });

    assertUnprovedFailOpen({ fx, paths, before, result, events, bypassExpected: false });
    assert.equal(eventsFor(events, 'read', fx.oldState).length, 0,
      'new-state candidate fell back to the session temp state');
  } finally {
    cleanupFixture(fx);
  }
});

test('unsafe authoritative lock remains terminal before a valid scan candidate', () => {
  const fx = createFixture();
  try {
    const runId = 'run-valid-scan-behind-unsafe-lock';
    const paths = writeValidState(fx, runId);
    writeMarker(fx, runId);
    writeLock(fx, '../unsafe-lock');
    writeText(fx.bypass, 'bypass sentinel\n');
    const before = snapshotTree(fx.projectRoot);
    const { result, events } = runHook(fx, {
      watchedPaths: [paths.state, paths.marker, fx.bypass, fx.cleanSpec, fx.tasks],
    });

    assertAll([
      () => assert.equal(result.error, undefined, `hook spawn failed: ${result.error}`),
      () => assert.equal(result.signal, null, 'hook timed out or was killed'),
      () => assert.equal(result.status, 0, `hook must fail open: ${result.stderr}`),
      () => assert.match(result.stderr, /RUN_ID_INVALID/),
      () => assert.equal(eventsFor(events, 'read', paths.state).length, 0,
        'unsafe lock fell through to scanned state'),
      () => assert.equal(eventsFor(events, 'read', paths.marker).length, 0,
        'unsafe lock fell through to scanned marker'),
      () => assert.equal(eventsFor(events, 'read', fx.cleanSpec).length, 0,
        'unsafe lock reached spec'),
      () => assert.equal(eventsFor(events, 'read', fx.tasks).length, 0,
        'unsafe lock reached tasks'),
      () => assert.equal(eventsFor(events, 'unlink', fx.bypass).length, 0,
        'unsafe lock consumed bypass'),
      () => assert.deepEqual(fs.readFileSync(fx.bypass), Buffer.from('bypass sentinel\n')),
      () => assertTreeUnchanged(fx.projectRoot, before, 'unsafe lock mutated the project tree'),
    ]);
  } finally {
    cleanupFixture(fx);
  }
});

test('exact valid v2 without marker adopts once before consuming bypass', () => {
  const fx = createFixture();
  try {
    const runId = 'run-exact-v2-adoption';
    const paths = writeValidState(fx, runId);
    const stateBefore = fs.readFileSync(paths.state);
    const lock = writeLock(fx, runId);
    const lockBefore = fs.readFileSync(lock);
    writeText(fx.bypass, 'bypass sentinel\n');
    const { result, events } = runHook(fx, {
      watchedPaths: [paths.state, paths.marker, fx.bypass, fx.cleanSpec, fx.tasks],
    });
    const markerLink = firstEventIndex(events, 'link', paths.marker);
    const bypassUnlink = firstEventIndex(events, 'unlink', fx.bypass);

    assertAll([
      () => assert.equal(result.error, undefined, `hook spawn failed: ${result.error}`),
      () => assert.equal(result.signal, null, 'hook timed out or was killed'),
      () => assert.equal(result.status, 0, result.stderr),
      () => assert.doesNotMatch(result.stderr, /RUN_ID_/),
      () => assert.deepEqual(fs.readFileSync(paths.state), stateBefore, 'adoption changed state bytes'),
      () => assert.deepEqual(fs.readFileSync(lock), lockBefore, 'adoption changed lock bytes'),
      () => assert.deepEqual(fs.readFileSync(paths.marker), canonicalMarkerBytes(runId)),
      () => assert.deepEqual(fs.readdirSync(path.dirname(paths.marker)), [`${runId}.json`],
        'adoption left a temporary marker'),
      () => assert.equal(fs.existsSync(fx.bypass), false, 'proved bypass was not consumed'),
      () => assert.equal(eventsFor(events, 'read', paths.state).length, 2,
        `adoption may read state once for proof and once for use: ${JSON.stringify(events)}`),
      () => assert.equal(eventsFor(events, 'read', paths.marker).length, 0,
        `hook revalidated the marker created by reserveRunIdentity: ${JSON.stringify(events)}`),
      () => assert.equal(eventsFor(events, 'link', paths.marker).length, 1,
        'adoption must publish one canonical marker'),
      () => assert.notEqual(markerLink, -1, 'adoption did not publish its marker'),
      () => assert.notEqual(bypassUnlink, -1, 'adoption did not consume bypass'),
      () => assert.ok(markerLink < bypassUnlink, `marker must precede bypass unlink: ${JSON.stringify(events)}`),
      () => assert.ok(
        lastEventIndex(events, 'read', paths.state) < bypassUnlink,
        `state proof/use must precede bypass unlink: ${JSON.stringify(events)}`
      ),
      () => assert.equal(eventsFor(events, 'read', fx.cleanSpec).length, 0,
        'bypass route read spec'),
      () => assert.equal(eventsFor(events, 'read', fx.tasks).length, 0,
        'bypass route read tasks'),
    ]);
  } finally {
    cleanupFixture(fx);
  }
});

for (const layout of ['source', 'installed']) {
  test(`exact marker and v2 state stay within the authority-read budget in ${layout} layout`, () => {
    const fx = createFixture(`soma-run-id-d-hook-budget-${layout}-`);
    try {
      const runId = `run-exact-budget-${layout}`;
      const paths = writeValidState(fx, runId);
      writeMarker(fx, runId);
      writeLock(fx, runId);
      const before = snapshotTree(fx.projectRoot);
      const { result, events } = runHook(fx, {
        layout,
        watchedPaths: [paths.state, paths.marker, fx.cleanSpec, fx.tasks],
      });
      const firstSpecRead = firstEventIndex(events, 'read', fx.cleanSpec);
      const firstTasksRead = firstEventIndex(events, 'read', fx.tasks);

      assertAll([
        () => assert.equal(result.error, undefined, `hook spawn failed: ${result.error}`),
        () => assert.equal(result.signal, null, 'hook timed out or was killed'),
        () => assert.equal(result.status, 0, result.stderr),
        () => assert.equal(eventsFor(events, 'read', paths.marker).length, 1,
          `reserveRunIdentity must be the only marker reader: ${JSON.stringify(events)}`),
        () => assert.equal(eventsFor(events, 'read', paths.state).length, 2,
          `state may be read once for proof and once for hook use: ${JSON.stringify(events)}`),
        () => assert.equal(eventsFor(events, 'read', fx.cleanSpec).length, 1,
          'clean spec must be read exactly once'),
        () => assert.equal(eventsFor(events, 'read', fx.tasks).length, 1,
          'tasks must be read exactly once'),
        () => assert.ok(
          lastEventIndex(events, 'read', paths.marker) < firstSpecRead,
          `marker proof must precede spec access: ${JSON.stringify(events)}`
        ),
        () => assert.ok(
          lastEventIndex(events, 'read', paths.state) < firstSpecRead,
          `state proof/use must precede spec access: ${JSON.stringify(events)}`
        ),
        () => assert.ok(firstSpecRead < firstTasksRead,
          `spec must precede tasks: ${JSON.stringify(events)}`),
        () => assert.equal(eventsFor(events, 'write', paths.state).length, 0,
          'exact proof wrote state'),
        () => assert.equal(eventsFor(events, 'write', paths.marker).length, 0,
          'exact proof wrote marker'),
        () => assert.equal(eventsFor(events, 'link', paths.marker).length, 0,
          'exact proof republished marker'),
        () => assertTreeUnchanged(fx.projectRoot, before, 'exact proof changed project bytes'),
      ]);
    } finally {
      cleanupFixture(fx);
    }
  });
}
