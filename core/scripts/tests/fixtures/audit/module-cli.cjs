'use strict';
/**
 * module-cli.cjs — fixture for audit tests
 * A fake CLI module that supports --help
 */

// Parse args
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: module-cli [options]\n  --run   Execute the command\n  --dry   Dry run mode\n');
    process.exit(0);
  }
  if (args.includes('--run')) {
    process.stdout.write(JSON.stringify({ status: 'ok' }) + '\n');
    process.exit(0);
  }
  process.stdout.write('No command given\n');
  process.exit(1);
}

function runCommand(opts) {
  return { status: 'ok', opts };
}

function dryRun(opts) {
  return { status: 'dry', opts };
}

module.exports = { runCommand, dryRun };
