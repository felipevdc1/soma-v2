'use strict';
/**
 * run/retention.cjs — 7-day retention sweep for DONE runs (Spec 016, T-17)
 *
 * NOT a verb. `run.cjs`'s `VERBS` array is closed at five (`state`,
 * `report`, `gate`, `resume`, `dispatch-record`) since T-01, and the
 * dispatcher checks `fs.existsSync(run/{verb}.cjs)` against that exact
 * list — a `retention.cjs` registered as a sixth verb would never be
 * routed. It is also not a standalone module with no consumer (would ship
 * dead) — see plan.md's "`run/retention.cjs` (T-17) é módulo com gatilho no
 * `state --set DONE`" note, the exact precedent `run/legacy.cjs` (T-14)
 * already set for this shape of cross-cutting module.
 *
 * AC-12 (spec.md): "WHEN um run atinge o estado DONE, the soma-run SHALL
 * aplicar aos artefatos de dispatch a mesma janela de retenção de 7 dias já
 * praticada para o state file." The only place a run reaches DONE is
 * `soma run state --set DONE` — `state.cjs` is wired to call
 * `sweepExpiredArtifacts()` there, and nowhere else touches this module.
 *
 * Contract: contracts/persist-run-state.md §Retenção (AC-12) — "Uma regra
 * só, aplicada a state, reports e dispatches." One clock, one threshold,
 * applied identically to all three artifact kinds for a given run — this
 * file does not invent a second retention policy.
 *
 * ── Design: age is the run-state FILE's own mtime, not each report/
 *    dispatch file's individual mtime ─────────────────────────────────────
 * Report and dispatch files are written THROUGHOUT a run's lifetime, often
 * well before DONE — aging them independently would make a run's OWN
 * artifacts eligible for deletion the moment it finishes, if any of its
 * reports happened to be more than 7 days old by then (a long-running spec
 * easily produces this). That is exactly the catastrophic false-positive
 * this module exists to avoid: deleting is irreversible (Article VI has no
 * exception for this file — this is the one module in the phase that
 * destroys data). The run-state file's mtime does not have that problem:
 * `state.cjs`'s `writeStateAtomic()` rewrites it atomically on every
 * `--set`, so the instant a run reaches DONE its state file's mtime is
 * always "now" — safely far from the 7-day threshold — and it only grows
 * old exactly as real time passes with no further transition, which for a
 * terminal state means "time since DONE". This is also the literal reading
 * of "a mesma janela ... já praticada para o state file": reuse the state
 * file's own clock as the single source of truth for the whole run.
 *
 * ── Safety order — reports/dispatches removed BEFORE the state file ──────
 * A DONE run is re-discoverable (and thus re-sweepable on a later
 * invocation) as long as its state file still exists. Deleting the state
 * file LAST means a partial failure mid-sweep (e.g. a permission error on
 * one directory) never orphans a run in a state where nothing marks it as
 * still-pending-cleanup — the next sweep finds the same DONE state file,
 * still past the threshold, and safely retries whatever remains.
 *
 * ── Symlink / traversal guards ────────────────────────────────────────────
 * Every path this module ever deletes is checked, immediately before
 * removal: (a) it must resolve inside this project's `.soma/` directory —
 * a defensive guard against a crafted or corrupted run-state filename
 * escaping via `../`, and (b) it must not itself be a symlink — a
 * directory symlink swapped in for a run-dir would make a recursive `rm`
 * delete whatever it points to, potentially far outside `.soma/`. Both
 * conditions fail CLOSED: refuse to remove and report why, never guess.
 *
 * NEVER throws, NEVER calls process.exit() — this runs inside another
 * verb's process (mirrors state.cjs's `appendReport()` contract exactly).
 * Every failure is data returned to the caller, not a crash and not a
 * silent no-op.
 *
 * Consumes `resolveSomaPaths()` from `paths.cjs` — does not edit that file.
 *
 * @spec [SPEC:AC-12]
 * @contract CONTRACT-RUN-STATE-02 (persist-run-state.md §Retenção)
 * @task T-17
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveSomaPaths } = require('./paths.cjs');

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Matches state.cjs's resolveSomaPaths() naming convention exactly:
// `{somaDir}/run-state-{runId}.json`.
const RUN_STATE_FILE_RE = /^run-state-(.+)\.json$/;

/**
 * A runId extracted from a run-state filename is a single path COMPONENT
 * (readdir never returns entries containing `/`), but a crafted filename
 * like `run-state-...json` still yields the literal string `".."` after the
 * regex match. `path.join(dispatchesDir, '..')` then resolves to `somaDir`
 * itself — technically still "inside .soma/" by `isInsideSomaDir`'s prefix
 * check, but would make the sweep `rm -rf` the ENTIRE .soma/ tree. Rejected
 * here, before any path is ever built from it, not caught later by the
 * prefix check alone (defense in depth — the contract does not name this
 * edge case, decided conservatively and reported to the team lead).
 */
function isSafeRunId(runId) {
  if (!runId) return false;
  if (runId.includes('/') || runId.includes('\\')) return false;
  if (runId === '.' || runId === '..') return false;
  return true;
}

function safeLstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (_err) {
    return null;
  }
}

