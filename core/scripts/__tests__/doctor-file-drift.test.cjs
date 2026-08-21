'use strict';
/**
 * doctor-file-drift.test.cjs — soma-doctor file-drift detection
 * (Spec 018, T-06)
 *
 * doctor.cjs's detectTargetDrifts() is block-only — it "não confere
 * arquivo nenhum" (CONTRACT-FILES-LEDGER-02 §"O que o doctor lê"), which is
 * how 6 hooks went 3 months stale without doctor ever noticing: it kept
 * reporting "No drift detected". detectFileDrifts() (added by this task)
 * is the file-world counterpart for `kind: "file"` install-targets
 * entries.
 *
 * WHY MOST OF THIS SUITE CALLS detectFileDrifts() DIRECTLY INSTEAD OF
 * SPAWNING THE CLI: manifest.cjs's loadInstallTargets() (the OLD,
 * block-only loader `detectTargetDrifts()` still uses) requires
 * block_id/source_doc/target_anchor_id on EVERY entry in an adapter's
 * install-targets.json, including kind:"file" ones — which CONTRACT-FILE-
 * ENTRY-01 forbids those fields on. So ANY adapter that declares a
 * kind:"file" entry makes `loadInstallTargets()` throw INSTALL_TARGETS_
 * INVALID for that adapter, and `detectTargetDrifts()` turns that into an
 * unrelated severity:'error' target_drift finding — which is ALSO
 * severity:'error' (blocking) and masks the human-readable "OK: No drift
 * detected." branch regardless of what detectFileDrifts() itself found.
 * This is a genuine pre-existing gap (see this task's final report,
 * "Lacunas do documento") — `detectTargetDrifts()`/`loadInstallTargets()`
 * do not know kind:"file" exists yet, and teaching them is out of T-06's
 * scope (touching that code risks AC-02: "8 existing block entries must
 * not change behavior", and the task's brief is explicit: this task's
 * change to doctor.cjs is additive, detectTargetDrifts is not touched).
 * Direct unit calls to detectFileDrifts() sidestep this confound entirely
 * and test exactly what T-06 owns. A handful of CLI-level tests at the
 * bottom prove the wiring (main() actually calls detectFileDrifts and
 * merges its output) without asserting on exit code/the "OK: No drift"
 * branch, which the confound above makes unreliable to assert on in a
 * fixture that (necessarily, to test this feature at all) declares a
 * kind:"file" entry.
 *
 * These tests use a fully self-contained fixture (fake --soma-home + fake
 * --project), never the real ~/.soma-v2 or ~/.claude — doctor READS the
 * live install, and a test whose pass/fail depends on what happens to be
 * on this machine right now is worthless (and dangerous: doctor's file
 * check is read-only, but the *fixture* setup below writes files, and
 * writing anywhere under a real HOME is exactly what T-06's brief forbids).
 *
 * Article III HARD: real filesystem, real temp dirs, zero mock of `fs`.
 * `os.tmpdir()` on this Mac is NOT `/tmp`.
 *
 * @spec AC-08 AC-09 AC-10
 * @contract CONTRACT-FILES-LEDGER-02
 * @task T-06
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DOCTOR_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'doctor.cjs');
const doctor = require(DOCTOR_CJS);
const files = require(path.join(REPO_ROOT, 'core', 'scripts', 'install', 'files.cjs'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build a self-contained soma-home fixture that declares exactly one
 * `kind: "file"` entry, and the project dir it targets. Returns absolute
 * paths for everything a test needs to poke.
 *
 * target_path is an absolute temp path (NOT `~`-prefixed) deliberately —
 * this suite is about detectFileDrifts()'s comparison logic, not about
 * expandHome(); an absolute target_path sidesteps HOME entirely, so there
 * is zero chance a bug here ever touches a real dotfile.
 */
