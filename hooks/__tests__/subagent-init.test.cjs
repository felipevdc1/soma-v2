#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../subagent-init.cjs');

const TMP = os.tmpdir();
function writeTmp(name, content) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
function unlinkSafe(p) { try { fs.unlinkSync(p); } catch (_) {} }

// ─── Test 1: no constitution / FAMILY_DOC / spec → original behavior preserved ───
test('1. no context files → functions return null, no crash', () => {
  process.env._TEST_CONSTITUTION_PATH = path.join(TMP, 'nonexistent-constitution-99x.md');
  const c = hook.buildConstitutionContent(3200);
  assert.equal(c, null, 'constitution absent → null');
  delete process.env._TEST_CONSTITUTION_PATH;

  const f = hook.buildFamilyDocContent(TMP, 3200);
  // TMP may or may not have FAMILY_DOC.md — we only assert no crash
  assert.ok(f === null || typeof f === 'string', 'buildFamilyDocContent returns null or string');

  const saved = process.env.CLAUDE_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  delete process.env.CK_SESSION_ID;
  const s = hook.buildSpecAcContent('fix T-1', 3200);
  assert.equal(s, null, 'no sessionId → null');
  if (saved !== undefined) process.env.CLAUDE_SESSION_ID = saved;
});

// ─── Test 2: constitution exists → injected ───
test('2. constitution exists → injected in output', () => {
  const cPath = writeTmp('test-constitution-p15.md', '# SOMA Constitution\n\n## Article I\nSpec as source of truth.\n');
  process.env._TEST_CONSTITUTION_PATH = cPath;
  try {
    const result = hook.buildConstitutionContent(3200);
    assert.ok(result !== null, 'should return content');
    assert.ok(result.includes('## Constitution (SOMA)'), 'has section header');
    assert.ok(result.includes('Article I'), 'has content');
  } finally {
    delete process.env._TEST_CONSTITUTION_PATH;
    unlinkSafe(cPath);
  }
});

// ─── Test 3: FAMILY_DOC in project root → injected ───
test('3. FAMILY_DOC present → content injected', () => {
  const docDir = fs.mkdtempSync(path.join(TMP, 'p15-famtest-'));
  const docPath = path.join(docDir, 'FAMILY_DOC.md');
  fs.writeFileSync(docPath, '# FAMILY_DOC\n\n## Patterns\n- Use async/await\n');
  try {
    const result = hook.buildFamilyDocContent(docDir, 3200);
    assert.ok(result !== null, 'should return content');
    assert.ok(result.includes('## FAMILY_DOC (content)'), 'has header');
    assert.ok(result.includes('async/await'), 'has doc content');
  } finally {
    unlinkSafe(docPath);
    fs.rmdirSync(docDir);
  }
});

// ─── Test 4: active spec + task-id in prompt → matching ACs injected ───
test('4. soma-state + task-id in prompt → matching ACs injected', () => {
  const sessionId = 'p15-test-session-42';
  const specPath = writeTmp('p15-test-spec.md', [
    '# Feature Spec',
    '',
    '## T-1: Setup',
    '- AC-01: Given init, when run, then config created',
    '- AC-02: Given config, when validated, then green',
    '',
    '## T-2: Deploy',
    '- AC-03: Given build, when pushed, then live',
  ].join('\n'));
  const statePath = `/tmp/soma-state-${sessionId}.json`;
  fs.writeFileSync(statePath, JSON.stringify({ specPath }));
  process.env.CLAUDE_SESSION_ID = sessionId;
  try {
    const result = hook.buildSpecAcContent('implement T-1 setup task', 3200);
    assert.ok(result !== null, 'should find ACs');
    assert.ok(result.includes('T-1'), 'references T-1');
    assert.ok(result.includes('AC-01'), 'includes AC-01');
    assert.ok(result.includes('AC-02'), 'includes AC-02');
    assert.ok(!result.includes('AC-03'), 'does not include T-2 ACs');
  } finally {
    delete process.env.CLAUDE_SESSION_ID;
    unlinkSafe(specPath);
    unlinkSafe(statePath);
  }
});

// ─── Test 5: token budget overshoot → constitution truncated, FAMILY_DOC notice ───
test('5. budget overshoot → constitution truncated, FAMILY_DOC skipped with notice', () => {
  const longConstitution = 'X'.repeat(500);
  const cPath = writeTmp('test-long-constitution-p15.md', longConstitution);
  process.env._TEST_CONSTITUTION_PATH = cPath;
  const docDir = fs.mkdtempSync(path.join(TMP, 'p15-budtest-'));
  fs.writeFileSync(path.join(docDir, 'FAMILY_DOC.md'), 'content');
  try {
    // Budget = 150 chars: constitution gets at most 150, exhausting budget
    const result = hook.assembleSomaContext(docDir, '', 150);
    assert.ok(result.includes('… [truncated]'), 'constitution truncated');
    assert.ok(result.includes('FAMILY_DOC: skipped'), 'family doc skipped with notice');
  } finally {
    delete process.env._TEST_CONSTITUTION_PATH;
    unlinkSafe(cPath);
    unlinkSafe(path.join(docDir, 'FAMILY_DOC.md'));
    fs.rmdirSync(docDir);
  }
});

// ─── Test 6: malformed state file → skip spec injection gracefully, no crash ───
test('6. malformed soma-state.json → null, no crash', () => {
  const sessionId = 'p15-malformed-test-99';
  const statePath = `/tmp/soma-state-${sessionId}.json`;
  fs.writeFileSync(statePath, 'NOT_VALID_JSON{{{');
  process.env.CLAUDE_SESSION_ID = sessionId;
  try {
    let result;
    assert.doesNotThrow(() => {
      result = hook.buildSpecAcContent('fix T-5', 3200);
    }, 'must not throw on malformed JSON');
    assert.equal(result, null, 'returns null on malformed state');
  } finally {
    delete process.env.CLAUDE_SESSION_ID;
    unlinkSafe(statePath);
  }
});
