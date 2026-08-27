'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL = path.join(ROOT, 'install.sh');

function command(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 120000, ...options });
}

function git(cwd, args) {
  const result = command('git', args, { cwd });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepo(project) {
  fs.mkdirSync(project, { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'SOMA test']);
  git(project, ['config', 'user.email', 'soma@example.test']);
  fs.writeFileSync(path.join(project, 'README.md'), 'fixture\n');
  git(project, ['add', '.']);
  git(project, ['commit', '-qm', 'fixture']);
}

function runNode(script, args, cwd, env) {
  return command('node', [script, ...args], { cwd, env });
}

function expectOk(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

function mailboxRequest(soma, project, env, sessionId, rawArguments, ownerPid) {
  const prepared = expectOk(runNode(soma, ['entry', 'prepare', '--session', sessionId], project, env));
  const slot = JSON.parse(prepared.stdout);
  fs.writeFileSync(slot.requestPath, JSON.stringify({
    $schema: 'soma-entry-request/v1', sessionId, requestId: slot.requestId, rawArguments,
  }));
  const args = ['entry', 'consume', '--session', sessionId, '--request-id', slot.requestId];
  if (ownerPid !== undefined) args.push('--owner-pid', String(ownerPid));
  return { slot, result: runNode(soma, args, project, env) };
}

function installedAdapterRequest(soma, adapter, project, env, sessionId, rawArguments) {
  assert.match(fs.readFileSync(adapter, 'utf8'), /exec node ~\/\.soma-v2\/scripts\/soma\.cjs entry native prepare/);
  const nativeEnv = { ...env, CLAUDE_SESSION_ID: sessionId };
  const prepared = expectOk(command('/bin/sh', ['-c', 'exec node ~/.soma-v2/scripts/soma.cjs entry native prepare'], {
    cwd: project, env: nativeEnv,
  }));
  const slot = JSON.parse(prepared.stdout);
  fs.writeFileSync(slot.requestPath, JSON.stringify({
    $schema: 'soma-entry-request/v1', sessionId, requestId: slot.requestId, rawArguments,
  }));
  return {
    slot,
    result: command('/bin/sh', ['-c', 'exec node ~/.soma-v2/scripts/soma.cjs entry native consume'], {
      cwd: project, env: nativeEnv,
    }),
  };
}

test('fake-home install adopts, checkpoints, hands off and resumes the exact next task', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-lean-vertical-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  const project = path.join(sandbox, 'project');
  fs.mkdirSync(home);
  initRepo(project);
  const env = { ...process.env, HOME: home, NO_CODEX: '1', SOMA_INSTALL_TESTING: '1' };
  expectOk(command('bash', [INSTALL, '--force-overwrite'], { cwd: project, env, timeout: 300000 }));

  const soma = path.join(home, '.soma-v2', 'scripts', 'soma.cjs');
  const adapter = path.join(home, '.claude', 'commands', 'soma-run.md');
  const reference = path.join(home, '.claude', 'references', 'soma-run-orchestration.md');
  assert.equal(fs.existsSync(adapter), true);
  assert.equal(fs.existsSync(reference), true);
  assert.deepEqual(
    fs.readFileSync(adapter),
    fs.readFileSync(path.join(home, '.soma-v2', 'adapters', 'claude', 'commands', 'soma-run.md'))
  );

  const sentinel = path.join(project, 'sentinel');
  const hostile = `"objective with $(touch ${sentinel})"`;
  const started = installedAdapterRequest(soma, adapter, project, { ...env, SOMA_PROJECT_CWD: project }, 'session-start', hostile);
  expectOk(started.result);
  const ready = JSON.parse(started.result.stdout);
  assert.equal(ready.status, 'READY', JSON.stringify(ready));
  assert.equal(ready.baselineRequired, true);
  assert.equal(ready.objective, `objective with $(touch ${sentinel})`);
  assert.equal(fs.existsSync(sentinel), false);

  const runId = 'run-lean-vertical';
  expectOk(runNode(soma, ['run', 'state', '--init', '--run', runId], project, env));
  assert.equal(fs.existsSync(path.join(project, '.soma.lock')), false);
  expectOk(runNode(soma, ['run', 'gate', '--run', runId, '--step', 'STEP_1A_SPECIFY'], project, env));
  assert.equal(fs.existsSync(path.join(project, '.soma.lock')), false);
  const statusBefore = mailboxRequest(soma, project, { ...env, SOMA_PROJECT_CWD: project }, 'session-status-before', '--status');
  expectOk(statusBefore.result);
  assert.deepEqual(JSON.parse(statusBefore.result.stdout).run, {
    runId, currentState: 'IDLE', checkpointSequence: null, handoffGeneration: null,
    blocker: null, nextDecision: null, nextTask: null,
  });
  const prompt = path.join(sandbox, 'prompt.md');
  const output = path.join(sandbox, 'output.md');
  const metadata = path.join(sandbox, 'metadata.json');
  fs.writeFileSync(prompt, 'Run the baseline and write proof.\n');
  fs.writeFileSync(output, 'done\n');
  fs.writeFileSync(metadata, JSON.stringify({
    schema: 'soma-dispatch-record/v1', run_id: runId, task_id: 'T-BASELINE', attempt: 1,
    model: 'fixture', base_sha: git(project, ['rev-parse', 'HEAD']),
    started_at: '2026-08-27T12:00:00Z', finished_at: '2026-08-27T12:01:00Z',
    ac_refs: ['baseline'], executor_agent: 'fixture-agent', result: 'done',
  }));
  expectOk(runNode(soma, ['run', 'dispatch-record', 'begin', '--run', runId, '--task', 'T-BASELINE', '--prompt-file', prompt], project, env));
  expectOk(runNode(soma, ['run', 'dispatch-record', 'end', '--run', runId, '--task', 'T-BASELINE', '--output-file', output, '--metadata-file', metadata], project, env));

  const input = path.join(sandbox, 'checkpoint.json');
  fs.writeFileSync(input, JSON.stringify({
    $schema: 'soma-checkpoint-input/v1', runId, sequence: 1, currentState: 'IDLE',
    nextTask: 'T-NEXT', blocker: null, nextDecision: null,
    tasks: [
      { id: 'T-BASELINE', status: 'passed', attempts: 1 },
      { id: 'T-NEXT', status: 'pending', attempts: 0 },
    ],
  }));
  expectOk(runNode(soma, ['run', 'checkpoint', '--run', runId, '--input-file', input], project, env));
  expectOk(runNode(soma, ['run', 'handoff', '--run', runId], project, env));

  const statusAfter = mailboxRequest(soma, project, { ...env, SOMA_PROJECT_CWD: project }, 'session-status-after', '--status');
  expectOk(statusAfter.result);
  assert.deepEqual(JSON.parse(statusAfter.result.stdout).run, {
    runId, currentState: 'IDLE', checkpointSequence: 1, handoffGeneration: 1,
    blocker: null, nextDecision: null, nextTask: 'T-NEXT',
  });

  const resumed = mailboxRequest(
    soma, project, { ...env, SOMA_PROJECT_CWD: project }, 'session-resume', `--resume ${runId}`, process.pid
  );
  expectOk(resumed.result);
  const result = JSON.parse(resumed.result.stdout);
  assert.equal(result.status, 'RESUME_READY');
  assert.equal(result.nextTask, 'T-NEXT');
  assert.notEqual(result.nextTask, 'T-BASELINE');
  const handoff = JSON.parse(fs.readFileSync(path.join(project, '.soma', 'handoffs', runId, '1', 'handoff.json')));
  assert.equal(handoff.tasks.find(task => task.id === 'T-BASELINE').status, 'passed');

  fs.writeFileSync(path.join(project, 'README.md'), 'durable git drift\n');
  const drifted = mailboxRequest(
    soma, project, { ...env, SOMA_PROJECT_CWD: project }, 'session-drift', `--resume ${runId}`, process.pid
  );
  expectOk(drifted.result);
  const drift = JSON.parse(drifted.result.stdout);
  assert.equal(drift.status, 'RESUME_DRIFT');
  assert.equal(fs.existsSync(path.join(project, '.soma', 'diagnostics', `${runId}-resume-drift.json`)), true);
});

test('negative entry paths preserve durable diagnostics and refuse mutation', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-lean-negative-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const project = path.join(sandbox, 'project');
  initRepo(project);

  const partial = path.join(project, '.soma');
  fs.mkdirSync(partial);
  fs.writeFileSync(path.join(partial, 'manifest.json'), '{}\n');
  const { routeEntryRequest } = require('../entry/request.cjs');
  const adopted = routeEntryRequest({ mode: 'start', objective: 'x', project }, { cwd: sandbox, home: sandbox });
  assert.equal(adopted.status, 'ADOPTION_BLOCKED');
  assert.deepEqual(fs.readFileSync(path.join(partial, 'manifest.json'), 'utf8'), '{}\n');

  const mailboxRoot = path.join(sandbox, 'mailbox');
  const soma = path.resolve(__dirname, '..', 'soma.cjs');
  const env = { ...process.env, SOMA_ENTRY_ROOT: mailboxRoot, SOMA_PROJECT_CWD: project, HOME: sandbox };
  const prepared = JSON.parse(expectOk(runNode(soma, ['entry', 'prepare', '--session', 'corrupt-session'], project, env)).stdout);
  fs.writeFileSync(prepared.requestPath, '{broken');
  const consumed = runNode(soma, ['entry', 'consume', '--session', 'corrupt-session', '--request-id', prepared.requestId], project, env);
  assert.notEqual(consumed.status, 0);
  assert.match(consumed.stderr, /INVALID_REQUEST_ENVELOPE/);
});

test('fake-home injected global transaction failure rolls installed targets back', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-lean-rollback-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'commands'), { recursive: true });
  const target = path.join(home, '.claude', 'commands', 'soma-run.md');
  fs.writeFileSync(target, 'preexisting adapter\n');
  const env = {
    ...process.env, HOME: home, NO_CODEX: '1', SOMA_INSTALL_TESTING: '1',
    SOMA_INSTALL_FAULT_AFTER: 'CORE_COPIED',
  };
  const result = command('bash', [INSTALL, '--force-overwrite'], { env, timeout: 300000 });
  assert.equal(result.status, 97, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preexisting adapter\n');
  assert.match(result.stderr, /Rolling back transaction/);
});
