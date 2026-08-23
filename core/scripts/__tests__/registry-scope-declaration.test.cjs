'use strict';
/**
 * registry-scope-declaration.test.cjs — AC-05 (spec 019): "IF um gate novo
 * for ligado, THEN o sistema SHALL declarar sobre quais artefatos ele
 * incide, e SHALL recusar em voz alta se a declaração estiver ausente."
 *
 * Três testes: conhecido-ruim (validador acusa check sem scope, nomeando o
 * check e o que falta), conhecido-bom (validador fica quieto com scope
 * válido), e o real (os dois checks do registry.cjs declaram scope válido —
 * este é o RED: hoje nenhum dos dois tem `scope`).
 *
 * @spec [SPEC:AC-05]
 * @task T-05 (dispatch avulso, AC-05 da spec 019)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateScopeDeclarations } = require('../lib/spec-lint/scope-declaration.cjs');
const registeredChecks = require('../lib/spec-lint/registry.cjs');

// ── conhecido-ruim: check sem scope → o validador acusa ────────────────────

test('AC-05 conhecido-ruim: check registrado sem scope → validador acusa, nomeando o check e o que falta', () => {
  const fakeChecks = [{ name: 'fake', run() {} }];

  const findings = validateScopeDeclarations(fakeChecks);

  assert.equal(findings.length, 1, `esperava 1 achado para check sem scope, recebeu ${findings.length}`);
  assert.match(findings[0].message, /fake/, 'a mensagem tem que nomear o check');
  assert.match(findings[0].message, /scope ausente/, 'a mensagem tem que nomear o que falta (scope ausente)');
});

// ── conhecido-bom: check com scope válido → o validador fica quieto ────────

test('AC-05 conhecido-bom: check registrado com scope válido → validador não acusa nada', () => {
  const fakeChecks = [
    {
      name: 'fake',
      scope: { artifacts: ['plan.md'], retroactive: false },
      run() {},
    },
  ];

  const findings = validateScopeDeclarations(fakeChecks);

  assert.deepEqual(findings, [], `esperava zero achados para check com scope válido, recebeu ${JSON.stringify(findings)}`);
});

// ── o real: todo check em registry.cjs declara scope válido ────────────────

test('AC-05 real: todo check registrado em registry.cjs declara scope.artifacts e scope.retroactive válidos', () => {
  const findings = validateScopeDeclarations(registeredChecks);

  assert.deepEqual(
    findings,
    [],
    `esperava zero achados contra o registry.cjs real, recebeu ${JSON.stringify(findings, null, 2)}`
  );
});
