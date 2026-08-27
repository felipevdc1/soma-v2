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

  const sentinel = path.join(project, 'sentinel');
  const hostile = `"objective with $(touch ${sentinel})"`;
  const started = mailboxRequest(soma, project, { ...env, SOMA_PROJECT_CWD: project }, 'session-start', hostile);
  expectOk(started.result);
  const ready = JSON.parse(started.result.stdout);
  assert.equal(ready.status, 'READY', JSON.stringify(ready));
  assert.equal(ready.baselineRequired, true);
  assert.equal(ready.objective, `objective with $(touch ${sentinel})`);
  assert.equal(fs.existsSync(sentinel), false);

  const runId = 'run-lean-vertical';
  expectOk(runNode(soma, ['run', 'state', '--init', '--run', runId], project, env));
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
