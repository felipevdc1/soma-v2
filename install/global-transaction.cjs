#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const JOURNAL_SCHEMA = 'soma-global-install-transaction/v1';
const POINTER_SCHEMA = 'soma-global-install-transaction-pointer/v1';
const POINTER_NAME = '.active-transaction.json';
const FORWARD_STATES = [
  'PREPARING',
  'PREPARED',
  'ADOPTED',
  'CORE_COPIED',
  'FILES_SYNCED',
  'SETTINGS_MERGED',
  'ANCHORS_SYNCED',
  'VERIFIED',
  'COMMITTED',
];
const TERMINAL_STATES = new Set(['COMMITTED', 'ROLLED_BACK']);
const ALL_STATES = new Set([...FORWARD_STATES, 'ROLLING_BACK', 'ROLLBACK_VERIFIED', 'ROLLED_BACK']);

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function fsyncDirectory(directoryPath) {
  const fd = fs.openSync(directoryPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError('UNSAFE_PATH', `durability barrier requires a regular file: ${filePath}`);
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncPathTree(targetPath) {
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) throw codedError('UNSAFE_PATH', `symlink is not durable transaction state: ${targetPath}`);
  if (stat.isFile()) {
    fsyncRegularFile(targetPath);
    return;
  }
  if (!stat.isDirectory()) throw codedError('UNSAFE_PATH', `special path is not durable transaction state: ${targetPath}`);
  for (const name of fs.readdirSync(targetPath).sort()) {
    fsyncPathTree(path.join(targetPath, name));
  }
  fsyncDirectory(targetPath);
}

function fsyncParentChain(startPath, stopPath) {
  let current = startPath;
  while (isWithin(stopPath, current)) {
    const stat = lstatIfPresent(current);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError('UNSAFE_PATH', `durability parent is not a real directory: ${current}`);
      }
      fsyncDirectory(current);
    }
    if (current === stopPath) break;
    current = path.dirname(current);
  }
}

function fsyncPathAndParents(targetPath, stopPath) {
  fsyncPathTree(targetPath);
  fsyncParentChain(path.dirname(targetPath), stopPath);
}

function atomicWriteJson(filePath, value) {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const tempPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, filePath);
    fsyncDirectory(directoryPath);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function writeJsonNoClobber(filePath, value) {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(directoryPath);
}

function maybeTransactionFault(state, boundary) {
  if (
    process.env.SOMA_INSTALL_TESTING === '1' &&
    process.env.SOMA_TRANSACTION_CRASH_AFTER === `${state}:${boundary}`
  ) {
    process.kill(process.pid, 'SIGKILL');
  }
  if (
    process.env.SOMA_INSTALL_TESTING === '1' &&
    process.env.SOMA_TRANSACTION_FAULT_AFTER === `${state}:${boundary}`
  ) {
    throw codedError('TEST_FAULT', `injected transaction fault after ${state}:${boundary}`);
  }
}

function hashFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError('UNSAFE_PATH', `hashFile requires a regular file: ${filePath}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function treeEntries(rootPath) {
  const rootStat = fs.lstatSync(rootPath);
  if (rootStat.isSymbolicLink()) throw codedError('UNSAFE_PATH', `symlink is not allowed: ${rootPath}`);
  if (!rootStat.isDirectory()) throw codedError('UNSAFE_PATH', `hashTree requires a directory: ${rootPath}`);
  const entries = [];
  function visit(currentPath, relativePath) {
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink()) throw codedError('UNSAFE_PATH', `symlink is not allowed: ${currentPath}`);
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      entries.push({ type: 'directory', relativePath, mode });
      for (const name of fs.readdirSync(currentPath).sort()) {
        visit(path.join(currentPath, name), relativePath ? path.join(relativePath, name) : name);
      }
      return;
    }
    if (!stat.isFile()) throw codedError('UNSAFE_PATH', `special file is not allowed: ${currentPath}`);
    entries.push({ type: 'file', relativePath, mode, bytes: fs.readFileSync(currentPath) });
  }
  visit(rootPath, '');
  return entries;
}

function hashTree(rootPath) {
  const hash = crypto.createHash('sha256');
  for (const entry of treeEntries(rootPath)) {
    hash.update(entry.type);
    hash.update('\0');
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(entry.mode.toString(8));
    hash.update('\0');
    if (entry.bytes) hash.update(entry.bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyTree(sourcePath, targetPath) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw codedError('UNSAFE_PATH', `directory snapshot source is unsafe: ${sourcePath}`);
  }
  fs.mkdirSync(targetPath, { recursive: true, mode: sourceStat.mode & 0o7777 });
  fs.chmodSync(targetPath, sourceStat.mode & 0o7777);
  for (const name of fs.readdirSync(sourcePath).sort()) {
    const sourceChild = path.join(sourcePath, name);
    const targetChild = path.join(targetPath, name);
    const stat = fs.lstatSync(sourceChild);
    if (stat.isSymbolicLink()) throw codedError('UNSAFE_PATH', `symlink is not allowed: ${sourceChild}`);
    if (stat.isDirectory()) {
      copyTree(sourceChild, targetChild);
    } else if (stat.isFile()) {
      fs.copyFileSync(sourceChild, targetChild);
      fs.chmodSync(targetChild, stat.mode & 0o7777);
    } else {
      throw codedError('UNSAFE_PATH', `special file is not allowed: ${sourceChild}`);
    }
  }
}

function assertAbsolute(label, value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw codedError('INVALID_ARGS', `${label} must be an absolute path`);
  }
  return path.normalize(value);
}

function assertExistingDirectory(label, value) {
  const absolute = assertAbsolute(label, value);
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw codedError('UNSAFE_PATH', `${label} must be a real directory, not a symlink: ${absolute}`);
  }
  return absolute;
}

function assertNoSymlinkComponents(basePath, targetPath) {
  if (!isWithin(basePath, targetPath)) {
    throw codedError('UNSAFE_PATH', `path escapes HOME: ${targetPath}`);
  }
  const relative = path.relative(basePath, targetPath);
  let current = basePath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfPresent(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw codedError('UNSAFE_PATH', `symlink is not allowed in target path: ${current}`);
    }
  }
}

function resolveHomeTarget(home, declaredPath) {
  if (typeof declaredPath !== 'string' || declaredPath.length === 0) {
    throw codedError('INVALID_MANIFEST', 'target_path must be a non-empty string');
  }
  let targetPath;
  if (declaredPath === '~') {
    targetPath = home;
  } else if (declaredPath.startsWith('~/')) {
    targetPath = path.resolve(home, declaredPath.slice(2));
  } else if (path.isAbsolute(declaredPath)) {
    targetPath = path.normalize(declaredPath);
  } else {
    throw codedError('UNSAFE_PATH', `target_path must be absolute or HOME-relative: ${declaredPath}`);
  }
  if (targetPath === home || !isWithin(home, targetPath)) {
    throw codedError('UNSAFE_PATH', `target_path escapes or replaces HOME: ${declaredPath}`);
  }
  return targetPath;
}

function readManifest(manifestPath) {
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError('UNSAFE_PATH', `manifest must be a regular file: ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw codedError('INVALID_MANIFEST', `cannot parse ${manifestPath}: ${error.message}`);
  }
  if (parsed.schema !== 'soma-install-targets/v1' || !Array.isArray(parsed.entries)) {
    throw codedError('INVALID_MANIFEST', `invalid install-targets manifest: ${manifestPath}`);
  }
  return parsed;
}

function listRegularFiles(rootPath) {
  const stat = lstatIfPresent(rootPath);
  if (!stat) return [];
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw codedError('UNSAFE_PATH', `candidate tree must be a real directory: ${rootPath}`);
  }
  const files = [];
  function visit(directoryPath, relativePath) {
    for (const name of fs.readdirSync(directoryPath).sort()) {
      const absolute = path.join(directoryPath, name);
      const relative = relativePath ? path.join(relativePath, name) : name;
      const childStat = fs.lstatSync(absolute);
      if (childStat.isSymbolicLink()) throw codedError('UNSAFE_PATH', `candidate symlink is not allowed: ${absolute}`);
      if (childStat.isDirectory()) visit(absolute, relative);
      else if (childStat.isFile()) files.push(relative);
      else throw codedError('UNSAFE_PATH', `candidate special file is not allowed: ${absolute}`);
    }
  }
  visit(rootPath, '');
  return files;
}

