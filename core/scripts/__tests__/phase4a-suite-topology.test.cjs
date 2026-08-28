'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PACKAGE_JSON = require(path.join(REPO_ROOT, 'package.json'));
const SERIAL_VALIDATOR = 'core/scripts/__tests__/phase4a-historical-oracle-validator.serial.cjs';
const SERIAL_ORACLE = 'core/scripts/__tests__/phase4a-historical-oracle.serial.cjs';
const SERIAL_SCRIPT = 'test:phase4a-historical-oracle';
const PHASE4A_REGRESSION = path.join(__dirname, 'phase4a-regression.test.cjs');
const HISTORICAL_ORACLE_NAME = 'phase4a-regression: fixed Phase 2+3 fixture baseline still passes';

test('phase4a suite topology: default discovery excludes serial-only tests and its serial command owns them in order', () => {
  const serialCommand = PACKAGE_JSON.scripts[SERIAL_SCRIPT];
  const count = filename => serialCommand.split(filename).length - 1;

  assert.equal(fs.existsSync(path.join(REPO_ROOT, SERIAL_VALIDATOR)), true, 'validator tests must live outside the default *.test.cjs discovery');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, SERIAL_ORACLE)), true, 'historical oracle must live outside the default *.test.cjs discovery');
  assert.equal(serialCommand, `node --test --test-concurrency=1 ${SERIAL_VALIDATOR} && node --test --test-concurrency=1 ${SERIAL_ORACLE}`);
  assert.equal(count(SERIAL_VALIDATOR), 1, 'validator must appear exactly once in the serial command');
  assert.equal(count(SERIAL_ORACLE), 1, 'historical oracle must appear exactly once in the serial command');
  assert.ok(serialCommand.indexOf(SERIAL_VALIDATOR) < serialCommand.indexOf(SERIAL_ORACLE), 'validator must run before the historical oracle');
  assert.match(serialCommand, / && /, 'serial command must compose stages deterministically');
  assert.match(PACKAGE_JSON.scripts.test, /core\/scripts\/__tests__\/\*\.test\.cjs/);
  assert.doesNotMatch(PACKAGE_JSON.scripts.test, /phase4a-historical-oracle-validator\.serial\.cjs/);
  assert.doesNotMatch(PACKAGE_JSON.scripts.test, /phase4a-historical-oracle\.serial\.cjs/);
  assert.doesNotMatch(fs.readFileSync(PHASE4A_REGRESSION, 'utf8'), new RegExp(HISTORICAL_ORACLE_NAME));
});
