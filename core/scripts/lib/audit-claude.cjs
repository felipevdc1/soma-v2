'use strict';
// audit-claude.cjs — SOMA audit claude CLI invoker (Spec 012 T-07)
// @spec AC-05, AC-06, AC-07, AC-08, AC-15

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function resolveTemplatePath() {
  // Try relative to this file first (works in scratch and in production)
  const relPath = path.join(__dirname, '..', '..', 'templates', 'audit-prompt.md');
  if (fs.existsSync(relPath)) return relPath;
  // Fallback to absolute home path
  const absPath = path.join(os.homedir(), '.soma-v2', 'templates', 'audit-prompt.md');
  if (fs.existsSync(absPath)) return absPath;
  return relPath; // will throw on readFileSync with meaningful error
}

/**
 * Simple template interpolation.
 * Supports: {{field}} and {{#array}}<block>{{/array}}
 * Per AC-15: only allowed fields are passed in (no raw source).
 */
function interpolateTemplate(template, ctx) {
  let out = template;

  // Replace {{#array}}<block>{{/array}} sections
  out = out.replace(/\{\{#([a-zA-Z_.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, block) => {
    const parts = key.split('.');
    let val = ctx;
    for (const p of parts) val = val?.[p];
    if (!Array.isArray(val) || val.length === 0) return '';
    return val.map(item => {
      if (typeof item === 'object') {
        return block.replace(/\{\{([a-zA-Z_]+)\}\}/g, (__, k) => item[k] ?? '');
      }
      return block.replace(/\{\{\.\}\}/g, item);
    }).join('');
  });

  // Replace {{field}} scalars (support dot notation)
  out = out.replace(/\{\{([a-zA-Z_.]+)\}\}/g, (_, key) => {
    const parts = key.split('.');
    let val = ctx;
    for (const p of parts) val = val?.[p];
    return val != null ? String(val) : '';
  });

  return out;
}

/**
 * Build the sense-making prompt from template + deterministic facts.
 * AC-15: raw function bodies NEVER included — only allowed fields.
 */
function buildPrompt(moduleData) {
  const templatePath = resolveTemplatePath();
  const template = fs.readFileSync(templatePath, 'utf-8');

  const ctx = {
    module: {
      path: moduleData.path,
      loc: moduleData.loc,
      exports: moduleData.exports || [],
      export_signatures: moduleData.export_signatures || [],
      recent_commits: moduleData.recent_commits || [],
      test_count: moduleData.test_count,
      help_text: moduleData.help_text || '(none)',
      header_comment: moduleData.header_comment || '(none)',
    },
  };

  return interpolateTemplate(template, ctx);
}

/**
 * Strip markdown code fences from a JSON string if present.
 * Some claude versions wrap the inner JSON in ```json ... ``` fences.
 */
function stripMarkdownFences(s) {
  if (typeof s !== 'string') return s;
  const m = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s.trim();
}

/**
 * Parse claude CLI output envelope.
 * claude -p ... --output-format json returns:
 *   { "type": "result", "result": "<JSON string>" }
 * Some versions return inner JSON directly.
 */
function parseClaudeOutput(stdout) {
  const outer = JSON.parse(stdout); // throws on non-JSON

  let inner;
  if (outer.type === 'result' && typeof outer.result === 'string') {
    const cleaned = stripMarkdownFences(outer.result);
    inner = JSON.parse(cleaned);
  } else if (typeof outer.capabilities !== 'undefined') {
    // Some versions return the inner JSON directly
    inner = outer;
  } else {
    throw new Error('Unexpected claude output structure: missing type=result or capabilities');
  }

  // Validate required keys
  const required = ['capabilities', 'bugs', 'recent_changes', 'recommended_spec_scope'];
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(inner, k)) {
      throw new Error(`Missing required key in claude output: ${k}`);
    }
  }
  return inner;
}

/**
 * Invoke claude CLI with sense-making prompt.
 * Uses DI spawnFn for testability.
 * @spec AC-05, AC-06, AC-07, AC-08, AC-15
 */
function invokeClaude(moduleData, { timeoutMs = 60000, spawnFn } = {}) {
  const spawn = spawnFn || spawnSync;

  // AC-07: pre-flight check — is claude in PATH?
  const whichResult = spawn('which', ['claude'], { encoding: 'utf-8', timeout: 5000 });
  if (!whichResult || whichResult.status !== 0) {
    return {
      used: false,
      ok: false,
      warning: { code: 'CLAUDE_CLI_NOT_FOUND', message: 'claude binary not in PATH; sense-making skipped' },
    };
  }

  // Build prompt (AC-15 redaction policy enforced by only using allowed fields)
  const prompt = buildPrompt(moduleData);

  // Spawn claude
  const result = spawn('claude', ['-p', prompt, '--output-format', 'json', '--model', 'haiku'], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // AC-08: handle timeout
  if (result.signal === 'SIGTERM' || (result.error && result.error.code === 'ETIMEDOUT')) {
    return {
      used: true,
      ok: false,
      warning: { code: 'CLAUDE_CLI_TIMEOUT', message: `claude CLI timed out after ${timeoutMs}ms` },
    };
  }

  // AC-08: handle non-zero exit
  if (result.status !== 0) {
    return {
      used: true,
      ok: false,
      warning: {
        code: 'CLAUDE_CLI_FAILED',
        message: `claude CLI exited with code ${result.status}: ${(result.stderr || '').slice(0, 200)}`,
      },
    };
  }

  // AC-08: handle non-JSON / missing keys
  let parsed;
  try {
    parsed = parseClaudeOutput(result.stdout);
  } catch (err) {
    return {
      used: true,
      ok: false,
      warning: { code: 'CLAUDE_CLI_INVALID_JSON', message: `claude output parse failed: ${err.message}` },
    };
  }

  // AC-06: success
  return {
    used: true,
    ok: true,
    capabilities: parsed.capabilities,
    bugs: parsed.bugs,
    recent_changes: parsed.recent_changes,
    recommended_spec_scope: parsed.recommended_spec_scope,
  };
}

module.exports = { invokeClaude, buildPrompt, interpolateTemplate, resolveTemplatePath };
