'use strict';

const { error } = require('./request-schema.cjs');

function invalid(message) {
  return error('INVALID_ARGUMENTS', message);
}

function lex(raw) {
  if (typeof raw !== 'string') throw invalid('Raw arguments must be a string');
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote === null && /\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      if (index + 1 >= raw.length) throw invalid('Trailing backslash');
      current += raw[index + 1];
      started = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      if (quote === null) {
        quote = char;
        started = true;
      } else if (quote === char) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote !== null) throw invalid('Unterminated quote');
  if (started) tokens.push(current);
  return tokens;
}

function parseRawArguments(raw) {
  const tokens = lex(raw);
  if (tokens.length === 0) throw invalid('An objective or mode is required');
  let mode = null;
  let project = null;
  let resumeRunId = null;
  const objective = [];
  let projectSeen = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--help') {
      if (mode !== null || tokens.length !== 1) throw invalid('Help cannot be combined with other arguments');
      mode = 'help';
    } else if (token === '--status') {
      if (mode !== null || objective.length > 0) throw invalid('Modes conflict');
      mode = 'status';
    } else if (token === '--resume') {
      if (mode !== null || objective.length > 0) throw invalid('Modes conflict');
      mode = 'resume';
    } else if (token === '--project') {
      if (projectSeen || index + 1 >= tokens.length || tokens[index + 1].startsWith('--')) throw invalid('Project requires one path');
      projectSeen = true;
      project = tokens[index + 1];
      index += 1;
    } else if (token.startsWith('--')) {
      throw invalid(`Unknown flag: ${token}`);
    } else if (mode === 'status' || mode === 'help') {
      throw invalid('This mode does not accept positional arguments');
    } else if (mode === 'resume') {
      if (resumeRunId !== null) throw invalid('Resume accepts at most one run ID');
      resumeRunId = token;
    } else {
      objective.push(token);
    }
  }
  if (mode === 'help') return { mode: 'help' };
  if (mode === 'status') return { mode: 'status', project };
  if (mode === 'resume') return { mode: 'resume', runId: resumeRunId, project };
  if (objective.length === 0) throw invalid('An objective is required');
  return { mode: 'start', objective: objective.join(' '), project };
}

module.exports = { lex, parseRawArguments };
