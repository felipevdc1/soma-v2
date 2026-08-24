'use strict';
/**
 * operator-gate.test.cjs — RED do AC-01 (spec 024, gate de operador)
 *
 * `core/hooks/operator-gate.cjs` não existe ainda — este arquivo é o
 * contrato executável do AC-01 (RED PLANNED, mesmo padrão do
 * framework-guard.test.cjs), até o hook nascer. Este arquivo NÃO cria o
 * hook, NÃO cria `blindness-rules.json`, NÃO edita `soma-hooks-map.json`.
 *
 * Padrão de spawn copiado de framework-guard.test.cjs:75-118 (pipe stdio,
 * scrub de CK_SESSION_ID/CLAUDE_SESSION_ID herdados antes de cada spawn,
 * TMPDIR sobrescrito por chamada — nunca assumido `/tmp`). A tag de
 * rastreio abaixo é a forma NUA (`@spec AC-01`) — a forma com colchete
 * usada no framework-guard não casa o regex real do gate
 * (spec-test-traceability.cjs:150) e ficaria invisível à cobertura.
 *
 * Truque do scratch (brief §0.3): os testes deste repo criam diretórios
 * via `fs.mkdtempSync(os.tmpdir())`, então o cwd natural de um teste JÁ é
 * scratch. `WORKDIR` mora fora do scratch (não é isento); `FAKE_TMP` é
 * passado como `TMPDIR` do spawn, então `os.tmpdir()` DENTRO do hook
 * resolve para `FAKE_TMP` — os dois lados existem de verdade, sem tocar
 * em `~` nem no repo.
 *
 * @spec AC-01
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'operator-gate.cjs');
// __dirname é <repo>/core/hooks/__tests__; a raiz do repo fica TRÊS '..'
// acima (__tests__ -> hooks -> core -> raiz) — mesmo comentário do
// framework-guard.test.cjs:35-45, a versão com dois '..' já foi bug real.
const HOOKS_MAP = path.join(__dirname, '..', '..', '..', 'install', 'soma-hooks-map.json');

// ── AC-01: o hook existe? (RED planejado, distinto de "typo de caminho") ──
// Precisa ser o PRIMEIRO test() do arquivo (brief §1): sem ele, o dia em
// que alguém criar operator_gate.cjs (underscore) a suíte continuaria
// vermelha pelo motivo errado e ninguém saberia.

test('AC-01: o hook existe no caminho fixado pela §0.4 (RED planejado até o hook nascer)', () => {
  assert.ok(fs.existsSync(HOOK), `hook ausente em ${HOOK} — este é o RED planejado, não um typo de caminho`);
});

// ── fixtures compartilhadas ────────────────────────────────────────────

const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opgate-work-')); // NÃO é scratch aos olhos do hook
const FAKE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opgate-tmp-')); // É scratch: vai como TMPDIR do spawn
// A mesma pasta em duas grafias: no macOS /var/folders é symlink pra
// /private/var/folders. `fs.realpathSync` segue o symlink; `mkdtempSync`
// não. Usado pelo C5 (Grupo C) — medido nesta máquina que as duas
// divergem, senão C5 seria um teste cego sem alvo (ver relatório).
const FAKE_TMP_REAL = fs.realpathSync(FAKE_TMP);

// ── AC-01: guarda de ambiente (brief §1-bis(5), verbatim) ──────────────
// O truque acima depende do TMPDIR do shell ser o padrão do macOS
// (/var/folders/.../T). Se alguém rodar a suíte com TMPDIR já apontando
// pra dentro de /tmp/, WORKDIR nasceria DENTRO do scratch e os casos de
// bloqueio virariam falso-verde DEPOIS do hook existir — invisível hoje,
// porque hoje tudo é RED por MODULE_NOT_FOUND. Este teste falha alto se
// isso acontecer.

test('AC-01: guarda de ambiente — WORKDIR não pode ser scratch, senão os casos de bloqueio são falso-verde', () => {
  for (const pref of [FAKE_TMP, '/private/tmp/claude-501/', '/tmp/']) {
    assert.ok(!WORKDIR.startsWith(pref),
      `WORKDIR=${WORKDIR} caiu dentro de scratch (${pref}) — TMPDIR do shell é hostil; a suíte mediria isenção onde devia medir bloqueio`);
  }
});

/**
 * Spawn de operator-gate.cjs com payload PreToolUse no stdin. Mesmo
 * formato do §0.2 do brief: `{ tool_input: { command }, cwd, session_id }`.
 * `session_id` no payload é ignorado pelo hook por contrato — só existe
 * pra o teste I7 provar que ele é ignorado.
 */
