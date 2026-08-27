#!/usr/bin/env node
'use strict';

const { createMailbox } = require('./entry/mailbox.cjs');
const { parseRawArguments } = require('./entry/raw-arguments.cjs');
const { routeEntryRequest } = require('./entry/request.cjs');
const { error } = require('./entry/request-schema.cjs');

function parseFlags(argv, required) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!required.includes(token) || Object.hasOwn(values, token) || index + 1 >= argv.length) {
      throw error('INVALID_ARGUMENTS', 'Invalid entry command arguments');
    }
    values[token] = argv[index + 1];
    index += 1;
  }
  if (!required.every(flag => Object.hasOwn(values, flag))) {
    throw error('INVALID_ARGUMENTS', 'Missing entry command arguments');
  }
  return values;
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const [verb, ...rest] = argv;
  const mailbox = createMailbox({ root: env.SOMA_ENTRY_ROOT });
  if (verb === 'prepare') {
    const flags = parseFlags(rest, ['--session']);
    const prepared = await mailbox.prepare({ sessionId: flags['--session'] });
    return { status: 'REQUEST_PREPARED', ...prepared };
  }
  if (verb === 'consume') {
    const flags = parseFlags(rest, ['--session', '--request-id']);
    const result = await mailbox.consume(
      { sessionId: flags['--session'], requestId: flags['--request-id'] },
      bytes => routeEntryRequest(
        parseRawArguments(JSON.parse(bytes.toString('utf8')).rawArguments),
        { cwd: env.SOMA_PROJECT_CWD || process.cwd(), home: env.HOME }
      )
    );
    return result;
  }
  if (verb === 'abort') {
    const flags = parseFlags(rest, ['--session', '--request-id']);
    await mailbox.abort({ sessionId: flags['--session'], requestId: flags['--request-id'] });
    return { status: 'REQUEST_ABORTED' };
  }
  throw error('INVALID_ARGUMENTS', 'Unknown entry command');
}

if (require.main === module) {
  run().then(
    result => process.stdout.write(`${JSON.stringify(result)}\n`),
    err => {
      process.stderr.write(`${JSON.stringify({ error: err.code || 'ENTRY_ERROR', message: err.message })}\n`);
      process.exitCode = 2;
    }
  );
}

module.exports = { run };
