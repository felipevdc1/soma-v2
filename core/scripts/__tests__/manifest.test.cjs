'use strict';
/**
 * manifest.test.cjs — T-01 scaffold tests for manifest.cjs stub
 *
 * Verifies foundation behaviour: --help, unknown flags, unknown subverb,
 * mutual-exclusion guard, and stub success path.
 *
 * Test runner: node:test (NOT bun).
 *
 * @spec [SPEC:AC-10] [SPEC:AC-15]
 * @task T-01
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'manifest.cjs');
const DOCTOR_SCRIPT = path.resolve(__dirname, '..', 'doctor.cjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

test('manifest.cjs --help exits 0 and mentions all flags', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--help']);
  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
  const out = r.stdout.toString();
  assert.match(out, /--dry-run/);
  assert.match(out, /--apply/);
  assert.match(out, /--filter/);
  assert.match(out, /--json/);
  assert.match(out, /--help/);
});

test('manifest.cjs unknown flag returns INVALID_ARGS exit 2', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--bogus']);
  assert.strictEqual(r.status, 2);
});

test('manifest.cjs unknown subverb returns UNKNOWN_SUBVERB exit 2', () => {
  const r = spawnSync('node', [SCRIPT, 'unknown']);
  assert.strictEqual(r.status, 2);
});

test('manifest.cjs baseline + --dry-run AND --apply mutually exclusive', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--apply']);
  assert.strictEqual(r.status, 2);
});

// NOTE: T-01 scaffold test 5 ("stub returns 0 with stub message") removed at T-13
// closure. It was env-dependent — passed accidentally because real ~/.soma-v2/manifest.json
// happened to have an entry with "stub" in id (core.module-cookbook-stub). Stub itself
// was replaced by real impl in T-03; AC-15 (default mode is dry-run + hint emission)
// covers the equivalent assertion via controlled fixture without env dependency.

// ── Fixture helpers (T-02) ────────────────────────────────────────────────────

/**
 * Compute sha256 hex of a Buffer or string.
 * @param {Buffer|string} buf
 * @returns {string}
 */
function sha256hex(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return crypto.createHash('sha256').update(b).digest('hex');
}

/**
 * Create a temporary SOMA_HOME fixture with manifest.json and lab files.
 * Files are REAL on disk — no fs mocks (Article III HARD).
 *
 * @param {object} opts
 * @param {number} [opts.staleCount=1]         Entries whose manifest sha256 ≠ actual content sha
 * @param {number} [opts.cleanCount=1]         Entries whose manifest sha256 === actual content sha
 * @param {boolean} [opts.missingLabFile=false] Append one entry whose lab file does not exist
 * @param {boolean} [opts.emptyManifest=false]  Write a manifest with 0 file entries (all-clean baseline)
 * @returns {{ somaHome: string, manifestPath: string, initialManifestSha: string, entries: object[], cleanup: () => void }}
 */
function setupFixture(opts = {}) {
  const {
    staleCount = 1,
    cleanCount = 1,
    missingLabFile = false,
    emptyManifest = false,
  } = opts;

  const pid = process.pid;
  const rand = Math.floor(Math.random() * 1e6);
  const somaHome = fs.mkdtempSync(
    path.join(os.tmpdir(), `soma-baseline-test-${pid}-${rand}-`)
  );

  const labDir = path.join(somaHome, 'lab');
  fs.mkdirSync(labDir, { recursive: true });

  const files = [];

  if (!emptyManifest) {
    // Clean entries: manifest sha256 === actual file sha
    for (let i = 0; i < cleanCount; i++) {
      const labPath = `lab/clean-${i}.md`;
      const content = `# Clean file ${i}\nThis content is up to date.\n`;
      const actualSha = sha256hex(content);
      fs.writeFileSync(path.join(somaHome, labPath), content);
      files.push({
        id: `clean.entry.${i}`,
        path: labPath,
        sha256: actualSha,         // matches content → clean
        sourceSha256: `src-clean-${i}-original`,
      });
    }

    // Stale entries: manifest sha256 ≠ actual file sha
    for (let i = 0; i < staleCount; i++) {
      const labPath = `lab/stale-${i}.md`;
      const content = `# Stale file ${i}\nActual current content that differs from recorded sha.\n`;
      const actualSha = sha256hex(content);
      // Deliberately wrong sha in manifest (simulates drift)
      const staleSha = 'a'.repeat(64);
      assert.notStrictEqual(actualSha, staleSha); // sanity: must differ
      fs.writeFileSync(path.join(somaHome, labPath), content);
      files.push({
        id: `stale.entry.${i}`,
        path: labPath,
        sha256: staleSha,          // differs from actual → stale
        sourceSha256: `src-stale-${i}-original`,
      });
    }

    // Entry whose lab file is absent (for AC-16)
    if (missingLabFile) {
      files.push({
        id: `missing.entry.0`,
        path: `lab/nonexistent-file.md`,   // file intentionally NOT created
        sha256: 'b'.repeat(64),
        sourceSha256: `src-missing-original`,
      });
    }
  }

  const manifest = {
    schema: 'soma-manifest/v1',
    version: '1.0',
    generatedAt: new Date().toISOString(),
    files,
  };

  const manifestPath = path.join(somaHome, 'manifest.json');
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(manifestPath, manifestContent);
  const initialManifestSha = sha256hex(manifestContent);

  function cleanup() {
    try { fs.rmSync(somaHome, { recursive: true, force: true }); } catch (_) {}
  }

  return { somaHome, manifestPath, initialManifestSha, entries: files, cleanup };
}

