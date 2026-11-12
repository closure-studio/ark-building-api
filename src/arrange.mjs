import { normalize } from './protocol/normalize.mjs';
import { serializeDefinedFields } from './protocol/serialize.mjs';
import { planIsolation } from './mechanisms/isolation.mjs';
import { createIsolatedEvaluator } from './mechanisms/evaluate.mjs';
import { evaluateMood } from './mechanisms/mood.mjs';
import { productionObjective } from './solver/objective.mjs';
import { searchAssignments } from './solver/search.mjs';
import { seedAssignment } from './solver/seed.mjs';

/** 未完成协议语义核实前只返回显式预览，不提供可被旧调用端直接执行的data.arranged。 */
export function arrangePreview(input, catalog, { maxNodes = 100_000 } = {}) {
  const snapshot = normalize(input, catalog);
  const isolation = planIsolation(snapshot, catalog);
  const evaluateModifiers = createIsolatedEvaluator(snapshot, catalog);
  const fixed = new Set([...snapshot.reservedIds, ...isolation.excludedIds,
    ...snapshot.rooms.filter(r => isolation.frozenSlots.includes(r.slot)).flatMap(r => r.occupants)]);
  const tired = new Set(snapshot.operators.filter(op => op.ap <= catalog.tiredApThreshold && !fixed.has(op.instId)).map(op => op.instId));
  const dorms = snapshot.rooms.filter(r => r.type === 'DORMITORY' && !isolation.frozenSlots.includes(r.slot));
  const restTarget = Math.min(tired.size, dorms.reduce((sum, room) => sum + room.capacity, 0));
  const evaluate = assignment => {
    const resting = dorms.flatMap(room => assignment[room.slot]).filter(id => tired.has(id)).length;
    if (resting < restTarget) return null;
    const modifiers = evaluateModifiers(assignment);
    const mood = evaluateMood(snapshot, assignment, catalog, modifiers);
    const score = productionObjective(snapshot, assignment, catalog, modifiers);
    // 恢复只作主生产同分后的分项，不把心情点和资源产出相加。
    const recovery = Object.values(mood).reduce((sum, value) => sum + Math.max(0, value.changePerHour), 0);
    return { ...score, secondary: [...score.secondary, recovery], secondaryKeys: [...score.secondaryKeys, 'mood:recoveryPerHour'] };
  };
  const result = searchAssignments(snapshot, catalog, evaluate,
    { maxNodes, frozenSlots: isolation.frozenSlots, excludedIds: isolation.excludedIds,
      initialAssignments: [seedAssignment(snapshot, catalog, isolation)] });
  const selected = result.frontier[0];
  const modifiers = evaluateModifiers(selected.assignment);
  const serialized = serializeDefinedFields(snapshot, selected.assignment, catalog, isolation.frozenSlots);
  return {
    preview: serialized.data,
    diagnostics: {
      compatibility: 'local-preview-only', ...isolation,
      dataVersion: catalog.version,
      objective: selected.score,
      mood: evaluateMood(snapshot, selected.assignment, catalog, modifiers),
      unevaluated: modifiers.unevaluated,
      search: { nodes: result.nodes, evaluated: result.evaluated, exhausted: result.exhausted,
        stopReason: result.stopReason, incomparableAlternatives: result.frontier.length,
        selection: result.frontier.length > 1 ? 'stable-preview-not-value-optimum' : 'single-frontier-result' },
      rest: { target: restTarget, unassignedTired: tired.size - restTarget },
      blockers: ['RESPONSE_METRICS_UNDEFINED', 'CONSUMER_CONTRACT_UNVERIFIED'],
    },
  };
}
