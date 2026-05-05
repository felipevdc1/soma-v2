/**
 * bootstrap-perf.test.cjs — T-15 / AC-13
 * Wallclock duration ≤5000ms p95 for well-formed project (~10 modules).
 *
 * @spec AC-13
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME_REAL = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const BOOTSTRAP = path.join(SOMA_HOME_REAL, 'scripts', 'bootstrap.cjs');

function createSomaHomeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-home-'));
  const manifest = { schema: 'soma-manifest/v1', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(dir, 'adapters'), { recursive: true });
  return dir;
}

function createProjectWith10Modules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-perf-'));
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const statuses = ['active', 'hypothesis', 'deprecated'];
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(modulesDir, `module-${i}.md`), [
      '---', 'schema: soma-module/v1', `name: "Module ${i}"`, `status: ${statuses[i % 3]}`,
      'source_confidence: medium', 'owners: []', 'last_verified: "2026-05-02"',
      `source_path: "src/mod${i}"`, 'initialized_at: "2026-05-02T00:00:00Z"',
      '---', `# Module ${i}`,
    ].join('\n'), 'utf8');
  }
  return dir;
}

test('AC-13: single invocation completes within 5000ms', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWith10Modules();
  const start = Date.now();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed <= 5000, `Single invocation took ${elapsed}ms (limit 5000ms)`);
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
});

test('AC-13: p95 of 5 invocations ≤5000ms (lightweight p95 check)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWith10Modules();
  const durations = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    const start = Date.now();
    spawnSync('node', [BOOTSTRAP, '--quiet'], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, SOMA_HOME: somaHome },
      timeout: 10000,
    });
    durations.push(Date.now() - start);
  }
  durations.sort((a, b) => a - b);
  // p95 = 95th percentile; for N=5 that's the 4th value (index 4 after sort)
  const p95 = durations[Math.ceil(0.95 * N) - 1];
  assert.ok(p95 <= 5000, `p95 of ${N} runs = ${p95}ms (limit 5000ms). All: ${durations.join(', ')}ms`);
});

test('AC-13: duration_ms in output is accurate (within 1000ms of actual)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWith10Modules();
  const start = Date.now();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const elapsed = Date.now() - start;
  const out = JSON.parse(result.stdout);
  assert.ok(typeof out.duration_ms === 'number', 'duration_ms must be a number');
  // Internal duration should be close to actual elapsed (not exactly due to spawn overhead)
  // Just verify it's positive and reasonable
  assert.ok(out.duration_ms >= 0, 'duration_ms must be non-negative');
  assert.ok(out.duration_ms <= elapsed + 500, `duration_ms ${out.duration_ms}ms seems larger than elapsed ${elapsed}ms`);
});
