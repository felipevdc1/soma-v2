/**
 * module-store.cjs — SOMA v2.1 module lifecycle helper
 *
 * Single-responsibility: read/write .soma/modules/{slug}.md front-matter +
 * companion cookbook/snippets/{slug}.json CRUD + slug derivation + reserved-name guard.
 *
 * Zero external deps — Node.js stdlib only (fs, path, os, crypto).
 *
 * @spec AC-01..AC-15, D1-D6
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---- Constants ----

const RESERVED_SLUGS = new Set(['manifest', 'snapshots', 'evidence', 'modules', 'cookbook', 'config']);

const REQUIRED_FRONTMATTER_KEYS = [
  'schema',
  'name',
  'status',
  'source_confidence',
  'owners',
  'last_verified',
  'source_path',
  'initialized_at',
];

const ALLOWED_FRONTMATTER_KEYS = new Set([
  'schema',
  'name',
  'status',
  'source_confidence',
  'owners',
  'last_verified',
  'source_path',
  'verification',
  'initialized_at',
  'promoted_at',
  'deprecated_at',
]);

// ---- Slug derivation (AC-11) ----

/**
 * Derive a kebab-case slug from a human-readable keyword.
 * Rules:
 *   1. Lowercase
 *   2. Replace non-alphanumeric chars with `-`
 *   3. Collapse `--` runs
 *   4. Trim leading/trailing `-`
 *
 * @param {string} keyword
 * @returns {string} derived slug
 */
function deriveSlug(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Validate a derived slug for INVALID_SLUG or RESERVED_SLUG.
 * Also checks for path-traversal attempts.
 *
 * @param {string} slug
 * @returns {{ valid: boolean, errorCode: string|null }}
 */
function validateSlug(slug) {
  if (!slug || slug.length === 0) {
    return { valid: false, errorCode: 'INVALID_SLUG' };
  }
  // Reject if slug contains path traversal chars
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    return { valid: false, errorCode: 'INVALID_SLUG' };
  }
  // Reject reserved names (case-insensitive — deriveSlug already lowercased, but defensively)
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return { valid: false, errorCode: 'RESERVED_SLUG' };
  }
  return { valid: true, errorCode: null };
}

// ---- Front-matter parsing ----

/**
 * Parse YAML front-matter from a markdown file.
 * Returns { frontMatter: object|null, body: string, raw: string, valid: boolean, error: string|null }
 *
 * Simple line-by-line parser — no external YAML lib (AD-04).
 * Handles: string, null, number, boolean, list (inline arrays not supported).
 *
 * @param {string} content
 * @returns {{ frontMatter: object|null, body: string, raw: string, valid: boolean, error: string|null }}
 */
function parseFrontMatter(content) {
  if (!content.startsWith('---\n')) {
    return { frontMatter: null, body: content, raw: '', valid: false, error: 'No front-matter start delimiter' };
  }
  // Find the closing ---
  const closingIndex = content.indexOf('\n---\n', 4);
  if (closingIndex === -1) {
    return { frontMatter: null, body: content, raw: '', valid: false, error: 'No front-matter end delimiter' };
  }

  const raw = content.slice(4, closingIndex);
  const body = content.slice(closingIndex + 5); // after \n---\n

  const frontMatter = {};
  const lines = raw.split('\n');
  let inVerification = false;

  for (const line of lines) {
    if (line.trim() === '') continue;
    // Track nested sections (verification:)
    if (line.match(/^verification:$/)) {
      frontMatter['verification'] = {};
      inVerification = true;
      continue;
    }
    if (inVerification && line.match(/^  /)) {
      // nested key inside verification
      const nestedMatch = line.match(/^  ([^:]+):\s*(.*)/);
      if (nestedMatch) {
        const [, k, v] = nestedMatch;
        frontMatter['verification'][k.trim()] = parseValue(v.trim());
      }
      continue;
    }
    inVerification = false;

    // Normal key: value line
    const match = line.match(/^([^:]+):\s*(.*)/);
    if (!match) continue;
    const key = match[1].trim();
    const rawVal = match[2].trim();

    // Handle owners: [] inline list
    if (rawVal === '[]') {
      frontMatter[key] = [];
    } else {
      frontMatter[key] = parseValue(rawVal);
    }
  }

  return { frontMatter, body, raw, valid: true, error: null };
}

