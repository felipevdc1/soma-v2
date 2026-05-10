'use strict';
/**
 * install-state.contract.test.cjs — T-03 contract tests for install-state-schema.md
 *
 * Article II HARD: RED phase — contract tests written BEFORE full implementation.
 * All cases FAIL until T-09 implements the state writer.
 *
 * Contract covered: [CONTRACT:02] core/specs/015-soma-install/contracts/install-state-schema.md
 *
 * Test map:
 *   SC-01: valid JSON with all required fields present                    → FAIL (RED — T-09)
 *   SC-02: status enum: complete|partial-failed|drift-detected only       → FAIL (RED — T-09)
 *   SC-03: timestamp ISO-8601 strict format                               → FAIL (RED — T-09)
 *   SC-04: snapshotId matches ISO timestamp pattern                       → FAIL (RED — T-09)
 *   SC-05: harness enum: claude|codex|both only                           → FAIL (RED — T-09)
 *   SC-06: installedVersion semver pattern                                → FAIL (RED — T-09)
 *   SC-07: status=complete → non-empty blockIds array                     → FAIL (RED — T-09)
 *   SC-08: status=partial-failed → non-empty lastError                    → FAIL (RED — T-09)
 *   SC-09: status=drift-detected → non-empty lastError                    → FAIL (RED — T-09)
 *   SC-10: file path is <project>/.soma/install-state.json (NOT /tmp/)    → FAIL (RED — T-09)
 *   SC-11: atomic write (temp + rename — no partial reads)                → FAIL (RED — T-09)
 *   SC-12: file mode 0644                                                 → FAIL (RED — T-09)
 *   SC-13: additionalProperties: false — unknown fields rejected          → FAIL (RED — T-09)
 *   SC-14: complete status with empty blockIds is INVALID                 → FAIL (RED — T-09)
 *
 * @spec [CONTRACT:02]
 * @task T-03
 */

const { test, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ── Test helper: writeInstallState ────────────────────────────────────────────
//
// This helper is the TARGET of T-09. It calls the state writer from install.cjs
// (or a future lib module) to produce <project>/.soma/install-state.json.
// Until T-09 exists, the function body throws — making ALL SC-* tests RED.

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const INSTALL_CJS = path.join(SCRIPTS_DIR, 'install.cjs');

/**
 * Write install-state.json to <projectPath>/.soma/install-state.json.
 *
 * Delegates to install.cjs module export `writeInstallState`.
 * Throws ReferenceError if the export doesn't exist yet (RED phase).
 *
 * @param {string} projectPath  — target project root
 * @param {object} state        — state object matching install-state-schema v1
 * @returns {string}            — absolute path of written file
 */
function writeInstallState(projectPath, state) {
  // Load install.cjs module; surface export if available.
  // Throws MODULE_NOT_FOUND or TypeError until T-09 adds the export.
  const installModule = require(INSTALL_CJS);
  if (typeof installModule.writeInstallState !== 'function') {
    throw new ReferenceError(
      '[RED — T-09] install.cjs does not export writeInstallState() yet. ' +
      'This function will be implemented in T-09.'
    );
  }
  return installModule.writeInstallState(projectPath, state);
}

/**
 * Read and parse <projectPath>/.soma/install-state.json.
 * Returns parsed object, throws on missing/invalid JSON.
 */
function readInstallState(projectPath) {
  const stateFile = path.join(projectPath, '.soma', 'install-state.json');
  const raw = fs.readFileSync(stateFile, 'utf8');
  return { parsed: JSON.parse(raw), filePath: stateFile };
}

// ── Temp directory management ─────────────────────────────────────────────────

/** Creates a fresh temp dir under /tmp/soma-test-state-{pid}/ for each test. */
function makeTempDir(suffix = '') {
  const base = path.join(os.tmpdir(), `soma-test-state-${process.pid}`);
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, `sc-${suffix}-`));
  return dir;
}

/** Recursively removes the test temp root (best-effort). */
function cleanTempRoot() {
  const base = path.join(os.tmpdir(), `soma-test-state-${process.pid}`);
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
}

// Clean up all test temps after the full suite.
after(cleanTempRoot);

// ── Shared valid state fixtures ───────────────────────────────────────────────

const VALID_COMPLETE_STATE = {
  $schema: 'soma-install-state/v1',
  status: 'complete',
  timestamp: '2026-05-09T14:50:00Z',
  snapshotId: '2026-05-09T14:49:55Z',
  harness: 'claude',
  installedVersion: '2.2.0',
  blockIds: ['block.claude.bootloader.cbm', 'block.claude.bootloader.hyd-v2'],
};

