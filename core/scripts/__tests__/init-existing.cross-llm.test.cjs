'use strict';
// @spec AC-12
// T-14: Cross-LLM portability schema validation

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

// Claude-specific primitives that must NOT appear in normative fields
const CLAUDE_SPECIFIC_PATTERNS = [
  /\/specify\b/,
  /\/plan-sdd\b/,
  /\/sonar-audit\b/,
  /\/soma-run\b/,
  /thermal-guard\.cjs/,
  /spec-completeness-gate\.cjs/,
  /skill_id:/i,
  /hook_id:/i
];

function mkProject(prefix = 'soma-xllm') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('cross-LLM: project.md has zero Claude-specific primitives (AC-12)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/project.md'), 'utf8');
  for (const pattern of CLAUDE_SPECIFIC_PATTERNS) {
    assert.ok(!pattern.test(content), `project.md contains Claude-specific primitive: ${pattern}`);
  }
});

test('cross-LLM: module.md has zero Claude-specific primitives (AC-12)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  for (const pattern of CLAUDE_SPECIFIC_PATTERNS) {
    assert.ok(!pattern.test(content), `module.md contains Claude-specific primitive: ${pattern}`);
  }
});

test('cross-LLM: CONTEXT.md has zero Claude-specific primitives (AC-12)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/CONTEXT.md'), 'utf8');
  for (const pattern of CLAUDE_SPECIFIC_PATTERNS) {
    assert.ok(!pattern.test(content), `CONTEXT.md contains Claude-specific primitive: ${pattern}`);
  }
});

test('cross-LLM: manifest.json is standard JSON with soma-manifest/v1 schema (AC-12)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/manifest.json'), 'utf8');
  const parsed = JSON.parse(content); // must be valid JSON
  assert.equal(parsed.schema, 'soma-manifest/v1');
  // Must not contain Claude-specific identifiers
  for (const pattern of CLAUDE_SPECIFIC_PATTERNS) {
    assert.ok(!pattern.test(content), `manifest.json contains Claude-specific primitive: ${pattern}`);
  }
});
