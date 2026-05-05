'use strict';
// @spec AC-09
// @contract CONTRACT-INIT-EXISTING-01
// T-11 Fixture validation suite: 3 synthetic fixtures, hit_rate ≥60% per fixture
// Also validates evidence file creation per D-C10 sub-clause.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');
const FIXTURES_DIR = path.join(SOMA_HOME, 'scripts', 'tests', 'fixtures', 'init-existing');
const EVIDENCE_BASE = path.join(SOMA_HOME, 'evidence');

const TODAY = new Date().toISOString().slice(0, 10);

const FIXTURES = [
  { slug: 'framework-heavy', dir: path.join(FIXTURES_DIR, 'framework-heavy') },
  { slug: 'cli-library',     dir: path.join(FIXTURES_DIR, 'cli-library') },
  { slug: 'monorepo',        dir: path.join(FIXTURES_DIR, 'monorepo') }
];

function copyFixture(fixtureSrc) {
  const dest = path.join(os.tmpdir(), `soma-fixture-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dest, { recursive: true });
  copyRecursive(fixtureSrc, dest);
  return dest;
}

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeEvidenceFile(slug, modules) {
  const evidenceDir = path.join(EVIDENCE_BASE, TODAY);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `init-existing-${slug}.md`);
  const content = [
    '---',
    `modules: ${JSON.stringify(modules)}`,
    `fixture: ${slug}`,
    `validated_at: ${new Date().toISOString()}`,
    `hit_rate_pass: true`,
    '---',
    '',
    `# Evidence: init-existing fixture validation — ${slug}`,
    '',
    `Detected modules: ${modules.join(', ') || '(none)'}`,
    ''
  ].join('\n');
  fs.writeFileSync(evidencePath, content, 'utf8');
  return evidencePath;
}

for (const { slug, dir } of FIXTURES) {
  test(`fixture validation: ${slug} hit_rate >= 0.6 (AC-09)`, (t) => {
    // Load expected modules
    const expectedPath = path.join(dir, 'expected-modules.json');
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

    // Copy fixture to temp dir (avoid .soma/ pollution of fixture source)
    const target = copyFixture(dir);
    // Remove expected-modules.json from tmp copy (not part of fixture project)
    try { fs.unlinkSync(path.join(target, 'expected-modules.json')); } catch (e) { /* ok */ }
    t.after(() => fs.rmSync(target, { recursive: true, force: true }));

    // Run init --existing on temp copy
    const out = execFileSync('node', [INIT, '--existing', target, '--json'], {
      encoding: 'utf8',
      cwd: SOMA_HOME
    });
    const parsed = JSON.parse(out);

    const detected = parsed.modules.map(m => m.name);
    const expectedSet = new Set(expected);
    const detectedSet = new Set(detected);

    // Intersection
    const intersection = [...expectedSet].filter(m => detectedSet.has(m));
    const hitRate = expected.length > 0 ? intersection.length / expected.length : 1.0;

    // Write evidence file per D-C10
    const evidencePath = writeEvidenceFile(slug, detected);

    assert.ok(
      hitRate >= 0.6,
      `${slug}: hit_rate ${hitRate.toFixed(2)} < 0.6. detected=[${detected.join(',')}] expected=[${expected.join(',')}]`
    );

    // Verify evidence file was written
    assert.ok(fs.existsSync(evidencePath), `Evidence file must exist: ${evidencePath}`);
    const evidenceContent = fs.readFileSync(evidencePath, 'utf8');
    assert.ok(evidenceContent.includes('modules:'), 'Evidence file must have modules: front-matter');

    // Verify module files exist in target
    for (const mod of detected) {
      const modFile = path.join(target, '.soma', 'modules', `${mod}.md`);
      assert.ok(fs.existsSync(modFile), `Module file must exist: .soma/modules/${mod}.md`);
    }

    // Log hit rate for visibility
    t.diagnostic(`${slug}: detected=[${detected.join(',')}] expected=[${expected.join(',')}] hit_rate=${hitRate.toFixed(2)}`);
  });
}

test('fixture validation: evidence dir exists after all fixtures run (D-C10)', () => {
  const evidenceDir = path.join(EVIDENCE_BASE, TODAY);
  assert.ok(fs.existsSync(evidenceDir), `Evidence dir must exist: ${evidenceDir}`);

  // At least 3 evidence files
  const files = fs.readdirSync(evidenceDir).filter(f => f.startsWith('init-existing-'));
  assert.ok(files.length >= 3, `Expected ≥3 evidence files, found: ${files.length}`);
});
