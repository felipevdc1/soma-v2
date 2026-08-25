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
  const current = crypto.createHash('sha256').update(fs.readFileSync(pointer.transaction_path)).digest('hex');
  assert.equal(pointer.journal_sha256, current);
  assert.equal(path.isAbsolute(pointer.transaction_path), true);
  return pointer;
}

function rewriteJournalAndPointer(journalPath, mutate) {
  const journal = readJson(journalPath);
  mutate(journal);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  const pointerPath = path.join(journal.backup_root, '.active-transaction.json');
  writeJson(pointerPath, {
    schema: 'soma-global-install-transaction-pointer/v1',
    transaction_path: journalPath,
    journal_sha256: crypto.createHash('sha256').update(fs.readFileSync(journalPath)).digest('hex'),
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

  await t.test('corrupt journal blocks recovery without touching live bytes', () => {
    const fx = makeFixture();
    try {
      const prepared = fx.prepare();
      const hookPath = path.join(fx.home, '.claude', 'hooks', 'soma-hook.cjs');
      writeFile(hookPath, 'must stay untouched\n');
      fs.writeFileSync(prepared.journal_path, '{broken');
      const pointerBefore = fs.readFileSync(fx.pointerPath);
      const result = transaction.recoverActiveTransaction(fx.backupRoot);
      assert.equal(result.status, 'RECOVERY_BLOCKED');
      assert.equal(fs.readFileSync(hookPath, 'utf8'), 'must stay untouched\n');
      assert.deepEqual(fs.readFileSync(fx.pointerPath), pointerBefore);
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
  assert.equal(transaction.verifyPreparedAuthorization(prepared.journal_path, allowed), true);
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
