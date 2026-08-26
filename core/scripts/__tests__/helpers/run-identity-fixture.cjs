'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function snapshotTree(root) {
  const entries = [];

  function visit(relativePath) {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);

    if (stat.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory' });
      for (const name of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(relativePath, name));
      }
      return;
    }

    if (stat.isFile()) {
      entries.push({
        path: relativePath,
        type: 'file',
        bytes: fs.readFileSync(absolutePath),
      });
      return;
    }

    if (stat.isSymbolicLink()) {
      entries.push({
        path: relativePath,
        type: 'symlink',
        target: fs.readlinkSync(absolutePath),
      });
      return;
    }

    entries.push({ path: relativePath, type: 'other' });
  }

  visit('.');
  return entries;
}

function assertTreeUnchanged(root, before, message) {
  assert.deepEqual(snapshotTree(root), before, message);
}

function aliasSharesInode(t, existingPath, aliasPath, reason) {
  let existing;
  let alias;

  try {
    existing = fs.statSync(existingPath);
    alias = fs.statSync(aliasPath);
  } catch (_error) {
    t.skip(reason);
    return false;
  }

  if (existing.dev !== alias.dev || existing.ino !== alias.ino) {
    t.skip(reason);
    return false;
  }

  return true;
}

module.exports = {
  snapshotTree,
  assertTreeUnchanged,
  aliasSharesInode,
};