function runHook({ cwd, command, payloadCwd, sessionId, stdinSessionId, tmpdir, rawStdin } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CK_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    if (sessionId !== undefined) env.CK_SESSION_ID = sessionId;
    if (tmpdir !== undefined) env.TMPDIR = tmpdir;

    const payload = rawStdin !== undefined ? rawStdin : JSON.stringify({
      tool_input: { command },
      ...(payloadCwd !== undefined ? { cwd: payloadCwd } : {}),
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

// ── Fixtures dos grupos declarativos ────────────────────────────────────

// A6: diretório real com 3 arquivos nomeados, pra provar "quantos e quais".
const A6_DIR = fs.mkdtempSync(path.join(WORKDIR, 'a6-alvo-'));
const A6_FILES = ['alpha.dat', 'beta.dat', 'gamma.dat'];
for (const name of A6_FILES) fs.writeFileSync(path.join(A6_DIR, name), '');

// Grupo B: alvo em WORKDIR, fora do scratch. Conteúdo não é asserido
// nesta tabela — não precisa existir de verdade (nada é executado).
const B_TARGET = path.join(WORKDIR, 'b-alvo');

const TABLE_SESSION_ID = `opgate-table-${process.pid}`;

// ── Grupo A — padrões destrutivos bloqueiam (controle negativo) ────────

const aCases = [
  {
    id: 'A1', expect: 2, payloadCwd: WORKDIR, command: 'pkill -f "^npm test"',
    desc: 'pkill -f "^npm test" bloqueia',
    assertions: [
      { re: /pkill/i, desc: 'cita pkill' },
      { re: /\d+/, desc: 'traz contagem de candidatos' },
    ],
  },
  { id: 'A2', expect: 2, payloadCwd: WORKDIR, command: 'kill -9 12345', desc: 'kill -9 12345 bloqueia' },
  { id: 'A3', expect: 2, payloadCwd: WORKDIR, command: 'killall node', desc: 'killall node bloqueia (0 espécimes, entra por simetria de dano)' },
  { id: 'A4', expect: 2, payloadCwd: WORKDIR, command: 'git clean -fdx', desc: 'git clean -fdx bloqueia' },
  { id: 'A5', expect: 2, payloadCwd: WORKDIR, command: 'git reset --hard', desc: 'git reset --hard bloqueia' },
  {
    id: 'A6', expect: 2, payloadCwd: WORKDIR, command: `rm -rf ${A6_DIR}`,
    desc: 'rm -rf <WORKDIR>/alvo (3 arquivos reais) bloqueia e nomeia quantos e quais',
    assertions: [
      { re: /\b3\b/, desc: 'declara os 3 arquivos encontrados' },
      { re: new RegExp(A6_FILES[0]), desc: `cita ${A6_FILES[0]}` },
      { re: new RegExp(A6_FILES[1]), desc: `cita ${A6_FILES[1]}` },
      { re: new RegExp(A6_FILES[2]), desc: `cita ${A6_FILES[2]}` },
    ],
  },
];

// ── Grupo B — formas de rm que contam (spec, AC-01, literal) ────────────

const bCases = [
  ['B1', 'rm -rf'],
  ['B2', 'rm -fr'],
  ['B3', 'rm -r -f'],
  ['B4', 'rm -R -f'],
  ['B5', 'rm --recursive --force'],
  ['B6', 'sudo rm -rf'],
  ['B7', '\\rm -rf'],
].map(([id, form]) => ({
  id, expect: 2, payloadCwd: WORKDIR, command: `${form} ${B_TARGET}`,
  desc: `${form} bloqueia (forma contável do AC-01)`,
}));

// ── Grupo C — isenção por caminho resolvido (o achado da auditoria) ─────

const cCases = [
  {
    id: 'C1', expect: 0, payloadCwd: WORKDIR, command: `rm -rf ${FAKE_TMP}/lixo`,
    desc: 'rm -rf <FAKE_TMP>/lixo com cwd=WORKDIR — isento (alvo absoluto resolve dentro do scratch)',
  },
  {
    id: 'C2', expect: 0, payloadCwd: WORKDIR, command: 'rm -rf /tmp/lixo-opgate',
    desc: 'rm -rf /tmp/lixo-opgate com cwd=WORKDIR — isento (prefixo /tmp/)',
  },
  {
    id: 'C3', expect: 2, payloadCwd: WORKDIR, command: 'rm -rf tmp/../importante',
    desc: 'rm -rf tmp/../importante com cwd=WORKDIR — NÃO isento (travessia colapsa fora do scratch; teste-chave da auditoria)',
  },
  {
    id: 'C4', expect: 0, payloadCwd: FAKE_TMP, command: 'rm -rf ./lixo',
    desc: 'rm -rf ./lixo com cwd=FAKE_TMP — isento (relativo resolve dentro do scratch)',
  },
  {
    id: 'C5', expect: 0, payloadCwd: WORKDIR, command: `rm -rf ${FAKE_TMP_REAL}/lixo`,
    desc: 'rm -rf <FAKE_TMP em grafia física (/private/var/folders)> com cwd=WORKDIR — mesma pasta de C1, outra grafia; um hook que compara prefixo cru (em vez de path.resolve contra os.tmpdir() de fato) bloquearia aqui por engano',
  },
];

// ── Grupo D — alvo opaco: bloqueia declarando que não decide ────────────

const dCases = [
  ['D1', 'rm -rf $ALVO'],
  ['D2', 'rm -rf "$HOME/x"'],
  ['D3', 'rm -rf `pwd`/x'],
  ['D4', 'rm -rf $(cat lista)'],
].map(([id, command]) => ({
  id, expect: 2, payloadCwd: WORKDIR, command,
  desc: `${command} — opaco, bloqueia declarando que não consegue decidir`,
  assertions: [{ re: /expand|expandid|literal/i, desc: 'pede o alvo expandido' }],
}));

// ── Grupo E — remoto não dispara (D-024-07), exit 0 nos dois ───────────

const eCases = [
  { id: 'E1', expect: 0, payloadCwd: WORKDIR, command: "ssh host 'rm -rf /data'", desc: 'ssh host rm -rf /data — remoto, não dispara' },
  { id: 'E2', expect: 0, payloadCwd: WORKDIR, command: 'docker exec c1 rm -rf /data', desc: 'docker exec c1 rm -rf /data — remoto, não dispara' },
];

// ── Grupo F — vizinhos que NÃO podem bloquear (controle positivo; NO-GO 1) ──

const fCases = [
  ['F1', 'git clean -fd'],
  ['F2', 'git reset --soft HEAD~1'],
  ['F3', 'rm arquivo.txt'],
  ['F4', 'grep -c foo bar.txt'],
  ['F5', 'git log --oneline -- core/hooks/'],
  ['F6', 'ls -la'],
].map(([id, command]) => ({
  id, expect: 0, payloadCwd: WORKDIR, command, requireSilence: true,
  desc: `${command} — não bloqueia (NO-GO 1 / vizinho seguro)`,
}));

// ── Grupo I-bis — redireção não muda o veredito ─────────────────────────

const ibisCases = [
  {
    id: 'I-bis-1', expect: 2, payloadCwd: WORKDIR,
    command: `rm -rf ${path.join(WORKDIR, 'ibis-alvo')} 2>/dev/null`,
    desc: '2>/dev/null não disfarça o rm -rf — continua bloqueando',
  },
];

const CASES = [...aCases, ...bCases, ...cCases, ...dCases, ...eCases, ...fCases, ...ibisCases];

for (const c of CASES) {
  test(`AC-01: ${c.id} — ${c.desc}`, async () => {
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP,
      payloadCwd: c.payloadCwd,
      command: c.command,
      sessionId: TABLE_SESSION_ID,
      tmpdir: FAKE_TMP,
    });
    assert.equal(code, c.expect, `${c.id}: esperava exit ${c.expect}, veio ${code}. comando: ${c.command} | stderr: ${stderr}`);
    for (const a of c.assertions || []) {
      assert.match(stderr, a.re, `${c.id}: esperava stderr casando ${a.re} (${a.desc}). stderr: ${stderr}`);
    }
    if (c.requireSilence) {
      assert.equal(stderr.trim(), '', `${c.id}: esperava stderr vazio (silêncio), veio: ${stderr}`);
    }
  });
}

// ── Grupo G — mensagem do pkill: quantos, quais, forma estreita (D-024-05) ──
// Reproduz o incidente que originou o AC-01: pgrep sozinho matou o `npm
// test` de outro projeto. Processo-vítima REAL por teste (não mock), morto
// no finally pelo PID guardado — nunca por pkill -f.

function spawnVictim() {
  const token = `opgate-victim-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const proc = spawn(process.execPath, ['-e', `setTimeout(()=>{}, 30000) /* ${token} */`], { cwd: WORKDIR });
  return { proc, token };
}

test('AC-01: G1 — pkill -f <token> acha a vítima e bloqueia citando o PID', async () => {
  const { proc, token } = spawnVictim();
  try {
    await new Promise(r => setTimeout(r, 300)); // dá tempo do processo aparecer pro pgrep
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
      sessionId: `opgate-g1-${process.pid}`, command: `pkill -f ${token}`,
    });
    assert.equal(code, 2, `G1: esperava exit 2, veio ${code}. stderr: ${stderr}`);
    assert.ok(stderr.includes(String(proc.pid)), `G1: esperava o PID da vítima (${proc.pid}) na stderr, veio: ${stderr}`);
  } finally {
    proc.kill();
  }
});

test('AC-01: G2 — a mesma stderr traz o cwd real da vítima (prova de lsof, não só pgrep)', async () => {
  const { proc, token } = spawnVictim();
  try {
    await new Promise(r => setTimeout(r, 300));
    // lsof reporta o caminho FÍSICO, não o lógico: no macOS /var/folders é
    // symlink pra /private/var/folders (medido — ver relatório). WORKDIR
    // (retorno de mkdtempSync) é o caminho lógico; comparar com ele aqui
    // seria medir a régua errada.
    const realWorkdir = fs.realpathSync(WORKDIR);
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
      sessionId: `opgate-g2-${process.pid}`, command: `pkill -f ${token}`,
    });
    assert.equal(code, 2, `G2: esperava exit 2, veio ${code}. stderr: ${stderr}`);
    assert.ok(stderr.includes(realWorkdir), `G2: esperava o cwd real da vítima (${realWorkdir}, via lsof -a -p <pid> -d cwd) na stderr, veio: ${stderr}`);
  } finally {
    proc.kill();
  }
});

test('AC-01: G3 — a mesma stderr oferece a forma estreita "kill <pid>"', async () => {
  const { proc, token } = spawnVictim();
  try {
    await new Promise(r => setTimeout(r, 300));
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
      sessionId: `opgate-g3-${process.pid}`, command: `pkill -f ${token}`,
    });
    assert.equal(code, 2, `G3: esperava exit 2, veio ${code}. stderr: ${stderr}`);
    const narrow = new RegExp(`kill\\s+${proc.pid}\\b`);
    assert.match(stderr, narrow, `G3: esperava a forma estreita "kill ${proc.pid}" na stderr, veio: ${stderr}`);
  } finally {
    proc.kill();
  }
});

test('AC-01: G4 — pkill -9 -u 501 -f <token>: flags de sinal e de seleção são consumidas, padrão é o 1º token não-flag', async () => {
  const { proc, token } = spawnVictim();
  try {
    await new Promise(r => setTimeout(r, 300));
    // 501 é literal — $(id -u) tornaria o comando opaco (Grupo D) e mediria outra coisa.
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
      sessionId: `opgate-g4-${process.pid}`, command: `pkill -9 -u 501 -f ${token}`,
    });
    assert.equal(code, 2, `G4: esperava exit 2 (flags consumidas, padrão = ${token}), veio ${code}. stderr: ${stderr}`);
  } finally {
    proc.kill();
  }
});

test('AC-01: G5 — controle positivo: pkill -f <token inexistente> não acha candidato, libera', async () => {
  const ghostToken = `opgate-token-que-nao-existe-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const { code, stderr } = await runHook({
    cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
    sessionId: `opgate-g5-${process.pid}`, command: `pkill -f ${ghostToken}`,
  });
  assert.equal(code, 0, `G5: esperava exit 0 (nenhum candidato, nada a proteger), veio ${code}. stderr: ${stderr}`);
});

