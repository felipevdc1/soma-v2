'use strict';

const { spawnSync } = require('node:child_process');

function runGitRead(cwd, args) {
  return spawnSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
}

function gitOutput(cwd, args) {
  const result = runGitRead(cwd, args);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function gitRoot(cwd) {
  return gitOutput(cwd, ['rev-parse', '--show-toplevel']);
}

function readGitFacts(cwd) {
  const root = gitRoot(cwd);
  if (!root) return { head: null, branch: null, dirtyPaths: [] };
  const head = gitOutput(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = gitOutput(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const status = runGitRead(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status.status !== 0) {
    const error = new Error(`Unable to inspect Git status: ${(status.stderr || '').trim()}`);
    error.code = 'GIT_READ_FAILED';
    throw error;
  }
  const records = status.stdout.split('\0').filter(Boolean);
  const dirtyPaths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const statusCode = record.slice(0, 2);
    dirtyPaths.push(record.slice(3));
    if (/[RC]/.test(statusCode) && index + 1 < records.length) {
      dirtyPaths.push(records[index + 1]);
      index += 1;
    }
  }
  dirtyPaths.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  return { head, branch, dirtyPaths };
}

module.exports = { runGitRead, gitOutput, gitRoot, readGitFacts };
