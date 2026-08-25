'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE_PATH = path.resolve(__dirname, '..', 'global-transaction.cjs');
const transaction = require(MODULE_PATH);

const FORWARD_STATES = [
  'PREPARED',
  'ADOPTED',
  'CORE_COPIED',
  'FILES_SYNCED',
  'SETTINGS_MERGED',
  'ANCHORS_SYNCED',
  'VERIFIED',
  'COMMITTED',
];

function writeFile(filePath, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function candidateManifests() {
  return {
    claude: {
      schema: 'soma-install-targets/v1',
      tool: 'claude',
      entries: [
        {
          kind: 'file',
          source_path: 'hooks/soma-hook.cjs',
          target_path: '~/.claude/hooks/soma-hook.cjs',
        },
        {
          kind: 'file',
          source_path: 'adapters/claude/commands/new-command.md',
          target_path: '~/.claude/commands/new-command.md',
        },
        {
          block_id: 'block.claude.CLAUDE_md.hyd-v2',
          source_doc: 'docs/hyd-v2.md',
          target_path: '~/.claude/CLAUDE.md',
          target_anchor_id: 'block.claude.CLAUDE_md.hyd-v2',
        },
        {
          block_id: 'block.claude.CLAUDE_md.soma-stsd',
          source_doc: 'docs/soma-stsd.md',
          target_path: '~/.claude/CLAUDE.md',
          target_anchor_id: 'block.claude.CLAUDE_md.soma-stsd',
        },
      ],
    },
    codex: {
      schema: 'soma-install-targets/v1',
      tool: 'codex',
      entries: [
        {
          block_id: 'block.codex.AGENTS.hyd-v2',
          source_doc: 'docs/hyd-v2.md',
          target_path: '~/.codex/AGENTS.md',
          target_anchor_id: 'block.codex.AGENTS.hyd-v2',
        },
        {
          block_id: 'block.codex.home.soma-stsd',
          source_doc: 'docs/soma-stsd.md',
          target_path: '~/AGENTS.md',
          target_anchor_id: 'block.codex.home.soma-stsd',
        },
      ],
    },
  };
}

function makeFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-global-transaction-'));
  const repoRoot = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const backupRoot = path.join(home, '.soma-v2-backups');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const manifests = candidateManifests();
  if (typeof options.mutateManifests === 'function') options.mutateManifests(manifests);

  writeJson(path.join(repoRoot, 'core', 'adapters', 'claude', 'install-targets.json'), manifests.claude);
  writeJson(path.join(repoRoot, 'core', 'adapters', 'codex', 'install-targets.json'), manifests.codex);
  writeFile(path.join(repoRoot, 'core', 'hooks', 'soma-hook.cjs'), 'candidate hook\n', 0o755);
  writeFile(path.join(repoRoot, 'core', 'adapters', 'claude', 'commands', 'new-command.md'), 'new command\n');
  writeFile(path.join(repoRoot, 'core', 'docs', 'hyd-v2.md'), 'hyd\n');
  writeFile(path.join(repoRoot, 'core', 'docs', 'soma-stsd.md'), 'stsd\n');
  writeFile(path.join(repoRoot, 'templates', 'decision.md'), 'candidate template\n');
  writeFile(path.join(repoRoot, 'output-styles', 'soma.md'), 'candidate style\n');

  writeFile(path.join(home, '.claude', 'settings.json'), '{"user":true}\n', 0o640);
  writeFile(path.join(home, '.claude', 'CLAUDE.md'), 'old claude\n', 0o600);
  writeFile(path.join(home, '.claude', 'hooks', 'soma-hook.cjs'), 'old hook\n', 0o700);
  writeFile(path.join(home, '.codex', 'AGENTS.md'), 'old codex\n', 0o640);
  writeFile(path.join(home, 'AGENTS.md'), 'old home agents\n', 0o644);
  writeFile(path.join(home, '.claude', 'templates', 'decision.md'), 'old template\n', 0o600);

  if (options.withOld !== false) {
    writeJson(path.join(home, '.soma-v2', 'manifest.json'), {
      schema: 'soma-manifest/v1',
      version: 'old',
      files: [],
    });
    writeJson(
      path.join(home, '.soma-v2', 'adapters', 'claude', 'install-targets.json'),
      manifests.claude
    );
    writeJson(
      path.join(home, '.soma-v2', 'adapters', 'codex', 'install-targets.json'),
      manifests.codex
    );
    writeFile(path.join(home, '.soma-v2', 'keep', 'user-state.txt'), 'preserve whole tree\n', 0o600);
  }

  return {
    root,
    repoRoot,
    home,
    backupRoot,
    pointerPath: path.join(backupRoot, '.active-transaction.json'),
    prepare(overrides = {}) {
      return transaction.prepareTransaction({
        repoRoot,
        home,
        backupRoot,
        sourceSha: '307c51bc7f7111e846e4730f104cade8527ae6fd',
        ...overrides,
      });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readMode(filePath) {
  return fs.statSync(filePath).mode & 0o7777;
}

function pointerMatches(pointerPath) {
  const pointer = readJson(pointerPath);
  const selectedPath = pointer.generation_path || pointer.transaction_path;
  const current = crypto.createHash('sha256').update(fs.readFileSync(selectedPath)).digest('hex');
  assert.equal(pointer.journal_sha256, current);
  assert.equal(path.isAbsolute(pointer.transaction_path), true);
  return pointer;
}

function rewriteJournalAndPointer(journalPath, mutate) {
  const journal = readJson(journalPath);
  mutate(journal);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  const generationPath = path.join(
    path.dirname(journalPath),
    `transaction.test-rewrite-${crypto.randomBytes(8).toString('hex')}.json`
  );
  fs.writeFileSync(generationPath, `${JSON.stringify(journal, null, 2)}\n`);
  const pointerPath = path.join(journal.backup_root, '.active-transaction.json');
  writeJson(pointerPath, {
    schema: 'soma-global-install-transaction-pointer/v1',
    transaction_path: journalPath,
    generation_path: generationPath,
    journal_sha256: crypto.createHash('sha256').update(fs.readFileSync(generationPath)).digest('hex'),
  });
}

function advanceTo(journalPath, state) {
  const targetIndex = FORWARD_STATES.indexOf(state);
  assert.notEqual(targetIndex, -1);
  for (let i = 1; i <= targetIndex; i += 1) {
    transaction.advanceTransaction(journalPath, FORWARD_STATES[i]);
  }
}

test('exports only the fixed Task 2 API', () => {
  assert.deepEqual(Object.keys(transaction).sort(), [
    'advanceTransaction',
    'hashFile',
    'hashTree',
    'prepareTransaction',
    'recoverActiveTransaction',
    'rollbackTransaction',
    'verifyPreparedAuthorization',
  ]);
});

test('prepare publishes a complete PREPARED snapshot and an authenticated pointer', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  assert.equal(fs.existsSync(fx.backupRoot), false);
  assert.equal(fs.existsSync(fx.pointerPath), false);

  const prepared = fx.prepare();
  assert.equal(prepared.state, 'PREPARED');
  assert.equal(path.isAbsolute(prepared.journal_path), true);
  assert.equal(fs.existsSync(prepared.journal_path), true);
  const pointer = pointerMatches(fx.pointerPath);
  assert.equal(pointer.transaction_path, prepared.journal_path);

  const journal = readJson(prepared.journal_path);
  assert.deepEqual(journal.phases.map((phase) => phase.state), ['PREPARING', 'PREPARED']);
  assert.equal(journal.source_sha, '307c51bc7f7111e846e4730f104cade8527ae6fd');
  const byTarget = new Map(journal.snapshots.map((snapshot) => [snapshot.target_path, snapshot]));
  const hook = byTarget.get(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'));
  assert.equal(hook.existed, true);
  assert.equal(hook.mode, 0o700);
  assert.equal(fs.readFileSync(hook.snapshot_path, 'utf8'), 'old hook\n');
  const absent = byTarget.get(path.join(fx.home, '.claude', 'commands', 'new-command.md'));
  assert.equal(absent.existed, false);
  assert.deepEqual(absent.missing_ancestors, [path.join(fx.home, '.claude', 'commands')]);
  const somaTree = byTarget.get(path.join(fx.home, '.soma-v2'));
  assert.equal(somaTree.kind, 'directory');
  assert.equal(somaTree.existed, true);
  assert.equal(transaction.hashTree(somaTree.snapshot_path), transaction.hashTree(path.join(fx.home, '.soma-v2')));
  assert.equal(byTarget.has(path.join(fx.home, '.claude', 'templates', 'decision.md')), true);
  assert.equal(byTarget.has(path.join(fx.home, '.claude', 'output-styles', 'soma.md')), true);
});

test('advance enforces the exact forward state machine and refreshes pointer hash', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const prepared = fx.prepare();
  assert.throws(
    () => transaction.advanceTransaction(prepared.journal_path, 'FILES_SYNCED'),
    (error) => error && error.code === 'INVALID_TRANSITION'
  );
  assert.throws(
    () => transaction.advanceTransaction(prepared.journal_path, 'UNKNOWN'),
    (error) => error && error.code === 'INVALID_TRANSITION'
  );

  for (const state of FORWARD_STATES.slice(1)) {
    const journal = transaction.advanceTransaction(prepared.journal_path, state);
    assert.equal(journal.state, state);
    if (state === 'COMMITTED') assert.equal(fs.existsSync(fx.pointerPath), false);
    else pointerMatches(fx.pointerPath);
  }
  assert.equal(fs.existsSync(fx.pointerPath), false);
});

test('crash after publishing a newer journal generation keeps the old authenticated generation recoverable', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const prepared = fx.prepare();
  const pointer = readJson(fx.pointerPath);
  const selectedPath = pointer.generation_path || pointer.transaction_path;
  const orphan = readJson(selectedPath);
  orphan.state = 'ADOPTED';
  orphan.phases.push({ state: 'ADOPTED', at: new Date().toISOString() });

  const orphanPath = pointer.generation_path
    ? path.join(orphan.transaction_dir, 'transaction.99999999.json')
    : selectedPath;
  fs.writeFileSync(orphanPath, `${JSON.stringify(orphan, null, 2)}\n`);
  writeFile(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'partial install bytes\n', 0o755);

  const recovered = transaction.recoverActiveTransaction(fx.backupRoot);
  assert.equal(recovered.status, 'ROLLED_BACK');
  assert.equal(fs.readFileSync(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'utf8'), 'old hook\n');
  assert.equal(fs.existsSync(fx.pointerPath), false);
  assert.equal(fs.existsSync(prepared.journal_path), true);
});

test('each published state has a distinct immutable generation selected by the pointer', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const prepared = fx.prepare();
  const preparedPointer = pointerMatches(fx.pointerPath);
  const preparedGeneration = preparedPointer.generation_path;
  assert.ok(preparedGeneration, 'pointer must select an immutable generation path');
  const preparedBytes = fs.readFileSync(preparedGeneration);

  transaction.advanceTransaction(prepared.journal_path, 'ADOPTED');
  const adoptedPointer = pointerMatches(fx.pointerPath);
  assert.notEqual(adoptedPointer.generation_path, preparedGeneration);
  assert.deepEqual(fs.readFileSync(preparedGeneration), preparedBytes, 'published generation must never be replaced');
});