// ── Grupo H — teto de latência da enumeração (AC-01, teto próprio) ──────

function makeDirWithFiles(count) {
  const dir = fs.mkdtempSync(path.join(WORKDIR, 'h-'));
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), '');
  return dir;
}

test('AC-01: H1 — rm -rf em árvore de 250 arquivos bloqueia e declara truncamento (teto 200 entradas / 100ms)', async () => {
  const dir = makeDirWithFiles(250);
  const { code, stderr } = await runHook({
    cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
    sessionId: `opgate-h1-${process.pid}`, command: `rm -rf ${dir}`,
  });
  assert.equal(code, 2, `H1: esperava exit 2, veio ${code}. stderr: ${stderr}`);
  assert.match(stderr, /trunc/i, `H1: esperava a stderr declarar truncamento (250 > teto de 200 entradas), veio: ${stderr}`);
});

test('AC-01: H2 — rm -rf em árvore de 3 arquivos bloqueia e NÃO declara truncamento (controle negativo do H1)', async () => {
  const dir = makeDirWithFiles(3);
  const { code, stderr } = await runHook({
    cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP,
    sessionId: `opgate-h2-${process.pid}`, command: `rm -rf ${dir}`,
  });
  assert.equal(code, 2, `H2: esperava exit 2, veio ${code}. stderr: ${stderr}`);
  assert.doesNotMatch(stderr, /trunc/i, `H2: NÃO esperava "truncou" numa árvore de só 3 arquivos (senão a mensagem é string fixa sempre impressa), veio: ${stderr}`);
});

