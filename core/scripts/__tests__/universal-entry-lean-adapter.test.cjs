'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const CORE = path.resolve(__dirname, '..', '..');
const ADAPTER = path.join(CORE, 'adapters', 'claude', 'commands', 'soma-run.md');
const REFERENCE = path.join(CORE, 'adapters', 'claude', 'references', 'soma-run-orchestration.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('thin adapter transports raw arguments only through the structured envelope', () => {
  const source = read(ADAPTER);
  assert.ok(Buffer.byteLength(source, 'utf8') <= 8000, `adapter has ${Buffer.byteLength(source, 'utf8')} bytes`);
  assert.equal((source.match(/\$ARGUMENTS/g) || []).length, 1);
  for (const block of source.matchAll(/```bash\n([\s\S]*?)```/g)) {
    assert.doesNotMatch(block[1], /\$ARGUMENTS/);
  }
  assert.match(source, /"rawArguments"\s*:\s*the exact `\$ARGUMENTS` value/);
  assert.doesNotMatch(source, /UserPromptExpansion|eval\b|bash\s+-c/);
});

test('adapter uses fixed prepare, consume and abort shapes with validated runtime identities', () => {
  const source = read(ADAPTER);
  assert.match(source, /entry prepare --session "\$\{CLAUDE_SESSION_ID\}"/);
  assert.match(source, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}\$/);
  assert.match(source, /\^\[a-f0-9\]\{32\}\$/);
  assert.match(source, /entry consume --session '<validated-session-id>' --request-id '<validated-request-id>' --owner-pid "\$PPID"/);
  assert.match(source, /entry abort --session '<validated-session-id>' --request-id '<validated-request-id>'/);
  assert.doesNotMatch(source, /SOMA_SESSION_ID|SOMA_REQUEST_ID/);
  assert.match(source, /POSIX single-quoted literal/i);
  assert.match(source, /finally/i);
  assert.match(source, /Write tool/);
});

test('documented adapter consume shape works across separate Bash calls', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-adapter-shape-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const entryRoot = path.join(sandbox, 'mailbox');
  const project = path.join(sandbox, 'project');
  fs.mkdirSync(project);
  const cli = path.join(CORE, 'scripts', 'soma.cjs');
  const env = { ...process.env, SOMA_ENTRY_ROOT: entryRoot, SOMA_PROJECT_CWD: project };
  const prepared = spawnSync('node', [cli, 'entry', 'prepare', '--session', 'adapter.native:41'], { encoding: 'utf8', env });
  assert.equal(prepared.status, 0, prepared.stderr);
  const slot = JSON.parse(prepared.stdout);
  fs.writeFileSync(slot.requestPath, JSON.stringify({
    $schema: 'soma-entry-request/v1', sessionId: slot.sessionId,
    requestId: slot.requestId, rawArguments: '--help',
  }));
  const consumeShape = read(ADAPTER).match(/```bash\n([^\n]*entry consume[^\n]*)\n```/)[1]
    .replace('"${HOME}/.soma-v2/scripts/soma.cjs"', `'${cli}'`)
    .replace("'<validated-session-id>'", `'${slot.sessionId}'`)
    .replace("'<validated-request-id>'", `'${slot.requestId}'`);
  const consumed = spawnSync('bash', ['-c', consumeShape], { encoding: 'utf8', env });
  assert.equal(consumed.status, 0, consumed.stderr);
  assert.equal(JSON.parse(consumed.stdout).status, 'HELP_SHOWN');
});

test('adapter stops terminal results and lazy-loads orchestration exactly once for READY states', () => {
  const source = read(ADAPTER);
  const referenceName = 'references/soma-run-orchestration.md';
  assert.equal((source.match(new RegExp(referenceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.match(source, /HELP_SHOWN/);
  assert.match(source, /STATUS_SHOWN/);
  assert.match(source, /RESUME_DRIFT/);
  assert.match(source, /READY/);
  assert.match(source, /RESUME_READY/);
  assert.match(source, /Do not call Agent or Read the orchestration reference for a terminal result/);
});

test('orchestration delegates baseline, bounds records and checkpoints every safe transition', () => {
  const source = read(REFERENCE);
  assert.match(source, /baselineRequired[^\n]*first executor dispatch[^\n]*`T-BASELINE`/i);
  assert.match(source, /coordinator never executes project code/i);
  assert.match(source, /dispatch-record begin[^\n]*before every agent/i);
  assert.match(source, /dispatch-record end[^\n]*before any transition/i);
  assert.match(source, /prompt[^\n]*8,000 bytes/i);
  assert.match(source, /conversational return[^\n]*4,000 bytes/i);
  assert.match(source, /checkpoint after every safe transition/i);
  assert.match(source, /PAUSED_DIAGNOSTIC/);
});

test('new-run control primitives always receive the explicit run id and never require a new-run lock', () => {
  const source = read(REFERENCE);
  assert.match(source, /READY[\s\S]{0,900}state --init --run <runId>[\s\S]{0,900}gate --run <runId>/i);
  assert.doesNotMatch(source, /Nenhum bloco passa `--run`|resolve(?:m|r) o run ativo via `\.soma\.lock`/i);
  for (const primitive of ['gate', 'report', 'dispatch-record', 'state', 'checkpoint', 'handoff']) {
    assert.match(source, new RegExp(`soma run ${primitive}[^\\n]*--run <runId>`, 'i'), primitive);
  }
});

test('state init followed by the explicit-run first gate succeeds without a lock', (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-explicit-run-gate-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const cli = path.join(CORE, 'scripts', 'soma.cjs');
  const runId = 'run-explicit-first-gate';
  let result = spawnSync('node', [cli, 'run', 'state', '--init', '--run', runId], { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(project, '.soma.lock')), false);
  result = spawnSync('node', [cli, 'run', 'gate', '--run', runId, '--step', 'STEP_1A_SPECIFY'], { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(project, '.soma.lock')), false);
});

test('validation, consolidation and audit project work has explicit executor contracts', () => {
  const source = read(REFERENCE);
  for (const [start, end] of [
    ['## 8. STEP_5_VALIDATE', '## 9. STEP_6_CONSOLIDATE'],
    ['## 9. STEP_6_CONSOLIDATE', '## 10. STEP_7_INTEGRATE'],
    ['## 11. STEP_8_SONAR', '## 12. STEP_9_FIX_LOOP'],
  ]) {
    const section = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(section, /executor contract|contrato do executor/i, start);
    assert.match(section, /dispatch-record begin[\s\S]{0,600}Agent[\s\S]{0,600}dispatch-record end/i, start);
    assert.doesNotMatch(section, /coordinator (?:runs|executes|roda|executa) (?:git|build|tests?|validation|checks?)/i, start);
  }
});

test('all planned reviewers inspect one immutable candidate before the only correction', () => {
  const source = read(REFERENCE);
  assert.match(source, /same immutable candidate commit/i);
  assert.match(source, /wait for every planned reviewer/i);
  assert.match(source, /consolidate all spec and quality findings/i);
  assert.match(source, /never start the correction after the first review/i);
  assert.match(source, /single correction attempt/i);
});
