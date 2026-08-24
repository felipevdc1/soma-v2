'use strict';
/**
 * install-sh-rsync-origins.test.cjs — T-08b
 *
 * install.sh:169 (`rsync "${REPO_ROOT}/commands/"`) points at a directory
 * that no longer exists — the T-04 migration consolidated commands into
 * core/adapters/claude/commands/. This is the THIRD time this exact bug
 * class hits install.sh: :168 (hooks) broke the same way earlier in this
 * spec and was fixed by T-08a's `git mv`; fixing only :169's one line here
 * would invite a fourth occurrence the next time something moves. Case 1
 * below is therefore a CLASS-level guard — every `rsync "${REPO_ROOT}/X/"`
 * origin anywhere in install.sh must exist in the repo, found by scanning
 * the whole file, never by naming a line number.
 *
 * Case 2 locks the rollout parity: both install mechanisms install
 * soma-run.md now that it is a declared whole-file adapter target.
 *
 * Pure static analysis — reads install.sh and install-targets.json as
 * text/JSON, never executes install.sh. Actually running it (even
 * --dry-run) writes under $HOME; that's explicitly out of bounds for this
 * task (a safe HOME=-overridden harness already exists at
 * install/__tests__/synthetic-env.test.sh for whoever needs to exercise
 * it end-to-end later).
 *
 * @spec [SPEC:AC-12]
 * @task T-08b
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_SH = path.join(REPO_ROOT, 'install.sh');
const CLAUDE_TARGETS = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'install-targets.json');

// Matches a full `rsync -a [--exclude=X ]*"${REPO_ROOT}/<origin>/" "${HOME}/<target>/"`
// line exactly as it appears inside install.sh's `run "..."` wrapper — the
// whole invocation is one shell-quoted string argument to the `run()`
// helper (see install.sh's own `run() { ... eval "$@" ... }`), so the
// inner quotes are backslash-escaped in the source text.
const RSYNC_LINE_RE = /rsync -a ([^\\"]*)\\"\$\{REPO_ROOT\}\/([^\\"]+)\/\\" \\"\$\{HOME\}\/([^\\"]+)\/\\"/g;

function readRsyncLines(text) {
  const lines = [];
  let m;
  RSYNC_LINE_RE.lastIndex = 0;
  while ((m = RSYNC_LINE_RE.exec(text)) !== null) {
    const excludes = [...m[1].matchAll(/--exclude=(\S+)/g)].map((e) => e[1]);
    lines.push({ raw: m[0], excludes, origin: m[2], target: m[3] });
  }
  return lines;
}

test('install.sh: toda origem rsync "${REPO_ROOT}/X/" existe no repo como diretório', () => {
  const text = fs.readFileSync(INSTALL_SH, 'utf8');
  const lines = readRsyncLines(text);

  // Vacuity guard — se a regex parar de casar (reformatação do arquivo,
  // por exemplo), este teste passaria vazio sem checar nada. 5 é o número
  // medido hoje: core/, core/hooks/, core/adapters/claude/commands/,
  // templates/, output-styles/.
  assert.equal(
    lines.length,
    5,
    `esperava 5 linhas de rsync com origem em \${REPO_ROOT}, achou ${lines.length}: ${JSON.stringify(lines.map((l) => l.origin))}`
  );

  for (const { origin, raw } of lines) {
    const originAbs = path.join(REPO_ROOT, origin);
    assert.ok(
      fs.existsSync(originAbs) && fs.statSync(originAbs).isDirectory(),
      `origem "${origin}" (linha: ${raw}) não existe como diretório em ${REPO_ROOT} — 3a ocorrência desta classe de bug (rsync apontando pra diretório que uma migração anterior moveu ou apagou)`
    );
  }
});

test('rollout vale para os dois mecanismos: install.sh instala soma-run.md declarado no install-targets', () => {
  const targets = JSON.parse(fs.readFileSync(CLAUDE_TARGETS, 'utf8'));
  const somaRun = targets.entries.find((entry) => entry.source_path === 'adapters/claude/commands/soma-run.md');
  assert.deepEqual(somaRun, { kind: 'file', source_path: 'adapters/claude/commands/soma-run.md', target_path: '~/.claude/commands/soma-run.md' });

  const text = fs.readFileSync(INSTALL_SH, 'utf8');
  const lines = readRsyncLines(text);
  const commandsLine = lines.find((l) => l.target.endsWith('commands'));
  assert.ok(commandsLine, 'não achei, em install.sh, a linha de rsync cujo destino termina em "commands" (a sincronização de .claude/commands)');

  assert.equal(commandsLine.excludes.includes('soma-run.md'), false, commandsLine.raw);
});
