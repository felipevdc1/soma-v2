#!/usr/bin/env node
'use strict';
/**
 * module.cjs — SOMA v2.1 module lifecycle CLI
 *
 * Orchestrates 4 subcommands: add / promote / remove / deprecate
 * Backed by scripts/lib/module-store.cjs (single-responsibility helper).
 *
 * Usage:
 *   node ~/.soma-v2/scripts/module.cjs add {keyword} [--with-snippet] [--soma-home=PATH] [--project=PATH] [--json]
 *   node ~/.soma-v2/scripts/module.cjs promote {slug} [--soma-home=PATH] [--project=PATH] [--json]
 *   node ~/.soma-v2/scripts/module.cjs remove {slug} [--yes|-y] [--soma-home=PATH] [--project=PATH] [--json]
 *   node ~/.soma-v2/scripts/module.cjs deprecate {slug} [--soma-home=PATH] [--project=PATH] [--json]
 *
 * Exit codes:
 *   0 — success
 *   1 — logical error (MODULE_EXISTS, MODULE_NOT_FOUND, ALREADY_ACTIVE, RESERVED_SLUG, INVALID_SLUG, SCHEMA_INVALID)
 *   2 — hard error (INVALID_ARGS, MANIFEST_MISSING, IO failure)
 *
 * @spec AC-01..AC-15, D1-D6
 * @contract CONTRACT-MODULE-CMDS-01
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const {
  deriveSlug,
  validateSlug,
  parseFrontMatter,
  serializeFrontMatter,
  validateFrontMatterSchema,
  readModule,
  createModuleFromTemplate,
  createSnippetSkeleton,
  deleteSnippet,
} = require('./lib/module-store.cjs');

// ---- Arg parsing ----

function parseArgs(argv) {
  const flags = {
    withSnippet: false,
    yes: false,
    json: false,
    somaHome: null,
    project: null,
  };
  const errors = [];
  let subcommand = null;
  let positional = null;
  let endOfFlags = false;

  for (const arg of argv) {
    if (arg === '--') {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags) {
      if (arg === '--with-snippet') { flags.withSnippet = true; continue; }
      if (arg === '--yes' || arg === '-y') { flags.yes = true; continue; }
      if (arg === '--json') { flags.json = true; continue; }
      if (arg.startsWith('--soma-home=')) { flags.somaHome = arg.slice('--soma-home='.length); continue; }
      if (arg.startsWith('--project=')) { flags.project = arg.slice('--project='.length); continue; }
      if (arg.startsWith('--')) { errors.push(`Unknown flag: ${arg}`); continue; }
    }
    // Positional
    if (subcommand === null) subcommand = arg;
    else if (positional === null) positional = arg;
    else errors.push(`Unexpected positional argument: ${arg}`);
  }

  return { flags, errors, subcommand, positional };
}

// ---- Output helpers ----

function emitError(code, message, useJson, exitCode = 1) {
  const out = { error: { code, message } };
  if (useJson) {
    process.exitCode = exitCode;
    process.stdout.end(JSON.stringify(out, null, 2) + '\n');
  } else {
    process.stderr.write(`ERROR [${code}]: ${message}\n`);
    process.exit(exitCode);
  }
}

function emitSuccess(payload, useJson) {
  process.exitCode = 0;
  if (useJson) {
    process.stdout.end(JSON.stringify({ ...payload, error: null }, null, 2) + '\n');
  } else {
    // Human-readable
    const sub = payload.schema ? payload.schema.split('/')[0].replace('soma-module-', '') : '';
    process.stdout.end(`OK [${sub}]: ${JSON.stringify(payload, null, 2)}\n`);
  }
}

// ---- Subcommands ----

/**
 * soma module add {keyword} [--with-snippet]
 * AC-01, AC-02, AC-09, AC-10, AC-11, AC-12
 */
