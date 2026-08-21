'use strict';
/**
 * framework-guard.test.cjs — T-05
 * Contract test for CONTRACT-FRAMEWORK-GUARD-04.
 *
 * `hooks/framework-guard.cjs` does not exist yet — it's T-12, a later wave.
 * Every test here spawns that (missing) file, so every test is RED PLANNED
 * (Article III: contract test before implementation) until T-12 lands.
 * The registry test (#9) reads `install/soma-hooks-map.json` directly and
 * is also expected RED today, unless T-15 (running in parallel, same repo,
 * different files) has already landed the wiring entry by the time this
 * runs — in that case #9 may already be green. Either outcome is correct;
 * this file does not write to soma-hooks-map.json.
 *
 * Real git repos in a temp dir, real `git add` — no `fs` mock, no fake git
 * plumbing (Integration-First Gate). Two traps this suite exists to not
 * fall into (both produced false-green 2x on 2026-08-14/15, per the
 * contract): sessionId MUST come from CK_SESSION_ID/CLAUDE_SESSION_ID env
 * vars, never from stdin; TMPDIR is actively overridden per-test, never
 * assumed to be `/tmp`.
 *
 * @spec [SPEC:AC-07] [SPEC:AC-13]
 * @contract CONTRACT-FRAMEWORK-GUARD-04
 * @task T-05
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'framework-guard.cjs');
const HOOKS_MAP = path.join(__dirname, '..', '..', 'install', 'soma-hooks-map.json');

// ── fixtures ────────────────────────────────────────────────────────────

function initTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guard-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function stageFile(repoDir, relPath, content = 'x\n') {
  const abs = path.join(repoDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  execFileSync('git', ['add', relPath], { cwd: repoDir });
}

function markerPath(tmpdir, sessionId) {
  return path.join(tmpdir, `claude-framework-guard-bypass-${sessionId}.marker`);
}

function writeMarker(tmpdir, sessionId) {
  const p = markerPath(tmpdir, sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '', 'utf-8');
  return p;
}

/**
 * Spawn the hook with a PreToolUse-shaped stdin payload.
 * Always scrubs CK_SESSION_ID/CLAUDE_SESSION_ID from the inherited env
 * first — this dev session very plausibly has one of those set for real,
 * and an unscrubbed inherited value would silently make "no matching
 * marker" tests pass or fail for the wrong reason.
 */
function runHook({ cwd, command = 'git commit -m "test"', sessionId, tmpdir, stdinSessionId } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CK_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    if (sessionId !== undefined) env.CK_SESSION_ID = sessionId;
    if (tmpdir !== undefined) env.TMPDIR = tmpdir;

    const payload = JSON.stringify({
      tool_input: { command },
      // Real Claude Code PreToolUse payloads carry a top-level session_id.
      // The contract requires the hook to ignore it and use the env var
      // instead — this field exists so test #6 can prove that.
      ...(stdinSessionId !== undefined ? { session_id: stdinSessionId } : {}),
    });

    let proc;
    try {
      proc = spawn(process.execPath, [HOOK], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
    } catch (err) {
      resolve({ code: null, stderr: String((err && err.stack) || err) });
      return;
    }
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => resolve({ code: null, stderr: String((err && err.stack) || err) }));
    proc.stdin.write(payload);
    proc.stdin.end();
    proc.on('close', code => resolve({ code, stderr }));
  });
}

