# T-LEAN-8 — Permission-safe adapter spec review

Read-only independent reviewer. Candidate `3258d54acb8420d1df3bc85beed22ae997aab545`; base `9e6bd96ee5dbed22bb739a7a146d94eecbf1db0e`. Do not edit files/Git or install globally.

Check every requirement in `2026-08-27-permission-safe-claude-adapter-implementation.md` against code and tests. Pay special attention to help purity, no shell expansion/model-derived identities, restrictive exact allowlist, backward compatibility, native session validation, owner PID provenance/liveness, fail-closed mailbox resolution, and source/install parity. Run focused deterministic proofs as needed. Classify findings critical/important/minor with file:line and evidence. Reject if any critical/important finding; otherwise approve. Return <=4000 bytes.