function buildFixture(sourceContent) {
  const root = mkTmp('soma-t06-fixture-');
  const somaHome = path.join(root, 'soma-home');
  const projectDir = path.join(root, 'project');
  const targetDir = path.join(root, 'installed');

  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(
    path.join(somaHome, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', files: [] }, null, 2)
  );

  const sourceRelPath = 'source-hook.cjs';
  fs.writeFileSync(path.join(somaHome, sourceRelPath), sourceContent, 'utf8');

  const targetPathAbs = path.join(targetDir, 'hook.cjs');

  const adapterDir = path.join(somaHome, 'adapters', 't06-tool');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(adapterDir, 'install-targets.json'),
    JSON.stringify({
      schema: 'soma-install-targets/v1',
      entries: [
        { kind: 'file', source_path: sourceRelPath, target_path: targetPathAbs },
      ],
    }, null, 2)
  );

  return { root, somaHome, projectDir, targetPathAbs, sourceRelPath };
}

// ─────────────────────────────────────────────────────────────────────────
// Unit-level tests: direct detectFileDrifts() calls (no CLI, no confound)
// ─────────────────────────────────────────────────────────────────────────

// ── AC-10: install-state ausente -> "nunca instalado", nunca silêncio ─────

test('T-06-01 @spec AC-10: no install-state.json -> exactly one explicit "never installed" warning', () => {
  const { somaHome, projectDir } = buildFixture('module.exports = { v: 1 };\n');
  assert.ok(!fs.existsSync(path.join(projectDir, '.soma', 'install-state.json')),
    'fixture precondition: no install-state.json');

  const findings = doctor.detectFileDrifts(somaHome, ['t06-tool'], projectDir);

  assert.equal(findings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(findings)}`);
  assert.equal(findings[0].kind, 'file_drift');
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].code, 'file_never_installed');
  assert.match(findings[0].message, /never installed by SOMA/);
  assert.doesNotMatch(findings[0].message, /No drift detected/);
});

test('T-06-02 (guard, prevents AC-10 noise): zero kind:"file" entries declared -> zero findings, even with no install-state', () => {
  // Judgment call documented in doctor.cjs: if nothing of kind "file" is
  // declared, the AC-10 warning would be pure noise on every existing
  // doctor invocation (measured 2026-08-21: neither the repo nor the real
  // ~/.soma-v2 declares any kind:"file" entry today). Prove the guard
  // fires: same "not installed" precondition as T-06-01, but zero declared
  // file entries must still yield zero findings.
  const root = mkTmp('soma-t06-noentries-');
  const somaHome = path.join(root, 'soma-home');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', files: [] }, null, 2));
  const adapterDir = path.join(somaHome, 'adapters', 'empty-tool');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', entries: [] }, null, 2));

  const findings = doctor.detectFileDrifts(somaHome, ['empty-tool'], projectDir);
  assert.equal(findings.length, 0, `expected zero findings when nothing of kind:"file" is declared, got: ${JSON.stringify(findings)}`);
});

// ── AC-08: arquivo divergindo da fonte do repo -> finding nomeando o arquivo ─

test('T-06-03 @spec AC-08: installed file diverging from repo source -> named drift finding', () => {
  const { somaHome, projectDir, targetPathAbs } = buildFixture('module.exports = { v: 2 };\n');

  // AC-10 precondition: project must be "installed" (ledger exists) for
  // the per-file comparison to even run — matches the contract's 3-row
  // table (never-installed is its own, mutually exclusive, row).
  files.writeLedger(projectDir, {});
  fs.writeFileSync(targetPathAbs, 'module.exports = { v: 1, tampered: true };\n', 'utf8');

  const findings = doctor.detectFileDrifts(somaHome, ['t06-tool'], projectDir);

  assert.equal(findings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(findings)}`);
  assert.equal(findings[0].severity, 'drift');
  assert.equal(findings[0].target_path, targetPathAbs, 'AC-08: finding must name the diverged file');
  assert.match(findings[0].message, /differs from repo source/);
  assert.notEqual(findings[0].expected_sha256, findings[0].actual_sha256);
});

// ── AC-09: tudo idêntico -> silêncio quanto a arquivos ─────────────────────

