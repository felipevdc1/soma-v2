'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createMailbox } = require('../entry/mailbox.cjs');
const { validateRequestEnvelope } = require('../entry/request-schema.cjs');

const SESSION = 'codex.session:1';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-entry-test-'));
  return {
    root,
    mailbox: createMailbox({ root }),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

function envelope(sessionId, requestId, rawArguments) {
  return JSON.stringify({
    $schema: 'soma-entry-request/v1',
    sessionId,
    requestId,
    rawArguments,
  });
}

async function writeRequest(prepared, sessionId, rawArguments) {
  await fs.writeFile(prepared.requestPath, envelope(sessionId, prepared.requestId, rawArguments), { mode: 0o600 });
}

test('mailbox round-trips exact UTF-8 envelope bytes without interpreting shell syntax', async () => {
  const f = await fixture();
  const rawArguments = "start 'objetivo $() ; | `eco`' --project /tmp/naïve\n";
  const sentinel = path.join(f.root, 'sentinel');
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    await writeRequest(prepared, SESSION, rawArguments);
    const result = await f.mailbox.consume(
      { sessionId: SESSION, requestId: prepared.requestId },
      (bytes) => {
        assert.ok(Buffer.isBuffer(bytes));
        assert.equal(bytes.toString('utf8'), envelope(SESSION, prepared.requestId, rawArguments));
        return { rawArguments: JSON.parse(bytes).rawArguments };
      }
    );
    assert.equal(result.rawArguments, rawArguments);
    await assert.rejects(fs.stat(sentinel), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test('mailbox rejects invalid session identifiers before touching its root', async () => {
  const root = path.join(os.tmpdir(), `soma-entry-missing-${crypto.randomUUID()}`);
  const mailbox = createMailbox({ root });
  await assert.rejects(mailbox.prepare({ sessionId: '../escape' }), { code: 'INVALID_SESSION_ID' });
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('mailbox creates private contained paths and enforces one live request per session', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    const rootStat = await fs.stat(f.root);
    const requestStat = await fs.stat(path.dirname(prepared.requestPath));
    assert.equal(rootStat.mode & 0o777, 0o700);
    assert.equal(requestStat.mode & 0o777, 0o700);
    assert.equal((await fs.stat(prepared.requestPath)).mode & 0o777, 0o600);
    assert.deepEqual((await fs.readdir(path.dirname(prepared.requestPath))).sort(), ['lease.json', 'request.json']);
    assert.ok(path.relative(path.resolve(f.root), prepared.requestPath).split(path.sep).every(part => part !== '..'));
    await assert.rejects(f.mailbox.prepare({ sessionId: SESSION }), { code: 'MAILBOX_BUSY' });
  } finally {
    await f.cleanup();
  }
});

test('concurrent prepare calls leave exactly one live request for a session', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([
      f.mailbox.prepare({ sessionId: SESSION }),
      f.mailbox.prepare({ sessionId: SESSION }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'MAILBOX_BUSY').length, 1);
  } finally {
    await f.cleanup();
  }
});

test('mailbox reports a live prepare lock as busy', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    const sessionDir = path.dirname(path.dirname(prepared.requestPath));
    await f.mailbox.abort({ sessionId: SESSION, requestId: prepared.requestId });
    await fs.mkdir(path.join(sessionDir, '.prepare-lock'), { mode: 0o700 });

    await assert.rejects(f.mailbox.prepare({ sessionId: SESSION }), { code: 'MAILBOX_BUSY' });
  } finally {
    await f.cleanup();
  }
});

test('mailbox replaces an expired prepare lock and prepares a request', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    const sessionDir = path.dirname(path.dirname(prepared.requestPath));
    await f.mailbox.abort({ sessionId: SESSION, requestId: prepared.requestId });
    const prepareLock = path.join(sessionDir, '.prepare-lock');
    await fs.mkdir(prepareLock, { mode: 0o700 });
    const expired = new Date(Date.now() - (5 * 60 * 1000) - 1_000);
    await fs.utimes(prepareLock, expired, expired);

    const replacement = await f.mailbox.prepare({ sessionId: SESSION });
    assert.match(replacement.requestId, /^[a-f0-9]{32}$/);
  } finally {
    await f.cleanup();
  }
});

