# My Custom Agent Instructions

This file contains free-text instructions for the Codex agent.
No SOMA anchor markers are present.

## Rules

- Always write tests before implementation.
- Keep functions small and focused.
- Use conventional commits.

## Project Context

This is a test fixture simulating an existing free-text AGENTS.md file
that a user might have in their project before running soma install --tool=codex.

The classifier should NOT abort with exit 2 for this file when --tool=codex
is passed, because Step 0 free-text detection only applies to Claude/CLAUDE.md.
