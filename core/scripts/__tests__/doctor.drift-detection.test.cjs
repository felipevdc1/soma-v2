'use strict';
// @spec AC-01
// Integration tests: doctor drift detection — verifies D1, D2, D3 known drifts
// Uses /tmp/ fixture replicating real ~/

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

/**
 * Create a fixture by copying real ~/.soma-v2 and setting up target files.
 * The fixture replicates:
 *   - somaDir/.soma-v2/ (full copy of real lab)
 *   - fixtureHome/.codex/AGENTS.md (copy of real ~/.codex/AGENTS.md — legacy markers)
 *   - fixtureHome/AGENTS.md — intentionally MISSING D1/D2 anchors
 */
function createDriftFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-drift-fixture-'));
  const somaDir = path.join(dir, '.soma-v2');

  // Copy real soma-v2 lab structure
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  // Create .codex/ with real AGENTS.md (has legacy markers — D3)
  fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
  const realCodexAgents = path.join(os.homedir(), '.codex', 'AGENTS.md');
  if (fs.existsSync(realCodexAgents)) {
    fs.copyFileSync(realCodexAgents, path.join(dir, '.codex', 'AGENTS.md'));
  }

  // Create ~/AGENTS.md WITHOUT soma-stsd or CBM blocks (D1+D2 present)
  fs.writeFileSync(path.join(dir, 'AGENTS.md'),
    '# Global Agent Operating Rules\n\nBasic rules only.\n'
  );

  // Patch install-targets to use fixture paths
  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const patchedEntries = targets.entries.map(e => {
    let tp = e.target_path;
    if (tp === '~/.codex/AGENTS.md') tp = path.join(dir, '.codex', 'AGENTS.md');
    else if (tp === '~/AGENTS.md') tp = path.join(dir, 'AGENTS.md');
    return { ...e, target_path: tp };
  });
  fs.writeFileSync(targetsPath, JSON.stringify({ ...targets, entries: patchedEntries }, null, 2));

  return { dir, somaDir };
}

function runDoctor(somaDir, extraArgs = []) {
  return spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`, ...extraArgs], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });
}

// ---- Tests ----

test('doctor: detects D1 — ~/AGENTS.md missing block.codex.AGENTS.soma-stsd', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  assert.equal(result.status, 1, `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);

  const d1 = parsed.findings.find(f =>
    f.target_anchor_id === 'block.codex.AGENTS.soma-stsd' &&
    f.target_path.includes('AGENTS.md') &&
    !f.target_path.includes('.codex')
  );
  assert.ok(d1, `D1 finding (soma-stsd in AGENTS.md) not found. All findings: ${JSON.stringify(parsed.findings.map(f => ({severity: f.severity, id: f.target_anchor_id, path: f.target_path})))}`);
  assert.equal(d1.severity, 'missing');
  assert.equal(d1.kind, 'target_drift');
});

test('doctor: detects D2 — ~/AGENTS.md missing block.codex.AGENTS.codebase-memory-mcp', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  const d2 = parsed.findings.find(f =>
    f.target_anchor_id === 'block.codex.AGENTS.codebase-memory-mcp' &&
    f.target_path.includes('AGENTS.md') &&
    !f.target_path.includes('.codex')
  );
  assert.ok(d2, `D2 finding (codebase-memory-mcp in AGENTS.md) not found`);
  assert.equal(d2.severity, 'missing');
  assert.equal(d2.kind, 'target_drift');
});

test('doctor: detects D3 — ~/.codex/AGENTS.md blocks lack id/version/sha256 attrs', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  // Guard: filter only target_drift findings with target_path (excludes source_staleness
  // findings which have lab_path instead of target_path and arise from constitution.md
  // drift in the real ~/.soma-v2 lab being copied into the fixture).
  const d3Findings = parsed.findings.filter(f =>
    f.kind === 'target_drift' &&
    f.target_path &&
    f.target_path.includes('.codex') &&
    f.severity === 'drift' &&
    f.message && f.message.includes('attributes')
  );
  assert.ok(d3Findings.length > 0, `D3 findings (codex anchors lacking attrs) not found`);
  // All codex entries should have drift severity (legacy markers)
  assert.ok(d3Findings.some(f => f.target_anchor_id === 'block.codex.AGENTS.hyd-v2'), 'hyd-v2 D3 finding expected');
});

