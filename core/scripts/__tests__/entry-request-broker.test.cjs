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
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
} = require('./helpers/run-identity-fixture.cjs');

const BROKER_MODULE = path.join(__dirname, '..', 'entry', 'request-broker.cjs');
const ENTRY_MODULE = path.join(__dirname, '..', 'entry.cjs');
const SOMA_MODULE = path.join(__dirname, '..', 'soma.cjs');

const {
  createRequestBroker,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
} = require(BROKER_MODULE);
const {
  MAX_RAW_ARGUMENT_BYTES,
} = require(path.join(__dirname, '..', 'entry', 'request-schema.cjs'));
const { parseInvocation, runEntry } = require(ENTRY_MODULE);

const UID = typeof process.getuid === 'function' ? process.getuid() : 0;
const SESSION_A = 'claude-session-A';
const SESSION_B = 'claude-session-B';
const ALT_REQUEST_ID = 'fedcba9876543210fedcba9876543210';
const ALT_CAPABILITY = 'fedcba9876543210'.repeat(4);
const CHILD_TIMEOUT_MS = 10_000;
const PREPARE_CLAIM_SCHEMA = 'soma-entry-prepare-claim/v1';

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

function tracingFs(onCall, onResult = () => {}) {
  function wrap(target, api) {
    return new Proxy(target, {
      get(object, property, receiver) {
        if (api === 'sync' && property === 'promises') return wrap(fs.promises, 'promises');
        const value = Reflect.get(object, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args) => {
          onCall(property, args, api);
          const result = Reflect.apply(value, object, args);
          if (result && typeof result.then === 'function') {
            return result.then(resolved => {
              onResult(property, args, api, resolved);
              return resolved;
            });
          }
          onResult(property, args, api, result);
          return result;
        };
      },
    });
  }
  return wrap(fs, 'sync');
}

