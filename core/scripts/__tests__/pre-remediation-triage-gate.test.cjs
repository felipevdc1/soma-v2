'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PLAN = path.join(REPO_ROOT, 'docs/superpowers/plans/2026-08-28-pre-remediation-triage-gate.md');
const DESTINATIONS = [
  path.join(REPO_ROOT, 'core/docs/constitution.md'),
  path.join(REPO_ROOT, 'core/docs/constitution-amendments/1.4.0-pre-remediation-triage.md'),
  path.join(REPO_ROOT, 'core/adapters/claude/references/soma-run-orchestration.md'),
  path.join(REPO_ROOT, 'core/adapters/codex/AGENTS.md'),
];
function canonicalRange(source) {
  const startMarker = '<!-- TRIAGE_CONTRACT_BEGIN -->';
  const endMarker = '<!-- TRIAGE_CONTRACT_END -->';
  const starts = [...source.matchAll(/^<!-- TRIAGE_CONTRACT_BEGIN -->$/gm)];
  const ends = [...source.matchAll(/^<!-- TRIAGE_CONTRACT_END -->$/gm)];
  assert.equal(starts.length, 1, 'canonical triage block must have exactly one begin delimiter');
  assert.equal(ends.length, 1, 'canonical triage block must have exactly one end delimiter');
  assert.ok(ends[0].index > starts[0].index, 'canonical triage end must follow begin');
  return { start: starts[0].index, end: ends[0].index + endMarker.length };
}

function expectedContract() {
  const source = fs.readFileSync(PLAN, 'utf8');
  const range = canonicalRange(source);
  return source.slice(range.start, range.end);
}

function destinationBlock(file) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /TRIAGE_CONTRACT_BEGIN/, `${file} is missing canonical triage delimiter`);
  const range = canonicalRange(source);
  return source.slice(range.start, range.end);
}

test('pre-remediation triage gate has four destinations and canonical delimiters', () => {
  assert.equal(DESTINATIONS.length, 4);
  for (const file of DESTINATIONS) {
    assert.ok(fs.existsSync(file), `missing destination: ${file}`);
    const contract = destinationBlock(file);
    const afterBegin = contract.slice('<!-- TRIAGE_CONTRACT_BEGIN -->'.length);
    assert.match(afterBegin, /^\n## Article XI — Triagem pré-remediação\n/, `${file} is missing the strict Article XI heading`);
  }
});

test('pre-remediation triage gate is byte-for-byte equal to the plan block', () => {
  const expected = expectedContract();
  for (const file of DESTINATIONS) assert.equal(destinationBlock(file), expected, file);
});

test('pre-remediation triage gate asserts deterministic clusters, evidence, and report schema', () => {
  for (const file of DESTINATIONS) {
    const contract = destinationBlock(file);
    for (const phrase of [
    '(componente proprietário, assinatura normalizada, causa candidata)',
    'VERIFIED', 'INFERENCE', 'HYPOTHESIS', 'unmappedCount', 'sha256',
    'totalFailures', 'clusters', 'decision', 'blockers', 'expected', 'actual',
    'GO', 'DEFER', '`low`', '`medium`', '`high`',
    ]) assert.match(contract, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
});

test('pre-remediation triage gate preserves coordinator boundaries and all six decisions', () => {
  const constitution = fs.readFileSync(DESTINATIONS[0], 'utf8');
  const statementMatch = constitution.match(/## Article XI — Triagem pré-remediação[\s\S]*?### \(a\) Statement\n([\s\S]*?)\n\n### \(b\)/);
  assert.ok(statementMatch, 'Constitution must expose Article XI Statement');
  assert.match(
    statementMatch[1],
    /coordinator registra `TRIAGE_REQUIRED` quando um gatilho se confirma; o relatório da triagem decide então `GO` ou `DEFER`/i,
    'Statement must distinguish trigger decision TRIAGE_REQUIRED from final report decision GO/DEFER',
  );
  assert.match(constitution, /dispatch-record/i, 'Constitution must preserve coordinator dispatch-record lifecycle');
  for (const file of DESTINATIONS) {
    const contract = destinationBlock(file);
    for (const phrase of [
    'um agente', 'uma tentativa', 'allowlist', 'parsers locais determinísticos',
    'Dispatch', 'checkpoint', 'handoff', 'coordinator', 'rede', 'mutação Git',
    'package manager', 'test runner', 'build', 'lint', 'install', 'product CLI',
    'execução do produto', 'GO', 'DEFER', 'checkpoint e handoff duráveis',
    ]) assert.match(contract, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'));
    const rows = contract.split('\n').filter((line) => /^\|[^|]+\|[^|]+\|$/.test(line));
    assert.equal(rows.length - 2, 6, 'decision table must contain six complete rows');
  }
});
