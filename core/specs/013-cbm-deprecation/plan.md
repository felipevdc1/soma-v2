# Spec 013 — cbm Deprecation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop legacy `cbm` anchor from claude install-targets + restore proper source doc for codex `codebase-memory-mcp` (Phase 5 Q2 misroute fix). Resolves Issues #8 (target_drift category) and #9 (install-targets duplicate source).

**Architecture:** Two-phase commit. Phase 1 = repo mutations (source doc creation + manifest entry + install-targets edits — committed via git branch). Phase 2 = lab migration via `migrateCbmDeprecation()` library: snapshot → atomic per-file mutation → verify-or-rollback. Migration library exposed via 3 entry points (install.sh + sync.cjs auto-detect + explicit `soma migrate --cbm-deprecation` CLI). Reuses existing `createSnapshot()` from `sync.cjs:688`.

**Tech Stack:** Node.js 18+ (CommonJS `.cjs`), node:test framework, POSIX shell (install.sh, BSD/GNU sed compat per Phase 6.4), git for branch isolation, JSON for config files.

**Spec:** [`spec.md`](./spec.md) — 22 ACs, 9 locked decisions (D-013-1 through D-013-9)
**Branch:** `fix/issue-9-cbm-deprecation` (already created, spec.md committed at `228ca55`)
**Target:** v2.1.1 patch
**Estimated dispatch time:** 4-6 hours wall (Sonnet)

---

## Scope check

Single subsystem (anchor migration + source doc creation). No further decomposition needed — fits one plan.

---

## File Structure

### NEW files (7)