function runFaultingCli(args, fault) {
  return spawnSync(process.execPath, [MODULE_PATH, ...args], {
    env: {
      ...process.env,
      SOMA_INSTALL_TESTING: '1',
      SOMA_TRANSACTION_FAULT_AFTER: fault,
    },
    encoding: 'utf8',
  });
}

function runCrashingPrepare(fx) {
  return spawnSync(process.execPath, [
    MODULE_PATH,
    'prepare',
    '--repo-root', fx.repoRoot,
    '--home', fx.home,
    '--backup-root', fx.backupRoot,
    '--source-sha', '307c51bc7f7111e846e4730f104cade8527ae6fd',
  ], {
    env: {
      ...process.env,
      HOME: fx.home,
      SOMA_INSTALL_TESTING: '1',
      SOMA_TRANSACTION_CRASH_AFTER: 'PREPARING:pointer',
    },
    encoding: 'utf8',
  });
}

function captureDurability(run, failPath = null) {
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const originalFsync = fs.fsyncSync;
  const originalRename = fs.renameSync;
  const descriptors = new Map();
  const events = [];
  fs.openSync = function patchedOpen(filePath, ...args) {
    const fd = originalOpen.call(this, filePath, ...args);
    descriptors.set(fd, path.resolve(String(filePath)));
    return fd;
  };
  fs.closeSync = function patchedClose(fd, ...args) {
    try {
      return originalClose.call(this, fd, ...args);
    } finally {
      descriptors.delete(fd);
    }
  };
  fs.fsyncSync = function patchedFsync(fd, ...args) {
    const filePath = descriptors.get(fd) || `<fd:${fd}>`;
    events.push(`fsync:${filePath}`);
    if (failPath && filePath === path.resolve(failPath)) {
      throw Object.assign(new Error(`injected fsync failure: ${filePath}`), { code: 'EIO' });
    }
    return originalFsync.call(this, fd, ...args);
  };
  fs.renameSync = function patchedRename(source, destination, ...args) {
    const result = originalRename.call(this, source, destination, ...args);
    if (path.basename(String(destination)) === '.active-transaction.json') {
      const pointer = readJson(destination);
      const selected = readJson(pointer.generation_path || pointer.transaction_path);
      events.push(`pointer:${selected.state}`);
    }
    return result;
  };
  try {
    return { result: run(), events };
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
    fs.fsyncSync = originalFsync;
    fs.renameSync = originalRename;
  }
}

