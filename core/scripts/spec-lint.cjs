#!/usr/bin/env node
'use strict';
/**
 * spec-lint.cjs — soma spec-lint <spec-dir>
 *
 * Spec artifacts are normative prose, and prose has no compiler. This lints
 * two mechanizable defect classes: invocation that diverges from the
 * declared CLI surface (`cli-surface`), and [P] tasks writing to the same
 * file (`parallel-collision`).
 *
 * Usage:
 *   soma spec-lint <spec-dir>
 *
 * One positional argument, zero flags — fixed in plan.md §"Superfície de
 * CLI". No --format, --check, --json, --fix: no AC asks for one, and
 * inventing a flag here is exactly the defect this tool exists to kill.
 *
 * Exit codes:
 *   0 — zero findings
 *   1 — ≥1 finding
 *   2 — missing/extra argument, <spec-dir> not found, or <spec-dir> has no spec.md
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-14]
 * @contract CONTRACT-LINT-OUTPUT-01
 * @task T-02
 */

const fs = require('node:fs');
const path = require('node:path');

const { buildContext } = require('./lib/spec-lint/context.cjs');
const { formatFinding, formatFooter } = require('./lib/spec-lint/finding.cjs');
const checks = require('./lib/spec-lint/registry.cjs');

function fail(message) {
  process.stderr.write(`spec-lint: ${message}\n`);
  process.exit(2);
}

function main(argv) {
  if (argv.length === 0) {
    fail('argumento <spec-dir> ausente. Uso: soma spec-lint <spec-dir>');
  }
  if (argv.length > 1) {
    fail(`argumento inválido — soma spec-lint aceita um único posicional <spec-dir>. Recebido: ${argv.join(' ')}`);
  }

  const specDirArg = argv[0];
  const specDir = path.resolve(specDirArg);

  if (!fs.existsSync(specDir) || !fs.statSync(specDir).isDirectory()) {
    fail(`<spec-dir> não encontrado: ${specDirArg}`);
  }

  const specMdPath = path.join(specDir, 'spec.md');
  if (!fs.existsSync(specMdPath) || !fs.statSync(specMdPath).isFile()) {
    fail(`<spec-dir> sem spec.md: ${specDirArg}`);
  }

  const ctx = buildContext(specDir);

  const executed = [];
  const skipped = [];
  const findings = [];

  for (const check of checks) {
    const result = check.run(ctx);
    if (result.status === 'skipped') {
      skipped.push(check.name);
    } else {
      executed.push(check.name);
    }
    for (const finding of result.findings || []) {
      findings.push(finding);
    }
  }

  // Deterministic order (CONTRACT-LINT-OUTPUT-01 §Emitter): by check in
  // registry order, then by file, then by line — unstable order turns
  // output diff into noise.
  const checkOrder = checks.map(c => c.name);
  findings.sort((a, b) => {
    const byCheck = checkOrder.indexOf(a.check) - checkOrder.indexOf(b.check);
    if (byCheck !== 0) return byCheck;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });

  for (const finding of findings) {
    process.stdout.write(formatFinding(finding) + '\n');
  }

  process.stdout.write(formatFooter({ executed, skipped, count: findings.length }) + '\n');

  process.exit(findings.length > 0 ? 1 : 0);
}

main(process.argv.slice(2));