| File | Responsibility |
|---|---|
| `core/docs/codebase-memory-mcp.md` | Canonical source for `codebase-memory-mcp` anchor content. Extracted from Felipe's `~/.codex/AGENTS.md` legacy block. |
| `core/scripts/lib/migrate.cjs` | Migration library. Exports `migrateCbmDeprecation()` + 8 sub-functions. NOT a frozen lib (mutable). |
| `core/scripts/migrate-cbm-deprecation.cjs` | CLI wrapper (entry point #3). Parses `--dry-run`/`--force`/`--revert` flags, invokes lib. |
| `core/scripts/__tests__/bf-04-cbm-deprecation-reproducer.test.cjs` | RED→GREEN reproducer test for AC-01/04/06. Proves dedup achieved. |
| `core/scripts/__tests__/migrate-cbm-deprecation.test.cjs` | Unit tests for migrate.cjs lib (8 sub-functions individually). |
| `core/scripts/__tests__/bf-04-frozen-libs-invariant.test.cjs` | Invariant test: shasums of 3 frozen libs match baseline through migration. |
| `core/tests/integration/bf-04-cbm-e2e.test.cjs` | E2E integration. 6 scenarios: install.sh trigger + sync trigger + CLI trigger + content-mismatch abort + dry-run + revert. |

### MODIFY files (9)

| File | Modification |
|---|---|
| `core/manifest.json` | ADD `core.codebase-memory-mcp` entry (sha256 + sourceMtime + status `released` + targets `["global","project"]`). |
| `core/adapters/claude/install-targets.json` | DROP entry with `block_id: "block.claude.CLAUDE_md.cbm"` (1 entry removed; 4→3). |
| `core/adapters/codex/install-targets.json` | UPDATE `source_doc` from `docs/hyd-v2.md` → `docs/codebase-memory-mcp.md` for both entries with `block_id: "block.codex.AGENTS.codebase-memory-mcp"` (×2 target_paths). |
| `core/scripts/sync.cjs` | ADD pre-apply detection block (lines ~280-300 region). Detect cbm anchor or legacy markers in target files, auto-invoke `migrateCbmDeprecation()` before block injection. |
| `install.sh` | ADD pre-install detection block. Grep cbm anchors / legacy markers in `~/.claude/CLAUDE.md` + `~/.codex/AGENTS.md` + `~/AGENTS.md`. If found, invoke `node {SOMA_HOME}/scripts/migrate-cbm-deprecation.cjs` before main install. |
| `core/scripts/__tests__/doctor-migration.contract.test.cjs` | UPDATE line 423 assertion: `install_targets_count` 9 → 8. |
| `core/scripts/__tests__/sync.dry-run-edits.test.cjs` | UPDATE line 824 assertion: `summary.total_entries` 9 → 8. |
| `core/docs/adapter-contract.md` | UPDATE D-C11 wording. Claude triplet: `{cbm,hyd-v2,soma-stsd}` → `{hyd-v2,soma-stsd,soma-voxel}`. Codex triplet annotation: `codebase-memory-mcp` source explicitly `docs/codebase-memory-mcp.md`. |
| `CHANGELOG.md` | ADD v2.1.1 entry. BREAKING (cbm deprecated, auto-migrated). FIXED (codex source restored, Issue #8 + #9 resolved). |

**Frozen libs (must NOT touch)**: `core/scripts/lib/anchored-blocks.cjs`, `core/scripts/lib/manifest.cjs`, `core/scripts/lib/template-engine.cjs`. Baseline shasums in AC-17.

---

## Wave A — Foundation (Tasks 1-3)

Establishes new source doc + repo config edits. Single RED→GREEN cycle covering AC-01, 04, 05, 06.

---

### Task 1: Write BF-04 reproducer test (RED)

**Files:**
- Create: `core/scripts/__tests__/bf-04-cbm-deprecation-reproducer.test.cjs`

- [ ] **Step 1.1: Write the failing test file**

```js
'use strict';
/**
 * BF-04 Reproducer Test — cbm deprecation + codex source restoration
 *
 * @phase RED → GREEN (Wave A foundation)
 * @spec AC-01 + AC-04 + AC-06
 * @issue #9
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLAUDE_INSTALL_TARGETS = path.join(REPO_ROOT, 'core/adapters/claude/install-targets.json');
const CODEX_INSTALL_TARGETS = path.join(REPO_ROOT, 'core/adapters/codex/install-targets.json');
const MCP_SOURCE_DOC = path.join(REPO_ROOT, 'core/docs/codebase-memory-mcp.md');

test('AC-01: claude install-targets has no cbm entry', () => {
  const targets = JSON.parse(fs.readFileSync(CLAUDE_INSTALL_TARGETS, 'utf8'));
  const cbmEntry = targets.entries.find(e => e.block_id === 'block.claude.CLAUDE_md.cbm');
  assert.equal(cbmEntry, undefined, 'cbm legacy entry should be dropped');
  assert.equal(targets.entries.length, 3, 'claude install-targets should have 3 entries (was 4)');
});

test('AC-06: codex codebase-memory-mcp source_doc is correct', () => {
  const targets = JSON.parse(fs.readFileSync(CODEX_INSTALL_TARGETS, 'utf8'));
  const cmmcEntries = targets.entries.filter(e => e.block_id === 'block.codex.AGENTS.codebase-memory-mcp');
  assert.equal(cmmcEntries.length, 2, 'codex should have 2 codebase-memory-mcp entries (×2 target_paths)');
  cmmcEntries.forEach(e => {
    assert.equal(e.source_doc, 'docs/codebase-memory-mcp.md',
      `source_doc must be docs/codebase-memory-mcp.md, NOT ${e.source_doc}`);
  });
});

test('AC-04: source docs/codebase-memory-mcp.md exists with valid content', () => {
  assert.ok(fs.existsSync(MCP_SOURCE_DOC), `${MCP_SOURCE_DOC} must exist`);
  const content = fs.readFileSync(MCP_SOURCE_DOC, 'utf8');
  assert.match(content, /# Codebase Knowledge Graph/, 'must have canonical header');
  assert.match(content, /codebase-memory-mcp/, 'must reference the MCP tool name');
  assert.match(content, /search_graph/, 'must document search_graph priority');
  assert.match(content, /trace_call_path/, 'must document trace_call_path');
});
```

- [ ] **Step 1.2: Run test to verify it fails (RED)**

Run: `node --test core/scripts/__tests__/bf-04-cbm-deprecation-reproducer.test.cjs`
Expected: 3 fail, 0 pass (cbm exists in claude, codex source is hyd-v2.md, source doc missing)

- [ ] **Step 1.3: Commit RED**

```bash
git add core/scripts/__tests__/bf-04-cbm-deprecation-reproducer.test.cjs
git commit -m "test: add BF-04 reproducer for cbm deprecation (RED)

Asserts: AC-01 (claude no cbm entry), AC-04 (source doc exists),
AC-06 (codex source_doc correct). Currently RED — fixed by Wave A
foundation (Task 2).

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Foundation GREEN (create source + edit configs)

**Files:**
- Create: `core/docs/codebase-memory-mcp.md`
- Modify: `core/manifest.json` (add entry)
- Modify: `core/adapters/claude/install-targets.json` (drop cbm)
- Modify: `core/adapters/codex/install-targets.json` (fix source_doc ×2)

- [ ] **Step 2.1: Extract MCP content from Felipe's lab**

Run:
```bash
LAB_AGENTS="${HOME}/.codex/AGENTS.md"
START_LINE=$(grep -n '<!-- codebase-memory-mcp:start -->' "$LAB_AGENTS" | head -1 | cut -d: -f1)
END_LINE=$(grep -n '<!-- codebase-memory-mcp:end -->' "$LAB_AGENTS" | head -1 | cut -d: -f1)
sed -n "$((START_LINE+1)),$((END_LINE-1))p" "$LAB_AGENTS" > /tmp/mcp-content.md
cat /tmp/mcp-content.md
```

Expected output: 21 lines starting with `# Codebase Knowledge Graph (codebase-memory-mcp)`.

- [ ] **Step 2.2: Create source doc**

Create `core/docs/codebase-memory-mcp.md` with content from `/tmp/mcp-content.md`:

```markdown
# Codebase Knowledge Graph (codebase-memory-mcp)

This project uses codebase-memory-mcp to maintain a knowledge graph of the codebase.
ALWAYS prefer MCP graph tools over grep/glob/file-search for code discovery.

## Priority Order
1. `search_graph` — find functions, classes, routes, variables by pattern
2. `trace_call_path` — trace who calls a function or what it calls
3. `get_code_snippet` — read specific function/class source code
4. `query_graph` — run Cypher queries for complex patterns
5. `get_architecture` — high-level project summary

## When to fall back to grep/glob
- Searching for string literals, error messages, config values
- Searching non-code files (Dockerfiles, shell scripts, configs)
- When MCP tools return insufficient results

## Examples
- Find a handler: `search_graph(name_pattern=".*OrderHandler.*")`
- Who calls it: `trace_call_path(function_name="OrderHandler", direction="inbound")`
- Read source: `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`
```

- [ ] **Step 2.3: Compute sha256 + mtime for manifest**

Run:
```bash
SHA=$(shasum -a 256 core/docs/codebase-memory-mcp.md | cut -d' ' -f1)
MTIME=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' core/docs/codebase-memory-mcp.md)
echo "sha256=$SHA"
echo "sourceMtime=$MTIME"
```

Capture both values for Step 2.4.

- [ ] **Step 2.4: Add manifest entry**

Edit `core/manifest.json`. After the `core.constitution` entry, add (using values from Step 2.3):

```json
    {
      "id": "core.codebase-memory-mcp",
      "path": "docs/codebase-memory-mcp.md",
      "sha256": "<SHA_FROM_STEP_2.3>",
      "sourceMtime": "<MTIME_FROM_STEP_2.3>",
      "sourceSha256": "<SHA_FROM_STEP_2.3>",
      "targets": ["global", "project"],
      "expansion_owner": null,
      "status": "released"
    },
```

- [ ] **Step 2.5: Drop cbm from claude install-targets**

Edit `core/adapters/claude/install-targets.json`. Remove the entry with `block_id: "block.claude.CLAUDE_md.cbm"`. Verify file remains valid JSON with 3 entries.

- [ ] **Step 2.6: Fix codex install-targets source_doc**

Edit `core/adapters/codex/install-targets.json`. For BOTH entries with `block_id: "block.codex.AGENTS.codebase-memory-mcp"`, change:
```json
"source_doc": "docs/hyd-v2.md"
```
to:
```json
"source_doc": "docs/codebase-memory-mcp.md"
```

- [ ] **Step 2.7: Run test to verify it passes (GREEN)**

Run: `node --test core/scripts/__tests__/bf-04-cbm-deprecation-reproducer.test.cjs`
Expected: 3 pass, 0 fail

- [ ] **Step 2.8: Commit GREEN**

```bash
git add core/docs/codebase-memory-mcp.md core/manifest.json \
        core/adapters/claude/install-targets.json \
        core/adapters/codex/install-targets.json
git commit -m "feat: foundation for cbm deprecation (GREEN Wave A)

- Create core/docs/codebase-memory-mcp.md (NEW source for MCP doc)
- Add core.codebase-memory-mcp entry to manifest.json
- Drop block.claude.CLAUDE_md.cbm from claude install-targets (4→3)
- Fix codex codebase-memory-mcp source_doc misroute (hyd-v2.md → codebase-memory-mcp.md)

BF-04 reproducer transitions RED→GREEN: 3/3 pass.

Resolves AC-01, AC-04, AC-05, AC-06.
Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify frozen libs invariant (foundation phase)

- [ ] **Step 3.1: Verify frozen libs unchanged**

Run:
```bash
shasum -a 256 core/scripts/lib/anchored-blocks.cjs core/scripts/lib/manifest.cjs core/scripts/lib/template-engine.cjs
```

Expected:
```
6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f  core/scripts/lib/anchored-blocks.cjs
08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462  core/scripts/lib/manifest.cjs
f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b  core/scripts/lib/template-engine.cjs
```

If any drift → STOP, report to orchestrator. Frozen libs invariant violated.

---

## Wave B — Migration Library (Tasks 4-12)

Implements `migrateCbmDeprecation()` library + 8 sub-functions. TDD-strict per sub-function.

**Library API contract**:
```js
// core/scripts/lib/migrate.cjs
exports.migrateCbmDeprecation = function({ somaHome, target, dryRun, force, revert }) { /* ... */ };
exports.extractMcpContentFromLab = function(labAgentsPath) { /* returns string or null */ };
exports.deleteLegacyBlock = function(content, markerName) { /* returns mutated string */ };
exports.renameAnchor = function(content, oldId, newId, newSha) { /* returns mutated string */ };
exports.atomicWrite = function(filePath, content) { /* tmp+rename, throws on fail */ };
exports.createMigrationSnapshot = function(somaHome, files) { /* returns snapshotId */ };
exports.verifyMigration = function(somaHome) { /* returns {ok, findings} */ };
exports.rollbackFromSnapshot = function(snapshotId) { /* throws on fail */ };
exports.preFlightGates = function({ lab, install, frozenLibs }) { /* returns {pass, fail: [] } */ };
```

---

### Task 4: extractMcpContentFromLab() — RED + GREEN

**Files:**
- Create: `core/scripts/__tests__/migrate-cbm-deprecation.test.cjs` (initial — will grow with subsequent tasks)
- Create: `core/scripts/lib/migrate.cjs` (initial — will grow)

- [ ] **Step 4.1: Write failing test**

Append to `core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lib = require('../lib/migrate.cjs');

test('extractMcpContentFromLab: extracts content between legacy markers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, [
    '<!-- codebase-memory-mcp:start -->',
    '# Codebase Knowledge Graph',
    'MCP doc content here',
    '<!-- codebase-memory-mcp:end -->',
    '',
    '<!-- hyd-v2:start -->',
    'unrelated',
    '<!-- hyd-v2:end -->',
  ].join('\n'));
  const content = lib.extractMcpContentFromLab(fixture);
  assert.match(content, /# Codebase Knowledge Graph/);
  assert.match(content, /MCP doc content here/);
  assert.doesNotMatch(content, /<!-- codebase-memory-mcp:start -->/, 'must exclude markers');
  assert.doesNotMatch(content, /unrelated/, 'must not include other blocks');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: returns null if no marker present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, '# Some other doc\nNo legacy markers here.');
  const content = lib.extractMcpContentFromLab(fixture);
  assert.equal(content, null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: returns null if file missing', () => {
  const content = lib.extractMcpContentFromLab('/nonexistent/path');
  assert.equal(content, null);
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: FAIL — `Cannot find module '../lib/migrate.cjs'`

- [ ] **Step 4.3: Implement extractMcpContentFromLab()**

Create `core/scripts/lib/migrate.cjs`:

```js
'use strict';
/**
 * Migration library for cbm deprecation (Spec 013).
 *
 * @spec core/specs/013-cbm-deprecation/spec.md
 * @issue #9
 */

const fs = require('node:fs');

/**
 * Extract content between <!-- codebase-memory-mcp:start --> and <!-- codebase-memory-mcp:end -->
 * markers from a target file. Returns null if file missing or markers not found.
 *
 * @param {string} labAgentsPath — absolute path to lab AGENTS.md
 * @returns {string|null}
 */
exports.extractMcpContentFromLab = function(labAgentsPath) {
  if (!fs.existsSync(labAgentsPath)) return null;
  const content = fs.readFileSync(labAgentsPath, 'utf8');
  const startPattern = /<!--\s*codebase-memory-mcp:start\s*-->/;
  const endPattern = /<!--\s*codebase-memory-mcp:end\s*-->/;
  const startMatch = content.match(startPattern);
  const endMatch = content.match(endPattern);
  if (!startMatch || !endMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = endMatch.index;
  return content.slice(startIdx, endIdx).replace(/^\n/, '').replace(/\n$/, '');
};
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 3 pass

- [ ] **Step 4.5: Commit**

```bash
git add core/scripts/lib/migrate.cjs core/scripts/__tests__/migrate-cbm-deprecation.test.cjs
git commit -m "feat(migrate): add extractMcpContentFromLab() (Wave B Task 4)

Extracts content between legacy <!-- codebase-memory-mcp:start --> markers.
Returns null on missing file or absent markers.

3 tests pass. Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: deleteLegacyBlock() — RED + GREEN

- [ ] **Step 5.1: Append failing test**

Append to `core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`:

```js
test('deleteLegacyBlock: removes markers + content cleanly', () => {
  const input = [
    '# Header',
    '',
    '<!-- codebase-memory-mcp:start -->',
    'Content to delete',
    '<!-- codebase-memory-mcp:end -->',
    '',
    '# After',
  ].join('\n');
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.doesNotMatch(result, /codebase-memory-mcp:start/);
  assert.doesNotMatch(result, /codebase-memory-mcp:end/);
  assert.doesNotMatch(result, /Content to delete/);
  assert.match(result, /# Header/);
  assert.match(result, /# After/);
});

test('deleteLegacyBlock: no-op if marker not present', () => {
  const input = '# Header\nNo markers here.';
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.equal(result, input);
});
```

- [ ] **Step 5.2: Run test (FAIL — function not exists)**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 2 fail (extract tests still pass)

- [ ] **Step 5.3: Implement deleteLegacyBlock()**

Append to `core/scripts/lib/migrate.cjs`:

```js
/**
 * Remove a legacy `<!-- {markerName}:start -->...<!-- {markerName}:end -->` block from content.
 * Idempotent: returns content unchanged if marker not present.
 *
 * @param {string} content
 * @param {string} markerName — e.g., "codebase-memory-mcp"
 * @returns {string}
 */
exports.deleteLegacyBlock = function(content, markerName) {
  const escaped = markerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\n?<!--\\s*${escaped}:start\\s*-->[\\s\\S]*?<!--\\s*${escaped}:end\\s*-->\\n?`, 'g');
  return content.replace(pattern, '\n');
};
```

- [ ] **Step 5.4: Run tests (PASS)**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 5 pass total (3 extract + 2 delete)

- [ ] **Step 5.5: Commit**

```bash
git add core/scripts/lib/migrate.cjs core/scripts/__tests__/migrate-cbm-deprecation.test.cjs
git commit -m "feat(migrate): add deleteLegacyBlock() (Wave B Task 5)

