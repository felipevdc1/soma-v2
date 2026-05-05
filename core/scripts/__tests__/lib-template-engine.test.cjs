'use strict';
// @spec AC-05
// Unit tests for scripts/lib/template-engine.cjs
// Covers: substitution, throw on unresolved placeholder, ISO8601 format validation.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderTemplate, nowISO8601 } = require('../lib/template-engine.cjs');

// ---- renderTemplate tests ----

test('template-engine: substitutes single placeholder', () => {
  const result = renderTemplate('Hello {{NAME}}!', { NAME: 'World' });
  assert.equal(result, 'Hello World!');
});

test('template-engine: substitutes multiple different placeholders', () => {
  const result = renderTemplate('{{PROJECT_NAME}} at {{ISO8601_DATE}}', {
    PROJECT_NAME: 'my-project',
    ISO8601_DATE: '2026-05-01T12:00:00.000Z'
  });
  assert.equal(result, 'my-project at 2026-05-01T12:00:00.000Z');
});

test('template-engine: substitutes repeated placeholder (all occurrences)', () => {
  const result = renderTemplate('{{NAME}} loves {{NAME}}.', { NAME: 'Alice' });
  assert.equal(result, 'Alice loves Alice.');
});

test('template-engine: returns unchanged string when no placeholders present', () => {
  const result = renderTemplate('No placeholders here.', { FOO: 'bar' });
  assert.equal(result, 'No placeholders here.');
});

test('template-engine: substitutes PROJECT_NAME and ISO8601_DATE as used in real templates', () => {
  const template = `# {{PROJECT_NAME}} — Project Doc\ninitialized_at: "{{ISO8601_DATE}}"`;
  const result = renderTemplate(template, {
    PROJECT_NAME: 'soma-test',
    ISO8601_DATE: '2026-05-01T00:00:00.000Z'
  });
  assert.ok(result.includes('soma-test — Project Doc'));
  assert.ok(result.includes('2026-05-01T00:00:00.000Z'));
  assert.ok(!result.includes('{{'));
});

test('template-engine: throws TEMPLATE_PARSE_ERROR when placeholder remains unresolved', () => {
  assert.throws(
    () => renderTemplate('Hello {{MISSING_KEY}}!', { OTHER_KEY: 'value' }),
    (err) => {
      assert.equal(err.code, 'TEMPLATE_PARSE_ERROR');
      assert.ok(err.message.includes('{{MISSING_KEY}}'));
      return true;
    }
  );
});

test('template-engine: throws TEMPLATE_PARSE_ERROR even when some placeholders are resolved', () => {
  assert.throws(
    () => renderTemplate('{{KNOWN}} and {{UNKNOWN}}', { KNOWN: 'ok' }),
    (err) => {
      assert.equal(err.code, 'TEMPLATE_PARSE_ERROR');
      return true;
    }
  );
});

// ---- nowISO8601 tests ----

test('template-engine: nowISO8601 returns string matching ISO8601 UTC regex', () => {
  const ts = nowISO8601();
  assert.ok(typeof ts === 'string', 'nowISO8601 must return a string');
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  assert.match(ts, iso8601Regex, `"${ts}" does not match ISO8601 UTC format`);
});

test('template-engine: nowISO8601 returns a parseable date', () => {
  const ts = nowISO8601();
  const parsed = new Date(ts);
  assert.ok(!isNaN(parsed.getTime()), 'nowISO8601 must be a parseable date');
});

test('template-engine: nowISO8601 returns current time (within 5 seconds)', () => {
  const before = Date.now();
  const ts = nowISO8601();
  const after = Date.now();
  const parsed = new Date(ts).getTime();
  assert.ok(parsed >= before && parsed <= after + 5000, `nowISO8601 timestamp not recent: ${ts}`);
});