function collectAllowlist({ repoRoot, home, noCodex, noClaudeMd }) {
  const entries = new Map();
  function add(targetPath, kind, origin, options = {}) {
    const normalized = path.normalize(targetPath);
    const existing = entries.get(normalized);
    if (existing) {
      if (options.rejectDuplicate || existing.rejectDuplicate) {
        throw codedError('DUPLICATE_TARGET', `duplicate target declaration: ${normalized}`);
      }
      existing.origins.push(origin);
      return;
    }
    entries.set(normalized, { targetPath: normalized, kind, origins: [origin], rejectDuplicate: options.rejectDuplicate });
  }

  add(path.join(home, '.soma-v2'), 'directory', 'fixed:core');
  add(path.join(home, '.claude', 'settings.json'), 'file', 'fixed:settings');

  const tools = noCodex ? ['claude'] : ['claude', 'codex'];
  const manifestLocations = [];
  for (const tool of tools) {
    manifestLocations.push({
      path: path.join(repoRoot, 'core', 'adapters', tool, 'install-targets.json'),
      origin: `candidate:${tool}`,
    });
    const oldPath = path.join(home, '.soma-v2', 'adapters', tool, 'install-targets.json');
    if (lstatIfPresent(oldPath)) manifestLocations.push({ path: oldPath, origin: `previous:${tool}` });
  }

  for (const location of manifestLocations) {
    const manifest = readManifest(location.path);
    const fileTargets = new Set();
    for (const entry of manifest.entries) {
      if (!entry || typeof entry !== 'object') {
        throw codedError('INVALID_MANIFEST', `non-object entry in ${location.path}`);
      }
      const targetPath = resolveHomeTarget(home, entry.target_path);
      if (noClaudeMd && targetPath === path.join(home, '.claude', 'CLAUDE.md')) continue;
      const isWholeFile = entry.kind === 'file';
      if (isWholeFile && fileTargets.has(targetPath)) {
        throw codedError('DUPLICATE_TARGET', `duplicate kind:file target in ${location.path}: ${targetPath}`);
      }
      if (isWholeFile) fileTargets.add(targetPath);
      add(targetPath, 'file', location.origin);
    }
  }

  for (const [sourceName, targetName] of [
    ['templates', 'templates'],
    ['output-styles', 'output-styles'],
  ]) {
    const sourceRoot = path.join(repoRoot, sourceName);
    for (const relative of listRegularFiles(sourceRoot)) {
      add(
        path.join(home, '.claude', targetName, relative),
        'file',
        `candidate:${sourceName}/${relative}`,
        { rejectDuplicate: true }
      );
    }
  }

  const sorted = [...entries.values()].sort((a, b) => a.targetPath.localeCompare(b.targetPath));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const parent = sorted[i];
      const child = sorted[j];
      if (isWithin(parent.targetPath, child.targetPath) && parent.targetPath !== child.targetPath) {
        throw codedError(
          'OVERLAPPING_TARGETS',
          `unsafe overlapping targets: ${parent.targetPath} contains ${child.targetPath}`
        );
      }
    }
  }
  for (const entry of sorted) assertNoSymlinkComponents(home, entry.targetPath);
  return sorted;
}

function missingAncestors(home, targetPath) {
  const missing = [];
  let current = path.dirname(targetPath);
  while (current !== home && isWithin(home, current) && !lstatIfPresent(current)) {
    missing.push(current);
    current = path.dirname(current);
  }
  return missing.reverse();
}

function snapshotAllowlist(allowlist, transactionDirectory, home) {
  const snapshotRoot = path.join(transactionDirectory, 'snapshots');
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const snapshots = allowlist.map((entry, index) => {
    const targetPath = entry.targetPath;
    const existingStat = lstatIfPresent(targetPath);
    const existed = existingStat !== null;
    const snapshot = {
      target_path: targetPath,
      kind: entry.kind,
      origins: entry.origins,
      existed,
      mode: null,
      sha256: null,
      snapshot_path: null,
      missing_ancestors: existed ? [] : missingAncestors(home, targetPath),
    };
    if (!existed) return snapshot;
    const stat = existingStat;
    if (stat.isSymbolicLink()) throw codedError('UNSAFE_PATH', `symlink target is not allowed: ${targetPath}`);
    if (entry.kind === 'directory' && !stat.isDirectory()) {
      throw codedError('UNSAFE_PATH', `expected directory target: ${targetPath}`);
    }
    if (entry.kind === 'file' && !stat.isFile()) {
      throw codedError('UNSAFE_PATH', `expected regular file target: ${targetPath}`);
    }
    const snapshotPath = path.join(snapshotRoot, String(index).padStart(4, '0'));
    snapshot.mode = stat.mode & 0o7777;
    snapshot.snapshot_path = snapshotPath;
    if (entry.kind === 'directory') {
      copyTree(targetPath, snapshotPath);
      snapshot.sha256 = hashTree(targetPath);
    } else {
      fs.copyFileSync(targetPath, snapshotPath);
      fs.chmodSync(snapshotPath, snapshot.mode);
      snapshot.sha256 = hashFile(targetPath);
    }
    return snapshot;
  });
  for (const snapshot of snapshots) {
    if (snapshot.existed) fsyncPathTree(snapshot.snapshot_path);
  }
  fsyncDirectory(snapshotRoot);
  fsyncDirectory(transactionDirectory);
  fsyncDirectory(path.dirname(transactionDirectory));
  return snapshots;
}

function pointerPathForBackupRoot(backupRoot) {
  return path.join(backupRoot, POINTER_NAME);
}

function pointerForJournal(journal, generationPath) {
  return {
    schema: POINTER_SCHEMA,
    transaction_path: journal.journal_path,
    generation_path: generationPath,
    journal_sha256: hashFile(generationPath),
  };
}

