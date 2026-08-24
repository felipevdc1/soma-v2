'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_RUN = path.join(ROOT, 'adapters', 'claude', 'commands', 'soma-run.md');
const STSD = path.join(ROOT, 'docs', 'soma-stsd.md');
const CODEX = path.join(ROOT, 'adapters', 'codex', 'AGENTS.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

// @spec AC-04
test('protocolo Claude exige dispatch-record antes/depois do Agent e retorno curto referenciado', () => {
  const source = read(CLAUDE_RUN);
  assert.match(source, /dispatch-record begin[\s\S]{0,700}antes do spawn/i);
  assert.match(source, /dispatch-record end[\s\S]{0,700}antes da transição/i);
  assert.match(source, /retorno conversacional.{0,160}4\.000 bytes[\s\S]{0,240}arquivos referenciados/i);
});

// @spec AC-05
test('protocolo Claude pausa diagnóstico após blocker residual da única correção', () => {
  const source = read(CLAUDE_RUN);
  assert.match(source, /uma correção[\s\S]{0,500}PAUSED_DIAGNOSTIC/i);
  assert.match(source, /sem (?:escalation|escalate|novo agente automático)/i);
});

// @spec AC-06
test('STEP_8 faz checks determinísticos antes de auditoria integrada e limita revisores a dois', () => {
  const source = read(CLAUDE_RUN);
  const step8 = source.slice(source.indexOf('## 11. STEP_8_SONAR'), source.indexOf('## 12. STEP_9_FIX_LOOP'));
  assert.match(step8, /checks determinísticos[\s\S]{0,300}antes[\s\S]{0,300}auditoria integrada/i);
  assert.match(step8, /segundo revisor[\s\S]{0,300}risco independente/i);
  assert.doesNotMatch(step8, /5 agents|Architecture\/Opus|Modules\/Sonnet/i);
});

// @spec AC-07
test('fonte canônica e adapters declaram o mesmo envelope operacional sem ledger paralelo', () => {
  for (const file of [CLAUDE_RUN, STSD, CODEX]) {
    const source = read(file);
    assert.match(source, /8\.000 bytes[\s\S]{0,160}4\.000 bytes/i, file);
    assert.match(source, /dispatch-record begin[\s\S]{0,700}dispatch-record end/i, file);
    assert.match(source, /uma correção[\s\S]{0,500}PAUSED_DIAGNOSTIC/i, file);
    assert.match(source, /sem ledger paralelo/i, file);
  }
});