test('mailbox allows one atomic consumer, rejects replay, and cleans up after parser interruption', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    await writeRequest(prepared, SESSION, '--help');
    const results = await Promise.allSettled([
      f.mailbox.consume({ sessionId: SESSION, requestId: prepared.requestId }, () => ({ winner: true })),
      f.mailbox.consume({ sessionId: SESSION, requestId: prepared.requestId }, () => ({ winner: true })),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(
      f.mailbox.consume({ sessionId: SESSION, requestId: prepared.requestId }, () => ({})),
      { code: 'MAILBOX_NOT_FOUND' }
    );

    const interrupted = await f.mailbox.prepare({ sessionId: SESSION });
    await writeRequest(interrupted, SESSION, '--help');
    await assert.rejects(
      f.mailbox.consume({ sessionId: SESSION, requestId: interrupted.requestId }, () => { throw new Error('parser interrupted'); }),
      /parser interrupted/
    );
    await assert.rejects(fs.stat(path.dirname(interrupted.requestPath)), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test('mailbox removes expired valid requests but preserves malformed and unexpected residue', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    const leasePath = path.join(path.dirname(prepared.requestPath), 'lease.json');
    const lease = JSON.parse(await fs.readFile(leasePath, 'utf8'));
    lease.createdAt = new Date(Date.now() - (5 * 60 * 1000) - 1_000).toISOString();
    lease.expiresAt = new Date(Date.parse(lease.createdAt) + (5 * 60 * 1000)).toISOString();
    await fs.writeFile(leasePath, JSON.stringify(lease), { mode: 0o600 });
    const replacement = await f.mailbox.prepare({ sessionId: SESSION });
    assert.notEqual(replacement.requestId, prepared.requestId);
    await f.mailbox.abort({ sessionId: SESSION, requestId: replacement.requestId });

    const malformed = await f.mailbox.prepare({ sessionId: SESSION });
    await fs.writeFile(path.join(path.dirname(malformed.requestPath), 'lease.json'), '{not json', { mode: 0o600 });
    await assert.rejects(f.mailbox.prepare({ sessionId: SESSION }), { code: 'MAILBOX_INVALID' });
    assert.equal(await fs.readFile(path.join(path.dirname(malformed.requestPath), 'lease.json'), 'utf8'), '{not json');
    await f.mailbox.abort({ sessionId: SESSION, requestId: malformed.requestId });

    const nonCanonicalLease = await f.mailbox.prepare({ sessionId: SESSION });
    const nonCanonicalLeasePath = path.join(path.dirname(nonCanonicalLease.requestPath), 'lease.json');
    const nonCanonicalLeaseValue = JSON.parse(await fs.readFile(nonCanonicalLeasePath, 'utf8'));
    nonCanonicalLeaseValue.createdAt = 0;
    nonCanonicalLeaseValue.expiresAt = 300000;
    await fs.writeFile(nonCanonicalLeasePath, JSON.stringify(nonCanonicalLeaseValue), { mode: 0o600 });
    await assert.rejects(f.mailbox.prepare({ sessionId: SESSION }), { code: 'MAILBOX_INVALID' });
    await f.mailbox.abort({ sessionId: SESSION, requestId: nonCanonicalLease.requestId });

    const unexpected = await f.mailbox.prepare({ sessionId: SESSION });
    const unexpectedPath = path.join(path.dirname(unexpected.requestPath), 'surplus');
    await fs.writeFile(unexpectedPath, 'keep');
    await assert.rejects(f.mailbox.prepare({ sessionId: SESSION }), { code: 'MAILBOX_INVALID' });
    assert.equal(await fs.readFile(unexpectedPath, 'utf8'), 'keep');
  } finally {
    await f.cleanup();
  }
});

test('mailbox recovers a valid expired claimed request before preparing its replacement', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    const requestDir = path.dirname(prepared.requestPath);
    const leasePath = path.join(requestDir, 'lease.json');
    const lease = JSON.parse(await fs.readFile(leasePath, 'utf8'));
    lease.createdAt = new Date(Date.now() - (5 * 60 * 1000) - 1_000).toISOString();
    lease.expiresAt = new Date(Date.parse(lease.createdAt) + (5 * 60 * 1000)).toISOString();
    await fs.writeFile(leasePath, JSON.stringify(lease), { mode: 0o600 });
    await fs.rename(requestDir, `${requestDir}.claimed`);

    const replacement = await f.mailbox.prepare({ sessionId: SESSION });
    assert.notEqual(replacement.requestId, prepared.requestId);
    await assert.rejects(fs.stat(`${requestDir}.claimed`), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test('mailbox preserves a malformed claimed request and reports MAILBOX_INVALID', async () => {
  const f = await fixture();
  try {
    const prepared = await f.mailbox.prepare({ sessionId: SESSION });
    const requestDir = path.dirname(prepared.requestPath);
    await fs.rename(requestDir, `${requestDir}.claimed`);
    const malformedLease = path.join(`${requestDir}.claimed`, 'lease.json');
    await fs.writeFile(malformedLease, '{not json', { mode: 0o600 });

    await assert.rejects(f.mailbox.prepare({ sessionId: SESSION }), { code: 'MAILBOX_INVALID' });
    assert.equal(await fs.readFile(malformedLease, 'utf8'), '{not json');
  } finally {
    await f.cleanup();
  }
});

test('mailbox abort is idempotent and sessions stay isolated', async () => {
  const f = await fixture();
  try {
    const first = await f.mailbox.prepare({ sessionId: SESSION });
    const second = await f.mailbox.prepare({ sessionId: 'claude.session:2' });
    await f.mailbox.abort({ sessionId: SESSION, requestId: first.requestId });
    await f.mailbox.abort({ sessionId: SESSION, requestId: first.requestId });
    assert.ok(await fs.stat(second.requestPath));
    await f.mailbox.abort({ sessionId: 'claude.session:2', requestId: second.requestId });
  } finally {
    await f.cleanup();
  }
});

test('request envelope accepts only its exact bounded schema', () => {
  const requestId = 'a'.repeat(32);
  assert.deepEqual(
    validateRequestEnvelope(Buffer.from(envelope(SESSION, requestId, 'run'))),
    { $schema: 'soma-entry-request/v1', sessionId: SESSION, requestId, rawArguments: 'run' }
  );
  for (const value of [
    JSON.stringify({ $schema: 'soma-entry-request/v1', sessionId: SESSION, requestId, rawArguments: 'run', extra: true }),
    JSON.stringify({ $schema: 'soma-entry-request/v1', sessionId: SESSION, requestId, rawArguments: 1 }),
    envelope(SESSION, requestId, 'x'.repeat(65 * 1024)),
  ]) {
    assert.throws(() => validateRequestEnvelope(Buffer.from(value)), { code: 'INVALID_REQUEST_ENVELOPE' });
  }
});
