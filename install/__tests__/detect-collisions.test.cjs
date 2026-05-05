'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { detectCollisions } = require('../detect-collisions.cjs');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detect-collisions-test-'));
}

// Minimal SOMA list (simulates what soma-hooks-map.json basenames are)
const SOMA_BASENAMES = [
  'thermal-guard',
  'pre-commit-gate',
  'spec-completeness-gate',
  'cognitive-gate'
];

function writeHookFile(dir, basename, content) {
  const filePath = path.join(dir, `${basename}.cjs`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function sha256Content(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

test('user hook NOT in SOMA list: not a collision', () => {
  const dir = mkTmpDir();
  // Write a file whose basename is NOT in SOMA list
  writeHookFile(dir, 'my-custom-hook', '// user custom hook');

  const collisions = detectCollisions(dir, SOMA_BASENAMES, {});
  assert.strictEqual(collisions.length, 0, 'user-only hook should not be a collision');
});

test('user hook in SOMA list with identical sha: not a collision', () => {
  const dir = mkTmpDir();
  const content = '// thermal-guard shipped content';
  writeHookFile(dir, 'thermal-guard', content);

  // somaShaSums maps basename → sha256 of shipped version
  const somaShaSums = {
    'thermal-guard': sha256Content(content)
  };

  const collisions = detectCollisions(dir, SOMA_BASENAMES, somaShaSums);
  assert.strictEqual(collisions.length, 0, 'identical sha means no user modification — no collision');
});

test('user hook in SOMA list with different sha: COLLISION reported', () => {
  const dir = mkTmpDir();
  const userContent = '// USER MODIFIED VERSION of thermal-guard';
  writeHookFile(dir, 'thermal-guard', userContent);

  const somaShaSums = {
    'thermal-guard': sha256Content('// thermal-guard ORIGINAL shipped content')
  };

  const collisions = detectCollisions(dir, SOMA_BASENAMES, somaShaSums);
  assert.strictEqual(collisions.length, 1, 'modified SOMA hook = collision');
  assert.ok(collisions[0].path.includes('thermal-guard.cjs'), 'collision path should include basename');
  assert.ok(collisions[0].reason, 'collision should include a reason string');
});

test('handles empty target directory', () => {
  const dir = mkTmpDir();
  const collisions = detectCollisions(dir, SOMA_BASENAMES, {});
  assert.strictEqual(collisions.length, 0, 'empty dir = no collisions');
});

test('handles missing SOMA list: throws clear error', () => {
  const dir = mkTmpDir();
  assert.throws(
    () => detectCollisions('/nonexistent-dir-99999', SOMA_BASENAMES, {}),
    (err) => {
      // Should throw — directory doesn't exist
      return err instanceof Error;
    },
    'should throw on missing target directory'
  );
});

test('multiple files: some collide, some do not', () => {
  const dir = mkTmpDir();

  // thermal-guard: user modified → COLLISION
  writeHookFile(dir, 'thermal-guard', '// user modified');
  // pre-commit-gate: identical → no collision
  const identicalContent = '// pre-commit-gate shipped';
  writeHookFile(dir, 'pre-commit-gate', identicalContent);
  // my-custom: not in SOMA list → no collision
  writeHookFile(dir, 'my-custom', '// user custom');

  const somaShaSums = {
    'thermal-guard': sha256Content('// thermal-guard ORIGINAL'),
    'pre-commit-gate': sha256Content(identicalContent)
  };

  const collisions = detectCollisions(dir, SOMA_BASENAMES, somaShaSums);
  assert.strictEqual(collisions.length, 1, 'only thermal-guard should collide');
  assert.ok(collisions[0].path.includes('thermal-guard'), 'collision is thermal-guard');
});
