'use strict';
/**
 * lib/spec-lint/finding.cjs — formats a finding line and the summary footer,
 * exactly as CONTRACT-LINT-OUTPUT-01 defines. The footer always prints, even
 * with zero findings (AC-06): a skipped check must be visibly skipped, or
 * "didn't run" silence is indistinguishable from "ran and passed" silence.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-06]
 * @contract CONTRACT-LINT-OUTPUT-01
 * @task T-02
 */

/** Finding = { check, file, line, message } */
function formatFinding(finding) {
  return `${finding.check}: ${finding.file}:${finding.line}: ${finding.message}`;
}

/** { executed: string[], skipped: string[], count: number } -> footer line */
function formatFooter({ executed, skipped, count }) {
  const executedStr = executed.length ? executed.join(', ') : '-';
  const skippedStr = skipped.length ? skipped.join(', ') : '-';
  return `checks executados: ${executedStr}  |  pulados: ${skippedStr}  |  achados: ${count}`;
}

module.exports = { formatFinding, formatFooter };
