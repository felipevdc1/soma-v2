'use strict';
/**
 * install/files.cjs — pure logic for `kind: "file"` install-targets entries
 * (Spec 018, T-01)
 *
 * The install/sync/doctor machinery is today entirely block-anchored: every
 * entry has `block_id`/`source_doc`/`target_path`/`target_anchor_id`, and
 * conflict detection requires an anchor to separate the SOMA-owned region
 * from user edits around it. This module is the paired-down, anchor-free
 * path for entries that declare `kind: "file"` — copy a whole file
 * byte-for-byte instead of a block inside one.
 *
 * Everything here is pure decision logic with no CLI/argv parsing and no
 * knowledge of `sync.cjs`, `install.cjs`, or `doctor.cjs` — those three
 * consumers (T-05/T-06/T-07) call into this module; this module never calls
 * out to them. That is what keeps the clean-vs-diverged decision defined
 * exactly once instead of drifting into three copies (plan.md's rationale
 * for why T-01 exists standalone, and the `.soma.lock` triplication in spec
 * 016 that this task is explicitly avoiding).
 *
 * Deliberately in `core/scripts/install/`, NOT `core/scripts/lib/` — D-018-03.
 * Historical note: the reason recorded in D-018-03 was the
 * `git diff main -- core/scripts/lib/` tripwire (one assertion in
 * `manifest.test.cjs`, another in `frozen-libs-invariant-014.test.cjs`),
 * which lit +2 fails on any worktree touching `lib/`. That tripwire was
 * REMOVED — see the commit carrying this comment change. The real 014
 * invariant is still live in the three sha256 tests against baseline
 * f3c2f0b, and reaches only the three frozen libs. This module's location
 * was NOT revisited by that change.
 *
 * @contract core/specs/018-install-whole-files/contracts/install-file-entry.md (CONTRACT-FILE-ENTRY-01)
 * @contract core/specs/018-install-whole-files/contracts/installed-files-ledger.md (CONTRACT-FILES-LEDGER-02)
 * @plan core/specs/018-install-whole-files/plan.md §"Superfície fixada (2026-08-17)"
 * @task T-01
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// ── Entry validation (CONTRACT-FILE-ENTRY-01) ──────────────────────────────

/** The only two `kind` values this schema recognizes. Anything else is a
 * validation error, never a silent default (D-018-01). */
const VALID_KINDS = ['file', 'block'];

/** Fields that belong to the block world and are meaningless — and
 * dangerous — on a file entry. `target_anchor_id` in particular is almost
 * certainly a malformed block entry; treating it as a file entry would
 * overwrite the whole target (e.g. the user's CLAUDE.md). Presence is
 * rejected outright, never ignored. */
const FORBIDDEN_FILE_FIELDS = ['target_anchor_id', 'source_doc', 'block_id'];

/**
 * True when any path segment is exactly `..`. Checked on the raw string,
 * before any `path.join`/`path.resolve` call — the contract requires `..`
 * to be rejected "antes de qualquer path ser construído".
 *
 * @param {string} p
 * @returns {boolean}
 */
function hasDotDotSegment(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  return p.split(/[\\/]/).some((seg) => seg === '..');
}

/**
 * Expand a leading `~` to the real home directory. Same convention already
 * used for block `target_path` values (bootstrap.cjs, lib/manifest.cjs).
 * Non-`~` paths pass through unchanged.
 *
 * @param {string} p
 * @returns {string}
 */
function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * `(entry.kind || 'block') === 'file'` — the discriminator, in one place,
 * so no consumer re-derives it differently.
 *
 * @param {object} entry
 * @returns {boolean}
 */
function isFileEntry(entry) {
  return !!entry && (entry.kind === undefined ? 'block' : entry.kind) === 'file';
}

/**
 * Validate one install-targets entry against CONTRACT-FILE-ENTRY-01.
 *
 * Entries without `kind` (or with `kind: "block"`) are the existing block
 * world — this function returns them untouched (only `kind` is made
 * explicit). Block-entry validation itself is owned by the schema gate
 * `sync.cjs` already has (`sync.cjs:1130`); this module does not duplicate
 * it (AC-02: the 8 existing entries must not change behavior).
 *
 * For `kind: "file"` entries, throws on:
 *   - unknown `kind` (anything other than "file"/"block") — never a silent
 *     default
 *   - missing/empty `source_path` or `target_path`
 *   - forbidden fields present: `target_anchor_id`, `source_doc`, `block_id`
 *   - `..` in `source_path` or `target_path`
 *   - `target_path` that is neither absolute nor `~`-prefixed
 *   - when `opts.repoRoot` is given: `source_path` resolves outside
 *     `repoRoot`, or does not exist under it
 *
 * `opts.repoRoot` is optional so shape-only validation (contract stub case
 * 2) does not require a real repo fixture; callers that need the existence
 * guarantee (contract stub case 5, and `planFileInstall` below) pass it.
 *
 * @param {object} entry
 * @param {{ repoRoot?: string }} [opts]
 * @returns {object} the entry, with `kind` made explicit
 * @throws {Error}
 */
