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
const { checkValidatorAssignment } = require('../run/validator-invariant.cjs');

const RUN_CLI = path.join(__dirname, '..', 'run.cjs');
const STATE_FIXTURE = path.join(__dirname, 'fixtures', 'recovery', 'state', 'v3-red-pending.json');
const NFC = 'run-\u00e9';
const NFD = 'run-e\u0301';
const ASCII_REQUEST = 'run-request';
const ASCII_OWNER = 'run-owner';
const STEP = 'STEP_1A_SPECIFY';
const NEXT_STEP = 'STEP_1B_PLAN';
const TASK = 'T-BOUNDARY';
const UNSAFE_ARGV = [
  ['', 'empty'],
  ['\u00a0\u2003', 'Unicode blank'],
  ['.', 'dot'],
  ['..', 'dot-dot'],
  ['part/child', 'slash'],
  ['part\\child', 'backslash'],
];

function makeProject(prefix = 'soma-run-id-boundaries-') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(projectRoot, '.soma'));
  return projectRoot;
}

function writeBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

function writeText(file, value) {
  return writeBytes(file, Buffer.from(value, 'utf8'));
}

function markerPath(projectRoot, runId) {
  return path.join(projectRoot, '.soma', 'run-identities', `${runId}.json`);
}

function statePath(projectRoot, runId) {
  return path.join(projectRoot, '.soma', `run-state-${runId}.json`);
}

function reportPath(projectRoot, runId, step = STEP) {
  return path.join(projectRoot, '.soma', 'reports', runId, `${step}-report.json`);
}

