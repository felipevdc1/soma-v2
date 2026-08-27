'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRawArguments } = require('../entry/raw-arguments.cjs');

test('raw argument parser preserves shell metacharacters as ordinary objective text', () => {
  assert.deepEqual(
    parseRawArguments("build 'a $() ; | `backtick`' --project \"/tmp/naïve path\""),
    { mode: 'start', objective: 'build a $() ; | `backtick`', project: '/tmp/naïve path' }
  );
});

test('raw argument parser supports help, status, start, and resume public forms', () => {
  assert.deepEqual(parseRawArguments('--help'), { mode: 'help' });
  assert.deepEqual(parseRawArguments('--status --project /tmp/project'), { mode: 'status', project: '/tmp/project' });
  assert.deepEqual(parseRawArguments('ship it'), { mode: 'start', objective: 'ship it', project: undefined });
  assert.deepEqual(parseRawArguments('--resume run-42 --project /tmp/project'), { mode: 'resume', runId: 'run-42', project: '/tmp/project' });
  assert.deepEqual(parseRawArguments('--resume'), { mode: 'resume', runId: undefined, project: undefined });
});

test('raw argument parser rejects malformed quotes, unknown or duplicate flags, and conflicting modes', () => {
  for (const input of [
    "start 'unterminated",
    '--bogus',
    '--status --status',
    '--help --project /tmp/project',
    '--resume run-42 --status',
    'objective --resume run-42',
    '--project /tmp/project',
  ]) {
    assert.throws(() => parseRawArguments(input), { code: 'INVALID_ARGUMENTS' }, input);
  }
});
