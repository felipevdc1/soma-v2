'use strict';
/**
 * run/validator-invariant.cjs — executor ≠ validador invariant (Spec 016, T-11)
 *
 * Implements the AC-06 invariant: the agent that validates a task's work
 * can never be the same agent that executed it. `STEP_5_VALIDATE` (via
 * `soma run gate --validate <taskId> --validator <agentName>`, T-07's thin
 * wrapper in run/gate.cjs) is the only caller — this module makes the
 * invariant verifiable against the dispatch-record artifact
 * (CONTRACT-DISPATCH-RECORD-03) instead of depending on the orchestrator
 * remembering who ran what.
 *
 * Signature is FIXED BY CONTRACT — not this task's to choose — see
 * contracts/emit-dispatch-record.md §"Superfície de CLI" and
 * §"Invariante executor ≠ validador (AC-06)":
 *
 *   checkValidatorAssignment({ metadataPath, proposedValidator })
 *     -> { allowed: boolean, reason: string|null }
 *
 * run/gate.cjs (T-07, already landed and NOT edited by this task) destructures
 * `{ checkValidatorAssignment }` from this module's exports — the export name
 * below has to match that exactly, or the wrapper silently breaks.
 *
 * Both sides of the invariant matter equally (plan.md's house rule, echoed
 * in the T-11 dispatch brief): a module that refuses everything passes the
 * "equal" case and is useless; one that accepts everything passes the
 * "different" case and is worse than useless, because it lets the executor
 * validate its own work. Both are tested in
 * core/scripts/__tests__/run-validator-invariant.test.cjs.
 *
 * AC-10's spec-wide corollary ("impossibilidade de executar é REJECT, nunca
 * pass" — plan.md §"A restrição de design que veio da execução") governs
 * the failure paths here too: an unreadable, corrupt, or executor_agent-less
 * metadata.json fails CLOSED (allowed: false), never open.
 *
 * @spec [SPEC:AC-06]
 * @contract CONTRACT-DISPATCH-RECORD-03
 * @task T-11
 */

const fs = require('node:fs');

/**
 * @param {{metadataPath: string, proposedValidator: string}} args
 * @returns {{allowed: boolean, reason: string|null}}
 */
function checkValidatorAssignment({ metadataPath, proposedValidator }) {
  let raw;
  try {
    raw = fs.readFileSync(metadataPath, 'utf8');
  } catch (err) {
    return { allowed: false, reason: `metadata.json não legível em ${metadataPath}: ${err.message}` };
  }

  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (err) {
    return { allowed: false, reason: `metadata.json corrompido em ${metadataPath}: ${err.message}` };
  }

  const executorAgent = metadata.executor_agent;
  if (!executorAgent || typeof executorAgent !== 'string') {
    return { allowed: false, reason: `metadata.json em ${metadataPath} não declara "executor_agent"` };
  }

  if (proposedValidator === executorAgent) {
    return {
      allowed: false,
      reason: `atribuição recusada: "${proposedValidator}" é o mesmo agente que executou a task (executor_agent="${executorAgent}") — validador não pode ser o executor (AC-06)`,
    };
  }

  return { allowed: true, reason: null };
}

module.exports = { checkValidatorAssignment };