function durablePaths(rootPath) {
  const stat = fs.lstatSync(rootPath);
  if (stat.isFile()) return [rootPath];
  const paths = [];
  for (const name of fs.readdirSync(rootPath).sort()) {
    paths.push(...durablePaths(path.join(rootPath, name)));
  }
  paths.push(rootPath);
  return paths;
}

test('hard death after the initial PREPARING pointer recovers without a compatibility view', async (t) => {
  for (const compatibility of ['missing', 'torn']) {
    await t.test(compatibility, () => {
      const fx = makeFixture();
      try {
        const crashed = runCrashingPrepare(fx);
        assert.equal(crashed.signal, 'SIGKILL', `${crashed.stdout}\n${crashed.stderr}`);
        assert.equal(fs.existsSync(fx.pointerPath), true);
        const pointer = pointerMatches(fx.pointerPath);
        assert.equal(readJson(pointer.generation_path).state, 'PREPARING');
        assert.equal(fs.existsSync(pointer.transaction_path), false);
        if (compatibility === 'torn') fs.writeFileSync(pointer.transaction_path, '{torn');

        const recovered = transaction.recoverActiveTransaction(fx.backupRoot);
        assert.equal(recovered.status, 'ROLLED_BACK', JSON.stringify(recovered));
        assert.equal(fs.readFileSync(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'utf8'), 'old hook\n');
        assert.equal(fs.existsSync(fx.pointerPath), false);
      } finally {
        fx.cleanup();
      }
    });
  }
});

