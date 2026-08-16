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
 * T-13 (AC-15/AC-16): specs 001-015 mark parallelism as bare `[P]` (no
 * backticks) — only 016/017 use `` `[P]` ``. The parser accepts both. And a
 * `files` cell in those older specs is often prose, not a path list (`+
 * test additions`, `(NEW)`, brace-expansion split mid-token by the naive
 * comma parser) — `looksLikePath()` drops anything that isn't shaped like
 * one, so `parallel-collision` sees real paths without inheriting prose as
 * phantom files.
 *
 * @spec [SPEC:AC-03] [SPEC:AC-08] [SPEC:AC-09] [SPEC:AC-15] [SPEC:AC-16]
 * @task T-02 / T-13
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

// AC-15: `[P]` with or without the crase — 001-015 write it bare
// ("| T-02 | [P] Write contract test..."), 016/017 write it fenced
// ("| T-02 | `[P]` Contract test..."). Both leading and trailing backticks
// are optional and independent of each other.
const PARALLEL_MARKER_RE = /^`?\[P\]`?/;

// AC-16: a `files` cell entry only counts as a file if it's SHAPED like a
// path. Older specs' `files` column is often prose glued onto a real path
// by the task author, not a clean list — and the naive comma-split above
// (context.cjs has no comma-in-braces awareness) makes it worse:
//
//   "`hooks/x.cjs` (NEW) + test additions"     → one ugly non-path token
//   "`adapters/{cursor,aider,foo}/y.json` ..." → splits into THREE tokens,
//                                                 "adapters/{cursor" among
//                                                 them — a curly brace is
//                                                 always a split artifact
//                                                 here, never legitimate
//                                                 in a real repo path
//
// Excluding space/paren/plus alone (AC-16's literal wording) still lets
// "adapters/{cursor" through — it has no space, paren or +, and it DOES
// contain "/". Two different [P] tasks in spec 009 that both cite an
// `adapters/{cursor,aider,...}/...` cell collapse to that SAME fragment
// after the split, which would fabricate a shared-file collision between
// them. Rejecting stray braces is what closes that gap — verified against
// the real corpus (009 T-04/T-05), not just against the spec's fixtures.
const PATH_JUNK_RE = /[\s()+{}]/;
const KNOWN_FILE_EXTENSIONS_RE = /\.(cjs|mjs|jsx?|tsx?|json|md|txt|sh|ya?ml|tmpl)$/i;

function looksLikePath(entry) {
  if (!entry) return false;
  if (PATH_JUNK_RE.test(entry)) return false;
  return entry.includes('/') || KNOWN_FILE_EXTENSIONS_RE.test(entry);
}

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
      files: splitList(filesCell).filter(looksLikePath),
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

module.exports = { buildContext, parseTasks, parseMarkdownTables, looksLikePath };
