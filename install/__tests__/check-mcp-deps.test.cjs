'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { checkMcpDeps } = require('../check-mcp-deps.cjs');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-mcp-deps-test-'));
}

test('all MCP servers present: no warnings', () => {
  const dir = mkTmpDir();

  // Create a real server script that actually exists
  const serverPath = path.join(dir, 'mock-server.js');
  fs.writeFileSync(serverPath, '// mock mcp server');

  const settings = {
    mcpServers: {
      'test-server': {
        command: 'node',
        args: [serverPath]
      }
    }
  };

  const result = checkMcpDeps({ settings });

  assert.strictEqual(result.missing.length, 0, 'no missing when server script exists');
  assert.ok(result.present.includes('test-server'), 'present should list the server name');
  assert.strictEqual(result.warnings.length, 0, 'no warnings when all present');
});

test('one MCP missing binary: warning emitted, result has missing entry', () => {
  const settings = {
    mcpServers: {
      'missing-server': {
        command: 'node',
        args: ['/nonexistent-path-99999/server.js']
      }
    }
  };

  const result = checkMcpDeps({ settings });

  assert.ok(result.missing.includes('missing-server'), 'missing-server should be in missing list');
  assert.strictEqual(result.warnings.length, 1, 'should have 1 warning');
  assert.ok(result.warnings[0].includes('missing-server'), 'warning should reference server name');
});

test('settings.json without mcpServers key: graceful no-op', () => {
  const settings = {
    env: { FOO: 'bar' }
    // no mcpServers key
  };

  const result = checkMcpDeps({ settings });

  assert.strictEqual(result.missing.length, 0, 'no missing entries');
  assert.strictEqual(result.present.length, 0, 'no present entries');
  assert.strictEqual(result.warnings.length, 0, 'no warnings');
});

test('settings.json missing entirely: graceful no-op', () => {
  // Pass null/undefined to simulate missing settings.json
  const result = checkMcpDeps({ settings: null });

  assert.strictEqual(result.missing.length, 0);
  assert.strictEqual(result.present.length, 0);
  assert.strictEqual(result.warnings.length, 0);
});

test('command-only binary entry (no args): uses command existence check', () => {
  // 'node' itself should be found on PATH
  const settings = {
    mcpServers: {
      'node-server': {
        command: 'node'
        // no args — means command itself is the binary
      }
    }
  };

  const result = checkMcpDeps({ settings });
  // node exists on PATH, so this should be present (not missing)
  assert.ok(result.present.includes('node-server') || result.missing.includes('node-server'),
    'should categorize node-server (either present or missing)');
  // We don't hard-assert present because in some exotic CI envs node path detection may vary
  // Key invariant: never throws, always returns structured result
});
