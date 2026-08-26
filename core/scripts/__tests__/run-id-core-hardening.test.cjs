'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
} = require('./helpers/run-identity-fixture.cjs');

const RUN_ID_MODULE = path.join(__dirname, '..', 'run', 'run-id.cjs');
const STATE_FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'state');
const RUN_A = 'run-A';
const RUN_B = 'run-B';
const NFC = 'run-\u00e9';
const NFD = 'run-e\u0301';
const CHILD_TIMEOUT_MS = 5_000;

function makeProject(prefix = 'soma-run-identity-hardening-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function markerPath(projectRoot, runId) {
  return path.join(projectRoot, '.soma', 'run-identities', `${runId}.json`);
}

function statePath(projectRoot, runId) {
  return path.join(projectRoot, '.soma', `run-state-${runId}.json`);
}

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId,
  }, null, 2)}\n`, 'utf8');
}

function writeBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function reserve(projectRoot, runId, allowNew) {
  const { reserveRunIdentity } = require(RUN_ID_MODULE);
  return reserveRunIdentity({ projectRoot, runId, allowNew });
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return undefined;
}

function assertStableError(callback, code, missingMessage) {
  const error = captureError(callback);
  assert.ok(error, missingMessage);
  assert.match(error.message, new RegExp(`^${code}(?::|$)`), `${code} must be the stable prefix`);
  return error;
}

function seedFullStateAtRequestedPath(projectRoot, schema, requestedRunId, embeddedRunId) {
  const fixture = schema === 'soma-state/v2' ? 'v2-valid.json' : 'v3-red-pending.json';
  const state = JSON.parse(fs.readFileSync(path.join(STATE_FIXTURES, fixture), 'utf8'));
  state.runId = embeddedRunId;
  writeBytes(
    statePath(projectRoot, requestedRunId),
    Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
  );
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);

    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${label} timed out`));
        return;
      }
      resolve({ code, signal });
    });
  });
}

function spawnBarrierReservation({ projectRoot, runId, ownReady, allReady }) {
  const childSource = String.raw`
    'use strict';
    const fs = require('node:fs');
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const originalLinkSync = fs.linkSync;

    fs.linkSync = function waitAtRealLink(existingPath, newPath) {
      fs.writeFileSync(process.argv[4], 'ready-at-link\n', { flag: 'wx' });
      let released = false;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if (process.argv.slice(5).every(file => fs.existsSync(file))) {
          released = true;
          break;
        }
        Atomics.wait(sleeper, 0, 0, 10);
      }
      if (!released) throw new Error('LINK_BARRIER_TIMEOUT');
      return originalLinkSync.call(this, existingPath, newPath);
    };

    try {
      const { reserveRunIdentity } = require(process.argv[1]);
      const value = reserveRunIdentity({
        projectRoot: process.argv[2],
        runId: process.argv[3],
        allowNew: true,
      });
      process.stdout.write(JSON.stringify({ ok: true, value }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: error && error.message ? error.message : String(error),
      }) + '\n');
    }
  `;

  const child = spawn(process.execPath, [
    '-e',
    childSource,
    RUN_ID_MODULE,
    projectRoot,
    runId,
    ownReady,
    ...allReady,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const result = waitForExit(child, `race child ${runId}`).then(({ code, signal }) => {
    assert.equal(signal, null, `race child ${runId} received ${signal}`);
    assert.equal(code, 0, `race child ${runId} failed: ${stderr}`);
    return JSON.parse(stdout.trim());
  });
  return { child, result };
}

async function raceAtLink(projectRoot, runIds) {
  const barrierRoot = makeProject('soma-run-link-barrier-');
  const readyPaths = runIds.map((_, index) => path.join(barrierRoot, `worker-${index}.ready`));
  const workers = runIds.map((runId, index) => spawnBarrierReservation({
    projectRoot,
    runId,
    ownReady: readyPaths[index],
    allReady: readyPaths,
  }));

  try {
    return await Promise.all(workers.map(worker => worker.result));
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) {
        worker.child.kill('SIGKILL');
      }
    }
    fs.rmSync(barrierRoot, { recursive: true, force: true });
  }
}

