'use strict';
/**
 * lib/spec-lint/checks/cli-surface.cjs — T-06 implementation.
 *
 * Authority: the fenced block with info-string `soma-cli-surface` inside
 * the spec's plan.md. Grammar (contracts/check-cli-surface.md §Autoridade):
 *   soma <sub> <verbo>        — the "verb path": leading plain words (no
 *                                `--`, no `<..>`, no `[..]`, no `|`) after
 *                                the binary. Two lines sharing the same
 *                                verb path are alternative forms of the
 *                                same verb — an invocation satisfies the
 *                                check if it matches ANY of them.
 *   <token> after the verb     — subverbo posicional (bare word, or an
 *                                `a|b|c` enum of accepted values)
 *   --flag <valor>             — required flag; `<valor>` marks it takes a
 *                                value (freeform `<..>` or `a|b|c` enum)
 *   [--flag <valor>]           — optional flag, same value rules inside []
 *   <arg>                      — required positional
 *
 * No check reads the disk (plan.md §"Interface de check") — everything
 * comes from ctx.artifacts, already loaded by context.cjs.
 *
 * T-11 narrows detection per contract §Detecção, fixed 2026-08-16 from a
 * real measurement (running this check against the 017 spec itself
 * produced 10 findings, all false-positive, all inline backtick prose):
 *
 *   D-017-01 — only a fenced block whose info-string is NOT `text` is
 *   swept. Inline backtick spans are ALWAYS a mention, never an
 *   invocation — the boundary is typographic, not semantic. A `text`
 *   fence is data being *displayed*, same reasoning, just fenced.
 *   D-017-02 — `--help` / `--version` immediately after the binary are
 *   dispatcher universals, never "unknown verb".
 *
 * @spec [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07]
 * @contract CONTRACT-CHECK-CLI-SURFACE-01
 * @task T-06 / T-11
 */

// ── tokenizer — shared by declaration lines and invocation candidates ─────
// `[..]` and `<..>` may contain spaces (e.g. `[--reason <texto>]`) and must
// stay a single token; everything else splits on whitespace.
const TOKEN_RE = /\[[^\]]*\]|<[^>]*>|\S+/g;

function tokenize(text) {
  return text.match(TOKEN_RE) || [];
}

/** A "plain" token is a bare word: no flag marker, no bracket, no enum pipe.
 *  Used on BOTH sides — declaration verb-path tokens and, symmetrically, to
 *  build a readable "attempted verb" string when an invocation matches no
 *  declared verb path at all. */
function isPlainWord(t) {
  return !t.startsWith('--') && !t.startsWith('<') && !t.startsWith('[') && !t.includes('|');
}

function plainPrefix(tokens) {
  const out = [];
  for (const t of tokens) {
    if (!isPlainWord(t)) break;
    out.push(t);
  }
  return out;
}

// ── fenced-block scanner ───────────────────────────────────────────────────

/** Finds every ```-fenced block in `text`. Returns
 *  { info, contentLines, contentStartLine (1-indexed) }[]. */
