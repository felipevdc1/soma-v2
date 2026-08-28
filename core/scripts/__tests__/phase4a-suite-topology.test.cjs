'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PACKAGE_JSON = require(path.join(REPO_ROOT, 'package.json'));
const SERIAL_ORACLE = 'core/scripts/__tests__/phase4a-historical-oracle.serial.cjs';
const SERIAL_SCRIPT = 'test:phase4a-historical-oracle';
const PHASE4A_REGRESSION = path.join(__dirname, 'phase4a-regression.test.cjs');
const HISTORICAL_ORACLE_NAME = 'phase4a-regression: fixed Phase 2+3 fixture baseline still passes';

test('phase4a suite topology: default discovery excludes the historical oracle and its serial command owns it', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, SERIAL_ORACLE)), true, 'historical oracle must live outside the default *.test.cjs discovery');
  assert.equal(PACKAGE_JSON.scripts[SERIAL_SCRIPT], `node --test --test-concurrency=1 ${SERIAL_ORACLE}`);
  assert.match(PACKAGE_JSON.scripts.test, /core\/scripts\/__tests__\/\*\.test\.cjs/);
  assert.doesNotMatch(PACKAGE_JSON.scripts.test, /phase4a-historical-oracle\.serial\.cjs/);
  assert.doesNotMatch(fs.readFileSync(PHASE4A_REGRESSION, 'utf8'), new RegExp(HISTORICAL_ORACLE_NAME));
});
