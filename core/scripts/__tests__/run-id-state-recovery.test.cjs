'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
  aliasSharesInode,
} = require('./helpers/run-identity-fixture.cjs');
const {
  readStateV3,
  mutateRunStateCas,
  publishRecoveryGeneration,
  migrateStateV2,
} = require('../run/recovery-store.cjs');
const { appendReport } = require('../run/state.cjs');

const STATE_CLI = path.join(__dirname, '..', 'run', 'state.cjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'state');
const NFC = 'run-\u00e9';
const NFD = 'run-e\u0301';
const ASCII_REQUEST = 'run-request';
const ASCII_OWNER = 'run-owner';
const SHA256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function makeProject(prefix = 'soma-run-id-state-recovery-') {
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readFixture(schema) {
  const name = schema === 'soma-state/v2' ? 'v2-valid.json' : 'v3-red-pending.json';
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function writeBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function stateBytes(state) {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function seedState({ projectRoot, schema = 'soma-state/v3', pathnameRunId, embeddedRunId }) {
  const state = readFixture(schema);
  state.runId = embeddedRunId;
  const bytes = stateBytes(state);
  const file = statePath(projectRoot, pathnameRunId);
  writeBytes(file, bytes);
  return { state, bytes, file };
}

function writeMarker(projectRoot, pathnameRunId, embeddedRunId = pathnameRunId) {
  const bytes = canonicalMarkerBytes(embeddedRunId);
  const file = markerPath(projectRoot, pathnameRunId);
  writeBytes(file, bytes);
  return { bytes, file };
}

function runState(projectRoot, argv) {
  return spawnSync(process.execPath, [STATE_CLI, ...argv], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
}

function capture(callback) {
  try {
    return { value: callback(), error: undefined };
  } catch (error) {
    return { value: undefined, error };
  }
}

function assertAll(checks) {
  const errors = [];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, errors.map(error => error.message).join(' | '));
  }
}

function assertTreeExact(projectRoot, before, message) {
  try {
    assertTreeUnchanged(projectRoot, before, message);
  } catch (_error) {
    assert.fail(message);
  }
}

function assertFailureAndUnchanged({ result, identity, projectRoot, before, label }) {
  assertAll([
    () => assert.ok(result.error, `${label}: expected an identity error, got ${JSON.stringify(result.value)}`),
    () => assert.match(result.error ? result.error.message : '', identity, `${label}: wrong public identity`),
    () => assertTreeExact(projectRoot, before, `${label}: durable tree changed`),
  ]);
}

function probeNfcNfdAlias(t) {
  const probeRoot = makeProject('soma-run-id-alias-probe-');
  try {
    const existing = path.join(probeRoot, `${NFC}.probe`);
    const alias = path.join(probeRoot, `${NFD}.probe`);
    fs.writeFileSync(existing, 'probe\n');
    return aliasSharesInode(
      t,
      existing,
      alias,
      'filesystem preserves distinct NFC/NFD pathnames'
    );
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

function generationFrom(state) {
  return clone(state.diagnosticRecovery.branches[0]);
}

test('R3 state --init rejects argv-safe unsafe IDs before any durable write', async t => {
  const unsafe = [
    ['', 'empty'],
    ['\u00a0\u2003', 'Unicode blank'],
    ['.', 'dot'],
    ['..', 'dot-dot'],
    ['part/child', 'slash'],
    ['part\\child', 'backslash'],
  ];

  for (const [runId, label] of unsafe) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        fs.mkdirSync(path.join(projectRoot, '.soma'));
        writeBytes(path.join(projectRoot, 'sentinel.bin'), Buffer.from([0, 1, 2, 255]));
        const before = snapshotTree(projectRoot);
        const result = runState(projectRoot, ['--init', '--run', runId]);

        assertAll([
          () => assert.notEqual(result.status, 0, `${label}: unsafe ID returned success`),
          () => assert.equal(result.signal, null, `${label}: state CLI hung or was killed`),
          () => assertTreeExact(projectRoot, before, `${label}: unsafe init mutated the tree`),
          () => assert.equal(
            snapshotTree(projectRoot).some(entry => /(?:\.tmp|\.init)$/.test(entry.path)),
            false,
            `${label}: unsafe init left a temp`
          ),
        ]);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R4 existing v2 and v3 state never false-no-op for an NFC/NFD alias', async t => {
  for (const schema of ['soma-state/v2', 'soma-state/v3']) {
    await t.test(schema, st => {
      if (!probeNfcNfdAlias(st)) return;
      const projectRoot = makeProject();
      try {
        const seeded = seedState({ projectRoot, schema, pathnameRunId: NFC, embeddedRunId: NFC });
        writeMarker(projectRoot, NFC);
        assert.equal(
          aliasSharesInode(
            st,
            seeded.file,
            statePath(projectRoot, NFD),
            'filesystem preserves distinct NFC/NFD state pathnames'
          ),
          true
        );
        const before = snapshotTree(projectRoot);
        const result = runState(projectRoot, ['--init', '--run', NFD]);

        assertAll([
          () => assert.notEqual(result.status, 0, `${schema}: aliased request returned success`),
          () => assert.match(result.stderr, /RUN_ID_MISMATCH/, `${schema}: missing exact mismatch identity`),
          () => assert.doesNotMatch(result.stdout, /no-op|already initialized/i),
          () => assertTreeExact(projectRoot, before, `${schema}: alias mismatch mutated bytes`),
        ]);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R4 existing v2 and v3 state never false-no-op for an ASCII embedded mismatch', async t => {
  for (const schema of ['soma-state/v2', 'soma-state/v3']) {
    await t.test(schema, () => {
      const projectRoot = makeProject();
      try {
        seedState({
          projectRoot,
          schema,
          pathnameRunId: ASCII_REQUEST,
          embeddedRunId: ASCII_OWNER,
        });
        writeMarker(projectRoot, ASCII_REQUEST);
        const before = snapshotTree(projectRoot);
        const result = runState(projectRoot, ['--init', '--run', ASCII_REQUEST]);

        assertAll([
          () => assert.notEqual(result.status, 0, `${schema}: mismatched state returned success`),
          () => assert.match(result.stderr, /RUN_ID_MISMATCH/, `${schema}: missing exact mismatch identity`),
          () => assert.doesNotMatch(result.stdout, /no-op|already initialized/i),
          () => assertTreeExact(projectRoot, before, `${schema}: ASCII mismatch mutated bytes`),
        ]);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

function runStateWithInjectedWinner({ projectRoot, requesterRunId, winnerRunId, winnerState }) {
  const winnerStateBase64 = stateBytes(winnerState).toString('base64');
  const winnerMarkerBase64 = canonicalMarkerBytes(winnerRunId).toString('base64');
  const childSource = String.raw`
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const Module = require('node:module');
    const stateCli = process.argv[1];
    const requesterRunId = process.argv[2];
    const winnerRunId = process.argv[3];
    const winnerStateBytes = Buffer.from(process.argv[4], 'base64');
    const winnerMarkerBytes = Buffer.from(process.argv[5], 'base64');
    const originalLinkSync = fs.linkSync;
    let injected = false;

    fs.linkSync = function injectWinner(existingPath, newPath) {
      if (!injected && path.basename(newPath) === 'run-state-' + requesterRunId + '.json') {
        injected = true;
        const somaDir = path.join(process.cwd(), '.soma');
        const identitiesDir = path.join(somaDir, 'run-identities');
        fs.mkdirSync(identitiesDir, { recursive: true });
        fs.writeFileSync(path.join(somaDir, 'run-state-' + winnerRunId + '.json'), winnerStateBytes);
        fs.writeFileSync(path.join(identitiesDir, winnerRunId + '.json'), winnerMarkerBytes);
        const error = new Error('injected competing state winner');
        error.code = 'EEXIST';
        throw error;
      }
      return originalLinkSync.call(this, existingPath, newPath);
    };
    process.once('exit', () => { fs.linkSync = originalLinkSync; });
    process.argv = [process.execPath, stateCli, '--init', '--run', requesterRunId];
    Module.runMain();
  `;

  return spawnSync(process.execPath, [
    '-e',
    childSource,
    STATE_CLI,
    requesterRunId,
    winnerRunId,
    winnerStateBase64,
    winnerMarkerBase64,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
}

function assertWinnerPreserved(projectRoot, runId, state) {
  assert.deepEqual(fs.readFileSync(statePath(projectRoot, runId)), stateBytes(state));
  assert.deepEqual(fs.readFileSync(markerPath(projectRoot, runId)), canonicalMarkerBytes(runId));
  assert.deepEqual(
    snapshotTree(projectRoot).filter(entry => /(?:\.tmp|\.init)$/.test(entry.path)),
    [],
    'state installation race left temporary files'
  );
}

test('R5 NFD state installer loses EEXIST to NFC winner without false no-op', t => {
  if (!probeNfcNfdAlias(t)) return;
  const projectRoot = makeProject();
  try {
    const winnerState = readFixture('soma-state/v3');
    winnerState.runId = NFC;
    const result = runStateWithInjectedWinner({
      projectRoot,
      requesterRunId: NFD,
      winnerRunId: NFC,
      winnerState,
    });

    assertAll([
      () => assert.equal(result.signal, null, 'R5 alias race hung or was killed'),
      () => assert.notEqual(result.status, 0, 'R5 aliased loser returned success'),
      () => assert.match(result.stderr, /RUN_ID_MISMATCH/, 'R5 aliased loser lacked identity failure'),
      () => assert.doesNotMatch(result.stdout, /no-op|already initialized/i),
      () => assertWinnerPreserved(projectRoot, NFC, winnerState),
    ]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R5 exact state installer loses EEXIST, rereads exact winner, and returns no-op', () => {
  const projectRoot = makeProject();
  try {
    const winnerState = readFixture('soma-state/v3');
    winnerState.runId = ASCII_OWNER;
    const result = runStateWithInjectedWinner({
      projectRoot,
      requesterRunId: ASCII_OWNER,
      winnerRunId: ASCII_OWNER,
      winnerState,
    });

    assertAll([
      () => assert.equal(result.status, 0, result.stderr),
      () => assert.equal(result.signal, null, 'R5 exact race hung or was killed'),
      () => assert.match(result.stdout, /no-op|already initialized/i),
      () => assertWinnerPreserved(projectRoot, ASCII_OWNER, winnerState),
    ]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

function stateMismatchCases(t, callback) {
  return Promise.all([
    t.test('NFC/NFD alias', st => {
      if (!probeNfcNfdAlias(st)) return;
      callback({ pathnameRunId: NFC, embeddedRunId: NFC, markerRunId: NFC, requestRunId: NFD });
    }),
    t.test('ASCII embedded mismatch', () => {
      callback({
        pathnameRunId: ASCII_REQUEST,
        embeddedRunId: ASCII_OWNER,
        markerRunId: ASCII_REQUEST,
        requestRunId: ASCII_REQUEST,
      });
    }),
    t.test('marker/state mismatch', () => {
      callback({
        pathnameRunId: ASCII_REQUEST,
        embeddedRunId: ASCII_REQUEST,
        markerRunId: ASCII_OWNER,
        requestRunId: ASCII_REQUEST,
      });
    }),
  ]);
}

test('G1 state --set rejects alias, ASCII, and marker/state mismatch before CAS', async t => {
  await stateMismatchCases(t, ({ pathnameRunId, embeddedRunId, markerRunId, requestRunId }) => {
    const projectRoot = makeProject();
    try {
      seedState({ projectRoot, pathnameRunId, embeddedRunId });
      writeMarker(projectRoot, pathnameRunId, markerRunId);
      const before = snapshotTree(projectRoot);
      const result = runState(projectRoot, ['--run', requestRunId, '--set', 'REVIEWING']);

      assertAll([
        () => assert.notEqual(result.status, 0, 'state --set accepted mismatched identity'),
        () => assert.match(result.stderr, /RUN_ID_MISMATCH/, 'state --set lacked exact mismatch identity'),
        () => assert.doesNotMatch(result.stdout, /transitioned|success/i),
        () => assertTreeExact(projectRoot, before, 'state --set changed state/claim/recovery bytes'),
      ]);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

test('G1 appendReport rejects alias, ASCII, and marker/state mismatch before ledger/CAS', async t => {
  await stateMismatchCases(t, ({ pathnameRunId, embeddedRunId, markerRunId, requestRunId }) => {
    const projectRoot = makeProject();
    try {
      seedState({ projectRoot, pathnameRunId, embeddedRunId });
      writeMarker(projectRoot, pathnameRunId, markerRunId);
      const before = snapshotTree(projectRoot);
      const result = appendReport({
        projectRoot,
        runId: requestRunId,
        step: 'STEP_1B_PLAN',
        status: 'pass',
        finishedAt: '2026-08-26T12:34:56.000Z',
      });

      assertAll([
        () => assert.equal(result.ok, false, `appendReport returned success: ${JSON.stringify(result)}`),
        () => assert.match(
          result.reason || '',
          /^(?:RUN_ID_MISMATCH|RECOVERY_STATE_RUN_ID_MISMATCH)(?::|$)/,
          'appendReport lacked stable exact mismatch identity'
        ),
        () => assertTreeExact(projectRoot, before, 'appendReport changed ledger/claim/recovery bytes'),
      ]);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function setupRecoveryMarkerCase(kind) {
  const projectRoot = makeProject('soma-recovery-marker-preflight-');
  const runId = 'run-recovery-marker';
  const seeded = seedState({ projectRoot, pathnameRunId: runId, embeddedRunId: runId });
  const identitiesDir = path.dirname(markerPath(projectRoot, runId));

  if (kind === 'wrong') {
    writeMarker(projectRoot, runId, 'run-other');
  } else if (kind === 'malformed') {
    writeBytes(markerPath(projectRoot, runId), Buffer.from('{"not":"canonical"}\n'));
  } else if (kind === 'nonordinary-parent') {
    fs.writeFileSync(identitiesDir, 'identity parent is a file\n');
  } else {
    throw new Error(`unknown marker case: ${kind}`);
  }
  return { projectRoot, runId, ...seeded };
}

function invokeRecoveryApi(api, setup) {
  if (api === 'readStateV3') {
    return readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  }
  if (api === 'mutateRunStateCas') {
    const nextState = clone(setup.state);
    nextState.previousState = nextState.currentState;
    nextState.currentState = 'REVIEWING';
    nextState.lastTransitionAt = '2026-08-26T13:00:00.000Z';
    return mutateRunStateCas({
      projectRoot: setup.projectRoot,
      runId: setup.runId,
      expectedStateSha256: SHA256(setup.bytes),
      nextStateBytes: stateBytes(nextState),
      generationReference: null,
    });
  }
  if (api === 'publishRecoveryGeneration') {
    return publishRecoveryGeneration({
      projectRoot: setup.projectRoot,
      runId: setup.runId,
      expectedStateSha256: SHA256(setup.bytes),
      generation: generationFrom(setup.state),
    });
  }
  throw new Error(`unknown recovery API: ${api}`);
}

test('G2 marker preflight precedes recovery read, claim, generation, and CAS writes', async t => {
  for (const kind of ['wrong', 'malformed', 'nonordinary-parent']) {
    for (const api of ['readStateV3', 'mutateRunStateCas', 'publishRecoveryGeneration']) {
      await t.test(`${kind}: ${api}`, () => {
        const setup = setupRecoveryMarkerCase(kind);
        try {
          const before = snapshotTree(setup.projectRoot);
          const result = capture(() => invokeRecoveryApi(api, setup));
          assertFailureAndUnchanged({
            result,
            identity: /^RECOVERY_STATE_RUN_ID_MISMATCH(?::|$)/,
            projectRoot: setup.projectRoot,
            before,
            label: `${kind}: ${api}`,
          });
        } finally {
          fs.rmSync(setup.projectRoot, { recursive: true, force: true });
        }
      });
    }
  }
});

test('G2 recovery APIs preserve unsafe and exact mismatch public error codes', async t => {
  const unsafeProject = makeProject('soma-recovery-unsafe-');
  try {
    const before = snapshotTree(unsafeProject);
    const calls = [
      ['readStateV3', 'RECOVERY_REFERENCE_RUN_ID_INVALID', () => readStateV3({
        projectRoot: unsafeProject,
        runId: '../unsafe',
      })],
      ['mutateRunStateCas', 'RECOVERY_STATE_RUN_ID_INVALID', () => mutateRunStateCas({
        projectRoot: unsafeProject,
        runId: '../unsafe',
        expectedStateSha256: 'a'.repeat(64),
        nextStateBytes: Buffer.from('{}'),
      })],
      ['publishRecoveryGeneration', 'RECOVERY_STATE_RUN_ID_INVALID', () => publishRecoveryGeneration({
        projectRoot: unsafeProject,
        runId: '../unsafe',
        expectedStateSha256: 'a'.repeat(64),
        generation: {},
      })],
    ];
    for (const [name, code, callback] of calls) {
      await t.test(`unsafe ${name}`, () => {
        const result = capture(callback);
        assertFailureAndUnchanged({
          result,
          identity: new RegExp(`^${code}(?::|$)`),
          projectRoot: unsafeProject,
          before,
          label: `unsafe ${name}`,
        });
      });
    }
  } finally {
    fs.rmSync(unsafeProject, { recursive: true, force: true });
  }

  for (const api of ['readStateV3', 'mutateRunStateCas', 'publishRecoveryGeneration']) {
    await t.test(`exact state mismatch: ${api}`, () => {
      const projectRoot = makeProject('soma-recovery-state-mismatch-');
      try {
        const seeded = seedState({
          projectRoot,
          pathnameRunId: ASCII_REQUEST,
          embeddedRunId: ASCII_OWNER,
        });
        writeMarker(projectRoot, ASCII_REQUEST);
        const before = snapshotTree(projectRoot);
        const setup = { projectRoot, runId: ASCII_REQUEST, ...seeded };
        const result = capture(() => invokeRecoveryApi(api, setup));
        assertFailureAndUnchanged({
          result,
          identity: /^RECOVERY_STATE_RUN_ID_MISMATCH(?::|$)/,
          projectRoot,
          before,
          label: `exact state mismatch: ${api}`,
        });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('G3 migrateStateV2 preserves NFC/NFD code points and performs no filesystem calls', async t => {
  assert.notEqual(NFC, NFD);
  for (const runId of [NFC, NFD]) {
    await t.test(JSON.stringify(runId), () => {
      const input = readFixture('soma-state/v2');
      const recovery = clone(readFixture('soma-state/v3').diagnosticRecovery);
      input.runId = runId;
      const originalInput = clone(input);
      const methods = [
        'readFileSync', 'writeFileSync', 'mkdirSync', 'linkSync', 'renameSync',
        'openSync', 'lstatSync', 'realpathSync', 'unlinkSync',
      ];
      const originals = new Map();
      const calls = [];
      let migrated;
      let migrationError;

      try {
        for (const method of methods) {
          originals.set(method, fs[method]);
          fs[method] = function forbiddenFsCall() {
            calls.push(method);
            throw new Error(`FS_CALL_FORBIDDEN:${method}`);
          };
        }
        migrated = migrateStateV2(input, recovery);
      } catch (error) {
        migrationError = error;
      } finally {
        for (const [method, original] of originals) fs[method] = original;
      }

      assertAll([
        () => assert.equal(migrationError, undefined, migrationError && migrationError.message),
        () => assert.deepEqual(calls, [], 'migrateStateV2 touched fs'),
        () => assert.equal(migrated.runId, runId, 'migrateStateV2 changed runId code points'),
        () => assert.deepEqual(input, originalInput, 'migrateStateV2 mutated the v2 input'),
        () => assert.equal(migrated.$schema, 'soma-state/v3'),
        () => assert.equal(migrated.diagnosticRecovery, recovery),
      ]);
    });
  }
});
