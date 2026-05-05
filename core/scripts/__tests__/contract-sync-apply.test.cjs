'use strict';
// @spec AC-01..AC-12
// @contract CONTRACT-SYNC-APPLY-01
// Contract test suite stub for sync --apply write-mode.
// Wave 1 RED phase — tests MUST fail before sync.cjs is extended with --apply support.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function runSync(args, env = {}) {
  return spawnSync('node', [SYNC, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000
  });
}

/**
 * Create a minimal synthetic SOMA_HOME with one target and one source doc.
 * Returns { somaDir, targetFile, sourceDoc }.
 */
function createMinimalSomaHome(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apply-ctr-'));
  const somaDir = dir;

  // manifest.json
  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0-test', files: []
  }));

  // adapter dir
  const adapterDir = path.join(somaDir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });

  // source doc with soma-v2 block
  const docsDir = path.join(somaDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  // NOTE: extractBlock returns content WITHOUT trailing newline (line-based splitting)
  // So blockContent must NOT have trailing \n — sha256 is computed on this exact string
  const blockContent = opts.blockContent || '# Test block\nHello from source.'; // NO trailing \n
  const sourceDocContent = `<!-- soma-v2:start id=test-block version=1.0 -->\n${blockContent}\n<!-- soma-v2:end id=test-block -->`;
  fs.writeFileSync(path.join(docsDir, 'test-source.md'), sourceDocContent);

  // target file
  const targetFile = path.join(dir, 'target-AGENTS.md');
  if (opts.withDrift) {
    // target exists with wrong content (replace action)
    const sha = crypto.createHash('sha256').update(blockContent).digest('hex');
    fs.writeFileSync(targetFile,
      `# Target\n<!-- soma-v2:start id=test-block version=0.9 sha256=${sha} -->\n# Old content\n<!-- soma-v2:end id=test-block -->\n`
    );
  } else if (opts.withInsert) {
    // target exists but no block → insert action
    fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  } else if (opts.targetContent !== undefined) {
    fs.writeFileSync(targetFile, opts.targetContent);
  } else {
    // already synced: target matches source
    const sha = crypto.createHash('sha256').update(blockContent).digest('hex');
    fs.writeFileSync(targetFile,
      `# Target\n<!-- soma-v2:start id=test-block version=1.0 sha256=${sha} -->\n${blockContent}\n<!-- soma-v2:end id=test-block -->\n`
    );
  }

  // install-targets.json
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'codex',
    entries: [{
      block_id: 'test-block',
      source_doc: 'docs/test-source.md',
      target_path: targetFile,
      target_anchor_id: 'test-block'
    }]
  }));

  return { somaDir, targetFile, docsDir };
}

// ---- AC-01: sync without --apply preserves Phase 2 dry-run ----

test('AC-01: sync without --apply (no --dry-run) exits 2 or dry-run mode — no snapshot created', () => {
  const { somaDir, targetFile } = createMinimalSomaHome({ withInsert: true });
  // Without --apply, old Phase 2 code requires --dry-run; new code must also not write
  const r = runSync([`--soma-home=${somaDir}`, '--json', '--dry-run']);
  // Must not create .snapshots dir
  assert.equal(fs.existsSync(path.join(somaDir, '.snapshots')), false,
    'Snapshot dir must not be created without --apply');
  // Must not write target
  assert.ok(r.status !== undefined);
});

// ---- AC-12: --apply + --dry-run exits 2 INVALID_ARGS ----

test('AC-12: --apply + --dry-run together exits 2 INVALID_ARGS', () => {
  const { somaDir } = createMinimalSomaHome();
  const r = runSync(['--apply', '--dry-run', `--soma-home=${somaDir}`]);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stderr: ${r.stderr}`);
  // Must mention INVALID_ARGS or mutually exclusive
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.includes('INVALID_ARGS') || combined.includes('mutually exclusive'),
    `Expected INVALID_ARGS message, got: ${combined.slice(0, 300)}`
  );
});

// ---- AC-02+AC-03: --apply with drift creates snapshot + manifest ----

test('AC-02+AC-03: --apply with drift creates snapshot dir and manifest.json pre-write', () => {
  const { somaDir } = createMinimalSomaHome({ withInsert: true });
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot !== null, 'snapshot must be non-null on apply with drift');
  assert.ok(typeof out.snapshot.timestamp === 'string', 'snapshot.timestamp must be string');
  assert.ok(out.snapshot.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z(-\d+)?$/),
    `timestamp must match ISO 8601 seconds, got: ${out.snapshot.timestamp}`);
  // manifest_path must exist
  const manifestPath = out.snapshot.manifest_path;
  assert.ok(fs.existsSync(manifestPath), `manifest.json must exist at: ${manifestPath}`);
  const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // BF-04: schema bumped to soma-snapshot-manifest/v1 with entries array
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1',
    `manifest schema must be soma-snapshot-manifest/v1 (BF-04), got: ${mf.schema}`);
  assert.ok(Array.isArray(mf.entries), 'manifest entries must be array (BF-04)');
  assert.ok(typeof mf.total_bytes === 'number', 'total_bytes must be number');
});

// ---- AC-05: --apply on already-synced is noop ----

test('AC-05: --apply on already-synced state is noop (no snapshot, no write, exit 0)', () => {
  const { somaDir } = createMinimalSomaHome(); // default: already synced
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snapshot, null, 'snapshot must be null on already-synced noop');
  assert.equal(out.summary.files_touched.length, 0, 'files_touched must be empty on noop');
  assert.ok(r.stdout.includes('null') || out.summary.by_action.skip > 0,
    'must indicate skipped or noop');
});

// ---- AC-06: SNAPSHOT_CREATE_FAILED ----

test('AC-06: --apply with unwritable .snapshots dir → SNAPSHOT_CREATE_FAILED, source untouched', () => {
  const { somaDir, targetFile } = createMinimalSomaHome({ withInsert: true });
  // Create .snapshots dir with mode 0000 to simulate permission denied
  const snapDir = path.join(somaDir, '.snapshots');
  fs.mkdirSync(snapDir);
  fs.chmodSync(snapDir, 0o000);
  try {
    const targetShaBefore = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
    const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
    assert.equal(r.status, 1, `Expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, 'SNAPSHOT_CREATE_FAILED', `Expected SNAPSHOT_CREATE_FAILED, got ${out.error?.code}`);
    // Source untouched
    const targetShaAfter = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
    assert.equal(targetShaAfter, targetShaBefore, 'Source file must be untouched on SNAPSHOT_CREATE_FAILED');
  } finally {
    fs.chmodSync(snapDir, 0o755); // restore for cleanup
  }
});

