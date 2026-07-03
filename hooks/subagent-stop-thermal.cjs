#!/usr/bin/env node
/**
 * SubagentStop Hook — Thermal Cleanup
 *
 * Fires: quando um subagent termina.
 * Purpose: remover um entry compile-test do thermal state no término REAL,
 *   em vez de depender só do TTL de 15min do thermal-guard (que causava falsos
 *   positivos — agentes mortos contavam como "ativos" até o TTL expirar, e
 *   bloqueavam dispatches legítimos).
 *
 * O payload do SubagentStop não garante uma chave correlacionável ao dispatch
 * registrado (só `reason`), então usamos FIFO: remove o entry compile-test mais
 * antigo (o primeiro do array, que é o registrado há mais tempo). Fail-open sempre.
 *
 * Exit codes: sempre 0 (nunca bloqueia o término de um subagent).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function getSessionId() {
  return (
    process.env.CK_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    `pid-${process.ppid}`
  );
}

function stateFilePath(sessionId) {
  return path.join(os.tmpdir(), `claude-thermal-state-${sessionId}.json`);
}

function main() {
  try {
    // Drena o stdin (o harness envia payload; não precisamos do conteúdo).
    try { fs.readFileSync(0, 'utf-8'); } catch (_) {}

    const stateFile = stateFilePath(getSessionId());

    let state;
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch (_) {
      process.exit(0); // sem state = nada a limpar
    }
    if (!Array.isArray(state.active)) process.exit(0);

    // Um subagent terminou → libera o slot compile-test mais antigo (FIFO).
    const idx = state.active.findIndex((e) => e.type === 'compile-test');
    if (idx !== -1) {
      state.active.splice(idx, 1);
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, stateFile);
    }

    process.exit(0);
  } catch (_) {
    process.exit(0); // fail-open — nunca trava o término
  }
}

main();