function validateFileEntry(entry, opts = {}) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('validateFileEntry: entry must be a non-null object');
  }

  const kind = entry.kind === undefined ? 'block' : entry.kind;
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(
      `validateFileEntry: unknown kind "${entry.kind}" — must be "file" or "block" (or omitted, which means "block")`
    );
  }

  if (kind === 'block') {
    // Not this module's concern beyond making `kind` explicit — block
    // entries are validated by sync.cjs's existing schema gate.
    return { ...entry, kind: 'block' };
  }

  // kind === 'file' from here on.
  for (const field of FORBIDDEN_FILE_FIELDS) {
    if (entry[field] !== undefined) {
      throw new Error(
        `validateFileEntry: kind:"file" entry must not have "${field}" — that is a block-world field ` +
        `(most likely this is a malformed block entry missing its "kind", not a real file entry)`
      );
    }
  }

  if (typeof entry.source_path !== 'string' || entry.source_path.length === 0) {
    throw new Error('validateFileEntry: kind:"file" entry requires non-empty "source_path"');
  }
  if (typeof entry.target_path !== 'string' || entry.target_path.length === 0) {
    throw new Error('validateFileEntry: kind:"file" entry requires non-empty "target_path"');
  }

  if (hasDotDotSegment(entry.source_path)) {
    throw new Error(`validateFileEntry: source_path must not contain ".." — got "${entry.source_path}"`);
  }
  if (hasDotDotSegment(entry.target_path)) {
    throw new Error(`validateFileEntry: target_path must not contain ".." — got "${entry.target_path}"`);
  }

  if (!path.isAbsolute(entry.target_path) && !entry.target_path.startsWith('~')) {
    throw new Error(
      `validateFileEntry: target_path must be absolute or start with "~" — got "${entry.target_path}"`
    );
  }

  if (opts.repoRoot) {
    const repoRootAbs = path.resolve(opts.repoRoot);
    const sourcePathAbs = path.resolve(repoRootAbs, entry.source_path);
    // Defense in depth beyond the literal ".." check above: an absolute
    // source_path (or a resolved path that otherwise lands outside the
    // repo) must not silently read from anywhere on disk. Not spelled out
    // verbatim in the contract's field table, but consistent with its
    // stated invariant that the mechanism never touches what an entry did
    // not declare.
    const withinRepo =
      sourcePathAbs === repoRootAbs || sourcePathAbs.startsWith(repoRootAbs + path.sep);
    if (!withinRepo) {
      throw new Error(
        `validateFileEntry: source_path escapes repoRoot — "${entry.source_path}" resolves to ${sourcePathAbs}, outside ${repoRootAbs}`
      );
    }
    if (!fs.existsSync(sourcePathAbs)) {
      throw new Error(`validateFileEntry: source_path does not exist in repo: "${entry.source_path}"`);
    }
  }

  return { ...entry, kind: 'file' };
}

// ── Content identity (D-018-04) ────────────────────────────────────────────

/**
 * sha256 hex digest of a string/Buffer.
 * @param {string|Buffer} content
 * @returns {string} 64-char hex digest
 */
function sha256OfContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * sha256 hex digest of a file's current on-disk content.
 * @param {string} absPath
 * @returns {string} 64-char hex digest
 * @throws {Error} if the file cannot be read
 */
function sha256OfFile(absPath) {
  let content;
  try {
    content = fs.readFileSync(absPath);
  } catch (err) {
    throw new Error(`sha256OfFile: cannot read ${absPath}: ${err.message}`);
  }
  return sha256OfContent(content);
}

// ── Clean-vs-diverged decision (CONTRACT-FILES-LEDGER-02) ─────────────────

/**
 * Classify one target against the ledger, per CONTRACT-FILES-LEDGER-02's
 * "A decisão limpo-vs-divergido" table:
 *
 *   | disk state | ledger match | verdict  |
 *   | absent     | —            | clean    |
 *   | present    | sha256 match | clean    |
 *   | present    | sha256 diff  | diverged |
 *   | present    | no entry     | diverged |
 *
 * The last row matters: a file that exists but was never recorded by SOMA
 * is not SOMA's to overwrite — that is exactly the AC-04 protection.
 *
 * @param {string} targetPathAbs   already home-expanded, absolute path
 * @param {{ sha256: string, installedAt: string }|undefined} ledgerEntry
 * @returns {'clean'|'diverged'}
 */