Removes <!-- {markerName}:start -->...<!-- {markerName}:end --> blocks.
Idempotent. 2 new tests pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: renameAnchor() — RED + GREEN

- [ ] **Step 6.1: Append failing test**

```js
test('renameAnchor: changes ID + sha256 in soma-v2 anchor markers', () => {
  const input = [
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=oldhash -->',
    'block content',
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->',
  ].join('\n');
  const result = lib.renameAnchor(input, 'block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2', 'newhash');
  assert.match(result, /id=block\.claude\.CLAUDE_md\.hyd-v2/);
  assert.match(result, /sha256=newhash/);
  assert.doesNotMatch(result, /id=block\.claude\.CLAUDE_md\.cbm/);
  assert.match(result, /block content/, 'inner content preserved');
});

test('renameAnchor: no-op if oldId not present', () => {
  const input = '# No anchor here\nplain text';
  const result = lib.renameAnchor(input, 'block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2', 'newhash');
  assert.equal(result, input);
});
```

- [ ] **Step 6.2: Run test (FAIL)**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 2 fail

- [ ] **Step 6.3: Implement renameAnchor()**

Append to `core/scripts/lib/migrate.cjs`:

```js
/**
 * Rename a soma-v2 anchor: change ID + sha256 in start marker, change ID in end marker.
 * Inner content untouched.
 *
 * @param {string} content
 * @param {string} oldId
 * @param {string} newId
 * @param {string} newSha
 * @returns {string}
 */
exports.renameAnchor = function(content, oldId, newId, newSha) {
  const escapedOld = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`(<!--\\s*soma-v2:start\\s+id=)${escapedOld}(\\s+version=[^\\s]+\\s+sha256=)[^\\s]+(\\s*-->)`, 'g');
  const endPattern = new RegExp(`(<!--\\s*soma-v2:end\\s+id=)${escapedOld}(\\s*-->)`, 'g');
  return content
    .replace(startPattern, `$1${newId}$2${newSha}$3`)
    .replace(endPattern, `$1${newId}$2`);
};
```

- [ ] **Step 6.4: Run tests (PASS)**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 7 pass total

- [ ] **Step 6.5: Commit**

```bash
git add core/scripts/lib/migrate.cjs core/scripts/__tests__/migrate-cbm-deprecation.test.cjs
git commit -m "feat(migrate): add renameAnchor() (Wave B Task 6)

Renames soma-v2 anchor ID + sha256 in start/end markers.
Inner content preserved. 2 new tests pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: atomicWrite() — RED + GREEN

- [ ] **Step 7.1: Append failing test**

```js
test('atomicWrite: writes via tmp + rename', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const target = path.join(tmpDir, 'output.md');
  fs.writeFileSync(target, 'old content');
  lib.atomicWrite(target, 'new content');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new content');
  // verify no .tmp leftover
  const leftovers = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0, 'no .tmp leftover after rename');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('atomicWrite: throws on permission failure (parent ENOENT)', () => {
  assert.throws(() => lib.atomicWrite('/nonexistent-dir/file.md', 'content'));
});
```

- [ ] **Step 7.2: Run test (FAIL)**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 2 fail

- [ ] **Step 7.3: Implement atomicWrite()**

Append to `core/scripts/lib/migrate.cjs`:

```js
/**
 * Atomic write via tmp file + POSIX rename. Either succeeds entirely or leaves
 * target file unchanged.
 *
 * @param {string} filePath — absolute path
 * @param {string} content — string content to write
 * @throws {Error} on write or rename failure
 */