function withRealpathOverride(baseFs, targetPath, resolveReplacement) {
  return new Proxy(baseFs, {
    get(target, property, receiver) {
      if (property === 'realpathSync') {
        return (file, ...args) => {
          const actual = Reflect.apply(target.realpathSync, target, [file, ...args]);
          return file === targetPath ? resolveReplacement(actual) : actual;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function processRun(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
  });
}

function exactSessionShape(prepared) {
  return [
    ['.', 'directory'],
    [prepared.requestId, 'directory'],
    [path.join(prepared.requestId, 'lease.json'), 'file'],
    [path.join(prepared.requestId, 'request.json'), 'file'],
  ];
}

function operationIs(operation, semanticName) {
  return operation === semanticName || operation === `${semanticName}Sync`;
}

function isOpenOf(operation, args, expectedPath) {
  return operationIs(operation, 'open') && args[0] === expectedPath;
}

function spoofStat(stat, overrides) {
  return new Proxy(stat, {
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      return Reflect.get(target, property, receiver);
    },
  });
}

function withStatIdentityOverride(baseFs, expectedPath, transform) {
  const descriptorPaths = new Map();

  function transformed(file, stat) {
    return file === expectedPath ? transform(stat) : stat;
  }

  function wrapFileHandle(handle, file) {
    if (file !== expectedPath) return handle;
    return new Proxy(handle, {
      get(target, property, receiver) {
        if (property === 'stat') {
          return async (...args) => transform(await target.stat(...args));
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const promises = new Proxy(baseFs.promises, {
    get(target, property, receiver) {
      if (property === 'lstat' || property === 'stat') {
        return async (file, ...args) => transformed(
          file,
          await Reflect.apply(target[property], target, [file, ...args])
        );
      }
      if (property === 'open') {
        return async (file, ...args) => wrapFileHandle(
          await Reflect.apply(target.open, target, [file, ...args]),
          file
        );
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new Proxy(baseFs, {
    get(target, property, receiver) {
      if (property === 'promises') return promises;
      if (property === 'lstatSync' || property === 'statSync') {
        return (file, ...args) => transformed(
          file,
          Reflect.apply(target[property], target, [file, ...args])
        );
      }
      if (property === 'openSync') {
        return (file, ...args) => {
          const descriptor = Reflect.apply(target.openSync, target, [file, ...args]);
          descriptorPaths.set(descriptor, file);
          return descriptor;
        };
      }
      if (property === 'fstatSync') {
        return (descriptor, ...args) => transformed(
          descriptorPaths.get(descriptor),
          Reflect.apply(target.fstatSync, target, [descriptor, ...args])
        );
      }
      if (property === 'closeSync') {
        return descriptor => {
          try {
            return Reflect.apply(target.closeSync, target, [descriptor]);
          } finally {
            descriptorPaths.delete(descriptor);
          }
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function brokerChain(prepared, runtimeRoot) {
  return [
    runtimeRoot,
    path.join(runtimeRoot, 'soma-entry'),
    brokerRootOf(prepared),
    sessionDirOf(prepared),
    slotDirOf(prepared),
  ];
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

function prepareClaimPath(sessionDir) {
  return path.join(sessionDir, '.prepare.claim');
}

function prepareClaimEvidence({
  prepared,
  sessionId = prepared?.sessionId || SESSION_A,
  requestId = prepared?.requestId || ALT_REQUEST_ID,
  capability = prepared?.capability || ALT_CAPABILITY,
  requestPath = prepared?.requestPath,
  createdMonotonicMs = 1_000,
  ttlMs = DEFAULT_TTL_MS,
  ...overrides
} = {}) {
  if (typeof requestPath !== 'string') {
    throw new TypeError('prepare claim fixture requires requestPath');
  }
  return {
    $schema: PREPARE_CLAIM_SCHEMA,
    sessionId,
    requestId,
    capability,
    requestPath,
    ttlMs,
    createdMonotonicMs,
    expiresMonotonicMs: createdMonotonicMs + ttlMs,
    ...overrides,
  };
}

function writeOwnerOnlyJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
}

function brokerForFixture(fixture, options = {}) {
  return createRequestBroker({
    runtimeRoot: fixture.runtimeRoot,
    uid: UID,
    fsOps: options.fsOps || fs,
    nowMonotonicMs: () => fixture.clock.monotonicMs,
    nowWallMs: () => fixture.clock.wallMs,
    randomBytes: options.randomBytes || deterministicRandom(110),
    ttlMs: options.ttlMs === undefined ? DEFAULT_TTL_MS : options.ttlMs,
  });
}

function afterClaimCloseFs(prepared, onBoundary, onCall = () => {}) {
  let claimDescriptor;
  return tracingFs(
    onCall,
    (operation, args, _api, result) => {
      if (operationIs(operation, 'open') && args[0] === claimPathOf(prepared)) {
        claimDescriptor = result;
      }
      if (claimDescriptor !== undefined && operationIs(operation, 'close') && args[0] === claimDescriptor) {
        claimDescriptor = undefined;
        onBoundary();
      }
    }
  );
}

function createPreparedSlot(sessionDir, evidence) {
  const slotDir = path.join(sessionDir, evidence.requestId);
  const requestPath = path.join(slotDir, 'request.json');
  fs.mkdirSync(slotDir, { mode: 0o700 });
  fs.chmodSync(slotDir, 0o700);
  writeOwnerOnlyJson(path.join(slotDir, 'lease.json'), {
    $schema: 'soma-entry-lease/v1',
    sessionId: evidence.sessionId,
    requestId: evidence.requestId,
    capability: evidence.capability,
    requestPath,
    ttlMs: evidence.ttlMs,
    createdMonotonicMs: evidence.createdMonotonicMs,
    expiresMonotonicMs: evidence.expiresMonotonicMs,
  });
  fs.writeFileSync(requestPath, '', { mode: 0o600, flag: 'wx' });
  fs.chmodSync(requestPath, 0o600);
  return { ...evidence, requestPath };
}

test('prepare hashes the native session, creates exact owner-only layout, and emits a minimal lease', async () => {
  const opens = [];
  const fixture = makeFixture({
    fsOps: tracingFs((operation, args, api) => {
      if (operationIs(operation, 'open')) opens.push({ args, api });
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

    const createdFiles = opens.filter(({ args: [file, flags] }) =>
      [leasePathOf(prepared), prepared.requestPath].includes(file) &&
      typeof flags === 'number' &&
      (flags & fs.constants.O_CREAT) !== 0
    );
    assert.equal(createdFiles.length, 2, 'lease and request must both use exclusive open');
    for (const { args: [file, flags, mode] } of createdFiles) {
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

for (const [evidence, plant] of [
  ['nested prepare claim', prepared => writeOwnerOnlyJson(
    path.join(slotDirOf(prepared), '.prepare.claim'),
    prepareClaimEvidence({ prepared })
  )],
  ['unknown file', prepared => fs.writeFileSync(
    path.join(slotDirOf(prepared), 'unexpected-evidence'),
    'diagnostic bytes\n',
    { mode: 0o600, flag: 'wx' }
  )],
  ['unknown directory', prepared => fs.mkdirSync(
    path.join(slotDirOf(prepared), 'unexpected-evidence'),
    { mode: 0o700 }
  )],
]) {
  test(`live empty slot with ${evidence} is corrupt, preserved, and never reused`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      plant(prepared);
      const before = snapshotTree(slotDirOf(prepared));
      const error = await captureError(
        () => fixture.broker.prepare({ sessionId: SESSION_A })
      );
      assert.equal(error?.code, 'BROKER_CORRUPT', `${evidence} returned the old live identity`);
      assertTreeUnchanged(slotDirOf(prepared), before, `${evidence} live slot changed on rejection`);
    } finally {
      fixture.cleanup();
    }
  });
}

test('live slot with an authenticated consume claim returns BROKER_BUSY unchanged', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeOwnerOnlyJson(claimPathOf(prepared), identityOf(prepared));
    const before = snapshotTree(slotDirOf(prepared));
    const error = await captureError(
      () => fixture.broker.prepare({ sessionId: SESSION_A })
    );
    assert.equal(error?.code, 'BROKER_BUSY', 'claimed live slot returned its consumed identity');
    assertTreeUnchanged(slotDirOf(prepared), before, 'claimed live slot changed while reporting busy');
  } finally {
    fixture.cleanup();
  }
});

for (const lifetime of ['live', 'expired']) {
  for (const corruption of ['malformed-claim', 'foreign-claim']) {
    test(`${lifetime} slot with ${corruption} is BROKER_CORRUPT and preserved`, async () => {
      const fixture = makeFixture();
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        if (corruption === 'malformed-claim') {
          fs.writeFileSync(claimPathOf(prepared), '{ malformed consume claim', {
            mode: 0o600,
            flag: 'wx',
          });
        } else {
          writeOwnerOnlyJson(claimPathOf(prepared), {
            ...identityOf(prepared),
            capability: ALT_CAPABILITY,
          });
        }
        if (lifetime === 'expired') {
          fixture.clock.monotonicMs = readLease(prepared).expiresMonotonicMs + 1;
        }
        const before = snapshotTree(slotDirOf(prepared));
        const error = await captureError(
          () => fixture.broker.prepare({ sessionId: SESSION_A })
        );
        assert.equal(error?.code, 'BROKER_CORRUPT', `${lifetime} ${corruption} was accepted`);
        assertTreeUnchanged(
          slotDirOf(prepared),
          before,
          `${lifetime} ${corruption} changed during rejection`
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
}

test('live empty request inode swapped during reuse inspection fails closed and is preserved', async () => {
  const fixture = makeFixture();
  const exchange = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-reuse-swap-'));
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    const replacement = path.join(exchange, 'replacement-request');
    const parked = path.join(exchange, 'authenticated-request');
    fs.writeFileSync(replacement, '', { mode: 0o600, flag: 'wx' });
    fs.chmodSync(replacement, 0o600);
    let swapped = false;
    let swappedSnapshot;
    const swapFs = tracingFs(
      () => {},
      (operation, args) => {
        if (swapped || !operationIs(operation, 'lstat') || args[0] !== prepared.requestPath) return;
        swapped = true;
        fs.renameSync(prepared.requestPath, parked);
        fs.renameSync(replacement, prepared.requestPath);
        swappedSnapshot = snapshotTree(slotDirOf(prepared));
      }
    );
    const broker = brokerForFixture(fixture, { fsOps: swapFs });
    const error = await captureError(() => broker.prepare({ sessionId: SESSION_A }));
    assert.equal(swapped, true, 'reuse inspection never reached the request identity boundary');
    assertTreeUnchanged(slotDirOf(prepared), swappedSnapshot, 'swapped request changed after rejection');
    assert.equal(error?.code, 'BROKER_CORRUPT', 'swapped request inode returned the old live identity');
  } finally {
    fixture.cleanup();
    fs.rmSync(exchange, { recursive: true, force: true });
  }
});

test('two same-session prepares synchronized at the check/create boundary leave at most one live slot', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-concurrent-prepare-'));
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-concurrent-control-'));
  fs.chmodSync(runtimeRoot, 0o700);
  try {
    const boundaryA = path.join(controlRoot, 'boundary-a');
    const boundaryB = path.join(controlRoot, 'boundary-b');
    const sessionDir = path.join(runtimeRoot, 'soma-entry', String(UID), sha256(SESSION_A));
    const childSource = String.raw`
      'use strict';
      const rawFs = require('node:fs');
      const path = require('node:path');
      const { createRequestBroker } = require(process.argv[1]);
      const sessionDir = process.argv[4];
      const ownBoundary = process.argv[5];
      const peerBoundary = process.argv[6];
      let boundaryHit = false;

      function isCheckCreateBoundary(operation, args) {
        const file = args[0];
        if (typeof file !== 'string' || path.dirname(file) !== sessionDir) return false;
        if (operation === 'mkdir' || operation === 'mkdirSync') return true;
        if (operation !== 'open' && operation !== 'openSync') return false;
        const flags = args[1];
        if (typeof flags === 'string') return flags.includes('x');
        return typeof flags === 'number' &&
          (flags & rawFs.constants.O_CREAT) !== 0 &&
          (flags & rawFs.constants.O_EXCL) !== 0;
      }

      function publishBoundary() {
        if (boundaryHit) return false;
        boundaryHit = true;
        rawFs.writeFileSync(ownBoundary, 'ready', { flag: 'wx' });
        return true;
      }

      function waitAtBoundarySync() {
        if (!publishBoundary()) return;
        const deadline = Date.now() + 5_000;
        const cell = new Int32Array(new SharedArrayBuffer(4));
        while (!rawFs.existsSync(peerBoundary)) {
          if (Date.now() >= deadline) {
            const error = new Error('peer never reached the check/create boundary');
            error.code = 'HARNESS_BOUNDARY_TIMEOUT';
            throw error;
          }
          Atomics.wait(cell, 0, 0, 5);
        }
      }

      async function waitAtBoundaryAsync() {
        if (!publishBoundary()) return;
        const deadline = Date.now() + 5_000;
        while (!rawFs.existsSync(peerBoundary)) {
          if (Date.now() >= deadline) {
            const error = new Error('peer never reached the check/create boundary');
            error.code = 'HARNESS_BOUNDARY_TIMEOUT';
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }

      function wrap(target, api) {
        return new Proxy(target, {
          get(object, property, receiver) {
            if (api === 'sync' && property === 'promises') return wrap(rawFs.promises, 'promises');
            const value = Reflect.get(object, property, receiver);
            if (typeof value !== 'function') return value;
            return (...args) => {
              if (!isCheckCreateBoundary(property, args)) {
                return Reflect.apply(value, object, args);
              }
              if (api === 'promises') {
                return waitAtBoundaryAsync().then(() => Reflect.apply(value, object, args));
              }
              waitAtBoundarySync();
              return Reflect.apply(value, object, args);
            };
          },
        });
      }

      const broker = createRequestBroker({
        runtimeRoot: process.argv[2],
        fsOps: wrap(rawFs, 'sync'),
      });
      Promise.resolve().then(() => broker.prepare({ sessionId: process.argv[3] })).then(
        prepared => process.stdout.write(JSON.stringify({ ok: true, boundaryHit, prepared }) + '\n'),
        error => process.stdout.write(JSON.stringify({
          ok: false,
          boundaryHit,
          code: error.code,
          message: error.message,
        }) + '\n')
      );
    `;
    const first = spawnJsonChild(childSource, [
      BROKER_MODULE, runtimeRoot, SESSION_A, sessionDir, boundaryA, boundaryB,
    ]);
    const second = spawnJsonChild(childSource, [
      BROKER_MODULE, runtimeRoot, SESSION_A, sessionDir, boundaryB, boundaryA,
    ]);
    const results = await Promise.all([first.result, second.result]);

    for (const result of results) {
      assert.equal(result.value.boundaryHit, true, `prepare bypassed the controlled boundary: ${result.stdout}`);
      assert.ok(
        result.value.ok || result.value.code === 'BROKER_BUSY',
        `concurrent prepare returned an unexpected result: ${JSON.stringify(results)}`
      );
    }
    const successfulIds = new Set(
      results.filter(result => result.value.ok).map(result => result.value.prepared.requestId)
    );
    assert.ok(successfulIds.size <= 1, `two distinct live leases were returned: ${JSON.stringify(results)}`);

    const liveSlots = fs.readdirSync(sessionDir).filter(name => /^[0-9a-f]{32}$/.test(name));
    assert.equal(liveSlots.length, 1, `same-session prepare created ${liveSlots.length} live slots`);
    if (successfulIds.size === 1) assert.equal(liveSlots[0], [...successfulIds][0]);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(controlRoot, { recursive: true, force: true });
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
            if (operationIs(operation, 'open')) opened.push(args[0]);
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
        if (operationIs(operation, 'open')) opened.push(args[0]);
      });
      const ownerProxy = withStatIdentityOverride(
        fakeOwnerFs,
        target,
        stat => spoofStat(stat, { uid: UID + 1 })
      );
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

test('consume lstat/realpath-authenticates every parent both before claim and before parsing', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    const events = [];
    const consumer = createRequestBroker({
      runtimeRoot: fixture.runtimeRoot,
      uid: UID,
      fsOps: tracingFs((operation, args, api) => events.push({ operation, args, api })),
      nowMonotonicMs: () => fixture.clock.monotonicMs,
      nowWallMs: () => fixture.clock.wallMs,
      randomBytes: deterministicRandom(35),
      ttlMs: DEFAULT_TTL_MS,
    });
    let parserEventIndex = -1;
    await consumer.consume(identityOf(prepared), {
      parseRawArguments(raw) {
        parserEventIndex = events.length;
        return raw;
      },
    });

    const claimEventIndex = events.findIndex(({ operation, args }) =>
      operationIs(operation, 'open') && path.basename(args[0]) === 'claim'
    );
    assert.ok(claimEventIndex >= 0, 'consume never reached an observable exclusive claim');
    assert.ok(parserEventIndex > claimEventIndex, 'parser ran before the claim boundary');

    for (const component of brokerChain(prepared, fixture.runtimeRoot)) {
      for (const semanticOperation of ['lstat', 'realpath']) {
        const beforeClaim = events.findIndex(({ operation, args }, index) =>
          index < claimEventIndex && operationIs(operation, semanticOperation) && args[0] === component
        );
        const afterClaim = events.findIndex(({ operation, args }, index) =>
          index > claimEventIndex && index < parserEventIndex &&
          operationIs(operation, semanticOperation) && args[0] === component
        );
        assert.ok(beforeClaim >= 0, `${semanticOperation} skipped ${component} before claim`);
        assert.ok(afterClaim >= 0, `${semanticOperation} skipped ${component} after claim`);
      }
    }
  } finally {
    fixture.cleanup();
  }
});

for (const level of [
  'runtime-root',
  'entry-root',
  'broker-root',
  'session-directory',
  'slot-directory',
]) {
  test(`post-claim ${level} symlink/canonical escape is rejected before parsing`, async () => {
    const fixture = makeFixture();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-postclaim-escape-'));
    fs.chmodSync(external, 0o700);
    let target;
    let parked;
    let swapped = false;
    try {
      fs.writeFileSync(path.join(external, 'sentinel'), 'outside bytes\n');
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared, '--help');
      target = {
        'runtime-root': fixture.runtimeRoot,
        'entry-root': path.join(fixture.runtimeRoot, 'soma-entry'),
        'broker-root': brokerRootOf(prepared),
        'session-directory': sessionDirOf(prepared),
        'slot-directory': slotDirOf(prepared),
      }[level];
      parked = `${target}.authenticated`;
      const swapFs = tracingFs(
        () => {},
        (operation, args) => {
          if (swapped || !operationIs(operation, 'open') || path.basename(args[0]) !== 'claim') return;
          swapped = true;
          fs.renameSync(target, parked);
          fs.symlinkSync(external, target, 'dir');
        }
      );
      const consumer = createRequestBroker({
        runtimeRoot: fixture.runtimeRoot,
        uid: UID,
        fsOps: swapFs,
        nowMonotonicMs: () => fixture.clock.monotonicMs,
        nowWallMs: () => fixture.clock.wallMs,
        randomBytes: deterministicRandom(36),
        ttlMs: DEFAULT_TTL_MS,
      });
      let parsed = false;
      const error = await assertRejected(
        () => consumer.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        'INVALID_ENTRY_REQUEST'
      );
      assert.equal(swapped, true, `${level} did not change after the claim`);
      assert.equal(parsed, false, `${level} post-claim escape reached the parser: ${error.stack}`);
      assert.equal(fs.readFileSync(path.join(external, 'sentinel'), 'utf8'), 'outside bytes\n');
    } finally {
      if (swapped && target && parked && fs.existsSync(parked)) {
        if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
        fs.renameSync(parked, target);
      }
      fixture.cleanup();
      fs.rmSync(external, { recursive: true, force: true });
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
        if (operationIs(operation, 'open')) opens.push(args);
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

test('consume rejects wrong-owner lease/request regular files before claim', async () => {
  for (const targetName of ['lease', 'request']) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared);
      const target = targetName === 'lease' ? leasePathOf(prepared) : prepared.requestPath;
      // macOS cannot safely assign these fixtures to an arbitrary foreign uid.
      // Spoof every supported path- and descriptor-stat boundary instead, so a
      // broker that authenticates an opened descriptor remains a valid design.
      const ownerFs = withStatIdentityOverride(
        fs,
        target,
        stat => spoofStat(stat, { uid: UID + 1 })
      );
      const descriptor = ownerFs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        assert.equal(ownerFs.fstatSync(descriptor).uid, UID + 1);
      } finally {
        ownerFs.closeSync(descriptor);
      }
      const handle = await ownerFs.promises.open(
        target,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
      );
      try {
        assert.equal((await handle.stat()).uid, UID + 1);
      } finally {
        await handle.close();
      }
      const consumer = createRequestBroker({
        runtimeRoot: fixture.runtimeRoot,
        uid: UID,
        fsOps: ownerFs,
        nowMonotonicMs: () => fixture.clock.monotonicMs,
        nowWallMs: () => fixture.clock.wallMs,
        randomBytes: deterministicRandom(42),
        ttlMs: DEFAULT_TTL_MS,
      });
      const before = snapshotTree(slotDirOf(prepared));
      let parsed = false;
      await assertRejected(
        () => consumer.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false, `${targetName} wrong owner reached parser`);
      assertNoClaim(prepared);
      assertTreeUnchanged(slotDirOf(prepared), before, `${targetName} wrong owner changed slot`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('consume rejects non-regular lease/request nodes before claim', async () => {
  for (const targetName of ['lease', 'request']) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared);
      const target = targetName === 'lease' ? leasePathOf(prepared) : prepared.requestPath;
      fs.rmSync(target);
      fs.mkdirSync(target, { mode: 0o700 });
      const before = snapshotTree(slotDirOf(prepared));
      let parsed = false;
      await assertRejected(
        () => fixture.broker.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false, `${targetName} directory reached parser`);
      assertNoClaim(prepared);
      assertTreeUnchanged(slotDirOf(prepared), before, `${targetName} non-regular node changed slot`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('consume rejects altered lease identity, path, schema, fields, bytes, and size without mutation', async () => {
  const cases = [
    ['sessionId', lease => ({ ...lease, sessionId: SESSION_B })],
    ['requestPath', lease => ({ ...lease, requestPath: `${lease.requestPath}.other` })],
    ['$schema', lease => ({ ...lease, $schema: 'soma-entry-lease/v2' })],
    ['surplus field', lease => ({ ...lease, contentSha256: 'a'.repeat(64) })],
    ['zero ttl', lease => ({
      ...lease,
      ttlMs: 0,
      expiresMonotonicMs: lease.createdMonotonicMs,
    })],
    ['non-integer ttl', lease => ({
      ...lease,
      ttlMs: 1.5,
      expiresMonotonicMs: lease.createdMonotonicMs + 1.5,
    })],
    ['ttl above maximum', lease => ({
      ...lease,
      ttlMs: MAX_TTL_MS + 1,
      expiresMonotonicMs: lease.createdMonotonicMs + MAX_TTL_MS + 1,
    })],
    ['created timestamp type', lease => ({ ...lease, createdMonotonicMs: '1000' })],
    ['expiry relation', lease => ({
      ...lease,
      expiresMonotonicMs: lease.expiresMonotonicMs + 1,
    })],
    ['missing ttl', lease => {
      const changed = { ...lease };
      delete changed.ttlMs;
      return changed;
    }],
    ['malformed JSON', () => '{ malformed lease'],
    ['oversize bytes', lease => `${' '.repeat(20 * 1024)}${JSON.stringify(lease)}`],
  ];
  for (const [label, mutate] of cases) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared);
      const original = readLease(prepared);
      const changed = mutate(original);
      if (typeof changed === 'string') {
        fs.writeFileSync(leasePathOf(prepared), changed, { mode: 0o600 });
        fs.chmodSync(leasePathOf(prepared), 0o600);
      } else {
        writeLease(prepared, changed);
      }
      const before = snapshotTree(slotDirOf(prepared));
      let parsed = false;
      await assertRejected(
        () => fixture.broker.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        /ENTRY_IDENTITY_MISMATCH|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false, `${label} lease reached parser`);
      assertNoClaim(prepared);
      assertTreeUnchanged(slotDirOf(prepared), before, `${label} lease changed during rejection`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('consume rejects malformed, wrong-schema, surplus, and oversize envelopes before claim', async () => {
  const cases = [
    ['malformed JSON', () => '{ malformed envelope'],
    ['wrong schema', prepared => JSON.stringify(envelopeFor(prepared, '--help', {
      $schema: 'soma-entry-request/v2',
    }))],
    ['surplus field', prepared => JSON.stringify({
      ...envelopeFor(prepared),
      mode: 'help',
    })],
    ['oversize rawArguments', prepared => JSON.stringify(envelopeFor(
      prepared,
      'x'.repeat(MAX_RAW_ARGUMENT_BYTES + 1)
    ))],
  ];
  for (const [label, makeBytes] of cases) {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      fs.writeFileSync(prepared.requestPath, makeBytes(prepared), { mode: 0o600 });
      fs.chmodSync(prepared.requestPath, 0o600);
      const before = snapshotTree(slotDirOf(prepared));
      let parsed = false;
      await assertRejected(
        () => fixture.broker.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        'INVALID_ENTRY_REQUEST'
      );
      assert.equal(parsed, false, `${label} envelope reached parser`);
      assertNoClaim(prepared);
      assertTreeUnchanged(slotDirOf(prepared), before, `${label} envelope changed during rejection`);
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
      const broker = createRequestBroker({
        runtimeRoot: process.argv[2],
        nowMonotonicMs: () => Number(process.argv[4]),
      });
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
    const args = [
      BROKER_MODULE,
      fixture.runtimeRoot,
      JSON.stringify(identityOf(prepared)),
      String(fixture.clock.monotonicMs),
    ];
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
        if (swapped || !operationIs(operation, 'open') || path.basename(args[0]) !== 'claim') return;
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
            return spoofStat(stat, { dev: stat.dev + 1 });
          };
        }
        if (property === 'closeSync') {
          return descriptor => {
            requestDescriptors.delete(descriptor);
            return fs.closeSync(descriptor);
          };
        }
        if (property === 'promises') {
          return new Proxy(fs.promises, {
            get(promisesTarget, promisesProperty, promisesReceiver) {
              if (promisesProperty !== 'open') {
                return Reflect.get(promisesTarget, promisesProperty, promisesReceiver);
              }
              return async (file, flags, mode) => {
                const handle = await promisesTarget.open(file, flags, mode);
                if (file !== prepared.requestPath) return handle;
                requestOpenCount += 1;
                if (requestOpenCount < 2) return handle;
                return new Proxy(handle, {
                  get(handleTarget, handleProperty, handleReceiver) {
                    if (handleProperty !== 'stat') {
                      const value = Reflect.get(handleTarget, handleProperty, handleReceiver);
                      return typeof value === 'function' ? value.bind(handleTarget) : value;
                    }
                    return async (...args) => {
                      const stat = await handleTarget.stat(...args);
                      return spoofStat(stat, { dev: stat.dev + 1 });
                    };
                  },
                });
              };
            },
          });
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
        if (isOpenOf(operation, args, prepared.requestPath)) requestOpens.push(args[1]);
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
    let preparedStdout = '';
    worker.child.stdout.on('data', chunk => {
      preparedStdout += String(chunk);
      while (!prepared && preparedStdout.includes('\n')) {
        const newline = preparedStdout.indexOf('\n');
        const line = preparedStdout.slice(0, newline);
        preparedStdout = preparedStdout.slice(newline + 1);
        if (!line) continue;
        prepared = JSON.parse(line);
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

test('SIGKILL in the prepare critical section leaves only recoverable TTL evidence', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-prepare-kill-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-prepare-kill-project-'));
  const ready = path.join(os.tmpdir(), `soma-entry-prepare-kill-${process.pid}-${Date.now()}.ready`);
  fs.chmodSync(runtimeRoot, 0o700);
  try {
    fs.mkdirSync(path.join(project, '.git'), { mode: 0o700 });
    fs.mkdirSync(path.join(project, '.soma', 'runs'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(project, 'sentinel'), 'project bytes\n');
    fs.writeFileSync(path.join(project, '.git', 'index'), 'git index bytes\n');
    fs.writeFileSync(path.join(project, '.soma', 'runs', 'state.json'), 'run bytes\n');
    const projectBefore = snapshotTree(project);
    const childSource = String.raw`
      'use strict';
      const rawFs = require('node:fs');
      const path = require('node:path');
      const { createRequestBroker } = require(process.argv[1]);
      const ready = process.argv[4];
      const descriptorPaths = new Map();

      function stopAfterDurableClaim() {
        rawFs.writeFileSync(ready, 'durable', { flag: 'wx' });
        const cell = new Int32Array(new SharedArrayBuffer(4));
        for (;;) Atomics.wait(cell, 0, 0, 1_000);
      }

      function wrapHandle(handle, file) {
        if (path.basename(file) !== '.prepare.claim') return handle;
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === 'close') {
              return async (...args) => {
                await target.close(...args);
                stopAfterDurableClaim();
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }

      const fsOps = new Proxy(rawFs, {
        get(target, property, receiver) {
          if (property === 'promises') {
            return new Proxy(rawFs.promises, {
              get(promisesTarget, promisesProperty, promisesReceiver) {
                if (promisesProperty === 'open') {
                  return async (file, ...args) => wrapHandle(
                    await promisesTarget.open(file, ...args),
                    file
                  );
                }
                const value = Reflect.get(promisesTarget, promisesProperty, promisesReceiver);
                return typeof value === 'function' ? value.bind(promisesTarget) : value;
              },
            });
          }
          if (property === 'openSync') {
            return (file, ...args) => {
              const descriptor = rawFs.openSync(file, ...args);
              descriptorPaths.set(descriptor, file);
              return descriptor;
            };
          }
          if (property === 'closeSync') {
            return descriptor => {
              const file = descriptorPaths.get(descriptor);
              descriptorPaths.delete(descriptor);
              rawFs.closeSync(descriptor);
              if (typeof file === 'string' && path.basename(file) === '.prepare.claim') {
                stopAfterDurableClaim();
              }
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      const broker = createRequestBroker({
        runtimeRoot: process.argv[2],
        fsOps,
        nowMonotonicMs: () => 1_000,
        nowWallMs: () => 1_700_000_000_000,
        ttlMs: 100,
      });
      broker.prepare({ sessionId: process.argv[3] }).catch(error => {
        process.stderr.write(JSON.stringify({ code: error.code, message: error.message }) + '\n');
      });
    `;
    const child = spawn(process.execPath, [
      '-e', childSource, BROKER_MODULE, runtimeRoot, SESSION_A, ready,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exit = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`prepare critical-section child timed out: ${stderr}`));
      }, CHILD_TIMEOUT_MS);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    await waitForPath(ready);
    child.kill('SIGKILL');
    const childResult = await exit;
    assert.equal(childResult.signal, 'SIGKILL');

    const sessionDir = path.join(runtimeRoot, 'soma-entry', String(UID), sha256(SESSION_A));
    const lockPath = prepareClaimPath(sessionDir);
    const defects = [];
    const entries = fs.readdirSync(sessionDir).sort();
    if (entries.length !== 1 || entries[0] !== '.prepare.claim') {
      defects.push(`unexpected critical-section residue: ${entries.join(',')}`);
    }
    const lockStat = fs.lstatSync(lockPath);
    if (!lockStat.isFile() || lockStat.isSymbolicLink() || lockStat.uid !== UID || modeOf(lockPath) !== 0o600) {
      defects.push('prepare claim owner, mode, or regular-file type is invalid');
    }
    let evidence;
    try {
      evidence = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (_error) {
      defects.push('prepare claim does not contain JSON identity/TTL evidence');
    }
    if (evidence) {
      const expectedKeys = [
        '$schema',
        'capability',
        'createdMonotonicMs',
        'expiresMonotonicMs',
        'requestId',
        'requestPath',
        'sessionId',
        'ttlMs',
      ];
      if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(expectedKeys)) {
        defects.push('prepare claim field set is not bounded');
      }
      if (evidence.$schema !== PREPARE_CLAIM_SCHEMA || evidence.sessionId !== SESSION_A ||
          !/^[0-9a-f]{32}$/.test(evidence.requestId || '') ||
          !/^[0-9a-f]{64}$/.test(evidence.capability || '') ||
          evidence.requestPath !== path.join(sessionDir, evidence.requestId, 'request.json') ||
          !Number.isSafeInteger(evidence.ttlMs) || evidence.ttlMs <= 0 || evidence.ttlMs > MAX_TTL_MS ||
          evidence.createdMonotonicMs !== 1_000 ||
          evidence.expiresMonotonicMs !== evidence.createdMonotonicMs + evidence.ttlMs) {
        defects.push('prepare claim identity or monotonic TTL evidence is invalid');
      }
    }
    assertTreeUnchanged(project, projectBefore, 'prepare critical-section death mutated project/Git/run');

    const clock = makeClock(1_101);
    const recoveryBroker = createRequestBroker({
      runtimeRoot,
      uid: UID,
      fsOps: fs,
      nowMonotonicMs: () => clock.monotonicMs,
      nowWallMs: () => clock.wallMs,
      randomBytes: deterministicRandom(120),
      ttlMs: 100,
    });
    let recovered;
    const recoveryError = await captureError(async () => {
      recovered = await recoveryBroker.prepare({ sessionId: SESSION_A });
    });
    if (recoveryError) defects.push(`expired orphan stayed blocked: ${recoveryError.code}`);
    if (recovered && (!fs.existsSync(slotDirOf(recovered)) || fs.existsSync(lockPath))) {
      defects.push('expired orphan recovery did not leave exactly the new slot');
    }
    assert.deepEqual(defects, [], defects.join('; '));
  } finally {
    fs.rmSync(ready, { force: true });
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
      if (['rename', 'rm', 'mkdir'].some(name => operationIs(operation, name))) {
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
      operationIs(operation, 'rename') && from === slotDirOf(r1)
    );
    assert.ok(renameIndex >= 0, 'expired R1 was not atomically rename-claimed');
    const cleanupPath = events[renameIndex][2];
    const removeIndex = events.findIndex(([operation, target]) =>
      operationIs(operation, 'rm') && target === cleanupPath
    );
    assert.ok(removeIndex > renameIndex, 'cleanup removal did not follow rename claim');
    assert.equal(fs.existsSync(cleanupPath), false);
  } finally {
    fixture.cleanup();
  }
});

for (const [evidence, plant] of [
  ['unknown file', prepared => fs.writeFileSync(
    path.join(slotDirOf(prepared), 'unexpected-evidence'),
    'expired diagnostic bytes\n',
    { mode: 0o600, flag: 'wx' }
  )],
  ['unknown directory', prepared => fs.mkdirSync(
    path.join(slotDirOf(prepared), 'unexpected-evidence'),
    { mode: 0o700 }
  )],
]) {
  test(`expired slot with ${evidence} is corrupt evidence and is never scavenged`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      fixture.clock.monotonicMs = readLease(prepared).expiresMonotonicMs + 1;
      plant(prepared);
      const before = snapshotTree(slotDirOf(prepared));
      const error = await captureError(
        () => fixture.broker.prepare({ sessionId: SESSION_A })
      );
      assert.equal(error?.code, 'BROKER_CORRUPT', `${evidence} expired slot was scavenged`);
      assertTreeUnchanged(slotDirOf(prepared), before, `${evidence} expired evidence changed`);
    } finally {
      fixture.cleanup();
    }
  });
}

test('expired slot with an authenticated consume claim is atomically scavenged before replacement', async () => {
  const events = [];
  const fixture = makeFixture({
    fsOps: tracingFs((operation, args) => {
      if (['rename', 'rm', 'unlink', 'mkdir'].some(name => operationIs(operation, name))) {
        events.push([operation, ...args]);
      }
    }),
  });
  try {
    const r1 = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeOwnerOnlyJson(claimPathOf(r1), identityOf(r1));
    fixture.clock.monotonicMs = readLease(r1).expiresMonotonicMs + 1;
    events.length = 0;
    const r2 = await fixture.broker.prepare({ sessionId: SESSION_A });
    const renameIndex = events.findIndex(([operation, from]) =>
      operationIs(operation, 'rename') && from === slotDirOf(r1)
    );
    assert.ok(renameIndex >= 0, 'expired authenticated claim was not atomically rename-claimed');
    const cleanupPath = events[renameIndex][2];
    const removeIndex = events.findIndex(([operation, target]) =>
      (operationIs(operation, 'rm') || operationIs(operation, 'unlink')) && target === cleanupPath
    );
    assert.ok(removeIndex > renameIndex, 'expired claimed slot was not removed after rename');
    assert.equal(fs.existsSync(cleanupPath), false);
    assert.deepEqual(
      snapshotTree(sessionDirOf(r2)).map(({ path: relative, type }) => [relative, type]),
      [
        ['.', 'directory'],
        [r2.requestId, 'directory'],
        [path.join(r2.requestId, 'lease.json'), 'file'],
        [path.join(r2.requestId, 'request.json'), 'file'],
      ],
      'expired claimed slot recovery left claim, orphan, or cleanup evidence'
    );
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
    const wrongOwnerFs = withStatIdentityOverride(
      fs,
      target,
      stat => spoofStat(stat, { uid: UID + 1 })
    );
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

test('live valid prepare claim is bounded evidence and returns BROKER_BUSY unchanged', async () => {
  const fixture = makeFixture();
  try {
    const seed = await fixture.broker.prepare({ sessionId: SESSION_A });
    const sessionDir = sessionDirOf(seed);
    fs.rmSync(slotDirOf(seed), { recursive: true, force: false });
    const claim = prepareClaimEvidence({
      prepared: seed,
      createdMonotonicMs: fixture.clock.monotonicMs,
      ttlMs: 100,
    });
    const lockPath = prepareClaimPath(sessionDir);
    writeOwnerOnlyJson(lockPath, claim);
    const before = snapshotTree(sessionDir);
    await assertRejected(
      () => fixture.broker.prepare({ sessionId: SESSION_A }),
      'BROKER_BUSY'
    );
    assertTreeUnchanged(sessionDir, before, 'live prepare claim changed while reporting busy');
  } finally {
    fixture.cleanup();
  }
});

test('expired valid prepare claim is atomically scavenged before the next slot', async () => {
  const fixture = makeFixture();
  try {
    const seed = await fixture.broker.prepare({ sessionId: SESSION_A });
    const sessionDir = sessionDirOf(seed);
    fs.rmSync(slotDirOf(seed), { recursive: true, force: false });
    const lockPath = prepareClaimPath(sessionDir);
    writeOwnerOnlyJson(lockPath, prepareClaimEvidence({
      prepared: seed,
      createdMonotonicMs: fixture.clock.monotonicMs,
      ttlMs: 100,
    }));
    fixture.clock.monotonicMs += 101;
    const events = [];
    const broker = brokerForFixture(fixture, {
      fsOps: tracingFs((operation, args) => {
        if (['rename', 'rm', 'unlink', 'mkdir'].some(name => operationIs(operation, name))) {
          events.push([operation, ...args]);
        }
      }),
    });
    let recovered;
    const error = await captureError(async () => {
      recovered = await broker.prepare({ sessionId: SESSION_A });
    });
    assert.equal(error, undefined, `expired valid prepare claim stayed busy: ${error?.code}`);
    const renameIndex = events.findIndex(([operation, from]) =>
      operationIs(operation, 'rename') && from === lockPath
    );
    assert.ok(renameIndex >= 0, 'expired prepare claim was not atomically rename-claimed');
    const cleanupPath = events[renameIndex][2];
    const removeIndex = events.findIndex(([operation, target]) =>
      (operationIs(operation, 'rm') || operationIs(operation, 'unlink')) && target === cleanupPath
    );
    assert.ok(removeIndex > renameIndex, 'renamed prepare claim was never removed');
    assert.equal(fs.existsSync(cleanupPath), false, 'renamed prepare claim artifact survived recovery');
    assert.equal(fs.existsSync(lockPath), false, 'expired prepare claim survived recovery');
    assert.ok(recovered?.requestPath, 'recovery did not create the next slot');
    assert.equal(fs.existsSync(slotDirOf(recovered)), true);
    assert.deepEqual(
      snapshotTree(sessionDir).map(({ path: relative, type }) => [relative, type]),
      [
        ['.', 'directory'],
        [recovered.requestId, 'directory'],
        [path.join(recovered.requestId, 'lease.json'), 'file'],
        [path.join(recovered.requestId, 'request.json'), 'file'],
      ],
      'expired prepare claim recovery left claim, rename, orphan, or cleanup artifacts'
    );
  } finally {
    fixture.cleanup();
  }
});

for (const corruption of [
  'malformed-json',
  'schema',
  'session-identity',
  'request-identity',
  'capability-identity',
  'created-timestamp',
  'created-wrong-type',
  'ttl-bound',
  'ttl-zero',
  'ttl-noninteger',
  'expiry-relation',
  'request-path-containment',
  'request-path-inside-session',
  'missing-field',
  'surplus-field',
  'symlink',
  'wrong-mode',
  'wrong-owner',
  'non-regular',
  'unexpected-evidence',
]) {
  test(`${corruption} prepare claim returns BROKER_CORRUPT and remains untouched`, async () => {
    const fixture = makeFixture();
    try {
      const seed = await fixture.broker.prepare({ sessionId: SESSION_A });
      const sessionDir = sessionDirOf(seed);
      fs.rmSync(slotDirOf(seed), { recursive: true, force: false });
      const lockPath = prepareClaimPath(sessionDir);
      const valid = prepareClaimEvidence({
        prepared: seed,
        createdMonotonicMs: fixture.clock.monotonicMs,
        ttlMs: 100,
      });
      let fsOps = fs;
      if (corruption === 'malformed-json') {
        fs.writeFileSync(lockPath, '{ malformed prepare claim', { mode: 0o600, flag: 'wx' });
      } else if (corruption === 'schema') {
        writeOwnerOnlyJson(lockPath, { ...valid, $schema: 'soma-entry-prepare-claim/v2' });
      } else if (corruption === 'session-identity') {
        writeOwnerOnlyJson(lockPath, { ...valid, sessionId: SESSION_B });
      } else if (corruption === 'request-identity') {
        const requestId = 'A'.repeat(32);
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          requestId,
          requestPath: path.join(sessionDir, requestId, 'request.json'),
        });
      } else if (corruption === 'capability-identity') {
        writeOwnerOnlyJson(lockPath, { ...valid, capability: 'A'.repeat(64) });
      } else if (corruption === 'created-timestamp') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          createdMonotonicMs: -1,
          expiresMonotonicMs: -1 + valid.ttlMs,
        });
      } else if (corruption === 'created-wrong-type') {
        writeOwnerOnlyJson(lockPath, { ...valid, createdMonotonicMs: '1000' });
      } else if (corruption === 'ttl-bound') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          ttlMs: MAX_TTL_MS + 1,
          expiresMonotonicMs: valid.createdMonotonicMs + MAX_TTL_MS + 1,
        });
      } else if (corruption === 'ttl-zero') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          ttlMs: 0,
          expiresMonotonicMs: valid.createdMonotonicMs,
        });
      } else if (corruption === 'ttl-noninteger') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          ttlMs: 1.5,
          expiresMonotonicMs: valid.createdMonotonicMs + 1.5,
        });
      } else if (corruption === 'expiry-relation') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          expiresMonotonicMs: valid.expiresMonotonicMs + 1,
        });
      } else if (corruption === 'request-path-containment') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          requestPath: path.join(fixture.runtimeRoot, 'escaped-request.json'),
        });
      } else if (corruption === 'request-path-inside-session') {
        writeOwnerOnlyJson(lockPath, {
          ...valid,
          requestPath: path.join(sessionDir, 'wrong-request.json'),
        });
      } else if (corruption === 'missing-field') {
        const changed = { ...valid };
        delete changed.capability;
        writeOwnerOnlyJson(lockPath, changed);
      } else if (corruption === 'surplus-field') {
        writeOwnerOnlyJson(lockPath, { ...valid, surplus: true });
      } else if (corruption === 'symlink') {
        const external = path.join(fixture.runtimeRoot, 'external-prepare-claim');
        writeOwnerOnlyJson(external, valid);
        fs.symlinkSync(external, lockPath);
      } else if (corruption === 'wrong-mode') {
        writeOwnerOnlyJson(lockPath, valid);
        fs.chmodSync(lockPath, 0o640);
      } else if (corruption === 'wrong-owner') {
        writeOwnerOnlyJson(lockPath, valid);
        fsOps = withStatIdentityOverride(
          fs,
          lockPath,
          stat => spoofStat(stat, { uid: UID + 1 })
        );
      } else if (corruption === 'non-regular') {
        fs.mkdirSync(lockPath, { mode: 0o700 });
      } else {
        writeOwnerOnlyJson(lockPath, valid);
        fs.writeFileSync(
          path.join(sessionDir, 'unexpected-prepare-evidence'),
          'diagnostic bytes\n',
          { mode: 0o600, flag: 'wx' }
        );
      }
      const before = snapshotTree(fixture.runtimeRoot);
      const broker = brokerForFixture(fixture, { fsOps });
      const error = await captureError(() => broker.prepare({ sessionId: SESSION_A }));
      assert.equal(error?.code, 'BROKER_CORRUPT', `${corruption} prepare claim returned busy`);
      assertTreeUnchanged(
        fixture.runtimeRoot,
        before,
        `${corruption} prepare claim changed during rejection`
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test('delayed P1 release cannot remove P2 prepare claim or newer slot', async () => {
  let replaced = false;
  let p2Prepared;
  let p2Before;
  let p2ClaimBytes;
  const delayedFs = tracingFs((operation, args) => {
    const target = args[0];
    const targetsPrepareClaim = typeof target === 'string' &&
      path.basename(target) === '.prepare.claim' &&
      (operationIs(operation, 'unlink') || operationIs(operation, 'rm') || operationIs(operation, 'rename'));
    if (replaced || !targetsPrepareClaim || !fs.existsSync(target)) return;
    replaced = true;
    const sessionDir = path.dirname(target);
    fs.renameSync(target, `${target}.p1-retired`);
    const p2Evidence = {
      sessionId: SESSION_A,
      requestId: 'c'.repeat(32),
      capability: 'd'.repeat(64),
      requestPath: path.join(sessionDir, 'c'.repeat(32), 'request.json'),
      ttlMs: 100,
      createdMonotonicMs: 1_001,
      expiresMonotonicMs: 1_101,
    };
    const p2Claim = prepareClaimEvidence({
      prepared: p2Evidence,
    });
    writeOwnerOnlyJson(target, p2Claim);
    p2ClaimBytes = fs.readFileSync(target);
    p2Prepared = createPreparedSlot(sessionDir, p2Evidence);
    p2Before = snapshotTree(slotDirOf(p2Prepared));
  });
  const fixture = makeFixture({ fsOps: delayedFs });
  try {
    const p1 = await fixture.broker.prepare({ sessionId: SESSION_A });
    assert.equal(replaced, true, 'P1 release boundary was not observed');
    const lockPath = prepareClaimPath(sessionDirOf(p1));
    const claimPreserved = fs.existsSync(lockPath) &&
      fs.readFileSync(lockPath).equals(p2ClaimBytes);
    assert.equal(claimPreserved, true, 'delayed P1 release removed P2 prepare claim');
    assertTreeUnchanged(slotDirOf(p2Prepared), p2Before, 'delayed P1 release changed P2 slot');
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
        const broker = createRequestBroker({
          runtimeRoot: process.argv[2],
          nowMonotonicMs: () => Number(process.argv[5]),
        });
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
        String(fixture.clock.monotonicMs),
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

// Complete residual matrix, group 1: consume/abort claim authentication.

for (const lifetime of ['live', 'expired']) {
  for (const physical of ['symlink', 'wrong-owner', 'wrong-mode', 'non-regular']) {
    test(`[matrix G1] ${lifetime} ${physical} consume claim is corrupt and preserved`, async () => {
      const fixture = makeFixture();
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        const claimPath = claimPathOf(prepared);
        let fsOps = fs;
        if (physical === 'symlink') {
          const external = path.join(fixture.runtimeRoot, `external-${lifetime}-claim`);
          writeOwnerOnlyJson(external, identityOf(prepared));
          fs.symlinkSync(external, claimPath);
        } else if (physical === 'wrong-owner') {
          writeOwnerOnlyJson(claimPath, identityOf(prepared));
          fsOps = withStatIdentityOverride(
            fs,
            claimPath,
            stat => spoofStat(stat, { uid: UID + 1 })
          );
        } else if (physical === 'wrong-mode') {
          writeOwnerOnlyJson(claimPath, identityOf(prepared));
          fs.chmodSync(claimPath, 0o640);
        } else {
          fs.mkdirSync(claimPath, { mode: 0o700 });
        }
        if (lifetime === 'expired') {
          fixture.clock.monotonicMs = readLease(prepared).expiresMonotonicMs + 1;
        }
        const before = snapshotTree(fixture.runtimeRoot);
        const broker = brokerForFixture(fixture, { fsOps });
        const error = await captureError(() => broker.prepare({ sessionId: SESSION_A }));
        assert.equal(error?.code, 'BROKER_CORRUPT');
        assertTreeUnchanged(fixture.runtimeRoot, before, `${lifetime} ${physical} claim changed`);
      } finally {
        fixture.cleanup();
      }
    });
  }
}

const claimContentMutations = [
  ['session mismatch', identity => ({ ...identity, sessionId: SESSION_B })],
  ['request mismatch', identity => ({ ...identity, requestId: ALT_REQUEST_ID })],
  ['capability mismatch', identity => ({ ...identity, capability: ALT_CAPABILITY })],
  ['surplus field', identity => ({ ...identity, surplus: true })],
  ['missing field', identity => {
    const changed = { ...identity };
    delete changed.capability;
    return changed;
  }],
];

for (const lifetime of ['live', 'expired']) {
  for (const [content, mutate] of claimContentMutations) {
    test(`[matrix G1] ${lifetime} consume claim ${content} is corrupt and preserved`, async () => {
      const fixture = makeFixture();
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        writeOwnerOnlyJson(claimPathOf(prepared), mutate(identityOf(prepared)));
        if (lifetime === 'expired') {
          fixture.clock.monotonicMs = readLease(prepared).expiresMonotonicMs + 1;
        }
        const before = snapshotTree(fixture.runtimeRoot);
        const error = await captureError(() => fixture.broker.prepare({ sessionId: SESSION_A }));
        assert.equal(error?.code, 'BROKER_CORRUPT');
        assertTreeUnchanged(fixture.runtimeRoot, before, `${lifetime} ${content} claim changed`);
      } finally {
        fixture.cleanup();
      }
    });
  }
}

test('[matrix G1] consume claim creation has a deterministic O_EXCL no-follow 0600 loser', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    const claimOpens = [];
    let nested;
    let consumer;
    const barrierFs = tracingFs(
      (operation, args) => {
        if (operationIs(operation, 'open') && args[0] === claimPathOf(prepared)) {
          claimOpens.push(args);
        }
      },
      (operation, args) => {
        if (nested || !operationIs(operation, 'open') || args[0] !== claimPathOf(prepared)) return;
        nested = consumer.consume(identityOf(prepared), { parseRawArguments: raw => raw });
      }
    );
    consumer = brokerForFixture(fixture, { fsOps: barrierFs });
    const winner = consumer.consume(identityOf(prepared), { parseRawArguments: raw => raw });
    const [winnerResult, loserError] = await Promise.all([
      winner,
      captureError(() => nested),
    ]);
    assert.equal(winnerResult.rawArguments, '--help');
    assert.match(loserError?.code || '', /REQUEST_ALREADY_CONSUMED|BROKER_BUSY/);
    assert.ok(claimOpens.length >= 2, 'both consumers did not reach the exclusive claim boundary');
    const [, flags, mode] = claimOpens[0];
    assert.equal(typeof flags, 'number');
    assert.ok((flags & fs.constants.O_CREAT) !== 0);
    assert.ok((flags & fs.constants.O_EXCL) !== 0);
    assert.ok((flags & fs.constants.O_NOFOLLOW) !== 0);
    assert.equal(mode, 0o600);
    assert.equal(fs.existsSync(slotDirOf(prepared)), false);
  } finally {
    fixture.cleanup();
  }
});

for (const driftTarget of ['claim', 'lease']) {
  test(`[matrix G1] cleanup preserves slot when ${driftTarget} drifts after auth before rm`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared, '--help');
      let drifted = false;
      let driftSnapshot;
      const driftFs = tracingFs((operation, args) => {
        if (drifted || !operationIs(operation, 'rm') || args[0] !== slotDirOf(prepared)) return;
        drifted = true;
        if (driftTarget === 'claim') {
          fs.renameSync(claimPathOf(prepared), `${claimPathOf(prepared)}.authenticated`);
          writeOwnerOnlyJson(claimPathOf(prepared), {
            ...identityOf(prepared),
            capability: ALT_CAPABILITY,
          });
        } else {
          writeLease(prepared, { ...readLease(prepared), capability: ALT_CAPABILITY });
        }
        driftSnapshot = snapshotTree(slotDirOf(prepared));
      });
      const consumer = brokerForFixture(fixture, { fsOps: driftFs });
      await consumer.consume(identityOf(prepared), { parseRawArguments: raw => raw });
      assert.equal(drifted, true, 'cleanup did not reach the authenticated removal boundary');
      assertTreeUnchanged(slotDirOf(prepared), driftSnapshot, `${driftTarget} drift was removed`);
    } finally {
      fixture.cleanup();
    }
  });
}

// Complete residual matrix, group 2: prepare claim durability and crash recovery.

test('[matrix G2] prepare claim uses exclusive no-follow 0600 durable bounded evidence', async () => {
  const fixture = makeFixture();
  try {
    let claimDescriptor;
    let openArgs;
    let writtenBytes;
    const events = [];
    const fsOps = tracingFs(
      (operation, args) => {
        if (operationIs(operation, 'writeFile') && args[0] === claimDescriptor) {
          writtenBytes = Buffer.from(args[1]);
          events.push('write');
        }
        if (operationIs(operation, 'fsync') && args[0] === claimDescriptor) events.push('fsync');
        if (operationIs(operation, 'close') && args[0] === claimDescriptor) events.push('close');
      },
      (operation, args, _api, result) => {
        if (operationIs(operation, 'open') && path.basename(args[0]) === '.prepare.claim') {
          claimDescriptor = result;
          openArgs = args;
          events.push('open');
        }
      }
    );
    const broker = brokerForFixture(fixture, { fsOps });
    const prepared = await broker.prepare({ sessionId: SESSION_A });
    const [, flags, mode] = openArgs;
    assert.equal(typeof flags, 'number');
    assert.ok((flags & fs.constants.O_CREAT) !== 0);
    assert.ok((flags & fs.constants.O_EXCL) !== 0);
    assert.ok((flags & fs.constants.O_NOFOLLOW) !== 0);
    assert.equal(mode, 0o600);
    assert.ok(Buffer.isBuffer(writtenBytes) && writtenBytes.length > 0, 'prepare claim has no identity/TTL bytes');
    const evidence = JSON.parse(writtenBytes.toString('utf8'));
    assert.deepEqual(evidence, prepareClaimEvidence({ prepared }));
    assert.ok(events.indexOf('fsync') > events.indexOf('write'));
    assert.ok(events.indexOf('close') > events.indexOf('fsync'));
  } finally {
    fixture.cleanup();
  }
});

for (const stage of ['claim-only', 'slot-dir', 'lease', 'empty-request']) {
  for (const lifetime of ['live', 'expired']) {
    test(`[matrix G2] ${lifetime} prepare crash at ${stage} is recoverable`, async () => {
      const fixture = makeFixture();
      try {
        const seed = await fixture.broker.prepare({ sessionId: SESSION_A });
        const sessionDir = sessionDirOf(seed);
        const lease = readLease(seed);
        fs.rmSync(slotDirOf(seed), { recursive: true, force: false });
        writeOwnerOnlyJson(prepareClaimPath(sessionDir), prepareClaimEvidence({
          prepared: seed,
          createdMonotonicMs: fixture.clock.monotonicMs,
          ttlMs: 100,
        }));
        if (stage !== 'claim-only') {
          fs.mkdirSync(slotDirOf(seed), { mode: 0o700 });
          fs.chmodSync(slotDirOf(seed), 0o700);
        }
        if (stage === 'lease' || stage === 'empty-request') {
          writeOwnerOnlyJson(leasePathOf(seed), lease);
        }
        if (stage === 'empty-request') {
          fs.writeFileSync(seed.requestPath, '', { mode: 0o600, flag: 'wx' });
          fs.chmodSync(seed.requestPath, 0o600);
        }
        const before = snapshotTree(sessionDir);
        if (lifetime === 'live') {
          await assertRejected(() => fixture.broker.prepare({ sessionId: SESSION_A }), 'BROKER_BUSY');
          assertTreeUnchanged(sessionDir, before, `live ${stage} crash residue changed`);
        } else {
          fixture.clock.monotonicMs += 101;
          const recovered = await fixture.broker.prepare({ sessionId: SESSION_A });
          assert.notEqual(recovered.requestId, seed.requestId);
          assert.deepEqual(
            snapshotTree(sessionDir).map(({ path: relative, type }) => [relative, type]),
            exactSessionShape(recovered),
            `expired ${stage} crash residue survived recovery`
          );
        }
      } finally {
        fixture.cleanup();
      }
    });
  }
}

test('[matrix G2] expired cleanup rename collision never overwrites either tree', async () => {
  const fixture = makeFixture();
  try {
    const r1 = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(r1, '--help');
    fixture.clock.monotonicMs = readLease(r1).expiresMonotonicMs + 1;
    let collisionPath;
    let collisionBefore;
    const r1Before = snapshotTree(slotDirOf(r1));
    const collisionFs = tracingFs((operation, args) => {
      if (collisionPath || !operationIs(operation, 'rename') || args[0] !== slotDirOf(r1)) return;
      collisionPath = args[1];
      fs.mkdirSync(collisionPath, { mode: 0o700 });
      fs.writeFileSync(path.join(collisionPath, 'sentinel'), 'collision bytes\n', {
        mode: 0o600,
        flag: 'wx',
      });
      collisionBefore = snapshotTree(collisionPath);
    });
    const broker = brokerForFixture(fixture, { fsOps: collisionFs });
    const error = await captureError(() => broker.prepare({ sessionId: SESSION_A }));
    assert.match(error?.code || '', /BROKER_BUSY|BROKER_CORRUPT/);
    assert.ok(collisionPath, 'expired cleanup did not reach rename');
    assertTreeUnchanged(slotDirOf(r1), r1Before, 'rename collision changed R1');
    assertTreeUnchanged(collisionPath, collisionBefore, 'rename collision target was overwritten');
  } finally {
    fixture.cleanup();
  }
});

// Complete residual matrix, group 3: all five canonical chain levels.

const chainLevels = [
  'runtime-root',
  'entry-root',
  'broker-root',
  'session-directory',
  'slot-directory',
];

function chainTarget(level, prepared, runtimeRoot) {
  return {
    'runtime-root': runtimeRoot,
    'entry-root': path.join(runtimeRoot, 'soma-entry'),
    'broker-root': brokerRootOf(prepared),
    'session-directory': sessionDirOf(prepared),
    'slot-directory': slotDirOf(prepared),
  }[level];
}

for (const level of chainLevels) {
  test(`[matrix G3] preclaim realpath-only escape at ${level} forbids opens and claim`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared, '--help');
      const target = chainTarget(level, prepared, fixture.runtimeRoot);
      const opened = [];
      let targetCalls = 0;
      const traced = tracingFs((operation, args) => {
        if (operationIs(operation, 'open')) opened.push(args[0]);
      });
      const realpathFs = withRealpathOverride(traced, target, actual => {
        targetCalls += 1;
        if (level === 'runtime-root' && targetCalls === 1) return actual;
        return path.join(path.dirname(fixture.runtimeRoot), 'canonical-escape');
      });
      const consumer = brokerForFixture(fixture, { fsOps: realpathFs });
      const before = snapshotTree(fixture.runtimeRoot);
      let parsed = false;
      await assertRejected(
        () => consumer.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
      );
      assert.equal(parsed, false);
      assert.equal(opened.includes(leasePathOf(prepared)), false);
      assert.equal(opened.includes(prepared.requestPath), false);
      assert.equal(opened.includes(claimPathOf(prepared)), false);
      assertTreeUnchanged(fixture.runtimeRoot, before, `${level} realpath escape changed tree`);
    } finally {
      fixture.cleanup();
    }
  });
}

for (const level of chainLevels) {
  test(`[matrix G3] postclaim realpath-only escape at ${level} preserves claimed evidence`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      writeEnvelope(prepared, '--help');
      const target = chainTarget(level, prepared, fixture.runtimeRoot);
      let active = false;
      let activeCalls = 0;
      let boundarySnapshot;
      const boundaryFs = afterClaimCloseFs(prepared, () => {
        active = true;
        activeCalls = 0;
        boundarySnapshot = snapshotTree(slotDirOf(prepared));
      });
      const realpathFs = withRealpathOverride(boundaryFs, target, actual => {
        if (!active) return actual;
        activeCalls += 1;
        if (level === 'runtime-root' && activeCalls === 1) return actual;
        return path.join(path.dirname(fixture.runtimeRoot), 'postclaim-canonical-escape');
      });
      const consumer = brokerForFixture(fixture, { fsOps: realpathFs });
      let parsed = false;
      await assertRejected(
        () => consumer.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        'INVALID_ENTRY_REQUEST'
      );
      assert.equal(active, true, `${level} never reached the postclaim boundary`);
      assert.equal(parsed, false);
      assertTreeUnchanged(
        slotDirOf(prepared),
        boundarySnapshot,
        `${level} postclaim realpath drift removed diagnostic evidence`
      );
    } finally {
      fixture.cleanup();
    }
  });
}

for (const level of ['runtime-root', 'entry-root']) {
  for (const physical of ['symlink', 'wrong-owner', 'wrong-mode', 'non-directory']) {
    test(`[matrix G3] preclaim ${physical} ${level} forbids broker-file access`, async () => {
      const fixture = makeFixture();
      let target;
      let parked;
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        writeEnvelope(prepared, '--help');
        target = chainTarget(level, prepared, fixture.runtimeRoot);
        const opened = [];
        const traced = tracingFs((operation, args) => {
          if (operationIs(operation, 'open')) opened.push(args[0]);
        });
        let fsOps = traced;
        if (physical === 'symlink') {
          parked = `${target}.matrix-parked`;
          fs.renameSync(target, parked);
          fs.symlinkSync(parked, target, 'dir');
        } else if (physical === 'wrong-mode') {
          fs.chmodSync(target, 0o755);
        } else {
          fsOps = withStatIdentityOverride(
            traced,
            target,
            stat => physical === 'wrong-owner'
              ? spoofStat(stat, { uid: UID + 1 })
              : spoofStat(stat, { isDirectory: () => false })
          );
        }
        const before = snapshotTree(slotDirOf(prepared));
        const consumer = brokerForFixture(fixture, { fsOps });
        let parsed = false;
        await assertRejected(
          () => consumer.consume(identityOf(prepared), {
            parseRawArguments() { parsed = true; },
          }),
          /BROKER_CORRUPT|INVALID_ENTRY_REQUEST/
        );
        assert.equal(parsed, false);
        assert.equal(opened.includes(leasePathOf(prepared)), false);
        assert.equal(opened.includes(prepared.requestPath), false);
        assert.equal(opened.includes(claimPathOf(prepared)), false);
        assertTreeUnchanged(slotDirOf(prepared), before, `${physical} ${level} changed slot`);
      } finally {
        if (parked && target && fs.existsSync(parked)) {
          if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
          fs.renameSync(parked, target);
        }
        fixture.cleanup();
      }
    });
  }
}

// Complete residual matrix, group 4: lease timing and request physical invariants.

for (const targetName of ['slot', 'request']) {
  for (const physical of ['symlink', 'wrong-owner', 'wrong-mode', 'non-regular']) {
    test(`[matrix G4] expired ${physical} ${targetName} is preserved as corruption`, async () => {
      const fixture = makeFixture();
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        writeEnvelope(prepared, '--help');
        fixture.clock.monotonicMs = readLease(prepared).expiresMonotonicMs + 1;
        const target = targetName === 'slot' ? slotDirOf(prepared) : prepared.requestPath;
        let fsOps = fs;
        if (physical === 'symlink') {
          const parked = `${target}.matrix-parked`;
          fs.renameSync(target, parked);
          fs.symlinkSync(parked, target, targetName === 'slot' ? 'dir' : 'file');
        } else if (physical === 'wrong-mode') {
          fs.chmodSync(target, targetName === 'slot' ? 0o755 : 0o640);
        } else {
          fsOps = withStatIdentityOverride(fs, target, stat => {
            if (physical === 'wrong-owner') return spoofStat(stat, { uid: UID + 1 });
            return targetName === 'slot'
              ? spoofStat(stat, { isDirectory: () => false })
              : spoofStat(stat, { isFile: () => false });
          });
        }
        const before = snapshotTree(fixture.runtimeRoot);
        const broker = brokerForFixture(fixture, { fsOps });
        await assertRejected(() => broker.prepare({ sessionId: SESSION_A }), 'BROKER_CORRUPT');
        assertTreeUnchanged(
          fixture.runtimeRoot,
          before,
          `expired ${physical} ${targetName} was scavenged`
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
}

for (const physical of ['symlink', 'wrong-owner', 'wrong-mode', 'non-regular']) {
  test(`[matrix G4] second request open rejects ${physical} before parser and cleans its slot`, async () => {
    const fixture = makeFixture();
    try {
      const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
      const sibling = await fixture.broker.prepare({ sessionId: SESSION_B });
      writeEnvelope(prepared, '--help');
      writeEnvelope(sibling, '--status');
      const siblingBefore = snapshotTree(slotDirOf(sibling));
      let active = false;
      const boundaryFs = afterClaimCloseFs(prepared, () => {
        active = true;
        if (physical === 'symlink') {
          const parked = `${prepared.requestPath}.authenticated`;
          fs.renameSync(prepared.requestPath, parked);
          fs.symlinkSync(parked, prepared.requestPath);
        } else if (physical === 'wrong-mode') {
          fs.chmodSync(prepared.requestPath, 0o640);
        } else if (physical === 'non-regular') {
          fs.rmSync(prepared.requestPath);
          fs.mkdirSync(prepared.requestPath, { mode: 0o700 });
        }
      });
      const fsOps = physical === 'wrong-owner'
        ? withStatIdentityOverride(
          boundaryFs,
          prepared.requestPath,
          stat => active ? spoofStat(stat, { uid: UID + 1 }) : stat
        )
        : boundaryFs;
      const consumer = brokerForFixture(fixture, { fsOps });
      let parsed = false;
      await assertRejected(
        () => consumer.consume(identityOf(prepared), {
          parseRawArguments() { parsed = true; },
        }),
        'INVALID_ENTRY_REQUEST'
      );
      assert.equal(active, true, 'physical mutation did not occur after claim close');
      assert.equal(parsed, false);
      assert.equal(fs.existsSync(slotDirOf(prepared)), false, 'authenticated drifted slot was not cleaned');
      assertTreeUnchanged(slotDirOf(sibling), siblingBefore, `${physical} cleanup touched sibling`);
    } finally {
      fixture.cleanup();
    }
  });
}

test('[matrix G4] both request openings use numeric O_NOFOLLOW and the second supplies parser bytes', async () => {
  const fixture = makeFixture();
  try {
    const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
    writeEnvelope(prepared, '--help');
    const opens = [];
    const consumer = brokerForFixture(fixture, {
      fsOps: tracingFs((operation, args) => {
        if (isOpenOf(operation, args, prepared.requestPath)) opens.push(args);
      }),
    });
    let parserInput;
    await consumer.consume(identityOf(prepared), {
      parseRawArguments(raw) {
        parserInput = raw;
        return raw;
      },
    });
    assert.equal(opens.length, 2, 'request must be opened exactly once before and once after claim');
    for (const [, flags] of opens) {
      assert.equal(typeof flags, 'number');
      assert.ok((flags & fs.constants.O_NOFOLLOW) !== 0);
      assert.equal((flags & fs.constants.O_CREAT) !== 0, false);
    }
    assert.equal(parserInput, '--help');
  } finally {
    fixture.cleanup();
  }
});

for (const level of chainLevels) {
  for (const physical of ['wrong-owner', 'wrong-mode', 'non-directory']) {
    test(`[matrix G3] postclaim ${physical} ${level} blocks parser and preserves claim`, async () => {
      const fixture = makeFixture();
      try {
        const prepared = await fixture.broker.prepare({ sessionId: SESSION_A });
        writeEnvelope(prepared, '--help');
        const target = chainTarget(level, prepared, fixture.runtimeRoot);
        let active = false;
        let boundarySnapshot;
        const boundaryFs = afterClaimCloseFs(prepared, () => {
          active = true;
          boundarySnapshot = snapshotTree(slotDirOf(prepared));
        });
        const fsOps = withStatIdentityOverride(boundaryFs, target, stat => {
          if (!active) return stat;
          if (physical === 'wrong-owner') return spoofStat(stat, { uid: UID + 1 });
          if (physical === 'wrong-mode') {
            return spoofStat(stat, { mode: (stat.mode & ~0o777) | 0o755 });
          }
          return spoofStat(stat, { isDirectory: () => false });
        });
        const consumer = brokerForFixture(fixture, { fsOps });
        let parsed = false;
        await assertRejected(
          () => consumer.consume(identityOf(prepared), {
            parseRawArguments() { parsed = true; },
          }),
          'INVALID_ENTRY_REQUEST'
        );
        assert.equal(active, true);
        assert.equal(parsed, false);
        assertTreeUnchanged(
          slotDirOf(prepared),
          boundarySnapshot,
          `${physical} ${level} removed claimed diagnostic evidence`
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
}