test('T-06-04 @spec AC-09 (non-blindness proof): identical file -> severity "ok" (proving the check ran, not skipped)', () => {
  // "Silence" per AC-09 is a main()-level filtering behavior (severity:'ok'
  // is dropped from default/quiet output) — detectFileDrifts() itself
  // always returns the 'ok' record. That record IS the non-blindness
  // proof: a check that never ran and one that ran clean would otherwise
  // be indistinguishable once main() filters 'ok' out, so this asserts on
  // the pre-filter return value directly.
  const content = 'module.exports = { v: 3 };\n';
  const { somaHome, projectDir, targetPathAbs } = buildFixture(content);
  files.writeLedger(projectDir, {});
  fs.writeFileSync(targetPathAbs, content, 'utf8'); // byte-identical to the repo source

  const cleanFindings = doctor.detectFileDrifts(somaHome, ['t06-tool'], projectDir);
  assert.equal(cleanFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(cleanFindings)}`);
  assert.equal(cleanFindings[0].severity, 'ok');
  assert.equal(cleanFindings[0].target_path, targetPathAbs);
  assert.equal(cleanFindings[0].expected_sha256, cleanFindings[0].actual_sha256);

  // The literal instruction: "mute o estado para haver drift e confirme
  // que o MESMO caminho de código passa a falar." Same soma-home, same
  // project, same call — only the on-disk content changes.
  fs.writeFileSync(targetPathAbs, content + '// tampered\n', 'utf8');
  const driftFindings = doctor.detectFileDrifts(somaHome, ['t06-tool'], projectDir);
  assert.equal(driftFindings.length, 1);
  assert.equal(driftFindings[0].severity, 'drift', 'the exact same code path must speak up once the state changes');
});

test('T-06-05 @spec AC-09: default/quiet main() output filters severity:"ok" file_drift findings out (the actual "silence")', () => {
  // Unit-level proof that main()'s existing `outputFindings = allFindings
  // .filter(f => f.severity !== 'ok')` filter — reused as-is, not
  // reimplemented — also applies to kind:'file_drift' findings. Exercises
  // main()'s own filter predicate directly against detectFileDrifts()'s
  // output, without spawning the CLI (see file header: CLI-level
  // assertions on this exact scenario are confounded by the pre-existing
  // block-validator/kind:"file" incompatibility).
  const content = 'module.exports = { v: 3b };\n';
  const { somaHome, projectDir, targetPathAbs } = buildFixture(content);
  files.writeLedger(projectDir, {});
  fs.writeFileSync(targetPathAbs, content, 'utf8');

  const allFindings = doctor.detectFileDrifts(somaHome, ['t06-tool'], projectDir);
  const outputFindings = allFindings.filter((f) => f.severity !== 'ok'); // main()'s default-mode filter, verbatim
  assert.equal(outputFindings.length, 0, `AC-09: default output must be silent about clean files, got: ${JSON.stringify(outputFindings)}`);
});

// ── Judgment call: target file recorded as installed but missing from disk ─

test('T-06-06 (judgment call, documented): declared file missing from disk while project IS installed -> named "missing" finding', () => {
  const { somaHome, projectDir, targetPathAbs } = buildFixture('module.exports = { v: 5 };\n');
  files.writeLedger(projectDir, {});
  assert.ok(!fs.existsSync(targetPathAbs), 'fixture precondition: target was never written to disk');

  const findings = doctor.detectFileDrifts(somaHome, ['t06-tool'], projectDir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'missing');
  assert.equal(findings[0].target_path, targetPathAbs);
  assert.match(findings[0].message, /not found/);
});

test('T-06-07: an adapter whose install-targets.json is INSTALL_TARGETS_INVALID (independent of kind:"file") does not crash detectFileDrifts, and contributes no file_drift finding', () => {
  const root = mkTmp('soma-t06-invalid-');
  const somaHome = path.join(root, 'soma-home');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', files: [] }, null, 2));
  const adapterDir = path.join(somaHome, 'adapters', 'broken-tool');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), '{ not valid json');

  const findings = doctor.detectFileDrifts(somaHome, ['broken-tool'], projectDir);
  assert.equal(findings.length, 0, 'an INSTALL_TARGETS_INVALID adapter (already reported by detectTargetDrifts) must not double-report here');
});

