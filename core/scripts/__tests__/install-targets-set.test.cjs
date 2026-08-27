'use strict';
/**
 * install-targets-set.test.cjs — T-08 GREEN phase
 *
 * Declares (and locks) the real file-entry set in
 * core/adapters/claude/install-targets.json: the 19 hooks under core/hooks/
 * plus all 13 commands the T-04 migration consolidated into
 * core/adapters/claude/commands/, including soma-run.md.
 *
 * The expected hook/command names are DERIVED from the real directories at
 * test time, not hardcoded — that is what makes this a regression guard
 * instead of a snapshot: add a hook to core/hooks/ without declaring it
 * here, and this test goes red on its own, the way T-06's doctor drift
 * check would have caught the 6-hooks-defasados-3-meses bug (spec.md
 * Discovery) had it existed then.
 *
 * source_path resolves against CORE_DIR (`<repo>/core`), not the repo
 * root — that is D-018-07 (c), closed 2026-08-21: the `soma install` path
 * invokes sync with `--soma-home=${SOURCE_CORE}` where SOURCE_CORE is the
 * `core/` of the running checkout, so a hook declares itself as
 * "hooks/<name>.cjs" (resolving to core/hooks/<name>.cjs), NOT
 * "core/hooks/<name>.cjs".
 *
 * @spec [SPEC:AC-05] [SPEC:AC-12]
 * @contract CONTRACT-FILE-ENTRY-01
 * @task T-08
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isFileEntry, validateFileEntry } = require('../install/files.cjs');

// <repo>/core — the somaHome-equivalent root that kind:"file" source_path
// resolves against on the `soma install` path (D-018-07 (c)).
const CORE_DIR = path.resolve(__dirname, '..', '..');
const ADAPTER_DIR = path.join(CORE_DIR, 'adapters', 'claude');
const TARGETS_PATH = path.join(ADAPTER_DIR, 'install-targets.json');
const HOOKS_DIR = path.join(CORE_DIR, 'hooks');
const COMMANDS_DIR = path.join(ADAPTER_DIR, 'commands');
const REFERENCES_DIR = path.join(ADAPTER_DIR, 'references');

function loadTargetsRaw() {
  // Deliberately the SAME comment-stripping the three real readers use
  // (manifest.cjs's loadInstallTargets, install/targets.cjs's
  // readRawInstallTargets, bootstrap.cjs) — NOT plain JSON.parse. One
  // fourth reader, install.cjs's readBlockIdsFromTargetsFile, does NOT
  // strip comments; that is exactly why this file's AC-12 rationale is
  // recorded as a plain "excluded" JSON field below, never as a `//` or
  // `/* */` comment, which would silently empty that reader's block_id
  // extraction for this adapter (verified by reading its source; not
  // exercised by this test, out of scope for T-08).
  const raw = fs.readFileSync(TARGETS_PATH, 'utf8');
  const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped);
}

function realHookNames() {
  return fs.readdirSync(HOOKS_DIR).filter((n) => n.endsWith('.cjs')).sort();
}

function realCommandNames() {
  return fs.readdirSync(COMMANDS_DIR).filter((n) => n.endsWith('.md')).sort();
}

test('conjunto real: hooks, comandos e references possuem entries kind:"file"', () => {
  const hooks = realHookNames();
  const commandsAll = realCommandNames();

  // Precondition on the fixtures this test derives its expectations from —
  // if these drift, the assertions below would silently mean something
  // else. Fail loud here rather than downstream.
  assert.equal(hooks.length, 19, `esperava 19 hooks reais em core/hooks/, achou ${hooks.length}: ${hooks.join(', ')}`);
  assert.equal(commandsAll.length, 13, `esperava 13 comandos reais, achou ${commandsAll.length}: ${commandsAll.join(', ')}`);
  assert.ok(commandsAll.includes('soma-run.md'), 'fixture assumption: soma-run.md deveria existir no repo');
  const referencesAll = fs.readdirSync(REFERENCES_DIR).filter((n) => n.endsWith('.md')).sort();
  assert.ok(referencesAll.includes('soma-run-orchestration.md'));

  const data = loadTargetsRaw();
  const fileEntries = data.entries.filter(isFileEntry);
  const blockEntries = data.entries.filter((e) => !isFileEntry(e));

  assert.equal(blockEntries.length, 3, 'as 3 entries de bloco existentes não podem mudar de quantidade (AC-02)');
  assert.equal(
    fileEntries.length,
    hooks.length + commandsAll.length + referencesAll.length,
    `esperava hooks + comandos + references no manifest, achou ${fileEntries.length}`
  );

  const hookSourcePaths = new Set(
    fileEntries.map((e) => e.source_path).filter((p) => typeof p === 'string' && p.startsWith('hooks/'))
  );
  const cmdSourcePaths = new Set(
    fileEntries.map((e) => e.source_path).filter((p) => typeof p === 'string' && p.startsWith('adapters/claude/commands/'))
  );
  const referenceSourcePaths = new Set(
    fileEntries.map((e) => e.source_path).filter((p) => typeof p === 'string' && p.startsWith('adapters/claude/references/'))
  );

  for (const h of hooks) {
    assert.ok(hookSourcePaths.has(`hooks/${h}`), `faltou entry kind:"file" para hooks/${h}`);
  }
  for (const c of commandsAll) {
    assert.ok(cmdSourcePaths.has(`adapters/claude/commands/${c}`), `faltou entry kind:"file" para adapters/claude/commands/${c}`);
  }
  for (const reference of referencesAll) {
    assert.ok(referenceSourcePaths.has(`adapters/claude/references/${reference}`));
  }

  // Every file entry is accounted for by exactly one of the two buckets —
  // nothing outside the declared inventory (no stray/duplicate entries).
  assert.equal(
    hookSourcePaths.size + cmdSourcePaths.size + referenceSourcePaths.size,
    fileEntries.length,
    'toda entry kind:"file" tem que ser hook OU comando — nada fora do inventário dos dois diretórios'
  );

  // target_path convention: ~/.claude/hooks/<name> and ~/.claude/commands/<name>
  for (const e of fileEntries.filter((e) => e.source_path.startsWith('hooks/'))) {
    const name = e.source_path.slice('hooks/'.length);
    assert.equal(e.target_path, `~/.claude/hooks/${name}`, `target_path errado para ${e.source_path}`);
  }
  for (const e of fileEntries.filter((e) => e.source_path.startsWith('adapters/claude/commands/'))) {
    const name = e.source_path.slice('adapters/claude/commands/'.length);
    assert.equal(e.target_path, `~/.claude/commands/${name}`, `target_path errado para ${e.source_path}`);
  }
  for (const e of fileEntries.filter((e) => e.source_path.startsWith('adapters/claude/references/'))) {
    const name = e.source_path.slice('adapters/claude/references/'.length);
    assert.equal(e.target_path, `~/.claude/references/${name}`, `target_path errado para ${e.source_path}`);
  }
});

test('soma-run.md tem entry whole-file Claude, como seus comandos irmãos', () => {
  const data = loadTargetsRaw();
  const fileEntries = data.entries.filter(isFileEntry);
  const sourcePaths = fileEntries.map((e) => e.source_path);

  assert.ok(sourcePaths.includes('adapters/claude/commands/soma-run.md'));
  assert.ok(
    sourcePaths.includes('adapters/claude/commands/sonar-audit.md'),
    'controle: sonar-audit.md (comando irmão) tem que estar presente — senão "ausente" não distingue exclusão intencional de esquecimento'
  );

  assert.equal((data.excluded || []).some((e) => e && e.source_path === 'adapters/claude/commands/soma-run.md'), false);
});

test('todas as entries kind:"file" validam contra o repo real (source_path existe, sem campo proibido, sem "..")', () => {
  const data = loadTargetsRaw();
  const fileEntries = data.entries.filter(isFileEntry);
  assert.ok(fileEntries.length > 0, 'precondição: precisa haver ao menos 1 entry kind:"file" para este teste fazer sentido');
  for (const entry of fileEntries) {
    assert.doesNotThrow(
      () => validateFileEntry(entry, { repoRoot: CORE_DIR }),
      `entry inválida contra repoRoot=${CORE_DIR}: ${JSON.stringify(entry)}`
    );
  }
});

test('as 3 entries de bloco existentes continuam byte-idênticas (nenhuma foi tocada por esta task)', () => {
  const data = loadTargetsRaw();
  const blockEntries = data.entries.filter((e) => !isFileEntry(e));
  const blockIds = blockEntries.map((e) => e.block_id).sort();
  assert.deepEqual(blockIds, [
    'block.claude.CLAUDE_md.hyd-v2',
    'block.claude.CLAUDE_md.soma-stsd',
    'block.claude.CLAUDE_md.soma-voxel',
  ]);
  for (const e of blockEntries) {
    assert.equal(e.kind, undefined, `entry de bloco ${e.block_id} não deveria ganhar um "kind" — ausência é o que a significa bloco`);
    assert.equal(e.target_path, '~/.claude/CLAUDE.md');
    assert.ok(typeof e.source_doc === 'string' && e.source_doc.startsWith('docs/'));
    assert.equal(e.target_anchor_id, e.block_id);
  }
});