function probeAliases(firstRunId, secondRunId) {
  const probeRoot = makeProject('soma-run-alias-hardening-probe-');
  try {
    const existing = path.join(probeRoot, `${firstRunId}.probe`);
    const alias = path.join(probeRoot, `${secondRunId}.probe`);
    fs.writeFileSync(existing, 'probe\n');
    let first;
    let second;
    try {
      first = fs.statSync(existing);
      second = fs.statSync(alias);
    } catch (_error) {
      return false;
    }
    return first.dev === second.dev && first.ino === second.ino;
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

test('F1 rejects a symlinked .soma parent before matching and preserves target bytes', () => {
  const projectRoot = makeProject();
  try {
    const target = path.join(projectRoot, 'canonical-soma-target');
    writeBytes(path.join(target, 'run-identities', `${RUN_A}.json`), canonicalMarkerBytes(RUN_A));
    fs.symlinkSync(target, path.join(projectRoot, '.soma'));
    const before = snapshotTree(projectRoot);

    assertStableError(
      () => reserve(projectRoot, RUN_A, true),
      'RUN_ID_MARKER_INVALID',
      'F1 .soma parent symlink matched canonical target'
    );
    assertTreeUnchanged(projectRoot, before, 'F1 .soma symlink and target must be byte-exact');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F1 rejects a symlinked run-identities parent before matching and preserves target bytes', () => {
  const projectRoot = makeProject();
  try {
    const target = path.join(projectRoot, 'canonical-identities-target');
    writeBytes(path.join(target, `${RUN_A}.json`), canonicalMarkerBytes(RUN_A));
    fs.mkdirSync(path.join(projectRoot, '.soma'));
    fs.symlinkSync(target, path.join(projectRoot, '.soma', 'run-identities'));
    const before = snapshotTree(projectRoot);

    assertStableError(
      () => reserve(projectRoot, RUN_A, true),
      'RUN_ID_MARKER_INVALID',
      'F1 run-identities parent symlink matched canonical target'
    );
    assertTreeUnchanged(projectRoot, before, 'F1 identities symlink and target must be byte-exact');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

for (const schema of ['soma-state/v2', 'soma-state/v3']) {
  test(`F2 exact marker cannot hide divergent ${schema} state`, () => {
    const projectRoot = makeProject();
    try {
      writeBytes(markerPath(projectRoot, RUN_A), canonicalMarkerBytes(RUN_A));
      seedFullStateAtRequestedPath(projectRoot, schema, RUN_A, RUN_B);
      const before = snapshotTree(projectRoot);

      assertStableError(
        () => reserve(projectRoot, RUN_A, true),
        'RUN_ID_MISMATCH',
        `F2 exact marker hid divergent ${schema} state`
      );
      assertTreeUnchanged(projectRoot, before, `F2 divergent ${schema} evidence must not mutate`);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}

for (const schema of ['soma-state/v2', 'soma-state/v3']) {
  test(`F2 minimal ${schema} state is not adoptable identity evidence`, () => {
    const projectRoot = makeProject();
    try {
      writeBytes(
        statePath(projectRoot, RUN_A),
        Buffer.from(`${JSON.stringify({ $schema: schema, runId: RUN_A }, null, 2)}\n`, 'utf8')
      );
      const before = snapshotTree(projectRoot);

      assertStableError(
        () => reserve(projectRoot, RUN_A, false),
        'RUN_ID_IDENTITY_UNPROVABLE',
        `F2 minimal ${schema} state was adopted`
      );
      assertTreeUnchanged(projectRoot, before, `F2 minimal ${schema} rejection must not mutate`);
      assert.equal(fs.existsSync(markerPath(projectRoot, RUN_A)), false, 'F2 rejection created a marker');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}

test('F3 temp unlink EACCES prevents success and keeps the stable install failure code', () => {
  const projectRoot = makeProject();
  const originalUnlinkSync = fs.unlinkSync;
  let injected = false;
  try {
    fs.unlinkSync = function failTempUnlink(file) {
      if (path.dirname(file) === path.dirname(markerPath(projectRoot, RUN_A)) &&
          path.basename(file).startsWith(`.${RUN_A}.`) && file.endsWith('.tmp')) {
        injected = true;
        const error = new Error('injected temp unlink failure');
        error.code = 'EACCES';
        throw error;
      }
      return originalUnlinkSync.call(this, file);
    };

    assertStableError(
      () => reserve(projectRoot, RUN_A, true),
      'RUN_ID_IDENTITY_INSTALL_FAILED',
      'F3 reservation returned success after temp unlink EACCES'
    );
    assert.equal(injected, true, 'F3 unlink fault was not reached');
  } finally {
    fs.unlinkSync = originalUnlinkSync;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F3 successful installation fsyncs the identity directory after temp unlink', () => {
  const projectRoot = makeProject();
  const originalFsyncSync = fs.fsyncSync;
  const originalUnlinkSync = fs.unlinkSync;
  const events = [];
  try {
    fs.fsyncSync = function recordFsync(descriptor) {
      events.push(fs.fstatSync(descriptor).isDirectory() ? 'fsync-dir' : 'fsync-file');
      return originalFsyncSync.call(this, descriptor);
    };
    fs.unlinkSync = function recordUnlink(file) {
      if (path.basename(file).startsWith(`.${RUN_A}.`) && file.endsWith('.tmp')) {
        events.push('unlink-temp');
      }
      return originalUnlinkSync.call(this, file);
    };

    const result = reserve(projectRoot, RUN_A, true);
    assert.equal(result.status, 'created');
    const unlinkIndex = events.indexOf('unlink-temp');
    const durableCleanupIndex = events.lastIndexOf('fsync-dir');
    assert.ok(unlinkIndex >= 0, 'F3 successful install did not unlink its temp');
    assert.ok(
      durableCleanupIndex > unlinkIndex,
      `F3 directory fsync must follow temp unlink; observed ${events.join(' -> ')}`
    );
  } finally {
    fs.fsyncSync = originalFsyncSync;
    fs.unlinkSync = originalUnlinkSync;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F4 pathname text cannot masquerade as a stable coded error', () => {
  const projectRoot = makeProject();
  const runId = 'safe-RUN_ID_MARKER_INVALID-run';
  const file = markerPath(projectRoot, runId);
  const originalOpenSync = fs.openSync;
  try {
    writeBytes(file, canonicalMarkerBytes(runId));
    const before = snapshotTree(projectRoot);
    fs.openSync = function injectMarkerEacces(openPath, ...args) {
      if (openPath === file) {
        const error = new Error(`EACCES: permission denied, open '${openPath}'`);
        error.code = 'EACCES';
        throw error;
      }
      return originalOpenSync.call(this, openPath, ...args);
    };

    assertStableError(
      () => reserve(projectRoot, runId, true),
      'RUN_ID_MARKER_INVALID',
      'F4 marker open EACCES did not fail'
    );
    assertTreeUnchanged(projectRoot, before, 'F4 marker open failure must preserve bytes');
  } finally {
    fs.openSync = originalOpenSync;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F5 real SIGKILL immediately after link leaves a canonical marker and exact retry matches', async () => {
  const projectRoot = makeProject();
  const childSource = String.raw`
    'use strict';
    const fs = require('node:fs');
    const originalLinkSync = fs.linkSync;
    fs.linkSync = function linkThenDie(existingPath, newPath) {
      originalLinkSync.call(this, existingPath, newPath);
      process.kill(process.pid, 'SIGKILL');
    };
    const { reserveRunIdentity } = require(process.argv[1]);
    reserveRunIdentity({ projectRoot: process.argv[2], runId: process.argv[3], allowNew: true });
  `;
  const child = spawn(process.execPath, [
    '-e',
    childSource,
    RUN_ID_MODULE,
    projectRoot,
    RUN_A,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const { code, signal } = await waitForExit(child, 'crash child');
    assert.equal(code, null, 'F5 crash child exited normally');
    assert.equal(signal, 'SIGKILL', 'F5 crash child did not die by SIGKILL');
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, RUN_A)), canonicalMarkerBytes(RUN_A));
    assert.deepEqual(reserve(projectRoot, RUN_A, true), {
      status: 'matched',
      markerPath: markerPath(projectRoot, RUN_A),
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F6 two real processes both reach link and converge to exact created plus matched', async () => {
  const projectRoot = makeProject();
  try {
    const results = await raceAtLink(projectRoot, [RUN_A, RUN_A]);
    assert.equal(results.every(result => result.ok), true, 'F6 exact race returned an error');
    assert.deepEqual(results.map(result => result.value.status).sort(), ['created', 'matched']);
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, RUN_A)), canonicalMarkerBytes(RUN_A));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F6 a probed filesystem alias admits exactly one successful embedded owner', async t => {
  const aliases = [
    [NFC, NFD, 'NFC/NFD'],
    ['run-Case', 'run-case', 'case'],
  ];
  const selected = aliases.find(([first, second]) => probeAliases(first, second));
  if (!selected) {
    t.skip('filesystem preserves distinct NFC/NFD pathnames and is case-sensitive');
    return;
  }

  const [firstRunId, secondRunId] = selected;
  const projectRoot = makeProject();
  try {
    const results = await raceAtLink(projectRoot, [firstRunId, secondRunId]);
    const successes = results.filter(result => result.ok);
    const failures = results.filter(result => !result.ok);
    assert.equal(successes.length, 1, 'F6 aliased race must have exactly one success');
    assert.equal(failures.length, 1, 'F6 aliased race must have exactly one rejected owner');
    assert.match(failures[0].error, /^RUN_ID_(?:MISMATCH|MARKER_INVALID)(?::|$)/);

    const identityDir = path.join(projectRoot, '.soma', 'run-identities');
    const entries = fs.readdirSync(identityDir);
    assert.equal(entries.length, 1, 'F6 aliased race installed more than one directory entry');
    const bytes = fs.readFileSync(path.join(identityDir, entries[0]));
    const installed = JSON.parse(bytes);
    assert.ok([firstRunId, secondRunId].includes(installed.runId));
    assert.deepEqual(bytes, canonicalMarkerBytes(installed.runId));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
