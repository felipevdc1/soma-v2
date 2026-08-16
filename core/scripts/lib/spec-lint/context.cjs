'use strict';
/**
 * lib/spec-lint/context.cjs — builds the ctx object passed to every check.
 *
 * Single loader: reads spec.md, plan.md, tasks.md, quickstart.md and
 * contracts/*.md (whichever exist — absence is not fatal), and parses
 * tasks.md once into { id, parallel, files[], dependsOn[], specRefs[] }.
 *
 * No check reads the disk on its own (plan.md §"Interface de check") — this
 * is the one place the tasks.md format can break, and fixtures for check
 * tests never need to touch the real repo.
 *
 * @spec [SPEC:AC-03] [SPEC:AC-08] [SPEC:AC-09]
 * @task T-02
 */

const fs = require('node:fs');
const path = require('node:path');

const ARTIFACT_FILES = ['spec.md', 'plan.md', 'tasks.md', 'quickstart.md'];

function readArtifact(absPath, relPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  return { file: relPath, text, lines: text.split('\n') };
}

function loadArtifacts(specDir) {
  const artifacts = [];

  for (const file of ARTIFACT_FILES) {
    const abs = path.join(specDir, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      artifacts.push(readArtifact(abs, file));
    }
  }

  const contractsDir = path.join(specDir, 'contracts');
  if (fs.existsSync(contractsDir) && fs.statSync(contractsDir).isDirectory()) {
    const names = fs.readdirSync(contractsDir).filter(n => n.endsWith('.md')).sort();
    for (const name of names) {
      const rel = path.join('contracts', name);
      artifacts.push(readArtifact(path.join(contractsDir, name), rel));
    }
  }

  return artifacts;
}

// ── tasks.md parsing — by column NAME, never by fixed index (plan.md trap) ──

function isTableRow(line) {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 1;
}

function splitRow(line) {
  const inner = line.trim().slice(1, -1);
  return inner.split('|').map(c => c.trim());
}

function isSeparatorRow(line) {
  if (!isTableRow(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

/** Finds every markdown table in `text`. Returns { header, rows, rowLineNumbers }[]. */
function parseMarkdownTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      const rowLineNumbers = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        rowLineNumbers.push(i + 1); // 1-indexed
        i++;
      }
      tables.push({ header, rows, rowLineNumbers });
    } else {
      i++;
    }
  }
  return tables;
}

function unbacktick(cell) {
  return cell.replace(/^`|`$/g, '');
}

/** "`a.cjs`, `b.cjs`" -> ["a.cjs", "b.cjs"]. Empty/"-" -> []. */
function splitList(cell) {
  if (!cell) return [];
  const trimmed = cell.trim();
  if (trimmed === '' || trimmed === '-') return [];
  return trimmed.split(',').map(s => unbacktick(s.trim())).filter(Boolean);
}

function extractSpecRefs(cell) {
  if (!cell) return [];
  const refs = [];
  for (const m of cell.matchAll(/\[SPEC:(AC-\d+)\]/g)) refs.push(m[1]);
  return refs;
}

const PARALLEL_MARKER_RE = /^`\[P\]`/;

function parseTasksTable(table) {
  const idx = {};
  table.header.forEach((name, i) => { idx[name] = i; });
  if (!('ID' in idx)) return []; // not a tasks table (e.g. "Cobertura de AC")

  const tasks = [];
  table.rows.forEach((cells, rowIdx) => {
    const idCell = (cells[idx.ID] || '').trim();
    if (!idCell) return;

    const description = 'Description' in idx ? (cells[idx.Description] || '') : '';
    const filesCell = 'files' in idx ? (cells[idx.files] || '') : '';
    const dependsCell = 'depends_on' in idx ? (cells[idx.depends_on] || '') : '';
    const specRefCell = 'spec_ref' in idx ? (cells[idx.spec_ref] || '') : '';

    tasks.push({
      id: idCell,
      parallel: PARALLEL_MARKER_RE.test(description.trim()),
      files: splitList(filesCell),
      dependsOn: splitList(dependsCell),
      specRefs: extractSpecRefs(specRefCell),
      line: table.rowLineNumbers[rowIdx],
    });
  });
  return tasks;
}

function parseTasks(tasksText) {
  if (!tasksText) return [];
  const tables = parseMarkdownTables(tasksText);
  let tasks = [];
  for (const table of tables) {
    tasks = tasks.concat(parseTasksTable(table));
  }
  return tasks;
}

function buildContext(specDir) {
  const artifacts = loadArtifacts(specDir);
  const tasksArtifact = artifacts.find(a => a.file === 'tasks.md');
  const tasks = tasksArtifact ? parseTasks(tasksArtifact.text) : [];
  return { specDir, artifacts, tasks };
}

module.exports = { buildContext, parseTasks, parseMarkdownTables };
