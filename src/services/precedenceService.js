const { randomUUID } = require('crypto');

function createRule({ firstId, relation, secondId, stops, existingRules = [] }) {
  const ids = new Set(stops.map((stop) => stop.id));
  if (!ids.has(firstId) || !ids.has(secondId)) throw new Error('Selecione duas paradas válidas.');
  if (firstId === secondId) throw new Error('Uma parada não pode depender dela mesma.');

  const normalized = relation === 'after'
    ? { beforeId: secondId, afterId: firstId }
    : { beforeId: firstId, afterId: secondId };

  if (existingRules.some((rule) => rule.beforeId === normalized.beforeId && rule.afterId === normalized.afterId)) {
    throw new Error('Esta regra de precedência já foi adicionada.');
  }

  const rule = { id: randomUUID(), ...normalized };
  const candidateRules = [...existingRules, rule];
  const cycle = findCycle(stops.map((stop) => stop.id), candidateRules);
  if (cycle.length) {
    const nameById = new Map(stops.map((stop) => [stop.id, stop.displayName]));
    const readable = cycle.map((id) => nameById.get(id) || id).join(' → ');
    throw new Error(`Regra conflitante: foi criada uma dependência circular (${readable}).`);
  }
  return rule;
}

function findCycle(stopIds, rules) {
  const graph = new Map(stopIds.map((id) => [id, []]));
  for (const rule of rules) {
    if (graph.has(rule.beforeId) && graph.has(rule.afterId)) graph.get(rule.beforeId).push(rule.afterId);
  }

  const state = new Map(stopIds.map((id) => [id, 0]));
  const stack = [];

  function visit(id) {
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id) || []) {
      if (state.get(next) === 0) {
        const found = visit(next);
        if (found.length) return found;
      } else if (state.get(next) === 1) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
    }
    stack.pop();
    state.set(id, 2);
    return [];
  }

  for (const id of stopIds) {
    if (state.get(id) === 0) {
      const cycle = visit(id);
      if (cycle.length) return cycle;
    }
  }
  return [];
}

function orderViolations(sequenceIds, rules) {
  const position = new Map(sequenceIds.map((id, index) => [id, index]));
  return rules.filter((rule) => {
    if (!position.has(rule.beforeId) || !position.has(rule.afterId)) return false;
    return position.get(rule.beforeId) >= position.get(rule.afterId);
  });
}

function isOrderValid(sequenceIds, rules) {
  return orderViolations(sequenceIds, rules).length === 0;
}

function rulesWithFinalStop(stops, rules = [], finalStopId = null) {
  const explicitRules = Array.isArray(rules) ? [...rules] : [];
  if (!finalStopId) return explicitRules;

  const stopIds = new Set(stops.map((stop) => stop.id));
  if (!stopIds.has(finalStopId)) throw new Error('O destino final selecionado não está mais entre as paradas da rota.');

  const existing = new Set(explicitRules.map((rule) => `${rule.beforeId}|${rule.afterId}`));
  for (const stop of stops) {
    if (stop.id === finalStopId) continue;
    const key = `${stop.id}|${finalStopId}`;
    if (existing.has(key)) continue;
    explicitRules.push({
      id: `final:${stop.id}:${finalStopId}`,
      beforeId: stop.id,
      afterId: finalStopId,
      implicitFinal: true
    });
  }
  return explicitRules;
}

module.exports = { createRule, findCycle, orderViolations, isOrderValid, rulesWithFinalStop };
