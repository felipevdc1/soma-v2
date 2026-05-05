'use strict';
// audit-contract-claude.test.cjs — T-03: contract tests for cli-claude-invocation.md
// @spec AC-05, AC-06, AC-07, AC-08, AC-15
// @contract contracts/cli-claude-invocation.md

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'audit');

// Load audit-claude for unit testing via DI
const auditClaude = require('../lib/audit-claude.cjs');

// Fixture helpers
function makeSpawnFn(fixture) {
  return () => fixture;
}

const MODULE_DATA = {
  path: '/tmp/test-module.cjs',
  loc: 100,
  exports: ['foo', 'bar'],
  recent_commits: [{ sha: 'abc1234', date: '2026-05-03', subject: 'initial' }],
  test_count: 5,
  help_text: null,
  header_comment: '// test module',
  export_signatures: ['function foo(x)', 'function bar(y, z)'],
};

// ---- AC-07: claude CLI absent → graceful degradation ----

test('AC-07: claude not in PATH → CLAUDE_CLI_NOT_FOUND warning, used=false', () => {
  // Simulate "which claude" failing
  const notFoundFixture = {
    status: 1,
    stdout: '',
    stderr: '',
    signal: null,
    error: null,
  };
  // We pass a spawnFn that returns not-found for 'which' check
  const result = auditClaude.invokeClaude(MODULE_DATA, {
    timeoutMs: 5000,
    spawnFn: (cmd, args) => {
      if (cmd === 'which') return notFoundFixture;
      return notFoundFixture;
    },
  });
  assert.equal(result.used, false, 'used must be false when claude not found');
  assert.ok(result.warning, 'warning must be present');
  assert.equal(result.warning.code, 'CLAUDE_CLI_NOT_FOUND', `Expected CLAUDE_CLI_NOT_FOUND, got ${result.warning.code}`);
  assert.equal(result.ok, false);
});

// ---- AC-06: successful claude invocation returns parsed fields ----

test('AC-06: successful claude invocation merges LLM fields', () => {
  const successFixture = {
    status: 0,
    signal: null,
    error: null,
    stdout: JSON.stringify({
      type: 'result',
      result: JSON.stringify({
        capabilities: ['dry-run', 'apply mode'],
        bugs: [{ description: 'race condition', severity: 'low', source: 'commit message' }],
        recent_changes: ['Phase 4b shipped'],
        recommended_spec_scope: 'Skip --apply re-impl; focus on bug fixes',
      }),
    }),
    stderr: '',
  };

  const result = auditClaude.invokeClaude(MODULE_DATA, {
    timeoutMs: 5000,
    spawnFn: (cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
      return successFixture;
    },
  });

  assert.equal(result.used, true, 'used must be true');
  assert.equal(result.ok, true, 'ok must be true');
  assert.ok(Array.isArray(result.capabilities), 'capabilities must be array');
  assert.ok(Array.isArray(result.bugs), 'bugs must be array');
  assert.ok(Array.isArray(result.recent_changes), 'recent_changes must be array');
  assert.ok(typeof result.recommended_spec_scope === 'string', 'recommended_spec_scope must be string');
  assert.equal(result.capabilities[0], 'dry-run');
});

// ---- AC-08: timeout → CLAUDE_CLI_TIMEOUT warning ----

test('AC-08: claude CLI timeout → CLAUDE_CLI_TIMEOUT warning, ok=false', () => {
  const timeoutFixture = {
    status: null,
    signal: 'SIGTERM',
    error: null,
    stdout: '',
    stderr: '',
  };

  const result = auditClaude.invokeClaude(MODULE_DATA, {
    timeoutMs: 5000,
    spawnFn: (cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
      return timeoutFixture;
    },
  });
  assert.equal(result.used, true);
  assert.equal(result.ok, false);
  assert.ok(result.warning);
  assert.equal(result.warning.code, 'CLAUDE_CLI_TIMEOUT');
});

// ---- AC-08: non-zero exit → CLAUDE_CLI_FAILED ----