// ── T-02 Contract Tests ───────────────────────────────────────────────────────

// @spec AC-01
test('AC-01 [T-02] dry-run lists stale entries in JSON without mutation', () => {
  const { somaHome, manifestPath, initialManifestSha, cleanup } = setupFixture({ staleCount: 2, cleanCount: 1 });
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    // Must emit valid JSON
    let out;
    try {
      out = JSON.parse(r.stdout.toString());
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${r.stdout.toString().slice(0, 200)}`);
    }

    // JSON schema field
    assert.strictEqual(out.schema, 'soma-manifest-baseline/v1', 'schema field must be soma-manifest-baseline/v1');
    assert.strictEqual(out.mode, 'dry-run', 'mode must be dry-run');
    // 2 stale entries must appear
    assert.strictEqual(out.entries_rebaseled.length, 2, 'must report 2 stale entries');

    // Verify ZERO mutation: manifest sha must be unchanged
    const afterContent = fs.readFileSync(manifestPath, 'utf8');
    const afterSha = sha256hex(afterContent);
    assert.strictEqual(afterSha, initialManifestSha, 'manifest must NOT be mutated in dry-run');
  } finally {
    cleanup();
  }
});

// @spec AC-02
test('AC-02 [T-02] apply writes manifest atomically and updates stale entries', () => {
  const { somaHome, manifestPath, entries, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  const staleEntry = entries.find(e => e.id === 'stale.entry.0');
  const staleLabPath = path.join(somaHome, staleEntry.path);

  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--apply', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    // Manifest must have been written with updated sha256
    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const updatedEntry = updated.files.find(f => f.id === 'stale.entry.0');
    const expectedSha = sha256hex(fs.readFileSync(staleLabPath));
    assert.strictEqual(
      updatedEntry.sha256, expectedSha,
      `manifest entry sha256 must be updated to actual content sha. Got: ${updatedEntry.sha256}`
    );
  } finally {
    cleanup();
  }
});

// @spec AC-03
test('AC-03 [T-02] post-apply doctor reports 0 source_staleness findings', () => {
  const { somaHome, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  try {
    // Step 1: apply baseline
    const applyR = spawnSync('node', [SCRIPT, 'baseline', '--apply'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(applyR.status, 0, `apply failed: ${applyR.stderr}`);

    // Step 2: run doctor on same SOMA_HOME
    const doctorR = spawnSync('node', [DOCTOR_SCRIPT, '--json', `--soma-home=${somaHome}`]);
    assert.strictEqual(doctorR.status, 0, `doctor must exit 0 after baseline apply; stderr=${doctorR.stderr}`);

    const doctorOut = JSON.parse(doctorR.stdout.toString());
    // findings must have zero source_staleness kind
    const stalenessFindings = (doctorOut.findings || []).filter(
      f => f.kind === 'source_staleness'
    );
    assert.strictEqual(stalenessFindings.length, 0, `doctor must report 0 source_staleness findings; got ${stalenessFindings.length}`);
  } finally {
    cleanup();
  }
});

// @spec AC-04
test('AC-04 [T-02] --filter <id> exact match only re-baselines matching entry', () => {
  const { somaHome, manifestPath, entries, cleanup } = setupFixture({ staleCount: 2, cleanCount: 0 });
  const targetId = entries[0].id; // 'stale.entry.0'

  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--apply', '--filter', targetId, '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Entry 0 must be re-baselined (sha updated)
    const entry0 = updated.files.find(f => f.id === 'stale.entry.0');
    const actualSha0 = sha256hex(fs.readFileSync(path.join(somaHome, entry0.path)));
    assert.strictEqual(entry0.sha256, actualSha0, 'filtered entry must be re-baselined');

    // Entry 1 must remain stale (sha unchanged)
    const entry1 = updated.files.find(f => f.id === 'stale.entry.1');
    assert.strictEqual(entry1.sha256, 'a'.repeat(64), 'non-matching entry must remain stale');
  } finally {
    cleanup();
  }
});

// @spec AC-05
test('AC-05 [T-02] --filter <path> exact match only re-baselines matching entry', () => {
  const { somaHome, manifestPath, entries, cleanup } = setupFixture({ staleCount: 2, cleanCount: 0 });
  const targetPath = entries[0].path; // 'lab/stale-0.md'

  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--apply', '--filter', targetPath, '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const entry0 = updated.files.find(f => f.id === 'stale.entry.0');
    const actualSha0 = sha256hex(fs.readFileSync(path.join(somaHome, entry0.path)));
    assert.strictEqual(entry0.sha256, actualSha0, 'path-filtered entry must be re-baselined');

    const entry1 = updated.files.find(f => f.id === 'stale.entry.1');
    assert.strictEqual(entry1.sha256, 'a'.repeat(64), 'non-matching entry must remain stale');
  } finally {
    cleanup();
  }
});

// @spec AC-06
test('AC-06 [T-02] --json output validates soma-manifest-baseline/v1 schema fields', () => {
  const { somaHome, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    let out;
    try {
      out = JSON.parse(r.stdout.toString());
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${r.stdout.toString().slice(0, 200)}`);
    }

    // Required fields per contract cli-baseline.md
    assert.strictEqual(out.schema, 'soma-manifest-baseline/v1', 'schema field');
    assert.ok(typeof out.mode === 'string', 'mode field must be string');
    assert.ok(typeof out.manifest_path === 'string', 'manifest_path field must be string');
    assert.ok('snapshot_path' in out, 'snapshot_path field must exist (null in dry-run)');
    assert.ok(typeof out.entries_considered === 'number', 'entries_considered must be number');
    assert.ok(Array.isArray(out.entries_rebaseled), 'entries_rebaseled must be array');
    assert.ok(Array.isArray(out.entries_skipped), 'entries_skipped must be array');
    assert.ok(typeof out.entries_clean === 'number', 'entries_clean must be number');

    // In dry-run mode, snapshot_path must be null
    assert.strictEqual(out.snapshot_path, null, 'snapshot_path must be null in dry-run mode');

    // entries_rebaseled items must have required fields
    if (out.entries_rebaseled.length > 0) {
      const item = out.entries_rebaseled[0];
      assert.ok('id' in item, 'rebaseled item must have id');
      assert.ok('path' in item, 'rebaseled item must have path');
      assert.ok('old_sha256' in item, 'rebaseled item must have old_sha256');
      assert.ok('new_sha256' in item, 'rebaseled item must have new_sha256');
    }
  } finally {
    cleanup();
  }
});