function extractFences(text) {
  const lines = text.split('\n');
  const fences = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^```(\S*)/.exec(lines[i]);
    if (m) {
      const info = m[1] || '';
      const contentStartLine = i + 2;
      i++;
      const contentLines = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        contentLines.push(lines[i]);
        i++;
      }
      fences.push({ info, contentLines, contentStartLine });
      i++; // skip the closing fence line
    } else {
      i++;
    }
  }
  return fences;
}

function findSurfaceFence(planText) {
  return extractFences(planText).find(f => f.info === 'soma-cli-surface') || null;
}

// ── surface grammar parser ─────────────────────────────────────────────────

/** rest = declaration tokens after the binary. Returns { verb, elements }. */
function parseDeclarationLine(rest) {
  let i = 0;
  const verbTokens = [];
  while (i < rest.length && isPlainWord(rest[i])) {
    verbTokens.push(rest[i]);
    i++;
  }

  const elements = [];
  while (i < rest.length) {
    const t = rest[i];
    if (t.startsWith('--')) {
      let takesValue = false;
      let enumValues = null;
      if (i + 1 < rest.length) {
        const next = rest[i + 1];
        if (next.startsWith('<') && next.endsWith('>')) {
          takesValue = true;
          i++;
        } else if (next.includes('|') && !next.startsWith('--') && !next.startsWith('[')) {
          takesValue = true;
          enumValues = next.split('|');
          i++;
        }
      }
      elements.push({ kind: 'flag', name: t, required: true, takesValue, enumValues });
      i++;
    } else if (t.startsWith('[') && t.endsWith(']')) {
      const inner = t.slice(1, -1);
      const innerTokens = inner.match(/<[^>]*>|\S+/g) || [];
      if (innerTokens[0] && innerTokens[0].startsWith('--')) {
        let takesValue = false;
        let enumValues = null;
        const val = innerTokens[1];
        if (val) {
          if (val.startsWith('<') && val.endsWith('>')) takesValue = true;
          else if (val.includes('|')) {
            takesValue = true;
            enumValues = val.split('|');
          }
        }
        elements.push({ kind: 'flag', name: innerTokens[0], required: false, takesValue, enumValues });
      } else {
        elements.push({ kind: 'positional', required: false, name: inner });
      }
      i++;
    } else if (t.startsWith('<') && t.endsWith('>')) {
      elements.push({ kind: 'positional', required: true, name: t });
      i++;
    } else if (t.includes('|')) {
      elements.push({ kind: 'subverb-enum', required: true, values: t.split('|') });
      i++;
    } else {
      // Bare word after the verb path that isn't caught above (shouldn't
      // happen given the grammar, but never silently drop a declared
      // token) — treated as a fixed literal, matched like a positional.
      elements.push({ kind: 'literal', required: true, value: t });
      i++;
    }
  }

  return { verb: verbTokens.join(' '), elements };
}

/** { binary, verbs: Map<verbString, elements[][]> } — verbs.get(v) is the
 *  list of alternative forms declared for that verb path. */
function buildSurface(fenceContentLines) {
  const lines = fenceContentLines.map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { binary: null, verbs: new Map() };

  const tokenizedLines = lines.map(tokenize);
  const binary = tokenizedLines[0][0];
  const verbs = new Map();
  for (const tokens of tokenizedLines) {
    const { verb, elements } = parseDeclarationLine(tokens.slice(1));
    if (!verbs.has(verb)) verbs.set(verb, []);
    verbs.get(verb).push(elements);
  }
  return { binary, verbs };
}

// ── invocation candidate collector ─────────────────────────────────────────

/** D-017-01: a `text` fence is data, not a command — never swept. The
 *  `soma-cli-surface` fence is the authority itself: if it were swept as
 *  invocations, every declaration line (full of `<..>`, `[..]`, `a|b|c`
 *  placeholders) would flag itself, which the "conhecido-bom" fixtures
 *  (5-9, all declaring the same fence) prove empirically — none of them
 *  would sit at zero achados otherwise. Every other fenced block —
 *  including a bare ``` with no info-string — IS swept: it contains
 *  something someone will run. */
function isExecutableFence(info) {
  return info !== 'text' && info !== 'soma-cli-surface';
}

/** Returns [{ text, line }] — candidate strings that MIGHT be invocations
 *  (first token not yet checked against the binary). D-017-01: inline
 *  backtick spans are NEVER candidates, regardless of content — the
 *  fenced/not-fenced boundary is the whole rule. A document that quotes
 *  `soma run mark-done` in a sentence to describe a defect, or names a
 *  bare verb like `gate` in prose, reads identically to this scanner:
 *  neither is inside a swept fence. */
function collectCandidateLines(artifactText) {
  const fences = extractFences(artifactText);
  const candidates = [];

  for (const fence of fences) {
    if (!isExecutableFence(fence.info)) continue;
    fence.contentLines.forEach((lineText, k) => {
      const trimmed = lineText.trim();
      if (trimmed) candidates.push({ text: trimmed, line: fence.contentStartLine + k });
    });
  }

  return candidates;
}

// ── matching an invocation against the declared surface ───────────────────

function findVerbMatch(surface, restTokens) {
  const candidates = Array.from(surface.verbs.keys())
    .map(v => ({ verb: v, toks: v.split(' ') }))
    .sort((a, b) => b.toks.length - a.toks.length); // longest verb path first

  for (const { verb, toks } of candidates) {
    if (toks.length > restTokens.length) continue;
    const prefix = restTokens.slice(0, toks.length);
    if (prefix.length === toks.length && prefix.every((t, idx) => t === toks[idx])) {
      return { verb, remaining: restTokens.slice(toks.length) };
    }
  }
  return null;
}

/** Matches `tokens` (invocation tokens after the verb path) against one
 *  declared `elements` form. Returns a Finding-message[] — empty means this
 *  form fully matched. Leading (non-flag) elements are consumed
 *  positionally, in declared order; flags are matched by name and may
 *  appear in any order after that, mirroring normal CLI convention. */
function matchForm(elements, verb, tokens) {
  const findings = [];
  let cut = 0;
  while (cut < elements.length && elements[cut].kind !== 'flag') cut++;
  const leading = elements.slice(0, cut);
  const flagElements = elements.slice(cut);

  let ti = 0;
  for (const el of leading) {
    if (ti < tokens.length && !tokens[ti].startsWith('--')) {
      const tok = tokens[ti];
      if (el.kind === 'subverb-enum' && !el.values.includes(tok)) {
        findings.push(`subverbo desconhecido '${tok}' para '${verb}'`);
      }
      ti++;
    } else if (el.required) {
      const label = el.kind === 'subverb-enum' ? el.values.join('|') : el.name;
      findings.push(`'${verb}' exige o posicional ${label}, ausente aqui`);
    }
  }

  const seen = new Set();
  while (ti < tokens.length) {
    const tok = tokens[ti];
    if (!tok.startsWith('--')) {
      ti++; // stray token where a flag was expected — not a declared case
      continue;
    }
    const flag = flagElements.find(f => f.name === tok);
    if (!flag) {
      findings.push(`flag '${tok}' não declarada para '${verb}'`);
      ti++;
      if (ti < tokens.length && !tokens[ti].startsWith('--')) ti++; // presumed value
      continue;
    }
    seen.add(flag.name);
    ti++;
    if (flag.takesValue && ti < tokens.length && !tokens[ti].startsWith('--')) {
      const val = tokens[ti];
      if (flag.enumValues && !flag.enumValues.includes(val)) {
        findings.push(`'${val}' fora dos aceitos para ${flag.name}: ${flag.enumValues.join('|')}`);
      }
      ti++;
    }
  }

  for (const flag of flagElements) {
    if (flag.required && !seen.has(flag.name)) {
      findings.push(`'${verb}' exige ${flag.name}, ausente aqui`);
    }
  }

  return findings;
}

/** Checks one invocation string against the whole surface. Returns a
 *  message[] — empty means the invocation matches the surface (directly,
 *  or via any alternative form of its verb). On no match among forms,
 *  reports the closest one (fewest divergences) rather than every form's
 *  complaints piled together. */
function checkInvocation(surface, invocationText) {
  const tokens = tokenize(invocationText);
  const rest = tokens.slice(1);

  // D-017-02: --help/--version right after the binary are dispatcher
  // universals, not verbs — never "unknown verb", regardless of whether
  // the declared surface happens to have a verb by that name.
  if (rest[0] === '--help' || rest[0] === '--version') return [];

  const match = findVerbMatch(surface, rest);
  if (!match) {
    const attempted = plainPrefix(rest).join(' ') || rest[0] || '';
    const declared = Array.from(surface.verbs.keys());
    const list = declared.length ? declared.join(', ') : '(nenhum verbo declarado)';
    return [`verbo desconhecido '${attempted}' — a superfície declara: ${list}`];
  }

  const forms = surface.verbs.get(match.verb);
  let best = null;
  for (const form of forms) {
    const findings = matchForm(form, match.verb, match.remaining);
    if (findings.length === 0) return [];
    if (!best || findings.length < best.length) best = findings;
  }
  return best || [];
}

// ── entry point ─────────────────────────────────────────────────────────

module.exports = {
  name: 'cli-surface',
  run(ctx) {
    const planArtifact = ctx.artifacts.find(a => a.file === 'plan.md');
    if (!planArtifact) {
      return { status: 'skipped', reason: 'plan.md ausente', findings: [] };
    }

    const fence = findSurfaceFence(planArtifact.text);
    if (!fence) {
      return { status: 'skipped', reason: 'plan.md sem bloco soma-cli-surface', findings: [] };
    }

    const surface = buildSurface(fence.contentLines);
    const findings = [];

    if (surface.binary) {
      for (const artifact of ctx.artifacts) {
        const candidates = collectCandidateLines(artifact.text);
        for (const candidate of candidates) {
          const toks = tokenize(candidate.text);
          if (toks.length === 0 || toks[0] !== surface.binary) continue;
          for (const message of checkInvocation(surface, candidate.text)) {
            findings.push({ check: 'cli-surface', file: artifact.file, line: candidate.line, message });
          }
        }
      }
    }

    return { status: 'ran', findings };
  },
};
