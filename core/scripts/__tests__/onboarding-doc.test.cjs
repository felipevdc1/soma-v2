/**
 * onboarding-doc.test.cjs — T-14 / AC-12
 * Validates onboarding.md exists with required sections.
 *
 * @spec AC-12
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME_REAL = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const ONBOARDING_PATH = path.join(SOMA_HOME_REAL, 'docs', 'onboarding.md');

test('AC-12: onboarding.md exists at docs/onboarding.md', () => {
  assert.ok(
    fs.existsSync(ONBOARDING_PATH),
    `onboarding.md not found at ${ONBOARDING_PATH}`
  );
});

test('AC-12: onboarding.md has Prerequisites section', () => {
  const content = fs.readFileSync(ONBOARDING_PATH, 'utf8');
  assert.ok(
    content.includes('## Prerequisites'),
    'onboarding.md missing ## Prerequisites section'
  );
});

test('AC-12: onboarding.md has Quickstart section', () => {
  const content = fs.readFileSync(ONBOARDING_PATH, 'utf8');
  assert.ok(
    content.includes('## Quickstart'),
    'onboarding.md missing ## Quickstart section'
  );
});

test('AC-12: onboarding.md has Troubleshooting section', () => {
  const content = fs.readFileSync(ONBOARDING_PATH, 'utf8');
  assert.ok(
    content.includes('## Troubleshooting'),
    'onboarding.md missing ## Troubleshooting section'
  );
});

test('AC-12: onboarding.md has ≥3 error scenarios in Troubleshooting', () => {
  const content = fs.readFileSync(ONBOARDING_PATH, 'utf8');
  // Count ### subsections within Troubleshooting section
  const troubleshootingStart = content.indexOf('## Troubleshooting');
  assert.ok(troubleshootingStart >= 0, '## Troubleshooting not found');
  // Find end of troubleshooting section (next ## heading or end of file)
  let troubleshootingEnd = content.length;
  const nextSection = content.indexOf('\n## ', troubleshootingStart + 1);
  if (nextSection >= 0) troubleshootingEnd = nextSection;
  const troubleshootingContent = content.slice(troubleshootingStart, troubleshootingEnd);
  // Count ### subsections
  const subSections = (troubleshootingContent.match(/^### /gm) || []).length;
  assert.ok(subSections >= 3, `Expected ≥3 error scenarios (### headings) in Troubleshooting. Found: ${subSections}`);
});

test('AC-12: onboarding.md Quickstart has clone→bootstrap commands', () => {
  const content = fs.readFileSync(ONBOARDING_PATH, 'utf8');
  const quickstartStart = content.indexOf('## Quickstart');
  assert.ok(quickstartStart >= 0, '## Quickstart not found');
  let quickstartEnd = content.length;
  const nextSection = content.indexOf('\n## ', quickstartStart + 1);
  if (nextSection >= 0) quickstartEnd = nextSection;
  const quickstartContent = content.slice(quickstartStart, quickstartEnd);
  assert.ok(
    quickstartContent.includes('bootstrap'),
    'Quickstart section must include bootstrap command reference'
  );
  assert.ok(
    quickstartContent.includes('git clone') || quickstartContent.includes('clone'),
    'Quickstart section must reference clone step'
  );
});

test('AC-12: onboarding.md has ≥80 lines', () => {
  const content = fs.readFileSync(ONBOARDING_PATH, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount >= 80, `Expected ≥80 lines but got ${lineCount}`);
});
