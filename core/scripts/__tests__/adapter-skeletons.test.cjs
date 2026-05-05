// @spec AC-01..AC-13
// @contract CONTRACT-ADAPTER-SKELETON-01
// Sprint 009: Adapter Skeletons — Cursor / Aider / ChatGPT-desktop
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const ADAPTERS_DIR = path.join(SOMA_HOME, 'adapters');
const NEW_ADAPTERS = ['cursor', 'aider', 'chatgpt-desktop'];

// ─── Per-adapter parameterized tests (5 assertions × 3 adapters = 15 tests) ──

NEW_ADAPTERS.forEach(tool => {
  // AC-01: folder exists
  test(`AC-01: '${tool}' adapter folder exists`, () => {
    const dir = path.join(ADAPTERS_DIR, tool);
    assert.ok(fs.existsSync(dir), `Adapter directory missing: ${dir}`);
    assert.ok(fs.statSync(dir).isDirectory(), `Expected directory at: ${dir}`);
  });

  // AC-02: 2 required files present
  test(`AC-02: '${tool}' adapter has install-targets.json + bootloader.md`, () => {
    const dir = path.join(ADAPTERS_DIR, tool);
    const jsonPath = path.join(dir, 'install-targets.json');
    const bootloaderPath = path.join(dir, 'bootloader.md');
    assert.ok(fs.existsSync(jsonPath), `install-targets.json missing for '${tool}': ${jsonPath}`);
    assert.ok(fs.existsSync(bootloaderPath), `bootloader.md missing for '${tool}': ${bootloaderPath}`);
  });

  // AC-03 + AC-04: install-targets.json schema conformance
  test(`AC-03/04: '${tool}' install-targets.json schema valid (schema/tool/entries)`, () => {
    const jsonPath = path.join(ADAPTERS_DIR, tool, 'install-targets.json');
    let json;
    try {
      json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      assert.fail(`Failed to parse install-targets.json for '${tool}': ${e.message}`);
    }
    // AC-03: root keys present
    assert.ok('schema' in json, `'${tool}' install-targets.json missing 'schema' key`);
    assert.ok('tool' in json, `'${tool}' install-targets.json missing 'tool' key`);
    assert.ok('entries' in json, `'${tool}' install-targets.json missing 'entries' key`);
    // AC-04: schema value + tool value + entries type
    assert.equal(json.schema, 'soma-install-targets/v1', `'${tool}' schema must be "soma-install-targets/v1"`);
    assert.equal(json.tool, tool, `'${tool}' tool field must match folder basename`);
    assert.ok(Array.isArray(json.entries), `'${tool}' entries must be an array (may be empty)`);
  });

  // AC-05: bootloader.md structure (H1 + Responsibilities ≥3 + Non-responsibilities ≥2)
  test(`AC-05: '${tool}' bootloader.md has required structure`, () => {
    const bootloaderPath = path.join(ADAPTERS_DIR, tool, 'bootloader.md');
    const content = fs.readFileSync(bootloaderPath, 'utf8');
    const lines = content.split('\n');

    // H1 title matching pattern: "# {Tool} Adapter — Bootloader"
    assert.match(content, /^# .+ Adapter — Bootloader/m,
      `'${tool}' bootloader.md must start with '# {Tool} Adapter — Bootloader' H1`);

    // ## Responsibilities section present
    assert.match(content, /^## Responsibilities$/m,
      `'${tool}' bootloader.md missing '## Responsibilities' section`);

    // ## Non-responsibilities section present
    assert.match(content, /^## Non-responsibilities$/m,
      `'${tool}' bootloader.md missing '## Non-responsibilities' section`);

    // Count numbered items under Responsibilities (≥3)
    const respStart = lines.findIndex(l => l === '## Responsibilities');
    const nonRespStart = lines.findIndex(l => l === '## Non-responsibilities');
    assert.ok(respStart !== -1, `'${tool}' ## Responsibilities not found`);
    assert.ok(nonRespStart !== -1, `'${tool}' ## Non-responsibilities not found`);
    assert.ok(respStart < nonRespStart, `'${tool}' ## Responsibilities must precede ## Non-responsibilities`);

    const respLines = lines.slice(respStart + 1, nonRespStart);
    const numberedItems = respLines.filter(l => /^\d+\./.test(l));
    assert.ok(numberedItems.length >= 3,
      `'${tool}' Responsibilities must have ≥3 numbered items, found ${numberedItems.length}`);

    // Count bulleted items under Non-responsibilities (≥2)
    const nonRespLines = lines.slice(nonRespStart + 1);
    const bulletedItems = nonRespLines.filter(l => /^- /.test(l));
    assert.ok(bulletedItems.length >= 2,
      `'${tool}' Non-responsibilities must have ≥2 bulleted items, found ${bulletedItems.length}`);
  });

  // AC-13: NO integration.md (D3 lock)
  test(`AC-13: '${tool}' adapter has NO integration.md (D3 lock)`, () => {
    const integrationPath = path.join(ADAPTERS_DIR, tool, 'integration.md');
    assert.ok(!fs.existsSync(integrationPath),
      `'${tool}' must NOT have integration.md (D3 lock — deferred Phase 5+): found at ${integrationPath}`);
  });
});

