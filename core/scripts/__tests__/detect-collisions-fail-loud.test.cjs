'use strict';
/**
 * detect-collisions-fail-loud.test.cjs — T-08c pt.2
 *
 * install.sh's collision-detection block used to be:
 *
 *   COLLISIONS=$(node ".../detect-collisions.cjs" ... 2>/dev/null || echo "")
 *
 * Two things wrong in the same expression: `2>/dev/null` swallowed the
 * detector's stderr, and `|| echo ""` made ANY detector failure (bad
 * args, corrupt JSON, exception) collapse into COLLISIONS="" — the
 * installer would then conclude "clean" and proceed to overwrite,
 * exactly when it least should. A fallback fabricating the result it
 * expects to see, inside a verification command.
 *
 * Separately, detect-collisions.cjs's own CLI printed "No collisions
 * detected." to STDOUT on the zero-collision success path — a non-empty
 * string, which install.sh's `[[ -n "${COLLISIONS}" ]]` reads as
 * truthy. On a real machine that means a false "[COLLISION] Custom-
 * modified hooks found" prompt on every clean, successful install. Fixed
 * by moving that message to stderr (informational, not payload) so
 * stdout is genuinely empty on the zero-collision path.
 *
 * This file proves BOTH fixes against install.sh's ACTUAL bash lines —
 * not a hand-copied reimplementation. It extracts the block bracketed
 * by the `T08C_COLLISION_DETECT_BEGIN`/`_END` sentinel comments in
 * install.sh and executes it, verbatim, inside a disposable sandbox:
 * fake $HOME (target dir) and fake $REPO_ROOT (containing a real COPY
 * of install/detect-collisions.cjs plus a controlled soma-hooks-map.json
 * and core/hooks/). install.sh itself is NEVER invoked, and the real
 * ~/.claude/hooks/ is NEVER read or written.
 *
 * T-08c pt.3 adds one more case here: install.sh's real --soma-dir
 * argument (${REPO_ROOT}/core/hooks) going missing (see
 * computeShaSumsFromDir's own fix in detect-collisions.cjs) also has to
 * abort THIS block, end to end — not just the standalone CLI.
 *
 * @spec [SPEC:AC-05]
 * @task T-08c
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REAL_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_SH = path.join(REAL_REPO_ROOT, 'install.sh');
const REAL_DETECT_CJS = path.join(REAL_REPO_ROOT, 'install', 'detect-collisions.cjs');

const BEGIN_MARKER = '# T08C_COLLISION_DETECT_BEGIN';
const END_MARKER = '# T08C_COLLISION_DETECT_END';

function extractCollisionBlock() {
  const text = fs.readFileSync(INSTALL_SH, 'utf8');
  const beginIdx = text.indexOf(BEGIN_MARKER);
  const endIdx = text.indexOf(END_MARKER);
  assert.ok(beginIdx !== -1, `install.sh missing ${BEGIN_MARKER} — sentinel removed?`);
  assert.ok(endIdx !== -1 && endIdx > beginIdx, `install.sh missing ${END_MARKER} — sentinel removed?`);
  // Everything BETWEEN the markers, excluding the marker lines themselves.
  const beginLineEnd = text.indexOf('\n', beginIdx) + 1;
  return text.slice(beginLineEnd, endIdx);
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTmp(prefix, fn) {
  const dir = mkTmp(prefix);
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build a fake $REPO_ROOT: a real COPY of detect-collisions.cjs (so
 * whatever bug/fix state that file is in gets exercised faithfully) plus
 * a caller-controlled soma-hooks-map.json and core/hooks/ dir.
 */
function buildFakeRepoRoot(dir, { somaListContent, hookFiles }) {
  fs.mkdirSync(path.join(dir, 'install'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'core', 'hooks'), { recursive: true });
  fs.copyFileSync(REAL_DETECT_CJS, path.join(dir, 'install', 'detect-collisions.cjs'));
  fs.writeFileSync(path.join(dir, 'install', 'soma-hooks-map.json'), somaListContent);
  for (const [name, content] of Object.entries(hookFiles || {})) {
    fs.writeFileSync(path.join(dir, 'core', 'hooks', name), content);
  }
}

function runExtractedBlock({ repoRoot, home }) {
  const script = `#!/usr/bin/env bash\nset -euo pipefail\nREPO_ROOT=${JSON.stringify(repoRoot)}\n${extractCollisionBlock()}\nprintf 'COLLISIONS_RESULT=[%s]\\n' "${'$'}{COLLISIONS}"\n`;
  return withTmp('detect-collisions-wrapper-', (scratchDir) => {
    const scriptPath = path.join(scratchDir, 'wrapper.sh');
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    return spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, HOME: home },
    });
  });
}

