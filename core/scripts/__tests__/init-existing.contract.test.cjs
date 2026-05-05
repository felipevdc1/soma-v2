'use strict';
// @spec AC-01,02,03,04,05,06,07,08,09,10,11,12
// @contract CONTRACT-INIT-EXISTING-01
// Wave 1 — Contract test suite (verbatim from contracts/init-existing.md stubs)
// TDD: These tests must FAIL before T-03..T-14 implementation.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-init-existing-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('init --existing: H2 detects src/ subdirs as modules (AC-01)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/button.tsx');
  makeFile(target, 'src/lib/utils.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.branch, 'existing');
  assert.equal(parsed.heuristic, 'H2');
  assert.equal(parsed.summary.modules_detected, 3);
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['app', 'components', 'lib']);
});

test('init --existing: detects package.json workspaces (AC-02)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'monorepo-test',
    workspaces: ['packages/foo', 'packages/bar']
  }));
  makeFile(target, 'packages/foo/index.ts');
  makeFile(target, 'packages/bar/index.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.ok(names.includes('foo'));
  assert.ok(names.includes('bar'));
});

test('init --existing: framework dirs detected when no src/ (AC-03)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'app/page.tsx');
  makeFile(target, 'components/button.tsx');
  makeFile(target, 'lib/utils.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['app', 'components', 'lib']);
});

test('init --existing: src/-first when src/ AND framework dirs coexist (AC-03 + NC-1)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // src/ exists with subdirs
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/btn.tsx');
  // framework dirs at root ALSO exist
  makeFile(target, 'app/legacy.tsx');
  makeFile(target, 'pages/index.tsx');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  // src/-first: only src/ subdirs detected, NOT root app/ or pages/
  assert.deepEqual(names, ['app', 'components']);
});

test('init --existing: emitted module file has correct schema fields (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const moduleFile = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(moduleFile.includes('schema: soma-module/v1'));
  assert.ok(moduleFile.includes('status: hypothesis'));
  assert.ok(moduleFile.includes('source_confidence: low'));
  assert.ok(moduleFile.includes('owners: []'));
  assert.ok(moduleFile.includes('last_verified: null'));
});

test('init --existing --deep: ranks by git commit count (AC-05)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/active/code.ts');
  makeFile(target, 'src/dormant/old.ts');
  execSync('git init && git add . && git -c user.email=test@t.com -c user.name=T commit -m initial', { cwd: target });
  // Touch active/ multiple times
  for (let i = 0; i < 5; i++) {
    makeFile(target, 'src/active/code.ts', `// v${i}\n`);
    execSync(`git add . && git -c user.email=test@t.com -c user.name=T commit -m "v${i}"`, { cwd: target });
  }
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H1');
  const names = parsed.modules.map(m => m.name);
  assert.ok(names.includes('active'));
  // dormant only had initial commit, but that's ≥1 in 90d window — both should appear
  assert.ok(names.includes('dormant'));
});

test('init --existing --deep: fallback to H2 when no .git/ (AC-06)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H2');
  assert.equal(parsed.git_repo_detected, false);
  assert.ok(parsed.warnings.some(w => w.includes('no git history')));
});

test('init --existing: detects existing .soma/ and redirects (exit 1) (AC-07)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let exitCode = 0;
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], {
      encoding: 'utf8',
      cwd: SOMA_HOME
    });
  } catch (e) {
    exitCode = e.status;
    const parsed = JSON.parse(e.stdout);
    assert.equal(parsed.mode, 'redirect');
    assert.equal(parsed.error, 'ALREADY_INITIALIZED');
  }
  assert.equal(exitCode, 1);
});

test('init --existing: zero modification of Phase 2/3 libs (AC-08)', (t) => {
  const libs = ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs'];
  const libDir = path.join(SOMA_HOME, 'scripts', 'lib');
  const before = libs.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(libDir, f))).digest('hex'));
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const after = libs.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(libDir, f))).digest('hex'));
  assert.deepEqual(after, before);
});

test('init --existing: empty repo emits "no modules inferred" (AC-10)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // No source files
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.modules_detected, 0);
  assert.equal(parsed.message, 'no modules inferred');
  // .soma/modules/index.md must still exist
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/index.md')));
});

test('init --existing: ≥1 file threshold (single-file modules valid) (AC-11)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/single.ts');  // exactly 1 file
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.modules_detected, 1);
  assert.equal(parsed.modules[0].name, 'app');
  assert.equal(parsed.modules[0].files_count, 1);
});

test('init --existing: schema validation has zero Claude-specific primitives (AC-12)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: SOMA_HOME
  });
  const projectMd = fs.readFileSync(path.join(target, '.soma/project.md'), 'utf8');
  const moduleMd = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  const claudeSpecificPatterns = [
    /\/specify\b/, /\/plan-sdd\b/, /\/sonar-audit\b/, /\/soma-run\b/,
    /thermal-guard\.cjs/, /spec-completeness-gate\.cjs/, /skill_id:/i, /hook_id:/i
  ];
  for (const pattern of claudeSpecificPatterns) {
    assert.ok(!pattern.test(projectMd), `project.md contains Claude-specific primitive: ${pattern}`);
    assert.ok(!pattern.test(moduleMd), `module.md contains Claude-specific primitive: ${pattern}`);
  }
});

test('init --existing: --json + --quiet returns INVALID_ARGS', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  let exitCode = 0;
  try {
    execFileSync('node', [INIT, '--existing', target, '--json', '--quiet'], {
      encoding: 'utf8',
      cwd: SOMA_HOME
    });
  } catch (e) {
    exitCode = e.status;
    assert.ok((e.stderr || e.stdout || '').includes('INVALID_ARGS'));
  }
  assert.equal(exitCode, 2);
});

test('init --existing + --with-agents-md: rejected as INVALID_ARGS', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  let exitCode = 0;
  try {
    execFileSync('node', [INIT, '--existing', target, '--with-agents-md', '--json'], {
      encoding: 'utf8',
      cwd: SOMA_HOME
    });
  } catch (e) {
    exitCode = e.status;
    assert.ok((e.stderr || e.stdout || '').includes('INVALID_ARGS'));
  }
  assert.equal(exitCode, 2);
});
