#!/usr/bin/env node
'use strict';
/**
 * operator-gate.bench.cjs — instrumento de latência do AC-01 (spec 024)
 *
 * Não termina em `.test.cjs`, logo não entra no glob do `npm test`
 * (`node --test core/scripts/__tests__/*.test.cjs core/hooks/__tests__/*.test.cjs`).
 * Correto e intencional (brief §3) — este arquivo é instrumento, não teste.
 *
 * Nasce junto com o AC-01 (§0.4) porque o teto de latência do hook (D-024-04,
 * 45ms de p95) não cobre a enumeração de arquivos do `rm -rf`, que é I/O de
 * diretório e tem teto próprio (AC-01, H1/H2). Este bench mede o hook real,
 * não uma simulação.
 *
 * Regra dura (§3, NFR da spec): falha ALTO se o hook não existir. Nunca
 * imprime números com o hook ausente — número fabricado é pior que número
 * ausente (a própria spec §0.3 é a prova: foi um `2>/dev/null` que
 * transformou erro alto em zero mudo em 16 de 16 casos do corpus real).
 * Proibido neste arquivo: `|| true`, `2>/dev/null`, `|| echo`, `?.`,
 * `catch{}` silencioso.
 *
 * @spec AC-01
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'operator-gate.cjs');
const MIN_SAMPLES = 30;
const P95_BUDGET_MS = 45;
const MAX_ATTEMPTS = MIN_SAMPLES * 5;

if (!fs.existsSync(HOOK)) {
  console.error(
    `[operator-gate.bench] hook ainda não existe em ${HOOK} — nada a medir. ` +
    `Falhando alto em vez de imprimir números fabricados.`
  );
  process.exit(1);
}

function sampleOnce() {
  // Comando benigno (não destrutivo) — mede o caminho comum, que roda
  // antes de TODO comando Bash (NFR: teto 45ms de p95 aqui).
  const payload = JSON.stringify({ tool_input: { command: 'ls -la' }, cwd: process.cwd() });
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [HOOK], {
    input: payload,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { elapsedMs, code: result.status };
}

const samples = [];
let attempts = 0;
// Descarta qualquer amostra cujo exit code não seja 0 ou 2 (brief §1-bis(3))
// — um crash/timeout não é uma medição válida de latência.
while (samples.length < MIN_SAMPLES && attempts < MAX_ATTEMPTS) {
  attempts += 1;
  const { elapsedMs, code } = sampleOnce();
  if (code === 0 || code === 2) samples.push(elapsedMs);
}

if (samples.length < MIN_SAMPLES) {
  console.error(
    `[operator-gate.bench] só ${samples.length}/${MIN_SAMPLES} amostras válidas (exit 0 ou 2) ` +
    `em ${attempts} tentativas — falhando alto em vez de reportar número fabricado.`
  );
  process.exit(1);
}

samples.sort((a, b) => a - b);
function percentile(p) {
  const idx = Math.min(samples.length - 1, Math.floor((p / 100) * samples.length));
  return samples[idx];
}
const p50 = percentile(50);
const p95 = percentile(95);

console.log(`operator-gate.cjs latency — n=${samples.length} amostras válidas de ${attempts} tentativas`);
console.log(`p50 = ${p50.toFixed(2)} ms`);
console.log(`p95 = ${p95.toFixed(2)} ms (teto declarado: ${P95_BUDGET_MS} ms — D-024-04)`);

if (p95 > P95_BUDGET_MS) {
  console.error(`[operator-gate.bench] p95 (${p95.toFixed(2)} ms) excede o teto de ${P95_BUDGET_MS} ms.`);
  process.exit(1);
}
process.exit(0);