/**
 * True only when `target` resolves to `somaDir` itself or somewhere nested
 * inside it. Guards against a run-state filename (hence a derived runId)
 * containing path-traversal segments that would otherwise let a computed
 * reports/dispatches path escape `.soma/`.
 */
function isInsideSomaDir(somaDir, target) {
  const resolvedSoma = path.resolve(somaDir) + path.sep;
  const resolvedTarget = path.resolve(target) + path.sep;
  return resolvedTarget.startsWith(resolvedSoma);
}

/**
 * Removes `target` (file or directory) only when it is safe to: resolves
 * inside `somaDir`, and is not itself a symlink. Already-absent is treated
 * as success (nothing to do), never an error. Never throws.
 *
 * @returns {{removed: boolean, reason?: string}}
 */
function removeSafely(somaDir, target) {
  if (!isInsideSomaDir(somaDir, target)) {
    return { removed: false, reason: `resolves outside ${somaDir}, refusing to remove: ${target}` };
  }

  const st = safeLstat(target);
  if (!st) {
    return { removed: true }; // already absent
  }
  if (st.isSymbolicLink()) {
    return {
      removed: false,
      reason: `is a symlink, refusing to follow it out of .soma/: ${target}`,
    };
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { removed: true };
  } catch (err) {
    return { removed: false, reason: `rm failed for ${target}: ${err.message}` };
  }
}

/**
 * Sweep every DONE run whose state file's mtime is older than the
 * retention window, removing its reports/, dispatches/, and state file
 * together (see module docstring for the age/ordering/safety rationale).
 *
 * @param {{projectRoot: string, now?: Date, retentionMs?: number}} opts
 * @returns {{
 *   swept: Array<{runId: string, ageDays: number}>,
 *   preserved: Array<{runId: string, ageDays: number}>,
 *   skipped: Array<{runId: string, reason: string}>,
 *   errors: Array<{runId: string, reason: string}>,
 * }}
 */
function sweepExpiredArtifacts({ projectRoot, now = new Date(), retentionMs = RETENTION_MS }) {
  const result = { swept: [], preserved: [], skipped: [], errors: [] };

  if (!projectRoot) {
    result.errors.push({ runId: null, reason: 'sweepExpiredArtifacts requires projectRoot' });
    return result;
  }

  const { somaDir } = resolveSomaPaths(projectRoot);

  let entries;
  try {
    entries = fs.readdirSync(somaDir);
  } catch (_err) {
    return result; // no .soma/ yet (legacy project, or nothing has ever run) — nothing to sweep
  }

  for (const entry of entries) {
    const match = RUN_STATE_FILE_RE.exec(entry);
    if (!match) continue;
    const runId = match[1];

    if (!isSafeRunId(runId)) {
      result.skipped.push({ runId, reason: `unsafe runId extracted from filename, refusing to evaluate: ${entry}` });
      continue;
    }

    const runStateFile = path.join(somaDir, entry);

    if (!isInsideSomaDir(somaDir, runStateFile)) {
      result.skipped.push({ runId, reason: `run-state filename resolves outside .soma/: ${entry}` });
      continue;
    }

    const st = safeLstat(runStateFile);
    if (!st || st.isSymbolicLink()) {
      result.skipped.push({
        runId,
        reason: `run-state file unreadable or is a symlink, refusing to evaluate: ${runStateFile}`,
      });
      continue;
    }

    let state;
    try {
      state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    } catch (err) {
      // Corrupt state means we cannot confirm currentState === 'DONE' —
      // never sweep on inability to determine eligibility.
      result.skipped.push({ runId, reason: `run-state file not valid JSON, refusing to sweep: ${err.message}` });
      continue;
    }

    if (!state || state.currentState !== 'DONE') {
      result.skipped.push({ runId, reason: `currentState is not DONE (got "${state && state.currentState}")` });
      continue;
    }

    const ageMs = now.getTime() - st.mtime.getTime();
    const ageDays = ageMs / DAY_MS;

    if (ageMs < retentionMs) {
      result.preserved.push({ runId, ageDays });
      continue;
    }

    const { runReportsDir, runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
    // Order matters, and it's not just "try all three then report": reports/
    // dispatches are removed FIRST, and the state file is only ever touched
    // if BOTH of those succeeded. A loop that attempts every target
    // regardless of earlier failures would remove the state file even when
    // a sibling directory failed (e.g. a symlink) — orphaning the run in a
    // state where nothing marks it as still-needing-cleanup. Stopping short
    // keeps the run discoverable (state file still there, still past the
    // threshold) so the next sweep can safely retry.
    const nonStateFailures = [];
    for (const target of [runReportsDir, runDispatchesDir]) {
      const outcome = removeSafely(somaDir, target);
      if (!outcome.removed) nonStateFailures.push(outcome.reason);
    }

    if (nonStateFailures.length > 0) {
      result.errors.push({ runId, reason: nonStateFailures.join('; ') });
      continue;
    }

    const stateOutcome = removeSafely(somaDir, runStateFile);
    if (!stateOutcome.removed) {
      result.errors.push({ runId, reason: stateOutcome.reason });
      continue;
    }

    result.swept.push({ runId, ageDays });
  }

  return result;
}

module.exports = { sweepExpiredArtifacts, RETENTION_DAYS, RETENTION_MS };
