# SOMA_HOME Shadow Benchmark

Run dir: `${HOME}/Documents/Codex/2026-04-24/soma v2/soma-home-benchmark/runs/20260427-215615`

## Measured Baseline

- Core files: 19
- Core dirs: 7
- Core lines: 4708
- Core tokens est: 53689
- Version marker files: 4/19
- Status marker files: 5/19
- Anchored block files: 1/19
- Clean reference files: 74
- Clean reference dirs: 11
- SOMA home exists: False
- Manifest exists: False
- Installed state exists: False

## Top Files By Token Estimate

- 13442 tok: `${CLAUDE_HOME}/plans/soma-v2-design.md`
- 10436 tok: `${CLAUDE_HOME}/plans/soma-v2-spec.md`
- 5522 tok: `${CLAUDE_HOME}/constitution.md`
- 5128 tok: `${CLAUDE_HOME}/commands/soma-run.md`
- 2955 tok: `${CLAUDE_HOME}/commands/sonar-audit.md`
- 2079 tok: `${HOME}/AGENTS.md`
- 2056 tok: `${CLAUDE_HOME}/commands/plan-sdd.md`
- 1944 tok: `${CLAUDE_HOME}/hooks/spec-test-traceability.cjs`
- 1927 tok: `${CLAUDE_HOME}/hooks/hyd-gate.cjs`
- 1368 tok: `${CODEX_HOME}/AGENTS.md`

## Drift Check

- HYD global vs Codex same: False (2e054c12c61e vs 1e135e9f494d)
- SOMA global vs Codex same: False (f6a8f77ef577 vs e3da6b6ca450)

## A/B Route Simulation

| Task | Current tok | Shadow tok | Reduction | Current files | Shadow files | Success delta |
|---|---:|---:|---:|---:|---:|---:|
| orient_new_agent_to_soma | 35896 | 438 | 98.8% | 5 | 3 | 24.0pp |
| check_install_drift | 53689 | 4880 | 90.9% | 19 | 4 | 60.0pp |
| update_hyd_v2_everywhere | 7253 | 2660 | 63.3% | 5 | 5 | 48.0pp |
| understand_state_machine | 29006 | 15750 | 45.7% | 3 | 4 | 15.0pp |
| add_module_cookbook_pattern | 16306 | 489 | 97.0% | 3 | 4 | 39.0pp |

## Shadow Doctor

- Counts: `{"anchor_missing": 2, "ok": 21, "snippet_drift": 1}`
- Target health: 87.5%
- Detected issues: 3

## Score

- Current total: 25.8/100
- Shadow total: 95.5/100
- Route token reduction: 83.0% (142150 -> 24217)

Score parts:

- Current: `{"anchor_control": 5.3, "install_ledger": 0, "route_success_model": 54.8, "route_token_efficiency": 47.0, "version_control": 21.1}`
- Shadow: `{"anchor_control": 100.0, "install_ledger": 100.0, "route_success_model": 92.0, "route_token_efficiency": 83.0, "version_control": 100.0}`

## Notes

- Baseline metrics are measured from local files.
- Success percentages are modeled, not empirical agent outcomes.
- Shadow home is a lab artifact and did not modify official files.
