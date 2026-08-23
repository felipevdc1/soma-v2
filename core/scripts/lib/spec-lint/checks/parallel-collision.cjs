'use strict';
/**
 * lib/spec-lint/checks/parallel-collision.cjs
 *
 * Flags [P] tasks at the same dependency level that write to the same
 * file. Consumes ctx.tasks (already parsed by context.cjs) — never
 * re-reads tasks.md; a single parser is what makes the format break in
 * exactly one place.
 *
 * Two tasks A and B collide when ALL three hold:
 *   1. A.parallel && B.parallel
 *   2. A.files ∩ B.files ≠ ∅
 *   3. neither reaches the other in the depends_on graph (transitive
 *      closure, both directions — a task is never a dependency of itself)
 *
 * The ad hoc validator of 2026-08-15 got condition 3 wrong three versions
 * in a row: it read a task's own `id` as a `depends_on` entry, which made
 * every task "reach" itself and silently defeated condition 3 for every
 * pair, reporting "0 conflitos" against exactly the shape the fixture
 * 04-regression-eight-parallel-same-file fixture encodes. `buildReachability`
 * below never lets a node reach itself — self-edges are dropped when the
 * adjacency graph is built, and the traversal explicitly skips the start
 * id even if a bad depends_on cycle would otherwise revisit it.
 *
 * @spec [SPEC:AC-08] [SPEC:AC-09]
 * @contract CONTRACT-CHECK-PARALLEL-01
 * @task T-07
 */

/**
 * Builds the depends_on adjacency graph and returns a memoized
 * `reachableFrom(id)` — the set of task ids reachable from `id` by
 * following depends_on edges, transitively, NEVER including `id` itself
 * (even through a cycle).
 */
function buildReachability(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const adjacency = new Map();
  for (const t of tasks) {
    // Self-references are dropped here, at the one place the graph is
    // built — this is the structural fix for the 2026-08-15 bug: a task
    // is never its own dependency, no matter what depends_on says.
    const deps = (t.dependsOn || []).filter((dep) => dep !== t.id && byId.has(dep));
    adjacency.set(t.id, deps);
  }

  const cache = new Map();

  function reachableFrom(startId) {
    if (cache.has(startId)) return cache.get(startId);

    const visited = new Set();
    const stack = [...(adjacency.get(startId) || [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === startId || visited.has(current)) continue;
      visited.add(current);
      for (const dep of adjacency.get(current) || []) {
        if (dep !== startId && !visited.has(dep)) stack.push(dep);
      }
    }

    cache.set(startId, visited);
    return visited;
  }

  return { reachableFrom };
}

/** Files present in both `a.files` and `b.files`, in `a`'s original order. */
function sharedFiles(a, b) {
  const filesOfB = new Set(b.files);
  return a.files.filter((f) => filesOfB.has(f));
}

module.exports = {
  name: 'parallel-collision',
  // AC-05 (spec 019): este check só consome `ctx.tasks` (linha abaixo,
  // `ctx.tasks || []`) — nunca `ctx.artifacts` — e todo achado é reportado
  // com `file: 'tasks.md'` (ver sharedFiles/findings acima). `retroactive:
  // false`: roda só sobre o `<spec-dir>` recebido pelo CLI, sem flag de
  // varredura retroativa (spec-lint.cjs tem um único posicional).
  scope: { artifacts: ['tasks.md'], retroactive: false },
  run(ctx) {
    const tasks = ctx.tasks || [];
    const { reachableFrom } = buildReachability(tasks);
    const findings = [];

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i];
        const b = tasks[j];

        if (!a.parallel || !b.parallel) continue;

        const shared = sharedFiles(a, b);
        if (shared.length === 0) continue;

        // Condition 3: neither reaches the other, transitively, either
        // direction — "cabeçalho da wave é prosa", only the depends_on
        // graph decides the level.
        if (reachableFrom(a.id).has(b.id) || reachableFrom(b.id).has(a.id)) continue;

        // "Task posterior" = larger line number in tasks.md (order of
        // appearance, not id order, not topological order — fixed in
        // plan.md/contract on 2026-08-16 after T-05 flagged the ambiguity).
        const [earlier, later] = a.line <= b.line ? [a, b] : [b, a];

        findings.push({
          check: 'parallel-collision',
          file: 'tasks.md',
          line: later.line,
          message: `${earlier.id} e ${later.id} são [P] no mesmo nível e escrevem em ${shared.join(', ')}`,
        });
      }
    }

    return { status: 'ran', findings };
  },
};