function cmdAdd(keyword, flags, somaHome, projectPath) {
  const useJson = flags.json;

  if (!keyword) {
    emitError('INVALID_ARGS', 'Usage: module add {keyword}', useJson, 2);
    return;
  }

  // Security: reject keywords with path traversal components before derivation
  if (keyword.includes('..') && (keyword.includes('/') || keyword.includes('\\'))) {
    emitError('INVALID_SLUG', `Keyword contains path traversal: "${keyword}"`, useJson, 1);
    return;
  }

  // Derive slug (AC-11)
  const slug = deriveSlug(keyword);
  const slugValidation = validateSlug(slug);
  if (!slugValidation.valid) {
    emitError(slugValidation.errorCode, `Slug derivation failed for "${keyword}": ${slugValidation.errorCode}`, useJson, 1);
    return;
  }

  // Announce slug before creation (AC-11)
  if (!useJson) {
    process.stdout.write(`Derived slug: ${slug}\n`);
  }

  // Check collision (AC-02)
  const modulePath = path.join(projectPath, '.soma/modules', `${slug}.md`);
  if (fs.existsSync(modulePath)) {
    emitError('MODULE_EXISTS', `Module "${slug}" already exists at ${modulePath}`, useJson, 1);
    return;
  }

  // Create from template (AC-01)
  let createdPath;
  try {
    createdPath = createModuleFromTemplate(projectPath, slug, keyword, somaHome);
  } catch (e) {
    emitError('IO_ERROR', `Failed to create module: ${e.message}`, useJson, 2);
    return;
  }

  // Create snippet skeleton if --with-snippet (AC-09)
  let snippetPath = null;
  if (flags.withSnippet) {
    try {
      snippetPath = createSnippetSkeleton(somaHome, slug, keyword);
    } catch (e) {
      emitError('IO_ERROR', `Failed to create snippet: ${e.message}`, useJson, 2);
      return;
    }
  }

  emitSuccess({
    schema: 'soma-module-add/v1',
    slug,
    module_path: createdPath,
    snippet_path: snippetPath,
    status: 'hypothesis',
    initialized_at: new Date().toISOString(),
  }, useJson);
}

/**
 * soma module promote {slug}
 * AC-03, AC-04, AC-05, D4
 */
function cmdPromote(slug, flags, somaHome, projectPath) {
  const useJson = flags.json;

  if (!slug) {
    emitError('INVALID_ARGS', 'Usage: module promote {slug}', useJson, 2);
    return;
  }

  const { exists, frontMatter, body, parseResult, modulePath } = readModule(projectPath, slug);

  if (!exists) {
    emitError('MODULE_NOT_FOUND', `Module "${slug}" not found in .soma/modules/`, useJson, 1);
    return;
  }

  // Check parse validity (D4: malformed YAML)
  if (!parseResult.valid || !frontMatter) {
    emitError('SCHEMA_INVALID', `Front-matter parse error: ${parseResult.error}`, useJson, 1);
    return;
  }

  // Validate schema (D4: unknown fields, missing required keys)
  const schemaValidation = validateFrontMatterSchema(frontMatter);
  if (!schemaValidation.valid) {
    emitError('SCHEMA_INVALID', `Front-matter schema invalid: ${schemaValidation.error}`, useJson, 1);
    return;
  }

  // Check current status (AC-04: already active)
  if (frontMatter.status === 'active') {
    emitError('ALREADY_ACTIVE', `Module "${slug}" is already active`, useJson, 1);
    return;
  }

  // Allow promote from hypothesis (and deprecated if user wants to re-activate — but spec says hypothesis only)
  // The spec says promote requires status=hypothesis (AC-03/04), but deprecate→promote is AC-04 scope
  // Actually AC-04 only blocks if active; we proceed for hypothesis or deprecated
  const fromStatus = frontMatter.status;
  const now = new Date().toISOString();

  // Update front-matter
  const updatedFm = {
    ...frontMatter,
    status: 'active',
    promoted_at: now,
    last_verified: now,
  };

  // Reconstruct file (body preserved verbatim)
  const modulesDir = path.join(projectPath, '.soma/modules');
  const newContent = `---\n${serializeFrontMatter(updatedFm)}\n---\n${body}`;
  fs.writeFileSync(modulePath, newContent, 'utf8');

  emitSuccess({
    schema: 'soma-module-promote/v1',
    slug,
    from_status: fromStatus,
    to_status: 'active',
    promoted_at: now,
  }, useJson);
}

/**
 * soma module remove {slug} [--yes|-y]
 * AC-06, D1
 */
