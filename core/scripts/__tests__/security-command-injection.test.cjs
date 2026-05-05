/**
 * security-command-injection.test.cjs — T-20
 * @spec AC-09..AC-11 + Security NFR
 * AD-06: command injection prevention.
 * Strings with shell metacharacters (;, &, |, $, backticks) in
 * test_command/build_command/typecheck_command/lint_command must be rejected.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-sec-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapWithTestCommand(dir, testCommand) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  // Escape the command for YAML (simple single-quote around)
  const escaped = testCommand.replace(/'/g, "''");
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "security-test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    `test_command: '${escaped}'`,
    '---',
    '',
    '# Security Test Project',
  ].join('\n'), 'utf8');
  return dir;
}

function markerFile() {
  return path.join(os.tmpdir(), `soma-injection-test-${Date.now()}`);
}

test('Security: test_command with ";" semicolon is rejected (injection prevention)', () => {
  const marker = markerFile();
  const dir = bootstrapWithTestCommand(tmpProject(), `true; touch ${marker}`);
  runDoctor(['--foundation-check', '--json'], dir);
  // The marker file must NOT have been created
  assert.ok(!fs.existsSync(marker), `SECURITY VIOLATION: injection command was executed. Marker file created: ${marker}`);
});

test('Security: test_command with "&" is rejected', () => {
  const marker = markerFile();
  const dir = bootstrapWithTestCommand(tmpProject(), `true & touch ${marker}`);
  runDoctor(['--foundation-check', '--json'], dir);
  assert.ok(!fs.existsSync(marker), `SECURITY VIOLATION: injection via & was executed. Marker: ${marker}`);
});

test('Security: test_command with "|" pipe is rejected', () => {
  const marker = markerFile();
  const dir = bootstrapWithTestCommand(tmpProject(), `true | touch ${marker}`);
  runDoctor(['--foundation-check', '--json'], dir);
  assert.ok(!fs.existsSync(marker), `SECURITY VIOLATION: injection via | was executed. Marker: ${marker}`);
});

test('Security: test_command with "$" variable expansion is rejected', () => {
  const dir = bootstrapWithTestCommand(tmpProject(), 'node -e "console.log($SECRET)"');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  // Should either reject the command with error OR run it via shell:false (argv split)
  // Either way, it should NOT expand shell variables
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  // Criterion should be skipped (rejected) or fail (command failed safely) — NOT pass via shell expansion
  assert.ok(
    c6.status === 'skipped' || c6.status === 'fail',
    `Expected criterion 6 to be skipped or fail for injection attempt. Got: ${JSON.stringify(c6)}`
  );
});

test('Security: test_command with newline is rejected', () => {
  const marker = markerFile();
  const dir = bootstrapWithTestCommand(tmpProject(), `true\ntouch ${marker}`);
  runDoctor(['--foundation-check', '--json'], dir);
  assert.ok(!fs.existsSync(marker), `SECURITY VIOLATION: newline injection was executed. Marker: ${marker}`);
});

test('Security: clean test_command "true" is accepted and runs', () => {
  const dir = bootstrapWithTestCommand(tmpProject(), 'true');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  // Clean command should pass
  assert.equal(c6.status, 'pass', `Expected clean command to pass. Got: ${JSON.stringify(c6)}`);
});

test('Security: test_command with args "node --version" is accepted (whitespace split)', () => {
  const dir = bootstrapWithTestCommand(tmpProject(), 'node --version');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  assert.equal(c6.status, 'pass', `Expected multi-word clean command to pass. Got: ${JSON.stringify(c6)}`);
});