function persistJournal(journal, withPointer = true) {
  journal.updated_at = new Date().toISOString();
  journal.generation = Number.isInteger(journal.generation) ? journal.generation + 1 : 1;
  let generationPath;
  for (;;) {
    generationPath = path.join(
      journal.transaction_dir,
      `transaction.${String(journal.generation).padStart(8, '0')}.${crypto.randomBytes(8).toString('hex')}.json`
    );
    try {
      writeJsonNoClobber(generationPath, journal);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
  }
  maybeTransactionFault(journal.state, 'generation');
  if (withPointer) {
    atomicWriteJson(pointerPathForBackupRoot(journal.backup_root), pointerForJournal(journal, generationPath));
    maybeTransactionFault(journal.state, 'pointer');
  }
  // Compatibility view only. Recovery authenticates generationPath from the
  // pointer and never treats this replaceable file as authority.
  atomicWriteJson(journal.journal_path, journal);
  return journal;
}

function validateJournal(journal, journalPath) {
  if (!journal || journal.schema !== JOURNAL_SCHEMA || journal.journal_path !== journalPath) {
    throw codedError('RECOVERY_BLOCKED', `invalid transaction journal: ${journalPath}`);
  }
  if (!ALL_STATES.has(journal.state) || !Array.isArray(journal.snapshots) || !Array.isArray(journal.phases)) {
    throw codedError('RECOVERY_BLOCKED', `invalid transaction state or snapshots: ${journalPath}`);
  }
  if (journal.generation !== undefined && (!Number.isInteger(journal.generation) || journal.generation < 1)) {
    throw codedError('RECOVERY_BLOCKED', `invalid journal generation: ${journalPath}`);
  }
  if (!path.isAbsolute(journal.home) || !path.isAbsolute(journal.backup_root)) {
    throw codedError('RECOVERY_BLOCKED', `journal contains non-absolute roots: ${journalPath}`);
  }
  if (
    !path.isAbsolute(journal.transaction_dir) ||
    path.dirname(journalPath) !== journal.transaction_dir ||
    !isWithin(journal.backup_root, journal.transaction_dir) ||
    journal.transaction_dir === journal.backup_root ||
    journal.backup_root === journal.home ||
    !isWithin(journal.home, journal.backup_root)
  ) {
    throw codedError('RECOVERY_BLOCKED', `journal roots escape their transaction envelope: ${journalPath}`);
  }
  const snapshotRoot = path.join(journal.transaction_dir, 'snapshots');
  const targets = new Set();
  const recoveryPaths = new Set();
  for (const snapshot of journal.snapshots) {
    if (
      !snapshot ||
      !path.isAbsolute(snapshot.target_path) ||
      snapshot.target_path === journal.home ||
      !isWithin(journal.home, snapshot.target_path) ||
      !['file', 'directory'].includes(snapshot.kind) ||
      typeof snapshot.existed !== 'boolean' ||
      !Array.isArray(snapshot.missing_ancestors)
    ) {
      throw codedError('RECOVERY_BLOCKED', `journal contains an invalid snapshot target: ${journalPath}`);
    }
    if (targets.has(snapshot.target_path)) {
      throw codedError('RECOVERY_BLOCKED', `journal contains duplicate snapshot targets: ${snapshot.target_path}`);
    }
    targets.add(snapshot.target_path);
    for (const ancestor of snapshot.missing_ancestors) {
      if (!path.isAbsolute(ancestor) || ancestor === journal.home || !isWithin(journal.home, ancestor)) {
        throw codedError('RECOVERY_BLOCKED', `journal contains an unsafe missing ancestor: ${ancestor}`);
      }
    }
    if (snapshot.existed) {
      if (
        !Number.isInteger(snapshot.mode) ||
        snapshot.mode < 0 ||
        snapshot.mode > 0o7777 ||
        typeof snapshot.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(snapshot.sha256) ||
        !path.isAbsolute(snapshot.snapshot_path) ||
        !isWithin(snapshotRoot, snapshot.snapshot_path) ||
        snapshot.snapshot_path === snapshotRoot
      ) {
        throw codedError('RECOVERY_BLOCKED', `journal contains invalid snapshot recovery data: ${snapshot.target_path}`);
      }
      if (recoveryPaths.has(snapshot.snapshot_path)) {
        throw codedError('RECOVERY_BLOCKED', `journal reuses snapshot recovery data: ${snapshot.snapshot_path}`);
      }
      recoveryPaths.add(snapshot.snapshot_path);
      try {
        const recoveryStat = fs.lstatSync(snapshot.snapshot_path);
        if (recoveryStat.isSymbolicLink() || (recoveryStat.mode & 0o7777) !== snapshot.mode) {
          throw new Error('snapshot type or mode changed');
        }
        const actualHash = snapshot.kind === 'directory'
          ? (recoveryStat.isDirectory() ? hashTree(snapshot.snapshot_path) : null)
          : (recoveryStat.isFile() ? hashFile(snapshot.snapshot_path) : null);
        if (actualHash !== snapshot.sha256) throw new Error('snapshot hash changed');
      } catch (error) {
        throw codedError(
          'RECOVERY_BLOCKED',
          `snapshot recovery bytes are corrupt for ${snapshot.target_path}: ${error.message}`
        );
      }
    } else if (snapshot.mode !== null || snapshot.sha256 !== null || snapshot.snapshot_path !== null) {
      throw codedError('RECOVERY_BLOCKED', `absent snapshot contains recovery bytes: ${snapshot.target_path}`);
    }
  }
  const sortedTargets = [...targets].sort();
  for (let index = 0; index < sortedTargets.length; index += 1) {
    for (let other = index + 1; other < sortedTargets.length; other += 1) {
      if (isWithin(sortedTargets[index], sortedTargets[other])) {
        throw codedError(
          'RECOVERY_BLOCKED',
          `journal contains overlapping snapshot targets: ${sortedTargets[index]} and ${sortedTargets[other]}`
        );
      }
    }
  }
  return journal;
}

function readJournal(journalPath, expectedJournalPath = journalPath) {
  const absolute = assertAbsolute('transaction', journalPath);
  const expected = assertAbsolute('expected transaction', expectedJournalPath);
  let journal;
  try {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    journal = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw codedError('RECOVERY_BLOCKED', `cannot read transaction journal ${absolute}: ${error.message}`);
  }
  return validateJournal(journal, expected);
}

function loadAuthenticatedJournal(journalPath) {
  const requestedPath = assertAbsolute('transaction', journalPath);
  if (path.basename(requestedPath) !== 'transaction.json') {
    throw codedError('RECOVERY_BLOCKED', `transaction handle must be transaction.json: ${requestedPath}`);
  }
  const canonicalPath = requestedPath;
  const transactionDirectory = path.dirname(canonicalPath);
  const backupRoot = path.dirname(transactionDirectory);
  const pointerPath = pointerPathForBackupRoot(backupRoot);
  let pointer;
  try {
    const stat = fs.lstatSync(pointerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  } catch (error) {
    throw codedError('RECOVERY_BLOCKED', `cannot read active transaction pointer: ${error.message}`);
  }
  const selectedPath = pointer.generation_path;
  if (
    pointer.schema !== POINTER_SCHEMA ||
    pointer.transaction_path !== canonicalPath ||
    !path.isAbsolute(selectedPath) ||
    selectedPath === canonicalPath ||
    path.dirname(selectedPath) !== transactionDirectory
  ) {
    throw codedError('RECOVERY_BLOCKED', 'active transaction pointer does not authenticate the current journal bytes');
  }
  try {
    if (pointer.journal_sha256 !== hashFile(selectedPath)) {
      throw new Error('journal hash mismatch');
    }
    return readJournal(selectedPath, canonicalPath);
  } catch (error) {
    if (error && error.code === 'RECOVERY_BLOCKED') throw error;
    throw codedError(
      'RECOVERY_BLOCKED',
      `active transaction pointer cannot authenticate its selected generation: ${error.message}`
    );
  }
}

function removePointer(backupRoot, expectedJournalPath, terminalState = 'UNKNOWN') {
  const pointerPath = pointerPathForBackupRoot(backupRoot);
  const pointerStat = lstatIfPresent(pointerPath);
  if (!pointerStat) return;
  if (pointerStat.isSymbolicLink()) {
    throw codedError('RECOVERY_BLOCKED', `active pointer is a symlink: ${pointerPath}`);
  }
  if (expectedJournalPath) {
    let pointer;
    try {
      pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    } catch (error) {
      throw codedError('RECOVERY_BLOCKED', `cannot parse active pointer: ${error.message}`);
    }
    if (pointer.transaction_path !== expectedJournalPath) {
      throw codedError('RECOVERY_BLOCKED', 'active pointer belongs to another transaction');
    }
  }
  fs.unlinkSync(pointerPath);
  fsyncDirectory(backupRoot);
  maybeTransactionFault(terminalState, 'unlink');
}

function prepareTransaction(options) {
  if (!options || typeof options !== 'object') throw codedError('INVALID_ARGS', 'prepare options are required');
  const repoRoot = assertExistingDirectory('repoRoot', options.repoRoot);
  const home = assertExistingDirectory('home', options.home);
  const backupRoot = assertAbsolute('backupRoot', options.backupRoot);
  if (backupRoot === home || !isWithin(home, backupRoot)) {
    throw codedError('UNSAFE_PATH', `backupRoot must be inside HOME: ${backupRoot}`);
  }
  assertNoSymlinkComponents(home, backupRoot);
  if (typeof options.sourceSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(options.sourceSha)) {
    throw codedError('INVALID_ARGS', 'sourceSha must be a hexadecimal commit SHA');
  }
  const pointerPath = pointerPathForBackupRoot(backupRoot);
  if (lstatIfPresent(pointerPath)) {
    throw codedError('RECOVERY_BLOCKED', `active transaction already exists: ${pointerPath}`);
  }
  const allowlist = collectAllowlist({
    repoRoot,
    home,
    noCodex: options.noCodex === true,
    noClaudeMd: options.noClaudeMd === true,
  });

  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const transactionId = `${Date.now()}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const transactionDirectory = path.join(backupRoot, transactionId);
  fs.mkdirSync(transactionDirectory, { recursive: false, mode: 0o700 });
  const journalPath = path.join(transactionDirectory, 'transaction.json');
  try {
    const snapshots = snapshotAllowlist(allowlist, transactionDirectory, home);
    const now = new Date().toISOString();
    const journal = {
      schema: JOURNAL_SCHEMA,
      transaction_id: transactionId,
      transaction_dir: transactionDirectory,
      journal_path: journalPath,
      repo_root: repoRoot,
      home,
      backup_root: backupRoot,
      source_sha: options.sourceSha,
      state: 'PREPARING',
      created_at: now,
      updated_at: now,
      phases: [{ state: 'PREPARING', at: now }],
      snapshots,
    };
    persistJournal(journal, true);
    journal.state = 'PREPARED';
    journal.phases.push({ state: 'PREPARED', at: new Date().toISOString() });
    persistJournal(journal, true);
    return JSON.parse(JSON.stringify(journal));
  } catch (error) {
    if (lstatIfPresent(pointerPath)) {
      fs.unlinkSync(pointerPath);
      fsyncDirectory(backupRoot);
    }
    fs.rmSync(transactionDirectory, { recursive: true, force: true });
    throw error;
  }
}

function fsyncForwardTargets(journal) {
  for (const snapshot of journal.snapshots) {
    const stat = lstatIfPresent(snapshot.target_path);
    if (!stat) {
      fsyncParentChain(path.dirname(snapshot.target_path), journal.home);
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw codedError('UNSAFE_PATH', `forward target became a symlink: ${snapshot.target_path}`);
    }
    if (snapshot.kind === 'file' && !stat.isFile()) {
      throw codedError('UNSAFE_PATH', `forward file target has the wrong type: ${snapshot.target_path}`);
    }
    if (snapshot.kind === 'directory' && !stat.isDirectory()) {
      throw codedError('UNSAFE_PATH', `forward directory target has the wrong type: ${snapshot.target_path}`);
    }
    fsyncPathAndParents(snapshot.target_path, journal.home);
  }
  const ledgerPath = path.join(journal.home, '.soma-v2', '.soma', 'install-state.json');
  if (lstatIfPresent(ledgerPath)) fsyncPathAndParents(ledgerPath, journal.home);
}

function advanceTransaction(journalPath, toState) {
  const journal = loadAuthenticatedJournal(journalPath);
  const currentIndex = FORWARD_STATES.indexOf(journal.state);
  const targetIndex = FORWARD_STATES.indexOf(toState);
  if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
    throw codedError('INVALID_TRANSITION', `invalid transition ${journal.state} -> ${toState}`);
  }
  if (toState === 'VERIFIED' || toState === 'COMMITTED') fsyncForwardTargets(journal);
  journal.state = toState;
  journal.phases.push({ state: toState, at: new Date().toISOString() });
  persistJournal(journal, true);
  if (toState === 'COMMITTED') removePointer(journal.backup_root, journal.journal_path, journal.state);
  return JSON.parse(JSON.stringify(journal));
}

function verifyPreparedAuthorization(journalPath, targetPath) {
  const journal = loadAuthenticatedJournal(journalPath);
  if (journal.state !== 'PREPARED') {
    throw codedError('RECOVERY_BLOCKED', `authorization requires PREPARED, found ${journal.state}`);
  }
  if (targetPath === undefined) return null;
  const absoluteTarget = assertAbsolute('targetPath', targetPath);
  const snapshot = journal.snapshots.find((entry) => entry.target_path === absoluteTarget);
  if (!snapshot) {
    throw codedError('UNAUTHORIZED_TARGET', `target is not in the prepared allowlist: ${absoluteTarget}`);
  }
  return JSON.parse(JSON.stringify(snapshot));
}

function snapshotMatches(snapshot) {
  const targetPath = snapshot.target_path;
  const stat = lstatIfPresent(targetPath);
  if (!snapshot.existed) return stat === null;
  if (!stat) return false;
  if (stat.isSymbolicLink()) return false;
  if ((stat.mode & 0o7777) !== snapshot.mode) return false;
  if (snapshot.kind === 'directory') return stat.isDirectory() && hashTree(targetPath) === snapshot.sha256;
  return stat.isFile() && hashFile(targetPath) === snapshot.sha256;
}

function safeQuarantinePath(journal, targetPath) {
  const relative = path.relative(journal.home, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw codedError('RECOVERY_BLOCKED', `cannot quarantine target outside HOME: ${targetPath}`);
  }
  const base = path.join(journal.transaction_dir, 'quarantine', relative);
  let destination = base;
  let counter = 1;
  while (lstatIfPresent(destination)) {
    destination = `${base}.${counter}`;
    counter += 1;
  }
  return destination;
}

function quarantineCurrent(journal, targetPath) {
  assertNoSymlinkComponents(journal.home, path.dirname(targetPath));
  if (!lstatIfPresent(targetPath)) return null;
  const destination = safeQuarantinePath(journal, targetPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(targetPath, destination);
  fsyncDirectory(path.dirname(targetPath));
  fsyncDirectory(path.dirname(destination));
  return destination;
}

function restoreSnapshot(journal, snapshot) {
  if (snapshotMatches(snapshot)) return;
  if (lstatIfPresent(snapshot.target_path)) quarantineCurrent(journal, snapshot.target_path);
  if (!snapshot.existed) return;
  fs.mkdirSync(path.dirname(snapshot.target_path), { recursive: true });
  if (snapshot.kind === 'directory') {
    copyTree(snapshot.snapshot_path, snapshot.target_path);
  } else {
    fs.copyFileSync(snapshot.snapshot_path, snapshot.target_path);
    fs.chmodSync(snapshot.target_path, snapshot.mode);
  }
  fsyncDirectory(path.dirname(snapshot.target_path));
}

function cleanupMissingAncestors(journal) {
  const ancestors = new Set();
  for (const snapshot of journal.snapshots) {
    for (const ancestor of snapshot.missing_ancestors || []) ancestors.add(ancestor);
  }
  for (const ancestor of [...ancestors].sort((a, b) => b.length - a.length)) {
    if (!isWithin(journal.home, ancestor) || ancestor === journal.home) continue;
    const stat = lstatIfPresent(ancestor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw codedError('RECOVERY_BLOCKED', `missing ancestor became a symlink: ${ancestor}`);
    if (stat.isDirectory() && fs.readdirSync(ancestor).length === 0) {
      fs.rmdirSync(ancestor);
      fsyncDirectory(path.dirname(ancestor));
    }
  }
}

function fsyncRestoredTargets(journal) {
  for (const snapshot of journal.snapshots) {
    const stat = lstatIfPresent(snapshot.target_path);
    if (stat) {
      if (snapshot.kind === 'file' && !stat.isFile()) {
        throw codedError('RECOVERY_BLOCKED', `restored file has the wrong type: ${snapshot.target_path}`);
      }
      if (snapshot.kind === 'directory' && !stat.isDirectory()) {
        throw codedError('RECOVERY_BLOCKED', `restored directory has the wrong type: ${snapshot.target_path}`);
      }
      fsyncPathAndParents(snapshot.target_path, journal.home);
      continue;
    }
    fsyncParentChain(path.dirname(snapshot.target_path), journal.home);
  }
}

function finalizeRolledBack(journal) {
  journal.state = 'ROLLED_BACK';
  journal.phases.push({ state: 'ROLLED_BACK', at: new Date().toISOString() });
  persistJournal(journal, true);
  removePointer(journal.backup_root, journal.journal_path, journal.state);
  return JSON.parse(JSON.stringify(journal));
}

function rollbackTransaction(journalPath) {
  const requestedPath = assertAbsolute('transaction', journalPath);
  const pointerPath = pointerPathForBackupRoot(path.dirname(path.dirname(requestedPath)));
  let journal = lstatIfPresent(pointerPath)
    ? loadAuthenticatedJournal(requestedPath)
    : readJournal(requestedPath);
  if (journal.state === 'ROLLED_BACK') return JSON.parse(JSON.stringify(journal));
  if (journal.state === 'COMMITTED') {
    throw codedError('INVALID_TRANSITION', 'a committed transaction cannot be rolled back');
  }
  if (!lstatIfPresent(pointerPath)) {
    throw codedError('RECOVERY_BLOCKED', 'nonterminal rollback requires an active authenticated pointer');
  }
  if (journal.state === 'ROLLBACK_VERIFIED') return finalizeRolledBack(journal);
  if (journal.state !== 'ROLLING_BACK') {
    journal.state = 'ROLLING_BACK';
    journal.phases.push({ state: 'ROLLING_BACK', at: new Date().toISOString() });
    persistJournal(journal, true);
  }
  const snapshots = [...journal.snapshots].sort((a, b) => b.target_path.length - a.target_path.length);
  for (const snapshot of snapshots) restoreSnapshot(journal, snapshot);
  cleanupMissingAncestors(journal);
  fsyncRestoredTargets(journal);
  for (const snapshot of journal.snapshots) {
    if (!snapshotMatches(snapshot)) {
      throw codedError('RECOVERY_BLOCKED', `rollback verification failed for ${snapshot.target_path}`);
    }
  }
  journal.state = 'ROLLBACK_VERIFIED';
  journal.phases.push({ state: 'ROLLBACK_VERIFIED', at: new Date().toISOString() });
  persistJournal(journal, true);
  return finalizeRolledBack(journal);
}

function recoverActiveTransaction(backupRootInput, options = {}) {
  let backupRoot;
  try {
    backupRoot = assertAbsolute('backupRoot', backupRootInput);
    const stat = lstatIfPresent(backupRoot);
    if (!stat) return { status: 'NONE' };
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('RECOVERY_BLOCKED', `backupRoot is unsafe: ${backupRoot}`);
    }
    const pointerPath = pointerPathForBackupRoot(backupRoot);
    const pointerStat = lstatIfPresent(pointerPath);
    if (!pointerStat) return { status: 'NONE' };
    if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
      throw codedError('RECOVERY_BLOCKED', `active pointer is unsafe: ${pointerPath}`);
    }
    let pointer;
    try {
      pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    } catch (error) {
      throw codedError('RECOVERY_BLOCKED', `cannot parse active pointer: ${error.message}`);
    }
    if (
      pointer.schema !== POINTER_SCHEMA ||
      !path.isAbsolute(pointer.transaction_path) ||
      !isWithin(backupRoot, pointer.transaction_path)
    ) {
      throw codedError('RECOVERY_BLOCKED', 'active pointer contains an invalid transaction path');
    }
    const journal = loadAuthenticatedJournal(pointer.transaction_path);
    if (options.dryRun === true) {
      return { status: TERMINAL_STATES.has(journal.state) ? journal.state : 'PENDING', state: journal.state };
    }
    if (journal.state === 'COMMITTED') {
      removePointer(backupRoot, journal.journal_path, journal.state);
      return { status: 'COMMITTED', state: journal.state };
    }
    if (journal.state === 'ROLLED_BACK') {
      removePointer(backupRoot, journal.journal_path, journal.state);
      return { status: 'ROLLED_BACK', state: journal.state };
    }
    const result = rollbackTransaction(journal.journal_path);
    return { status: 'ROLLED_BACK', state: result.state, transaction_path: result.journal_path };
  } catch (error) {
    if (error && error.code === 'RECOVERY_BLOCKED') {
      return { status: 'RECOVERY_BLOCKED', reason: error.message };
    }
    throw error;
  }
}

function usage() {
  return `Usage:
  global-transaction.cjs prepare --repo-root ABS --home ABS --backup-root ABS --source-sha SHA [--no-codex] [--no-claude-md]
  global-transaction.cjs advance --transaction ABS --to STATE
  global-transaction.cjs rollback --transaction ABS
  global-transaction.cjs recover --backup-root ABS [--dry-run]
  global-transaction.cjs status --backup-root ABS`;
}

function parseCli(argv) {
  const command = argv[0];
  const values = {};
  const booleans = new Set(['no-codex', 'no-claude-md', 'dry-run']);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw codedError('INVALID_ARGS', `unexpected argument: ${token}`);
    const equal = token.indexOf('=');
    const name = token.slice(2, equal === -1 ? undefined : equal);
    if (Object.prototype.hasOwnProperty.call(values, name)) throw codedError('INVALID_ARGS', `duplicate flag: --${name}`);
    if (booleans.has(name)) {
      if (equal !== -1) throw codedError('INVALID_ARGS', `boolean flag takes no value: --${name}`);
      values[name] = true;
    } else if (equal !== -1) {
      values[name] = token.slice(equal + 1);
    } else {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) {
        throw codedError('INVALID_ARGS', `missing value for --${name}`);
      }
      values[name] = argv[index];
    }
  }
  const allowed = {
    prepare: ['repo-root', 'home', 'backup-root', 'source-sha', 'no-codex', 'no-claude-md'],
    advance: ['transaction', 'to'],
    rollback: ['transaction'],
    recover: ['backup-root', 'dry-run'],
    status: ['backup-root'],
  };
  if (!allowed[command]) throw codedError('INVALID_ARGS', `unknown command: ${command || ''}`);
  for (const name of Object.keys(values)) {
    if (!allowed[command].includes(name)) throw codedError('INVALID_ARGS', `flag --${name} is not valid for ${command}`);
  }
  return { command, values };
}

function requireFlags(values, names) {
  for (const name of names) {
    if (typeof values[name] !== 'string' || values[name].length === 0) {
      throw codedError('INVALID_ARGS', `missing required flag --${name}`);
    }
  }
}

function runCli(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const { command, values } = parseCli(argv);
  let result;
  if (command === 'prepare') {
    requireFlags(values, ['repo-root', 'home', 'backup-root', 'source-sha']);
    result = prepareTransaction({
      repoRoot: values['repo-root'],
      home: values.home,
      backupRoot: values['backup-root'],
      sourceSha: values['source-sha'],
      noCodex: values['no-codex'] === true,
      noClaudeMd: values['no-claude-md'] === true,
    });
  } else if (command === 'advance') {
    requireFlags(values, ['transaction', 'to']);
    result = advanceTransaction(values.transaction, values.to);
  } else if (command === 'rollback') {
    requireFlags(values, ['transaction']);
    result = rollbackTransaction(values.transaction);
  } else if (command === 'recover') {
    requireFlags(values, ['backup-root']);
    result = recoverActiveTransaction(values['backup-root'], { dryRun: values['dry-run'] === true });
  } else {
    requireFlags(values, ['backup-root']);
    result = recoverActiveTransaction(values['backup-root'], { dryRun: true });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result && result.status === 'RECOVERY_BLOCKED' ? 3 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
    process.exitCode = error.code === 'RECOVERY_BLOCKED' ? 3 : 2;
  }
}

module.exports = {
  prepareTransaction,
  advanceTransaction,
  recoverActiveTransaction,
  rollbackTransaction,
  verifyPreparedAuthorization,
  hashFile,
  hashTree,
};
