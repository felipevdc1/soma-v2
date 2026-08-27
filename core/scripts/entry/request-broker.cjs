'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_RAW_ARGUMENT_BYTES,
  validateCapability,
  validateEntryRequest,
  validateRequestId,
  validateSessionId,
} = require('./request-schema.cjs');

const LEASE_SCHEMA = 'soma-entry-lease/v1';
const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 120_000;
const MAX_LEASE_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = MAX_RAW_ARGUMENT_BYTES + 4 * 1024;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const PREPARE_LOCK = '.prepare.claim';
const LEASE_KEYS = [
  '$schema',
  'capability',
  'createdMonotonicMs',
  'expiresMonotonicMs',
  'requestId',
  'requestPath',
  'sessionId',
  'ttlMs',
];

function brokerError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function isMissing(error) {
  return error && error.code === 'ENOENT';
}

function isAlreadyPresent(error) {
  return error && error.code === 'EEXIST';
}

function fileMode(stat) {
  return stat.mode & 0o777;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function monotonicNowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function normalizeTtl(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw brokerError('INVALID_ENTRY_REQUEST', 'ttlMs must be a positive integer');
  }
  return Math.min(value, MAX_TTL_MS);
}

function validateIdentity(identity) {
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)) {
    throw brokerError('INVALID_ENTRY_IDENTITY', 'entry identity must be an object');
  }
  return {
    sessionId: validateSessionId(identity.sessionId),
    requestId: validateRequestId(identity.requestId),
    capability: validateCapability(identity.capability),
  };
}

function identitiesEqual(left, right) {
  return left.sessionId === right.sessionId &&
    left.requestId === right.requestId &&
    left.capability === right.capability;
}

