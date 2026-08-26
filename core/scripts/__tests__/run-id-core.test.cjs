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
  aliasSharesInode,
} = require('./helpers/run-identity-fixture.cjs');

const RUN_ID_MODULE = path.join(__dirname, '..', 'run', 'run-id.cjs');
const PATHS_MODULE = path.join(__dirname, '..', 'run', 'paths.cjs');
const STATE_FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'state');
const NFC = 'run-\u00e9';
const NFD = 'run-e\u0301';
const UNSAFE = [
  undefined,
  null,
  42,
  true,
  {},
  '',
  ' \t\n',
  '\u00a0\u2003',
  '.',
  '..',
  'a/b',
  'a\\b',
  'a\0b',
];

function makeProject(prefix = 'soma-run-identity-') {
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

function seedState(projectRoot, schema, runId) {
  const fixtureName = schema === 'soma-state/v2' ? 'v2-valid.json' : 'v3-red-pending.json';
  const state = JSON.parse(fs.readFileSync(path.join(STATE_FIXTURES, fixtureName), 'utf8'));
  state.runId = runId;
  const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const file = statePath(projectRoot, runId);
  writeBytes(file, bytes);
  return { file, bytes };
}

function reserve(projectRoot, runId, allowNew) {
  const { reserveRunIdentity } = require(RUN_ID_MODULE);
  return reserveRunIdentity({ projectRoot, runId, allowNew });
}

function spawnReservation(projectRoot, runId, allowNew = true) {
  const childSource = String.raw`
    'use strict';
    process.send({ kind: 'ready' });
    process.once('message', message => {
      try {
        while (Date.now() < message.startAt) {
          // Release both independent processes at the same wall-clock boundary.
        }
        const { reserveRunIdentity } = require(process.argv[1]);
        const value = reserveRunIdentity({
          projectRoot: process.argv[2],
          runId: process.argv[3],
          allowNew: process.argv[4] === 'true',
        });
        process.send({ kind: 'result', ok: true, value });
      } catch (error) {
        process.send({
          kind: 'result',
          ok: false,
          error: error && error.message ? error.message : String(error),
        });
      }
    });
  `;
  const child = spawn(process.execPath, [
    '-e',
    childSource,
    RUN_ID_MODULE,
    projectRoot,
    runId,
    String(allowNew),
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });

  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message.kind === 'ready') readyResolve();
      if (message.kind === 'result') resolve(message);
    });
    child.on('error', error => {
      readyReject(error);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        const error = new Error(`reservation child exited ${code ?? signal}: ${stderr}`);
        readyReject(error);
        reject(error);
      }
    });
  });

  return { child, ready, result };
}

async function raceReservations(projectRoot, runIds) {
  const workers = runIds.map(runId => spawnReservation(projectRoot, runId));
  await Promise.all(workers.map(worker => worker.ready));
  const startAt = Date.now() + 100;
  for (const worker of workers) worker.child.send({ kind: 'go', startAt });
  const results = await Promise.all(workers.map(worker => worker.result));
  for (const worker of workers) worker.child.disconnect();
  return results;
}

test('R1 rejects unsafe values and preserves distinct safe Unicode strings', () => {
  const { safeRunId, assertSafeRunId, assertExactRunId } = require(RUN_ID_MODULE);

  for (const value of UNSAFE) {
    assert.equal(safeRunId(value), false, `safeRunId accepted ${String(value)}`);
    assert.throws(
      () => assertSafeRunId(value),
      /^Error: RUN_ID_INVALID(?::|$)/,
      `assertSafeRunId accepted ${String(value)}`
    );
  }

  assert.equal(assertSafeRunId(NFC), NFC);
  assert.equal(assertSafeRunId(NFD), NFD);
  assert.notEqual(NFC, NFD);
  assert.throws(() => assertExactRunId(NFD, NFC), /^Error: RUN_ID_MISMATCH(?::|$)/);
});