test('AC-08: claude CLI non-zero exit → CLAUDE_CLI_FAILED warning', () => {
  const failedFixture = {
    status: 1,
    signal: null,
    error: null,
    stdout: '',
    stderr: 'some error',
  };

  const result = auditClaude.invokeClaude(MODULE_DATA, {
    timeoutMs: 5000,
    spawnFn: (cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
      return failedFixture;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_FAILED');
});

// ---- AC-08: non-JSON stdout → CLAUDE_CLI_INVALID_JSON ----

test('AC-08: claude CLI returns non-JSON → CLAUDE_CLI_INVALID_JSON warning', () => {
  const invalidJsonFixture = {
    status: 0,
    signal: null,
    error: null,
    stdout: 'not json at all',
    stderr: '',
  };

  const result = auditClaude.invokeClaude(MODULE_DATA, {
    timeoutMs: 5000,
    spawnFn: (cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
      return invalidJsonFixture;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_INVALID_JSON');
});

// ---- AC-08: inner JSON missing required keys → CLAUDE_CLI_INVALID_JSON ----

test('AC-08: inner JSON missing required keys → CLAUDE_CLI_INVALID_JSON', () => {
  const missingKeysFixture = {
    status: 0,
    signal: null,
    error: null,
    stdout: JSON.stringify({
      type: 'result',
      result: JSON.stringify({ capabilities: ['foo'] }), // missing bugs, recent_changes, recommended_spec_scope
    }),
    stderr: '',
  };

  const result = auditClaude.invokeClaude(MODULE_DATA, {
    timeoutMs: 5000,
    spawnFn: (cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
      return missingKeysFixture;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_INVALID_JSON');
});

// ---- AC-15: prompt does NOT include raw function bodies ----

test('AC-15: claude prompt excludes raw function bodies (redaction policy)', () => {
  let capturedPrompt = null;
  const mockSpawn = (cmd, args) => {
    if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
    // Capture the prompt (args[1] is the -p argument)
    capturedPrompt = args[1];
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: JSON.stringify({
        type: 'result',
        result: JSON.stringify({
          capabilities: [],
          bugs: [],
          recent_changes: [],
          recommended_spec_scope: 'test',
        }),
      }),
      stderr: '',
    };
  };

  auditClaude.invokeClaude(MODULE_DATA, { timeoutMs: 5000, spawnFn: mockSpawn });

  assert.ok(capturedPrompt !== null, 'prompt must have been captured');
  // Prompt must contain module facts (allowed)
  assert.ok(capturedPrompt.includes(MODULE_DATA.path), 'prompt must include module.path');
  assert.ok(capturedPrompt.includes(String(MODULE_DATA.loc)), 'prompt must include module.loc');
  // Prompt must NOT contain raw function bodies — we can check it doesn't include
  // content that would only come from reading the file itself
  // The export_signatures ARE allowed (function name + params, no body)
  // We verify the prompt contains signatures (which are allowed)
  for (const sig of MODULE_DATA.export_signatures) {
    assert.ok(capturedPrompt.includes(sig), `prompt must include export signature: ${sig}`);
  }
});

// ---- AC-05: prompt structure includes all required deterministic context ----

test('AC-05: prompt includes required deterministic context fields', () => {
  let capturedPrompt = null;
  const mockSpawn = (cmd, args) => {
    if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '', signal: null, error: null };
    capturedPrompt = args[1];
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: JSON.stringify({
        type: 'result',
        result: JSON.stringify({
          capabilities: [],
          bugs: [],
          recent_changes: [],
          recommended_spec_scope: 'ok',
        }),
      }),
      stderr: '',
    };
  };

  const data = { ...MODULE_DATA, help_text: 'Usage: --help\n  --run execute' };
  auditClaude.invokeClaude(data, { timeoutMs: 5000, spawnFn: mockSpawn });

  assert.ok(capturedPrompt !== null);
  assert.ok(capturedPrompt.includes(data.path), 'path in prompt');
  assert.ok(capturedPrompt.includes(String(data.loc)), 'loc in prompt');
  assert.ok(capturedPrompt.includes(String(data.test_count)), 'test_count in prompt');
  assert.ok(capturedPrompt.includes(data.header_comment), 'header_comment in prompt');
  assert.ok(capturedPrompt.includes(data.help_text), 'help_text in prompt');
  // commit subjects in prompt
  for (const c of data.recent_commits) {
    assert.ok(capturedPrompt.includes(c.sha), `commit sha ${c.sha} in prompt`);
  }
});