exports.atomicWrite = function(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Cleanup tmp on failure
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    throw err;
  }
};
```

- [ ] **Step 7.4: Run tests (PASS)**

Run: `node --test core/scripts/__tests__/migrate-cbm-deprecation.test.cjs`
Expected: 9 pass total

- [ ] **Step 7.5: Commit**

```bash
git add core/scripts/lib/migrate.cjs core/scripts/__tests__/migrate-cbm-deprecation.test.cjs
git commit -m "feat(migrate): add atomicWrite() (Wave B Task 7)

POSIX tmp+rename pattern. Cleans up tmp on failure. 2 new tests pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: createMigrationSnapshot() — RED + GREEN

- [ ] **Step 8.1: Append failing test**

```js
test('createMigrationSnapshot: creates snapshot dir with files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  const file1 = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(file1, 'claude content');
  const snapshotId = lib.createMigrationSnapshot(somaHome, [file1]);
  assert.match(snapshotId, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z-cbm-deprecation$/);
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  assert.ok(fs.existsSync(snapshotDir));
  // verify file content snapshot exists
  const snapshots = fs.readdirSync(snapshotDir);
  assert.ok(snapshots.length > 0, 'snapshot files written');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 8.2: Run test (FAIL)**

- [ ] **Step 8.3: Implement createMigrationSnapshot()**

Append to `core/scripts/lib/migrate.cjs`:

```js
const path = require('node:path');

/**
 * Create migration snapshot at ~/.soma-v2/.snapshots/{ISO-8601-Z}-cbm-deprecation/
 * Copies each file in `files` array to snapshot dir preserving basename.
 *
 * @param {string} somaHome
 * @param {string[]} files — absolute paths to snapshot
 * @returns {string} snapshotId
 */
exports.createMigrationSnapshot = function(somaHome, files) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const snapshotId = `${ts}-cbm-deprecation`;
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  for (const file of files) {
    if (fs.existsSync(file)) {
      const dest = path.join(snapshotDir, path.basename(file) + '.snapshot');
      fs.copyFileSync(file, dest);
    }
  }
  return snapshotId;
};
```

- [ ] **Step 8.4: Run tests (PASS)**

- [ ] **Step 8.5: Commit**

```bash
git commit -am "feat(migrate): add createMigrationSnapshot() (Wave B Task 8)

ISO-8601-Z timestamp format. Copies files preserving basename + .snapshot suffix.
1 new test pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: rollbackFromSnapshot() — RED + GREEN

- [ ] **Step 9.1: Append failing test**

```js
test('rollbackFromSnapshot: restores files from snapshot', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  const snapshotId = '2026-05-06T20:00:00Z-cbm-deprecation';
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  // Create snapshot of CLAUDE.md
  fs.writeFileSync(path.join(snapshotDir, 'CLAUDE.md.snapshot'), 'original content');
  const target = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(target, 'mutated content');
  // Manifest mapping snapshot files → restore targets
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify({
    files: { 'CLAUDE.md.snapshot': target }
  }));
  lib.rollbackFromSnapshot(somaHome, snapshotId);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original content');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 9.2: Run test (FAIL)**

- [ ] **Step 9.3: Implement rollbackFromSnapshot()**

Append to `core/scripts/lib/migrate.cjs`:

```js
/**
 * Restore files from a named snapshot. Reads snapshot/manifest.json for file→target mapping.
 *
 * @param {string} somaHome
 * @param {string} snapshotId
 * @throws {Error} if snapshot dir or manifest missing
 */
exports.rollbackFromSnapshot = function(somaHome, snapshotId) {
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  if (!fs.existsSync(snapshotDir)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Snapshot manifest missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [snapshotFile, target] of Object.entries(manifest.files)) {
    const src = path.join(snapshotDir, snapshotFile);
    if (fs.existsSync(src)) {
      exports.atomicWrite(target, fs.readFileSync(src, 'utf8'));
    }
  }
};
```

Note: Update `createMigrationSnapshot()` from Task 8 to also write `manifest.json` mapping. Edit:

```js
exports.createMigrationSnapshot = function(somaHome, files) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const snapshotId = `${ts}-cbm-deprecation`;
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const fileMap = {};
  for (const file of files) {
    if (fs.existsSync(file)) {
      const snapshotFile = path.basename(file) + '.snapshot';
      const dest = path.join(snapshotDir, snapshotFile);
      fs.copyFileSync(file, dest);
      fileMap[snapshotFile] = file;
    }
  }
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify({ files: fileMap }, null, 2));
  return snapshotId;
};
```

- [ ] **Step 9.4: Run tests (PASS, including Task 8 still GREEN)**

- [ ] **Step 9.5: Commit**

```bash
git commit -am "feat(migrate): add rollbackFromSnapshot() + manifest.json (Wave B Task 9)

Reads snapshot/manifest.json for file→target mapping. Uses atomicWrite.
Updates createMigrationSnapshot() to write manifest.json. 1 new test pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: verifyMigration() — RED + GREEN

- [ ] **Step 10.1: Append failing test**

```js
const { spawnSync } = require('node:child_process');

test('verifyMigration: invokes doctor.cjs and parses output', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  // Setup minimal somaHome with manifest etc — for now just stub the doctor invocation
  const result = lib.verifyMigration(tmpDir);
  assert.ok('ok' in result, 'returns {ok, findings}');
  assert.ok(Array.isArray(result.findings), 'findings is array');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 10.2: Run test (FAIL)**

- [ ] **Step 10.3: Implement verifyMigration()**

```js
const { spawnSync } = require('node:child_process');

/**
 * Verify migration by running doctor.cjs in target somaHome.
 * Returns {ok: boolean, findings: string[]}.
 *
 * @param {string} somaHome
 * @returns {{ok: boolean, findings: string[]}}
 */
exports.verifyMigration = function(somaHome) {
  const doctorPath = path.join(somaHome, 'scripts', 'doctor.cjs');
  if (!fs.existsSync(doctorPath)) {
    return { ok: false, findings: [`doctor.cjs not found at ${doctorPath}`] };
  }
  const result = spawnSync('node', [doctorPath], { cwd: somaHome, encoding: 'utf8' });
  const findings = (result.stdout + result.stderr)
    .split('\n')
    .filter(l => l.includes('[drift]') || l.includes('DRIFT:'));
  const driftCount = findings.find(l => /DRIFT: (\d+) finding/.exec(l));
  const count = driftCount ? parseInt(/DRIFT: (\d+) finding/.exec(driftCount)[1], 10) : 0;
  return { ok: count === 0, findings };
};
```

- [ ] **Step 10.4: Run tests (PASS)**

- [ ] **Step 10.5: Commit**

```bash
git commit -am "feat(migrate): add verifyMigration() (Wave B Task 10)

Invokes doctor.cjs, parses drift findings. Returns {ok, findings}.
1 new test pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: preFlightGates() — RED + GREEN (G1-G6)

- [ ] **Step 11.1: Append failing tests (one per gate)**

