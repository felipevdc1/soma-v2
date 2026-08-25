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

// Matches direct rsync calls from a repo asset root into HOME. The core is
// staged inside the durable transaction first, so it is checked separately.
const RSYNC_LINE_RE = /rsync -a ([^\n"]*)"\$\{REPO_ROOT\}\/([^"]+)\/" "\$\{HOME\}\/([^"]+)\/"/g;

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

  // Spec 026: somente assets fora dos adapters usam repo -> HOME direto.
  assert.equal(
    lines.length,
    2,
    `esperava 2 linhas de rsync com origem em \${REPO_ROOT}, achou ${lines.length}: ${JSON.stringify(lines.map((l) => l.origin))}`
  );

  for (const { origin, raw } of lines) {
    const originAbs = path.join(REPO_ROOT, origin);
    assert.ok(
      fs.existsSync(originAbs) && fs.statSync(originAbs).isDirectory(),
      `origem "${origin}" (linha: ${raw}) não existe como diretório em ${REPO_ROOT} — 3a ocorrência desta classe de bug (rsync apontando pra diretório que uma migração anterior moveu ou apagou)`
    );
  }

  assert.match(text, /rsync -a "\$\{REPO_ROOT\}\/core\/" "\$\{STAGED_CORE\}\/"/);
  assert.match(text, /rsync -a --checksum --no-times "\$\{STAGED_CORE\}\/" "\$\{HOME\}\/\.soma-v2\/"/);
});

test('026 AC-06: install.sh deixa todos os whole-files exclusivamente para sync', () => {
  const targets = JSON.parse(fs.readFileSync(CLAUDE_TARGETS, 'utf8'));
  const somaRun = targets.entries.find((entry) => entry.source_path === 'adapters/claude/commands/soma-run.md');
  assert.deepEqual(somaRun, { kind: 'file', source_path: 'adapters/claude/commands/soma-run.md', target_path: '~/.claude/commands/soma-run.md' });

  const text = fs.readFileSync(INSTALL_SH, 'utf8');
  const lines = readRsyncLines(text);
  assert.equal(lines.some((line) => line.target.endsWith('hooks') || line.target.endsWith('commands')), false);
  assert.match(text, /sync --apply --files-only --tool=claude[^\n]*--ledger-root="\$\{HOME\}\/\.soma-v2"/);
});
