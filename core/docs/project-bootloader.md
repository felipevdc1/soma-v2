This project uses SOMA v{{version}}.

## SOMA install

- Source: {{soma_home}}
- Version: {{version}}
- Harness: {{harness}}
- Installed: {{install_timestamp}}

## Project artifacts

- Manifest: ./manifest.json (sha256: {{manifest_sha_short}})
- State: ./.soma/install-state.json
- Constitution: {{soma_home}}/.snapshots/{{snapshot_id}}/

## Workflow

SOMA commands available in any session of this project:

- `/soma-run` — autonomous state machine pipeline
- `/specify` / `/plan-sdd` — Phase 1+2/3 SDD spec/plan derivation
- `/sonar-audit` — Step 8 multi-agent audit

Runtime: `{{soma_home}}/scripts/soma.cjs`