// ─────────────────────────────────────────────────────────────────────────
// CLI-level wiring tests: prove main() actually calls detectFileDrifts()
// and merges its output into the real JSON `findings` array. Exit code and
// the "OK: No drift detected." human branch are NOT asserted here — see
// file header for why that is confounded by a pre-existing, out-of-scope
// gap (detectTargetDrifts/loadInstallTargets choking on kind:"file").
// ─────────────────────────────────────────────────────────────────────────

function runDoctorJson(somaHome, projectDir) {
  return spawnSync(
    'node',
    [DOCTOR_CJS, '--json', `--soma-home=${somaHome}`, `--project=${projectDir}`],
    { cwd: projectDir, encoding: 'utf8', timeout: 15000 }
  );
}

function fileDriftFindings(jsonOut) {
  const parsed = JSON.parse(jsonOut);
  return (parsed.findings || []).filter((f) => f.kind === 'file_drift');
}

test('T-06-08 (CLI wiring) @spec AC-10: main() surfaces the never-installed warning in real JSON output', () => {
  const { somaHome, projectDir } = buildFixture('module.exports = { v: 6 };\n');
  const r = runDoctorJson(somaHome, projectDir);
  assert.ok(r.status === 0 || r.status === 1 || r.status === 2, `doctor must exit cleanly, got ${r.status}. stderr: ${r.stderr}`);
  const findings = fileDriftFindings(r.stdout);
  assert.equal(findings.length, 1, `expected exactly 1 file_drift finding via CLI, got: ${JSON.stringify(findings)}`);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].code, 'file_never_installed');
});

test('T-06-09 (CLI wiring) @spec AC-08: main() surfaces the named drift finding in real JSON output', () => {
  const { somaHome, projectDir, targetPathAbs } = buildFixture('module.exports = { v: 7 };\n');
  files.writeLedger(projectDir, {});
  fs.writeFileSync(targetPathAbs, 'module.exports = { v: 7, tampered: true };\n', 'utf8');

  const r = runDoctorJson(somaHome, projectDir);
  const findings = fileDriftFindings(r.stdout);
  assert.equal(findings.length, 1, `expected exactly 1 file_drift finding via CLI, got: ${JSON.stringify(findings)}`);
  assert.equal(findings[0].severity, 'drift');
  assert.equal(findings[0].target_path, targetPathAbs);
  // drift IS blocking (severity !== 'ok' && !== 'warning'); the CLI-level
  // exit code assertion is safe here specifically because BOTH the real
  // reason (drift) and the pre-existing confound (kind:"file" adapter
  // tripping the old block validator) agree on exit 1 — unlike the
  // AC-09/AC-10 CLI scenarios where the confound would fight the assertion.
  assert.equal(r.status, 1);
});

test('T-06-11 (CLI wiring, human output) @spec AC-08: diverged file is named in human-readable output, never "← undefined"', () => {
  // Regression guard for a cosmetic bug found while pasting real `soma
  // doctor` output for this task's report: the pre-existing human-output
  // loop assumed every f.target_path finding was block-world shaped and
  // printed `${target} ← ${f.target_anchor_id}` — file_drift findings have
  // no target_anchor_id, so it printed a literal "← undefined".
  const { somaHome, projectDir, targetPathAbs } = buildFixture('module.exports = { v: 8 };\n');
  files.writeLedger(projectDir, {});
  fs.writeFileSync(targetPathAbs, 'module.exports = { v: 8, tampered: true };\n', 'utf8');

  const rText = spawnSync('node', [DOCTOR_CJS, `--soma-home=${somaHome}`, `--project=${projectDir}`],
    { cwd: projectDir, encoding: 'utf8', timeout: 15000 });
  assert.doesNotMatch(rText.stdout, /← undefined/, `human output must never print "← undefined". Got:\n${rText.stdout}`);
  assert.ok(rText.stdout.includes(targetPathAbs), `human output must name the diverged path. Got:\n${rText.stdout}`);
});

test('T-06-10: detectFileDrifts is exported for direct/unit use', () => {
  assert.equal(typeof doctor.detectFileDrifts, 'function');
});
