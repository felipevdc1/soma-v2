'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FROZEN_LIBS = {
  'anchored-blocks.cjs': '6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f',
  'manifest.cjs':        '08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462',
  'template-engine.cjs': 'f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b',
};

test('frozen libs: shasums match baseline (Spec 013 AC-17)', () => {
  for (const [file, expectedSha] of Object.entries(FROZEN_LIBS)) {
    const fpath = path.join(REPO_ROOT, 'core/scripts/lib', file);
    const content = fs.readFileSync(fpath);
    const actualSha = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(actualSha, expectedSha, `frozen lib ${file} drift detected`);
  }
});