test('durability barriers precede PREPARED, ROLLBACK_VERIFIED, VERIFIED and COMMITTED publication', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());

  let prepared;
  const prepareCapture = captureDurability(() => {
    prepared = fx.prepare();
    return prepared;
  });
  const preparedIndex = prepareCapture.events.indexOf('pointer:PREPARED');
  assert.notEqual(preparedIndex, -1);
  for (const snapshot of prepared.snapshots.filter((entry) => entry.existed)) {
    for (const durablePath of durablePaths(snapshot.snapshot_path)) {
      const syncIndex = prepareCapture.events.indexOf(`fsync:${durablePath}`);
      assert.ok(syncIndex !== -1 && syncIndex < preparedIndex, `${durablePath} must be durable before PREPARED`);
    }
  }

  const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
  writeFile(hookPath, 'partial bytes\n', 0o755);
  fs.rmSync(path.join(fx.home, '.soma-v2'), { recursive: true, force: true });
  writeFile(path.join(fx.home, '.soma-v2', 'partial.txt'), 'partial tree\n');
  const rollbackCapture = captureDurability(() => transaction.rollbackTransaction(prepared.journal_path));
  const rollbackVerifiedIndex = rollbackCapture.events.indexOf('pointer:ROLLBACK_VERIFIED');
  assert.notEqual(rollbackVerifiedIndex, -1);
  for (const restoredPath of [hookPath, ...durablePaths(path.join(fx.home, '.soma-v2'))]) {
    const syncIndex = rollbackCapture.events.indexOf(`fsync:${restoredPath}`);
    assert.ok(syncIndex !== -1 && syncIndex < rollbackVerifiedIndex, `${restoredPath} must be durable before rollback verification`);
  }

  const next = fx.prepare();
  advanceTo(next.journal_path, 'ANCHORS_SYNCED');
  const ledgerPath = path.join(fx.home, '.soma-v2', '.soma', 'install-state.json');
  writeFile(ledgerPath, '{"schema":"test"}\n');
  const verifiedCapture = captureDurability(() => transaction.advanceTransaction(next.journal_path, 'VERIFIED'));
  const verifiedIndex = verifiedCapture.events.indexOf('pointer:VERIFIED');
  assert.notEqual(verifiedIndex, -1);
  for (const target of next.snapshots.map((entry) => entry.target_path).filter((entry) => fs.existsSync(entry))) {
    for (const durablePath of durablePaths(target)) {
      const syncIndex = verifiedCapture.events.indexOf(`fsync:${durablePath}`);
      assert.ok(syncIndex !== -1 && syncIndex < verifiedIndex, `${durablePath} must be durable before VERIFIED`);
    }
  }
  assert.ok(verifiedCapture.events.indexOf(`fsync:${ledgerPath}`) < verifiedIndex);

  const committedCapture = captureDurability(() => transaction.advanceTransaction(next.journal_path, 'COMMITTED'));
  const committedIndex = committedCapture.events.indexOf('pointer:COMMITTED');
  assert.notEqual(committedIndex, -1);
  assert.ok(committedCapture.events.indexOf(`fsync:${ledgerPath}`) < committedIndex);
  assert.equal(fs.existsSync(fx.pointerPath), false);
});

