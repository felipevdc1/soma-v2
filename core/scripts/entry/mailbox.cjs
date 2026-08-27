'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { error, isSessionId, isRequestId, validateRequestEnvelope } = require('./request-schema.cjs');

const TTL_MS = 5 * 60 * 1000;
const LEASE_SCHEMA = 'soma-entry-lease/v1';

function mailboxError(code, message) {
  return error(code, message);
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return candidate;
  throw mailboxError('MAILBOX_INVALID', 'Mailbox path escapes its configured root');
}

function sessionDirectory(root, sessionId) {
  const digest = crypto.createHash('sha256').update(sessionId, 'utf8').digest('hex');
  return contained(root, path.join(root, digest));
}

function requestDirectory(root, sessionId, requestId, suffix = '') {
  return contained(root, path.join(sessionDirectory(root, sessionId), `${requestId}${suffix}`));
}

async function privateDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

async function acquirePrepareLock(prepareLock) {
  try {
    await fs.mkdir(prepareLock, { mode: 0o700 });
    return;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  let lockStat;
  try {
    lockStat = await fs.stat(prepareLock);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (lockStat && lockStat.mtimeMs + TTL_MS > Date.now()) {
    throw mailboxError('MAILBOX_BUSY', 'Mailbox request is being prepared');
  }
  if (lockStat) await fs.rm(prepareLock, { recursive: true, force: false });
  try {
    await fs.mkdir(prepareLock, { mode: 0o700 });
  } catch (err) {
    if (err.code === 'EEXIST') throw mailboxError('MAILBOX_BUSY', 'Mailbox request is being prepared');
    throw err;
  }
}

function leaseIsValid(lease, sessionId, requestId) {
  if (!lease || Array.isArray(lease) || typeof lease !== 'object') return false;
  const keys = Object.keys(lease).sort();
  const expected = ['createdAt', 'expiresAt', 'requestId', 'schema', 'sessionId'];
  if (keys.length !== expected.length || !expected.every(key => keys.includes(key))) return false;
  if (lease.schema !== LEASE_SCHEMA || lease.sessionId !== sessionId || lease.requestId !== requestId) return false;
  const createdAt = Date.parse(lease.createdAt);
  const expiresAt = Date.parse(lease.expiresAt);
  return Number.isFinite(createdAt) && Number.isFinite(expiresAt) && expiresAt - createdAt === TTL_MS;
}

async function readLease(dir, sessionId, requestId) {
  let lease;
  try {
    lease = JSON.parse(await fs.readFile(path.join(dir, 'lease.json'), 'utf8'));
  } catch (_) {
    throw mailboxError('MAILBOX_INVALID', 'Mailbox lease is malformed');
  }
  if (!leaseIsValid(lease, sessionId, requestId)) {
    throw mailboxError('MAILBOX_INVALID', 'Mailbox lease is invalid');
  }
  return lease;
}

async function validateRequestDirectory(dir, sessionId, requestId) {
  let entries;
  try {
    entries = (await fs.readdir(dir)).sort();
  } catch (err) {
    if (err.code === 'ENOENT') throw mailboxError('MAILBOX_NOT_FOUND', 'Mailbox request was not found');
    throw err;
  }
  if (entries.length !== 2 || entries[0] !== 'lease.json' || entries[1] !== 'request.json') {
    throw mailboxError('MAILBOX_INVALID', 'Mailbox request has unexpected files');
  }
  const lease = await readLease(dir, sessionId, requestId);
  return { lease, requestPath: path.join(dir, 'request.json') };
}

function assertSession(sessionId) {
  if (!isSessionId(sessionId)) throw mailboxError('INVALID_SESSION_ID', 'Invalid session identifier');
}

function assertRequest(requestId) {
  if (!isRequestId(requestId)) throw mailboxError('INVALID_REQUEST_ID', 'Invalid request identifier');
}

function createMailbox(options = {}) {
  const root = path.resolve(options.root || path.join(os.tmpdir(), 'soma-entry-v1'));

  async function prepare({ sessionId }) {
    assertSession(sessionId);
    await privateDirectory(root);
    const sessionDir = sessionDirectory(root, sessionId);
    await privateDirectory(sessionDir);
    const prepareLock = contained(root, path.join(sessionDir, '.prepare-lock'));
    await acquirePrepareLock(prepareLock);
    try {
      const entries = await fs.readdir(sessionDir);
      const requestEntries = entries.filter(entry => entry !== '.prepare-lock');
      if (requestEntries.length > 1) throw mailboxError('MAILBOX_INVALID', 'Mailbox session has unexpected residue');
      if (requestEntries.length === 1) {
        const entry = requestEntries[0];
        const active = /^([a-f0-9]{32})(\.claimed)?$/.exec(entry);
        if (!active) throw mailboxError('MAILBOX_INVALID', 'Mailbox session has unexpected residue');
        const activeDir = contained(root, path.join(sessionDir, entry));
        const { lease } = await validateRequestDirectory(activeDir, sessionId, active[1]);
        if (Date.parse(lease.expiresAt) > Date.now()) throw mailboxError('MAILBOX_BUSY', 'Mailbox request is still active');
        await fs.rm(activeDir, { recursive: true, force: false });
      }
      const requestId = crypto.randomBytes(16).toString('hex');
      const requestDir = requestDirectory(root, sessionId, requestId);
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(createdAt) + TTL_MS).toISOString();
      await privateDirectory(requestDir);
      await fs.writeFile(path.join(requestDir, 'lease.json'), JSON.stringify({ schema: LEASE_SCHEMA, sessionId, requestId, createdAt, expiresAt }), { mode: 0o600 });
      await fs.chmod(path.join(requestDir, 'lease.json'), 0o600);
      const requestPath = path.join(requestDir, 'request.json');
      await fs.writeFile(requestPath, '', { mode: 0o600 });
      await fs.chmod(requestPath, 0o600);
      return { sessionId, requestId, requestPath, expiresAt };
    } finally {
      await fs.rm(prepareLock, { recursive: true, force: true });
    }
  }

  async function consume({ sessionId, requestId }, parseEnvelope) {
    assertSession(sessionId);
    assertRequest(requestId);
    if (typeof parseEnvelope !== 'function') throw mailboxError('INVALID_ARGUMENTS', 'Mailbox parser must be a function');
    const unclaimed = requestDirectory(root, sessionId, requestId);
    const claimed = requestDirectory(root, sessionId, requestId, '.claimed');
    try {
      await fs.rename(unclaimed, claimed);
    } catch (err) {
      if (err.code === 'ENOENT') throw mailboxError('MAILBOX_NOT_FOUND', 'Mailbox request was not found');
      throw err;
    }
    try {
      const { lease, requestPath } = await validateRequestDirectory(claimed, sessionId, requestId);
      if (Date.parse(lease.expiresAt) <= Date.now()) throw mailboxError('MAILBOX_EXPIRED', 'Mailbox request has expired');
      const bytes = await fs.readFile(requestPath);
      const request = validateRequestEnvelope(bytes);
      if (request.sessionId !== sessionId || request.requestId !== requestId) {
        throw mailboxError('INVALID_REQUEST_ENVELOPE', 'Request envelope identity does not match mailbox');
      }
      return await parseEnvelope(bytes);
    } finally {
      await fs.rm(claimed, { recursive: true, force: true });
    }
  }

  async function abort({ sessionId, requestId }) {
    assertSession(sessionId);
    assertRequest(requestId);
    await fs.rm(requestDirectory(root, sessionId, requestId), { recursive: true, force: true });
  }

  async function selectNative({ sessionId }) {
    assertSession(sessionId);
    const sessionDir = sessionDirectory(root, sessionId);
    let entries;
    try {
      entries = await fs.readdir(sessionDir);
    } catch (err) {
      if (err.code === 'ENOENT') throw mailboxError('MAILBOX_NOT_FOUND', 'Mailbox request was not found');
      throw err;
    }
    if (entries.length === 0) throw mailboxError('MAILBOX_NOT_FOUND', 'Mailbox request was not found');
    if (entries.length !== 1) throw mailboxError('MAILBOX_INVALID', 'Mailbox session has ambiguous residue');
    const match = /^([a-f0-9]{32})$/.exec(entries[0]);
    if (!match) throw mailboxError('MAILBOX_INVALID', 'Mailbox session has invalid residue');
    const requestId = match[1];
    await validateRequestDirectory(requestDirectory(root, sessionId, requestId), sessionId, requestId);
    return { sessionId, requestId };
  }

  async function consumeNative({ sessionId }, parseEnvelope) {
    const selected = await selectNative({ sessionId });
    return consume(selected, parseEnvelope);
  }

  async function abortNative({ sessionId }) {
    const selected = await selectNative({ sessionId });
    await abort(selected);
  }

  return { prepare, consume, abort, selectNative, consumeNative, abortNative };
}

module.exports = { TTL_MS, createMailbox };
