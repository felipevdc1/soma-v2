'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE = path.resolve(__dirname, '..', '..');
const ADAPTER = path.join(CORE, 'adapters', 'claude', 'commands', 'soma-run.md');
const REFERENCE = path.join(CORE, 'adapters', 'claude', 'references', 'soma-run-orchestration.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('thin adapter transports raw arguments only through the structured envelope', () => {
  const source = read(ADAPTER);
  assert.ok(Buffer.byteLength(source, 'utf8') <= 8000, `adapter has ${Buffer.byteLength(source, 'utf8')} bytes`);
  assert.equal((source.match(/\$ARGUMENTS/g) || []).length, 1);
  for (const block of source.matchAll(/```bash\n([\s\S]*?)```/g)) {
    assert.doesNotMatch(block[1], /\$ARGUMENTS/);
  }
  assert.match(source, /"rawArguments"\s*:\s*the exact `\$ARGUMENTS` value/);
  assert.doesNotMatch(source, /UserPromptExpansion|eval\b|bash\s+-c/);
});

test('adapter uses fixed prepare, consume and abort shapes with validated runtime identities', () => {
  const source = read(ADAPTER);
  assert.match(source, /entry prepare --session "\$\{CLAUDE_SESSION_ID\}"/);
  assert.match(source, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}\$/);
  assert.match(source, /\^\[a-f0-9\]\{32\}\$/);
  assert.match(source, /entry consume --session "\$\{SOMA_SESSION_ID\}" --request-id "\$\{SOMA_REQUEST_ID\}" --owner-pid "\$PPID"/);
  assert.match(source, /entry abort --session "\$\{SOMA_SESSION_ID\}" --request-id "\$\{SOMA_REQUEST_ID\}"/);
  assert.match(source, /finally/i);
  assert.match(source, /Write tool/);
});

test('adapter stops terminal results and lazy-loads orchestration exactly once for READY states', () => {
  const source = read(ADAPTER);
  const referenceName = 'references/soma-run-orchestration.md';
  assert.equal((source.match(new RegExp(referenceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.match(source, /HELP_SHOWN/);
  assert.match(source, /STATUS_SHOWN/);
  assert.match(source, /RESUME_DRIFT/);
  assert.match(source, /READY/);
  assert.match(source, /RESUME_READY/);
  assert.match(source, /Do not call Agent or Read the orchestration reference for a terminal result/);
});

test('orchestration delegates baseline, bounds records and checkpoints every safe transition', () => {
  const source = read(REFERENCE);
  assert.match(source, /baselineRequired[^\n]*first executor dispatch[^\n]*`T-BASELINE`/i);
  assert.match(source, /coordinator never executes project code/i);
  assert.match(source, /dispatch-record begin[^\n]*before every agent/i);
  assert.match(source, /dispatch-record end[^\n]*before any transition/i);
  assert.match(source, /prompt[^\n]*8,000 bytes/i);
  assert.match(source, /conversational return[^\n]*4,000 bytes/i);
  assert.match(source, /checkpoint after every safe transition/i);
  assert.match(source, /PAUSED_DIAGNOSTIC/);
});

test('all planned reviewers inspect one immutable candidate before the only correction', () => {
  const source = read(REFERENCE);
  assert.match(source, /same immutable candidate commit/i);
  assert.match(source, /wait for every planned reviewer/i);
  assert.match(source, /consolidate all spec and quality findings/i);
  assert.match(source, /never start the correction after the first review/i);
  assert.match(source, /single correction attempt/i);
});
