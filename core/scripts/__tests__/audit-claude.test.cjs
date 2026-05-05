'use strict';
// audit-claude.test.cjs — T-07: unit tests for audit-claude.cjs
// @spec AC-05, AC-06, AC-07, AC-08, AC-15

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { invokeClaude, buildPrompt, interpolateTemplate } = require('../lib/audit-claude.cjs');

const BASE_MODULE = {
  path: '/tmp/test-module.cjs',
  loc: 150,
  exports: ['runCommand', 'dryRun'],
  export_signatures: ['function runCommand(opts)', 'function dryRun(opts)'],
  header_comment: '// test-module.cjs\n// fake CLI module for testing',
  recent_commits: [
    { sha: 'abc1234', date: '2026-05-03', subject: 'Phase 4b: apply mode' },
    { sha: 'def5678', date: '2026-05-01', subject: 'Initial commit' },
  ],
  test_count: 3,
  help_text: 'Usage: test-module [--run] [--dry]\n  --run  Execute\n  --dry  Dry run',
};

// ---- interpolateTemplate ----

test('interpolateTemplate: replaces scalar fields', () => {
  const tmpl = 'Path: {{module.path}}\nLOC: {{module.loc}}';
  const result = interpolateTemplate(tmpl, { module: { path: '/foo/bar.cjs', loc: 42 } });
  assert.equal(result, 'Path: /foo/bar.cjs\nLOC: 42');
});

test('interpolateTemplate: handles array sections', () => {
  const tmpl = '{{#module.exports}}- {{.}}\n{{/module.exports}}';
  const result = interpolateTemplate(tmpl, { module: { exports: ['foo', 'bar'] } });
  assert.ok(result.includes('- foo'), 'must include foo');
  assert.ok(result.includes('- bar'), 'must include bar');
});

test('interpolateTemplate: empty array section returns empty string', () => {
  const tmpl = '{{#module.exports}}- {{.}}\n{{/module.exports}}';
  const result = interpolateTemplate(tmpl, { module: { exports: [] } });
  assert.equal(result.trim(), '');
});

test('interpolateTemplate: handles object array sections', () => {
  const tmpl = '{{#module.recent_commits}}- {{sha}} {{date}} — {{subject}}\n{{/module.recent_commits}}';
  const result = interpolateTemplate(tmpl, {
    module: {
      recent_commits: [
        { sha: 'abc1234', date: '2026-05-03', subject: 'test commit' },
      ],
    },
  });
  assert.ok(result.includes('abc1234'), 'sha present');
  assert.ok(result.includes('test commit'), 'subject present');
});

// ---- buildPrompt (AC-15) ----

test('AC-15: buildPrompt includes module path', () => {
  const prompt = buildPrompt(BASE_MODULE);
  assert.ok(prompt.includes(BASE_MODULE.path), 'prompt must include module path');
});

test('AC-15: buildPrompt includes LOC', () => {
  const prompt = buildPrompt(BASE_MODULE);
  assert.ok(prompt.includes(String(BASE_MODULE.loc)), 'prompt must include LOC');
});

test('AC-15: buildPrompt includes export signatures (allowed)', () => {
  const prompt = buildPrompt(BASE_MODULE);
  for (const sig of BASE_MODULE.export_signatures) {
    assert.ok(prompt.includes(sig), `prompt must include export signature: ${sig}`);
  }
});

test('AC-15: buildPrompt includes commit subjects', () => {
  const prompt = buildPrompt(BASE_MODULE);
  for (const commit of BASE_MODULE.recent_commits) {
    assert.ok(prompt.includes(commit.sha), `prompt must include commit sha ${commit.sha}`);
    assert.ok(prompt.includes(commit.subject), `prompt must include commit subject`);
  }
});

test('AC-15: buildPrompt includes help_text', () => {
  const prompt = buildPrompt(BASE_MODULE);
  assert.ok(prompt.includes('Usage: test-module'), 'prompt must include help_text');
});

// ---- invokeClaude ----

test('AC-07: invokeClaude returns CLAUDE_CLI_NOT_FOUND when which fails', () => {
  const result = invokeClaude(BASE_MODULE, {
    spawnFn: (cmd) => ({ status: cmd === 'which' ? 1 : 1, stdout: '', stderr: '', signal: null, error: null }),
  });
  assert.equal(result.used, false);
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_NOT_FOUND');
});

test('AC-06: invokeClaude returns capabilities/bugs/etc on success', () => {
  const mockResult = {
    status: 0, signal: null, error: null,
    stdout: JSON.stringify({
      type: 'result',
      result: JSON.stringify({
        capabilities: ['run mode', 'dry mode'],
        bugs: [{ description: 'edge case', severity: 'low', source: 'commit' }],
        recent_changes: ['added run mode'],
        recommended_spec_scope: 'Focus on edge cases',
      }),
    }),
    stderr: '',
  };

  const result = invokeClaude(BASE_MODULE, {
    spawnFn: (cmd) => cmd === 'which'
      ? { status: 0, stdout: '/usr/bin/claude\n', stderr: '', signal: null, error: null }
      : mockResult,
  });

  assert.equal(result.used, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities, ['run mode', 'dry mode']);
  assert.ok(Array.isArray(result.bugs));
  assert.equal(result.bugs[0].severity, 'low');
  assert.ok(Array.isArray(result.recent_changes));
  assert.equal(typeof result.recommended_spec_scope, 'string');
});

test('AC-08: CLAUDE_CLI_TIMEOUT on SIGTERM', () => {
  const result = invokeClaude(BASE_MODULE, {
    spawnFn: (cmd) => cmd === 'which'
      ? { status: 0, stdout: '/usr/bin/claude\n', stderr: '', signal: null, error: null }
      : { status: null, signal: 'SIGTERM', error: null, stdout: '', stderr: '' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_TIMEOUT');
});

test('AC-08: CLAUDE_CLI_FAILED on non-zero exit', () => {
  const result = invokeClaude(BASE_MODULE, {
    spawnFn: (cmd) => cmd === 'which'
      ? { status: 0, stdout: '/usr/bin/claude\n', stderr: '', signal: null, error: null }
      : { status: 2, signal: null, error: null, stdout: '', stderr: 'auth error' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_FAILED');
});

test('AC-08: CLAUDE_CLI_INVALID_JSON on non-JSON stdout', () => {
  const result = invokeClaude(BASE_MODULE, {
    spawnFn: (cmd) => cmd === 'which'
      ? { status: 0, stdout: '/usr/bin/claude\n', stderr: '', signal: null, error: null }
      : { status: 0, signal: null, error: null, stdout: 'not json!', stderr: '' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_INVALID_JSON');
});

test('AC-08: CLAUDE_CLI_INVALID_JSON when inner JSON missing required keys', () => {
  const result = invokeClaude(BASE_MODULE, {
    spawnFn: (cmd) => cmd === 'which'
      ? { status: 0, stdout: '/usr/bin/claude\n', stderr: '', signal: null, error: null }
      : {
          status: 0, signal: null, error: null,
          stdout: JSON.stringify({ type: 'result', result: JSON.stringify({ capabilities: [] }) }),
          stderr: '',
        },
  });
  assert.equal(result.ok, false);
  assert.equal(result.warning.code, 'CLAUDE_CLI_INVALID_JSON');
});