function cleanup(...dirsOrFiles) {
  for (const p of dirsOrFiles) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

// ── AC-07: bloqueia protegido sem override ─────────────────────────────

test('CONTRACT: staged em hooks/** sem marker -> exit 2 listando o path', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t1-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, 'hooks/thermal-guard.cjs'); // exemplo do próprio AC-07 no spec.md
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 2, `esperava exit 2, veio ${code}. stderr: ${stderr}`);
    assert.ok(stderr.includes('hooks/thermal-guard.cjs'), `esperava o path ofensor na stderr, veio: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

test('CONTRACT: CONTEÚDO — a stderr nomeia cada path ofensor, não só "bloqueado" (2 arquivos protegidos, os 2 aparecem)', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t2-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, 'hooks/foo.cjs');
    stageFile(repo, 'core/scripts/bar.cjs');
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 2, `esperava exit 2, veio ${code}. stderr: ${stderr}`);
    const lines = stderr.split('\n');
    assert.ok(lines.some(l => l.includes('hooks/foo.cjs')), `esperava linha citando hooks/foo.cjs, stderr: ${stderr}`);
    assert.ok(lines.some(l => l.includes('core/scripts/bar.cjs')), `esperava linha citando core/scripts/bar.cjs, stderr: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

// ── AC-07: libera não-protegido — o outro lado, peso igual ────────────

test('CONTRACT: staged só em paths não protegidos -> exit 0 e silêncio', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t3-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, 'README.md');
    stageFile(repo, 'src/index.js');
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 0, `esperava exit 0, veio ${code}. stderr: ${stderr}`);
    assert.equal(stderr.trim(), '', `esperava stderr vazio (silêncio, per a tabela de exit contract), veio: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

// ── T-08a / D-018-07: core/hooks/** protegido após o git mv — controle
// nos DOIS sentidos, senão este teste passa igualmente bem com o guarda
// cego (padrão do próprio CLAUDE.md: um verificador que só prova o lado
// positivo não prova que a régua parou no lugar certo). Escrito ANTES do
// `git mv hooks core/hooks` — precisa FALHAR agora (PROTECTED_PATTERNS
// ainda é literal `hooks/**`, que não casa `core/hooks/**`) e passar
// depois que PROTECTED_PATTERNS virar `core/hooks/**`.

test("T-08a: staged em core/hooks/** -> BLOQUEADO (exit 2) apos o git mv", async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t08a-pos-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, "core/hooks/framework-guard.cjs");
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 2, `esperava exit 2 (core/hooks/** protegido), veio ${code}. stderr: ${stderr}`);
    assert.ok(stderr.includes("core/hooks/framework-guard.cjs"), `esperava o path ofensor na stderr, veio: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

test("T-08a: staged em path nao-protegido -> LIBERADO (exit 0) — controle negativo do par acima", async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t08a-neg-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, "README.md");
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 0, `esperava exit 0, veio ${code}. stderr: ${stderr}`);
    assert.equal(stderr.trim(), "", `esperava stderr vazio (silencio), veio: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

// ── AC-13: override por marker, nunca silencioso ───────────────────────

test('CONTRACT: AC-13 — com marker -> exit 0 E stderr declara o override', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t4-${process.pid}-${Date.now()}`;
  const marker = writeMarker(os.tmpdir(), sessionId);
  try {
    stageFile(repo, 'hooks/foo.cjs');
    stageFile(repo, 'constitution.md');
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 0, `esperava exit 0 com marker presente, veio ${code}. stderr: ${stderr}`);
    assert.notEqual(stderr.trim(), '', 'AC-13: o override nunca é silencioso — esperava stderr declarando o override, veio vazio');
    assert.ok(stderr.includes('hooks/foo.cjs'), `esperava os paths liberados citados na stderr, veio: ${stderr}`);
    assert.ok(stderr.includes('constitution.md'), `esperava os paths liberados citados na stderr, veio: ${stderr}`);
  } finally {
    cleanup(repo, marker);
  }
});

test('CONTRACT: marker de OUTRA sessão não libera — continua bloqueando', async () => {
  const repo = initTmpRepo();
  const sessionA = `fw-t5-a-${process.pid}-${Date.now()}`;
  const sessionB = `fw-t5-b-${process.pid}-${Date.now()}`;
  const marker = writeMarker(os.tmpdir(), sessionA);
  try {
    stageFile(repo, 'hooks/foo.cjs');
    const { code, stderr } = await runHook({ cwd: repo, sessionId: sessionB });
    assert.equal(code, 2, `esperava exit 2 (marker é da sessão ${sessionA}, hook roda como ${sessionB}), veio ${code}. stderr: ${stderr}`);
  } finally {
    cleanup(repo, marker);
  }
});

// ── sessionId: env var, nunca stdin ─────────────────────────────────────

test('CONTRACT: sessionId vem de env var, não de stdin', async () => {
  const repo = initTmpRepo();
  const sessionEnv = `fw-t6-env-${process.pid}-${Date.now()}`; // sem marker
  const sessionStdin = `fw-t6-stdin-${process.pid}-${Date.now()}`; // TEM marker
  const marker = writeMarker(os.tmpdir(), sessionStdin);
  try {
    stageFile(repo, 'hooks/foo.cjs');
    // Payload PreToolUse real carrega session_id no topo — o hook TEM que
    // ignorá-lo e usar CK_SESSION_ID/CLAUDE_SESSION_ID. Se ele lesse do
    // stdin, acharia o marker de sessionStdin e liberaria por engano.
    const { code, stderr } = await runHook({ cwd: repo, sessionId: sessionEnv, stdinSessionId: sessionStdin });
    assert.equal(
      code, 2,
      `esperava exit 2 — env session (${sessionEnv}) não tem marker; se deu 0, o hook leu session_id do stdin (${sessionStdin}) em vez do env var. stderr: ${stderr}`
    );
  } finally {
    cleanup(repo, marker);
  }
});

// ── os.tmpdir(), não /tmp hardcoded — prova nos dois sentidos ──────────

test('CONTRACT: usa os.tmpdir(), não /tmp hardcoded — TMPDIR alterado é onde o marker é procurado', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-t7-${process.pid}-${Date.now()}`;
  const customTmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guard-tmpdir-a-'));
  const customTmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guard-tmpdir-b-'));
  assert.notEqual(customTmpA, '/tmp');
  assert.notEqual(customTmpB, '/tmp');
  assert.notEqual(customTmpA, customTmpB);
  writeMarker(customTmpA, sessionId); // marker só existe em A, não em B
  try {
    stageFile(repo, 'hooks/foo.cjs');

    // Positivo: TMPDIR=A (tem o marker) -> libera
    const positive = await runHook({ cwd: repo, sessionId, tmpdir: customTmpA });
    assert.equal(
      positive.code, 0,
      `esperava exit 0 com TMPDIR=${customTmpA} (marker presente lá), veio ${positive.code}. stderr: ${positive.stderr}`
    );

    // Negativo: TMPDIR=B (mesma sessão, sem marker lá) -> continua bloqueado.
    // Se isto der 0 em vez de 2, o hook está achando o marker num lugar
    // fixo (ex.: /tmp hardcoded, ou cacheado da chamada anterior) e
    // ignorando o TMPDIR que o processo realmente recebeu.
    const negative = await runHook({ cwd: repo, sessionId, tmpdir: customTmpB });
    assert.equal(
      negative.code, 2,
      `esperava exit 2 com TMPDIR=${customTmpB} (sem marker lá), veio ${negative.code}. Isso indicaria /tmp hardcoded ou path fixo. stderr: ${negative.stderr}`
    );
  } finally {
    cleanup(repo, customTmpA, customTmpB);
  }
});

// ── fail-open fora de repo git ───────────────────────────────────────────

test('CONTRACT: fora de repo git -> exit 0 com warning, não bloqueia', async () => {
  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guard-non-repo-'));
  const sessionId = `fw-t8-${process.pid}-${Date.now()}`;
  try {
    const { code, stderr } = await runHook({ cwd: nonRepo, sessionId });
    assert.equal(code, 0, `esperava exit 0 (fail-open fora de repo git), veio ${code}. stderr: ${stderr}`);
    assert.notEqual(stderr.trim(), '', 'esperava warning na stderr quando git diff --cached falha (não é repo)');
  } finally {
    cleanup(nonRepo);
  }
});

// ── regression (2026-08-17): constitution* cru não protegia a constituição
// real deste repo. `core/docs/constitution.md` e `core/docs/constitution-
// amendments/*.md` são o artefato mais normativo do projeto; o guard tinha
// que bloquear staged nesses paths e não bloqueava (silêncio-que-lê-como-
// aprovação, ver contract's nota de 2026-08-17). Par positivo/negativo,
// não só o positivo — um teste sem controle negativo não prova que a régua
// ficou mais permissiva do que devia (foi assim que o probe manual que
// achou o bug quase deu falso-negativo: sem stdin, o hook sai 0 pra
// qualquer coisa, então o primeiro controle "positivo" também dava 0). ───

test('CONTRACT: regressão — core/docs/constitution.md staged -> bloqueia', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-const1-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, 'core/docs/constitution.md');
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 2, `esperava exit 2, veio ${code}. stderr: ${stderr}`);
    assert.ok(stderr.includes('core/docs/constitution.md'), `esperava o path ofensor na stderr, veio: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

test('CONTRACT: regressão — core/docs/constitution-amendments/*.md staged -> bloqueia', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-const2-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, 'core/docs/constitution-amendments/1.1.0-qualquer.md');
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 2, `esperava exit 2, veio ${code}. stderr: ${stderr}`);
    assert.ok(
      stderr.includes('core/docs/constitution-amendments/1.1.0-qualquer.md'),
      `esperava o path ofensor na stderr, veio: ${stderr}`
    );
  } finally {
    cleanup(repo);
  }
});

// Controle negativo — mesmo diretório (core/docs/), mas nome que genuinamente
// não deve casar nenhum dos dois padrões de constituição (não começa com
// "constitution" em segmento algum do path). Sem este par, o teste acima só
// prova que a régua bloqueia — não prova que ela parou no lugar certo.
test('CONTRACT: controle negativo — core/docs/README.md staged (mesmo dir, não é constituição) -> exit 0 e silêncio', async () => {
  const repo = initTmpRepo();
  const sessionId = `fw-const3-${process.pid}-${Date.now()}`;
  try {
    stageFile(repo, 'core/docs/README.md');
    const { code, stderr } = await runHook({ cwd: repo, sessionId });
    assert.equal(code, 0, `esperava exit 0, veio ${code}. stderr: ${stderr}`);
    assert.equal(stderr.trim(), '', `esperava stderr vazio (silêncio), veio: ${stderr}`);
  } finally {
    cleanup(repo);
  }
});

// ── wiring: sem entrada no soma-hooks-map.json, o hook nunca dispara ───

test('CONTRACT: está registrado em install/soma-hooks-map.json com PreToolUse/Bash', () => {
  const raw = fs.readFileSync(HOOKS_MAP, 'utf-8');
  const map = JSON.parse(raw);
  const preToolUse = (map.hooks && map.hooks.PreToolUse) || [];
  const matches = preToolUse.filter(entry =>
    entry.matcher === 'Bash' &&
    (entry.hooks || []).some(h => typeof h.command === 'string' && h.command.includes('framework-guard.cjs'))
  );
  assert.ok(
    matches.length > 0,
    `esperava uma entrada PreToolUse com matcher 'Bash' citando framework-guard.cjs em ${HOOKS_MAP}. ` +
    `O arquivo do hook existir no disco não basta — sem esse wiring ele nunca dispara ` +
    `(mesmo defeito que aposentou o spec-test-traceability.cjs, medido em 2929f50).`
  );
});