test('R2 validates every supplied runId before resolving paths and keeps Unicode exact', () => {
  const { resolveSomaPaths } = require(PATHS_MODULE);

  for (const value of UNSAFE) {
    assert.throws(
      () => resolveSomaPaths('/project', value),
      /RUN_ID_INVALID/,
      `resolveSomaPaths returned for supplied ${String(value)}`
    );
  }

  const withoutRun = resolveSomaPaths('/project');
  assert.equal(withoutRun.runStateFile, undefined);
  const nfc = resolveSomaPaths('/project', NFC);
  const nfd = resolveSomaPaths('/project', NFD);
  assert.equal(path.basename(nfc.runStateFile), `run-state-${NFC}.json`);
  assert.equal(path.basename(nfd.runStateFile), `run-state-${NFD}.json`);
  assert.notEqual(nfc.runStateFile, nfd.runStateFile);
  assert.equal(nfc.runIdentityFile, path.join('/project', '.soma', 'run-identities', `${NFC}.json`));
  assert.equal(nfd.runIdentityFile, path.join('/project', '.soma', 'run-identities', `${NFD}.json`));
});

test('R2 unsafe .soma.lock values are invalid without artifact scan fallback', () => {
  const { resolveRunIdFromLock } = require(PATHS_MODULE);
  const projectRoot = makeProject('soma-run-lock-');
  try {
    fs.mkdirSync(path.join(projectRoot, '.soma', 'reports', 'run-fallback'), { recursive: true });
    const unsafeLockValues = [null, 42, true, {}, [], '', ' \t\n', '\u00a0\u2003', '.', '..', 'a/b', 'a\\b', 'a\0b'];
    for (const runId of unsafeLockValues) {
      fs.writeFileSync(path.join(projectRoot, '.soma.lock'), `${JSON.stringify({ runId })}\n`);
      const resolved = resolveRunIdFromLock(projectRoot);
      assert.equal(resolved.status, 'invalid_run_id', `lock accepted ${JSON.stringify(runId)}`);
      assert.equal('runId' in resolved, false, 'invalid lock must not expose a fallback candidate');
    }

    for (const runId of [NFC, NFD]) {
      fs.writeFileSync(path.join(projectRoot, '.soma.lock'), `${JSON.stringify({ runId })}\n`);
      assert.deepEqual(resolveRunIdFromLock(projectRoot), {
        status: 'ok',
        runId,
      });
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('marker bytes are canonical and immutable on exact retry', () => {
  const projectRoot = makeProject();
  try {
    const created = reserve(projectRoot, NFC, true);
    const file = markerPath(projectRoot, NFC);
    const bytes = fs.readFileSync(file);
    assert.deepEqual(created, { status: 'created', markerPath: file });
    assert.deepEqual(bytes, canonicalMarkerBytes(NFC));
    assert.deepEqual(Object.keys(JSON.parse(bytes)), ['$schema', 'runId']);

    const matched = reserve(projectRoot, NFC, true);
    assert.deepEqual(matched, { status: 'matched', markerPath: file });
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${NFC}.json`]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('marker never repairs malformed, noncanonical, or mismatched bytes', async t => {
  const malformed = [
    ['extra key', Buffer.from(`${JSON.stringify({ $schema: 'soma-run-identity/v1', runId: NFC, extra: true }, null, 2)}\n`)],
    ['reversed key order', Buffer.from(`${JSON.stringify({ runId: NFC, $schema: 'soma-run-identity/v1' }, null, 2)}\n`)],
    ['missing LF', canonicalMarkerBytes(NFC).subarray(0, canonicalMarkerBytes(NFC).length - 1)],
    ['BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonicalMarkerBytes(NFC)])],
    ['wrong schema', Buffer.from(`${JSON.stringify({ $schema: 'soma-run-identity/v2', runId: NFC }, null, 2)}\n`)],
    ['wrong embedded ID', canonicalMarkerBytes('run-other')],
  ];

  for (const [name, bytes] of malformed) {
    await t.test(name, () => {
      const projectRoot = makeProject();
      try {
        writeBytes(markerPath(projectRoot, NFC), bytes);
        const before = snapshotTree(projectRoot);
        assert.throws(
          () => reserve(projectRoot, NFC, true),
          /RUN_ID_MARKER_INVALID|RUN_ID_MISMATCH/
        );
        assertTreeUnchanged(projectRoot, before, `${name} must not be repaired`);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('marker rejects symlink and directory destinations without mutation', async t => {
  await t.test('symlink', () => {
    const projectRoot = makeProject();
    try {
      const target = path.join(projectRoot, 'marker-target.json');
      writeBytes(target, canonicalMarkerBytes(NFC));
      fs.mkdirSync(path.dirname(markerPath(projectRoot, NFC)), { recursive: true });
      fs.symlinkSync(target, markerPath(projectRoot, NFC));
      const before = snapshotTree(projectRoot);
      assert.throws(() => reserve(projectRoot, NFC, true), /RUN_ID_MARKER_INVALID/);
      assertTreeUnchanged(projectRoot, before, 'marker symlink and target must remain unchanged');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  await t.test('directory', () => {
    const projectRoot = makeProject();
    try {
      fs.mkdirSync(markerPath(projectRoot, NFC), { recursive: true });
      const before = snapshotTree(projectRoot);
      assert.throws(() => reserve(projectRoot, NFC, true), /RUN_ID_MARKER_INVALID/);
      assertTreeUnchanged(projectRoot, before, 'marker directory must remain unchanged');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

test('exact v2 and v3 state authorize additive marker adoption without changing state bytes', async t => {
  for (const schema of ['soma-state/v2', 'soma-state/v3']) {
    await t.test(schema, () => {
      const projectRoot = makeProject();
      try {
        const state = seedState(projectRoot, schema, NFC);
        const adopted = reserve(projectRoot, NFC, false);
        const file = markerPath(projectRoot, NFC);
        assert.deepEqual(adopted, { status: 'adopted', markerPath: file });
        assert.deepEqual(fs.readFileSync(state.file), state.bytes);
        assert.deepEqual(fs.readFileSync(file), canonicalMarkerBytes(NFC));
        assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${NFC}.json`]);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('legacy artifacts without marker or state are unprovable and leave no identity files', async t => {
  const artifacts = [
    ['reports', projectRoot => path.join(projectRoot, '.soma', 'reports', NFC, 'report.json')],
    ['dispatches', projectRoot => path.join(projectRoot, '.soma', 'dispatches', NFC, 'prompt.md')],
    ['recovery', projectRoot => path.join(projectRoot, '.soma', 'recovery', NFC, '0001.json')],
  ];

  for (const [name, artifactPath] of artifacts) {
    await t.test(name, () => {
      const projectRoot = makeProject();
      try {
        writeBytes(artifactPath(projectRoot), Buffer.from(`legacy-${name}\n`));
        const before = snapshotTree(projectRoot);
        assert.throws(
          () => reserve(projectRoot, NFC, false),
          /RUN_ID_IDENTITY_UNPROVABLE/
        );
        assertTreeUnchanged(projectRoot, before, `${name} proof failure must not mutate`);
        assert.equal(fs.existsSync(markerPath(projectRoot, NFC)), false);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('allowNew false is unprovable in an empty project and creates no temp or final marker', () => {
  const projectRoot = makeProject();
  try {
    const before = snapshotTree(projectRoot);
    assert.throws(() => reserve(projectRoot, NFC, false), /RUN_ID_IDENTITY_UNPROVABLE/);
    assertTreeUnchanged(projectRoot, before, 'empty allowNew:false reservation must not mutate');
    assert.equal(fs.existsSync(markerPath(projectRoot, NFC)), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('a stranded pre-link temp is inert and does not authorize identity', () => {
  const projectRoot = makeProject();
  try {
    const final = markerPath(projectRoot, NFC);
    const orphan = path.join(path.dirname(final), `.${NFC}.fixture-orphan.tmp`);
    writeBytes(orphan, canonicalMarkerBytes(NFC));
    const orphanBytes = fs.readFileSync(orphan);

    const created = reserve(projectRoot, NFC, true);
    assert.deepEqual(created, { status: 'created', markerPath: final });
    assert.deepEqual(fs.readFileSync(final), canonicalMarkerBytes(NFC));
    assert.deepEqual(fs.readFileSync(orphan), orphanBytes);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('an injected crash after link installation converges to matched on exact retry', () => {
  const projectRoot = makeProject();
  const originalLinkSync = fs.linkSync;
  let injected = false;
  try {
    fs.linkSync = function linkedThenInterrupted(existingPath, newPath) {
      originalLinkSync.call(this, existingPath, newPath);
      injected = true;
      throw new Error('INJECTED_AFTER_IDENTITY_LINK');
    };
    assert.throws(
      () => reserve(projectRoot, NFC, true),
      /INJECTED_AFTER_IDENTITY_LINK|RUN_ID_IDENTITY_INSTALL_FAILED/
    );
  } finally {
    fs.linkSync = originalLinkSync;
  }

  try {
    assert.equal(injected, true, 'fault must run after the final hard link exists');
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, NFC)), canonicalMarkerBytes(NFC));
    assert.deepEqual(reserve(projectRoot, NFC, true), {
      status: 'matched',
      markerPath: markerPath(projectRoot, NFC),
    });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('two exact processes converge to one created and one matched marker', async () => {
  const projectRoot = makeProject();
  try {
    const results = await raceReservations(projectRoot, [NFC, NFC]);
    assert.equal(results.every(result => result.ok), true, JSON.stringify(results));
    assert.deepEqual(results.map(result => result.value.status).sort(), ['created', 'matched']);
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, NFC)), canonicalMarkerBytes(NFC));
    assert.deepEqual(fs.readdirSync(path.dirname(markerPath(projectRoot, NFC))), [`${NFC}.json`]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

async function assertAliasedRace(t, firstRunId, secondRunId, missingPropertyReason) {
  const probeRoot = makeProject('soma-run-alias-probe-');
  try {
    const existing = path.join(probeRoot, `${firstRunId}.probe`);
    const alias = path.join(probeRoot, `${secondRunId}.probe`);
    fs.writeFileSync(existing, 'probe\n');
    if (!aliasSharesInode(t, existing, alias, missingPropertyReason)) return;
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }

  const projectRoot = makeProject();
  try {
    const results = await raceReservations(projectRoot, [firstRunId, secondRunId]);
    const successes = results.filter(result => result.ok);
    const failures = results.filter(result => !result.ok);
    assert.equal(successes.length, 1, JSON.stringify(results));
    assert.equal(failures.length, 1, JSON.stringify(results));
    assert.match(failures[0].error, /RUN_ID_MISMATCH|RUN_ID_MARKER_INVALID/);

    const identityDir = path.join(projectRoot, '.soma', 'run-identities');
    const entries = fs.readdirSync(identityDir);
    assert.equal(entries.length, 1, `one embedded owner expected, got ${entries.join(', ')}`);
    const installedBytes = fs.readFileSync(path.join(identityDir, entries[0]));
    const installed = JSON.parse(installedBytes);
    assert.ok([firstRunId, secondRunId].includes(installed.runId));
    assert.deepEqual(installedBytes, canonicalMarkerBytes(installed.runId));

    const loser = installed.runId === firstRunId ? secondRunId : firstRunId;
    assert.deepEqual(reserve(projectRoot, installed.runId, true), {
      status: 'matched',
      markerPath: markerPath(projectRoot, installed.runId),
    });
    const before = snapshotTree(projectRoot);
    assert.throws(
      () => reserve(projectRoot, loser, true),
      /RUN_ID_MISMATCH|RUN_ID_MARKER_INVALID/
    );
    assertTreeUnchanged(projectRoot, before, 'aliased loser must not mutate the winning identity');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

test('NFC and NFD aliased processes admit only one embedded owner', async t => {
  await assertAliasedRace(t, NFC, NFD, 'filesystem preserves distinct NFC/NFD pathnames');
});

test('case-aliased processes admit only one embedded owner', async t => {
  await assertAliasedRace(t, 'run-Case', 'run-case', 'filesystem is case-sensitive');
});
