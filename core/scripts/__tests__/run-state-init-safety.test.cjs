'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_CLI = path.join(__dirname, '..', 'run', 'state.cjs');

function snapshotTree(root) {
  const entries = [];
  const visit = relativePath => {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory' });
      for (const entry of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(relativePath, entry));
      }
    } else if (stat.isFile()) {
      entries.push({ path: relativePath, type: 'file', bytes: fs.readFileSync(absolutePath) });
    } else if (stat.isSymbolicLink()) {
      entries.push({ path: relativePath, type: 'symlink', target: fs.readlinkSync(absolutePath) });
    } else {
      entries.push({ path: relativePath, type: 'other' });
    }
  };
  visit('.');
  return entries;
}

test('state --init rejects unsafe runId before path resolution', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-state-init-safety-'));
  try {
    fs.mkdirSync(path.join(projectRoot, '.soma'));
    const before = snapshotTree(projectRoot);
    const result = spawnSync('node', [STATE_CLI, '--init', '--run', '../../../escaped'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0, `unsafe runId must fail. stdout: ${result.stdout}; stderr: ${result.stderr}`);
    assert.match(result.stderr, /RECOVERY_STATE_RUN_ID_INVALID|invalid run identity/i);
    assert.deepEqual(snapshotTree(projectRoot), before, 'unsafe runId must not alter the project tree or file bytes');
    assert.equal(fs.existsSync(path.join(projectRoot, 'escaped.json')), false, 'must not write outside .soma');
    assert.deepEqual(fs.readdirSync(path.join(projectRoot, '.soma')), [], 'must not create a run-state or temporary file');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
