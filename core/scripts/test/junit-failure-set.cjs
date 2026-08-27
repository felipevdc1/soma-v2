#!/usr/bin/env node
'use strict';

/**
 * Convert Node's JUnit reporter output into a deterministic failure identity set.
 * Deliberately uses only Node built-ins so a baseline can be captured in a clean
 * detached worktree.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

const COMMAND = [
  'node',
  '--test',
  '--test-reporter=junit',
  'core/scripts/__tests__/*.test.cjs',
  'core/hooks/__tests__/*.test.cjs',
];

function malformed(message) {
  return new Error(`Malformed JUnit XML: ${message}`);
}

function decodeEntities(value) {
  const entity = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
  let cursor = 0;
  let result = '';
  for (const match of value.matchAll(entity)) {
    if (value.slice(cursor, match.index).includes('&')) throw malformed('invalid entity');
    result += value.slice(cursor, match.index);
    const token = match[1];
    if (token === 'amp') result += '&';
    else if (token === 'lt') result += '<';
    else if (token === 'gt') result += '>';
    else if (token === 'quot') result += '"';
    else if (token === 'apos') result += "'";
    else {
      const codePoint = Number.parseInt(token.slice(token[1].toLowerCase() === 'x' ? 2 : 1), token[1].toLowerCase() === 'x' ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) throw malformed('invalid numeric entity');
      result += String.fromCodePoint(codePoint);
    }
    cursor = match.index + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail.includes('&')) throw malformed('invalid entity');
  return result + tail;
}

function parseAttributes(source) {
  const attrs = Object.create(null);
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] || '')) index += 1;
    if (index === source.length) break;
    const key = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(source.slice(index));
    if (!key) throw malformed('invalid attribute name');
    index += key[0].length;
    while (/\s/.test(source[index] || '')) index += 1;
    if (source[index] !== '=') throw malformed(`attribute ${key[0]} has no value`);
    index += 1;
    while (/\s/.test(source[index] || '')) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") throw malformed(`attribute ${key[0]} is unquoted`);
    index += 1;
    const end = source.indexOf(quote, index);
    if (end < 0) throw malformed(`attribute ${key[0]} is unterminated`);
    if (Object.hasOwn(attrs, key[0])) throw malformed(`duplicate attribute ${key[0]}`);
    attrs[key[0]] = decodeEntities(source.slice(index, end));
    index = end + 1;
  }
  return attrs;
}

function findTagEnd(xml, start) {
  let quote = null;
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  throw malformed('unterminated tag');
}

function parseXml(xml) {
  if (typeof xml !== 'string') throw new TypeError('xml must be a string');
  const roots = [];
  const stack = [];
  let index = xml.charCodeAt(0) === 0xfeff ? 1 : 0;

  function appendText(text) {
    if (!stack.length) {
      if (text.trim()) throw malformed('text outside root element');
      return;
    }
    stack.at(-1).text += decodeEntities(text);
  }

  while (index < xml.length) {
    const next = xml.indexOf('<', index);
    if (next < 0) {
      appendText(xml.slice(index));
      break;
    }
    appendText(xml.slice(index, next));
    if (xml.startsWith('<!--', next)) {
      const end = xml.indexOf('-->', next + 4);
      if (end < 0) throw malformed('unterminated comment');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', next)) {
      const end = xml.indexOf(']]>', next + 9);
      if (end < 0) throw malformed('unterminated CDATA');
      if (!stack.length) throw malformed('CDATA outside root element');
      stack.at(-1).text += xml.slice(next + 9, end);
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', next)) {
      const end = xml.indexOf('?>', next + 2);
      if (end < 0) throw malformed('unterminated processing instruction');
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', next)) throw malformed('unsupported declaration');

    const end = findTagEnd(xml, next + 1);
    const tag = xml.slice(next + 1, end);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) throw malformed('invalid closing tag');
      const node = stack.pop();
      if (!node || node.name !== name) throw malformed(`mismatched closing tag ${name}`);
    } else {
      const selfClosing = /\/$/.test(tag.trim());
      const content = selfClosing ? tag.trim().slice(0, -1).trim() : tag.trim();
      const match = /^([A-Za-z_:][A-Za-z0-9_.:-]*)([\s\S]*)$/.exec(content);
      if (!match) throw malformed('invalid opening tag');
      const node = { name: match[1], attrs: parseAttributes(match[2]), text: '', children: [] };
      if (stack.length) stack.at(-1).children.push(node);
      else roots.push(node);
      if (!selfClosing) stack.push(node);
    }
    index = end + 1;
  }
  if (stack.length) throw malformed(`unclosed tag ${stack.at(-1).name}`);
  if (roots.length !== 1) throw malformed('expected exactly one root element');
  return roots[0];
}

function normalizePath(value) {
  return value.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function canonicalRepoRoot(repoRoot) {
  try {
    return normalizePath(fs.existsSync(repoRoot) ? fs.realpathSync(repoRoot) : repoRoot);
  } catch {
    return normalizePath(repoRoot);
  }
}

function canonicalPath(value) {
  const raw = value.replace(/^file:\/\//, '');
  try {
    return normalizePath(fs.existsSync(raw) ? fs.realpathSync(raw) : raw);
  } catch {
    return normalizePath(raw);
  }
}

function relativeFile(value, repoRoot) {
  if (!value) return '';
  let file = canonicalPath(value);
  let root = canonicalRepoRoot(repoRoot);
  if (/^[A-Za-z]:\//.test(file) && root.startsWith('/')) file = file.slice(2);
  if (/^[A-Za-z]:\//.test(root) && file.startsWith('/')) root = root.slice(2);
  if (file === root) return '';
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  if (!/^(?:[A-Za-z]:)?\//.test(file) && !file.split('/').includes('..')) return file.replace(/^\.\//, '');
  return '';
}

function sourceFrom(testcase, detail, repoRoot) {
  const location = /(?:file:\/\/)?((?:[A-Za-z]:)?[\\/][^\n():]*?\.(?:[cm]?js|jsx|tsx?|mjs|cjs)):(\d+)(?::\d+)?/g;
  const candidates = [testcase.attrs.file, ...Array.from(detail.matchAll(location), match => match[1])];
  for (const candidate of candidates) {
    const file = relativeFile(candidate, repoRoot);
    if (file) return file;
  }
  return '';
}

function normalizeFixturePaths(value) {
  const generatedPath = /\/(?:private\/var\/folders\/[^/\s'"`|)]+\/[^/\s'"`|)]+\/T|var\/folders\/[^/\s'"`|)]+\/[^/\s'"`|)]+\/T|tmp)\/(?:soma|opgate|cli-contract)[A-Za-z0-9._-]*-[A-Za-z0-9]{6}(?:\/[^\s'"`|)]+)*/g;
  return value.replace(generatedPath, pathValue => {
    const relative = pathValue.replace(/^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T\//, '').replace(/^\/tmp\//, '');
    const segments = relative.split('/');
    return `<tmp>/${segments.map(segment => segment.replace(/^(.+)-[A-Za-z0-9]{6}$/, '$1-<fixture>')).join('/')}`;
  });
}