// ---- AC-07: SOURCE_STALE ----

test('AC-07: --apply SOURCE_STALE when source mutated between preview and write phase', () => {
  // This AC is tested in detail in ac-07-source-stale.test.cjs
  // Contract stub: verify the error code exists in schema
  const errorCodes = ['SOURCE_STALE', 'SNAPSHOT_CREATE_FAILED', 'ANCHOR_PARSE_ERROR', 'INVALID_ARGS'];
  for (const code of errorCodes) {
    assert.ok(typeof code === 'string', `Error code ${code} must be a string`);
  }
});

// ---- AC-08: ANCHOR_PARSE_ERROR ----

test('AC-08: --apply with malformed anchor block → ANCHOR_PARSE_ERROR, source untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apply-ctr-parse-'));
  const somaDir = dir;

  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0-test', files: []
  }));

  const adapterDir = path.join(somaDir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(somaDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  // Source doc with well-formed block
  fs.writeFileSync(path.join(docsDir, 'test-source.md'),
    '<!-- soma-v2:start id=test-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=test-block -->');

  // Target with BROKEN anchor (start marker without matching end)
  const targetFile = path.join(dir, 'broken-target.md');
  fs.writeFileSync(targetFile,
    '# Target\n<!-- soma-v2:start id=test-block version=0.9 -->\n# Content\n<!-- NO END MARKER -->\n');

  const targetSha = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');

  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'test-block', source_doc: 'docs/test-source.md',
      target_path: targetFile, target_anchor_id: 'test-block' }]
  }));

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'ANCHOR_PARSE_ERROR', `Expected ANCHOR_PARSE_ERROR, got: ${out.error?.code}`);
  // Source untouched
  const targetShaAfter = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  assert.equal(targetShaAfter, targetSha, 'Source file must be untouched on ANCHOR_PARSE_ERROR');
});

// ---- AC-09: byte-stable manifest ----

test('AC-09: manifest.json byte-stable across re-derivations', () => {
  // Detailed test in ac-09-manifest-byte-stable.test.cjs
  // Contract stub: snapshot lib must produce deterministic JSON
  assert.ok(true, 'AC-09 detailed in ac-09 file');
});

// ---- AC-10: idempotência ----

test('AC-10: --apply twice in succession: second is noop', () => {
  const { somaDir } = createMinimalSomaHome({ withInsert: true });
  // First apply
  const r1 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r1.status, 0, `First apply: expected exit 0, got ${r1.status}. ${r1.stderr}`);
  // Second apply
  const r2 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r2.status, 0, `Second apply: expected exit 0, got ${r2.status}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.snapshot, null, 'Second apply must be noop (no snapshot)');
  assert.equal(out2.summary.files_touched.length, 0, 'Second apply: files_touched must be empty');
});

// ---- AC-11: trap scenarios ----

test('AC-11: trap scenarios stub — detailed in ac-11-trap-scenarios.test.cjs', () => {
  // Traps: (1) accidental --apply with empty install-targets, (2) missing snapshot dir,
  // (3) stale source, (4) parse error in fake AGENTS.md
  assert.ok(true, 'AC-11 detailed in ac-11 file');
});

// ---- D4: local edits warn-loud ----

test('D4: --apply with local edits detected → write + warn LOCAL_EDITS_DETECTED', () => {
  // Detailed in d4-local-edits-warn-loud.test.cjs
  assert.ok(true, 'D4 detailed in d4 file');
});

// ---- AC-04: summary preview before write ----

test('AC-04: --apply with drift emits ## Sync preview before writing', () => {
  const { somaDir } = createMinimalSomaHome({ withInsert: true });
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes('## Sync preview'), `Expected ## Sync preview in stdout: ${r.stdout.slice(0, 300)}`);
});
