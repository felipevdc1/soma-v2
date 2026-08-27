'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.resolve(__dirname, '..', 'session-init.cjs');
const SOMA = path.resolve(__dirname, '..', '..', 'scripts', 'soma.cjs');
const { isSessionId } = require('../../scripts/entry/request-schema.cjs');

function fixture(prefix = 'soma-session-identity-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  fs.mkdirSync(tmp);
  return {
    root,
    home,
    cwd,
    tmp,
    envFile: path.join(root, 'claude-env.sh'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function hookEnv(f, envFile, hasExplicitEnvFile) {
  const env = { ...process.env, HOME: f.home, TMPDIR: f.tmp, TMP: f.tmp, TEMP: f.tmp };
  delete env.CLAUDE_SESSION_ID;
  if (hasExplicitEnvFile && envFile === undefined) delete env.CLAUDE_ENV_FILE;
  else env.CLAUDE_ENV_FILE = hasExplicitEnvFile ? envFile : f.envFile;
  return env;
}

function runHook(f, data, options = {}) {
  if (options.createEnvFile !== false && options.envFile !== undefined && options.envFile !== '') {
    fs.writeFileSync(options.envFile, options.initialEnv || '');
  } else if (options.createEnvFile !== false && options.envFile === undefined) {
    fs.writeFileSync(f.envFile, options.initialEnv || '');
  }
  const hasExplicitEnvFile = Object.hasOwn(options, 'envFile');
  const envFile = hasExplicitEnvFile ? options.envFile : f.envFile;
  return spawnSync(process.execPath, [HOOK], {
    cwd: f.cwd,
    env: hookEnv(f, envFile, hasExplicitEnvFile),
    input: JSON.stringify(data),
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function sourceValue(envFile) {
  const result = spawnSync('/bin/sh', ['-c', '. "$1"; printf %s "$CLAUDE_SESSION_ID"', 'sh', envFile], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function sourceIdentityState(envFile) {
  const result = spawnSync('/bin/sh', [
    '-c',
    '. "$1"; printf "%s\\n%s\\n%s\\n%s\\n" "${CLAUDE_SESSION_ID+x}" "${CLAUDE_SESSION_ID-}" "${CK_SESSION_ID+x}" "${CK_SESSION_ID-}"',
    'sh',
    envFile,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [claudePresence, claudeValue, legacyPresence, legacyValue] = result.stdout.split('\n');
  return {
    claude: { present: claudePresence === 'x', value: claudeValue },
    legacy: { present: legacyPresence === 'x', value: legacyValue },
  };
}

function identityExports(envFile) {
  return namedExports(envFile, 'CLAUDE_SESSION_ID');
}

function namedExports(envFile, name) {
  if (!fs.existsSync(envFile) || fs.statSync(envFile).isDirectory()) return [];
  return fs.readFileSync(envFile, 'utf8').split('\n').filter(line => line.startsWith(`export ${name}=`));
}

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else found.push(absolute);
    }
  };
  visit(root);
  return found.sort();
}

test('startup, resume, clear, and compact export the authoritative session identity', async (t) => {
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    await t.test(source, () => {
      const f = fixture(`soma-session-${source}-`);
      try {
        const result = runHook(f, { source, session_id: 'A._:-z' });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(sourceValue(f.envFile), 'A._:-z');
      } finally {
        f.cleanup();
      }
    });
  }
});

test('hook acceptance matches runtime isSessionId and rejects the injection corpus', async (t) => {
  const corpus = [
    'A',
    `A${'z'.repeat(127)}`,
    '',
    null,
    7,
    {},
    '.leading',
    'slash/value',
    'back\\slash',
    'has space',
    'has\ttab',
    'has"quote',
    'has`tick',
    'has$dollar',
    '$(touch nope)',
    'semi;colon',
    'line\nbreak',
    'carriage\rreturn',
    'unicodé',
    `A${'z'.repeat(128)}`,
  ];

  for (const [index, value] of corpus.entries()) {
    await t.test(`corpus ${index}`, () => {
      const f = fixture('soma-session-validator-');
      try {
        const result = runHook(f, { source: 'startup', session_id: value });
        assert.equal(result.status, 0, result.stderr);
        const accepted = identityExports(f.envFile).length > 0;
        assert.equal(accepted, isSessionId(value), `hook/runtime parity mismatch for corpus index ${index}`);
        if (accepted) assert.equal(sourceValue(f.envFile), value);
        else assert.deepEqual(identityExports(f.envFile), []);
      } finally {
        f.cleanup();
      }
    });
  }
});

test('the current export overrides stale identity and repeated exports stay shell-equivalent', () => {
  const f = fixture('soma-session-repeat-');
  try {
    const stale = 'export CLAUDE_SESSION_ID="stale.session"\n';
    let result = runHook(f, { source: 'startup', session_id: 'current.session:1' }, { initialEnv: stale });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sourceValue(f.envFile), 'current.session:1');

    for (let index = 0; index < 2; index += 1) {
      result = runHook(f, { source: 'startup', session_id: 'current.session:1' }, {
        createEnvFile: false,
      });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(sourceValue(f.envFile), 'current.session:1');
    assert.equal(identityExports(f.envFile).length, 4);
  } finally {
    f.cleanup();
  }
});

test('invalid or missing current identity neutralizes stale effective identity', async (t) => {
  for (const [label, data] of [
    ['clear with invalid identity', { source: 'clear', session_id: 'bad;identity' }],
    ['compact with missing identity', { source: 'compact' }],
  ]) {
    await t.test(label, () => {
      const f = fixture('soma-session-stale-invalid-');
      try {
        const stale = 'export CLAUDE_SESSION_ID="stale.session"\nexport CK_SESSION_ID="stale.session"\n';
        const result = runHook(f, data, { initialEnv: stale });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID');
        assert.deepEqual(sourceIdentityState(f.envFile), {
          claude: { present: false, value: '' },
          legacy: { present: false, value: '' },
        });
        assert.deepEqual(fs.readdirSync(f.tmp).filter((name) => name.startsWith('ck-session-')), []);
      } finally {
        f.cleanup();
      }
    });
  }
});

test('duplicate invocations obey the last authoritative session event', () => {
  const f = fixture('soma-session-event-order-');
  try {
    let result = runHook(f, { source: 'clear', session_id: 'bad;identity' }, {
      initialEnv: 'export CLAUDE_SESSION_ID="stale.session"\nexport CK_SESSION_ID="stale.session"\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sourceIdentityState(f.envFile), {
      claude: { present: false, value: '' },
      legacy: { present: false, value: '' },
    });

    result = runHook(f, { source: 'compact' }, { createEnvFile: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sourceIdentityState(f.envFile), {
      claude: { present: false, value: '' },
      legacy: { present: false, value: '' },
    });

    result = runHook(f, { source: 'resume', session_id: 'current.session:2' }, { createEnvFile: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sourceIdentityState(f.envFile), {
      claude: { present: true, value: 'current.session:2' },
      legacy: { present: true, value: 'current.session:2' },
    });
    const stateFilesAfterValid = fs.readdirSync(f.tmp).filter((name) => name.startsWith('ck-session-')).sort();

    result = runHook(f, { source: 'clear', session_id: 'still;invalid' }, { createEnvFile: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sourceIdentityState(f.envFile), {
      claude: { present: false, value: '' },
      legacy: { present: false, value: '' },
    });
    assert.deepEqual(
      fs.readdirSync(f.tmp).filter((name) => name.startsWith('ck-session-')).sort(),
      stateFilesAfterValid,
      'invalid event must not create temp session state'
    );
  } finally {
    f.cleanup();
  }
});

test('failed neutralization leaves the stale identity observable without claiming success', () => {
  const f = fixture('soma-session-neutralize-failure-');
  try {
    fs.writeFileSync(
      f.envFile,
      'export CLAUDE_SESSION_ID="stale.session"\nexport CK_SESSION_ID="stale.session"\n'
    );
    fs.chmodSync(f.envFile, 0o444);
    const result = runHook(f, { source: 'clear', session_id: 'bad;identity' }, { createEnvFile: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID');
    assert.deepEqual(sourceIdentityState(f.envFile), {
      claude: { present: true, value: 'stale.session' },
      legacy: { present: true, value: 'stale.session' },
    });
    assert.deepEqual(fs.readdirSync(f.tmp).filter((name) => name.startsWith('ck-session-')), []);
  } finally {
    fs.chmodSync(f.envFile, 0o600);
    f.cleanup();
  }
});

test('missing env channel and missing or invalid identity are nonblocking with stable diagnostics', async (t) => {
  await t.test('missing CLAUDE_ENV_FILE', () => {
    const f = fixture('soma-session-no-env-');
    try {
      const result = runHook(f, { source: 'startup', session_id: 'valid.session' }, {
        envFile: undefined,
        createEnvFile: false,
      });
      assert.equal(result.status, 0);
      assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=CLAUDE_ENV_FILE_MISSING');
      assert.deepEqual(filesBelow(f.home), []);
      assert.deepEqual(filesBelow(f.cwd), []);
    } finally {
      f.cleanup();
    }
  });

  await t.test('empty CLAUDE_ENV_FILE', () => {
    const f = fixture('soma-session-empty-env-');
    try {
      const result = runHook(f, { source: 'startup', session_id: 'valid.session' }, {
        envFile: '',
        createEnvFile: false,
      });
      assert.equal(result.status, 0);
      assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=CLAUDE_ENV_FILE_MISSING');
      assert.deepEqual(filesBelow(f.home), []);
      assert.deepEqual(filesBelow(f.cwd), []);
    } finally {
      f.cleanup();
    }
  });

  for (const [label, data] of [
    ['missing identity', { source: 'startup' }],
    ['invalid identity', { source: 'startup', session_id: 'bad;identity' }],
  ]) {
    await t.test(label, () => {
      const f = fixture('soma-session-invalid-');
      try {
        const result = runHook(f, data);
        assert.equal(result.status, 0);
        assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID');
        assert.deepEqual(identityExports(f.envFile), []);
        assert.deepEqual(fs.readdirSync(f.tmp).filter((name) => name.startsWith('ck-session-')), []);
        assert.deepEqual(namedExports(f.envFile, 'CK_SESSION_ID'), []);
      } finally {
        f.cleanup();
      }
    });
  }

  await t.test('identity validation precedes the env-file check', () => {
    const f = fixture('soma-session-precedence-');
    try {
      const result = runHook(f, { source: 'startup' }, {
        envFile: undefined,
        createEnvFile: false,
      });
      assert.equal(result.status, 0);
      assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID');
      assert.deepEqual(filesBelow(f.home), []);
      assert.deepEqual(filesBelow(f.cwd), []);
    } finally {
      f.cleanup();
    }
  });
});

test('an env append failure is nonblocking and emits the stable failure diagnostic', () => {
  const f = fixture('soma-session-write-failure-');
  const unwritable = path.join(f.root, 'env-directory');
  fs.mkdirSync(unwritable);
  try {
    const result = runHook(f, { source: 'startup', session_id: 'valid.session' }, {
      envFile: unwritable,
      createEnvFile: false,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr.trim(), 'SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=ENV_WRITE_FAILED');
    assert.deepEqual(identityExports(unwritable), []);
  } finally {
    f.cleanup();
  }
});

test('hook-produced environment drives native prepare and abort without request residue', () => {
  const f = fixture('soma-session-native-entry-');
  const mailboxRoot = path.join(f.root, 'mailbox');
  try {
    const hook = runHook(f, { source: 'startup', session_id: 'claude.native:hook' });
    assert.equal(hook.status, 0, hook.stderr);

    const env = { ...process.env, HOME: f.home, SOMA_ENTRY_ROOT: mailboxRoot };
    delete env.CLAUDE_SESSION_ID;
    const prepare = spawnSync('/bin/sh', ['-c', '. "$1"; exec node "$2" entry native prepare', 'sh', f.envFile, SOMA], {
      cwd: f.cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(prepare.status, 0, prepare.stderr);
    assert.equal(JSON.parse(prepare.stdout).status, 'REQUEST_PREPARED');

    const abort = spawnSync('/bin/sh', ['-c', '. "$1"; exec node "$2" entry native abort', 'sh', f.envFile, SOMA], {
      cwd: f.cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(abort.status, 0, abort.stderr);
    assert.equal(JSON.parse(abort.stdout).status, 'REQUEST_ABORTED');
    assert.deepEqual(filesBelow(mailboxRoot), []);
  } finally {
    f.cleanup();
  }
});
