'use strict';
// @spec AC-01 AC-04 AC-12
// @contract CONTRACT-INIT-EXISTING-01
// T-15: E2E smoke test — full output schema validation

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-e2e') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('E2E smoke: full contract output shape matches CONTRACT-INIT-EXISTING-01 (AC-01,04,12)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Build a realistic project shape (next.js-like with src/)
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/app/layout.tsx');
  makeFile(target, 'src/components/Button.tsx');
  makeFile(target, 'src/components/Card.tsx');
  makeFile(target, 'src/lib/utils.ts');
  makeFile(target, 'src/hooks/useAuth.ts');

  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);

  // Root-level contract fields
  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.branch, 'existing');
  assert.equal(parsed.mode, 'create');
  assert.ok(typeof parsed.soma_home === 'string');
  assert.ok(typeof parsed.target_path === 'string');
  assert.equal(parsed.heuristic, 'H2');
  assert.ok(typeof parsed.summary === 'object');
  assert.ok(typeof parsed.summary.modules_detected === 'number');
  assert.ok(typeof parsed.summary.modules_emitted === 'number');
  assert.ok(typeof parsed.summary.files_created === 'number');
  assert.ok(Array.isArray(parsed.modules));
  assert.ok(Array.isArray(parsed.files_created));

  // Module objects shape
  for (const m of parsed.modules) {
    assert.ok(typeof m.name === 'string');
    assert.ok(typeof m.files_count === 'number');
    assert.ok(typeof m.source_path === 'string');
    assert.equal(m.source_confidence, 'low');
  }

  // Expected module names
  const names = parsed.modules.map(m => m.name).sort();
  assert.ok(names.includes('app'), 'app module must be detected');
  assert.ok(names.includes('components'), 'components module must be detected');
  assert.ok(names.includes('lib'), 'lib module must be detected');
});

test('E2E smoke: all expected .soma/ files exist on disk', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/lib/utils.ts');

  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });

  assert.ok(fs.existsSync(path.join(target, '.soma/project.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/CONTEXT.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/manifest.json')));
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/index.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/app.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/lib.md')));
});

test('E2E smoke: --verbose mode produces output without --json (AC-01)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');

  const out = execFileSync('node', [INIT, '--existing', target, '--verbose'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(out.length > 0, '--verbose must produce output');
  assert.ok(out.includes('app'), 'must mention module name in verbose output');
});

test('E2E smoke: second run on same target redirects (AC-07 idempotency)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');

  // First run: success
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });

  // Second run: should redirect (exit 1)
  let exitCode = 0;
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) {
    exitCode = e.status;
    const parsed = JSON.parse(e.stdout);
    assert.equal(parsed.error, 'ALREADY_INITIALIZED');
  }
  assert.equal(exitCode, 1);
});

test('E2E smoke: greenfield (no --existing) still works normally after Phase 4a extension', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Greenfield init (no --existing) must still work
  const out = execFileSync('node', [INIT, target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.mode, 'create');
  // Greenfield should NOT have branch=existing
  assert.ok(parsed.branch !== 'existing', 'Greenfield must not use existing branch');
});
