'use strict';

/**
 * Task 1 RED contract for the native-session-bound one-time request broker.
 *
 * The broker is tested against real temporary files and real child processes.
 * `fsOps`, monotonic clock, and randomness are injected only to make races and
 * fault boundaries deterministic. The tests cover normal uid isolation and
 * corruption detection; they do not claim to sandbox a hostile same-uid process.
 *
 * Production modules are intentionally absent at this commit. The exact RED
 * command must fail at the require below until Task 1 GREEN implements them.
 *
 * @spec AC-01
 * @spec AC-02
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
} = require('./helpers/run-identity-fixture.cjs');

const BROKER_MODULE = path.join(__dirname, '..', 'entry', 'request-broker.cjs');

const {
  createRequestBroker,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
} = require(BROKER_MODULE);

const UID = typeof process.getuid === 'function' ? process.getuid() : 0;
const SESSION_A = 'claude-session-A';
const SESSION_B = 'claude-session-B';
const ALT_REQUEST_ID = 'fedcba9876543210fedcba9876543210';
const ALT_CAPABILITY = 'fedcba9876543210'.repeat(4);
const CHILD_TIMEOUT_MS = 10_000;

function modeOf(file) {
  return fs.lstatSync(file).mode & 0o777;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function identityOf(prepared) {
  return {
    sessionId: prepared.sessionId,
    requestId: prepared.requestId,
    capability: prepared.capability,
  };
}

function slotDirOf(prepared) {
  return path.dirname(prepared.requestPath);
}

function leasePathOf(prepared) {
  return path.join(slotDirOf(prepared), 'lease.json');
}

function claimPathOf(prepared) {
  return path.join(slotDirOf(prepared), 'claim');
}

function sessionDirOf(prepared) {
  return path.dirname(slotDirOf(prepared));
}

function brokerRootOf(prepared) {
  return path.dirname(sessionDirOf(prepared));
}

function makeClock(monotonicMs = 1_000, wallMs = 1_700_000_000_000) {
  return { monotonicMs, wallMs };
}

function deterministicRandom(start = 0) {
  let call = start;
  return size => {
    call += 1;
    return Buffer.alloc(size, call & 0xff);
  };
}

function tracingFs(onCall) {
  return new Proxy(fs, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args) => {
        onCall(property, args);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function makeFixture(options = {}) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-broker-'));
  fs.chmodSync(runtimeRoot, 0o700);
  const clock = options.clock || makeClock();
  const fsOps = options.fsOps || fs;
  const broker = createRequestBroker({
    runtimeRoot,
    uid: UID,
    fsOps,
    nowMonotonicMs: () => clock.monotonicMs,
    nowWallMs: () => clock.wallMs,
    randomBytes: options.randomBytes || deterministicRandom(),
    ttlMs: options.ttlMs === undefined ? DEFAULT_TTL_MS : options.ttlMs,
  });
  return {
    runtimeRoot,
    clock,
    broker,
    cleanup() {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    },
  };
}

function envelopeFor(prepared, rawArguments = '--help', overrides = {}) {
  return {
    $schema: 'soma-entry-request/v1',
    sessionId: prepared.sessionId,
    requestId: prepared.requestId,
    capability: prepared.capability,
    rawArguments,
    ...overrides,
  };
}

function writeEnvelope(prepared, rawArguments = '--help', overrides = {}) {
  const envelope = envelopeFor(prepared, rawArguments, overrides);
  fs.writeFileSync(prepared.requestPath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  fs.chmodSync(prepared.requestPath, 0o600);
  return envelope;
}

function readLease(prepared) {
  return JSON.parse(fs.readFileSync(leasePathOf(prepared), 'utf8'));
}

function writeLease(prepared, lease) {
  fs.writeFileSync(leasePathOf(prepared), `${JSON.stringify(lease)}\n`, { mode: 0o600 });
  fs.chmodSync(leasePathOf(prepared), 0o600);
}

async function captureError(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function assertRejected(callback, expected) {
  const error = await captureError(callback);
  assert.ok(error, 'expected broker operation to reject');
  assert.equal(typeof error.code, 'string', `broker error needs a stable code: ${error.stack || error}`);
  if (expected instanceof RegExp) {
    assert.match(error.code, expected);
  } else if (expected) {
    assert.equal(error.code, expected);
  }
  return error;
}

function spawnJsonChild(source, args) {
  const child = spawn(process.execPath, ['-e', source, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const result = new Promise((resolve, reject) => {
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
        reject(new Error(`broker child timed out: ${stderr}`));
        return;
      }
      const lines = stdout.trim().split('\n').filter(Boolean);
      let parsed;
      try {
        parsed = JSON.parse(lines.at(-1));
      } catch (error) {
        reject(new Error(`broker child returned invalid JSON: ${stdout}\n${stderr}\n${error.message}`));
        return;
      }
      resolve({ code, signal, value: parsed, stdout, stderr });
    });
  });
  return { child, result };
}

async function waitForPath(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${file}`);
}

function assertNoClaim(prepared) {
  assert.equal(fs.existsSync(claimPathOf(prepared)), false, 'identity rejection created a claim');
}

test('prepare hashes the native session, creates exact owner-only layout, and emits a minimal lease', async () => {
  const opens = [];
  const fixture = makeFixture({
    fsOps: tracingFs((operation, args) => {
      if (operation === 'openSync') opens.push(args);
    }),
  });
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    const slotDir = slotDirOf(prepared);
    const sessionDir = sessionDirOf(prepared);
    const brokerRoot = brokerRootOf(prepared);
    const lease = readLease(prepared);

    assert.equal(prepared.sessionId, SESSION_A);
    assert.match(prepared.requestId, /^[0-9a-f]{32}$/);
    assert.match(prepared.capability, /^[0-9a-f]{64}$/);
    assert.equal(path.basename(sessionDir), sha256(SESSION_A));
    assert.equal(prepared.requestPath, path.join(slotDir, 'request.json'));
    assert.equal(fs.lstatSync(prepared.requestPath).isFile(), true);
    assert.equal(fs.readFileSync(prepared.requestPath).length, 0);

    for (const directory of [
      path.join(fixture.runtimeRoot, 'soma-entry'),
      brokerRoot,
      sessionDir,
      slotDir,
    ]) {
      assert.equal(modeOf(directory), 0o700, `${directory} must be mode 0700`);
      assert.equal(fs.lstatSync(directory).uid, UID, `${directory} must be owned by current uid`);
    }
    for (const file of [leasePathOf(prepared), prepared.requestPath]) {
      assert.equal(modeOf(file), 0o600, `${file} must be mode 0600`);
      assert.equal(fs.lstatSync(file).uid, UID, `${file} must be owned by current uid`);
      assert.equal(fs.lstatSync(file).isFile(), true, `${file} must be regular`);
    }

    assert.deepEqual(Object.keys(lease).sort(), [
      '$schema',
      'capability',
      'createdMonotonicMs',
      'expiresMonotonicMs',
      'requestId',
      'requestPath',
      'sessionId',
      'ttlMs',
    ]);
    assert.equal(lease.$schema, 'soma-entry-lease/v1');
    assert.equal(lease.sessionId, prepared.sessionId);
    assert.equal(lease.requestId, prepared.requestId);
    assert.equal(lease.capability, prepared.capability);
    assert.equal(lease.requestPath, prepared.requestPath);
    assert.equal(lease.createdMonotonicMs, fixture.clock.monotonicMs);
    assert.equal(lease.expiresMonotonicMs, lease.createdMonotonicMs + lease.ttlMs);
    assert.equal(lease.ttlMs, DEFAULT_TTL_MS);
    assert.ok(lease.ttlMs > 0 && lease.ttlMs <= MAX_TTL_MS);
    for (const forbidden of ['mode', 'rawArguments', 'contentSha256', 'requestSha256', 'objective']) {
      assert.equal(Object.hasOwn(lease, forbidden), false, `lease predicts ${forbidden}`);
    }

    const createdFiles = opens.filter(([file, flags]) =>
      [leasePathOf(prepared), prepared.requestPath].includes(file) &&
      typeof flags === 'number' &&
      (flags & fs.constants.O_CREAT) !== 0
    );
    assert.equal(createdFiles.length, 2, 'lease and request must both use exclusive open');
    for (const [file, flags, mode] of createdFiles) {
      assert.ok((flags & fs.constants.O_EXCL) !== 0, `${file} missing O_EXCL`);
      assert.ok((flags & fs.constants.O_NOFOLLOW) !== 0, `${file} missing O_NOFOLLOW`);
      assert.equal(mode, 0o600, `${file} create mode must be 0600`);
    }
  } finally {
    fixture.cleanup();
  }
});

test('malformed session, request ID, and capability fail before any filesystem call', async () => {
  const accesses = [];
  const fixture = makeFixture({
    fsOps: tracingFs((operation, args) => accesses.push([operation, args[0]])),
  });
  try {
    for (const sessionId of ['', '../escape', 'contains space', 'é', 'x'.repeat(129)]) {
      accesses.length = 0;
      await assertRejected(
        () => fixture.broker.prepare({ sessionId }),
        'SESSION_UNAVAILABLE'
      );
      assert.deepEqual(accesses, [], `malformed session ${JSON.stringify(sessionId)} reached filesystem`);
    }

    const validIdentity = {
      sessionId: SESSION_A,
      requestId: '0'.repeat(32),
      capability: '1'.repeat(64),
    };
    for (const [field, values] of [
      ['requestId', ['', '../escape', 'A'.repeat(32), 'a'.repeat(31)]],
      ['capability', ['', '../escape', 'A'.repeat(64), 'a'.repeat(63)]],
    ]) {
      for (const value of values) {
        const identity = { ...validIdentity, [field]: value };
        for (const operation of ['consume', 'abort']) {
          accesses.length = 0;
          await assertRejected(
            () => fixture.broker[operation](identity, { parseRawArguments: value => value }),
            'INVALID_ENTRY_IDENTITY'
          );
          assert.deepEqual(accesses, [], `${operation} ${field} reached filesystem`);
        }
      }
    }
  } finally {
    fixture.cleanup();
  }
});

test('prepare twice never creates a second live slot and may reuse only an empty intact lease', async () => {
  const fixture = makeFixture();
  try {
    const first = await fixture.broker.prepare({ sessionId: SESSION_A });
    const before = snapshotTree(fixture.runtimeRoot);
    let second;
    const error = await captureError(async () => {
      second = await fixture.broker.prepare({ sessionId: SESSION_A });
    });
    if (error) {
      assert.equal(error.code, 'BROKER_BUSY');
    } else {
      assert.deepEqual(second, first, 'a live retry may return only the exact same empty slot');
    }
    assertTreeUnchanged(fixture.runtimeRoot, before, 'second prepare changed live slot');

    writeEnvelope(first, '--help');
    await assertRejected(
      () => fixture.broker.prepare({ sessionId: SESSION_A }),
      'BROKER_BUSY'
    );
  } finally {
    fixture.cleanup();
  }
});

test('sessions A and B prepare independently and B never enumerates or consumes A', async () => {
  const fixture = makeFixture();
  try {
    const [a, b] = await Promise.all([
      fixture.broker.prepare({ sessionId: SESSION_A }),
      fixture.broker.prepare({ sessionId: SESSION_B }),
    ]);
    assert.notEqual(sessionDirOf(a), sessionDirOf(b));
    assert.equal(path.basename(sessionDirOf(a)), sha256(SESSION_A));
    assert.equal(path.basename(sessionDirOf(b)), sha256(SESSION_B));
    writeEnvelope(a, '--help');
    writeEnvelope(b, '--status');
    const aBefore = snapshotTree(slotDirOf(a));
    const bBefore = snapshotTree(slotDirOf(b));
    let parsed = false;

    await assertRejected(
      () => fixture.broker.consume({
        sessionId: SESSION_B,
        requestId: a.requestId,
        capability: a.capability,
      }, {
        parseRawArguments() {
          parsed = true;
        },
      }),
      'NO_ENTRY_REQUEST'
    );
    assert.equal(parsed, false);
    assertTreeUnchanged(slotDirOf(a), aBefore, 'session B touched session A');
    assertTreeUnchanged(slotDirOf(b), bBefore, 'failed B lookup touched B current slot');
  } finally {
    fixture.cleanup();
  }
});

for (const kind of ['symlink', 'wrong-mode']) {
  for (const level of ['broker-root', 'session-directory', 'slot-directory']) {
    test(`${kind} ${level} is rejected before lease or request open and before claim`, async () => {
      const fixture = makeFixture();
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        writeEnvelope(prepared);
        const target = {
          'broker-root': brokerRootOf(prepared),
          'session-directory': sessionDirOf(prepared),
          'slot-directory': slotDirOf(prepared),
        }[level];

        if (kind === 'symlink') {
          const parked = `${target}.parked`;
          fs.renameSync(target, parked);
          fs.symlinkSync(parked, target, 'dir');
        } else {
          fs.chmodSync(target, 0o755);
        }

        const before = snapshotTree(fixture.runtimeRoot);
        const opened = [];
        const consumer = createRequestBroker({
          runtimeRoot: fixture.runtimeRoot,
          uid: UID,
          fsOps: tracingFs((operation, args) => {
            if (operation === 'openSync') opened.push(args[0]);
          }),
          nowMonotonicMs: () => fixture.clock.monotonicMs,
          nowWallMs: () => fixture.clock.wallMs,
          randomBytes: deterministicRandom(20),
          ttlMs: DEFAULT_TTL_MS,
        });
        await assertRejected(
          () => consumer.consume(identityOf(prepared), { parseRawArguments: value => value }),
          /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
        );
        assert.equal(opened.includes(leasePathOf(prepared)), false, 'lease opened before parent proof');
        assert.equal(opened.includes(prepared.requestPath), false, 'request opened before parent proof');
        assertTreeUnchanged(fixture.runtimeRoot, before, `${kind} ${level} rejection mutated tree`);
      } finally {
        fixture.cleanup();
      }
    });
  }
}

for (const level of ['broker-root', 'session-directory', 'slot-directory']) {
  test(`wrong-owner ${level} is rejected before either broker file opens`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared);
      const target = {
        'broker-root': brokerRootOf(prepared),
        'session-directory': sessionDirOf(prepared),
        'slot-directory': slotDirOf(prepared),
      }[level];
      const opened = [];
      const fakeOwnerFs = tracingFs((operation, args) => {
        if (operation === 'openSync') opened.push(args[0]);
      });
      const ownerProxy = new Proxy(fakeOwnerFs, {
        get(fsTarget, property, receiver) {
          if (property !== 'lstatSync') return Reflect.get(fsTarget, property, receiver);
          return file => {
            const stat = fs.lstatSync(file);
            if (file !== target) return stat;
            return new Proxy(stat, {
              get(statTarget, statProperty, statReceiver) {
                if (statProperty === 'uid') return UID + 1;
                return Reflect.get(statTarget, statProperty, statReceiver);
              },
            });
          };
        },
      });
      const consumer = createRequestBroker({
        runtimeRoot: fixture.runtimeRoot,
        uid: UID,
        fsOps: ownerProxy,
        nowMonotonicMs: () => fixture.clock.monotonicMs,
        nowWallMs: () => fixture.clock.wallMs,
        randomBytes: deterministicRandom(30),
        ttlMs: DEFAULT_TTL_MS,
      });
      const before = snapshotTree(fixture.runtimeRoot);
      await assertRejected(
        () => consumer.consume(identityOf(prepared), { parseRawArguments: value => value }),
        'BROKER_CORRUPT'
      );
      assert.equal(opened.includes(leasePathOf(prepared)), false);
      assert.equal(opened.includes(prepared.requestPath), false);
      assertTreeUnchanged(fixture.runtimeRoot, before, `wrong owner ${level} mutated tree`);
    } finally {
      fixture.cleanup();
    }
  });
}

test('lease and request opens use O_NOFOLLOW; request symlink is preserved and never parsed', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    const external = path.join(fixture.runtimeRoot, 'external-request.json');
    const externalBytes = Buffer.from(`${JSON.stringify(envelopeFor(prepared, '--help'))}\n`);
    fs.writeFileSync(external, externalBytes, { mode: 0o600 });
    fs.rmSync(prepared.requestPath);
    fs.symlinkSync(external, prepared.requestPath);
    const opens = [];
    const consumer = createRequestBroker({
      runtimeRoot: fixture.runtimeRoot,
      uid: UID,
      fsOps: tracingFs((operation, args) => {
        if (operation === 'openSync') opens.push(args);
      }),
      nowMonotonicMs: () => fixture.clock.monotonicMs,
      nowWallMs: () => fixture.clock.wallMs,
      randomBytes: deterministicRandom(40),
      ttlMs: DEFAULT_TTL_MS,
    });
    let parsed = false;
    const before = snapshotTree(fixture.runtimeRoot);
    await assertRejected(
      () => consumer.consume(identityOf(prepared), {
        parseRawArguments() { parsed = true; },
      }),
      /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
    );
    assert.equal(parsed, false);
    assertNoClaim(prepared);
    assertTreeUnchanged(fixture.runtimeRoot, before, 'request symlink rejection mutated tree');
    assert.deepEqual(fs.readFileSync(external), externalBytes);
    for (const [file, flags] of opens.filter(([file]) =>
      file === leasePathOf(prepared) || file === prepared.requestPath
    )) {
      assert.equal(typeof flags, 'number', `${file} must use numeric no-follow flags`);
      assert.ok((flags & fs.constants.O_NOFOLLOW) !== 0, `${file} missing O_NOFOLLOW`);
    }
  } finally {
    fixture.cleanup();
  }
});

test('exact 0600 file mode and current owner are required before identity can authorize claim', async () => {
  for (const targetName of ['lease', 'request']) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared);
      const target = targetName === 'lease' ? leasePathOf(prepared) : prepared.requestPath;
      fs.chmodSync(target, 0o640);
      const before = snapshotTree(fixture.runtimeRoot);
      let parsed = false;
      await assertRejected(
        () => fixture.broker.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false);
      assertNoClaim(prepared);
      assertTreeUnchanged(fixture.runtimeRoot, before, `${targetName} wrong mode mutated tree`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('well-formed incorrect argv request or capability fails before claim and preserves the slot', async () => {
  for (const override of [
    { requestId: ALT_REQUEST_ID },
    { capability: ALT_CAPABILITY },
  ]) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared);
      const before = snapshotTree(slotDirOf(prepared));
      let parsed = false;
      await assertRejected(
        () => fixture.broker.consume({ ...identityOf(prepared), ...override }, {
          parseRawArguments() { parsed = true; },
        }),
        /ENTRY_IDENTITY_MISMATCH|NO_ENTRY_REQUEST|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false);
      assertNoClaim(prepared);
      assertTreeUnchanged(slotDirOf(prepared), before, 'well-formed argv mismatch changed slot');
    } finally {
      fixture.cleanup();
    }
  }
});

test('argv, lease, and envelope identity must all agree before mutation', async () => {
  const cases = [
    ['lease requestId', 'lease', { requestId: ALT_REQUEST_ID }],
    ['lease capability', 'lease', { capability: ALT_CAPABILITY }],
    ['envelope sessionId', 'envelope', { sessionId: SESSION_B }],
    ['envelope requestId', 'envelope', { requestId: ALT_REQUEST_ID }],
    ['envelope capability', 'envelope', { capability: ALT_CAPABILITY }],
  ];
  for (const [label, side, override] of cases) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      if (side === 'lease') {
        writeLease(prepared, { ...readLease(prepared), ...override });
        writeEnvelope(prepared);
      } else {
        writeEnvelope(prepared, '--help', override);
      }
      const before = snapshotTree(slotDirOf(prepared));
      let parsed = false;
      await assertRejected(
        () => fixture.broker.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        /ENTRY_IDENTITY_MISMATCH|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false, `${label} reached parser`);
      assertNoClaim(prepared);
      assertTreeUnchanged(slotDirOf(prepared), before, `${label} changed slot`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('envelope-only capability mismatch preserves slot and all project, Git, and run sentinels', async () => {
  const fixture = makeFixture();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-project-sentinel-'));
  try {
    fs.mkdirSync(path.join(project, '.git'));
    fs.mkdirSync(path.join(project, '.soma'));
    fs.writeFileSync(path.join(project, '.git', 'index'), Buffer.from([0, 1, 2, 255]));
    fs.writeFileSync(path.join(project, '.soma', 'run-state.json'), 'run sentinel\n');
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, `--status --project ${project}`, { capability: ALT_CAPABILITY });
    const slotBefore = snapshotTree(slotDirOf(prepared));
    const projectBefore = snapshotTree(project);
    let parsed = false;

    await assertRejected(
      () => fixture.broker.consume(identityOf(prepared), {
        parseRawArguments() { parsed = true; },
      }),
      /ENTRY_IDENTITY_MISMATCH|INVALID_ENTRY_REQUEST/
    );
    assert.equal(parsed, false);
    assertNoClaim(prepared);
    assertTreeUnchanged(slotDirOf(prepared), slotBefore, 'envelope-only mismatch removed diagnostic slot');
    assertTreeUnchanged(project, projectBefore, 'envelope-only mismatch touched project/Git/run');
  } finally {
    fixture.cleanup();
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('exactly one same-session consumer wins the O_EXCL atomic claim', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    const childSource = String.raw`
      'use strict';
      const { createRequestBroker } = require(process.argv[1]);
      const identity = JSON.parse(process.argv[3]);
      const broker = createRequestBroker({ runtimeRoot: process.argv[2] });
      (async () => {
        try {
          const value = await broker.consume(identity, {
            parseRawArguments: async raw => {
              await new Promise(resolve => setTimeout(resolve, 200));
              return { raw };
            },
          });
          process.stdout.write(JSON.stringify({ ok: true, value }) + '\n');
        } catch (error) {
          process.stdout.write(JSON.stringify({ ok: false, code: error.code, message: error.message }) + '\n');
        }
      })();
    `;
    const args = [BROKER_MODULE, fixture.runtimeRoot, JSON.stringify(identityOf(prepared))];
    const workers = [spawnJsonChild(childSource, args), spawnJsonChild(childSource, args)];
    const results = await Promise.all(workers.map(worker => worker.result));
    assert.equal(results.filter(result => result.value.ok).length, 1, JSON.stringify(results));
    const loser = results.find(result => !result.value.ok);
    assert.match(loser.value.code, /REQUEST_ALREADY_CONSUMED|BROKER_BUSY|NO_ENTRY_REQUEST/);
    assert.equal(fs.existsSync(slotDirOf(prepared)), false, 'winner cleanup left consumed slot');
  } finally {
    fixture.cleanup();
  }
});

test('replay never parses or authorizes a consumed request', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    const first = await fixture.broker.consume(identityOf(prepared), {
      parseRawArguments: raw => ({ raw }),
    });
    assert.equal(first.rawArguments || first.parsed?.raw || first.raw, '--help');
    let replayParsed = false;
    await assertRejected(
      () => fixture.broker.consume(identityOf(prepared), {
        parseRawArguments() { replayParsed = true; },
      }),
      /REQUEST_ALREADY_CONSUMED|NO_ENTRY_REQUEST/
    );
    assert.equal(replayParsed, false);
  } finally {
    fixture.cleanup();
  }
});

for (const drift of ['same-size-bytes', 'size', 'inode']) {
  test(`post-claim canonical reopen detects ${drift} drift before parsing and cleans only its slot`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      const sibling = await fixture.broker.prepare({ sessionId: SESSION_B });
      const original = writeEnvelope(prepared, '--help');
      writeEnvelope(sibling, '--status');
      const siblingBefore = snapshotTree(slotDirOf(sibling));
      let swapped = false;
      const swapFs = tracingFs((operation, args) => {
        if (swapped || operation !== 'openSync' || path.basename(args[0]) !== 'claim') return;
        swapped = true;
        if (drift === 'same-size-bytes') {
          writeEnvelope(prepared, '--held');
        } else if (drift === 'size') {
          writeEnvelope(prepared, '--help with extra bytes');
        } else {
          const replacement = `${prepared.requestPath}.replacement`;
          fs.writeFileSync(replacement, `${JSON.stringify(original)}\n`, { mode: 0o600 });
          fs.renameSync(replacement, prepared.requestPath);
        }
      });
      const consumer = createRequestBroker({
        runtimeRoot: fixture.runtimeRoot,
        uid: UID,
        fsOps: swapFs,
        nowMonotonicMs: () => fixture.clock.monotonicMs,
        nowWallMs: () => fixture.clock.wallMs,
        randomBytes: deterministicRandom(50),
        ttlMs: DEFAULT_TTL_MS,
      });
      let parsed = false;
      await assertRejected(
        () => consumer.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        'INVALID_ENTRY_REQUEST'
      );
      assert.equal(swapped, true, `${drift} fault did not occur at claim boundary`);
      assert.equal(parsed, false, `${drift} reached rawArguments parser`);
      assert.equal(fs.existsSync(slotDirOf(prepared)), false, 'claimed drifted slot was not cleaned');
      assertTreeUnchanged(slotDirOf(sibling), siblingBefore, `${drift} cleanup touched sibling slot`);
    } finally {
      fixture.cleanup();
    }
  });
}

test('post-claim reopen compares device as well as bytes, inode, size, and hash', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    const requestDescriptors = new Set();
    let requestOpenCount = 0;
    const devDriftFs = new Proxy(fs, {
      get(target, property, receiver) {
        if (property === 'openSync') {
          return (file, flags, mode) => {
            const descriptor = fs.openSync(file, flags, mode);
            if (file === prepared.requestPath) {
              requestOpenCount += 1;
              if (requestOpenCount >= 2) requestDescriptors.add(descriptor);
            }
            return descriptor;
          };
        }
        if (property === 'fstatSync') {
          return descriptor => {
            const stat = fs.fstatSync(descriptor);
            if (!requestDescriptors.has(descriptor)) return stat;
            return new Proxy(stat, {
              get(statTarget, statProperty, statReceiver) {
                if (statProperty === 'dev') return stat.dev + 1;
                return Reflect.get(statTarget, statProperty, statReceiver);
              },
            });
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const consumer = createRequestBroker({
      runtimeRoot: fixture.runtimeRoot,
      uid: UID,
      fsOps: devDriftFs,
      nowMonotonicMs: () => fixture.clock.monotonicMs,
      nowWallMs: () => fixture.clock.wallMs,
      randomBytes: deterministicRandom(60),
      ttlMs: DEFAULT_TTL_MS,
    });
    let parsed = false;
    await assertRejected(
      () => consumer.consume(identityOf(prepared), {
        parseRawArguments() { parsed = true; },
      }),
      'INVALID_ENTRY_REQUEST'
    );
    assert.ok(requestOpenCount >= 2, 'consume reused the pre-claim descriptor');
    assert.equal(parsed, false);
    assert.equal(fs.existsSync(slotDirOf(prepared)), false);
  } finally {
    fixture.cleanup();
  }
});

test('parser receives exact bytes from the new opening and hostile rawArguments remain inert data', async () => {
  const fixture = makeFixture();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-hostile-project-'));
  try {
    fs.writeFileSync(path.join(project, 'sentinel.txt'), 'project sentinel\n');
    const shellSentinel = path.join(project, 'MUST_NOT_EXIST');
    const rawArguments = `"objective $(touch '${shellSentinel}')" --project '${project}' ; echo nope | cat\n` +
      '`touch another-sentinel` "quoted \\" text"';
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, rawArguments);
    const projectBefore = snapshotTree(project);
    const requestOpens = [];
    const consumer = createRequestBroker({
      runtimeRoot: fixture.runtimeRoot,
      uid: UID,
      fsOps: tracingFs((operation, args) => {
        if (operation === 'openSync' && args[0] === prepared.requestPath) requestOpens.push(args[1]);
      }),
      nowMonotonicMs: () => fixture.clock.monotonicMs,
      nowWallMs: () => fixture.clock.wallMs,
      randomBytes: deterministicRandom(70),
      ttlMs: DEFAULT_TTL_MS,
    });
    let parserInput;
    const result = await consumer.consume(identityOf(prepared), {
      parseRawArguments(raw) {
        parserInput = raw;
        return { mode: 'start', raw };
      },
    });
    assert.equal(parserInput, rawArguments);
    assert.equal(result.requestSha256, sha256(Buffer.from(`${JSON.stringify(envelopeFor(prepared, rawArguments))}\n`)));
    assert.ok(requestOpens.length >= 2, 'consume did not reopen request after claim');
    assert.equal(fs.existsSync(shellSentinel), false, 'hostile rawArguments executed');
    assertTreeUnchanged(project, projectBefore, 'rawArguments parser mutated project/Git/run');
    assert.equal(fs.existsSync(slotDirOf(prepared)), false, 'successful consume did not clean slot');
  } finally {
    fixture.cleanup();
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('consume error cleans its authenticated claimed slot in finally and leaves siblings intact', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    const sibling = await fixture.broker.prepare({ sessionId: SESSION_B });
    writeEnvelope(prepared, '--help');
    writeEnvelope(sibling, '--status');
    const siblingBefore = snapshotTree(slotDirOf(sibling));
    await assertRejected(
      () => fixture.broker.consume(identityOf(prepared), {
        parseRawArguments() {
          const error = new Error('injected parser failure');
          error.code = 'INJECTED_PARSE_FAILURE';
          throw error;
        },
      }),
      'INJECTED_PARSE_FAILURE'
    );
    assert.equal(fs.existsSync(slotDirOf(prepared)), false);
    assertTreeUnchanged(slotDirOf(sibling), siblingBefore, 'consume finally touched sibling');
  } finally {
    fixture.cleanup();
  }
});

test('abort validates argv against lease without parsing envelope and is idempotent after cleanup', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    fs.writeFileSync(prepared.requestPath, '{ invalid envelope by design', { mode: 0o600 });
    fs.chmodSync(prepared.requestPath, 0o600);
    const mismatchedBefore = snapshotTree(slotDirOf(prepared));
    await assertRejected(
      () => fixture.broker.abort({ ...identityOf(prepared), capability: ALT_CAPABILITY }),
      /ENTRY_IDENTITY_MISMATCH|INVALID_ENTRY_REQUEST/
    );
    assertTreeUnchanged(slotDirOf(prepared), mismatchedBefore, 'unauthorized abort removed slot');
    assertNoClaim(prepared);

    const first = await fixture.broker.abort(identityOf(prepared));
    assert.ok(first.status === 'aborted' || first.aborted === true);
    assert.equal(fs.existsSync(slotDirOf(prepared)), false);
    const second = await fixture.broker.abort(identityOf(prepared));
    assert.ok(second.status === 'absent' || second.status === 'aborted' || second.aborted === false);
    assert.equal(fs.existsSync(slotDirOf(prepared)), false);
  } finally {
    fixture.cleanup();
  }
});

test('monotonic expiry cannot be extended by wall-clock adjustment', async () => {
  const live = makeFixture();
  try {
    const prepared = await live.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    live.clock.wallMs += 365 * 24 * 60 * 60 * 1000;
    const result = await live.broker.consume(identityOf(prepared), {
      parseRawArguments: raw => raw,
    });
    assert.equal(result.rawArguments || result.parsed || result.raw, '--help');
  } finally {
    live.cleanup();
  }

  const expired = makeFixture();
  try {
    const prepared = await expired.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    expired.clock.monotonicMs = readLease(prepared).expiresMonotonicMs + 1;
    expired.clock.wallMs -= 365 * 24 * 60 * 60 * 1000;
    let parsed = false;
    await assertRejected(
      () => expired.broker.consume(identityOf(prepared), {
        parseRawArguments() { parsed = true; },
      }),
      'INVALID_ENTRY_REQUEST'
    );
    assert.equal(parsed, false);
    assert.equal(fs.existsSync(slotDirOf(prepared)), true, 'expired pre-claim evidence should await scavenging');
    assertNoClaim(prepared);
  } finally {
    expired.cleanup();
  }
});

test('host SIGKILL after prepare leaves one inert bounded slot and no project authority', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-crash-runtime-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-crash-project-'));
  fs.chmodSync(runtimeRoot, 0o700);
  try {
    fs.writeFileSync(path.join(project, 'sentinel'), 'project bytes\n');
    const projectBefore = snapshotTree(project);
    const source = String.raw`
      'use strict';
      const { createRequestBroker } = require(process.argv[1]);
      const broker = createRequestBroker({ runtimeRoot: process.argv[2] });
      (async () => {
        const prepared = await broker.prepare({ sessionId: process.argv[3] });
        process.stdout.write(JSON.stringify(prepared) + '\n');
        setInterval(() => {}, 1000);
      })().catch(error => {
        process.stdout.write(JSON.stringify({ error: error.code, message: error.message }) + '\n');
      });
    `;
    const worker = spawnJsonChild(source, [BROKER_MODULE, runtimeRoot, SESSION_A]);
    let prepared;
    worker.child.stdout.on('data', chunk => {
      const line = String(chunk).trim().split('\n')[0];
      if (line && !prepared) {
        try { prepared = JSON.parse(line); } catch (_error) { /* wait for complete line */ }
      }
    });
    const readyDeadline = Date.now() + 5_000;
    while (!prepared && Date.now() < readyDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(prepared?.requestPath, 'prepare child did not publish slot');
    worker.child.kill('SIGKILL');
    const childResult = await worker.result;
    assert.equal(childResult.signal, 'SIGKILL');
    assert.equal(fs.existsSync(slotDirOf(prepared)), true, 'host death removed inert residue unexpectedly');
    const lease = readLease(prepared);
    assert.ok(lease.ttlMs > 0 && lease.ttlMs <= MAX_TTL_MS);
    assert.equal(fs.existsSync(claimPathOf(prepared)), false);
    assert.equal(fs.readFileSync(prepared.requestPath).length, 0);
    assertTreeUnchanged(project, projectBefore, 'prepare-only crash touched project');
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('next prepare atomically rename-claims and removes only a valid expired slot before R2', async () => {
  const events = [];
  const clock = makeClock();
  const fixture = makeFixture({
    clock,
    fsOps: tracingFs((operation, args) => {
      if (operation === 'renameSync' || operation === 'rmSync' || operation === 'mkdirSync') {
        events.push([operation, ...args]);
      }
    }),
  });
  try {
    const r1 = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(r1, '--help');
    clock.monotonicMs = readLease(r1).expiresMonotonicMs + 1;
    events.length = 0;
    const r2 = await fixture.broker.prepare({ sessionId: SESSION_A });
    assert.notEqual(r2.requestId, r1.requestId);
    assert.equal(fs.existsSync(slotDirOf(r1)), false);
    assert.equal(fs.existsSync(slotDirOf(r2)), true);
    const renameIndex = events.findIndex(([operation, from]) =>
      operation === 'renameSync' && from === slotDirOf(r1)
    );
    assert.ok(renameIndex >= 0, 'expired R1 was not atomically rename-claimed');
    const cleanupPath = events[renameIndex][2];
    const removeIndex = events.findIndex(([operation, target]) =>
      operation === 'rmSync' && target === cleanupPath
    );
    assert.ok(removeIndex > renameIndex, 'cleanup removal did not follow rename claim');
    assert.equal(fs.existsSync(cleanupPath), false);
  } finally {
    fixture.cleanup();
  }
});

for (const corruption of ['invalid-schema', 'wrong-mode', 'symlink']) {
  test(`expired ${corruption} residue returns BROKER_CORRUPT and is never scavenged`, async () => {
    const fixture = makeFixture();
    try {
      const r1 = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(r1, '--help');
      fixture.clock.monotonicMs = readLease(r1).expiresMonotonicMs + 1;
      if (corruption === 'invalid-schema') {
        fs.writeFileSync(leasePathOf(r1), '{ invalid lease', { mode: 0o600 });
      } else if (corruption === 'wrong-mode') {
        fs.chmodSync(leasePathOf(r1), 0o640);
      } else {
        const external = path.join(fixture.runtimeRoot, 'external-lease');
        fs.renameSync(leasePathOf(r1), external);
        fs.symlinkSync(external, leasePathOf(r1));
      }
      const before = snapshotTree(fixture.runtimeRoot);
      await assertRejected(
        () => fixture.broker.prepare({ sessionId: SESSION_A }),
        'BROKER_CORRUPT'
      );
      assertTreeUnchanged(fixture.runtimeRoot, before, `${corruption} residue was removed or replaced`);
    } finally {
      fixture.cleanup();
    }
  });
}

test('expired wrong-owner residue is diagnostic evidence and is not scavenged', async () => {
  const fixture = makeFixture();
  try {
    const r1 = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(r1, '--help');
    fixture.clock.monotonicMs = readLease(r1).expiresMonotonicMs + 1;
    const target = leasePathOf(r1);
    const wrongOwnerFs = new Proxy(fs, {
      get(fsTarget, property, receiver) {
        if (property !== 'lstatSync') return Reflect.get(fsTarget, property, receiver);
        return file => {
          const stat = fs.lstatSync(file);
          if (file !== target) return stat;
          return new Proxy(stat, {
            get(statTarget, statProperty, statReceiver) {
              if (statProperty === 'uid') return UID + 1;
              return Reflect.get(statTarget, statProperty, statReceiver);
            },
          });
        };
      },
    });
    const broker = createRequestBroker({
      runtimeRoot: fixture.runtimeRoot,
      uid: UID,
      fsOps: wrongOwnerFs,
      nowMonotonicMs: () => fixture.clock.monotonicMs,
      nowWallMs: () => fixture.clock.wallMs,
      randomBytes: deterministicRandom(90),
      ttlMs: DEFAULT_TTL_MS,
    });
    const before = snapshotTree(fixture.runtimeRoot);
    await assertRejected(() => broker.prepare({ sessionId: SESSION_A }), 'BROKER_CORRUPT');
    assertTreeUnchanged(fixture.runtimeRoot, before, 'wrong-owner residue was scavenged');
  } finally {
    fixture.cleanup();
  }
});

test('delayed R1 consume and abort cannot claim, parse, or remove replacement R2', async () => {
  const fixture = makeFixture();
  try {
    const r1 = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(r1, '--help');
    fixture.clock.monotonicMs = readLease(r1).expiresMonotonicMs + 1;
    const r2 = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(r2, '--status');
    const r2Before = snapshotTree(slotDirOf(r2));
    let parsed = false;
    await assertRejected(
      () => fixture.broker.consume(identityOf(r1), {
        parseRawArguments() { parsed = true; },
      }),
      /NO_ENTRY_REQUEST|REQUEST_ALREADY_CONSUMED|ENTRY_IDENTITY_MISMATCH/
    );
    assert.equal(parsed, false);
    assertTreeUnchanged(slotDirOf(r2), r2Before, 'delayed R1 consume touched R2');

    const abortResult = await fixture.broker.abort(identityOf(r1));
    assert.ok(abortResult.status === 'absent' || abortResult.aborted === false);
    assertTreeUnchanged(slotDirOf(r2), r2Before, 'delayed R1 abort touched R2');
  } finally {
    fixture.cleanup();
  }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`${signal} during a claimed consume runs the same idempotent cleanup`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared, '--help');
      const ready = path.join(fixture.runtimeRoot, `${signal}.ready`);
      const childSource = String.raw`
        'use strict';
        const fs = require('node:fs');
        const { createRequestBroker } = require(process.argv[1]);
        const identity = JSON.parse(process.argv[3]);
        const broker = createRequestBroker({ runtimeRoot: process.argv[2] });
        broker.consume(identity, {
          parseRawArguments: async raw => {
            fs.writeFileSync(process.argv[4], raw, { flag: 'wx' });
            await new Promise(() => {});
          },
        }).catch(error => {
          process.stdout.write(JSON.stringify({ ok: false, code: error.code, message: error.message }) + '\n');
        });
      `;
      const child = spawn(process.execPath, [
        '-e',
        childSource,
        BROKER_MODULE,
        fixture.runtimeRoot,
        JSON.stringify(identityOf(prepared)),
        ready,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; });
      const exit = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${signal} child timed out: ${stderr}`));
        }, CHILD_TIMEOUT_MS);
        child.once('error', error => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code, childSignal) => {
          clearTimeout(timer);
          resolve({ code, signal: childSignal });
        });
      });
      await waitForPath(ready);
      assert.equal(fs.existsSync(claimPathOf(prepared)), true, 'parser ran before atomic claim');
      child.kill(signal);
      const result = await exit;
      assert.ok(result.signal === signal || Number.isInteger(result.code), `unexpected child exit ${JSON.stringify(result)}`);
      assert.equal(fs.existsSync(slotDirOf(prepared)), false, `${signal} left claimed slot`);
      const again = await fixture.broker.abort(identityOf(prepared));
      assert.ok(again.status === 'absent' || again.aborted === false);
    } finally {
      fixture.cleanup();
    }
  });
}
