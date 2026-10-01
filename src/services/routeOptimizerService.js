const { findCycle, isOrderValid, rulesWithFinalStop } = require('./precedenceService');

const EXACT_LIMIT = 12;

function optimizeRoute({ origin, stops, rules = [], finalStopId = null, matrix }) {
  if (!origin) throw new Error('A origem da rota não foi definida.');
  if (!Array.isArray(stops) || stops.length === 0) throw new Error('Adicione pelo menos uma parada antes de otimizar.');

  const effectiveRules = rulesWithFinalStop(stops, rules, finalStopId);
  const cycle = findCycle(stops.map((stop) => stop.id), effectiveRules);
  if (cycle.length) {
    if (finalStopId) throw new Error('Não foi possível gerar a rota porque o destino final selecionado conflita com uma regra de precedência.');
    throw new Error('Não foi possível gerar a rota porque existem regras de precedência conflitantes.');
  }

  const indexByPointId = new Map(matrix.pointIds.map((id, index) => [id, index]));
  let sequence;
  let algorithm;

  if (stops.length <= EXACT_LIMIT) {
    sequence = exactShortestPath(origin.id, stops, effectiveRules, matrix, indexByPointId);
    algorithm = `Otimização exata (${stops.length} paradas)`;
  } else {
    sequence = heuristicShortestPath(origin.id, stops, effectiveRules, matrix, indexByPointId);
    algorithm = `Heurística avançada (${stops.length} paradas)`;
  }

  if (finalStopId && sequence[sequence.length - 1] !== finalStopId) {
    throw new Error('O otimizador não conseguiu manter o destino final selecionado.');
  }

  const metrics = calculateSequenceMetrics(origin.id, sequence, matrix);
  return { sequenceIds: sequence, algorithm, finalStopId, ...metrics };
}

function exactShortestPath(originId, stops, rules, matrix, indexByPointId) {
  const n = stops.length;
  const idToLocal = new Map(stops.map((stop, index) => [stop.id, index]));
  const predecessorMask = Array(n).fill(0);
  for (const rule of rules) {
    const before = idToLocal.get(rule.beforeId);
    const after = idToLocal.get(rule.afterId);
    if (before !== undefined && after !== undefined) predecessorMask[after] |= (1 << before);
  }

  const states = 1 << n;
  const dp = Array.from({ length: states }, () => new Float64Array(n).fill(Infinity));
  const parent = Array.from({ length: states }, () => new Int16Array(n).fill(-1));

  for (let j = 0; j < n; j++) {
    if (predecessorMask[j] !== 0) continue;
    dp[1 << j][j] = costBetween(originId, stops[j].id, matrix, indexByPointId);
  }

  for (let mask = 1; mask < states; mask++) {
    for (let last = 0; last < n; last++) {
      const currentCost = dp[mask][last];
      if (!Number.isFinite(currentCost)) continue;
      for (let next = 0; next < n; next++) {
        const bit = 1 << next;
        if (mask & bit) continue;
        if ((predecessorMask[next] & mask) !== predecessorMask[next]) continue;
        const nextMask = mask | bit;
        const nextCost = currentCost + costBetween(stops[last].id, stops[next].id, matrix, indexByPointId);
        if (nextCost < dp[nextMask][next]) {
          dp[nextMask][next] = nextCost;
          parent[nextMask][next] = last;
        }
      }
    }
  }

  const fullMask = states - 1;
  let bestLast = -1;
  let bestCost = Infinity;
  for (let j = 0; j < n; j++) {
    if (dp[fullMask][j] < bestCost) {
      bestCost = dp[fullMask][j];
      bestLast = j;
    }
  }
  if (bestLast < 0 || !Number.isFinite(bestCost)) throw new Error('Não foi possível construir uma rota válida com as regras informadas.');

  const reversed = [];
  let mask = fullMask;
  let last = bestLast;
  while (last >= 0) {
    reversed.push(stops[last].id);
    const previous = parent[mask][last];
    mask &= ~(1 << last);
    last = previous;
  }
  return reversed.reverse();
}

function heuristicShortestPath(originId, stops, rules, matrix, indexByPointId) {
  const seeds = buildGreedySeeds(originId, stops, rules, matrix, indexByPointId, Math.min(8, stops.length));
  let best = null;
  let bestCost = Infinity;
  for (const seed of seeds) {
    const improved = improveLocally(seed, rules, originId, matrix, indexByPointId);
    const cost = sequenceCost(originId, improved, matrix, indexByPointId);
    if (cost < bestCost) {
      best = improved;
      bestCost = cost;
    }
  }
  return best || greedySequence(originId, stops, rules, matrix, indexByPointId);
}

function buildGreedySeeds(originId, stops, rules, matrix, indexByPointId, count) {
  const availableFirst = stops.filter((stop) => !rules.some((rule) => rule.afterId === stop.id));
  const ranked = [...availableFirst].sort((a, b) => costBetween(originId, a.id, matrix, indexByPointId) - costBetween(originId, b.id, matrix, indexByPointId));
  const seeds = [];
  seeds.push(greedySequence(originId, stops, rules, matrix, indexByPointId));
  for (const first of ranked.slice(0, count)) {
    seeds.push(greedySequence(originId, stops, rules, matrix, indexByPointId, first.id));
  }
  return uniqueSequences(seeds);
}