function assertExactKeys(value, expected, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw brokerError(code, `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw brokerError(code, `${label} has an invalid field set`);
  }
}

function validateLease(value, expectedRequestPath, code) {
  assertExactKeys(value, LEASE_KEYS, code, 'entry lease');
  if (value.$schema !== LEASE_SCHEMA) {
    throw brokerError(code, 'entry lease has an invalid schema');
  }
  try {
    validateSessionId(value.sessionId);
    validateRequestId(value.requestId);
    validateCapability(value.capability);
  } catch (error) {
    throw brokerError(code, 'entry lease has invalid identity', error);
  }
  if (value.requestPath !== expectedRequestPath || !path.isAbsolute(value.requestPath)) {
    throw brokerError(code, 'entry lease requestPath does not name its canonical slot');
  }
  for (const field of ['createdMonotonicMs', 'expiresMonotonicMs']) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw brokerError(code, `entry lease ${field} must be a finite monotonic timestamp`);
    }
  }
  if (!Number.isSafeInteger(value.ttlMs) || value.ttlMs <= 0 || value.ttlMs > MAX_TTL_MS) {
    throw brokerError(code, 'entry lease ttlMs is outside the bounded range');
  }
  if (value.expiresMonotonicMs !== value.createdMonotonicMs + value.ttlMs) {
    throw brokerError(code, 'entry lease expiry does not match its monotonic lifetime');
  }
  return value;
}

function preparedFromLease(lease) {
  return {
    sessionId: lease.sessionId,
    requestId: lease.requestId,
    capability: lease.capability,
    requestPath: lease.requestPath,
    ttlMs: lease.ttlMs,
    createdMonotonicMs: lease.createdMonotonicMs,
    expiresMonotonicMs: lease.expiresMonotonicMs,
  };
}

function createRequestBroker(options = {}) {
  const fsOps = options.fsOps || fs;
  const uid = options.uid === undefined
    ? (typeof process.getuid === 'function' ? process.getuid() : 0)
    : options.uid;
  const explicitRuntimeRoot = options.runtimeRoot === undefined
    ? null
    : path.resolve(options.runtimeRoot);
  const nowMonotonicMs = options.nowMonotonicMs || monotonicNowMs;
  const nowWallMs = options.nowWallMs || Date.now;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const ttlMs = normalizeTtl(options.ttlMs === undefined ? DEFAULT_TTL_MS : options.ttlMs);
  let cleanupSequence = 0;

  function lstat(file, missingCode = 'BROKER_CORRUPT') {
    try {
      return fsOps.lstatSync(file);
    } catch (error) {
      if (isMissing(error)) {
        throw brokerError(missingCode, `missing broker path: ${file}`, error);
      }
      throw brokerError('BROKER_CORRUPT', `cannot inspect broker path: ${file}`, error);
    }
  }

  function assertOwnedDirectory(file, missingCode = 'BROKER_CORRUPT') {
    const stat = lstat(file, missingCode);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw brokerError('BROKER_CORRUPT', `broker component is not a real directory: ${file}`);
    }
    if (stat.uid !== uid || fileMode(stat) !== DIRECTORY_MODE) {
      throw brokerError('BROKER_CORRUPT', `broker directory owner or mode is invalid: ${file}`);
    }
    return stat;
  }

  function assertOwnedRegular(file, code, missingCode = code) {
    const stat = lstat(file, missingCode);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw brokerError(code, `broker file is not a regular no-follow file: ${file}`);
    }
    if (stat.uid !== uid || fileMode(stat) !== FILE_MODE) {
      throw brokerError(code, `broker file owner or mode is invalid: ${file}`);
    }
    return stat;
  }

  function makeDirectory(file) {
    try {
      fsOps.mkdirSync(file, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (!isAlreadyPresent(error)) {
        throw brokerError('BROKER_CORRUPT', `cannot create broker directory: ${file}`, error);
      }
    }
    assertOwnedDirectory(file);
  }

  function resolveRuntimeRoot({ create }) {
    if (explicitRuntimeRoot !== null) return explicitRuntimeRoot;

    const candidate = process.env.XDG_RUNTIME_DIR;
    if (candidate) {
      const absoluteCandidate = path.resolve(candidate);
      try {
        assertOwnedDirectory(absoluteCandidate);
        return absoluteCandidate;
      } catch (_error) {
        // An unusable preferred runtime directory falls back to a private temp leaf.
      }
    }

    const fallback = path.join(os.tmpdir(), `soma-entry-runtime-${uid}`);
    if (create) makeDirectory(fallback);
    return fallback;
  }

  function rootsFor(sessionId, requestId, { create }) {
    const runtimeRoot = resolveRuntimeRoot({ create });
    const entryRoot = path.join(runtimeRoot, 'soma-entry');
    const brokerRoot = path.join(entryRoot, String(uid));
    const sessionDir = path.join(brokerRoot, sha256(sessionId));
    const slotDir = requestId ? path.join(sessionDir, requestId) : null;
    return { runtimeRoot, entryRoot, brokerRoot, sessionDir, slotDir };
  }

  function assertAuthenticatedChain(roots, {
    includeSlot,
    missingCode,
    errorCode = 'BROKER_CORRUPT',
  }) {
    try {
      const paths = [roots.runtimeRoot, roots.entryRoot, roots.brokerRoot, roots.sessionDir];
      if (includeSlot) paths.push(roots.slotDir);

      for (const component of paths) assertOwnedDirectory(component, missingCode);

      let canonicalRuntime;
      try {
        canonicalRuntime = fsOps.realpathSync(roots.runtimeRoot);
      } catch (error) {
        throw brokerError('BROKER_CORRUPT', 'cannot canonicalize broker runtime root', error);
      }
      for (const component of paths) {
        let canonical;
        try {
          canonical = fsOps.realpathSync(component);
        } catch (error) {
          throw brokerError('BROKER_CORRUPT', `cannot canonicalize broker component: ${component}`, error);
        }
        const relative = path.relative(roots.runtimeRoot, component);
        const expected = path.resolve(canonicalRuntime, relative);
        if (canonical !== expected) {
          throw brokerError('BROKER_CORRUPT', `broker component escapes canonical containment: ${component}`);
        }
        const containment = path.relative(canonicalRuntime, canonical);
        if (containment === '..' || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
          throw brokerError('BROKER_CORRUPT', `broker component escapes runtime root: ${component}`);
        }
      }
    } catch (error) {
      if (errorCode !== 'BROKER_CORRUPT' && error.code === 'BROKER_CORRUPT') {
        throw brokerError(errorCode, error.message, error);
      }
      throw error;
    }
  }

  function ensurePreparationChain(roots) {
    assertOwnedDirectory(roots.runtimeRoot);
    makeDirectory(roots.entryRoot);
    makeDirectory(roots.brokerRoot);
    makeDirectory(roots.sessionDir);
    assertAuthenticatedChain(roots, { includeSlot: false, missingCode: 'BROKER_CORRUPT' });
  }

  function openExclusive(file, bytes, code) {
    let descriptor;
    try {
      descriptor = fsOps.openSync(
        file,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        FILE_MODE
      );
      if (bytes.length > 0) fsOps.writeFileSync(descriptor, bytes);
      if (typeof fsOps.fsyncSync === 'function') fsOps.fsyncSync(descriptor);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fsOps.closeSync(descriptor); } catch (_closeError) {}
      }
      if (isAlreadyPresent(error)) throw brokerError(code, `exclusive broker claim already exists: ${file}`, error);
      throw brokerError(code, `cannot create exclusive broker file: ${file}`, error);
    }
    fsOps.closeSync(descriptor);
  }

  function readOwnedFile(file, { code, maxBytes }) {
    const before = assertOwnedRegular(file, code);
    if (before.size > maxBytes) throw brokerError(code, `broker file exceeds byte limit: ${file}`);

    let descriptor;
    try {
      descriptor = fsOps.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fsOps.fstatSync(descriptor);
      if (!stat.isFile() || stat.uid !== uid || fileMode(stat) !== FILE_MODE) {
        throw brokerError(code, `opened broker file owner, mode, or type is invalid: ${file}`);
      }
      if (stat.dev !== before.dev || stat.ino !== before.ino) {
        throw brokerError(code, `broker file changed while opening: ${file}`);
      }
      if (stat.size > maxBytes) throw brokerError(code, `broker file exceeds byte limit: ${file}`);
      const bytes = fsOps.readFileSync(descriptor);
      if (!Buffer.isBuffer(bytes) || bytes.length !== stat.size) {
        throw brokerError(code, `broker file changed while reading: ${file}`);
      }
      return { bytes, stat, sha256: sha256(bytes) };
    } catch (error) {
      if (error && error.code === code) throw error;
      throw brokerError(code, `cannot open broker file without following links: ${file}`, error);
    } finally {
      if (descriptor !== undefined) {
        try { fsOps.closeSync(descriptor); } catch (_error) {}
      }
    }
  }

  function parseJson(bytes, code, label) {
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw brokerError(code, `${label} is not valid JSON`, error);
    }
  }

  function readLease(roots, code) {
    const leasePath = path.join(roots.slotDir, 'lease.json');
    const data = readOwnedFile(leasePath, { code, maxBytes: MAX_LEASE_BYTES });
    return validateLease(parseJson(data.bytes, code, 'entry lease'), path.join(roots.slotDir, 'request.json'), code);
  }

  function acquirePrepareLock(sessionDir) {
    const lockPath = path.join(sessionDir, PREPARE_LOCK);
    try {
      openExclusive(lockPath, Buffer.alloc(0), 'BROKER_BUSY');
    } catch (error) {
      if (error.code === 'BROKER_BUSY') throw error;
      throw brokerError('BROKER_CORRUPT', 'cannot acquire same-session prepare lock', error);
    }
    return lockPath;
  }

  function releasePrepareLock(lockPath) {
    try {
      fsOps.unlinkSync(lockPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  function randomHex(size, label) {
    const bytes = randomBytes(size);
    if (!Buffer.isBuffer(bytes) || bytes.length !== size) {
      throw brokerError('BROKER_CORRUPT', `${label} generator returned invalid entropy`);
    }
    return bytes.toString('hex');
  }

  function listSlots(sessionDir) {
    let entries;
    try {
      entries = fsOps.readdirSync(sessionDir, { withFileTypes: true });
    } catch (error) {
      throw brokerError('BROKER_CORRUPT', 'cannot enumerate the current session broker directory', error);
    }
    return entries.filter(entry => entry.name !== PREPARE_LOCK);
  }

  function inspectExistingSlot(baseRoots, entry) {
    if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name)) {
      throw brokerError('BROKER_CORRUPT', 'session broker contains an invalid slot');
    }
    const roots = { ...baseRoots, slotDir: path.join(baseRoots.sessionDir, entry.name) };
    assertAuthenticatedChain(roots, { includeSlot: true, missingCode: 'BROKER_CORRUPT' });
    const lease = readLease(roots, 'BROKER_CORRUPT');
    if (lease.requestId !== entry.name) {
      throw brokerError('BROKER_CORRUPT', 'entry lease requestId does not match its slot');
    }
    const requestStat = assertOwnedRegular(lease.requestPath, 'BROKER_CORRUPT');
    return { roots, lease, requestStat };
  }

  function scavengeExpired(existing) {
    cleanupSequence += 1;
    const cleanupPath = path.join(
      path.dirname(existing.roots.slotDir),
      `.cleanup-${existing.lease.requestId}-${existing.lease.capability.slice(0, 16)}-${process.pid}-${cleanupSequence}`
    );
    try {
      fsOps.renameSync(existing.roots.slotDir, cleanupPath);
      fsOps.rmSync(cleanupPath, { recursive: true, force: false });
    } catch (error) {
      throw brokerError('BROKER_BUSY', 'expired broker slot could not be atomically scavenged', error);
    }
  }

  function createSlot(baseRoots, sessionId) {
    const requestId = randomHex(16, 'requestId');
    const capability = randomHex(32, 'capability');
    const slotDir = path.join(baseRoots.sessionDir, requestId);
    const requestPath = path.join(slotDir, 'request.json');
    const leasePath = path.join(slotDir, 'lease.json');
    const createdMonotonicMs = nowMonotonicMs();
    // Read the wall clock only as an observable dependency; it never contributes
    // to expiry and therefore cannot extend the lease.
    nowWallMs();
    const lease = {
      $schema: LEASE_SCHEMA,
      sessionId,
      requestId,
      capability,
      requestPath,
      ttlMs,
      createdMonotonicMs,
      expiresMonotonicMs: createdMonotonicMs + ttlMs,
    };

    try {
      fsOps.mkdirSync(slotDir, { mode: DIRECTORY_MODE });
      assertOwnedDirectory(slotDir);
      openExclusive(leasePath, Buffer.from(`${JSON.stringify(lease)}\n`), 'BROKER_BUSY');
      openExclusive(requestPath, Buffer.alloc(0), 'BROKER_BUSY');
    } catch (error) {
      try { fsOps.rmSync(slotDir, { recursive: true, force: true }); } catch (_cleanupError) {}
      throw error;
    }
    return preparedFromLease(lease);
  }

  async function prepare({ sessionId } = {}) {
    const validatedSessionId = validateSessionId(sessionId);
    const roots = rootsFor(validatedSessionId, null, { create: true });
    ensurePreparationChain(roots);
    const lockPath = acquirePrepareLock(roots.sessionDir);
    try {
      assertAuthenticatedChain(roots, { includeSlot: false, missingCode: 'BROKER_CORRUPT' });
      const entries = listSlots(roots.sessionDir);
      if (entries.length > 1) {
        throw brokerError('BROKER_CORRUPT', 'session broker contains multiple active slots');
      }
      if (entries.length === 1) {
        const existing = inspectExistingSlot(roots, entries[0]);
        if (nowMonotonicMs() <= existing.lease.expiresMonotonicMs) {
          if (existing.requestStat.size === 0) return preparedFromLease(existing.lease);
          throw brokerError('BROKER_BUSY', 'session already has a live entry request');
        }
        scavengeExpired(existing);
      }
      return createSlot(roots, validatedSessionId);
    } finally {
      releasePrepareLock(lockPath);
    }
  }

  function rootsForIdentity(identity) {
    return rootsFor(identity.sessionId, identity.requestId, { create: false });
  }

  function assertLive(lease) {
    if (nowMonotonicMs() > lease.expiresMonotonicMs) {
      throw brokerError('INVALID_ENTRY_REQUEST', 'entry request lease has expired');
    }
  }

  function openAndValidateBeforeClaim(identity, roots) {
    assertAuthenticatedChain(roots, { includeSlot: true, missingCode: 'NO_ENTRY_REQUEST' });
    const lease = readLease(roots, 'INVALID_ENTRY_REQUEST');
    const requestPath = path.join(roots.slotDir, 'request.json');
    const request = readOwnedFile(requestPath, {
      code: 'INVALID_ENTRY_REQUEST',
      maxBytes: MAX_REQUEST_BYTES,
    });
    const envelope = validateEntryRequest(parseJson(request.bytes, 'INVALID_ENTRY_REQUEST', 'entry request'));
    assertLive(lease);

    if (!identitiesEqual(identity, lease) || !identitiesEqual(identity, envelope)) {
      throw brokerError('ENTRY_IDENTITY_MISMATCH', 'argv, lease, and envelope identity do not agree');
    }
    if (lease.requestPath !== requestPath) {
      throw brokerError('INVALID_ENTRY_REQUEST', 'entry lease requestPath does not match the opened request');
    }
    assertLive(lease);
    return { lease, request, envelope };
  }

  function createClaim(roots, identity) {
    const claimPath = path.join(roots.slotDir, 'claim');
    try {
      openExclusive(
        claimPath,
        Buffer.from(`${JSON.stringify(identity)}\n`),
        'REQUEST_ALREADY_CONSUMED'
      );
    } catch (error) {
      if (error.code === 'REQUEST_ALREADY_CONSUMED') throw error;
      throw brokerError('REQUEST_ALREADY_CONSUMED', 'entry request could not be claimed', error);
    }
  }

  function compareOpenings(before, after) {
    return before.stat.dev === after.stat.dev &&
      before.stat.ino === after.stat.ino &&
      before.stat.size === after.stat.size &&
      before.sha256 === after.sha256 &&
      before.bytes.equals(after.bytes);
  }

  function claimStillAuthenticates(roots, identity) {
    try {
      assertAuthenticatedChain(roots, { includeSlot: true, missingCode: 'NO_ENTRY_REQUEST' });
      const lease = readLease(roots, 'INVALID_ENTRY_REQUEST');
      if (!identitiesEqual(identity, lease)) return false;
      const claim = readOwnedFile(path.join(roots.slotDir, 'claim'), {
        code: 'INVALID_ENTRY_REQUEST',
        maxBytes: MAX_LEASE_BYTES,
      });
      const claimIdentity = parseJson(claim.bytes, 'INVALID_ENTRY_REQUEST', 'entry claim');
      return identitiesEqual(identity, claimIdentity);
    } catch (_error) {
      return false;
    }
  }

  function cleanupClaimedSlot(roots, identity) {
    if (!claimStillAuthenticates(roots, identity)) return false;
    try {
      fsOps.rmSync(roots.slotDir, { recursive: true, force: false });
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw brokerError('BROKER_CORRUPT', 'cannot clean authenticated broker slot', error);
    }
  }

  function installSignalCleanup(cleanup) {
    const exitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
    const handlers = new Map();
    // A pending Promise alone does not keep Node alive. Keep the consumer alive
    // while routing is outstanding so its signal handlers can authenticate and
    // remove the claimed slot before exit.
    const keepAlive = setInterval(() => {}, 1_000);
    for (const signal of Object.keys(exitCodes)) {
      const handler = () => {
        try { cleanup(); } catch (_error) {}
        clearInterval(keepAlive);
        process.exit(exitCodes[signal]);
      };
      handlers.set(signal, handler);
      process.once(signal, handler);
    }
    return () => {
      clearInterval(keepAlive);
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    };
  }

  async function consume(identityInput, { parseRawArguments } = {}) {
    const identity = validateIdentity(identityInput);
    if (typeof parseRawArguments !== 'function') {
      throw brokerError('INVALID_ENTRY_REQUEST', 'consume requires a rawArguments parser');
    }
    const roots = rootsForIdentity(identity);
    let claimed = false;
    let removeSignalHandlers = () => {};
    try {
      const before = openAndValidateBeforeClaim(identity, roots);
      createClaim(roots, identity);
      claimed = true;
      removeSignalHandlers = installSignalCleanup(() => cleanupClaimedSlot(roots, identity));

      // The pre-claim request descriptor was closed by readOwnedFile. Authenticate
      // the full chain again before a new canonical no-follow opening.
      assertAuthenticatedChain(roots, {
        includeSlot: true,
        missingCode: 'INVALID_ENTRY_REQUEST',
        errorCode: 'INVALID_ENTRY_REQUEST',
      });
      const reopened = readOwnedFile(path.join(roots.slotDir, 'request.json'), {
        code: 'INVALID_ENTRY_REQUEST',
        maxBytes: MAX_REQUEST_BYTES,
      });
      if (!compareOpenings(before.request, reopened)) {
        throw brokerError('INVALID_ENTRY_REQUEST', 'entry request changed after its atomic claim');
      }
      const reopenedEnvelope = validateEntryRequest(
        parseJson(reopened.bytes, 'INVALID_ENTRY_REQUEST', 'reopened entry request')
      );
      if (!identitiesEqual(identity, reopenedEnvelope)) {
        throw brokerError('INVALID_ENTRY_REQUEST', 'reopened entry request identity changed');
      }

      const parsed = await parseRawArguments(reopenedEnvelope.rawArguments);
      return {
        requestSha256: reopened.sha256,
        rawArguments: reopenedEnvelope.rawArguments,
        parsed,
      };
    } finally {
      removeSignalHandlers();
      if (claimed) cleanupClaimedSlot(roots, identity);
    }
  }

  async function abort(identityInput) {
    const identity = validateIdentity(identityInput);
    const roots = rootsForIdentity(identity);
    try {
      assertAuthenticatedChain(roots, { includeSlot: true, missingCode: 'NO_ENTRY_REQUEST' });
    } catch (error) {
      if (error.code === 'NO_ENTRY_REQUEST') return { status: 'absent', aborted: false };
      throw error;
    }

    const lease = readLease(roots, 'INVALID_ENTRY_REQUEST');
    assertOwnedRegular(path.join(roots.slotDir, 'request.json'), 'INVALID_ENTRY_REQUEST');
    if (!identitiesEqual(identity, lease)) {
      throw brokerError('ENTRY_IDENTITY_MISMATCH', 'abort identity does not match the entry lease');
    }

    let claimed = false;
    let removeSignalHandlers = () => {};
    try {
      createClaim(roots, identity);
      claimed = true;
      removeSignalHandlers = installSignalCleanup(() => cleanupClaimedSlot(roots, identity));
      return { status: 'aborted', aborted: true };
    } finally {
      removeSignalHandlers();
      if (claimed) cleanupClaimedSlot(roots, identity);
    }
  }

  return { prepare, consume, abort };
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  createRequestBroker,
};
