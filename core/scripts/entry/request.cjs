'use strict';

const { resolveProject: defaultResolveProject } = require('./project.cjs');
const { inspectAdoption: defaultInspectAdoption, adoptProject: defaultAdoptProject } = require('./adoption.cjs');

function routeEntryRequest(parsed, context = {}) {
  if (parsed.mode === 'help') {
    return {
      status: 'HELP_SHOWN', retrySafe: true,
      forms: [
        '/soma-run "objective"', '/soma-run --help',
        '/soma-run --status [--project <path>]',
        '/soma-run --resume [runId] [--project <path>]',
      ],
    };
  }

  const resolveProject = context.resolveProject || defaultResolveProject;
  let resolution;
  try {
    resolution = resolveProject({
      project: parsed.project,
      cwd: context.cwd || process.cwd(),
      home: context.home,
    });
  } catch (error) {
    return {
      status: 'PROJECT_UNRESOLVED', retrySafe: true,
      diagnostic: `${error.code || 'PROJECT_UNRESOLVED'}: ${error.message}`,
    };
  }

  const inspectAdoption = context.inspectAdoption || defaultInspectAdoption;
  if (parsed.mode === 'status') {
    const inspection = inspectAdoption(resolution);
    return {
      status: 'STATUS_SHOWN', retrySafe: true,
      projectRoot: resolution.projectRoot, scope: resolution.scope,
      adoption: inspection.kind, diagnostic: inspection.diagnostic || null,
      facts: inspection.facts,
    };
  }
  if (parsed.mode === 'resume') {
    return {
      status: 'RESUME_DRIFT', retrySafe: true,
      projectRoot: resolution.projectRoot, scope: resolution.scope,
      diagnostic: 'Resume continuity is not available until the handoff task is installed',
    };
  }
  if (parsed.mode === 'start') {
    const adoptProject = context.adoptProject || defaultAdoptProject;
    const result = adoptProject(resolution);
    return { ...result, objective: parsed.objective };
  }
  return { status: 'ARGUMENT_ERROR', retrySafe: true, diagnostic: 'Unknown entry mode' };
}

module.exports = { routeEntryRequest };
