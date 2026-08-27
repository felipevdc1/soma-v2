'use strict';

const { resolveProject: defaultResolveProject } = require('./project.cjs');
const { inspectAdoption: defaultInspectAdoption, adoptProject: defaultAdoptProject } = require('./adoption.cjs');
const { resumeContinuity: defaultResumeContinuity } = require('./continuity.cjs');
const { durableStatus: defaultDurableStatus } = require('./status.cjs');

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

  if (parsed.mode === 'resume' && (!Number.isSafeInteger(context.ownerPid) || context.ownerPid <= 0)) {
    return {
      status: 'RESUME_IDENTITY_REQUIRED', retrySafe: true,
      diagnostic: 'RESUME_IDENTITY_REQUIRED: ownerPid must be a positive safe integer',
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
    const durableStatus = context.durableStatus || defaultDurableStatus;
    return {
      status: 'STATUS_SHOWN', retrySafe: true,
      projectRoot: resolution.projectRoot, scope: resolution.scope,
      adoption: inspection.kind, diagnostic: inspection.diagnostic || null,
      facts: inspection.facts,
      run: durableStatus(resolution.projectRoot),
    };
  }
  if (parsed.mode === 'resume') {
    const resumeContinuity = context.resumeContinuity || defaultResumeContinuity;
    return resumeContinuity({
      projectRoot: resolution.projectRoot, requestedRunId: parsed.runId,
      executionScope: resolution.scope, sessionId: context.sessionId, ownerPid: context.ownerPid,
    });
  }
  if (parsed.mode === 'start') {
    const adoptProject = context.adoptProject || defaultAdoptProject;
    const result = adoptProject(resolution);
    return { ...result, objective: parsed.objective };
  }
  return { status: 'ARGUMENT_ERROR', retrySafe: true, diagnostic: 'Unknown entry mode' };
}

module.exports = { routeEntryRequest };