/**
 * Parse a YAML scalar value from a string.
 */
function parseValue(v) {
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === '[]') return [];
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (/^\d+\.\d+$/.test(v)) return parseFloat(v);
  // Quoted string
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Serialize front-matter object back to YAML string (bounded schema).
 *
 * @param {object} fm
 * @returns {string} YAML front-matter block (without --- delimiters)
 */
function serializeFrontMatter(fm) {
  const lines = [];

  function serializeValue(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v.toString();
    if (typeof v === 'number') return v.toString();
    if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.map(x => `"${x}"`).join(', ')}]`;
    if (typeof v === 'string') {
      // Quote if contains special chars, or is a date, or could be confused
      if (v.match(/[:{}[\]|>&!%@#]/)) return `"${v}"`;
      if (v.match(/^\d{4}-\d{2}-\d{2}T/)) return `"${v}"`; // ISO dates
      return v;
    }
    return String(v);
  }

  // Emit in canonical order
  const ORDER = [
    'schema', 'name', 'status', 'source_confidence', 'owners',
    'last_verified', 'source_path', 'verification', 'initialized_at',
    'promoted_at', 'deprecated_at'
  ];

  for (const key of ORDER) {
    if (!(key in fm)) continue;
    const val = fm[key];
    if (key === 'verification' && val && typeof val === 'object') {
      lines.push(`verification:`);
      for (const [k, v] of Object.entries(val)) {
        lines.push(`  ${k}: ${serializeValue(v)}`);
      }
    } else {
      lines.push(`${key}: ${serializeValue(val)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Validate front-matter against soma-module/v1 schema (D4).
 * Returns { valid: boolean, error: string|null }
 *
 * Rules:
 * - All REQUIRED_FRONTMATTER_KEYS must be present
 * - No keys outside ALLOWED_FRONTMATTER_KEYS (unknown fields = breaking edit)
 *
 * @param {object} fm
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateFrontMatterSchema(fm) {
  // Check required keys
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!(key in fm)) {
      return { valid: false, error: `Missing required key: ${key}` };
    }
  }
  // Check no unknown keys
  for (const key of Object.keys(fm)) {
    if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
      return { valid: false, error: `Unknown front-matter key: ${key}` };
    }
  }
  return { valid: true, error: null };
}

// ---- Module file operations ----

/**
 * Read module front-matter from .soma/modules/{slug}.md
 *
 * @param {string} projectPath
 * @param {string} slug
 * @returns {{ exists: boolean, frontMatter: object|null, body: string, content: string, parseResult: object }}
 */
function readModule(projectPath, slug) {
  const modulePath = path.join(projectPath, '.soma/modules', `${slug}.md`);
  if (!fs.existsSync(modulePath)) {
    return { exists: false, frontMatter: null, body: '', content: '', parseResult: null, modulePath };
  }
  const content = fs.readFileSync(modulePath, 'utf8');
  const parseResult = parseFrontMatter(content);
  return {
    exists: true,
    frontMatter: parseResult.frontMatter,
    body: parseResult.body,
    content,
    parseResult,
    modulePath
  };
}

/**
 * Write module file — front-matter reconstructed + body preserved verbatim.
 *
 * @param {string} projectPath
 * @param {string} slug
 * @param {object} frontMatter
 * @param {string} body
 */