test('install.sh: detector com JSON corrompido em --soma-list falha alto, não vira COLLISIONS vazio', () => {
  withTmp('detect-collisions-home-', (fakeHome) => {
    withTmp('detect-collisions-reporoot-', (fakeRepoRoot) => {
      fs.mkdirSync(path.join(fakeHome, '.claude', 'hooks'), { recursive: true });
      // Um arquivo qualquer no destino — não precisa colidir com nada,
      // o objetivo é só garantir que HOOKS_TARGET existe como diretório
      // (senão o bloco cai no `else COLLISIONS=""`, sem nem chamar o detector).
      fs.writeFileSync(path.join(fakeHome, '.claude', 'hooks', 'user-hook.cjs'), '// user hook');

      buildFakeRepoRoot(fakeRepoRoot, {
        somaListContent: 'isto não é json { { {', // força o detector a falhar
        hookFiles: {},
      });

      const r = runExtractedBlock({ repoRoot: fakeRepoRoot, home: fakeHome });

      assert.notEqual(r.status, 0, `bloco de install.sh deveria abortar (set -euo pipefail) quando o detector falha. status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
      assert.ok(r.stderr && r.stderr.trim().length > 0, 'stderr do detector não pode ficar vazio — era isso que o 2>/dev/null escondia');
      assert.ok(
        !r.stdout.includes('COLLISIONS_RESULT='),
        `o script tem que abortar ANTES do echo final — se aparecer, o erro foi engolido e a execução continuou: stdout=${r.stdout}`
      );
    });
  });
});

test('install.sh: --soma-dir (core/hooks) inexistente também aborta — não vira "sem colisões" (T-08c pt.3)', () => {
  // Cenário real, não hipotético: install.sh sempre passa
  // --soma-dir="${REPO_ROOT}/core/hooks". Se esse diretório sumir de novo
  // (outro `git mv`, um REPO_ROOT que resolve diferente), o detector
  // precisa abortar — não silenciosamente reportar todo hook do target
  // como colisão (T-08c pt.1) nem silenciosamente "sem colisões" (o
  // bug que este arquivo inteiro existe pra matar).
  withTmp('detect-collisions-home-', (fakeHome) => {
    withTmp('detect-collisions-reporoot-', (fakeRepoRoot) => {
      fs.mkdirSync(path.join(fakeHome, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.claude', 'hooks', 'meu-hook.cjs'), '// hook do soma no destino');

      fs.mkdirSync(path.join(fakeRepoRoot, 'install'), { recursive: true });
      fs.copyFileSync(REAL_DETECT_CJS, path.join(fakeRepoRoot, 'install', 'detect-collisions.cjs'));
      fs.writeFileSync(path.join(fakeRepoRoot, 'install', 'soma-hooks-map.json'), JSON.stringify(['meu-hook']));
      // Deliberadamente SEM core/hooks/ — install.sh aponta --soma-dir pra
      // lá incondicionalmente; isto simula ele ter sumido.
      assert.ok(!fs.existsSync(path.join(fakeRepoRoot, 'core', 'hooks')), 'precondição: core/hooks/ não pode existir neste fixture');

      const r = runExtractedBlock({ repoRoot: fakeRepoRoot, home: fakeHome });

      assert.notEqual(r.status, 0, `bloco de install.sh deveria abortar quando --soma-dir não existe. status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
      assert.ok(r.stderr.includes('core/hooks') || r.stderr.includes(path.join(fakeRepoRoot, 'core', 'hooks')), `stderr devia nomear o --soma-dir ausente: ${r.stderr}`);
      assert.ok(
        !r.stdout.includes('meu-hook.cjs'),
        `não deveria listar meu-hook.cjs como colisão — seria o bug T-08c pt.1 reaberto por um --soma-dir quebrado: stdout=${r.stdout}`
      );
      assert.ok(
        !r.stdout.includes('COLLISIONS_RESULT='),
        `o script tem que abortar ANTES do echo final: stdout=${r.stdout}`
      );
    });
  });
});

test('install.sh: zero colisões reais -> COLLISIONS fica vazio de verdade (não "No collisions detected.")', () => {
  withTmp('detect-collisions-home-', (fakeHome) => {
    withTmp('detect-collisions-reporoot-', (fakeRepoRoot) => {
      fs.mkdirSync(path.join(fakeHome, '.claude', 'hooks'), { recursive: true });
      // Hook no destino que não está na lista SOMA — não deveria colidir.
      fs.writeFileSync(path.join(fakeHome, '.claude', 'hooks', 'user-hook.cjs'), '// user hook');

      buildFakeRepoRoot(fakeRepoRoot, {
        // "some-hook" existe no soma-dir (senão o guarda da T-08c pt.3
        // dispararia: "--soma-dir não casou nenhum basename" também é
        // falha alta, e por bom motivo) mas NÃO existe no destino — zero
        // colisões possíveis, porque detectCollisions só olha os
        // arquivos que EXISTEM em --target.
        somaListContent: JSON.stringify(['some-hook']),
        hookFiles: { 'some-hook.cjs': '// shipped version, not installed anywhere' },
      });

      const r = runExtractedBlock({ repoRoot: fakeRepoRoot, home: fakeHome });

      assert.equal(r.status, 0, `bloco deveria ter sucesso: stdout=${r.stdout} stderr=${r.stderr}`);
      assert.match(
        r.stdout,
        /COLLISIONS_RESULT=\[\]/,
        `COLLISIONS deveria ficar vazio — se aparecer "No collisions detected." aqui dentro, install.sh trataria isso como colisão de verdade (string não-vazia): stdout=${r.stdout}`
      );
    });
  });
});
