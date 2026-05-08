'use strict';
/**
 * source-sha-immutable.test.cjs — AC-08 invariant: sourceSha256 immutable under baseline --apply
 *
 * Sets up a fixture manifest with 4 derived entries having distinct sourceSha256 values
 * and stale sha256 fields. Runs `manifest baseline --apply` and asserts that every
 * entry's sourceSha256 is byte-identical pre/post write (D-014, AC-08).
 *
 * Also verifies that sha256 DID change for at least one entry (proving apply actually ran).
 *
 * @spec [SPEC:AC-08] [T-11] [run-260508-0841-fb4dce]
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'manifest.cjs');

function setupFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-source-sha-test-'));
  const docsDir = path.join(root, 'docs');
  const adaptersCodex = path.join(root, 'adapters', 'codex');
  const adaptersGlobal = path.join(root, 'adapters', '_global');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(adaptersCodex, { recursive: true });
  fs.mkdirSync(adaptersGlobal, { recursive: true });

  // Write lab files with KNOWN content so sha256 is computable
  const labFiles = {
    'docs/hyd-v2.md': 'hyd-v2 content here',
    'docs/soma-stsd.md': 'soma-stsd content here',
    'adapters/codex/AGENTS.md': 'codex AGENTS content',
    'adapters/_global/AGENTS.md': 'global AGENTS content',
  };
  for (const [rel, content] of Object.entries(labFiles)) {
    fs.writeFileSync(path.join(root, rel), content);
  }

  // Manifest: each entry has STALE sha256 (so apply will mutate it)
  // AND a UNIQUE, NON-NULL sourceSha256 (D-014 immutability subject)
  const manifest = {
    schema: 'soma-manifest/v1',
    version: '2.1.0-test',
    files: [
      {
        id: 'core.hyd-v2',
        path: 'docs/hyd-v2.md',
        sha256: 'aaaa'.repeat(16),
        sourceSha256: '1111'.repeat(16),
        targets: ['global'],
        status: 'draft',
      },
      {
        id: 'core.soma-stsd',
        path: 'docs/soma-stsd.md',
        sha256: 'bbbb'.repeat(16),
        sourceSha256: '2222'.repeat(16),
        targets: ['global'],
        status: 'draft',
      },
      {
        id: 'adapter.codex.AGENTS',
        path: 'adapters/codex/AGENTS.md',
        sha256: 'cccc'.repeat(16),
        sourceSha256: '3333'.repeat(16),
        targets: ['codex.global'],
        status: 'draft',
      },
      {
        id: 'adapter.global.AGENTS',
        path: 'adapters/_global/AGENTS.md',
        sha256: 'dddd'.repeat(16),
        sourceSha256: '4444'.repeat(16),
        targets: ['global'],
        status: 'draft',
      },
    ],
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { somaHome: root, manifestPath: path.join(root, 'manifest.json') };
}

test('AC-08 [T-11] sourceSha256 byte-identical pre/post apply on all 4 derived entries', () => {
  const { somaHome, manifestPath } = setupFixture();

  const preManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const preSourceShas = preManifest.files
    .map(f => ({ id: f.id, sourceSha256: f.sourceSha256 }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const r = spawnSync('node', [SCRIPT, 'baseline', '--apply', '--json'], {
    env: { ...process.env, SOMA_HOME: somaHome },
  });
  assert.strictEqual(r.status, 0, `apply failed: stderr=${r.stderr.toString()}`);

  const postManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const postSourceShas = postManifest.files
    .map(f => ({ id: f.id, sourceSha256: f.sourceSha256 }))
    .sort((a, b) => a.id.localeCompare(b.id));

  assert.deepStrictEqual(
    postSourceShas,
    preSourceShas,
    `sourceSha256 fields mutated on apply.\nPre:  ${JSON.stringify(preSourceShas)}\nPost: ${JSON.stringify(postSourceShas)}`
  );

  // Verify sha256 DID change for at least one entry (proves --apply actually ran)
  const preShas = preManifest.files.map(f => f.sha256);
  const postShas = postManifest.files.map(f => f.sha256);
  assert.notDeepStrictEqual(
    postShas,
    preShas,
    'sha256 fields unchanged after --apply — apply did not run'
  );
});