function writeModule(projectPath, slug, frontMatter, body) {
  const modulesDir = path.join(projectPath, '.soma/modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const modulePath = path.join(modulesDir, `${slug}.md`);
  const content = `---\n${serializeFrontMatter(frontMatter)}\n---\n${body}`;
  fs.writeFileSync(modulePath, content, 'utf8');
}

/**
 * Create module file from template (AC-01).
 *
 * @param {string} projectPath
 * @param {string} slug
 * @param {string} keyword — original human-readable keyword (stored as name)
 * @param {string} somaHome
 * @returns {string} created module file path
 */
function createModuleFromTemplate(projectPath, slug, keyword, somaHome) {
  const templatePath = path.join(somaHome, 'templates/project/.soma/modules/module.md.tmpl');
  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (e) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const now = new Date().toISOString();

  // Substitute template placeholders
  let content = template;
  content = content.replace(/\{\{MODULE_NAME\}\}/g, keyword);
  content = content.replace(/\{\{MODULE_SOURCE_PATH\}\}/g, '');
  content = content.replace(/\{\{MODULE_FILES_CHECKED\}\}/g, '0');
  content = content.replace(/\{\{MODULE_FILES_CHECKED_LIST\}\}/g, '');
  content = content.replace(/\{\{ISO8601_DATE\}\}/g, now);

  // After substitution, the front-matter has name: "{{keyword}}" and initialized_at: "{{now}}"
  // The template already has status: hypothesis, source_confidence: low
  // But we need to ensure name is double-quoted properly
  // The template uses {{MODULE_NAME}} inside "..." so name = "keyword" is already quoted

  const modulesDir = path.join(projectPath, '.soma/modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const modulePath = path.join(modulesDir, `${slug}.md`);
  fs.writeFileSync(modulePath, content, 'utf8');
  return modulePath;
}

// ---- Snippet operations ----

/**
 * Create snippet JSON skeleton at SOMA_HOME/cookbook/snippets/{slug}.json (AC-09).
 *
 * @param {string} somaHome
 * @param {string} slug
 * @param {string} keyword
 * @returns {string} snippet file path
 */
function createSnippetSkeleton(somaHome, slug, keyword) {
  const snippetsDir = path.join(somaHome, 'cookbook/snippets');
  fs.mkdirSync(snippetsDir, { recursive: true });
  const snippetPath = path.join(snippetsDir, `${slug}.json`);
  const skeleton = {
    schema: 'soma-snippet/v1',
    slug,
    keywords: [keyword],
    snippets: []
  };
  fs.writeFileSync(snippetPath, JSON.stringify(skeleton, null, 2) + '\n', 'utf8');
  return snippetPath;
}

/**
 * Delete snippet if it exists.
 *
 * @param {string} somaHome
 * @param {string} slug
 * @returns {string|null} deleted path or null
 */
function deleteSnippet(somaHome, slug) {
  const snippetPath = path.join(somaHome, 'cookbook/snippets', `${slug}.json`);
  if (fs.existsSync(snippetPath)) {
    fs.unlinkSync(snippetPath);
    return snippetPath;
  }
  return null;
}

// ---- Stale hypothesis scan (AC-08) ----

const STALE_THRESHOLD_DAYS = 90;

/**
 * Scan .soma/modules/ in a project for stale hypothesis modules (≥90d old).
 *
 * @param {string} projectPath
 * @returns {object[]} array of stale_hypothesis findings
 */
function scanStaleHypothesis(projectPath) {
  const modulesDir = path.join(projectPath, '.soma/modules');
  if (!fs.existsSync(modulesDir)) return [];

  const findings = [];
  let files;
  try {
    files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.md'));
  } catch (e) {
    return [];
  }

  const now = Date.now();
  for (const file of files) {
    const slug = path.basename(file, '.md');
    const modulePath = path.join(modulesDir, file);
    const content = fs.readFileSync(modulePath, 'utf8');
    const parsed = parseFrontMatter(content);
    if (!parsed.valid || !parsed.frontMatter) continue;
    const fm = parsed.frontMatter;
    if (fm.status !== 'hypothesis') continue;
    if (!fm.initialized_at) continue;
    const initializedAt = new Date(fm.initialized_at);
    if (isNaN(initializedAt.getTime())) continue;
    const ageDays = Math.floor((now - initializedAt.getTime()) / 86400000);
    if (ageDays >= STALE_THRESHOLD_DAYS) {
      findings.push({
        severity: 'warning',
        code: 'stale_hypothesis',
        module: slug,
        age_days: ageDays,
        initialized_at: fm.initialized_at
      });
    }
  }
  return findings;
}

// ---- Exports ----

module.exports = {
  deriveSlug,
  validateSlug,
  parseFrontMatter,
  serializeFrontMatter,
  validateFrontMatterSchema,
  readModule,
  writeModule,
  createModuleFromTemplate,
  createSnippetSkeleton,
  deleteSnippet,
  scanStaleHypothesis,
  RESERVED_SLUGS,
  ALLOWED_FRONTMATTER_KEYS,
  REQUIRED_FRONTMATTER_KEYS,
};
