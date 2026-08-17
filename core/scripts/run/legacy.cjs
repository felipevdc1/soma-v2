'use strict';
/**
 * run/legacy.cjs — shared AC-08 helper for `soma run`'s verbs (Spec 016, T-14)
 *
 * NOT a verb. `run.cjs`'s `VERBS` array is closed at five (`state`,
 * `report`, `gate`, `resume`, `dispatch-record`) since T-01, and the
 * dispatcher checks `fs.existsSync(run/{verb}.cjs)` against that exact
 * list — a `legacy.cjs` registered as a sixth verb would never be routed.
 * It is also not a standalone module with no consumer (would ship dead).
 * It is a CROSS-CUTTING helper the three verbs that touch `.soma/` on read
 * or write (`state`, `report`, `gate`) each `require()` — see plan.md's
 * "`run/legacy.cjs` (T-14) é módulo compartilhado, NÃO verbo" note, which
 * resolves the exact ambiguity this file exists to close.
 *
 * AC-08 (spec.md): "WHERE o projeto não possui diretório `.soma/`, the
 * soma-run SHALL executar em modo legado emitindo warning em vez de
 * falhar." That's the whole `soma-run` orchestration, not one verb in
 * isolation — hence: shared helper, not per-verb duplication.
 *
 * State this file inherited: `state.cjs` (T-08) already had this exact
 * check inline as `warnIfLegacy`, consuming `isLegacyProject()` from
 * `paths.cjs`. `report.cjs` and `gate.cjs` had none — AC-08 coverage was
 * partial and silent (one verb warned, two didn't). This file extracts
 * the helper verbatim out of state.cjs and wires all three to it, so the
 * warning fires identically regardless of which verb is the first one a
 * legacy project happens to call.
 *
 * Consumes `isLegacyProject()` from `paths.cjs` — does not edit that file
 * (explicit scope boundary for T-14).
 *
 * @spec [SPEC:AC-08]
 * @task T-14
 */

const { isLegacyProject } = require('./paths.cjs');

/**
 * Warn on stderr when `projectRoot` predates the trilho (no `.soma/` yet).
 * Pure detection + warning — this function does NOT create `.soma/` itself.
 * Self-heal happens as an emergent property of the verbs' own atomic-write
 * helpers, which already `fs.mkdirSync(dir, { recursive: true })`
 * unconditionally before writing (state.cjs's `writeStateAtomic`,
 * report.cjs's `writeAtomic`) — regardless of legacy status, both already
 * did this before T-14 existed. Duplicating that mkdir here would be a
 * second, redundant source of the same side effect; this helper's only job
 * is naming the degradation (AC-08's "warning nomeando o que está
 * degradado"), never causing or blocking any I/O.
 *
 * `gate.cjs` never writes, so a legacy project with no prior `state --init`
 * still hits its existing, pre-T-14 "report ausente" / module-not-found
 * failure paths after this warning fires — those are pre-existing, legible
 * `fail()` exits (JSON reason, never a stack trace), not the uncontrolled
 * crash-on-missing-directory AC-08 exists to prevent. T-14 only adds the
 * warning; it does not change what any verb does once warned (explicit
 * scope: "só pra ligar o helper — nada além disso").
 *
 * @param {string} projectRoot absolute path to the project root
 * @returns {boolean} true when the warning fired (i.e. the project was legacy)
 */
function warnIfLegacy(projectRoot) {
  if (!isLegacyProject(projectRoot)) return false;
  process.stderr.write(
    'WARN: legacy project (no .soma/ directory found) — degraded mode, ' +
      'bootstrapping .soma/ automatically. Run "soma install" to adopt the ' +
      'full trilho. Ausência de .soma/ nunca é erro fatal (AC-08).\n'
  );
  return true;
}

module.exports = { warnIfLegacy };