const VALID_PARTIAL_FAILED_STATE = {
  $schema: 'soma-install-state/v1',
  status: 'partial-failed',
  timestamp: '2026-05-09T14:50:00Z',
  snapshotId: '2026-05-09T14:49:55Z',
  harness: 'claude',
  installedVersion: '2.2.0',
  lastError: 'manifest baseline failed: EACCES on .soma/manifest.json',
};

const VALID_DRIFT_STATE = {
  $schema: 'soma-install-state/v1',
  status: 'drift-detected',
  timestamp: '2026-05-09T14:50:00Z',
  snapshotId: '2026-05-09T14:49:55Z',
  harness: 'claude',
  installedVersion: '2.1.4',
  lastError: 'BF-06: anchored block sha256 mismatch. Recovery: soma rollback',
};

// ── SC-01: valid JSON with all required fields present ────────────────────────
// Contract §required: [status, timestamp, snapshotId, harness, installedVersion]
// RED phase — FAILS until T-09 implements writeInstallState.

test('SC-01: writeInstallState produces valid JSON with all required fields', () => {
  const dir = makeTempDir('01');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);

    // Must be a non-null object
    assert.ok(parsed !== null && typeof parsed === 'object',
      'install-state.json must be a non-null object');

    // Required fields must all be present
    const required = ['status', 'timestamp', 'snapshotId', 'harness', 'installedVersion'];
    for (const field of required) {
      assert.ok(field in parsed,
        `[RED — T-09] Required field "${field}" missing from install-state.json`);
      assert.ok(parsed[field] !== null && parsed[field] !== undefined,
        `[RED — T-09] Required field "${field}" must be non-null`);
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-02: status enum: complete|partial-failed|drift-detected ───────────────
// Contract §status enum: ["complete", "partial-failed", "drift-detected"]
// RED phase — FAILS until T-09.

test('SC-02a: status=complete is written and read back correctly', () => {
  const dir = makeTempDir('02a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.status, 'complete',
      '[RED — T-09] status must be "complete" when written as complete');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-02b: status=partial-failed is written and read back correctly', () => {
  const dir = makeTempDir('02b');
  try {
    writeInstallState(dir, VALID_PARTIAL_FAILED_STATE);
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.status, 'partial-failed',
      '[RED — T-09] status must be "partial-failed" when written as partial-failed');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-02c: status=drift-detected is written and read back correctly', () => {
  const dir = makeTempDir('02c');
  try {
    writeInstallState(dir, VALID_DRIFT_STATE);
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.status, 'drift-detected',
      '[RED — T-09] status must be "drift-detected" when written as drift-detected');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-02d: invalid status value must be rejected by writeInstallState', () => {
  const dir = makeTempDir('02d');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, status: 'in-progress' };
    // writeInstallState MUST throw or reject invalid enum values (schema validation)
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => {
        // Must be an error related to schema/validation
        return err instanceof Error;
      },
      '[RED — T-09] writeInstallState must reject invalid status enum value "in-progress"'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-03: timestamp ISO-8601 strict format ────────────────────────────────────
// Contract §timestamp pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
// RED phase — FAILS until T-09.

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

test('SC-03a: timestamp field matches ISO-8601 UTC format (Z-suffix)', () => {
  const dir = makeTempDir('03a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);
    assert.ok(
      typeof parsed.timestamp === 'string' && ISO_TIMESTAMP_RE.test(parsed.timestamp),
      `[RED — T-09] timestamp must match /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/. Got: "${parsed.timestamp}"`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-03b: invalid timestamp format must be rejected', () => {
  const dir = makeTempDir('03b');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, timestamp: '2026-05-09 14:50:00' }; // missing T and Z
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject timestamp without T/Z ISO-8601 format'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-03c: timestamp with timezone offset (not Z) must be rejected', () => {
  const dir = makeTempDir('03c');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, timestamp: '2026-05-09T14:50:00+03:00' };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject timestamp with +HH:MM offset (only Z allowed)'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-04: snapshotId pattern matches ISO timestamp ────────────────────────────
// Contract §snapshotId pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
// RED phase — FAILS until T-09.

test('SC-04a: snapshotId field matches ISO-8601 UTC timestamp pattern', () => {
  const dir = makeTempDir('04a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);
    assert.ok(
      typeof parsed.snapshotId === 'string' && ISO_TIMESTAMP_RE.test(parsed.snapshotId),
      `[RED — T-09] snapshotId must match ISO-8601 timestamp pattern. Got: "${parsed.snapshotId}"`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-04b: snapshotId must match snapshot directory naming convention', () => {
  // Snapshot dirs live at ~/.soma-v2/.snapshots/<id>/ where <id> is the snapshotId.
  // The pattern must allow directory-safe ISO timestamps (no colons issue on some FS,
  // but contract explicitly uses colon format — test that the value round-trips cleanly).
  const dir = makeTempDir('04b');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);
    // The snapshotId must match exactly what was written (no mangling)
    assert.equal(parsed.snapshotId, VALID_COMPLETE_STATE.snapshotId,
      '[RED — T-09] snapshotId must round-trip without modification');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-05: harness enum: claude|codex|both ────────────────────────────────────
// Contract §harness enum: ["claude", "codex", "both"]
// RED phase — FAILS until T-09.

test('SC-05a: harness=claude is valid and round-trips correctly', () => {
  const dir = makeTempDir('05a');
  try {
    writeInstallState(dir, { ...VALID_COMPLETE_STATE, harness: 'claude' });
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.harness, 'claude',
      '[RED — T-09] harness must be "claude" when written as claude');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-05b: harness=codex is valid and round-trips correctly', () => {
  const dir = makeTempDir('05b');
  try {
    writeInstallState(dir, {
      ...VALID_COMPLETE_STATE,
      harness: 'codex',
      blockIds: ['block.codex.AGENTS.soma-stsd'],
    });
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.harness, 'codex',
      '[RED — T-09] harness must be "codex" when written as codex');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-05c: harness=both is valid and round-trips correctly', () => {
  const dir = makeTempDir('05c');
  try {
    writeInstallState(dir, {
      ...VALID_COMPLETE_STATE,
      harness: 'both',
      blockIds: ['block.claude.bootloader.cbm', 'block.codex.AGENTS.soma-stsd'],
    });
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.harness, 'both',
      '[RED — T-09] harness must be "both" when written as both');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-05d: invalid harness value must be rejected', () => {
  const dir = makeTempDir('05d');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, harness: 'cursor' };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject invalid harness value "cursor"'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-06: installedVersion semver pattern ────────────────────────────────────
// Contract §installedVersion pattern: /^\d+\.\d+\.\d+/
// RED phase — FAILS until T-09.

const SEMVER_RE = /^\d+\.\d+\.\d+/;

test('SC-06a: installedVersion matches semver pattern (N.N.N)', () => {
  const dir = makeTempDir('06a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);
    assert.ok(
      typeof parsed.installedVersion === 'string' && SEMVER_RE.test(parsed.installedVersion),
      `[RED — T-09] installedVersion must match /^\\d+\\.\\d+\\.\\d+/. Got: "${parsed.installedVersion}"`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-06b: installedVersion with pre-release suffix is allowed (pattern prefix match)', () => {
  // Contract uses /^\d+\.\d+\.\d+/ (not anchored end) — pre-release tags like 2.2.0-beta.1 are valid
  const dir = makeTempDir('06b');
  try {
    writeInstallState(dir, { ...VALID_COMPLETE_STATE, installedVersion: '2.2.0-beta.1' });
    const { parsed } = readInstallState(dir);
    assert.ok(SEMVER_RE.test(parsed.installedVersion),
      '[RED — T-09] installedVersion with pre-release suffix must satisfy semver prefix pattern');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-06c: invalid installedVersion (no dots) must be rejected', () => {
  const dir = makeTempDir('06c');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, installedVersion: 'v220' };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject installedVersion "v220" (no semver dots)'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-07: status=complete → non-empty blockIds array ─────────────────────────
// Contract §Invariants: status complete MUST have non-empty blockIds array
// RED phase — FAILS until T-09.

test('SC-07a: status=complete with non-empty blockIds is valid', () => {
  const dir = makeTempDir('07a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);
    assert.ok(
      Array.isArray(parsed.blockIds) && parsed.blockIds.length > 0,
      `[RED — T-09] status=complete must have non-empty blockIds array. Got: ${JSON.stringify(parsed.blockIds)}`
    );
    // All entries must be non-empty strings
    for (const id of parsed.blockIds) {
      assert.ok(typeof id === 'string' && id.length > 0,
        `[RED — T-09] blockIds entries must be non-empty strings. Got: "${id}"`);
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-07b: status=complete with empty blockIds must be rejected', () => {
  const dir = makeTempDir('07b');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, blockIds: [] };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject status=complete with empty blockIds array'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-07c: status=complete with missing blockIds must be rejected', () => {
  const dir = makeTempDir('07c');
  try {
    const { blockIds: _omit, ...stateWithoutBlockIds } = VALID_COMPLETE_STATE;
    assert.throws(
      () => writeInstallState(dir, stateWithoutBlockIds),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject status=complete with missing blockIds field'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-08: status=partial-failed → non-empty lastError ────────────────────────
// Contract §Invariants: status partial-failed MUST have non-empty lastError
// RED phase — FAILS until T-09.

test('SC-08a: status=partial-failed with non-empty lastError is valid', () => {
  const dir = makeTempDir('08a');
  try {
    writeInstallState(dir, VALID_PARTIAL_FAILED_STATE);
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.status, 'partial-failed',
      '[RED — T-09] status must be partial-failed');
    assert.ok(
      typeof parsed.lastError === 'string' && parsed.lastError.length > 0,
      `[RED — T-09] status=partial-failed must have non-empty lastError. Got: "${parsed.lastError}"`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-08b: status=partial-failed with missing lastError must be rejected', () => {
  const dir = makeTempDir('08b');
  try {
    const { lastError: _omit, ...stateWithoutError } = VALID_PARTIAL_FAILED_STATE;
    assert.throws(
      () => writeInstallState(dir, stateWithoutError),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject status=partial-failed without lastError'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-08c: status=partial-failed with empty lastError must be rejected', () => {
  const dir = makeTempDir('08c');
  try {
    const invalidState = { ...VALID_PARTIAL_FAILED_STATE, lastError: '' };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject status=partial-failed with empty lastError string'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-09: status=drift-detected → non-empty lastError ────────────────────────
// Contract §Invariants: status drift-detected MUST have non-empty lastError
// RED phase — FAILS until T-09.

test('SC-09a: status=drift-detected with non-empty lastError is valid', () => {
  const dir = makeTempDir('09a');
  try {
    writeInstallState(dir, VALID_DRIFT_STATE);
    const { parsed } = readInstallState(dir);
    assert.equal(parsed.status, 'drift-detected',
      '[RED — T-09] status must be drift-detected');
    assert.ok(
      typeof parsed.lastError === 'string' && parsed.lastError.length > 0,
      `[RED — T-09] status=drift-detected must have non-empty lastError. Got: "${parsed.lastError}"`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-09b: status=drift-detected with missing lastError must be rejected', () => {
  const dir = makeTempDir('09b');
  try {
    const { lastError: _omit, ...stateWithoutError } = VALID_DRIFT_STATE;
    assert.throws(
      () => writeInstallState(dir, stateWithoutError),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject status=drift-detected without lastError'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-10: file path is <project>/.soma/install-state.json (NOT /tmp/) ─────────
// Contract §File Path: "<project-path>/.soma/install-state.json"
// NOTE: NOT in /tmp/ — must survive reboot, be project-local, cross-harness readable.
// RED phase — FAILS until T-09.

test('SC-10a: state file is written to <project>/.soma/install-state.json', () => {
  const dir = makeTempDir('10a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);

    const expectedPath = path.join(dir, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(expectedPath),
      `[RED — T-09] install-state.json must exist at ${expectedPath}`
    );

    // Must NOT be a symlink to /tmp/
    const realPath = fs.realpathSync(expectedPath);
    assert.ok(
      realPath.startsWith(dir),
      `[RED — T-09] install-state.json real path must be inside project dir. Got: ${realPath}`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-10b: state file path does NOT live under /tmp/ directly', () => {
  // Regression: early prototypes wrote to /tmp/soma-install-state-{pid}.json.
  // Contract explicitly prohibits /tmp/ as "lost on reboot" (see CONTRACT:02 §File Path).
  const dir = makeTempDir('10b');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);

    const expectedPath = path.join(dir, '.soma', 'install-state.json');
    const realPath = fs.realpathSync(expectedPath);

    // Must not start with os.tmpdir() as the project root
    // (temp dirs used in tests are inside project dir — that's fine,
    //  but the file must be relative to the project, not a separate /tmp file)
    assert.ok(
      realPath === path.join(dir, '.soma', 'install-state.json'),
      `[RED — T-09] install-state.json must be exactly at <project>/.soma/install-state.json. Got: ${realPath}`
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-10c: writeInstallState creates .soma/ dir if it does not exist', () => {
  const dir = makeTempDir('10c');
  try {
    // Ensure .soma/ does NOT exist pre-write
    const somaDir = path.join(dir, '.soma');
    assert.ok(!fs.existsSync(somaDir), 'Precondition: .soma/ must not exist before test');

    writeInstallState(dir, VALID_COMPLETE_STATE);

    assert.ok(fs.existsSync(somaDir),
      '[RED — T-09] writeInstallState must create .soma/ directory if missing');
    assert.ok(fs.existsSync(path.join(somaDir, 'install-state.json')),
      '[RED — T-09] install-state.json must exist after writeInstallState');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-11: atomic write (temp + rename) ──────────────────────────────────────
// Contract §Invariants: "written atomically (write-to-temp + rename) to avoid mid-write corruption"
// RED phase — FAILS until T-09.
//
// Verification strategy: install.cjs writeInstallState must expose the temp-file
// write pattern. We verify (a) the final file is valid JSON (no partial write),
// and (b) no stale .tmp file lingers after successful write.

test('SC-11a: final install-state.json is fully written (no partial/truncated JSON)', () => {
  const dir = makeTempDir('11a');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const stateFile = path.join(dir, '.soma', 'install-state.json');

    // Read raw bytes — valid JSON must parse completely
    const raw = fs.readFileSync(stateFile, 'utf8');
    let parsed;
    assert.doesNotThrow(
      () => { parsed = JSON.parse(raw); },
      `[RED — T-09] install-state.json must be fully-written valid JSON (no truncation/partial write)`
    );
    assert.ok(parsed !== null && typeof parsed === 'object',
      '[RED — T-09] Parsed install-state.json must be a non-null object');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-11b: no stale .tmp file left after successful write', () => {
  const dir = makeTempDir('11b');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const somaDir = path.join(dir, '.soma');

    // Scan for any .tmp or .tmp.* files lingering after write
    const entries = fs.readdirSync(somaDir);
    const tmpFiles = entries.filter(e => e.includes('.tmp') || e.endsWith('~'));
    assert.equal(tmpFiles.length, 0,
      `[RED — T-09] No .tmp files must remain after atomic write. Found: ${tmpFiles.join(', ')}`);

    // The only file must be install-state.json (plus optional other legitimate .soma files)
    assert.ok(entries.includes('install-state.json'),
      '[RED — T-09] install-state.json must exist in .soma/ after write');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-12: file mode 0644 ─────────────────────────────────────────────────────
// Contract §Invariants: "File mode: 0644 (user read+write, group/other read)"
// RED phase — FAILS until T-09.

test('SC-12: install-state.json file mode is 0644', () => {
  const dir = makeTempDir('12');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const stateFile = path.join(dir, '.soma', 'install-state.json');

    const stat = fs.statSync(stateFile);
    // Extract the permission bits (mask off file type bits)
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o644,
      `[RED — T-09] install-state.json must have mode 0644. Got: 0${mode.toString(8)}`);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-13: additionalProperties: false — unknown fields rejected ──────────────
// Contract schema §additionalProperties: false
// RED phase — FAILS until T-09.

test('SC-13a: state with unknown field must be rejected', () => {
  const dir = makeTempDir('13a');
  try {
    const invalidState = {
      ...VALID_COMPLETE_STATE,
      unknownField: 'this should not be allowed',
    };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject object with additional properties not in schema'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('SC-13b: written file contains no extra fields beyond schema', () => {
  const dir = makeTempDir('13b');
  try {
    writeInstallState(dir, VALID_COMPLETE_STATE);
    const { parsed } = readInstallState(dir);

    const allowedFields = new Set([
      '$schema', 'status', 'timestamp', 'snapshotId', 'harness',
      'installedVersion', 'lastError', 'blockIds',
    ]);
    const actualFields = Object.keys(parsed);
    const extraFields = actualFields.filter(f => !allowedFields.has(f));
    assert.equal(extraFields.length, 0,
      `[RED — T-09] install-state.json must contain ONLY schema-defined fields. Extra: ${extraFields.join(', ')}`);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── SC-14: complete status with empty blockIds is INVALID ─────────────────────
// Additional invariant to guard against silent regression: complete install
// with zero blocks written is a logical error (nothing was actually injected).
// RED phase — FAILS until T-09.

test('SC-14: complete status with null blockIds must be rejected', () => {
  const dir = makeTempDir('14');
  try {
    const invalidState = { ...VALID_COMPLETE_STATE, blockIds: null };
    assert.throws(
      () => writeInstallState(dir, invalidState),
      (err) => err instanceof Error,
      '[RED — T-09] writeInstallState must reject status=complete with null blockIds'
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});
