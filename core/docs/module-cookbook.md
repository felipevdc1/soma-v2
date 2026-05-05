# Module Cookbook

**Status:** stub-redirect (v2.1 lab MVP).
**Canonical source:** PLAN.md §4.4 (module layer schema — Purpose, Current State, Main Files, Contracts, Commands, Routing, Patterns, Risks, What Not To Do, Worklog Index).
**Why stub:** module doc schema is defined in PLAN §4.4. Phase 4 will implement the full module workflow. Phase 2+ may consolidate here.
**`expansion_owner`** in manifest.json: `"phase-4 or canonical-include"`.

## Cookbook commands (Phase 4c)

Phase 4c ships 4 subcommands under `soma module` for lifecycle management of `.soma/modules/{slug}.md` files.

### module add {keyword} [--with-snippet] [--soma-home=PATH] [--project=PATH] [--json]

Creates `.soma/modules/{slug}.md` from the canonical template (`templates/project/.soma/modules/module.md.tmpl`) with `status: hypothesis`.

Slug derivation rules: lowercase + replace non-alphanumeric with `-` + collapse `--` runs + trim leading/trailing `-`.

Reserved slugs rejected (exit 1 `RESERVED_SLUG`): `manifest`, `snapshots`, `evidence`, `modules`, `cookbook`, `config`.

With `--with-snippet`: also creates `~/.soma-v2/cookbook/snippets/{slug}.json` with schema `{ schema: "soma-snippet/v1", slug, keywords: [keyword], snippets: [] }` (Bruno C-1 lazy pattern).

### module promote {slug} [--soma-home=PATH] [--project=PATH] [--json]

Moves a module from `status: hypothesis` to `status: active`. Adds `promoted_at` and `last_verified` ISO timestamps. Preserves markdown body verbatim.

Pre-write schema validation (D4): if front-matter has unknown fields, missing required keys, or malformed YAML delimiter → abort `SCHEMA_INVALID`. File untouched.

### module remove {slug} [--yes|-y] [--soma-home=PATH] [--project=PATH] [--json]

Deletes `.soma/modules/{slug}.md` and `cookbook/snippets/{slug}.json` if present. Prompts for confirmation unless `--yes` (CI-safe flag per D1). Idempotent: re-run on missing slug exits 0 with warning.

### module deprecate {slug} [--soma-home=PATH] [--project=PATH] [--json]

Marks module `status: deprecated` + adds `deprecated_at` ISO. File preserved on disk. Body unchanged. Can deprecate from any status.

### soma doctor --project=PATH (extended with stale-hypothesis scan, AC-08)

Doctor now scans `.soma/modules/` in `--project` path for modules with `status: hypothesis` aged ≥90 days (D5: calendar days). Emits `{ severity: "warning", code: "stale_hypothesis", module: slug, age_days: N, initialized_at }` per stale module. Non-blocking: doctor exits 0 even with warnings (D6). Existing drift-detection behavior unchanged.