// @spec AC-07
test('AC-07 [T-02] frozen libs invariant — lib/*.cjs files not modified from main', () => {
  // This test verifies git-level invariant: lib/ files must not appear in diff from main.
  // In T-02 (RED commit), no lib/ files are modified → test PASSES.
  // In GREEN commits (T-03+), same invariant holds — any modification would FAIL this test.
  const r = spawnSync(
    'git',
    ['diff', '--name-only', 'main', '--', 'core/scripts/lib/'],
    { cwd: REPO_ROOT }
  );
  assert.strictEqual(r.status, 0, `git diff exited ${r.status}: ${r.stderr}`);
  const changed = r.stdout.toString().trim();
  assert.strictEqual(
    changed, '',
    `Frozen lib files must NOT be modified from main. Changed: ${changed}`
  );
});

// @spec AC-08
test('AC-08 [T-02] sourceSha256 is preserved after apply (never mutated)', () => {
  const { somaHome, manifestPath, entries, cleanup } = setupFixture({ staleCount: 2, cleanCount: 1 });

  // Snapshot sourceSha256 values before apply
  const before = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const beforeSourceShas = Object.fromEntries(
    before.files.map(f => [f.id, f.sourceSha256])
  );

  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--apply'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    // Verify that at least one stale sha256 WAS updated (apply did its job)
    const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const staleEntry = after.files.find(f => f.id === 'stale.entry.0');
    const actualSha = sha256hex(fs.readFileSync(path.join(somaHome, staleEntry.path)));
    assert.strictEqual(staleEntry.sha256, actualSha, 'stale entry sha256 must be updated by apply');

    // Verify sourceSha256 is preserved for ALL entries
    for (const file of after.files) {
      assert.strictEqual(
        file.sourceSha256,
        beforeSourceShas[file.id],
        `sourceSha256 for ${file.id} must be unchanged`
      );
    }
  } finally {
    cleanup();
  }
});