function normalizeRuntimeIds(value) {
  return value.split('\n').map(line => {
    if (!/\bopgate-(?:i7-stdin|victim)\b|<tmp>\/opgate/i.test(line)) return line;
    return line
      .replace(/\bpid-\d+\b/gi, 'pid-<id>')
      .replace(/\b(opgate-(?:i7-stdin|victim))-\d+-[A-Za-z0-9]+\b/g, '$1-<id>')
      .replace(/\bPID(\s*[=:]\s*)\d+\b/g, 'PID$1<id>')
      .replace(/\b(?:session_id|request_id)(\s*[=:]\s*)(?:session|req)-[A-Za-z0-9._:-]+\b/g, (match, separator) =>
        `${match.slice(0, match.indexOf(separator))}${separator}<id>`)
      .replace(/\bpadrão(\s*[=:]\s*)opgate-(?:i7-stdin|victim)-\d+-[A-Za-z0-9]+\b/gi, 'padrão$1<id>');
  }).join('\n');
}

function normalizeSlicedDiagnostic(line) {
  const suffix = "scripts/__tests__/doctor-file-drift.test.cjs'";
  return !/\s/.test(line) && line.endsWith(suffix) ? `<soma-home>/${suffix}` : line;
}

function removeTapPresentation(lines) {
  let awaitingYaml = false;
  let inYaml = false;
  return lines.filter(line => {
    if (inYaml) {
      if (line === '...') inYaml = false;
      return false;
    }
    if (/^#\s*Subtest:/.test(line)) return false;
    if (/^#\s+(?:Node\.js v|[}\]]$|tests\s+\d+|pass\s+\d+|fail\s+\d+)/.test(line)) return false;
    if (/^(?:not )?ok\s+\d+\s+-/.test(line)) {
      awaitingYaml = true;
      return false;
    }
    if (awaitingYaml && line === '---') {
      awaitingYaml = false;
      inYaml = true;
      return false;
    }
    awaitingYaml = false;
    return true;
  });
}

function normalizeDetail(detail, repoRoot) {
  const root = canonicalRepoRoot(repoRoot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = normalizeRuntimeIds(normalizeFixturePaths(detail
    .replace(/\r\n?/g, '\n')
    .replace(new RegExp(root, 'g'), '<repo>')
    .replace(/((?:[A-Za-z]:)?[\\/][^\n():]*?\.(?:[cm]?js|jsx|tsx?|mjs|cjs)):\d+(?::\d+)?/g, '$1')))
    .split('\n')
    .map(line => line.trim())
    .map(normalizeSlicedDiagnostic)
    .filter(line => line && !/^at\s/.test(line));
  return removeTapPresentation(lines).join('\n');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableMessage(value, repoRoot) {
  return normalizeDetail(value, repoRoot)
    .split('\n')
    .find(line => !/^(?:#|not ok\b|---$|\.\.\.$|failureType:|exitCode:|signal:|error:|code:)/.test(line)) || '';
}

function errorIdentity(detail, attrs, repoRoot) {
  const concrete = /(?:^|\n)\s*cause:\s*([A-Za-z_$][\w.$]*(?:\s+\[[A-Z0-9_]+\])?)\s*:\s*([^\r\n]+)/g;
  const match = concrete.exec(detail);
  if (match) {
    return { errorName: match[1], message: stableMessage(match[2], repoRoot) };
  }
  return {
    errorName: attrs.type || 'failure',
    message: stableMessage(detail, repoRoot),
  };
}

function parseFailureSet(xml, { repoRoot } = {}) {
  if (!repoRoot || typeof repoRoot !== 'string') throw new TypeError('repoRoot is required');
  const root = parseXml(xml);
  const failures = [];

  function visit(node) {
    if (node.name === 'testcase') {
      for (const child of node.children) {
        if (child.name !== 'failure' && child.name !== 'error') continue;
        const detail = normalizeDetail(child.text, repoRoot);
        const identity = errorIdentity(child.text, child.attrs, repoRoot);
        const fullName = [node.attrs.classname, node.attrs.name].filter(Boolean).join(' ').trim();
        if (!fullName) throw malformed('failing testcase without a name');
        failures.push({
          fullName,
          file: sourceFrom(node, child.text, repoRoot),
          errorName: identity.errorName,
          message: identity.message,
          failureSha256: sha256(detail),
        });
      }
    }
    for (const child of node.children) visit(child);
  }

  visit(root);
  failures.sort((left, right) => {
    for (const key of ['file', 'fullName', 'errorName', 'message', 'failureSha256']) {
      const comparison = compareUtf8(left[key], right[key]);
      if (comparison) return comparison;
    }
    return 0;
  });
  const identities = new Set();
  for (const failure of failures) {
    const identity = JSON.stringify([failure.file, failure.fullName, failure.errorName, failure.message, failure.failureSha256]);
    if (identities.has(identity)) throw new Error('Duplicate normalized failure identity');
    identities.add(identity);
  }
  return { $schema: 'soma-test-baseline/v1', failures };
}

function cli(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--junit', '--out', '--repo', '--candidate', '--exit'].includes(flag) || argv[index + 1] === undefined || Object.hasOwn(values, flag)) {
      throw new Error('Usage: junit-failure-set.cjs --junit FILE --out FILE --repo DIR --candidate SHA --exit CODE');
    }
    values[flag] = argv[index + 1];
  }
  if (Object.keys(values).length !== 5) throw new Error('Usage: junit-failure-set.cjs --junit FILE --out FILE --repo DIR --candidate SHA --exit CODE');
  if (!/^[0-9a-f]{40}$/i.test(values['--candidate'])) throw new Error('--candidate must be a Git SHA');
  if (!/^-?\d+$/.test(values['--exit'])) throw new Error('--exit must be an integer');
  const xml = fs.readFileSync(values['--junit'], 'utf8');
  const baseline = parseFailureSet(xml, { repoRoot: values['--repo'] });
  const output = {
    $schema: baseline.$schema,
    candidateSha: values['--candidate'],
    command: COMMAND,
    exitCode: Number(values['--exit']),
    failures: baseline.failures,
    junitSha256: sha256(xml),
  };
  fs.writeFileSync(values['--out'], `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseFailureSet };
