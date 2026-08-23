'use strict';
/**
 * lib/spec-lint/fenced-lines.cjs — minimal helper: which line numbers
 * (1-indexed) sit strictly inside a ``` fenced block.
 *
 * heading-near-miss.cjs (AC-01, spec 019) needs to skip a heading-shaped
 * line that only exists as documentation/example text inside a fenced
 * block — e.g. spec 021 will contain a fenced example of the near-miss
 * form to explain the divergence between the two canonical regexes, and
 * that example line must not make the gate accuse the document that
 * documents it.
 *
 * cli-surface.cjs already has its own fence scanner (extractFences(),
 * cli-surface.cjs:79) but does not export it, and it returns block
 * metadata (info-string, content lines) for a different purpose (surface
 * grammar parsing). This is a separate, minimal helper per team-lead
 * direction: it only answers "is this line inside a fence?" — nothing
 * about info-strings or block boundaries beyond that.
 *
 * @spec [SPEC:AC-01]
 * @task T-AC01 (dispatch avulso, AC-01 da spec 019)
 */

/** Returns a Set<number> of 1-indexed line numbers that fall strictly
 *  between a pair of ``` fence delimiters. The delimiter lines themselves
 *  are NOT included — they start with a backtick, not `#`, so they never
 *  look like a heading anyway. An unclosed trailing fence (odd number of
 *  ``` markers) treats every line through EOF as fenced, same as a real
 *  markdown renderer would. */
function fencedLineNumbers(text) {
  const lines = text.split('\n');
  const fenced = new Set();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) fenced.add(i + 1);
  }
  return fenced;
}

module.exports = { fencedLineNumbers };
