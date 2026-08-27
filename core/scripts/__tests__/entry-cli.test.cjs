'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withFakeHome } = require('./helpers/fake-home.cjs');

const SOMA = path.resolve(__dirname, '..', 'soma.cjs');

function run(args, env = {}) {
  return spawnSync('node', [SOMA, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('entry stays internal while prepare and consume route a structured request without changing cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-cli-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const before = process.cwd();
  try {
    const hidden = run(['--help']);
    assert.equal(hidden.status, 0);
    assert.doesNotMatch(hidden.stdout, /\bentry\b/);
    const prepared = run(['entry', 'prepare', '--session', 'codex.cli:1'], { SOMA_ENTRY_ROOT: root });
    assert.equal(prepared.status, 0, prepared.stderr);
    const preparedJson = JSON.parse(prepared.stdout);
    assert.match(preparedJson.requestId, /^[a-f0-9]{32}$/);
    assert.equal(preparedJson.sessionId, 'codex.cli:1');
    fs.writeFileSync(preparedJson.requestPath, JSON.stringify({
      $schema: 'soma-entry-request/v1', sessionId: 'codex.cli:1', requestId: preparedJson.requestId, rawArguments: `--status --project "${project}"`,
    }));
    const consumed = run(['entry', 'consume', '--session', 'codex.cli:1', '--request-id', preparedJson.requestId], { SOMA_ENTRY_ROOT: root });
    assert.equal(consumed.status, 0, consumed.stderr);
    const routed = JSON.parse(consumed.stdout);
    assert.equal(routed.status, 'STATUS_SHOWN');
    assert.equal(routed.projectRoot, fs.realpathSync(project));
    assert.equal(routed.scope, fs.realpathSync(project));
    assert.equal(routed.adoption, 'adoptable');
    assert.equal(process.cwd(), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('entry validates its internal forms and returns stable JSON errors on stderr', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-cli-'));
  try {
    for (const args of [
      ['entry', 'prepare'],
      ['entry', 'prepare', '--session', 'bad/session'],
      ['entry', 'consume', '--session', 'codex.cli:1', '--request-id', 'wrong'],
      ['entry', 'unknown'],
    ]) {
      const result = run(args, { SOMA_ENTRY_ROOT: root });
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
      assert.doesNotThrow(() => JSON.parse(result.stderr));
    }
    const unknown = run(['not-a-command']);
    assert.doesNotMatch(unknown.stderr, /entry/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('consume start emits one JSON result even when adoption runs the callable installer', () => {
  withFakeHome('soma-entry-start-home-', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-start-'));
    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    try {
      const prepared = run(['entry', 'prepare', '--session', 'codex.cli:start'], { SOMA_ENTRY_ROOT: root });
      assert.equal(prepared.status, 0, prepared.stderr);
      const request = JSON.parse(prepared.stdout);
      fs.writeFileSync(request.requestPath, JSON.stringify({
        $schema: 'soma-entry-request/v1', sessionId: 'codex.cli:start', requestId: request.requestId,
        rawArguments: `"adopt this project" --project "${project}"`,
      }));
      const consumed = run(
        ['entry', 'consume', '--session', 'codex.cli:start', '--request-id', request.requestId],
        { SOMA_ENTRY_ROOT: root }
      );
      assert.equal(consumed.status, 0, consumed.stderr);
      const result = JSON.parse(consumed.stdout);
      assert.equal(result.status, 'READY');
      assert.equal(result.adopted, true);
      assert.equal(result.baselineRequired, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
