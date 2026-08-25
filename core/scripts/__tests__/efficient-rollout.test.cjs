'use strict';
/**
 * R-01..R-05 — efficient-orchestration rollout regression coverage.
 * Every filesystem mutation is under a freshly-created temporary HOME.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CORE = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(CORE, '..');
const { extractBlock, computeBlockSha256 } = require('../lib/anchored-blocks.cjs');

function run(script, args, env, cwd) {
  return spawnSync('node', [path.join(CORE, 'scripts', script), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('R-01: marker soma-stsd do espelho Codex hasheia o corpo retornado por extractBlock', () => {
  const agents = path.join(CORE, 'adapters', 'codex', 'AGENTS.md');
  const blockId = 'block.codex.AGENTS.soma-stsd';
  const block = extractBlock(agents, blockId);
  assert.equal(block.found, true);
  assert.equal(block.attrs.sha256, computeBlockSha256(block.content));
});

test('R-02: soma-run.md é um alvo whole-file Claude, sem exclusão legada', () => {
  const targets = JSON.parse(fs.readFileSync(path.join(CORE, 'adapters', 'claude', 'install-targets.json'), 'utf8'));
  const sourcePath = 'adapters/claude/commands/soma-run.md';
  assert.deepEqual(
    targets.entries.find((entry) => entry.source_path === sourcePath),
    { kind: 'file', source_path: sourcePath, target_path: '~/.claude/commands/soma-run.md' }
  );
  assert.equal((targets.excluded || []).some((entry) => entry.source_path === sourcePath), false);
});

test('R-07: install.sh reserva soma-run.md para o sync que também registra o ledger', () => {
  const install = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
  const commandRsync = install.split('\n').find((line) => line.includes('core/adapters/claude/commands/'));
  assert.ok(commandRsync);
  assert.match(commandRsync, /--exclude=soma-run\.md/);
  assert.match(install, /sync --apply --tool=claude/);
  assert.doesNotMatch(install, /sync --apply --tool=claude[^\n]*\|\|/);
});

test('R-04: bloco canônico declara precedência do Recovery eficiente posterior', () => {
  const canonical = fs.readFileSync(path.join(CORE, 'docs', 'soma-stsd.md'), 'utf8');
  assert.match(canonical, /Recovery eficiente posterior[\s\S]{0,160}prevalece[\s\S]{0,160}Recovery unmanaged anterior/i);
});

test('R-05: HOME temporário atualiza bloco Claude + soma-run.md e doctor reconhece anchor Codex íntegro', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-efficient-rollout-'));
  const somaHome = path.join(home, '.soma-v2');
  const project = path.join(home, 'project');
  const env = { HOME: home };
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.cpSync(CORE, somaHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), [
    '# preserved user heading',
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.soma-stsd version=old sha256=deadbeef -->',
    'obsolete content',
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.soma-stsd -->',
    '',
  ].join('\n'));

  const claude = run('sync.cjs', ['--apply', '--allow-local-edits', '--tool=claude', `--soma-home=${somaHome}`], env, project);
  assert.equal(claude.status, 0, `${claude.stdout}\n${claude.stderr}`);
  const claudeTarget = path.join(home, '.claude', 'CLAUDE.md');
  const sourceBlock = extractBlock(path.join(somaHome, 'docs', 'soma-stsd.md'), 'block.claude.CLAUDE_md.soma-stsd');
  const targetBlock = extractBlock(claudeTarget, 'block.claude.CLAUDE_md.soma-stsd');
  assert.equal(targetBlock.content, sourceBlock.content);
  assert.deepEqual(
    fs.readFileSync(path.join(home, '.claude', 'commands', 'soma-run.md')),
    fs.readFileSync(path.join(somaHome, 'adapters', 'claude', 'commands', 'soma-run.md'))
  );

  const codex = run('sync.cjs', ['--apply', '--allow-local-edits', '--tool=codex', `--soma-home=${somaHome}`], env, project);
  assert.equal(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
  const baseline = run('manifest.cjs', ['baseline', '--apply', '--json'], { ...env, SOMA_HOME: somaHome }, project);
  assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);
  const doctor = run('doctor.cjs', ['--json', `--soma-home=${somaHome}`], env, project);
  assert.equal(doctor.status, 0, `${doctor.stdout}\n${doctor.stderr}`);
  const result = JSON.parse(doctor.stdout);
  const codexAnchor = result.findings.find((finding) =>
    finding.target_anchor_id === 'block.codex.AGENTS.soma-stsd' && finding.target_path === path.join(home, '.codex', 'AGENTS.md')
  );
  assert.equal(codexAnchor?.severity, 'ok', JSON.stringify(result.findings));
});