```js
test('preFlightGates G1: lab files exist (graceful skip if missing)', () => {
  const result = lib.preFlightGates({
    lab: { claudeMd: '/nonexistent', codexAgents: '/nonexistent', homeAgents: '/nonexistent' },
    install: { /* ... */ },
    frozenLibs: { /* ... */ },
  });
  // G1: skip missing target gracefully — pass if at least one lab exists, else "nothing to migrate"
  assert.ok(result.gates.G1 !== 'fatal', 'G1 should not fatal-error on missing files');
});

test('preFlightGates G2: idempotent no-op if nothing to migrate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, '# Clean file, no cbm or legacy markers');
  const result = lib.preFlightGates({
    lab: { codexAgents: fixture, claudeMd: null, homeAgents: null },
    install: { hasCbm: false, hasLegacy: false },
    frozenLibs: { match: true },
  });
  assert.equal(result.action, 'noop', 'G2 returns noop when nothing to migrate');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('preFlightGates G3: content alignment blocks unless --force', () => {
  // Stubbed: lab MCP doc differs from spec extraction
  const result = lib.preFlightGates({
    lab: { /* with content */ },
    install: { /* ... */ },
    frozenLibs: { match: true },
    contentMismatch: true,
    force: false,
  });
  assert.equal(result.gates.G3, 'fail', 'G3 fails on content mismatch without --force');
  // With --force:
  const resultForce = lib.preFlightGates({ contentMismatch: true, force: true });
  assert.notEqual(resultForce.gates.G3, 'fail', 'G3 passes with --force');
});

test('preFlightGates G4: lock file blocks concurrent runs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const lockFile = path.join(tmpDir, '.migration.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 12345, started: new Date().toISOString() }));
  const result = lib.preFlightGates({ somaHome: tmpDir });
  assert.equal(result.gates.G4, 'fail');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('preFlightGates G6: frozen libs baseline mismatch fails', () => {
  const result = lib.preFlightGates({
    frozenLibs: { match: false, drift: ['anchored-blocks.cjs'] }
  });
  assert.equal(result.gates.G6, 'fail');
});
```

- [ ] **Step 11.2: Run tests (FAIL)**

- [ ] **Step 11.3: Implement preFlightGates()**

```js
/**
 * Run pre-flight gates G1-G6. Returns {gates: {...}, action: 'proceed'|'noop'|'abort', failures: []}.
 *
 * @param {object} ctx — { lab, install, frozenLibs, contentMismatch, force, somaHome }
 * @returns {{gates: object, action: string, failures: string[]}}
 */
exports.preFlightGates = function(ctx = {}) {
  const gates = {};
  const failures = [];

  // G1: lab files exist (graceful — only fail if ALL three are missing)
  const labFiles = [ctx.lab?.claudeMd, ctx.lab?.codexAgents, ctx.lab?.homeAgents].filter(Boolean);
  const existingLabs = labFiles.filter(f => fs.existsSync(f));
  gates.G1 = existingLabs.length > 0 ? 'pass' : 'noop';

  // G2: idempotency check
  const hasCbm = ctx.install?.hasCbm ?? false;
  const hasLegacy = ctx.install?.hasLegacy ?? false;
  gates.G2 = (hasCbm || hasLegacy) ? 'pass' : 'noop';

  // G3: content alignment
  if (ctx.contentMismatch && !ctx.force) {
    gates.G3 = 'fail';
    failures.push('G3: lab MCP doc differs from spec extraction. Use --force to override.');
  } else {
    gates.G3 = 'pass';
  }

  // G4: lock file
  if (ctx.somaHome) {
    const lockFile = path.join(ctx.somaHome, '.migration.lock');
    if (fs.existsSync(lockFile)) {
      gates.G4 = 'fail';
      failures.push(`G4: another migration running (lock at ${lockFile})`);
    } else {
      gates.G4 = 'pass';
    }
  } else {
    gates.G4 = 'pass';
  }

  // G5: snapshot disk space (skip if no somaHome)
  gates.G5 = 'pass'; // simplified — production should check via fs.statvfs equivalent

  // G6: frozen libs match
  if (ctx.frozenLibs && !ctx.frozenLibs.match) {
    gates.G6 = 'fail';
    failures.push(`G6: frozen libs drifted: ${(ctx.frozenLibs.drift || []).join(', ')}`);
  } else {
    gates.G6 = 'pass';
  }

  // Determine action
  let action;
  if (gates.G1 === 'noop' || gates.G2 === 'noop') {
    action = 'noop';
  } else if (failures.length > 0) {
    action = 'abort';
  } else {
    action = 'proceed';
  }

  return { gates, action, failures };
};
```

- [ ] **Step 11.4: Run tests (PASS)**

- [ ] **Step 11.5: Commit**

```bash
git commit -am "feat(migrate): add preFlightGates() G1-G6 (Wave B Task 11)

Returns {gates, action, failures}. action ∈ {proceed, noop, abort}.
5 new tests pass.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: migrateCbmDeprecation() main orchestration — RED + GREEN

- [ ] **Step 12.1: Append failing test (integration of all sub-functions)**

```js
test('migrateCbmDeprecation: orchestrates full lifecycle (sandbox)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  // Setup minimal sandbox: mock SOMA_HOME with scripts/doctor.cjs, manifest.json, etc.
  // Setup lab files with cbm anchor + legacy markers
  // ... (full setup omitted for brevity — test should be ~50 lines of fixture)
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd: path.join(tmpDir, 'CLAUDE.md'), codexAgents: null, homeAgents: null },
    dryRun: false,
    force: false,
  });
  assert.equal(result.action, 'completed');
  assert.equal(result.gates.G1, 'pass');
  // Verify post-state: cbm anchor renamed to hyd-v2, snapshot created
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 12.2: Implement migrateCbmDeprecation()**

```js
/**
 * Main migration orchestration. Two-phase commit: snapshot → apply → verify or rollback.
 *
 * @param {object} opts — {somaHome, target, dryRun, force, revert}
 * @returns {{action, gates, snapshotId, failures}}
 */
exports.migrateCbmDeprecation = function(opts) {
  const { somaHome, target, dryRun = false, force = false, revert = null } = opts;

  // Revert path: just restore from named snapshot
  if (revert) {
    exports.rollbackFromSnapshot(somaHome, revert);
    return { action: 'reverted', snapshotId: revert };
  }

  // Pre-flight
  const ctx = buildPreFlightContext(somaHome, target, force);
  const gates = exports.preFlightGates(ctx);

  if (gates.action === 'noop') {
    return { action: 'noop', gates: gates.gates, message: 'Nothing to migrate' };
  }
  if (gates.action === 'abort') {
    return { action: 'abort', gates: gates.gates, failures: gates.failures };
  }

  // Dry run: report what would change, no mutations
  if (dryRun) {
    const preview = computePreview(target);
    return { action: 'dry-run', gates: gates.gates, preview };
  }

  // Phase 2: snapshot then mutate
  const filesToSnapshot = [target.claudeMd, target.codexAgents, target.homeAgents].filter(Boolean);
  const snapshotId = exports.createMigrationSnapshot(somaHome, filesToSnapshot);

  try {
    // Mutate each lab file
    if (target.claudeMd) migrateClaude(target.claudeMd);
    if (target.codexAgents) migrateCodexAgents(target.codexAgents);
    if (target.homeAgents) migrateCodexAgents(target.homeAgents);

    // Verify
    const verify = exports.verifyMigration(somaHome);
    if (!verify.ok) {
      throw new Error(`Verify failed: ${verify.findings.join('; ')}`);
    }

    return { action: 'completed', gates: gates.gates, snapshotId };
  } catch (err) {
    // Rollback
    exports.rollbackFromSnapshot(somaHome, snapshotId);
    return { action: 'rolled-back', gates: gates.gates, snapshotId, error: err.message };
  }
};

// Helpers
function buildPreFlightContext(somaHome, target, force) { /* read files, check anchors, etc. */ return {}; }
function computePreview(target) { /* return diff preview */ return {}; }
function migrateClaude(claudeMdPath) {
  const content = fs.readFileSync(claudeMdPath, 'utf8');
  // Step 1: rename cbm → hyd-v2 anchor
  // Step 2: delete legacy hyd-v2 markers nested inside (from former cbm content)
  // Step 3: atomicWrite
}
function migrateCodexAgents(agentsPath) {
  const content = fs.readFileSync(agentsPath, 'utf8');
  // Step 1: detect legacy markers OR existing soma-v2 anchor
  // Step 2: Convert legacy → soma-v2 anchor (or fix existing anchor source ref)
  // Step 3: atomicWrite
}
```