// @spec AC-09
test('AC-09 [T-02] apply creates snapshot at reported location', () => {
  const { somaHome, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--apply', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    let out;
    try {
      out = JSON.parse(r.stdout.toString());
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${r.stdout.toString().slice(0, 200)}`);
    }

    // snapshot_path must be non-null and the file must exist
    assert.ok(out.snapshot_path !== null, 'snapshot_path must not be null after apply');
    assert.ok(typeof out.snapshot_path === 'string', 'snapshot_path must be string');
    assert.ok(fs.existsSync(out.snapshot_path), `snapshot must exist at ${out.snapshot_path}`);
  } finally {
    cleanup();
  }
});

// @spec AC-10 (also covered in T-01 scaffold; additional assertion on --json flag documented)
test('AC-10 [T-02] --help exits 0 and documents all four flags including --json', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--help']);
  assert.strictEqual(r.status, 0, `expected exit 0; status=${r.status}`);
  const out = r.stdout.toString();
  assert.match(out, /--dry-run/, '--dry-run must appear in help');
  assert.match(out, /--apply/, '--apply must appear in help');
  assert.match(out, /--filter/, '--filter must appear in help');
  assert.match(out, /--json/, '--json must appear in help');
  assert.match(out, /--help|-h/, '--help/-h must appear in help');
});

// @spec AC-11
test('AC-11 [T-02] MANIFEST_MISSING — exits 2 with MANIFEST_MISSING when manifest absent', () => {
  // Create a temp dir that has NO manifest.json
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), `soma-baseline-test-${process.pid}-missing-`));
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run'], {
      env: { ...process.env, SOMA_HOME: emptyDir },
    });
    assert.strictEqual(r.status, 2, `expected exit 2 (MANIFEST_MISSING); got ${r.status}`);
    const errText = r.stderr.toString();
    assert.match(errText, /MANIFEST_MISSING/, 'stderr must contain MANIFEST_MISSING error code');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

// @spec AC-12
test('AC-12 [T-02] MANIFEST_INVALID — exits 2 when manifest has wrong schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `soma-baseline-test-${process.pid}-invalid-`));
  try {
    // Write manifest with wrong schema
    const invalidManifest = {
      schema: 'wrong-schema/v1',
      files: [],
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(invalidManifest, null, 2));

    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run'], {
      env: { ...process.env, SOMA_HOME: dir },
    });
    assert.strictEqual(r.status, 2, `expected exit 2 (MANIFEST_INVALID); got ${r.status}`);
    const errText = r.stderr.toString();
    assert.match(errText, /MANIFEST_INVALID/, 'stderr must contain MANIFEST_INVALID error code');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-13
test('AC-13 [T-02] apply is idempotent — 2nd run is no-op with byte-identical manifest', () => {
  const { somaHome, manifestPath, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  try {
    // First apply: should re-baseline the stale entry
    const r1 = spawnSync('node', [SCRIPT, 'baseline', '--apply'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r1.status, 0, `first apply failed: ${r1.stderr}`);

    // After first apply, stale entry must now be clean
    const afterFirst = fs.readFileSync(manifestPath, 'utf8');
    const afterFirstJson = JSON.parse(afterFirst);
    const staleEntry = afterFirstJson.files.find(f => f.id === 'stale.entry.0');
    const actualSha = sha256hex(fs.readFileSync(path.join(somaHome, staleEntry.path)));
    assert.strictEqual(staleEntry.sha256, actualSha, '1st apply must re-baseline the stale entry');

    const afterFirstSha = sha256hex(afterFirst);

    // Second apply: should be no-op
    const r2 = spawnSync('node', [SCRIPT, 'baseline', '--apply'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r2.status, 0, `second apply failed: ${r2.stderr}`);

    const afterSecond = fs.readFileSync(manifestPath, 'utf8');
    const afterSecondSha = sha256hex(afterSecond);
    assert.strictEqual(afterSecondSha, afterFirstSha, 'manifest must be byte-identical after 2nd apply');

    // Second apply output must signal 0 entries to re-baseline
    const out2 = r2.stdout.toString();
    assert.match(out2, /0 (entries|stale)/i, '2nd apply must report 0 entries to re-baseline');
  } finally {
    cleanup();
  }
});

// @spec AC-14
test('AC-14 [T-02] dry-run on all-clean manifest reports 0 stale entries, exits 0', () => {
  const { somaHome, cleanup } = setupFixture({ staleCount: 0, cleanCount: 3 });
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    let out;
    try {
      out = JSON.parse(r.stdout.toString());
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${r.stdout.toString().slice(0, 200)}`);
    }

    assert.strictEqual(out.schema, 'soma-manifest-baseline/v1');
    assert.strictEqual(out.entries_rebaseled.length, 0, 'must report 0 stale entries');
    assert.strictEqual(out.entries_clean, 3, 'must report 3 clean entries');
  } finally {
    cleanup();
  }
});