// ─── Cross-cutting tests ───────────────────────────────────────────────────

// AC-06: all new adapter folder names are kebab-case lowercase
test('AC-06: new adapter folder names are all kebab-case lowercase', () => {
  const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  for (const tool of NEW_ADAPTERS) {
    assert.match(tool, kebabPattern,
      `Adapter name '${tool}' must be kebab-case lowercase (NO underscores, NO PascalCase)`);
  }
});

// AC-07: doctor --check-context-routing processes new adapters without ERROR
test('AC-07: doctor --check-context-routing finds zero ERROR findings for new adapters', () => {
  const tmpProject = path.join(os.tmpdir(), `soma-spec009-doctor-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpProject, 'src', 'index.js'), '// test');

    const initResult = spawnSync('node', [
      path.join(SOMA_HOME, 'scripts', 'init.cjs'),
      '--existing',
      `--soma-home=${SOMA_HOME}`
    ], { cwd: tmpProject, encoding: 'utf8', timeout: 30000 });

    assert.equal(initResult.status, 0,
      `init failed (status ${initResult.status}): ${initResult.stderr}`);

    const doctorResult = spawnSync('node', [
      path.join(SOMA_HOME, 'scripts', 'doctor.cjs'),
      '--check-context-routing',
      '--json'
    ], { cwd: tmpProject, encoding: 'utf8', timeout: 30000 });

    assert.equal(doctorResult.status, 0,
      `doctor exited non-zero (status ${doctorResult.status}): ${doctorResult.stderr}`);

    let findings;
    try {
      findings = JSON.parse(doctorResult.stdout);
    } catch {
      // doctor may output non-JSON with --json in some builds; fallback: check stderr for ERROR
      const combinedOutput = doctorResult.stdout + doctorResult.stderr;
      assert.ok(!combinedOutput.includes('ERROR'),
        `doctor output contained ERROR: ${combinedOutput.slice(0, 500)}`);
      return;
    }

    if (findings.findings) {
      const errorFindings = findings.findings.filter(f =>
        f.severity === 'error' || f.severity === 'ERROR'
      );
      assert.equal(errorFindings.length, 0,
        `doctor found ERROR findings: ${JSON.stringify(errorFindings, null, 2)}`);
    }
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

// AC-08: bootstrap --quiet output adapters[] has ≥5 entries
test('AC-08: bootstrap --quiet output adapters[] has ≥5 entries (claude+codex+cursor+aider+chatgpt-desktop)', () => {
  const tmpProject = path.join(os.tmpdir(), `soma-spec009-bootstrap-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpProject, 'src', 'index.js'), '// test');

    const initResult = spawnSync('node', [
      path.join(SOMA_HOME, 'scripts', 'init.cjs'),
      '--existing',
      `--soma-home=${SOMA_HOME}`
    ], { cwd: tmpProject, encoding: 'utf8', timeout: 30000 });

    assert.equal(initResult.status, 0,
      `init failed (status ${initResult.status}): ${initResult.stderr}`);

    const bootstrapResult = spawnSync('node', [
      path.join(SOMA_HOME, 'scripts', 'bootstrap.cjs'),
      '--quiet'
    ], { cwd: tmpProject, encoding: 'utf8', timeout: 30000 });

    assert.equal(bootstrapResult.status, 0,
      `bootstrap exited non-zero (status ${bootstrapResult.status}): ${bootstrapResult.stderr}`);

    let output;
    try {
      output = JSON.parse(bootstrapResult.stdout);
    } catch (e) {
      assert.fail(`bootstrap --quiet output is not valid JSON: ${e.message}\nOutput: ${bootstrapResult.stdout.slice(0, 500)}`);
    }

    assert.ok(Array.isArray(output.adapters),
      `bootstrap output missing 'adapters' array field`);
    assert.ok(output.adapters.length >= 5,
      `bootstrap adapters[] must have ≥5 entries, got ${output.adapters.length}: ${JSON.stringify(output.adapters.map(a => a.tool || a))}`);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});
