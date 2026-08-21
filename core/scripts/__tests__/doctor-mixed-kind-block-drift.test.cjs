'use strict';
/**
 * doctor-mixed-kind-block-drift.test.cjs — regression test for a bug T-06
 * found while instrumenting doctor.cjs for kind:"file" drift detection.
 *
 * detectTargetDrifts() and computeInstallTargetsSummary() both still call
 * manifest.cjs's loadInstallTargets() — the OLD, block-only loader, whose
 * validateInstallTargetsSchema() requires block_id/source_doc/
 * target_anchor_id on EVERY entry in an adapter's install-targets.json,
 * including kind:"file" ones that CONTRACT-FILE-ENTRY-01 forbids those
 * fields on. The moment an adapter declares even ONE kind:"file" entry:
 *
 *   - detectTargetDrifts() throws INSTALL_TARGETS_INVALID for that WHOLE
 *     adapter and turns it into a single severity:'error' finding — real
 *     block drift in that adapter goes UNDETECTED, silently, for every
 *     block entry in it.
 *   - computeInstallTargetsSummary() marks the adapter `valid: false`.
 *
 * BLOQUEADOR DA T-08 (core/specs/018-install-whole-files/plan.md,
 * registrado 2026-08-21): T-08 declares the 19 hooks/commands as
 * kind:"file" entries in the `claude` adapter — the instant that lands,
 * `soma doctor` stops watching block drift in EXACTLY the adapter T-08
 * instruments, and "OK: No drift detected." is replaced by a masking
 * error. This is the spec's own root-cause disease (a check that stops
 * running, silently) reproduced by the spec's own later task.
 *
 * Fix: both call sites migrate to install/targets.cjs's
 * loadInstallTargetsWithKinds() — the same composition D-018-06 already
 * gave sync.cjs — and process ONLY kind:"block" entries. Block-world
 * behavior for adapters with ZERO file entries must be byte-identical
 * (see doctor-block-world-unchanged.test.cjs for that proof).
 *
 * @task T-06 (follow-up, assigned by team-lead after T-06's own report)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DOCTOR_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'doctor.cjs');
const doctor = require(DOCTOR_CJS);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Self-contained soma-home fixture, ONE adapter, declaring:
 *   - one kind:"block" entry with a GENUINE, real drift — legacy-format
 *     markers in the target (the D3 scenario already exercised elsewhere
 *     in this codebase: markers present but missing version=/sha256=
 *     attrs -> severity:'drift', "Anchor markers exist but lack
 *     id/version/sha256 attributes"). This is the part that must NOT
 *     silently disappear.
 *   - one kind:"file" entry — content/target irrelevant to this bug; its
 *     mere DECLARATION is what trips the old loader.
 */
function buildMixedFixture() {
  const root = mkTmp('soma-t06b-mixed-');
  const somaHome = path.join(root, 'soma-home');
  const targetDir = path.join(root, 'installed');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(path.join(somaHome, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', files: [] }, null, 2));

  const sourceDocRel = 'docs/demo-source.md';
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  const blockMarkup = '<!-- demo-block:start -->\nOriginal content\n<!-- demo-block:end -->\n';
  fs.writeFileSync(path.join(somaHome, sourceDocRel), blockMarkup);

  const blockTargetPathAbs = path.join(targetDir, 'block-target.md');
  // Legacy-format target (no version=/sha256= attrs) -> real drift,
  // independent of whether the inner content also differs.
  fs.writeFileSync(blockTargetPathAbs, blockMarkup);

  const fileSourceRel = 'demo-file-source.cjs';
  fs.writeFileSync(path.join(somaHome, fileSourceRel), 'module.exports = {};\n');
  const fileTargetPathAbs = path.join(targetDir, 'file-target.cjs'); // deliberately never written

  const adapterDir = path.join(somaHome, 'adapters', 'mixed-tool');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    entries: [
      {
        block_id: 'demo-block',
        source_doc: sourceDocRel,
        target_path: blockTargetPathAbs,
        target_anchor_id: 'demo-block',
      },
      { kind: 'file', source_path: fileSourceRel, target_path: fileTargetPathAbs },
    ],
  }, null, 2));

  return { somaHome, blockTargetPathAbs, fileTargetPathAbs };
}

test('T-06B-01 (regression, block-drift blindness): detectTargetDrifts() must still detect a real block drift when the SAME adapter also declares a kind:"file" entry', () => {
  const { somaHome, blockTargetPathAbs } = buildMixedFixture();
  const findings = doctor.detectTargetDrifts(somaHome, ['mixed-tool']);

  const blockDrift = findings.find((f) => f.kind === 'target_drift' && f.target_anchor_id === 'demo-block');
  assert.ok(blockDrift,
    `expected a target_drift finding for the block entry, got: ${JSON.stringify(findings)}`);
  assert.equal(blockDrift.severity, 'drift');
  assert.equal(blockDrift.target_path, blockTargetPathAbs);
  assert.match(blockDrift.message, /lack id\/version\/sha256 attributes/);

  const crashFinding = findings.find((f) => f.severity === 'error' && f.adapter === 'mixed-tool');
  assert.equal(crashFinding, undefined,
    `adapter must not ALSO be reported INSTALL_TARGETS_INVALID once block drift is correctly detected: ${JSON.stringify(findings)}`);
});

test('T-06B-02 (regression): computeInstallTargetsSummary must not mark an adapter invalid just because it also declares a kind:"file" entry', () => {
  const { somaHome } = buildMixedFixture();
  const summary = doctor.computeInstallTargetsSummary(somaHome, ['mixed-tool']);
  assert.equal(summary.valid, true, `expected valid:true, got: ${JSON.stringify(summary)}`);
});

test('T-06B-03 (sanity, must hold both before and after the fix): an adapter with ONLY block entries (no kind:"file" at all) is unaffected', () => {
  const root = mkTmp('soma-t06b-blockonly-');
  const somaHome = path.join(root, 'soma-home');
  const targetDir = path.join(root, 'installed');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', files: [] }, null, 2));
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  const blockMarkup = '<!-- demo-block:start -->\nOriginal content\n<!-- demo-block:end -->\n';
  fs.writeFileSync(path.join(somaHome, 'docs', 'demo-source.md'), blockMarkup);
  const blockTargetPathAbs = path.join(targetDir, 'block-target.md');
  fs.writeFileSync(blockTargetPathAbs, blockMarkup);
  const adapterDir = path.join(somaHome, 'adapters', 'block-only-tool');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    entries: [
      { block_id: 'demo-block', source_doc: 'docs/demo-source.md', target_path: blockTargetPathAbs, target_anchor_id: 'demo-block' },
    ],
  }, null, 2));

  const findings = doctor.detectTargetDrifts(somaHome, ['block-only-tool']);
  const blockDrift = findings.find((f) => f.kind === 'target_drift' && f.target_anchor_id === 'demo-block');
  assert.ok(blockDrift, `expected block drift to be detected on a block-only adapter, got: ${JSON.stringify(findings)}`);
  assert.equal(blockDrift.severity, 'drift');

  const summary = doctor.computeInstallTargetsSummary(somaHome, ['block-only-tool']);
  assert.equal(summary.valid, true);
  assert.equal(summary.count, 1);
});
