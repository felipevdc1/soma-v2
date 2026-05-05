// @spec AC-13, AC-14, D7
// @contract CONTRACT-AUTO-LOAD-MODULE-01
// Tests doctor.cjs --check-context-routing flag

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DOCTOR_PATH = path.join(os.homedir(), '.soma-v2', 'scripts', 'doctor.cjs');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-doctor-ctx-'));
  fs.mkdirSync(path.join(dir, '.soma', 'modules'), { recursive: true });
  return dir;
}

function writeContextMd(projectDir, rows) {
  const lines = [
    '---',
    'schema: soma-context/v1',
    'project: test-project',
    'last_updated: 2026-05-02T00:00:00Z',
    '---',
    '',
    '# Module Context Routing',
    '',
    '| Keyword       | Module Slug   |',
    '|---------------|---------------|',
    ...rows.map(([kw, sl]) => `| ${kw.padEnd(13)} | ${sl.padEnd(13)} |`),
  ];
  fs.writeFileSync(path.join(projectDir, '.soma', 'CONTEXT.md'), lines.join('\n'), 'utf8');
}

function writeModule(projectDir, slug, { status = 'active', layer = 'trunk' } = {}) {
  const content = [
    '---',
    'schema: soma-module/v1',
    `name: ${slug}`,
    `status: ${status}`,
    `layer: ${layer}`,
    'source_confidence: high',
    'owners: []',
    'last_verified: 2026-05-02',
    'source_path: src/',
    'initialized_at: 2026-05-02T00:00:00Z',
    '---',
    '',
    `# ${slug}`,
  ].join('\n');
  fs.writeFileSync(path.join(projectDir, '.soma', 'modules', `${slug}.md`), content, 'utf8');
}

function runDoctor(projectDir, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    DOCTOR_PATH,
    '--check-context-routing',
    '--project', projectDir,
    '--json',
    ...extraArgs,
  ], {
    encoding: 'utf8',
    timeout: 15000,
  });
  return result;
}

// ── AC-13: doctor iterates refs ───────────────────────────────────────────────
test('AC-13: doctor --check-context-routing flag exists and exits 0 (D7 non-blocking)', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['auth', 'auth-system']]);
  writeModule(proj, 'auth-system');

  const result = runDoctor(proj);
  assert.equal(result.status, 0, `Doctor should exit 0 (non-blocking). stderr: ${result.stderr}`);
});

test('AC-13: doctor --check-context-routing produces JSON with context_routing key', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['auth', 'auth-system'], ['billing', 'billing']]);
  writeModule(proj, 'auth-system');
  writeModule(proj, 'billing');

  const result = runDoctor(proj);
  assert.equal(result.status, 0);

  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch (e) {
    assert.fail(`Expected JSON output. Got: ${result.stdout.slice(0, 300)}\nstderr: ${result.stderr}`);
  }
  assert.ok(parsed.context_routing !== undefined, `Expected context_routing key. Got: ${JSON.stringify(Object.keys(parsed))}`);
  assert.ok(typeof parsed.context_routing.keywords_count === 'number', 'Should have keywords_count');
});

test('AC-13: doctor --check-context-routing with all valid refs → no broken_refs', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['auth', 'auth-system'], ['billing', 'billing']]);
  writeModule(proj, 'auth-system', { status: 'active' });
  writeModule(proj, 'billing', { status: 'active' });

  const result = runDoctor(proj);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.context_routing?.broken_refs ?? [], [], 'No broken refs expected when all modules exist + active');
});

// ── AC-14: broken refs → BROKEN_CONTEXT_ROUTING findings ─────────────────────
test('AC-14: broken ref — missing module file → BROKEN_CONTEXT_ROUTING warning', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['nonexistent', 'does-not-exist']]);
  // does-not-exist NOT created

  const result = runDoctor(proj);
  assert.equal(result.status, 0, 'Doctor must exit 0 even with broken refs (D7)');

  const parsed = JSON.parse(result.stdout);
  const findings = parsed.findings || [];
  const brokenFinding = findings.find(f => f.code === 'BROKEN_CONTEXT_ROUTING');
  assert.ok(brokenFinding, `Expected BROKEN_CONTEXT_ROUTING finding. Got findings: ${JSON.stringify(findings)}`);
  assert.equal(brokenFinding.severity, 'warning', 'Severity should be "warning" (D7)');
  assert.equal(brokenFinding.slug, 'does-not-exist', 'Finding should have correct slug');
  assert.ok(brokenFinding.reason, 'Finding should have reason');
});

test('AC-14: broken ref — deprecated module → BROKEN_CONTEXT_ROUTING warning', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['old-api', 'legacy-module']]);
  writeModule(proj, 'legacy-module', { status: 'deprecated' });

  const result = runDoctor(proj);
  assert.equal(result.status, 0, 'Doctor exits 0 even with deprecated ref');

  const parsed = JSON.parse(result.stdout);
  const findings = parsed.findings || [];
  const brokenFinding = findings.find(f => f.code === 'BROKEN_CONTEXT_ROUTING' && f.slug === 'legacy-module');
  assert.ok(brokenFinding, `Expected BROKEN_CONTEXT_ROUTING for deprecated module. Got: ${JSON.stringify(findings)}`);
  assert.ok(brokenFinding.reason.toLowerCase().includes('deprecated') || brokenFinding.reason.toLowerCase().includes('status'),
    `Reason should mention deprecated. Got: ${brokenFinding.reason}`);
});

test('AC-14: broken ref — hypothesis module → BROKEN_CONTEXT_ROUTING warning', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['beta', 'beta-module']]);
  writeModule(proj, 'beta-module', { status: 'hypothesis' });

  const result = runDoctor(proj);
  const parsed = JSON.parse(result.stdout);
  const findings = parsed.findings || [];
  const brokenFinding = findings.find(f => f.code === 'BROKEN_CONTEXT_ROUTING' && f.slug === 'beta-module');
  assert.ok(brokenFinding, `Expected BROKEN_CONTEXT_ROUTING for hypothesis module. Got: ${JSON.stringify(findings)}`);
});

test('AC-14: mixed valid + broken refs — only broken get finding', () => {
  const proj = tmpProject();
  writeContextMd(proj, [['auth', 'auth-system'], ['broken', 'does-not-exist']]);
  writeModule(proj, 'auth-system', { status: 'active' });
  // does-not-exist NOT created

  const result = runDoctor(proj);
  const parsed = JSON.parse(result.stdout);
  const findings = parsed.findings || [];
  const brokenFindings = findings.filter(f => f.code === 'BROKEN_CONTEXT_ROUTING');
  assert.equal(brokenFindings.length, 1, 'Only 1 broken finding (does-not-exist)');
  assert.equal(brokenFindings[0].slug, 'does-not-exist');
});

test('AC-13: doctor --check-context-routing with no CONTEXT.md → graceful (no crash)', () => {
  const proj = tmpProject();
  // No CONTEXT.md

  const result = runDoctor(proj);
  assert.equal(result.status, 0, 'Doctor exits 0 even without CONTEXT.md');
  // JSON output should still be valid
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed !== null, 'Output should be valid JSON');
});
