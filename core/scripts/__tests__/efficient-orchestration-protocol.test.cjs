'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_RUN = path.join(ROOT, 'adapters', 'claude', 'references', 'soma-run-orchestration.md');
const STSD = path.join(ROOT, 'docs', 'soma-stsd.md');
const CODEX = path.join(ROOT, 'adapters', 'codex', 'AGENTS.md');
const CONSTITUTION = path.join(ROOT, 'docs', 'constitution.md');
const TEN_STEP = path.join(ROOT, 'docs', '10-step-protocol.md');
const SONAR = path.join(ROOT, 'adapters', 'claude', 'commands', 'sonar-audit.md');
const AMENDMENT = path.join(ROOT, 'docs', 'constitution-amendments', '1.3.0-efficient-orchestration.md');
const MANIFEST = path.join(ROOT, 'manifest.json');

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

// @spec AC-05, AC-06, AC-07
test('todas as fontes canônicas limitam recovery, SONAR e handoff à emenda 1.3.0', () => {
  const constitution = read(CONSTITUTION);
  const tenStep = read(TEN_STEP);
  const sonar = read(SONAR);
  const amendment = read(AMENDMENT);

  assert.match(amendment, /Status.*APROVADA/i);
  assert.match(amendment, /Feature 025/i);
  for (const [file, source] of [[CONSTITUTION, constitution], [TEN_STEP, tenStep], [CLAUDE_RUN, read(CLAUDE_RUN)]]) {
    assert.match(source, /duas tentativas|2 tentativas/i, file);
    assert.match(source, /sem escalation automática|sem escalation/i, file);
    assert.match(source, /candidate[\s\S]{0,500}proofs[\s\S]{0,500}residualFinding[\s\S]{0,500}nextDecision/i, file);
    assert.match(source, /dispatch-record/i, file);
  }
  assert.match(sonar, /checks determinísticos[\s\S]{0,300}revisor integrado/i);
  assert.match(sonar, /segundo revisor[\s\S]{0,200}risco independente[\s\S]{0,200}mesmo commit/i);
  assert.doesNotMatch(sonar, /5 agentes|Agente 5|Architecture \(Opus\)/i);
});

// @spec AC-07
test('manifest e anchor Codex acompanham as fontes instaláveis atualizadas', () => {
  const manifest = JSON.parse(read(MANIFEST));
  for (const id of ['core.constitution', 'core.soma-stsd', 'core.10-step-protocol', 'adapter.codex.AGENTS']) {
    const entry = manifest.files.find(file => file.id === id);
    assert.ok(entry, `manifest deve declarar ${id}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, entry.path))).digest('hex');
    assert.equal(entry.sha256, actual, `${id} sha256 deve acompanhar o arquivo`);
  }
  const { extractBlock, computeBlockSha256 } = require('../lib/anchored-blocks.cjs');
  const block = extractBlock(CODEX, 'block.codex.AGENTS.soma-stsd');
  assert.equal(block.attrs.sha256, computeBlockSha256(block.content));
});