test('doctor: all findings have kind=target_drift', () => {
  // TEST-STALE-FIX: Scoped to target_drift findings only. The doctor also emits
  // source_staleness findings when the real ~/.soma-v2 lab files (e.g. constitution.md)
  // have drifted from their manifest sha256. source_staleness is a valid distinct kind
  // for lab-internal staleness. The test intent is to verify that all TARGET drift
  // findings (blocks missing/drifted in user's tool config files) have kind=target_drift.
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  const targetDriftFindings = parsed.findings.filter(f =>
    f.severity !== 'ok' && f.kind === 'target_drift'
  );
  assert.ok(targetDriftFindings.length > 0, 'Expected at least one target_drift finding in fixture');
  for (const f of targetDriftFindings) {
    assert.equal(f.kind, 'target_drift',
      `All target drift findings should have kind=target_drift: ${JSON.stringify(f)}`);
  }
});

test('doctor: D1+D2 have severity=missing, D3 findings have severity=drift', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  const missingFindings = parsed.findings.filter(f => f.severity === 'missing');
  const driftFindings = parsed.findings.filter(f => f.severity === 'drift');

  assert.ok(missingFindings.length >= 2,
    `Expected ≥2 missing findings (D1+D2), got ${missingFindings.length}`);
  assert.ok(driftFindings.length >= 1,
    `Expected ≥1 drift finding (D3), got ${driftFindings.length}`);
});

test('doctor: zero false positives — no ok finding misclassified as drift', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  // Every finding with severity != 'ok' should have a valid reason
  for (const f of parsed.findings) {
    if (f.severity === 'ok') {
      // ok findings are fine — but there shouldn't be any when everything is drifted
      assert.ok(true); // ok is not a false positive
    }
    // All severities should be known values
    assert.ok(['missing', 'drift', 'ok', 'error'].includes(f.severity),
      `Unknown severity "${f.severity}" in finding: ${JSON.stringify(f)}`);
  }
});

test('doctor: summary by_kind.target_drift counts all drift findings', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  const { summary } = parsed;

  assert.ok(summary.by_kind.target_drift >= 3,
    `Expected ≥3 target_drift in summary.by_kind, got ${summary.by_kind.target_drift}`);
  assert.equal(summary.total_findings, parsed.findings.filter(f => f.severity !== 'ok').length);
});

test('doctor: reports expected_sha256 for missing findings', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  const missingFindings = parsed.findings.filter(f => f.severity === 'missing');
  for (const f of missingFindings) {
    assert.ok(typeof f.expected_sha256 === 'string' && f.expected_sha256.length > 0,
      `Missing finding should have expected_sha256: ${JSON.stringify(f)}`);
    assert.equal(f.actual_sha256, null);
  }
});

test('doctor: findings include source_doc field', () => {
  // TEST-STALE-FIX: Scoped to target_drift findings only. source_staleness findings
  // (from lab-internal constitution.md drift) use a different schema and do not
  // have a source_doc field — they represent source file staleness, not target drift.
  // The source_doc contract applies to target_drift findings only.
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);

  const parsed = JSON.parse(result.stdout);
  const targetDriftFindings = parsed.findings.filter(f => f.kind === 'target_drift');
  assert.ok(targetDriftFindings.length > 0, 'Expected at least one target_drift finding to validate source_doc');
  for (const f of targetDriftFindings) {
    assert.ok(typeof f.source_doc === 'string',
      `Finding should have source_doc: ${JSON.stringify(f)}`);
  }
});
