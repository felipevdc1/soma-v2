/**
 * ac-12-criterion-9-tech-stack.test.cjs — T-14
 * @spec AC-12
 * Criterion 9: "tech stack bem definida"
 * Pass if project.md tech_stack array exists with ≥1 entry.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac12-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapBase(dir, techStack) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });

  // Build a project.md with tech_stack in multi-line YAML style
  let techStackYaml = '';
  if (techStack && techStack.length > 0) {
    techStackYaml = '\ntech_stack:\n' + techStack.map(e => `  - name: "${e.name}"\n    version: "${e.version}"\n    role: "${e.role}"`).join('\n');
  }

  const content = [
    '---',
    'schema: soma-project/v1',
    'name: "test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    ...(techStack ? [`tech_stack: ${JSON.stringify(techStack)}`] : []),
    '---',
    '',
    '# Test Project',
  ].join('\n');
  fs.writeFileSync(path.join(somaDir, 'project.md'), content, 'utf8');
  return dir;
}

test('AC-12 criterion 9 PASS: tech_stack array with ≥1 entry', () => {
  const dir = bootstrapBase(tmpProject(), [
    { name: 'Node.js', version: '22', role: 'runtime' },
    { name: 'TypeScript', version: '5', role: 'language' },
  ]);
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c9 = out.criteria.find(c => c.id === 9);
  assert.equal(c9.status, 'pass', `Expected criterion 9 pass, got: ${JSON.stringify(c9)}`);
  assert.ok(c9.message.includes('2') || c9.message.includes('Node.js') || c9.message.includes('entry'), `Expected count in message. Got: ${c9.message}`);
});

test('AC-12 criterion 9 FAIL: tech_stack absent from project.md', () => {
  const dir = bootstrapBase(tmpProject(), null); // no tech_stack
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c9 = out.criteria.find(c => c.id === 9);
  assert.equal(c9.status, 'fail', `Expected criterion 9 fail when tech_stack absent, got: ${JSON.stringify(c9)}`);
});

test('AC-12 criterion 9 FAIL: tech_stack empty array', () => {
  const dir = bootstrapBase(tmpProject(), []); // empty tech_stack
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c9 = out.criteria.find(c => c.id === 9);
  assert.equal(c9.status, 'fail', `Expected criterion 9 fail for empty tech_stack, got: ${JSON.stringify(c9)}`);
});

test('AC-12 criterion 9 PASS: tech_stack with single entry', () => {
  const dir = bootstrapBase(tmpProject(), [
    { name: 'Node.js', version: '22', role: 'runtime' },
  ]);
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c9 = out.criteria.find(c => c.id === 9);
  assert.equal(c9.status, 'pass', `Expected criterion 9 pass with 1 entry, got: ${JSON.stringify(c9)}`);
});
