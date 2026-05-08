'use strict';
/**
 * manifest-baseline-doctor.test.cjs — AC-03 invariant: post-apply, doctor exits 0
 *
 * Sets up a fixture with a stale manifest entry (sha256 does not match actual lab file).
 * Runs `manifest baseline --apply` to refresh sha256. Then invokes `doctor.cjs` and
 * asserts exit code 0 with zero source_staleness drift findings (AC-03).
 *
 * Fixture design notes:
 * - sourceSha256 is NON-NULL so doctor.cjs actually evaluates the entry (entries with null
 *   sourceSha256 are skipped by detectSourceStaleness — would be a trivially passing test).
 * - No non-underscore-prefixed adapter directories are created to avoid target_drift
 *   errors (loadInstallTargets throws INSTALL_TARGETS_INVALID for missing install-targets.json,
 *   which counts as a drift finding → exit 1 even after apply).
 *
 * @spec [SPEC:AC-03] [T-12] [run-260508-0841-fb4dce]
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'manifest.cjs');
const DOCTOR = path.resolve(__dirname, '..', 'doctor.cjs');

function setupStaleFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-baseline-doctor-test-'));
  const docsDir = path.join(root, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  // Lab file with known content
  const labContent = 'test content for doctor integration';
  fs.writeFileSync(path.join(docsDir, 'test-doc.md'), labContent);

  // Manifest with STALE sha256 (all 'a's — clearly not the actual file sha256) and
  // NON-NULL sourceSha256 (required so doctor.cjs calls detectSourceStaleness on this entry).
  const manifest = {
    schema: 'soma-manifest/v1',
    version: '2.1.0-test',
    files: [
      {
        id: 'test.doc',
        path: 'docs/test-doc.md',
        sha256: 'aaaa'.repeat(16),
        sourceSha256: 'ffff'.repeat(16), // non-null → doctor will check this entry
        targets: ['global'],
        status: 'draft',
      },
    ],
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { somaHome: root };
}

test('AC-03 [T-12] post-baseline-apply, doctor.cjs exits 0 with 0 source_staleness findings', () => {
  const { somaHome } = setupStaleFixture();

  // Pre-baseline: doctor should detect source_staleness drift (exit 1)
  const preDoctor = spawnSync('node', [DOCTOR, '--json'], {
    env: { ...process.env, SOMA_HOME: somaHome },
  });
  // doctor.cjs exits 1 when staleness found — assert pre-state has drift
  assert.strictEqual(
    preDoctor.status,
    1,
    `Expected doctor to exit 1 (stale sha256) before apply, got ${preDoctor.status}; stdout=${preDoctor.stdout.toString()}`
  );
  const preOutput = JSON.parse(preDoctor.stdout.toString());
  const preStaleFindings = preOutput.findings.filter(f => f.kind === 'source_staleness');
  assert.ok(
    preStaleFindings.length > 0,
    `Expected ≥1 source_staleness finding pre-apply, got 0. Full findings: ${JSON.stringify(preOutput.findings)}`
  );

  // Apply baseline to refresh sha256
  const apply = spawnSync('node', [SCRIPT, 'baseline', '--apply'], {
    env: { ...process.env, SOMA_HOME: somaHome },
  });
  assert.strictEqual(apply.status, 0, `apply failed: stderr=${apply.stderr.toString()}`);

  // Post-baseline: doctor should exit 0 with 0 source_staleness findings
  const postDoctor = spawnSync('node', [DOCTOR, '--json'], {
    env: { ...process.env, SOMA_HOME: somaHome },
  });
  assert.strictEqual(
    postDoctor.status,
    0,
    `doctor still reports findings post-baseline: stdout=${postDoctor.stdout.toString()} stderr=${postDoctor.stderr.toString()}`
  );
  const postOutput = JSON.parse(postDoctor.stdout.toString());
  const postStaleFindings = postOutput.findings.filter(f => f.kind === 'source_staleness');
  assert.strictEqual(
    postStaleFindings.length,
    0,
    `Expected 0 source_staleness findings post-apply, got ${postStaleFindings.length}: ${JSON.stringify(postStaleFindings)}`
  );
});
