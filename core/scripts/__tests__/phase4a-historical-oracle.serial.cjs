'use strict';
// Historical Phase 2+3 baseline oracle. This file is intentionally outside
// default *.test.cjs discovery and runs only through the serial npm script.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { historicalOracleFiles, validateHistoricalOracle } = require('../lib/phase4a-historical-oracle-validator.cjs');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOMA_HOME = process.env.SOMA_HOME || path.join(REPO_ROOT, 'core');
const TESTS_DIR = path.join(SOMA_HOME, 'scripts', '__tests__');
const NODE_BIN = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim() || 'node';

const PHASE2_AND_3_TEST_FILES = historicalOracleFiles(TESTS_DIR);

function runTestsBridge(files) {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  env.FORCE_COLOR = '0';
  const result = spawnSync(NODE_BIN, ['--test', '--test-concurrency=1', ...files], {
    encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024, env,
  });
  const raw = (result.stdout || '') + (result.stderr || '');
  const lastTotal = field => {
    const matches = [...raw.matchAll(new RegExp(`^# ${field} (\\d+)$`, 'gm'))];
    return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
  };
  return {
    exitCode: result.status,
    signal: result.signal || null,
    tests: lastTotal('tests'),
    pass: lastTotal('pass'),
    fail: lastTotal('fail'),
    skipped: lastTotal('skipped'),
    cancelled: lastTotal('cancelled'),
    todo: lastTotal('todo'),
    raw,
  };
}

test('phase4a-regression: fixed Phase 2+3 fixture baseline still passes', { timeout: 300000 }, () => {
  validateHistoricalOracle({ expectedFiles: PHASE2_AND_3_TEST_FILES, fileExists: fs.existsSync, testsDirectory: TESTS_DIR });
  const result = runTestsBridge(PHASE2_AND_3_TEST_FILES);
  validateHistoricalOracle({ expectedFiles: PHASE2_AND_3_TEST_FILES, fileExists: fs.existsSync, result, testsDirectory: TESTS_DIR });
});