function greedySequence(originId, stops, rules, matrix, indexByPointId, forcedFirstId = null) {
  const predecessors = new Map(stops.map((stop) => [stop.id, new Set()]));
  for (const rule of rules) if (predecessors.has(rule.afterId)) predecessors.get(rule.afterId).add(rule.beforeId);
  const remaining = new Map(stops.map((stop) => [stop.id, stop]));
  const visited = new Set();
  const sequence = [];
  let currentPointId = originId;

  while (remaining.size > 0) {
    const available = [...remaining.values()].filter((stop) => [...(predecessors.get(stop.id) || [])].every((id) => visited.has(id)));
    if (!available.length) throw new Error('As regras de precedência impedem a construção de uma sequência válida.');

    let chosen = null;
    if (sequence.length === 0 && forcedFirstId) chosen = available.find((stop) => stop.id === forcedFirstId) || null;
    if (!chosen) {
      chosen = available.reduce((best, stop) => {
        if (!best) return stop;
        return costBetween(currentPointId, stop.id, matrix, indexByPointId) < costBetween(currentPointId, best.id, matrix, indexByPointId) ? stop : best;
      }, null);
    }

    sequence.push(chosen.id);
    visited.add(chosen.id);
    remaining.delete(chosen.id);
    currentPointId = chosen.id;
  }
  return sequence;
}

function improveLocally(sequence, rules, originId, matrix, indexByPointId) {
  let best = [...sequence];
  let bestCost = sequenceCost(originId, best, matrix, indexByPointId);
  const deadline = Date.now() + 300;

  for (let round = 0; round < 5 && Date.now() < deadline; round++) {
    let changed = false;

    // Relocate one stop to another position.
    outerRelocate:
    for (let from = 0; from < best.length; from++) {
      for (let to = 0; to < best.length; to++) {
        if (from === to) continue;
        const candidate = [...best];
        const [item] = candidate.splice(from, 1);
        candidate.splice(to, 0, item);
        if (!isOrderValid(candidate, rules)) continue;
        const cost = sequenceCost(originId, candidate, matrix, indexByPointId);
        if (cost + 0.5 < bestCost) {
          best = candidate;
          bestCost = cost;
          changed = true;
          break outerRelocate;
        }
      }
    }
    if (changed) continue;

    // 2-opt reversal improves road-like route shapes.
    outerReverse:
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        if (!isOrderValid(candidate, rules)) continue;
        const cost = sequenceCost(originId, candidate, matrix, indexByPointId);
        if (cost + 0.5 < bestCost) {
          best = candidate;
          bestCost = cost;
          changed = true;
          break outerReverse;
        }
      }
    }
    if (!changed) break;
  }
  return best;
}

function calculateSequenceMetrics(originId, sequenceIds, matrix) {
  const indexByPointId = new Map(matrix.pointIds.map((id, index) => [id, index]));
  let previousId = originId;
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  let complete = true;
  const legs = [];

  for (const stopId of sequenceIds) {
    const fromIndex = indexByPointId.get(previousId);
    const toIndex = indexByPointId.get(stopId);
    const distance = finiteOrNull(matrix.distanceMeters?.[fromIndex]?.[toIndex]);
    const duration = finiteOrNull(matrix.durationSeconds?.[fromIndex]?.[toIndex]);
    if (distance === null || duration === null) complete = false;
    if (distance !== null) totalDistanceMeters += distance;
    if (duration !== null) totalDurationSeconds += duration;
    legs.push({ fromId: previousId, toId: stopId, distanceMeters: distance, durationSeconds: duration });
    previousId = stopId;
  }

  return {
    totalDistanceMeters: Math.round(totalDistanceMeters),
    totalDurationSeconds: Math.round(totalDurationSeconds),
    metricsComplete: complete,
    legs
  };
}

function sequenceCost(originId, sequence, matrix, indexByPointId) {
  let previous = originId;
  let cost = 0;
  for (const id of sequence) {
    cost += costBetween(previous, id, matrix, indexByPointId);
    previous = id;
  }
  return cost;
}

function costBetween(fromId, toId, matrix, indexByPointId) {
  const fromIndex = indexByPointId.get(fromId);
  const toIndex = indexByPointId.get(toId);
  const duration = finiteOrNull(matrix.durationSeconds?.[fromIndex]?.[toIndex]);
  if (duration !== null) return duration;
  const distance = finiteOrNull(matrix.distanceMeters?.[fromIndex]?.[toIndex]);
  if (distance !== null) return distance / 10;
  return Number.MAX_SAFE_INTEGER / 4;
}

function uniqueSequences(sequences) {
  const seen = new Set();
  return sequences.filter((sequence) => {
    const key = sequence.join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = { optimizeRoute, calculateSequenceMetrics, exactShortestPath };
