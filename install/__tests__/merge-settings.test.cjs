'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { mergeSettings, uninstallSomaEntries } = require('../merge-settings.cjs');

// Helper: create isolated tmpdir with optional settings.json content
function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'merge-settings-test-'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const MINIMAL_MAP = {
  schema: 'soma-hooks-map/v1',
  version: '2.1.0',
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/pre-commit-gate.cjs"' }]
      }
    ]
  }
};

const FULL_MAP = {
  schema: 'soma-hooks-map/v1',
  version: '2.1.0',
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/pre-commit-gate.cjs"' }]
      },
      {
        matcher: 'Agent',
        hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/thermal-guard.cjs"' }]
      }
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/capture-defer-gate.cjs"' }]
      },
      {
        hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/insight-action-coupling.cjs"' }]
      },
      {
        hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/session-end.cjs"' }]
      }
    ]
  }
};

test('mergeSettings: fresh install adds all SOMA entries with _soma_managed tag', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');
  fs.writeFileSync(targetPath, JSON.stringify({}));

  const result = mergeSettings(targetPath, MINIMAL_MAP);

  assert.strictEqual(result.added, 1, 'should add 1 entry');
  assert.strictEqual(result.skipped, 0, 'should skip 0 entries');

  const written = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  assert.ok(written.hooks, 'hooks key should exist');
  assert.ok(written.hooks.PreToolUse, 'PreToolUse event should exist');
  assert.strictEqual(written.hooks.PreToolUse.length, 1);
  assert.strictEqual(written.hooks.PreToolUse[0]._soma_managed, true, 'must have _soma_managed tag');
  assert.ok(result.backupPath, 'backup path should be returned');
  assert.ok(fs.existsSync(result.backupPath), 'backup file should exist');
});

test('mergeSettings: re-install is no-op (idempotency invariant)', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');
  fs.writeFileSync(targetPath, JSON.stringify({}));

  // First install
  const r1 = mergeSettings(targetPath, FULL_MAP);
  const sha1 = sha256(targetPath);
  assert.ok(r1.added > 0, 'first install should add entries');

  // Second install — must be no-op
  const r2 = mergeSettings(targetPath, FULL_MAP);
  const sha2 = sha256(targetPath);

  assert.strictEqual(r2.added, 0, 'second install should add 0 entries');
  assert.strictEqual(r2.skipped, r1.added, 'should skip all previously added entries');
  assert.strictEqual(sha1, sha2, 'settings.json sha256 must be IDENTICAL (idempotency invariant)');
});

test('mergeSettings: preserves user custom hooks (no _soma_managed tag)', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');

  const existingSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Custom',
          hooks: [{ type: 'command', command: 'user-custom.sh' }]
        }
      ]
    }
  };
  fs.writeFileSync(targetPath, JSON.stringify(existingSettings, null, 2));

  mergeSettings(targetPath, MINIMAL_MAP);

  const written = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  assert.ok(Array.isArray(written.hooks.PreToolUse), 'PreToolUse should be array');
  assert.strictEqual(written.hooks.PreToolUse.length, 2, 'should have 2 entries: user custom + SOMA');

  const userEntry = written.hooks.PreToolUse.find(e => e.matcher === 'Custom');
  assert.ok(userEntry, 'user custom entry should still exist');
  assert.ok(!userEntry._soma_managed, 'user entry should NOT have _soma_managed tag');

  const somaEntry = written.hooks.PreToolUse.find(e => e._soma_managed === true);
  assert.ok(somaEntry, 'SOMA entry should exist');
});

test('mergeSettings: malformed input throws (input not JSON)', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');
  fs.writeFileSync(targetPath, 'NOT VALID JSON {{{');

  const shaBefore = sha256(targetPath);

  assert.throws(
    () => mergeSettings(targetPath, MINIMAL_MAP),
    (err) => err instanceof SyntaxError,
    'should throw SyntaxError on malformed JSON'
  );

  const shaAfter = sha256(targetPath);
  assert.strictEqual(shaBefore, shaAfter, 'target file must NOT be modified when input is malformed');
});

test('mergeSettings: backup file created with timestamp', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');
  const originalContent = JSON.stringify({ existing: true }, null, 2);
  fs.writeFileSync(targetPath, originalContent);

  const result = mergeSettings(targetPath, MINIMAL_MAP);

  assert.ok(result.backupPath, 'backupPath must be returned');
  assert.ok(fs.existsSync(result.backupPath), 'backup file must exist on disk');

  const backupContent = fs.readFileSync(result.backupPath, 'utf-8');
  assert.strictEqual(backupContent, originalContent, 'backup content must match original exactly');
});

test('mergeSettings: dry-run mode writes nothing', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');
  const originalContent = JSON.stringify({ existing: true }, null, 2);
  fs.writeFileSync(targetPath, originalContent);

  const shaBefore = sha256(targetPath);

  const result = mergeSettings(targetPath, MINIMAL_MAP, { dryRun: true });

  const shaAfter = sha256(targetPath);
  assert.strictEqual(shaBefore, shaAfter, 'dry-run must NOT modify settings.json');
  assert.strictEqual(result.backupPath, null, 'dry-run must NOT create backup');
  assert.ok(result.added > 0, 'dry-run should still report what would be added');
});

test('uninstallSomaEntries: removes only _soma_managed entries', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');

  const mixedSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Custom',
          hooks: [{ type: 'command', command: 'user-custom.sh' }]
        },
        {
          _soma_managed: true,
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/pre-commit-gate.cjs"' }]
        }
      ],
      Stop: [
        {
          _soma_managed: true,
          hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/insight-action-coupling.cjs"' }]
        }
      ]
    }
  };
  fs.writeFileSync(targetPath, JSON.stringify(mixedSettings, null, 2));

  const result = uninstallSomaEntries(targetPath);

  assert.strictEqual(result.removed, 2, 'should remove exactly 2 SOMA-managed entries');

  const written = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  assert.ok(written.hooks.PreToolUse, 'PreToolUse should still exist (has user custom)');
  assert.strictEqual(written.hooks.PreToolUse.length, 1, 'only user custom entry should remain');
  assert.strictEqual(written.hooks.PreToolUse[0].matcher, 'Custom', 'user entry preserved exactly');
  assert.ok(!written.hooks.Stop, 'Stop event should be removed (had only SOMA entries)');
});

test('uninstallSomaEntries: cleans empty event arrays', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');

  const onlySOMASettings = {
    hooks: {
      PreToolUse: [
        {
          _soma_managed: true,
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node "${CLAUDE_HOME}/hooks/pre-commit-gate.cjs"' }]
        }
      ]
    }
  };
  fs.writeFileSync(targetPath, JSON.stringify(onlySOMASettings, null, 2));

  uninstallSomaEntries(targetPath);

  const written = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  assert.ok(!written.hooks, 'hooks key should be removed when all events become empty');
});

test('uninstallSomaEntries: handles missing hooks key gracefully', () => {
  const dir = mkTmpDir();
  const targetPath = path.join(dir, 'settings.json');
  const content = JSON.stringify({ env: { FOO: 'bar' } }, null, 2);
  fs.writeFileSync(targetPath, content);

  let threw = false;
  try {
    const result = uninstallSomaEntries(targetPath);
    assert.strictEqual(result.removed, 0, 'should report 0 removed when no hooks key');
  } catch (e) {
    threw = true;
  }
  assert.ok(!threw, 'should not throw when hooks key is missing');
});