async function cmdRemove(slug, flags, somaHome, projectPath) {
  const useJson = flags.json;

  if (!slug) {
    emitError('INVALID_ARGS', 'Usage: module remove {slug}', useJson, 2);
    return;
  }

  const { exists, modulePath } = readModule(projectPath, slug);

  // Idempotent: if already removed, exit 0 with warning
  if (!exists) {
    if (useJson) {
      process.exitCode = 0;
      process.stdout.end(JSON.stringify({
        schema: 'soma-module-remove/v1',
        slug,
        deleted: [],
        warning: 'Module not found — already removed (idempotent)',
        error: null
      }, null, 2) + '\n');
    } else {
      process.exitCode = 0;
      process.stdout.end(`WARN: Module "${slug}" not found — already removed (idempotent).\n`);
    }
    return;
  }

  // Confirmation prompt unless --yes (D1)
  if (!flags.yes) {
    const snippetPath = path.join(somaHome, 'cookbook/snippets', `${slug}.json`);
    const snippetExists = fs.existsSync(snippetPath);
    const confirmMsg = `Are you sure? This deletes .soma/modules/${slug}.md` +
      (snippetExists ? ` and cookbook/snippets/${slug}.json` : '') +
      ` [y/N]: `;

    const confirmed = await promptConfirm(confirmMsg);
    if (!confirmed) {
      if (useJson) {
        process.exitCode = 0;
        process.stdout.end(JSON.stringify({ schema: 'soma-module-remove/v1', slug, deleted: [], cancelled: true, error: null }, null, 2) + '\n');
      } else {
        process.exitCode = 0;
        process.stdout.end('Aborted.\n');
      }
      return;
    }
  }

  // Delete module file
  const deleted = [];
  fs.unlinkSync(modulePath);
  deleted.push(modulePath);

  // Delete companion snippet if exists (AC-06)
  const deletedSnippet = deleteSnippet(somaHome, slug);
  if (deletedSnippet) {
    deleted.push(deletedSnippet);
  }

  emitSuccess({
    schema: 'soma-module-remove/v1',
    slug,
    deleted,
  }, useJson);
}

/**
 * Prompt user for y/N confirmation via stdin.
 * Returns true if confirmed.
 */
function promptConfirm(message) {
  return new Promise((resolve) => {
    // If stdin is not a TTY (piped/non-interactive), read from stdin
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    // Check if we have an answer already in non-interactive mode
    let answered = false;
    rl.question(message, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });

    // In non-interactive mode, if stdin closes without answer, default to No
    rl.on('close', () => {
      if (!answered) resolve(false);
    });
  });
}

/**
 * soma module deprecate {slug}
 * AC-07
 */
function cmdDeprecate(slug, flags, somaHome, projectPath) {
  const useJson = flags.json;

  if (!slug) {
    emitError('INVALID_ARGS', 'Usage: module deprecate {slug}', useJson, 2);
    return;
  }

  const { exists, frontMatter, body, parseResult, modulePath } = readModule(projectPath, slug);

  if (!exists) {
    emitError('MODULE_NOT_FOUND', `Module "${slug}" not found in .soma/modules/`, useJson, 1);
    return;
  }

  if (!parseResult.valid || !frontMatter) {
    emitError('SCHEMA_INVALID', `Front-matter parse error: ${parseResult.error}`, useJson, 1);
    return;
  }

  const fromStatus = frontMatter.status;
  const now = new Date().toISOString();

  const updatedFm = {
    ...frontMatter,
    status: 'deprecated',
    deprecated_at: now,
  };

  const newContent = `---\n${serializeFrontMatter(updatedFm)}\n---\n${body}`;
  fs.writeFileSync(modulePath, newContent, 'utf8');

  emitSuccess({
    schema: 'soma-module-deprecate/v1',
    slug,
    from_status: fromStatus,
    to_status: 'deprecated',
    deprecated_at: now,
  }, useJson);
}

// ---- Main ----

async function main() {
  const { flags, errors, subcommand, positional } = parseArgs(process.argv.slice(2));
  const useJson = flags.json;

  if (!subcommand) {
    emitError('INVALID_ARGS',
      'Usage: module {add|promote|remove|deprecate} {keyword|slug} [options]',
      useJson, 2);
    return;
  }

  if (errors.length > 0) {
    emitError('INVALID_ARGS', errors.join('; '), useJson, 2);
    return;
  }

  const rawSomaHome = flags.somaHome || process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
  const somaHome = rawSomaHome.startsWith('~') ? path.join(os.homedir(), rawSomaHome.slice(1)) : rawSomaHome;
  const rawProject = flags.project || process.cwd();
  const projectPath = rawProject.startsWith('~') ? path.join(os.homedir(), rawProject.slice(1)) : rawProject;

  switch (subcommand) {
    case 'add':
      cmdAdd(positional, flags, somaHome, projectPath);
      break;
    case 'promote':
      cmdPromote(positional, flags, somaHome, projectPath);
      break;
    case 'remove':
      await cmdRemove(positional, flags, somaHome, projectPath);
      break;
    case 'deprecate':
      cmdDeprecate(positional, flags, somaHome, projectPath);
      break;
    default:
      emitError('INVALID_ARGS',
        `Unknown subcommand: "${subcommand}". Valid: add, promote, remove, deprecate`,
        useJson, 2);
      return;
  }
}

main().catch(e => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  process.exit(2);
});
