# SOMA Purpose Suite

Run dir: `${HOME}/Documents/Codex/2026-04-24/soma v2/soma-purpose-benchmark/suite-runs/20260428-072441`

## Summary

- Canaries: 10
- Mean score: baseline `88.6`, SOMA `97.6`
- Median score: baseline `91.0`, SOMA `100.0`
- Mean hidden pass rate: baseline `0.955`, SOMA `0.955`
- Mean process score: baseline `39.2`, SOMA `98`
- Mean seconds: baseline `87.13`, SOMA `118.54`
- Score wins: SOMA `10`, baseline `0`, ties `0`

## Key Read

- Raw hidden-test delta: `0.0`.
- Mean latency overhead: `31.41s` (`36.0%`).
- Score wins include the process/evidence rubric; they should not be read as pure implementation-correctness wins.

## Per Canary

| Canary | Base score | SOMA score | Delta | Base hidden | SOMA hidden | Base proc | SOMA proc | Base sec | SOMA sec |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| redact-payload | 79 | 89 | 10 | 0.8 | 0.8 | 30 | 90 | 96.98 | 140.33 |
| parse-duration | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 110.36 | 147.91 |
| stable-stringify | 92 | 100 | 8 | 1.0 | 1.0 | 46 | 100 | 90.78 | 134.02 |
| deep-merge | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 141.23 | 158.37 |
| parse-query | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 87.52 | 91.32 |
| invoice-total | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 69.39 | 112.16 |
| lru-cache | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 58.73 | 89.96 |
| csv-line | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 72.59 | 77.58 |
| topological-sort | 91 | 100 | 9 | 1.0 | 1.0 | 40 | 100 | 63.87 | 108.6 |
| retry | 78 | 87 | 9 | 0.75 | 0.75 | 36 | 90 | 79.82 | 125.15 |

## Interpretation Guardrails

- Hidden tests are empirical and injected after each Codex run.
- Process score is a rubric over produced artifacts.
- This measures one model/tool environment, not all LLMs.
- Higher SOMA latency is expected because it asks for evidence and audit work.
