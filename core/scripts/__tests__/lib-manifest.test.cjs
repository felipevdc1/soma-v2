'use strict';
// @spec AC-01
// Unit tests for scripts/lib/manifest.cjs

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadManifest,
  loadInstallTargets,
  listAdapters,
  expandHome,
  validateManifestSchema,
  validateInstallTargetsSchema
} = require('../lib/manifest.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-manifest-'));
}

function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// Minimal valid manifest
const VALID_MANIFEST = {
  schema: 'soma-manifest/v1',
  version: '2.1.0-draft',
  files: [
    { id: 'core.test', path: 'docs/test.md', sha256: 'abc', sourceSha256: null, sourceMtime: null, targets: [], expansion_owner: null, status: 'draft' }
  ]
};

// Minimal valid install-targets
const VALID_TARGETS = {
  schema: 'soma-install-targets/v1',
  tool: 'codex',
  entries: [
    { block_id: 'block.a', source_doc: 'docs/a.md', target_path: '~/.codex/AGENTS.md', target_anchor_id: 'block.a' }
  ]
};

// --- expandHome ---

test('expandHome: expands ~ to home dir', () => {
  const expanded = expandHome('~/AGENTS.md');
  assert.ok(expanded.startsWith('/'));
  assert.ok(!expanded.startsWith('~'));
  assert.ok(expanded.endsWith('/AGENTS.md'));
});

test('expandHome: leaves absolute path unchanged', () => {
  assert.equal(expandHome('/usr/local/bin'), '/usr/local/bin');
});

test('expandHome: handles bare ~', () => {
  assert.equal(expandHome('~'), os.homedir());
});

test('expandHome: non-string returns as-is', () => {
  assert.equal(expandHome(null), null);
  assert.equal(expandHome(undefined), undefined);
});

// --- validateManifestSchema ---

test('validateManifestSchema: accepts valid manifest', () => {
  assert.doesNotThrow(() => validateManifestSchema(VALID_MANIFEST));
});

test('validateManifestSchema: throws MANIFEST_INVALID for wrong schema', () => {
  assert.throws(
    () => validateManifestSchema({ schema: 'wrong', files: [] }),
    { code: 'MANIFEST_INVALID' }
  );
});

test('validateManifestSchema: throws MANIFEST_INVALID for missing files array', () => {
  assert.throws(
    () => validateManifestSchema({ schema: 'soma-manifest/v1' }),
    { code: 'MANIFEST_INVALID' }
  );
});

test('validateManifestSchema: throws MANIFEST_INVALID for null input', () => {
  assert.throws(() => validateManifestSchema(null), { code: 'MANIFEST_INVALID' });
});

test('validateManifestSchema: throws MANIFEST_INVALID for non-object', () => {
  assert.throws(() => validateManifestSchema('string'), { code: 'MANIFEST_INVALID' });
});

// --- validateInstallTargetsSchema ---

test('validateInstallTargetsSchema: accepts valid install-targets', () => {
  assert.doesNotThrow(() => validateInstallTargetsSchema(VALID_TARGETS));
});

test('validateInstallTargetsSchema: throws INSTALL_TARGETS_INVALID for wrong schema', () => {
  assert.throws(
    () => validateInstallTargetsSchema({ schema: 'other', entries: [] }),
    { code: 'INSTALL_TARGETS_INVALID' }
  );
});

test('validateInstallTargetsSchema: throws INSTALL_TARGETS_INVALID for missing entries array', () => {
  assert.throws(
    () => validateInstallTargetsSchema({ schema: 'soma-install-targets/v1' }),
    { code: 'INSTALL_TARGETS_INVALID' }
  );
});

test('validateInstallTargetsSchema: throws INSTALL_TARGETS_INVALID for entry missing required field', () => {
  assert.throws(
    () => validateInstallTargetsSchema({
      schema: 'soma-install-targets/v1',
      entries: [{ block_id: 'x' }] // missing source_doc, target_path, target_anchor_id
    }),
    { code: 'INSTALL_TARGETS_INVALID' }
  );
});

// --- loadManifest ---

test('loadManifest: loads valid manifest from filesystem', () => {
  const d = tmpDir();
  writeJSON(path.join(d, 'manifest.json'), VALID_MANIFEST);
  const result = loadManifest(d);
  assert.equal(result.schema, 'soma-manifest/v1');
  assert.equal(result.files.length, 1);
});

test('loadManifest: throws MANIFEST_MISSING for nonexistent file', () => {
  assert.throws(
    () => loadManifest('/tmp/soma-no-such-dir-12345/'),
    { code: 'MANIFEST_MISSING' }
  );
});

test('loadManifest: throws MANIFEST_INVALID for invalid JSON', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'manifest.json'), 'not json {{{');
  assert.throws(() => loadManifest(d), { code: 'MANIFEST_INVALID' });
});

test('loadManifest: throws MANIFEST_INVALID for wrong schema', () => {
  const d = tmpDir();
  writeJSON(path.join(d, 'manifest.json'), { schema: 'wrong', files: [] });
  assert.throws(() => loadManifest(d), { code: 'MANIFEST_INVALID' });
});

// --- loadInstallTargets ---

test('loadInstallTargets: loads valid install-targets from filesystem', () => {
  const d = tmpDir();
  const targetsPath = path.join(d, 'adapters', 'codex', 'install-targets.json');
  writeJSON(targetsPath, VALID_TARGETS);
  const result = loadInstallTargets(d, 'codex');
  assert.equal(result.schema, 'soma-install-targets/v1');
  assert.equal(result.entries.length, 1);
});

test('loadInstallTargets: expands ~ in target_path', () => {
  const d = tmpDir();
  writeJSON(path.join(d, 'adapters', 'codex', 'install-targets.json'), VALID_TARGETS);
  const result = loadInstallTargets(d, 'codex');
  const expanded = result.entries[0].target_path;
  assert.ok(expanded.startsWith('/'), `Expected absolute path, got: ${expanded}`);
  assert.ok(!expanded.startsWith('~'));
});

test('loadInstallTargets: throws INSTALL_TARGETS_INVALID for nonexistent file', () => {
  const d = tmpDir();
  assert.throws(
    () => loadInstallTargets(d, 'nonexistent'),
    { code: 'INSTALL_TARGETS_INVALID' }
  );
});

test('loadInstallTargets: handles JSON with line comments (claude adapter)', () => {
  const d = tmpDir();
  const raw = `{
  "schema": "soma-install-targets/v1",
  "tool": "claude",
  // TODO: future entries
  "entries": []
}`;
  const p = path.join(d, 'adapters', 'claude', 'install-targets.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, raw);
  const result = loadInstallTargets(d, 'claude');
  assert.equal(result.entries.length, 0);
});

// --- listAdapters ---

test('listAdapters: returns adapter directory names excluding _global', () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(d, 'adapters', 'claude'), { recursive: true });
  fs.mkdirSync(path.join(d, 'adapters', '_global'), { recursive: true });
  const adapters = listAdapters(d);
  assert.ok(adapters.includes('codex'));
  assert.ok(adapters.includes('claude'));
  assert.ok(!adapters.includes('_global'));
});

test('listAdapters: returns empty array when adapters dir missing', () => {
  const d = tmpDir();
  const adapters = listAdapters(d);
  assert.deepEqual(adapters, []);
});