test('durability failures retain the active authenticated state and pointer', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const prepared = fx.prepare();
  advanceTo(prepared.journal_path, 'ANCHORS_SYNCED');
  const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
  assert.throws(
    () => captureDurability(() => transaction.advanceTransaction(prepared.journal_path, 'VERIFIED'), hookPath),
    (error) => error && error.code === 'EIO'
  );
  assert.deepEqual(transaction.recoverActiveTransaction(fx.backupRoot, { dryRun: true }), {
    status: 'PENDING',
    state: 'ANCHORS_SYNCED',
  });
  assert.equal(fs.existsSync(fx.pointerPath), true);
});

test('journal, pointer and unlink crash boundaries recover in forward, rollback and commit release', async (t) => {
  for (const boundary of ['generation', 'pointer']) {
    await t.test(`forward ADOPTED after ${boundary}`, () => {
      const fx = makeFixture();
      try {
        const prepared = fx.prepare();
        writeFile(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'partial forward bytes\n', 0o755);
        const faulted = runFaultingCli(
          ['advance', '--transaction', prepared.journal_path, '--to', 'ADOPTED'],
          `ADOPTED:${boundary}`
        );
        assert.notEqual(faulted.status, 0);
        assert.equal(transaction.recoverActiveTransaction(fx.backupRoot).status, 'ROLLED_BACK');
        assert.equal(fs.readFileSync(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'utf8'), 'old hook\n');
      } finally {
        fx.cleanup();
      }
    });
  }

  for (const [state, boundary] of [
    ['ROLLING_BACK', 'generation'],
    ['ROLLING_BACK', 'pointer'],
    ['ROLLBACK_VERIFIED', 'generation'],
    ['ROLLBACK_VERIFIED', 'pointer'],
    ['ROLLED_BACK', 'generation'],
    ['ROLLED_BACK', 'pointer'],
    ['ROLLED_BACK', 'unlink'],
  ]) {
    await t.test(`rollback ${state} after ${boundary}`, () => {
      const fx = makeFixture();
      try {
        const prepared = fx.prepare();
        transaction.advanceTransaction(prepared.journal_path, 'ADOPTED');
        writeFile(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'partial rollback bytes\n', 0o755);
        const faulted = runFaultingCli(
          ['rollback', '--transaction', prepared.journal_path],
          `${state}:${boundary}`
        );
        assert.notEqual(faulted.status, 0);
        const recovered = transaction.recoverActiveTransaction(fx.backupRoot);
        assert.ok(['ROLLED_BACK', 'NONE'].includes(recovered.status), JSON.stringify(recovered));
        assert.equal(fs.readFileSync(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'utf8'), 'old hook\n');
        assert.equal(fs.existsSync(fx.pointerPath), false);
      } finally {
        fx.cleanup();
      }
    });
  }

  for (const boundary of ['generation', 'pointer', 'unlink']) {
    await t.test(`commit release after ${boundary}`, () => {
      const fx = makeFixture();
      try {
        const prepared = fx.prepare();
        advanceTo(prepared.journal_path, 'VERIFIED');
        writeFile(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'candidate committed bytes\n', 0o755);
        const faulted = runFaultingCli(
          ['advance', '--transaction', prepared.journal_path, '--to', 'COMMITTED'],
          `COMMITTED:${boundary}`
        );
        assert.notEqual(faulted.status, 0);
        const recovered = transaction.recoverActiveTransaction(fx.backupRoot);
        if (boundary === 'generation') {
          assert.equal(recovered.status, 'ROLLED_BACK');
          assert.equal(fs.readFileSync(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'utf8'), 'old hook\n');
        } else {
          assert.ok(['COMMITTED', 'NONE'].includes(recovered.status), JSON.stringify(recovered));
          assert.equal(fs.readFileSync(path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs'), 'utf8'), 'candidate committed bytes\n');
        }
        assert.equal(fs.existsSync(fx.pointerPath), false);
      } finally {
        fx.cleanup();
      }
    });
  }
});

test('prepare rejects symlinks, HOME escapes, duplicate file targets and unsafe overlap', async (t) => {
  await t.test('symlink ancestor', () => {
    const fx = makeFixture({ withOld: false });
    try {
      fs.rmSync(path.join(fx.home, '.claude', 'hooks'), { recursive: true });
      const outside = path.join(fx.root, 'outside');
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(fx.home, '.claude', 'hooks'));
      assert.throws(() => fx.prepare(), (error) => error && error.code === 'UNSAFE_PATH');
      assert.equal(fs.existsSync(fx.pointerPath), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test('dangling target symlink', () => {
    const fx = makeFixture({ withOld: false });
    try {
      const target = path.join(fx.home, '.claude', 'commands', 'new-command.md');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(path.join(fx.root, 'missing-outside'), target);
      assert.throws(() => fx.prepare(), (error) => error && error.code === 'UNSAFE_PATH');
      assert.equal(fs.existsSync(fx.pointerPath), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test('target escapes HOME', () => {
    const fx = makeFixture({
      mutateManifests(manifests) {
        manifests.claude.entries[0].target_path = '~/../escaped.cjs';
      },
    });
    try {
      assert.throws(() => fx.prepare(), (error) => error && error.code === 'UNSAFE_PATH');
      assert.equal(fs.existsSync(fx.pointerPath), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test('duplicate kind:file target', () => {
    const fx = makeFixture({
      mutateManifests(manifests) {
        manifests.claude.entries.splice(1, 0, { ...manifests.claude.entries[0] });
      },
    });
    try {
      assert.throws(() => fx.prepare(), (error) => error && error.code === 'DUPLICATE_TARGET');
      assert.equal(fs.existsSync(fx.pointerPath), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test('manifest target overlaps fixed ~/.soma-v2 tree', () => {
    const fx = makeFixture({
      mutateManifests(manifests) {
        manifests.claude.entries[0].target_path = '~/.soma-v2/injected.cjs';
      },
    });
    try {
      assert.throws(() => fx.prepare(), (error) => error && error.code === 'OVERLAPPING_TARGETS');
      assert.equal(fs.existsSync(fx.pointerPath), false);
    } finally {
      fx.cleanup();
    }
  });
});

test('rollback restores bytes, modes, absences and ~/.soma-v2 while preserving quarantine', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
  const commandPath = path.join(fx.home, '.claude', 'commands', 'new-command.md');
  const oldTreeHash = transaction.hashTree(path.join(fx.home, '.soma-v2'));
  const prepared = fx.prepare();

  writeFile(hookPath, 'partial hook\n', 0o644);
  writeFile(commandPath, 'partial command\n', 0o755);
  fs.rmSync(path.join(fx.home, '.soma-v2'), { recursive: true, force: true });
  writeFile(path.join(fx.home, '.soma-v2', 'partial.txt'), 'partial tree\n');
  transaction.advanceTransaction(prepared.journal_path, 'ADOPTED');

  const rolledBack = transaction.rollbackTransaction(prepared.journal_path);
  assert.equal(rolledBack.state, 'ROLLED_BACK');
  assert.equal(fs.readFileSync(hookPath, 'utf8'), 'old hook\n');
  assert.equal(readMode(hookPath), 0o700);
  assert.equal(fs.existsSync(commandPath), false);
  assert.equal(transaction.hashTree(path.join(fx.home, '.soma-v2')), oldTreeHash);
  assert.equal(fs.existsSync(fx.pointerPath), false);
  const quarantine = path.join(path.dirname(prepared.journal_path), 'quarantine');
  const before = transaction.hashTree(quarantine);
  assert.match(fs.readdirSync(quarantine, { recursive: true }).join('\n'), /soma-hook|new-command|partial/);

  const repeated = transaction.rollbackTransaction(prepared.journal_path);
  assert.equal(repeated.state, 'ROLLED_BACK');
  assert.equal(transaction.hashTree(quarantine), before);
  assert.equal(fs.readFileSync(hookPath, 'utf8'), 'old hook\n');
  assert.equal(readMode(hookPath), 0o700);
});

test('rollback restores a fresh ~/.soma-v2 absence and quarantines a dangling partial target safely', (t) => {
  const fx = makeFixture({ withOld: false });
  t.after(() => fx.cleanup());
  const prepared = fx.prepare();
  const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
  const outside = path.join(fx.root, 'outside-must-not-change');
  fs.rmSync(hookPath);
  fs.symlinkSync(outside, hookPath);
  writeFile(path.join(fx.home, '.soma-v2', 'partial.txt'), 'partial tree\n');

  const result = transaction.rollbackTransaction(prepared.journal_path);
  assert.equal(result.state, 'ROLLED_BACK');
  assert.equal(fs.existsSync(path.join(fx.home, '.soma-v2')), false);
  assert.equal(fs.existsSync(outside), false);
  assert.equal(fs.lstatSync(hookPath).isFile(), true);
  assert.equal(fs.readFileSync(hookPath, 'utf8'), 'old hook\n');
  const quarantine = path.join(path.dirname(prepared.journal_path), 'quarantine');
  const quarantined = fs.readdirSync(quarantine, { recursive: true })
    .map(String)
    .some((name) => name.includes('soma-hook'));
  assert.equal(quarantined, true);
});

test('startup recovery rolls back every nonterminal forward state in another call', async (t) => {
  for (const state of FORWARD_STATES.slice(0, -1)) {
    await t.test(state, () => {
      const fx = makeFixture();
      try {
        const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
        const prepared = fx.prepare();
        advanceTo(prepared.journal_path, state);
        writeFile(hookPath, `partial at ${state}\n`, 0o644);
        const result = transaction.recoverActiveTransaction(fx.backupRoot);
        assert.equal(result.status, 'ROLLED_BACK');
        assert.equal(fs.readFileSync(hookPath, 'utf8'), 'old hook\n');
        assert.equal(readMode(hookPath), 0o700);
        assert.equal(fs.existsSync(fx.pointerPath), false);
      } finally {
        fx.cleanup();
      }
    });
  }
});

test('startup recovery resumes ROLLING_BACK and ROLLBACK_VERIFIED journals', async (t) => {
  await t.test('ROLLING_BACK repeats restoration idempotently', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
      writeFile(hookPath, 'partial rollback\n');
      rewriteJournalAndPointer(prepared.journal_path, (journal) => {
        journal.state = 'ROLLING_BACK';
        journal.phases.push({ state: 'ROLLING_BACK', at: new Date().toISOString() });
      });
      const result = transaction.recoverActiveTransaction(fx.backupRoot);
      assert.equal(result.status, 'ROLLED_BACK');
      assert.equal(fs.readFileSync(hookPath, 'utf8'), 'old hook\n');
    } finally {
      fx.cleanup();
    }
  });

  await t.test('ROLLBACK_VERIFIED publishes ROLLED_BACK before releasing the pointer', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      rewriteJournalAndPointer(prepared.journal_path, (journal) => {
        journal.state = 'ROLLBACK_VERIFIED';
        journal.phases.push({ state: 'ROLLBACK_VERIFIED', at: new Date().toISOString() });
      });
      const result = transaction.recoverActiveTransaction(fx.backupRoot);
      assert.equal(result.status, 'ROLLED_BACK');
      assert.equal(readJson(prepared.journal_path).state, 'ROLLED_BACK');
      assert.equal(fs.existsSync(fx.pointerPath), false);
    } finally {
      fx.cleanup();
    }
  });
});

test('dry-run recovery only reports, while corruption returns RECOVERY_BLOCKED', async (t) => {
  await t.test('dry-run is byte-for-byte read-only', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
      writeFile(hookPath, 'pending partial\n');
      const pointerBefore = fs.readFileSync(fx.pointerPath);
      const journalBefore = fs.readFileSync(prepared.journal_path);
      const result = transaction.recoverActiveTransaction(fx.backupRoot, { dryRun: true });
      assert.equal(result.status, 'PENDING');
      assert.equal(result.state, 'PREPARED');
      assert.deepEqual(fs.readFileSync(fx.pointerPath), pointerBefore);
      assert.deepEqual(fs.readFileSync(prepared.journal_path), journalBefore);
      assert.equal(fs.readFileSync(hookPath, 'utf8'), 'pending partial\n');
    } finally {
      fx.cleanup();
    }
  });

  await t.test('corrupt compatibility view cannot block authenticated recovery', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
      writeFile(hookPath, 'must stay untouched\n');
      fs.writeFileSync(prepared.journal_path, '{broken');
      const pointerBefore = fs.readFileSync(fx.pointerPath);
      const result = transaction.recoverActiveTransaction(fx.backupRoot);
      assert.equal(result.status, 'ROLLED_BACK');
      assert.equal(fs.readFileSync(hookPath, 'utf8'), 'old hook\n');
      assert.equal(fs.existsSync(fx.pointerPath), false);
      assert.notEqual(pointerBefore.length, 0);
    } finally {
      fx.cleanup();
    }
  });

  await t.test('semantically corrupt allowlist is blocked even with a matching pointer hash', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      const outside = path.join(fx.root, 'outside.txt');
      rewriteJournalAndPointer(prepared.journal_path, (journal) => {
        journal.snapshots.push({
          target_path: outside,
          kind: 'file',
          origins: ['corrupt'],
          existed: false,
          mode: null,
          sha256: null,
          snapshot_path: null,
          missing_ancestors: [],
        });
      });
      const result = transaction.recoverActiveTransaction(fx.backupRoot, { dryRun: true });
      assert.equal(result.status, 'RECOVERY_BLOCKED');
      assert.equal(fs.existsSync(outside), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test('corrupt snapshot bytes block recovery before any live mutation', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
      writeFile(hookPath, 'partial must remain\n');
      const journal = readJson(prepared.journal_path);
      const hookSnapshot = journal.snapshots.find((snapshot) => snapshot.target_path === hookPath);
      fs.writeFileSync(hookSnapshot.snapshot_path, 'corrupt backup\n');
      const result = transaction.recoverActiveTransaction(fx.backupRoot);
      assert.equal(result.status, 'RECOVERY_BLOCKED');
      assert.equal(fs.readFileSync(hookPath, 'utf8'), 'partial must remain\n');
      assert.equal(fs.existsSync(fx.pointerPath), true);
    } finally {
      fx.cleanup();
    }
  });
});

test('prepared authorization requires the active authenticated journal and an allowlisted target', (t) => {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const prepared = fx.prepare();
  const allowed = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
  const authorization = transaction.verifyPreparedAuthorization(prepared.journal_path, allowed);
  assert.equal(authorization.target_path, allowed);
  assert.equal(authorization.sha256, transaction.hashFile(allowed));
  authorization.sha256 = '0'.repeat(64);
  assert.notEqual(
    transaction.verifyPreparedAuthorization(prepared.journal_path, allowed).sha256,
    authorization.sha256,
    'callers receive a detached authenticated snapshot value'
  );
  assert.throws(
    () => transaction.verifyPreparedAuthorization(prepared.journal_path, path.join(fx.home, 'foreign.txt')),
    (error) => error && error.code === 'UNAUTHORIZED_TARGET'
  );
  transaction.advanceTransaction(prepared.journal_path, 'ADOPTED');
  assert.throws(
    () => transaction.verifyPreparedAuthorization(prepared.journal_path, allowed),
    (error) => error && error.code === 'RECOVERY_BLOCKED'
  );
});

test('hashFile and hashTree include exact bytes, relative names and modes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-hash-tree-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'nested', 'a.txt');
  writeFile(file, 'one\n', 0o600);
  const fileHash = transaction.hashFile(file);
  assert.equal(fileHash, crypto.createHash('sha256').update('one\n').digest('hex'));
  const firstTreeHash = transaction.hashTree(root);
  fs.chmodSync(file, 0o644);
  assert.notEqual(transaction.hashTree(root), firstTreeHash);
  fs.symlinkSync(file, path.join(root, 'link'));
  assert.throws(() => transaction.hashTree(root), (error) => error && error.code === 'UNSAFE_PATH');
});

test('CLI is closed, documents its five commands and prepare/status use only explicit paths', (t) => {
  const help = spawnSync(process.execPath, [MODULE_PATH, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  for (const command of ['prepare', 'advance', 'rollback', 'recover', 'status']) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
  const unknown = spawnSync(process.execPath, [MODULE_PATH, 'unknown'], { encoding: 'utf8' });
  assert.equal(unknown.status, 2);

  const fx = makeFixture();
  t.after(() => fx.cleanup());
  const prepared = spawnSync(process.execPath, [
    MODULE_PATH,
    'prepare',
    '--repo-root', fx.repoRoot,
    '--home', fx.home,
    '--backup-root', fx.backupRoot,
    '--source-sha', '307c51bc7f7111e846e4730f104cade8527ae6fd',
  ], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`);
  assert.equal(JSON.parse(prepared.stdout).state, 'PREPARED');
  const status = spawnSync(process.execPath, [MODULE_PATH, 'status', '--backup-root', fx.backupRoot], {
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'PENDING');
});