function dispatchDir(projectRoot, runId, taskId = TASK, attempt = 1) {
  const base = path.join(projectRoot, '.soma', 'dispatches', runId, taskId);
  return attempt === 1 ? base : path.join(base, `attempt-${attempt}`);
}

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId,
  }, null, 2)}\n`, 'utf8');
}

function stateBytes(runId) {
  const state = JSON.parse(fs.readFileSync(STATE_FIXTURE, 'utf8'));
  state.runId = runId;
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function seedState(projectRoot, pathnameRunId, embeddedRunId = pathnameRunId) {
  const bytes = stateBytes(embeddedRunId);
  const file = writeBytes(statePath(projectRoot, pathnameRunId), bytes);
  return { file, bytes };
}

function seedMarker(projectRoot, pathnameRunId, embeddedRunId = pathnameRunId) {
  const bytes = canonicalMarkerBytes(embeddedRunId);
  const file = writeBytes(markerPath(projectRoot, pathnameRunId), bytes);
  return { file, bytes };
}

function validReport(runId, overrides = {}) {
  return {
    schema: 'soma-step-report/v1',
    run_id: runId,
    step: STEP,
    status: 'pass',
    started_at: '2026-08-26T12:00:00.000Z',
    finished_at: '2026-08-26T12:01:00.000Z',
    artifacts: [],
    metrics: {},
    notes: '',
    ...overrides,
  };
}

function validMetadata(runId, taskId = TASK, overrides = {}) {
  return {
    schema: 'soma-dispatch-record/v1',
    run_id: runId,
    task_id: taskId,
    attempt: 1,
    model: 'gpt-5',
    base_sha: 'ed70259de693348d580ff42b7ade9ed0989722b2',
    started_at: '2026-08-26T12:00:00.000Z',
    finished_at: '2026-08-26T12:01:00.000Z',
    ac_refs: ['AC-08', 'AC-09'],
    executor_agent: 'executor-owner',
    result: 'done',
    ...overrides,
  };
}

function seedReportSentinels(projectRoot, runId) {
  const file = writeBytes(reportPath(projectRoot, runId), Buffer.from([0, 82, 54, 255]));
  writeText(path.join(path.dirname(file), '.report.final.sentinel.tmp'), 'report temp sentinel\n');
  writeBytes(
    path.join(projectRoot, '.soma', 'recovery', runId, 'claims', 'sentinel.bin'),
    Buffer.from([9, 8, 7, 0, 255])
  );
  return file;
}

function seedDispatchSentinels(projectRoot, runId, taskId = TASK, attempt = 1) {
  const dir = dispatchDir(projectRoot, runId, taskId, attempt);
  writeText(path.join(dir, 'prompt.md'), 'owner prompt sentinel\n');
  writeText(path.join(dir, 'output.md'), 'owner output sentinel\n');
  writeText(path.join(dir, 'metadata.json'), '{"owner":"metadata sentinel"}\n');
  writeText(path.join(dir, '.prompt.final.sentinel.tmp'), 'prompt temp sentinel\n');
  writeText(path.join(dir, '.output.final.sentinel.tmp'), 'output temp sentinel\n');
  writeText(path.join(dir, '.metadata.final.sentinel.tmp'), 'metadata temp sentinel\n');
  return dir;
}

function writeLock(projectRoot, runId) {
  writeText(
    path.join(projectRoot, '.soma.lock'),
    `${JSON.stringify({ sessionId: 'boundary-test', runId, startedAt: '2026-08-26T12:00:00.000Z' })}\n`
  );
}

function runRun(projectRoot, args, env = {}) {
  return spawnSync(process.execPath, [RUN_CLI, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
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

function assertRejectedWithoutMutation({ result, projectRoot, before, identity, label }) {
  assertAll([
    () => assert.notEqual(result.status, 0, `${label}: request returned success`),
    () => assert.equal(result.signal, null, `${label}: process hung or was killed`),
    () => assert.match(`${result.stdout}${result.stderr}`, identity, `${label}: wrong failure identity`),
    () => assert.doesNotMatch(result.stdout, /"ok"\s*:\s*true|reenters at/i, `${label}: emitted success output`),
    () => assertTreeUnchanged(projectRoot, before, `${label}: durable tree changed`),
  ]);
}

function requireAliasedPaths(t, pairs) {
  for (const [existingPath, aliasPath, label] of pairs) {
    if (!aliasSharesInode(t, existingPath, aliasPath, `filesystem preserves distinct NFC/NFD ${label} pathnames`)) {
      return false;
    }
  }
  return true;
}

function writeOrderingPreload(projectRoot, targets) {
  const preload = path.join(projectRoot, 'observe-marker-order.cjs');
  const source = String.raw`
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const originalWriteFileSync = fs.writeFileSync;
    const targets = new Set(JSON.parse(process.env.SOMA_TEST_ORDER_TARGETS));
    const expectedMarker = Buffer.from(process.env.SOMA_TEST_MARKER_BASE64, 'base64');
    const markerPath = process.env.SOMA_TEST_MARKER_PATH;
    const statePath = process.env.SOMA_TEST_STATE_PATH || '';
    const stateSha = process.env.SOMA_TEST_STATE_SHA256 || '';
    fs.writeFileSync = function observedWrite(file, data, options) {
      if (typeof file === 'string') {
        const base = path.basename(file);
        const destination = [...targets].find(target => base === target || base.startsWith('.' + target + '.'));
        if (destination) {
          let marker;
          try { marker = fs.readFileSync(markerPath); } catch (_error) {
            throw new Error('ORDER_MARKER_MISSING_BEFORE_' + destination);
          }
          if (!marker.equals(expectedMarker)) {
            throw new Error('ORDER_MARKER_WRONG_BEFORE_' + destination);
          }
          if (statePath) {
            const actual = require('node:crypto').createHash('sha256').update(fs.readFileSync(statePath)).digest('hex');
            if (actual !== stateSha) throw new Error('ORDER_STATE_MUTATED_BEFORE_' + destination);
          }
        }
      }
      return originalWriteFileSync.call(this, file, data, options);
    };
  `;
  writeText(preload, source);
  return {
    NODE_OPTIONS: `--require=${preload}`,
    SOMA_TEST_ORDER_TARGETS: JSON.stringify(targets),
  };
}

function orderingEnv(projectRoot, runId, targets, state) {
  return {
    ...writeOrderingPreload(projectRoot, targets),
    SOMA_TEST_MARKER_PATH: markerPath(projectRoot, runId),
    SOMA_TEST_MARKER_BASE64: canonicalMarkerBytes(runId).toString('base64'),
    SOMA_TEST_STATE_PATH: state ? state.file : '',
    SOMA_TEST_STATE_SHA256: state ? crypto.createHash('sha256').update(state.bytes).digest('hex') : '',
  };
}

test('R6 report rejects an NFC/NFD alias from explicit --run before replacing or appending', t => {
  const projectRoot = makeProject();
  try {
    const state = seedState(projectRoot, NFC);
    const marker = seedMarker(projectRoot, NFC);
    const report = seedReportSentinels(projectRoot, NFC);
    if (!requireAliasedPaths(t, [
      [state.file, statePath(projectRoot, NFD), 'state'],
      [marker.file, markerPath(projectRoot, NFD), 'marker'],
      [report, reportPath(projectRoot, NFD), 'report'],
    ])) return;
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, ['report', '--run', NFD, '--step', STEP, '--status', 'pass']);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'explicit alias report' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R6 report rejects an NFC/NFD alias from .soma.lock before replacing or appending', t => {
  const projectRoot = makeProject();
  try {
    const state = seedState(projectRoot, NFC);
    const marker = seedMarker(projectRoot, NFC);
    const report = seedReportSentinels(projectRoot, NFC);
    writeLock(projectRoot, NFD);
    if (!requireAliasedPaths(t, [
      [state.file, statePath(projectRoot, NFD), 'state'],
      [marker.file, markerPath(projectRoot, NFD), 'marker'],
      [report, reportPath(projectRoot, NFD), 'report'],
    ])) return;
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, ['report', '--step', STEP, '--status', 'pass']);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'lock alias report' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R6 report rejects an ordinary embedded-state mismatch before replacing or appending', () => {
  const projectRoot = makeProject();
  try {
    seedState(projectRoot, ASCII_REQUEST, ASCII_OWNER);
    seedMarker(projectRoot, ASCII_REQUEST);
    seedReportSentinels(projectRoot, ASCII_REQUEST);
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, ['report', '--run', ASCII_REQUEST, '--step', STEP, '--status', 'pass']);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'ASCII state mismatch report' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R6 report rejects every argv-safe unsafe ID without creating a destination or temp', async t => {
  for (const [runId, label] of UNSAFE_ARGV) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        writeBytes(path.join(projectRoot, 'sentinel.bin'), Buffer.from([0, 1, 2, 255]));
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, ['report', '--run', runId, '--step', STEP, '--status', 'pass']);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_INVALID/, label: `unsafe report ${label}` });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R6 report rejects unsafe lock IDs without artifact fallback or mutation', async t => {
  for (const [runId, label] of UNSAFE_ARGV) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        writeLock(projectRoot, runId);
        writeText(path.join(projectRoot, '.soma', 'reports', 'run-fallback', 'sentinel.json'), 'fallback sentinel\n');
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, ['report', '--step', STEP, '--status', 'pass']);
        assertRejectedWithoutMutation({
          result,
          projectRoot,
          before,
          identity: /RUN_UNRESOLVED|RUN_ID_INVALID/,
          label: `unsafe report lock ${label}`,
        });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R6 report validates flags and payload before exact legacy-state marker adoption', async t => {
  for (const [label, args, identity] of [
    ['invalid status', ['--step', STEP, '--status', 'done'], /INVALID_STATUS/],
    ['missing failure reason', ['--step', STEP, '--status', 'fail'], /MISSING_FAILURE_REASON/],
  ]) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        const runId = `run-report-input-${label.replace(/\s+/g, '-')}`;
        seedState(projectRoot, runId);
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, ['report', '--run', runId, ...args]);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity, label: `report ${label}` });
        assert.equal(fs.existsSync(markerPath(projectRoot, runId)), false, `${label}: marker adoption happened too early`);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R6 exact legacy-state adoption creates only the marker before the first report write', () => {
  const projectRoot = makeProject();
  try {
    const runId = 'run-report-adoption-order';
    const state = seedState(projectRoot, runId);
    const env = orderingEnv(projectRoot, runId, ['STEP_1A_SPECIFY-report.json'], state);
    const result = runRun(projectRoot, ['report', '--run', runId, '--step', STEP, '--status', 'pass'], env);
    assert.equal(result.status, 0, `report adoption/order failed: ${result.stderr}`);
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, runId)), canonicalMarkerBytes(runId));
    const report = JSON.parse(fs.readFileSync(reportPath(projectRoot, runId), 'utf8'));
    assert.equal(report.run_id, runId);
    assert.equal(report.step, STEP);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R7 first-step success cannot bypass unsafe run identity preflight', async t => {
  for (const [runId, label] of UNSAFE_ARGV) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        writeText(path.join(projectRoot, 'sentinel.txt'), 'first-step sentinel\n');
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, ['gate', '--run', runId, '--step', STEP]);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_INVALID/, label: `unsafe first-step ${label}` });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R7 later-step gate requires exact report run_id and previous step before status', async t => {
  for (const [label, overrides] of [
    ['wrong report run_id', { run_id: ASCII_OWNER }],
    ['wrong report step', { step: 'STEP_9_FIX_LOOP' }],
  ]) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        seedState(projectRoot, ASCII_REQUEST);
        seedMarker(projectRoot, ASCII_REQUEST);
        writeText(reportPath(projectRoot, ASCII_REQUEST), `${JSON.stringify(validReport(ASCII_REQUEST, overrides))}\n`);
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, ['gate', '--run', ASCII_REQUEST, '--step', NEXT_STEP]);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R7 later-step gate never authorizes an NFC/NFD request alias', t => {
  const projectRoot = makeProject();
  try {
    const state = seedState(projectRoot, NFC);
    const marker = seedMarker(projectRoot, NFC);
    const report = writeText(reportPath(projectRoot, NFC), `${JSON.stringify(validReport(NFC))}\n`);
    if (!requireAliasedPaths(t, [
      [state.file, statePath(projectRoot, NFD), 'state'],
      [marker.file, markerPath(projectRoot, NFD), 'marker'],
      [report, reportPath(projectRoot, NFD), 'report'],
    ])) return;
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, ['gate', '--run', NFD, '--step', NEXT_STEP]);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'aliased gate report' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R8 validator checks metadata run_id and task_id before executor inequality', async t => {
  for (const [label, metadata, expected] of [
    ['wrong metadata run_id', validMetadata(ASCII_OWNER), { expectedRunId: ASCII_REQUEST, expectedTaskId: TASK }],
    ['wrong metadata task_id', validMetadata(ASCII_REQUEST, 'T-OTHER'), { expectedRunId: ASCII_REQUEST, expectedTaskId: TASK }],
  ]) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        const metadataPath = writeText(path.join(projectRoot, 'metadata.json'), `${JSON.stringify(metadata)}\n`);
        const result = checkValidatorAssignment({
          metadataPath,
          proposedValidator: 'different-validator',
          ...expected,
        });
        assert.equal(result.allowed, false, `${label}: executor inequality must not authorize mismatched provenance`);
        assert.match(result.reason || '', /RUN_ID_MISMATCH/, `${label}: stable identity missing`);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R8 validator gate blocks ASCII provenance mismatches before executor inequality', async t => {
  for (const [label, metadata] of [
    ['wrong run_id', validMetadata(ASCII_OWNER)],
    ['wrong task_id', validMetadata(ASCII_REQUEST, 'T-OTHER')],
  ]) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        seedState(projectRoot, ASCII_REQUEST);
        seedMarker(projectRoot, ASCII_REQUEST);
        const file = path.join(dispatchDir(projectRoot, ASCII_REQUEST), 'metadata.json');
        writeText(file, `${JSON.stringify(metadata)}\n`);
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, [
          'gate', '--run', ASCII_REQUEST, '--validate', TASK, '--validator', 'different-validator',
        ]);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: `validator ${label}` });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R8 validator gate never authorizes NFC metadata through an NFD alias', t => {
  const projectRoot = makeProject();
  try {
    const state = seedState(projectRoot, NFC);
    const marker = seedMarker(projectRoot, NFC);
    const metadata = writeText(
      path.join(dispatchDir(projectRoot, NFC), 'metadata.json'),
      `${JSON.stringify(validMetadata(NFC))}\n`
    );
    if (!requireAliasedPaths(t, [
      [state.file, statePath(projectRoot, NFD), 'state'],
      [marker.file, markerPath(projectRoot, NFD), 'marker'],
      [metadata, path.join(dispatchDir(projectRoot, NFD), 'metadata.json'), 'metadata'],
    ])) return;
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, [
      'gate', '--run', NFD, '--validate', TASK, '--validator', 'different-validator',
    ]);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'aliased validator metadata' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R9 resume rejects every argv-safe unsafe explicit ID before any path or output', async t => {
  for (const [runId, label] of UNSAFE_ARGV) {
    await t.test(label, () => {
      const projectRoot = makeProject();
      try {
        writeBytes(path.join(projectRoot, 'resume-sentinel.bin'), Buffer.from([0, 4, 9, 255]));
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, ['resume', '--run', runId]);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_INVALID/, label: `unsafe resume ${label}` });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R9 resume emits no success and mutates nothing for aliased or ASCII state ownership', async t => {
  await t.test('NFC/NFD alias', st => {
    const projectRoot = makeProject();
    try {
      const state = seedState(projectRoot, NFC);
      const marker = seedMarker(projectRoot, NFC);
      if (!requireAliasedPaths(st, [
        [state.file, statePath(projectRoot, NFD), 'state'],
        [marker.file, markerPath(projectRoot, NFD), 'marker'],
      ])) return;
      const before = snapshotTree(projectRoot);
      const result = runRun(projectRoot, ['resume', '--run', NFD]);
      assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'aliased resume state' });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  await t.test('ASCII embedded mismatch', () => {
    const projectRoot = makeProject();
    try {
      seedState(projectRoot, ASCII_REQUEST, ASCII_OWNER);
      seedMarker(projectRoot, ASCII_REQUEST);
      const before = snapshotTree(projectRoot);
      const result = runRun(projectRoot, ['resume', '--run', ASCII_REQUEST]);
      assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'ASCII resume state mismatch' });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

test('R10 dispatch begin cannot overwrite an NFC owner through an NFD alias', t => {
  const projectRoot = makeProject();
  try {
    const marker = seedMarker(projectRoot, NFC);
    const dir = seedDispatchSentinels(projectRoot, NFC);
    const prompt = writeText(path.join(projectRoot, 'attacker-prompt.md'), 'attacker prompt\n');
    if (!requireAliasedPaths(t, [
      [marker.file, markerPath(projectRoot, NFD), 'marker'],
      [path.join(dir, 'prompt.md'), path.join(dispatchDir(projectRoot, NFD), 'prompt.md'), 'prompt'],
    ])) return;
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, [
      'dispatch-record', 'begin', '--run', NFD, '--task', TASK, '--prompt-file', prompt,
    ]);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'aliased dispatch begin' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R10 dispatch begin cannot overwrite an ordinary ASCII owner', () => {
  const projectRoot = makeProject();
  try {
    seedMarker(projectRoot, ASCII_REQUEST, ASCII_OWNER);
    seedDispatchSentinels(projectRoot, ASCII_REQUEST);
    const prompt = writeText(path.join(projectRoot, 'attacker-prompt.md'), 'attacker prompt\n');
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, [
      'dispatch-record', 'begin', '--run', ASCII_REQUEST, '--task', TASK, '--prompt-file', prompt,
    ]);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'ASCII dispatch begin owner' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R10 dispatch end cannot overwrite an NFC owner through an NFD alias', t => {
  const projectRoot = makeProject();
  try {
    const marker = seedMarker(projectRoot, NFC);
    const dir = seedDispatchSentinels(projectRoot, NFC);
    const output = writeText(path.join(projectRoot, 'attacker-output.md'), 'attacker output\n');
    const metadata = writeText(
      path.join(projectRoot, 'attacker-metadata.json'),
      `${JSON.stringify(validMetadata(NFD))}\n`
    );
    if (!requireAliasedPaths(t, [
      [marker.file, markerPath(projectRoot, NFD), 'marker'],
      [path.join(dir, 'output.md'), path.join(dispatchDir(projectRoot, NFD), 'output.md'), 'output'],
      [path.join(dir, 'metadata.json'), path.join(dispatchDir(projectRoot, NFD), 'metadata.json'), 'metadata'],
    ])) return;
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, [
      'dispatch-record', 'end', '--run', NFD, '--task', TASK,
      '--output-file', output, '--metadata-file', metadata,
    ]);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'aliased dispatch end' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R10 dispatch end cannot overwrite an ordinary ASCII owner', () => {
  const projectRoot = makeProject();
  try {
    seedMarker(projectRoot, ASCII_REQUEST, ASCII_OWNER);
    seedDispatchSentinels(projectRoot, ASCII_REQUEST);
    const output = writeText(path.join(projectRoot, 'attacker-output.md'), 'attacker output\n');
    const metadata = writeText(
      path.join(projectRoot, 'attacker-metadata.json'),
      `${JSON.stringify(validMetadata(ASCII_REQUEST))}\n`
    );
    const before = snapshotTree(projectRoot);
    const result = runRun(projectRoot, [
      'dispatch-record', 'end', '--run', ASCII_REQUEST, '--task', TASK,
      '--output-file', output, '--metadata-file', metadata,
    ]);
    assertRejectedWithoutMutation({ result, projectRoot, before, identity: /RUN_ID_MISMATCH/, label: 'ASCII dispatch end owner' });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R10 new state-less begin reserves a marker before an exact 8,000-byte attempt-2 prompt', () => {
  const projectRoot = makeProject();
  try {
    const runId = 'run-new-begin';
    const prompt = writeText(path.join(projectRoot, 'prompt-8000.md'), 'p'.repeat(8000));
    const env = orderingEnv(projectRoot, runId, ['prompt.md']);
    const result = runRun(projectRoot, [
      'dispatch-record', 'begin', '--run', runId, '--task', TASK, '--attempt', '2', '--prompt-file', prompt,
    ], env);
    assert.equal(result.status, 0, `state-less begin/order failed: ${result.stderr}`);
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, runId)), canonicalMarkerBytes(runId));
    assert.deepEqual(fs.readFileSync(path.join(dispatchDir(projectRoot, runId, TASK, 2), 'prompt.md')), fs.readFileSync(prompt));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R10 new state-less end reserves a marker before exact 4,000-byte output and metadata', () => {
  const projectRoot = makeProject();
  try {
    const runId = 'run-new-end';
    const output = writeText(path.join(projectRoot, 'output-4000.md'), 'o'.repeat(4000));
    const metadata = writeText(
      path.join(projectRoot, 'metadata-attempt-2.json'),
      `${JSON.stringify(validMetadata(runId, TASK, { attempt: 2 }))}\n`
    );
    const env = orderingEnv(projectRoot, runId, ['output.md', 'metadata.json']);
    const result = runRun(projectRoot, [
      'dispatch-record', 'end', '--run', runId, '--task', TASK, '--attempt', '2',
      '--output-file', output, '--metadata-file', metadata,
    ], env);
    assert.equal(result.status, 0, `state-less end/order failed: ${result.stderr}`);
    assert.deepEqual(fs.readFileSync(markerPath(projectRoot, runId)), canonicalMarkerBytes(runId));
    const dir = dispatchDir(projectRoot, runId, TASK, 2);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'output.md')), fs.readFileSync(output));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')), validMetadata(runId, TASK, { attempt: 2 }));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('R10 legacy dispatch-only trees are unprovable for begin and end', async t => {
  for (const verb of ['begin', 'end']) {
    await t.test(verb, () => {
      const projectRoot = makeProject();
      try {
        const runId = `run-legacy-${verb}`;
        seedDispatchSentinels(projectRoot, runId);
        const prompt = writeText(path.join(projectRoot, 'new-prompt.md'), 'new prompt\n');
        const output = writeText(path.join(projectRoot, 'new-output.md'), 'new output\n');
        const metadata = writeText(
          path.join(projectRoot, 'new-metadata.json'),
          `${JSON.stringify(validMetadata(runId))}\n`
        );
        const before = snapshotTree(projectRoot);
        const args = verb === 'begin'
          ? ['dispatch-record', 'begin', '--run', runId, '--task', TASK, '--prompt-file', prompt]
          : ['dispatch-record', 'end', '--run', runId, '--task', TASK, '--output-file', output, '--metadata-file', metadata];
        const result = runRun(projectRoot, args);
        assertRejectedWithoutMutation({
          result,
          projectRoot,
          before,
          identity: /RUN_ID_IDENTITY_UNPROVABLE/,
          label: `legacy dispatch ${verb}`,
        });
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

test('R10 dispatch budgets and metadata coherence fail before marker or artifact writes', async t => {
  const cases = [
    {
      label: 'prompt over 8,000 bytes',
      prepare(projectRoot, runId) {
        const prompt = writeText(path.join(projectRoot, 'prompt-over.md'), 'p'.repeat(8001));
        return ['dispatch-record', 'begin', '--run', runId, '--task', TASK, '--prompt-file', prompt];
      },
      identity: /DISPATCH_BUDGET_EXCEEDED/,
    },
    {
      label: 'attempt over 2',
      prepare(projectRoot, runId) {
        const prompt = writeText(path.join(projectRoot, 'prompt.md'), 'prompt\n');
        return ['dispatch-record', 'begin', '--run', runId, '--task', TASK, '--attempt', '3', '--prompt-file', prompt];
      },
      identity: /DISPATCH_BUDGET_EXCEEDED/,
    },
    {
      label: 'output over 4,000 bytes',
      prepare(projectRoot, runId) {
        const output = writeText(path.join(projectRoot, 'output-over.md'), 'o'.repeat(4001));
        const metadata = writeText(path.join(projectRoot, 'metadata.json'), `${JSON.stringify(validMetadata(runId))}\n`);
        return ['dispatch-record', 'end', '--run', runId, '--task', TASK, '--output-file', output, '--metadata-file', metadata];
      },
      identity: /DISPATCH_BUDGET_EXCEEDED/,
    },
    {
      label: 'metadata provenance mismatch',
      prepare(projectRoot, runId) {
        const output = writeText(path.join(projectRoot, 'output.md'), 'output\n');
        const metadata = writeText(path.join(projectRoot, 'metadata-wrong.json'), `${JSON.stringify(validMetadata('run-wrong'))}\n`);
        return ['dispatch-record', 'end', '--run', runId, '--task', TASK, '--output-file', output, '--metadata-file', metadata];
      },
      identity: /DISPATCH_RECORD_REJECTED/,
    },
  ];

  for (const item of cases) {
    await t.test(item.label, () => {
      const projectRoot = makeProject();
      try {
        const runId = 'run-invalid-dispatch-input';
        const args = item.prepare(projectRoot, runId);
        writeText(path.join(projectRoot, '.soma', 'invalid-call-temp.sentinel.tmp'), 'temp sentinel\n');
        const before = snapshotTree(projectRoot);
        const result = runRun(projectRoot, args);
        assertRejectedWithoutMutation({ result, projectRoot, before, identity: item.identity, label: item.label });
        assert.equal(fs.existsSync(markerPath(projectRoot, runId)), false, `${item.label}: marker must not be reserved`);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});
