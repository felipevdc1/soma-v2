'use strict';
/**
 * lib/spec-lint/scope-declaration.cjs — AC-05 (spec 019).
 *
 * "IF um gate novo for ligado, THEN o sistema SHALL declarar sobre quais
 * artefatos ele incide, e SHALL recusar em voz alta se a declaração estiver
 * ausente." A declaração vive no próprio módulo do check, como um campo
 * `scope = { artifacts: string[], retroactive: boolean }` ao lado de `name`
 * e `run`. Este arquivo só valida essa declaração — não lê disco, não roda
 * checks, não decide o que fazer com o resultado. Quem chama decide.
 *
 * `validateScopeDeclarations` NUNCA retorna silêncio por fallback: um check
 * sem `scope`, ou com `scope` malformado, sempre vira um achado nomeando o
 * check e o campo que falta. Sem `||` de default, sem `?.`, sem `catch{}`
 * mudo — qualquer um desses fabricaria "scope válido" a partir da ausência
 * dele, exatamente o defeito que o AC-05 existe para matar.
 *
 * @spec [SPEC:AC-05]
 * @task T-05 (dispatch avulso, AC-05 da spec 019)
 */

// A lista de artefatos que o próprio SOMA gera — o NO-GO da spec 019
// (spec.md linha 132): "o alvo são os artefatos que ele mesmo gera:
// spec.md, plan.md, tasks.md, contracts/, quickstart.md."
const VALID_ARTIFACTS = ['spec.md', 'plan.md', 'tasks.md', 'contracts/', 'quickstart.md'];

/** Retorna a lista de problemas (string[]) do `scope` de um check. Lista
 *  vazia = scope válido. Nunca lança — quem decide se "problema" vira
 *  exceção, exit code, ou só relatório é o chamador. */
function describeScopeProblems(scope) {
  const problems = [];

  if (scope === undefined) {
    problems.push('scope ausente');
    return problems;
  }
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
    problems.push(`scope inválido — esperado objeto { artifacts, retroactive }, recebido ${Array.isArray(scope) ? 'array' : typeof scope}`);
    return problems;
  }

  if (!Array.isArray(scope.artifacts) || scope.artifacts.length === 0) {
    problems.push('scope.artifacts ausente ou vazio — esperado string[] não-vazio');
  } else {
    const invalid = scope.artifacts.filter((a) => !VALID_ARTIFACTS.includes(a));
    if (invalid.length > 0) {
      problems.push(
        `scope.artifacts contém valor(es) fora da lista válida (${VALID_ARTIFACTS.join(', ')}): ${invalid.join(', ')}`
      );
    }
  }

  if (typeof scope.retroactive !== 'boolean') {
    problems.push('scope.retroactive ausente ou não-boolean — esperado true/false');
  }

  return problems;
}

/** Recebe a lista de checks (o array de registry.cjs) e devolve os achados:
 *  { check, message }[]. Lista vazia = todo check declara scope válido.
 *  Um check sem `scope`, ou com `scope` malformado, sempre produz pelo
 *  menos um achado — nomeando o check e o que falta, nunca em silêncio. */
function validateScopeDeclarations(checks) {
  const findings = [];
  for (const check of checks) {
    const name = check.name;
    for (const problem of describeScopeProblems(check.scope)) {
      findings.push({ check: name, message: `check '${name}': ${problem}` });
    }
  }
  return findings;
}

module.exports = { validateScopeDeclarations, describeScopeProblems, VALID_ARTIFACTS };
