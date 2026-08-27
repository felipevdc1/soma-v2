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
      ['entry', 'consume', '--session', 'codex.cli:1', '--request-id', 'a'.repeat(32), '--owner-pid', '0'],
      ['entry', 'consume', '--session', 'codex.cli:1', '--request-id', 'a'.repeat(32), '--owner-pid', '1.5'],
      ['entry', 'consume', '--session', 'codex.cli:1', '--request-id', 'a'.repeat(32), '--owner-pid', '999999999999999999999'],
      ['entry', 'prepare', '--session', 'codex.cli:1', '--owner-pid', '1'],
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

test('consume rejects an invalid owner PID before claiming a valid mailbox request', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-owner-cli-'));
  try {
    for (const [index, ownerPid] of ['0', '1.5', '999999999999999999999'].entries()) {
      const sessionId = `codex.owner:${index}`;
      const prepared = run(['entry', 'prepare', '--session', sessionId], { SOMA_ENTRY_ROOT: root });
      assert.equal(prepared.status, 0, prepared.stderr);
      const request = JSON.parse(prepared.stdout);
      fs.writeFileSync(request.requestPath, JSON.stringify({
        $schema: 'soma-entry-request/v1', sessionId, requestId: request.requestId,
        rawArguments: '--help',
      }));
      const rejected = run(
        ['entry', 'consume', '--session', sessionId, '--request-id', request.requestId, '--owner-pid', ownerPid],
        { SOMA_ENTRY_ROOT: root }
      );
      assert.equal(rejected.status, 2, rejected.stderr);
      assert.equal(JSON.parse(rejected.stderr).error, 'INVALID_ARGUMENTS');
      assert.equal(fs.existsSync(request.requestPath), true, 'validation must run before mailbox claim');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native forms validate Claude session inside Node and select only one unclaimed request', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-native-cli-'));
  try {
    for (const sessionId of [undefined, '', '../foreign']) {
      const result = run(['entry', 'native', 'prepare'], {
        SOMA_ENTRY_ROOT: root,
        ...(sessionId === undefined ? {} : { CLAUDE_SESSION_ID: sessionId }),
      });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stderr).error, 'INVALID_SESSION_ID');
    }

    const sessionId = 'claude.native:selection';
    const prepared = run(['entry', 'native', 'prepare'], { SOMA_ENTRY_ROOT: root, CLAUDE_SESSION_ID: sessionId });
    assert.equal(prepared.status, 0, prepared.stderr);
    const request = JSON.parse(prepared.stdout);
    fs.writeFileSync(request.requestPath, JSON.stringify({
      $schema: 'soma-entry-request/v1', sessionId, requestId: request.requestId, rawArguments: '--help',
    }));
    const consumed = run(['entry', 'native', 'consume'], { SOMA_ENTRY_ROOT: root, CLAUDE_SESSION_ID: sessionId });
    assert.equal(consumed.status, 0, consumed.stderr);
    assert.equal(JSON.parse(consumed.stdout).status, 'HELP_SHOWN');

    const absent = run(['entry', 'native', 'abort'], { SOMA_ENTRY_ROOT: root, CLAUDE_SESSION_ID: 'claude.native:absent' });
    assert.equal(absent.status, 2, absent.stderr);
    assert.equal(JSON.parse(absent.stderr).error, 'MAILBOX_NOT_FOUND');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native default mailbox root follows HOME without changing explicit-root compatibility', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-entry-native-home-'));
  try {
    const sessionId = 'claude.native:home-root';
    const prepared = run(['entry', 'native', 'prepare'], { HOME: home, CLAUDE_SESSION_ID: sessionId, SOMA_ENTRY_ROOT: undefined });
    assert.equal(prepared.status, 0, prepared.stderr);
    const slot = JSON.parse(prepared.stdout);
    assert.ok(slot.requestPath.startsWith(path.join(home, '.soma-v2', 'state', 'entry-mailbox-v1')));
    fs.writeFileSync(slot.requestPath, JSON.stringify({
      $schema: 'soma-entry-request/v1', sessionId, requestId: slot.requestId, rawArguments: '--help',
    }));
    const consumed = run(['entry', 'native', 'consume'], { HOME: home, CLAUDE_SESSION_ID: sessionId, SOMA_ENTRY_ROOT: undefined });
    assert.equal(consumed.status, 0, consumed.stderr);
    assert.equal(JSON.parse(consumed.stdout).status, 'HELP_SHOWN');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
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
