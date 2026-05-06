#!/usr/bin/env node
'use strict';
/**
 * CLI wrapper for migrateCbmDeprecation() library.
 *
 * Usage:
 *   node migrate-cbm-deprecation.cjs [--dry-run] [--force] [--revert <snapshot-id>]
 *
 * @spec core/specs/013-cbm-deprecation/spec.md AC-10
 */

const path = require('node:path');
const os = require('node:os');
const lib = require('./lib/migrate.cjs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const revertIdx = args.indexOf('--revert');
const revert = revertIdx !== -1 ? args[revertIdx + 1] : null;

const somaHome = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const target = {
  claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  codexAgents: path.join(os.homedir(), '.codex', 'AGENTS.md'),
  homeAgents: path.join(os.homedir(), 'AGENTS.md'),
};

const result = lib.migrateCbmDeprecation({ somaHome, target, dryRun, force, revert });
console.log(JSON.stringify(result, null, 2));
process.exit(result.action === 'abort' || result.action === 'rolled-back' ? 1 : 0);