function classifyFileState(targetPathAbs, ledgerEntry) {
  if (!fs.existsSync(targetPathAbs)) return 'clean';
  if (!ledgerEntry) return 'diverged';
  const actual = sha256OfFile(targetPathAbs);
  return actual === ledgerEntry.sha256 ? 'clean' : 'diverged';
}

/**
 * Two-pass planning, pass one: evaluate every file entry against the
 * ledger, write nothing, and report the full set of diverged targets — not
 * just the first (CONTRACT-FILES-LEDGER-02 §"Abort total (AC-04)": "Nomear
 * todos, não o primeiro").
 *
 * The caller (T-07's `sync.cjs` wiring) decides pass two from `result.ok`:
 * write every `plan[]` entry when `true`, write nothing when `false`.
 *
 * Each plan entry also carries `needsWrite`, the idempotency decision
 * (CONTRACT-FILES-LEDGER-02 stub case 9: a second run with no repo changes
 * must produce zero writes). True only when the entry is clean AND either:
 *   - the target is missing from disk (always needs its first/renewed
 *     write, no matter what the ledger says — recovery after deletion,
 *     otherwise a deleted-but-recorded file silently never comes back), or
 *   - the target is present but its content no longer matches what the
 *     ledger recorded as last installed (source changed since then).
 * A clean, present, matching entry needs no write even though AC-03
 * permits overwriting it — "permits" is not "requires". `state` itself
 * (clean/diverged) stays exactly the contract's 2-value table — it does
 * NOT distinguish "never written" from "present and matching"; needsWrite
 * is the layer that does, by also consulting disk existence.
 *
 * @param {object[]} entries       raw install-targets entries (block entries are skipped)
 * @param {{ repoRoot: string, ledger?: object }} opts
 * @returns {{
 *   ok: boolean,
 *   diverged: string[],
 *   plan: Array<{
 *     source_path: string, target_path: string,
 *     sourcePathAbs: string, targetPathAbs: string,
 *     state: 'clean'|'diverged', sourceSha256: string, needsWrite: boolean,
 *   }>,
 * }}
 * @throws {Error} if any entry fails validateFileEntry (a malformed entry
 *   is a configuration bug, a different class of problem than "diverged",
 *   and must never be silently skipped)
 */
function planFileInstall(entries, opts = {}) {
  if (!opts.repoRoot) {
    throw new Error('planFileInstall: opts.repoRoot is required');
  }
  const repoRootAbs = path.resolve(opts.repoRoot);
  const ledger = opts.ledger && typeof opts.ledger === 'object' ? opts.ledger : {};

  const diverged = [];
  const plan = [];

  for (const rawEntry of entries || []) {
    const entry = validateFileEntry(rawEntry, { repoRoot: repoRootAbs });
    if (entry.kind !== 'file') continue; // block entries are not this module's concern

    const sourcePathAbs = path.resolve(repoRootAbs, entry.source_path);
    const targetPathAbs = expandHome(entry.target_path);
    const sourceSha256 = sha256OfFile(sourcePathAbs);
    // Ledger is keyed by target_path verbatim (contract: "chave = O
    // target_path da entry, verbatim" — the operation is lookup by path).
    const ledgerEntry = ledger[entry.target_path];
    // Read disk existence once, before classifyFileState does its own
    // (separate) existsSync check — needed below to distinguish "clean
    // because never written" from "clean because present and matching",
    // which classifyFileState deliberately does NOT distinguish (that is
    // the contract's decision table, and it stays a 2-value table).
    const targetExists = fs.existsSync(targetPathAbs);
    const state = classifyFileState(targetPathAbs, ledgerEntry);

    if (state === 'diverged') diverged.push(entry.target_path);

    // needsWrite is the idempotency decision, one level below `state`: a
    // target missing from disk always needs (re)writing regardless of what
    // the ledger says (recovery after deletion — bug found in review: the
    // old version compared only ledger-vs-source and silently treated a
    // deleted-but-recorded file as "nothing to do"). A present-and-clean
    // target only needs rewriting when its source has changed since the
    // ledger was last updated.
    const needsWrite = state === 'clean' && (!targetExists || !ledgerEntry || ledgerEntry.sha256 !== sourceSha256);

    plan.push({
      source_path: entry.source_path,
      target_path: entry.target_path,
      sourcePathAbs,
      targetPathAbs,
      state,
      sourceSha256,
      needsWrite,
    });
  }

  return { ok: diverged.length === 0, diverged, plan };
}

// ── Ledger read/write (CONTRACT-FILES-LEDGER-02) ───────────────────────────

/**
 * ISO-8601 UTC timestamp with no milliseconds, matching install.cjs's own
 * `ISO_UTC_RE` (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`) — the field this
 * ledger entry's `installedAt` shares a format contract with.
 * @returns {string}
 */
function nowIsoUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build one ledger entry — CONTRACT-FILES-LEDGER-02's Payload shape.
 *
 * @param {string} sha256  64-char hex digest of the content that was WRITTEN
 *   (never of whatever was on disk before) — that distinction is what makes
 *   AC-06 true.
 * @param {string} [installedAt] ISO-8601 UTC; defaults to now. Accepts an
 *   override so tests stay deterministic.
 * @returns {{ sha256: string, installedAt: string }}
 * @throws {Error} if sha256 is not a well-formed 64-char hex digest
 */
function buildLedgerEntry(sha256, installedAt = nowIsoUtc()) {
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`buildLedgerEntry: sha256 must be a 64-char hex string, got: ${JSON.stringify(sha256)}`);
  }
  return { sha256, installedAt };
}

/**
 * @param {string} projectRootAbs
 * @returns {string} absolute path to <projectRoot>/.soma/install-state.json
 */
function ledgerFilePath(projectRootAbs) {
  return path.join(projectRootAbs, '.soma', 'install-state.json');
}

/**
 * Read the `installedFiles` ledger out of a project's install-state.json.
 *
 * Distinguishes "never installed" (`installed: false`, no state file at
 * all) from "installed but no files recorded yet" (`installed: true`,
 * `installedFiles: {}`) — AC-10's exact requirement: "silêncio de check que
 * não rodou é indistinguível de silêncio de check limpo" is the failure
 * this return shape exists to prevent. `doctor.cjs` (T-06) is the
 * consumer that needs this distinction to say "nunca instalado" instead of
 * a false "No drift detected".
 *
 * This function only reads the `installedFiles` field. It does not run
 * `install.cjs`'s `validateInstallState` (the full-state whitelist/schema
 * check) — that validation is install.cjs's own responsibility (T-05
 * extends its `ALLOWED_STATE_FIELDS`), and this module intentionally does
 * not depend on install.cjs (that dependency runs the other direction:
 * install.cjs will require this module, not vice versa).
 *
 * @param {string} projectRootAbs
 * @returns {{ installed: boolean, installedFiles: object }}
 * @throws {Error} if install-state.json exists but is not valid JSON
 */
function readLedger(projectRootAbs) {
  const stateFile = ledgerFilePath(projectRootAbs);
  if (!fs.existsSync(stateFile)) {
    return { installed: false, installedFiles: {} };
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (err) {
    throw new Error(`readLedger: ${stateFile} exists but is not valid JSON: ${err.message}`);
  }

  const installedFiles =
    state && typeof state.installedFiles === 'object' && state.installedFiles !== null && !Array.isArray(state.installedFiles)
      ? state.installedFiles
      : {};

  return { installed: true, installedFiles };
}

/**
 * Write the `installedFiles` ledger into a project's install-state.json,
 * preserving whatever other top-level fields the file already has (this
 * module does not own the rest of the state schema — install.cjs does).
 *
 * Atomic write-to-temp-then-rename, mode 0644, pretty JSON with a trailing
 * newline — the same pattern install.cjs's own `writeInstallState` already
 * uses, deliberately not reinvented differently here.
 *
 * @param {string} projectRootAbs
 * @param {object} installedFiles  plain object keyed by target_path
 * @returns {string} absolute path written
 * @throws {Error} if installedFiles is not a plain object, or the existing
 *   state file exists but is not valid JSON
 */
function writeLedger(projectRootAbs, installedFiles) {
  if (!installedFiles || typeof installedFiles !== 'object' || Array.isArray(installedFiles)) {
    throw new Error('writeLedger: installedFiles must be a plain object keyed by target_path');
  }

  const somaDir = path.join(projectRootAbs, '.soma');
  fs.mkdirSync(somaDir, { recursive: true });
  const finalPath = ledgerFilePath(projectRootAbs);

  let state = {};
  if (fs.existsSync(finalPath)) {
    try {
      state = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
    } catch (err) {
      throw new Error(`writeLedger: ${finalPath} exists but is not valid JSON: ${err.message}`);
    }
  }
  state.installedFiles = installedFiles;

  const tmpSuffix = crypto.randomBytes(4).toString('hex');
  const tmpPath = path.join(somaDir, `install-state.json.tmp.${tmpSuffix}`);
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(tmpPath, finalPath);

  return finalPath;
}

module.exports = {
  VALID_KINDS,
  FORBIDDEN_FILE_FIELDS,
  hasDotDotSegment,
  expandHome,
  isFileEntry,
  validateFileEntry,
  sha256OfContent,
  sha256OfFile,
  classifyFileState,
  planFileInstall,
  nowIsoUtc,
  buildLedgerEntry,
  ledgerFilePath,
  readLedger,
  writeLedger,
};
