'use strict';
/**
 * detect-collisions-soma-dir.test.cjs — T-08c
 *
 * install.sh:117 called detect-collisions.cjs without --soma-sums, so
 * `shaSums` defaulted to {} and EVERY SOMA-listed hook present in the
 * user's real ~/.claude/hooks/ was reported as a collision ("no shipped
 * sha available for comparison"). Measured against Felipe's real
 * ~/.claude/hooks/: 18 false-positive collisions with --soma-sums absent
 * vs 2 real ones with a real sha reference supplied. With
 * FORCE_OVERWRITE=1 that's 18 real hooks renamed to .bak, 16 of them
 * byte-identical to what was about to be installed — pure noise dressed
 * as caution.
 *
 * Fix: a new --soma-dir=<dir> flag computes the shipped shas itself
 * (reusing sha256File(), already in this module) from real files on
 * disk, instead of requiring a caller to pre-generate a sums JSON.
 * install.sh:117 now passes --soma-dir="${REPO_ROOT}/core/hooks" — always
 * a real reference, so the CLI never runs in degraded mode in
 * production. And if NEITHER --soma-sums NOR --soma-dir is given, the
 * CLI now exits non-zero with a clear stderr message instead of
 * silently defaulting to {} and flagging everything.
 *
 * All cases below use ONLY synthetic fixtures for the "target" (the
 * simulated ~/.claude/hooks/) — the real ~/.claude/hooks/ is never read
 * or written. --soma-dir in the first case points at this repo's OWN
 * core/hooks/, which is checked-out source, not the user's live
 * installation — reading it is exactly what --soma-dir does in
 * production, and it's the same kind of read every other test in this
 * suite already does (e.g. install-targets-set.test.cjs reading
 * core/hooks/ to derive its expected set).
 *
 * T-08c pt.3 (found on review): computeShaSumsFromDir(dir, basenames)
 * checked `fs.existsSync(filePath)` per basename but never checked that
 * `dir` itself exists — a nonexistent --soma-dir silently produced {}
 * (nothing found for any basename), which reproduces the EXACT blind
 * bug --soma-dir was built to fix: every SOMA-listed hook present in
 * --target gets reported as a collision, with no error, no clue it's
 * even happening. Measured, not hypothetical: hooks/ became core/hooks/
 * on THIS branch today (T-08a); a future re-move or a different
 * REPO_ROOT resolution would silently reopen the hole. Fixed by making
 * computeShaSumsFromDir throw when `dir` doesn't exist (or exists but
 * matches zero of the basenames) — see the two new tests below, plus
 * the "zero modifications, real dir" control that keeps this from
 * turning "fail loud" into "fail always".
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

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DETECT_CJS = path.join(REPO_ROOT, 'install', 'detect-collisions.cjs');
const REAL_HOOKS_DIR = path.join(REPO_ROOT, 'core', 'hooks');

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

function runDetect(args) {
  return spawnSync('node', [DETECT_CJS, ...args], { encoding: 'utf8', timeout: 15000 });
}

test('--soma-dir: 2 hooks byte-idênticos ao repo + 1 modificado -> exatamente 1 colisão, nomeada', () => {
  withTmp('detect-collisions-target-', (targetDir) => {
    withTmp('detect-collisions-somalist-', (listDir) => {
      // 2 hooks copiados byte-a-byte do repo real (core/hooks/ — checkout
      // versionado, NUNCA ~/.claude/hooks/, que não é tocado aqui).
      const clean1 = fs.readFileSync(path.join(REAL_HOOKS_DIR, 'thermal-guard.cjs'));
      const clean2 = fs.readFileSync(path.join(REAL_HOOKS_DIR, 'pre-commit-gate.cjs'));
      fs.writeFileSync(path.join(targetDir, 'thermal-guard.cjs'), clean1);
      fs.writeFileSync(path.join(targetDir, 'pre-commit-gate.cjs'), clean2);

      // 1 hook modificado — diverge deliberadamente da versão shipada.
      const original3 = fs.readFileSync(path.join(REAL_HOOKS_DIR, 'depth-guard.cjs'), 'utf8');
      fs.writeFileSync(path.join(targetDir, 'depth-guard.cjs'), original3 + '\n// modificado pelo usuario\n');

      const somaListPath = path.join(listDir, 'soma-list.json');
      fs.writeFileSync(somaListPath, JSON.stringify(['thermal-guard', 'pre-commit-gate', 'depth-guard']));

      const r = runDetect([
        `--target=${targetDir}`,
        `--soma-list=${somaListPath}`,
        `--soma-dir=${REAL_HOOKS_DIR}`,
      ]);

      assert.equal(r.status, 0, `detect-collisions saiu != 0: ${r.stderr}`);
      const lines = r.stdout.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 1, `esperava exatamente 1 colisão, achou ${lines.length}: ${JSON.stringify(lines)}`);
      assert.ok(lines[0].includes('depth-guard.cjs'), `a colisão devia ser depth-guard.cjs, achou: ${lines[0]}`);
    });
  });
});

test('--soma-dir apontando pra diretório inexistente: falha alto nomeando o diretório, NÃO devolve lista de colisões', () => {
  withTmp('detect-collisions-target-', (targetDir) => {
    withTmp('detect-collisions-somalist-', (listDir) => {
      // Hook SOMA-listado, byte-idêntico ao repo — se computeShaSumsFromDir
      // tratar "diretório não existe" como {} (o bug), isto reaparece como
      // colisão falsa, IDÊNTICO ao bug que --soma-dir foi criado pra matar.
      // Isto é medido, não hipotético: hooks/ virou core/hooks/ NESTA
      // branch hoje (T-08a) — se mover de novo, ou o REPO_ROOT resolver
      // diferente, --soma-dir aponta pro vazio e o detector volta a
      // mentir em silêncio.
      const clean = fs.readFileSync(path.join(REAL_HOOKS_DIR, 'thermal-guard.cjs'));
      fs.writeFileSync(path.join(targetDir, 'thermal-guard.cjs'), clean);

      const somaListPath = path.join(listDir, 'soma-list.json');
      fs.writeFileSync(somaListPath, JSON.stringify(['thermal-guard']));

      const bogusDir = path.join(listDir, 'nao-existe-de-jeito-nenhum');
      assert.ok(!fs.existsSync(bogusDir), 'precondição: o diretório bogus não pode existir');

      const r = runDetect([
        `--target=${targetDir}`,
        `--soma-list=${somaListPath}`,
        `--soma-dir=${bogusDir}`,
      ]);

      assert.notEqual(r.status, 0, `--soma-dir inexistente tem que falhar alto (exit != 0), não devolver silenciosamente. status=${r.status} stdout=${r.stdout}`);
      assert.ok(r.stderr.includes(bogusDir), `stderr devia nomear o diretório inexistente (${bogusDir}): ${r.stderr}`);
      assert.ok(
        !r.stdout.includes('thermal-guard.cjs'),
        `não deveria listar thermal-guard.cjs como colisão — isso seria o bug antigo (--soma-dir inexistente == {} == "sem sha == colisão"): stdout=${r.stdout}`
      );
    });
  });
});

test('--soma-dir válido, zero hooks modificados: zero colisões e exit 0 (controle contra "falha alto vira falha sempre")', () => {
  withTmp('detect-collisions-target-', (targetDir) => {
    withTmp('detect-collisions-somadir-', (somaDir) => {
      withTmp('detect-collisions-somalist-', (listDir) => {
        // O mesmo conteúdo dos dois lados — hook shipado e hook instalado
        // são byte-idênticos. Nenhuma modificação real, nenhuma colisão.
        const content = 'module.exports = function fakeHook() { return 0; };\n';
        fs.writeFileSync(path.join(targetDir, 'meu-hook.cjs'), content);
        fs.writeFileSync(path.join(somaDir, 'meu-hook.cjs'), content);

        const somaListPath = path.join(listDir, 'soma-list.json');
        fs.writeFileSync(somaListPath, JSON.stringify(['meu-hook']));

        const r = runDetect([
          `--target=${targetDir}`,
          `--soma-list=${somaListPath}`,
          `--soma-dir=${somaDir}`,
        ]);

        assert.equal(r.status, 0, `--soma-dir válido com zero divergência tem que dar exit 0: stderr=${r.stderr}`);
        assert.equal(r.stdout.trim().length, 0, `zero colisões reais tem que dar stdout vazio, achou: ${JSON.stringify(r.stdout)}`);
      });
    });
  });
});

test('sem --soma-sums e sem --soma-dir: falha alto, NÃO trata tudo como colisão', () => {
  withTmp('detect-collisions-target-', (targetDir) => {
    withTmp('detect-collisions-somalist-', (listDir) => {
      // Hook SOMA-listado, byte-idêntico ao repo — se o modo degradado
      // "tudo é colisão" ainda existisse, isto apareceria como colisão
      // falsa (é exatamente o bug medido contra o ~/.claude/hooks real).
      const clean = fs.readFileSync(path.join(REAL_HOOKS_DIR, 'thermal-guard.cjs'));
      fs.writeFileSync(path.join(targetDir, 'thermal-guard.cjs'), clean);

      const somaListPath = path.join(listDir, 'soma-list.json');
      fs.writeFileSync(somaListPath, JSON.stringify(['thermal-guard']));

      const r = runDetect([`--target=${targetDir}`, `--soma-list=${somaListPath}`]);

      assert.notEqual(r.status, 0, 'sem nenhuma referência de sha, o CLI tem que falhar alto (exit != 0), não devolver silenciosamente');
      assert.match(r.stderr, /soma-sums|soma-dir/i, `stderr devia explicar que falta --soma-sums ou --soma-dir: ${r.stderr}`);
      // Prova negativa do modo degradado antigo: com o bug, isto sairia
      // exit 0 e listaria thermal-guard.cjs como colisão "sem referência".
      assert.ok(
        !r.stdout.includes('thermal-guard.cjs'),
        `não deveria listar thermal-guard.cjs como colisão silenciosa: stdout=${r.stdout}`
      );
    });
  });
});