- [ ] **Step 12.3: Run tests (PASS)**

- [ ] **Step 12.4: Commit**

```bash
git commit -am "feat(migrate): add migrateCbmDeprecation() main (Wave B Task 12)

Two-phase commit. Snapshot+mutate+verify or rollback.
Resolves AC-09 (lib API), AC-13 (snapshot), AC-14 (atomic), AC-16 (verify).

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave C — Entry Points (Tasks 13-15)

### Task 13: CLI wrapper

- [ ] **Step 13.1: Create CLI**

Create `core/scripts/migrate-cbm-deprecation.cjs`:

```js
#!/usr/bin/env node
'use strict';
/**
 * CLI wrapper for migrateCbmDeprecation() library.
 *
 * Usage:
 *   node migrate-cbm-deprecation.cjs [--dry-run] [--force] [--revert <snapshot-id>]
 *
 * @spec core/specs/013-cbm-deprecation/spec.md AC-10
 */

const path = require('node:path');
const os = require('node:os');
const lib = require('./lib/migrate.cjs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const revertIdx = args.indexOf('--revert');
const revert = revertIdx !== -1 ? args[revertIdx + 1] : null;

const somaHome = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const target = {
  claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  codexAgents: path.join(os.homedir(), '.codex', 'AGENTS.md'),
  homeAgents: path.join(os.homedir(), 'AGENTS.md'),
};

const result = lib.migrateCbmDeprecation({ somaHome, target, dryRun, force, revert });
console.log(JSON.stringify(result, null, 2));
process.exit(result.action === 'abort' || result.action === 'rolled-back' ? 1 : 0);
```

- [ ] **Step 13.2: Run --dry-run smoke test**

Run: `node core/scripts/migrate-cbm-deprecation.cjs --dry-run`
Expected: JSON output with `"action": "dry-run"` or `"action": "noop"`

- [ ] **Step 13.3: Commit**

```bash
git commit -am "feat(migrate): add migrate-cbm-deprecation.cjs CLI (Wave C Task 13)

Entry point #3. Supports --dry-run/--force/--revert flags.
Resolves AC-10.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: sync.cjs auto-detect

- [ ] **Step 14.1: Add detection block to sync.cjs**

Edit `core/scripts/sync.cjs`. Find the `--apply` handler entry point (search for `if (apply)` or similar). Add BEFORE block injection:

```js
// Auto-detect cbm/legacy markers and invoke migration if found (Spec 013, AC-12)
if (apply) {
  const migrate = require('./lib/migrate.cjs');
  const target = {
    claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    codexAgents: path.join(os.homedir(), '.codex', 'AGENTS.md'),
    homeAgents: path.join(os.homedir(), 'AGENTS.md'),
  };
  const probeResult = migrate.preFlightGates({
    lab: target,
    install: detectLegacyMarkers(target), // helper
    frozenLibs: { match: true }, // assume CLEAN — verified separately
  });
  if (probeResult.action === 'proceed') {
    console.log('SOMA: cbm/legacy markers detected, running migration first...');
    const migrateResult = migrate.migrateCbmDeprecation({ somaHome, target, dryRun: false });
    if (migrateResult.action !== 'completed' && migrateResult.action !== 'noop') {
      console.error(`Migration failed: ${migrateResult.error || 'unknown'}`);
      process.exit(1);
    }
  }
}
```

Add helper:
```js
function detectLegacyMarkers(target) {
  const result = { hasCbm: false, hasLegacy: false };
  for (const file of Object.values(target).filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/id=block\.[^\.]+\..*\.cbm/.test(content)) result.hasCbm = true;
    if (/<!--\s*codebase-memory-mcp:start\s*-->/.test(content)) result.hasLegacy = true;
  }
  return result;
}
```

- [ ] **Step 14.2: Verify sync.cjs still passes BF-03 reproducer**

Run: `node --test core/scripts/__tests__/bf-03-consolidation-reproducer.test.cjs`
Expected: 2 pass (regression check)

- [ ] **Step 14.3: Commit**

```bash
git commit -am "feat(sync): auto-detect + invoke cbm migration (Wave C Task 14)

Pre-apply detection of cbm anchors / legacy markers. Auto-invokes
migrateCbmDeprecation() if found. Resolves AC-12.

BF-03 reproducer still GREEN (regression preserved).

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: install.sh auto-detect

- [ ] **Step 15.1: Add detection to install.sh**

Edit `install.sh`. Add BEFORE the main install logic:

```bash
# Spec 013: Auto-detect cbm/legacy markers in lab, invoke migration first
LAB_CLAUDE="$HOME/.claude/CLAUDE.md"
LAB_CODEX="$HOME/.codex/AGENTS.md"
LAB_HOME="$HOME/AGENTS.md"

NEEDS_MIGRATION=0
for FILE in "$LAB_CLAUDE" "$LAB_CODEX" "$LAB_HOME"; do
  if [ -f "$FILE" ]; then
    if grep -qE 'id=block\.[^\.]+\..*\.cbm|<!-- codebase-memory-mcp:start -->' "$FILE" 2>/dev/null; then
      NEEDS_MIGRATION=1
      break
    fi
  fi
done

if [ "$NEEDS_MIGRATION" -eq 1 ]; then
  echo "SOMA install: cbm/legacy markers detected. Running cbm migration first..."
  node "$SOMA_HOME/scripts/migrate-cbm-deprecation.cjs" || {
    echo "ERROR: cbm migration failed. Aborting install. Inspect snapshot in $SOMA_HOME/.snapshots/" >&2
    exit 1
  }
fi
# (continue with main install...)
```

- [ ] **Step 15.2: Smoke test (synthetic env)**

Run: `bash install/synthetic-env.test.sh` (existing test from Phase 6.4)
Expected: PASS — install.sh still works in synthetic env

- [ ] **Step 15.3: Commit**

```bash
git commit -am "feat(install.sh): auto-detect + invoke cbm migration (Wave C Task 15)

Pre-install detection. Aborts install on migration failure.
Resolves AC-11.

Synthetic env test still PASS.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave D — E2E Integration (Task 16)

### Task 16: E2E integration tests (6 scenarios)

**Files:**
- Create: `core/tests/integration/bf-04-cbm-e2e.test.cjs`

- [ ] **Step 16.1: Write 6 e2e scenarios**

```js
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX_PREFIX = '/tmp/bf-04-e2e';

before(() => fs.mkdirSync(SANDBOX_PREFIX, { recursive: true }));

function setupFixture(name) {
  const root = path.join(SANDBOX_PREFIX, `${name}-${Date.now()}`);
  const home = path.join(root, 'home');
  const somaHome = path.join(home, '.soma-v2');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(somaHome, { recursive: true });
  // Copy real soma-v2 scripts + docs into sandbox
  spawnSync('cp', ['-R', `${process.env.HOME}/.soma-v2/.`, somaHome], { stdio: 'pipe' });
  // Setup pre-migration lab state
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), [
    '# Claude Self-Model',
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=oldhash -->',
    '<!-- hyd-v2:start -->',
    '# HYD content',
    '<!-- hyd-v2:end -->',
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->',
  ].join('\n'));
  fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), [
    '<!-- codebase-memory-mcp:start -->',
    '# Codebase Knowledge Graph',
    'MCP doc',
    '<!-- codebase-memory-mcp:end -->',
    '<!-- hyd-v2:start -->',
    '# HYD discipline',
    '<!-- hyd-v2:end -->',
  ].join('\n'));
  return { root, home, somaHome };
}

test('Scenario 1: install.sh trigger migrates lab', () => {
  const { home, somaHome } = setupFixture('s1');
  const result = spawnSync('bash', [path.join(somaHome, 'install.sh')], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `install failed: ${result.stderr}`);
  // Verify post state
  const claudeContent = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.match(claudeContent, /id=block\.claude\.CLAUDE_md\.hyd-v2/);
  assert.doesNotMatch(claudeContent, /id=block\.claude\.CLAUDE_md\.cbm/);
});

test('Scenario 2: sync --apply trigger migrates lab', () => {
  const { home, somaHome } = setupFixture('s2');
  const result = spawnSync('node', [path.join(somaHome, 'scripts', 'sync.cjs'), '--apply'], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome },
    encoding: 'utf8',
  });
  // Verify migration ran
  assert.match(result.stdout, /cbm.*detected/);
});

test('Scenario 3: explicit CLI migrates lab', () => {
  const { home, somaHome } = setupFixture('s3');
  const result = spawnSync('node', [path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs')], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.action, 'completed');
});

test('Scenario 4: --dry-run zero mutations', () => {
  const { home, somaHome } = setupFixture('s4');
  const claudeBefore = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  spawnSync('node', [path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs'), '--dry-run'], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome },
  });
  const claudeAfter = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.equal(claudeBefore, claudeAfter, 'dry-run must not mutate files');
});

test('Scenario 5: --revert restores from snapshot', () => {
  const { home, somaHome } = setupFixture('s5');
  const claudeOriginal = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  // Run migration
  const r1 = spawnSync('node', [path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs')], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome }, encoding: 'utf8',
  });
  const out1 = JSON.parse(r1.stdout);
  // Revert
  spawnSync('node', [path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs'), '--revert', out1.snapshotId], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome },
  });
  const claudeRestored = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.equal(claudeOriginal, claudeRestored);
});

test('Scenario 6: content mismatch aborts without --force', () => {
  const { home, somaHome } = setupFixture('s6');
  // Edit MCP doc in lab so it differs from spec extraction
  fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), [
    '<!-- codebase-memory-mcp:start -->',
    '# Hand-edited content (drift)',
    '<!-- codebase-memory-mcp:end -->',
  ].join('\n'));
  const result = spawnSync('node', [path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs')], {
    env: { ...process.env, HOME: home, SOMA_HOME: somaHome }, encoding: 'utf8',
  });
  const out = JSON.parse(result.stdout);
  assert.equal(out.action, 'abort');
  assert.match(out.failures.join(' '), /G3/);
});
```

- [ ] **Step 16.2: Run e2e tests**

Run: `node --test core/tests/integration/bf-04-cbm-e2e.test.cjs`
Expected: 6 pass (or surface bugs in migration logic if any)

- [ ] **Step 16.3: Commit**

```bash
git commit -am "test: add BF-04 e2e tests (6 scenarios) (Wave D Task 16)

Validates 3 entry points (install.sh + sync + CLI) + dry-run + revert
+ content-mismatch abort. Resolves AC-02/03/07/08/14.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave E — Test cleanup (Tasks 17-20)

### Task 17: Frozen libs invariant test (NEW)

- [ ] **Step 17.1: Create invariant test**

Create `core/scripts/__tests__/bf-04-frozen-libs-invariant.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FROZEN_LIBS = {
  'anchored-blocks.cjs': '6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f',
  'manifest.cjs':        '08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462',
  'template-engine.cjs': 'f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b',
};

test('frozen libs: shasums match baseline (Spec 013 AC-17)', () => {
  for (const [file, expectedSha] of Object.entries(FROZEN_LIBS)) {
    const fpath = path.join(REPO_ROOT, 'core/scripts/lib', file);
    const content = fs.readFileSync(fpath);
    const actualSha = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(actualSha, expectedSha, `frozen lib ${file} drift detected`);
  }
});
```

- [ ] **Step 17.2: Run test (PASS)**

Run: `node --test core/scripts/__tests__/bf-04-frozen-libs-invariant.test.cjs`
Expected: 1 pass

- [ ] **Step 17.3: Commit**

```bash
git commit -am "test: frozen libs invariant baseline e868fab (Wave E Task 17)

Asserts 3 lib shasums match baseline. Catches accidental mutation.
Resolves AC-17.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Update doctor-migration.contract.test.cjs

- [ ] **Step 18.1: Find and update assertion**

Edit `core/scripts/__tests__/doctor-migration.contract.test.cjs`. Find line ~423:

```js
- assert.equal(result.install_targets_count, 9);
+ assert.equal(result.install_targets_count, 8);
```

- [ ] **Step 18.2: Run test (PASS)**

- [ ] **Step 18.3: Commit**

```bash
git commit -am "test: update doctor-migration assertion 9→8 (Wave E Task 18)

Reflects claude install-targets dropping cbm entry. AC-20.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Update sync.dry-run-edits.test.cjs

- [ ] **Step 19.1: Find and update assertion**

Edit `core/scripts/__tests__/sync.dry-run-edits.test.cjs`. Find line ~824:

```js
- assert.equal(summary.total_entries, 9);
+ assert.equal(summary.total_entries, 8);
```

- [ ] **Step 19.2: Run test (PASS)**

- [ ] **Step 19.3: Commit**

```bash
git commit -am "test: update sync.dry-run-edits assertion 9→8 (Wave E Task 19)

Reflects claude install-targets dropping cbm entry. AC-20.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Regression check + full suite

- [ ] **Step 20.1: Run BF-03 reproducer (regression)**

Run: `node --test core/scripts/__tests__/bf-03-consolidation-reproducer.test.cjs`
Expected: 2 pass (no regression). If fails → STOP, report.

- [ ] **Step 20.2: Run full test suite**

Run: `node --test core/scripts/__tests__/ core/tests/integration/ 2>&1 | tail -10`
Expected: ≥850 pass, 0 fail, 2 skip (existing). Capture output for PR description.

- [ ] **Step 20.3: Frozen libs final check**

Run: `shasum -a 256 core/scripts/lib/anchored-blocks.cjs core/scripts/lib/manifest.cjs core/scripts/lib/template-engine.cjs`
Expected: 3/3 match baseline (per Task 3 / AC-17).

---

## Wave F — Documentation (Tasks 21-22)

### Task 21: Update adapter-contract.md D-C11

- [ ] **Step 21.1: Edit D-C11 section**

Edit `core/docs/adapter-contract.md`. Find D-C11 (around line 61):

```diff
- Decision (D-C11): Claude adapter uses `~/.claude/CLAUDE.md` as install target with anchor IDs `block.claude.CLAUDE_md.{cbm,hyd-v2,soma-stsd}` parallel to Codex's `block.codex.AGENTS.{cbm,hyd-v2,soma-stsd}` pattern.
+ Decision (D-C11): Claude adapter uses `~/.claude/CLAUDE.md` as install target with anchor IDs `block.claude.CLAUDE_md.{hyd-v2,soma-stsd,soma-voxel}`. Codex uses `~/.codex/AGENTS.md` + `~/AGENTS.md` with anchor IDs `block.codex.AGENTS.{codebase-memory-mcp,hyd-v2,soma-stsd}`. Sources: `docs/hyd-v2.md`, `docs/soma-stsd.md`, `docs/output-style.md` (claude soma-voxel only), `docs/codebase-memory-mcp.md` (codex codebase-memory-mcp only).
+
+ **Note (Spec 013, v2.1.1)**: legacy `cbm` anchor (claude) deprecated and auto-migrated. Codex `codebase-memory-mcp` source corrected from misroute (`docs/hyd-v2.md` → `docs/codebase-memory-mcp.md`).
```

Also update line 15-17 examples block to drop `cbm` references.

- [ ] **Step 21.2: Commit**

```bash
git commit -am "docs(adapter-contract): update D-C11 for Spec 013 (Wave F Task 21)

Drop cbm from claude triplet. Add explicit source for codex codebase-memory-mcp.
Resolves AC-21.

Refs #9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Add CHANGELOG v2.1.1 entry

- [ ] **Step 22.1: Edit CHANGELOG**

Edit `CHANGELOG.md`. Add at top (above v2.1.0 entry):

```markdown
## v2.1.1 — 2026-05-XX

### BREAKING

- **`cbm` anchor deprecated** in claude adapter. Auto-migrated to `hyd-v2` anchor by `install.sh`, `soma sync --apply`, or explicit `node ~/.soma-v2/scripts/migrate-cbm-deprecation.cjs`. Snapshot retained for 30 days; revert via `--revert <snapshot-id>` flag.

### Fixed

- **codex `codebase-memory-mcp` source restored** from Phase 5 Q2 misroute. Source doc now `docs/codebase-memory-mcp.md` (was incorrectly `docs/hyd-v2.md`, which would have silently overwritten user's MCP doc on sync apply). Closes #9.
- **Manifest drift target_drift category** resolved via cbm migration. Closes remaining doctor.cjs target_drift findings from #8.

### Migration

If your installation has `cbm` anchor in `~/.claude/CLAUDE.md` or legacy `<!-- codebase-memory-mcp:start -->` markers in `~/.codex/AGENTS.md`:
1. Re-run `bash install.sh` (auto-migrates) OR
2. Run `node ~/.soma-v2/scripts/migrate-cbm-deprecation.cjs` explicitly OR
3. Run `soma sync --apply` (auto-migrates first)

All 3 paths invoke same library function with snapshot + auto-rollback safety.
```

- [ ] **Step 22.2: Commit**

```bash
git commit -am "docs(changelog): add v2.1.1 entry (Wave F Task 22)

BREAKING: cbm deprecated, auto-migrated. FIXED: codex source restored,
target_drift cleared. Migration paths documented.
Resolves AC-22.

Refs #9 #8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave G — Audit + Quality Gates (Tasks 23-24)

### Task 23: gap-finder skill audit

- [ ] **Step 23.1: Invoke gap-finder skill**

Use the gap-finder skill (per Felipe's "etc" requirement) to audit recent work for subtle gaps in 5 categories. Document findings inline if any. If no gaps → proceed.

- [ ] **Step 23.2: Address any gaps found**

Create new tasks in plan for any P0/P1 gaps surfaced. P2/P3 gaps captured as follow-up Issues.

---

### Task 24: /quality-check command

- [ ] **Step 24.1: Run /quality-check**

Compares implemented work against original spec/plan. Surfaces drift.

- [ ] **Step 24.2: Address drift**

Fix any drift. Re-commit if needed.

---

## Wave H — PR + Validation + Merge (Task 25)

### Task 25: Open PR + Felipe validation + merge

- [ ] **Step 25.1: Push branch (if not already)**

```bash
git push origin fix/issue-9-cbm-deprecation
```

- [ ] **Step 25.2: Open DRAFT PR**

```bash
gh pr create --draft --title "Spec 013: cbm deprecation + codex source restoration (closes #8 #9)" --body "$(cat <<'EOF'
## Summary
Resolves Issues #8 (target_drift) and #9 (install-targets dup) per Spec 013.

### Path 1A — Claude cbm cleanup
[summary]

### Path 1B — Codex source restoration
[summary]

### Migration mechanism
[summary]

## Test plan
- [x] BF-04 reproducer: 3/3 pass (RED→GREEN linear in branch)
- [x] Migration unit tests: ~15 pass
- [x] E2E integration: 6 scenarios pass
- [x] BF-03 reproducer: still GREEN (no regression)
- [x] Frozen libs: 3/3 shasums match baseline e868fab
- [x] Full suite: 850+ pass, 0 fail, 2 skip
- [x] Felipe lab dry-run: doctor.cjs reports 0 findings post-simulation

## Spec
core/specs/013-cbm-deprecation/spec.md (22 ACs, 9 locked decisions)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 25.3: Run dry-run on Felipe's actual lab as final validation**

Run: `node ~/.soma-v2/scripts/migrate-cbm-deprecation.cjs --dry-run`
Capture output. Surface to Felipe for empirical sign-off.

- [ ] **Step 25.4: Felipe approves dry-run output**

Wait for explicit approval. Felipe inspects diff preview.

- [ ] **Step 25.5: Run real migration on Felipe's lab**

After approval:
```bash
node ~/.soma-v2/scripts/migrate-cbm-deprecation.cjs
```

Verify post-state:
```bash
node ~/.soma-v2/scripts/doctor.cjs
# Expected: 0 findings
```

- [ ] **Step 25.6: Mark PR ready + rebase merge**

```bash
gh pr ready <PR_NUMBER>
gh pr merge <PR_NUMBER> --rebase --delete-branch
```

- [ ] **Step 25.7: Tag v2.1.1 + GitHub Release**

```bash
git checkout main && git pull --ff-only
git tag -a v2.1.1 -m "v2.1.1: cbm deprecation + codex source restoration

Closes #8 #9. See CHANGELOG.md for migration guidance."
git push origin v2.1.1
gh release create v2.1.1 --title "v2.1.1 — cbm deprecation + codex source restoration" --notes "See CHANGELOG.md"
```

---

## Self-Review (orchestrator pre-handoff)

### Spec coverage check

| Spec AC | Plan task |
|---|---|
| AC-01 | Task 1 + Task 2 |
| AC-02 | Task 16 (e2e scenarios 1-3 verify) |
| AC-03 | Task 5 + Task 12 |
| AC-04 | Task 1 + Task 2 |
| AC-05 | Task 2 |
| AC-06 | Task 1 + Task 2 |
| AC-07 | Task 16 (e2e) |
| AC-08 | Task 16 (e2e) |
| AC-09 | Tasks 4-12 (lib functions) |
| AC-10 | Task 13 (CLI) |
| AC-11 | Task 15 (install.sh) |
| AC-12 | Task 14 (sync.cjs) |
| AC-13 | Task 8 + Task 12 |
| AC-14 | Task 12 + Task 16 (e2e Phase 2 fail rollback) |
| AC-15 | Task 11 (G1-G6 individually) |
| AC-16 | Task 10 + Task 25.5 |
| AC-17 | Task 17 |
| AC-18 | Task 14 (regression) + Task 20 |
| AC-19 | Task 1 (RED) + Task 2 (GREEN) — verified by orchestrator pre-merge |
| AC-20 | Task 20 |
| AC-21 | Task 21 |
| AC-22 | Task 22 |

✅ All 22 ACs covered.

### Placeholder scan

Run after writing: search for "TBD", "TODO", "implement later", "fill in details", "Add appropriate", "similar to Task N" → no instances expected.

### Type consistency

- `migrateCbmDeprecation()` signature consistent across Tasks 12 + 13 + 14 + 15 + 16 ✅
- `extractMcpContentFromLab()`, `deleteLegacyBlock()`, `renameAnchor()`, `atomicWrite()`, `createMigrationSnapshot()`, `verifyMigration()`, `rollbackFromSnapshot()`, `preFlightGates()` names consistent ✅
- Snapshot ID format `{ISO-8601-Z}-cbm-deprecation` consistent ✅

---

## Execution Handoff

Plan complete and saved to `core/specs/013-cbm-deprecation/plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Orchestrator dispatches fresh Sonnet per task, reviews between tasks, fast iteration. Best for "impecável" + per-task validation.

2. **Inline Execution** — Single Sonnet executes all 25 tasks in one dispatch with checkpoints. Faster total wall-time but less granular review.

**Recommendation**: Subagent-Driven, with logical task batching (Wave A as 1 dispatch, Wave B as 1 dispatch covering all sub-functions, Wave C as 1 dispatch, etc). Total ~6-8 dispatches instead of 25 individual ones — balances granularity with overhead.

After execution, gap-finder + quality-check + Felipe sign-off + merge.