// ── Grupo I — infra do hook ──────────────────────────────────────────────

test('AC-01: I1 — stdin vazio -> exit 0 (exceção explícita ao fail-closed)', async () => {
  const { code, stderr } = await runHook({ cwd: FAKE_TMP, rawStdin: '' });
  assert.equal(code, 0, `I1: esperava exit 0 com stdin vazio, veio ${code}. stderr: ${stderr}`);
});

test('AC-01: I2 — stdin malformado -> exit 0 (idem I1)', async () => {
  const { code, stderr } = await runHook({ cwd: FAKE_TMP, rawStdin: '{não é json' });
  assert.equal(code, 0, `I2: esperava exit 0 com stdin malformado, veio ${code}. stderr: ${stderr}`);
});

test('AC-01: I3 — payload sem tool_input.command -> exit 0 (idem I1/I2)', async () => {
  const { code, stderr } = await runHook({
    cwd: FAKE_TMP,
    rawStdin: JSON.stringify({ tool_input: {}, cwd: WORKDIR }),
  });
  assert.equal(code, 0, `I3: esperava exit 0 sem tool_input.command, veio ${code}. stderr: ${stderr}`);
});

test('AC-01: I4/I5 — bypass marker é one-shot: libera o 1º comando e consome o marker; o 2º volta a bloquear', async () => {
  const sessionId = `opgate-i45-${process.pid}-${Date.now()}`;
  // D-BRIEF-01: o marker mora em os.tmpdir() (== FAKE_TMP via TMPDIR), não
  // em /tmp literal — vence o código (framework-guard.cjs:206-207 etc.),
  // a prosa /tmp/ da §0.4 é declaração desatualizada.
  const marker = path.join(FAKE_TMP, `claude-operator-gate-bypass-${sessionId}.marker`);
  fs.writeFileSync(marker, '');
  try {
    const first = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP, sessionId,
      command: `rm -rf ${path.join(WORKDIR, 'i4-alvo')}`,
    });
    assert.equal(first.code, 0, `I4: esperava exit 0 com marker presente, veio ${first.code}. stderr: ${first.stderr}`);
    assert.equal(fs.existsSync(marker), false, `I4: esperava o marker consumido (apagado) após o uso, mas ${marker} ainda existe`);

    const second = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP, sessionId,
      command: `rm -rf ${path.join(WORKDIR, 'i5-alvo')}`,
    });
    assert.equal(second.code, 2, `I5: esperava exit 2 (marker já consumido, one-shot) no segundo comando destrutivo, veio ${second.code}. stderr: ${second.stderr}`);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('AC-01: I6 — marker de direct-mode global libera qualquer comando destrutivo (opt-out)', async () => {
  const sessionId = `opgate-i6-${process.pid}-${Date.now()}`;
  const marker = path.join(FAKE_TMP, `claude-direct-mode-${sessionId}.marker`);
  fs.writeFileSync(marker, '');
  try {
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP, sessionId,
      command: `rm -rf ${path.join(WORKDIR, 'i6-alvo')}`,
    });
    assert.equal(code, 0, `I6: esperava exit 0 com direct-mode marker presente, veio ${code}. stderr: ${stderr}`);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('AC-01: I7 — session_id só no stdin (sem env var) não libera: o hook ignora o stdin e usa a env var/PPID', async () => {
  const stdinSessionId = `opgate-i7-stdin-${process.pid}-${Date.now()}`;
  const marker = path.join(FAKE_TMP, `claude-operator-gate-bypass-${stdinSessionId}.marker`);
  fs.writeFileSync(marker, '');
  try {
    // sessionId OMITIDO de propósito: sem CK_SESSION_ID/CLAUDE_SESSION_ID,
    // o hook cai no fallback pid-${process.ppid}, que NÃO é stdinSessionId.
    // Se o hook lesse session_id do stdin (o bug de 2026-08-14/15), acharia
    // o marker acima e liberaria por engano.
    const { code, stderr } = await runHook({
      cwd: FAKE_TMP, payloadCwd: WORKDIR, tmpdir: FAKE_TMP, stdinSessionId,
      command: `rm -rf ${path.join(WORKDIR, 'i7-alvo')}`,
    });
    assert.equal(
      code, 2,
      `I7: esperava exit 2 — sessão do env (pid-${process.ppid}) não tem marker; se deu 0, o hook leu session_id do stdin (${stdinSessionId}) em vez do env var. stderr: ${stderr}`
    );
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

// ── Grupo J — wiring registrado ──────────────────────────────────────────

test('AC-01: J1 — install/soma-hooks-map.json tem entrada para operator-gate.cjs no objeto matcher:"Bash" já existente', () => {
  const map = JSON.parse(fs.readFileSync(HOOKS_MAP, 'utf-8'));
  const preToolUse = (map.hooks && map.hooks.PreToolUse) || [];
  const bashEntries = preToolUse.filter(e => e.matcher === 'Bash');
  const allCommands = bashEntries.flatMap(e => (e.hooks || []).map(h => h.command));
  const hasOperatorGate = allCommands.some(c => typeof c === 'string' && c.includes('operator-gate.cjs'));
  assert.ok(
    hasOperatorGate,
    `J1: esperava um comando citando operator-gate.cjs dentro de algum objeto matcher:"Bash" de ${HOOKS_MAP} ` +
    `(registrar no objeto Bash já existente, sem criar um segundo — ver J2). Comandos encontrados: ${JSON.stringify(allCommands)}`
  );
});

test('AC-01: J2 — não existe um segundo objeto matcher:"Bash" no array PreToolUse.hooks (invariante de não-regressão, verde hoje)', () => {
  const map = JSON.parse(fs.readFileSync(HOOKS_MAP, 'utf-8'));
  const preToolUse = (map.hooks && map.hooks.PreToolUse) || [];
  const bashEntries = preToolUse.filter(e => e.matcher === 'Bash');
  assert.equal(bashEntries.length, 1, `J2: esperava exatamente 1 objeto matcher:"Bash", achei ${bashEntries.length} — a spec proíbe criar um segundo`);
});

// ── cleanup ──────────────────────────────────────────────────────────────
// WORKDIR e FAKE_TMP nascem no topo do módulo e não são limpos por nenhum
// teste individual (os markers já são, em finally). Sem isso, cada rodada
// deixa para trás os fixtures do A6 (3 arquivos), do H1/H2 (250 + 3
// arquivos) e os diretórios em si, acumulando em tmpdir a cada `npm test`.

after(() => {
  fs.rmSync(WORKDIR, { recursive: true, force: true });
  fs.rmSync(FAKE_TMP, { recursive: true, force: true });
});