// @spec AC-15
test('AC-15 [T-02] default mode (no flag) is dry-run and emits --apply hint', () => {
  const { somaHome, manifestPath, initialManifestSha, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  try {
    // No --dry-run, no --apply
    const r = spawnSync('node', [SCRIPT, 'baseline'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    const out = r.stdout.toString();
    // Must NOT mutate manifest (dry-run mode)
    const afterSha = sha256hex(fs.readFileSync(manifestPath));
    assert.strictEqual(afterSha, initialManifestSha, 'default mode must not mutate manifest');

    // Must emit a hint reminding user to pass --apply
    assert.match(out, /--apply/, 'output must contain --apply hint');
  } finally {
    cleanup();
  }
});

// @spec AC-16
test('AC-16 [T-02] ENOENT lab file — skips entry with warning, continues, exits 0', () => {
  // 1 stale clean, 1 entry whose lab file is absent
  const { somaHome, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1, missingLabFile: true });
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    // Must exit 0 (missing lab file is skip-with-warning, not fatal)
    assert.strictEqual(r.status, 0, `expected exit 0 (ENOENT is non-fatal); stderr=${r.stderr}`);

    let out;
    try {
      out = JSON.parse(r.stdout.toString());
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${r.stdout.toString().slice(0, 200)}`);
    }

    assert.strictEqual(out.schema, 'soma-manifest-baseline/v1');
    // The missing-lab entry must appear in entries_skipped
    const skipped = out.entries_skipped.map(e => e.id || e);
    assert.ok(
      skipped.includes('missing.entry.0'),
      `missing.entry.0 must be in entries_skipped; got: ${JSON.stringify(skipped)}`
    );
    // The stale entry must still be processed (non-skipped)
    assert.ok(
      out.entries_rebaseled.some(e => e.id === 'stale.entry.0'),
      'stale.entry.0 must still appear in entries_rebaseled despite ENOENT peer'
    );
  } finally {
    cleanup();
  }
});

// @spec AC-17
test('AC-17 [T-02] --filter glob-like value treated as literal exact match (D-014-2)', () => {
  // 'adapters/*' contains a glob char but must be matched literally (no glob expansion)
  // No entry has id or path exactly equal to 'adapters/*' → 0 entries matched
  const { somaHome, cleanup } = setupFixture({ staleCount: 1, cleanCount: 1 });
  try {
    const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--filter', 'adapters/*', '--json'], {
      env: { ...process.env, SOMA_HOME: somaHome },
    });
    assert.strictEqual(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    let out;
    try {
      out = JSON.parse(r.stdout.toString());
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${r.stdout.toString().slice(0, 200)}`);
    }

    assert.strictEqual(out.schema, 'soma-manifest-baseline/v1');
    // 0 entries must match the literal 'adapters/*'
    assert.strictEqual(
      out.entries_rebaseled.length,
      0,
      `literal filter 'adapters/*' must match 0 entries; got ${out.entries_rebaseled.length}`
    );
    // filter_applied must reflect the literal value passed
    assert.strictEqual(out.filter_applied, 'adapters/*', 'filter_applied must echo the literal filter value');
  } finally {
    cleanup();
  }
});
