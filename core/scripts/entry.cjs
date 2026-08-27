#!/usr/bin/env node
'use strict';

const { createRequestBroker } = require('./entry/request-broker.cjs');
const {
  validateCapability,
  validateRequestId,
  validateSessionId,
} = require('./entry/request-schema.cjs');

function entryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseInvocation(argv) {
  const verb = argv[0];
  if (verb === 'broker-prepare') {
    if (argv.length !== 3 || argv[1] !== '--session') {
      if (!argv.includes('--session') || argv.at(argv.indexOf('--session') + 1) === undefined) {
        throw entryError('SESSION_UNAVAILABLE', 'broker-prepare requires the native --session identity');
      }
      throw entryError('INVALID_ENTRY_ARGS', 'broker-prepare accepts only --session <native-session-id>');
    }
    return {
      verb,
      identity: { sessionId: validateSessionId(argv[2]) },
    };
  }

  if (verb === 'broker-consume' || verb === 'broker-abort') {
    const fixedShape = argv.length === 7 &&
      argv[1] === '--session' &&
      argv[3] === '--request-id' &&
      argv[5] === '--capability';
    if (!fixedShape) {
      throw entryError(
        'INVALID_ENTRY_IDENTITY',
        `${verb} requires fixed --session, --request-id, and --capability tokens`
      );
    }
    return {
      verb,
      identity: {
        sessionId: validateSessionId(argv[2]),
        requestId: validateRequestId(argv[4]),
        capability: validateCapability(argv[6]),
      },
    };
  }

  throw entryError(
    'INVALID_ENTRY_ARGS',
    'entry accepts only broker-prepare, broker-consume, or broker-abort'
  );
}

async function runEntry(argv, options = {}) {
  const invocation = parseInvocation(argv);
  const broker = options.broker || createRequestBroker(options.brokerOptions);

  if (invocation.verb === 'broker-prepare') {
    return broker.prepare(invocation.identity);
  }
  if (invocation.verb === 'broker-abort') {
    return broker.abort(invocation.identity);
  }
  return broker.consume(invocation.identity, {
    parseRawArguments: rawArguments => rawArguments,
  });
}

function exitCodeFor(error) {
  if (['SESSION_UNAVAILABLE', 'INVALID_ENTRY_IDENTITY', 'INVALID_ENTRY_ARGS'].includes(error.code)) {
    return 2;
  }
  return 1;
}

async function main() {
  try {
    const result = await runEntry(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: typeof error.code === 'string' ? error.code : 'ENTRY_FAILED',
      message: error.message,
    })}\n`);
    return exitCodeFor(error);
  }
}

if (require.main === module) {
  main().then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`${JSON.stringify({ error: 'ENTRY_FAILED', message: error.message })}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  parseInvocation,
  runEntry,
};
