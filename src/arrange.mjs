import { normalize } from './protocol/normalize.mjs';
import { serializeDefinedFields } from './protocol/serialize.mjs';
import { planIsolation } from './mechanisms/isolation.mjs';
import { createIsolatedEvaluator } from './mechanisms/evaluate.mjs';
import { evaluateMood } from './mechanisms/mood.mjs';
import { productionObjective } from './solver/objective.mjs';
import { searchAssignments } from './solver/search.mjs';
import { seedAssignments } from './solver/seed.mjs';
import { workHistoryResetContext, resetsWorkHistorySeeds, improvesOriginalUpper } from './solver/work-history.mjs';
import { practicalModel } from './solver/practical.mjs';
import { createGroupNeighbors } from './solver/group-templates.mjs';

/** 有界尝试可确定的新进驻安排；不能超过原班暖机上限时仍沿用保守隔离。 */
export function arrangePreview(input, catalog, { maxNodes = 100_000, practical = false } = {}) {
  const snapshot = normalize(input, catalog);
  const model = practical ? practicalModel(snapshot, catalog) : undefined;
  const context = workHistoryResetContext(snapshot, catalog, maxNodes, model);
  if (!context) return arrangeSnapshot(snapshot, catalog, { maxNodes, model });
  const attemptBudget = maxNodes - Math.min(32, Math.floor(maxNodes / 4)) - 1;
  let spent = attemptBudget + 1;
  try {
    const candidate = arrangeSnapshot(snapshot, catalog, { maxNodes: attemptBudget, resetContext: context, model });
    spent = candidate.diagnostics.search.nodes + 1;
    if (improvesOriginalUpper(candidate.diagnostics.objective, context.originalUpper)) {
      candidate.diagnostics.search.nodes = spent;
      candidate.diagnostics.workHistoryReset = { comparison: 'capped-original-production',
        originalUpper: context.originalUpper, operators: context.history.map(item => ({ instId: item.instId, slot: item.slot })) };
      return candidate;
    }
  } catch (error) {
    if (!['SEARCH_BUDGET_EXCEEDED', 'NO_EVALUABLE_ASSIGNMENT'].includes(error.code)) throw error;
  }
  const fallback = arrangeSnapshot(snapshot, catalog, { maxNodes: maxNodes - spent, model });
  fallback.diagnostics.search.nodes += spent;
  return fallback;
}

/** 未完成协议语义核实前只返回显式预览，不提供可被旧调用端直接执行的data.arranged。 */
function arrangeSnapshot(snapshot, catalog, { maxNodes, resetContext, model }) {
  const options = { resetWorkHistory: !!resetContext };
  const isolation = planIsolation(snapshot, catalog, model?.registry, options);
  const evaluateModifiers = createIsolatedEvaluator(snapshot, catalog, model?.registry, options);
  const fixed = new Set([...snapshot.reservedIds, ...isolation.excludedIds,
    ...snapshot.rooms.filter(r => isolation.frozenSlots.includes(r.slot)).flatMap(r => r.occupants)]);
  const tired = new Set(snapshot.operators.filter(op => op.ap <= catalog.tiredApThreshold && !fixed.has(op.instId)).map(op => op.instId));
  const dorms = snapshot.rooms.filter(r => r.type === 'DORMITORY' && !isolation.frozenSlots.includes(r.slot));
  const restTarget = Math.min(tired.size, dorms.reduce((sum, room) => sum + room.capacity, 0));
  const evaluate = assignment => {
    const resting = dorms.flatMap(room => assignment[room.slot]).filter(id => tired.has(id)).length;
    if (resting < restTarget) return null;
    let modifiers;
    try { modifiers = evaluateModifiers(assignment); }
    catch (error) {
      if (error.code === 'MISSING_MECHANISM_STATE' && error.candidateDependent === true) return null;
      throw error;
    }
    const mood = evaluateMood(snapshot, assignment, catalog, modifiers);
    let score = productionObjective(snapshot, assignment, catalog, modifiers);
    if (model) {
      try { score = model.project(assignment, modifiers, score); }
      catch (error) {
        if (error.code === 'QUALITY_CONDITION_UNCONFIRMED') return null;
        throw error;
      }
    }
    // 恢复只作主生产同分后的分项，不把心情点和资源产出相加。
    const recovery = Object.values(mood).reduce((sum, value) => sum + Math.max(0, value.changePerHour), 0);
    return { ...score, secondary: [...score.secondary, recovery], secondaryKeys: [...score.secondaryKeys, 'mood:recoveryPerHour'] };
  };
  const seeds = seedAssignments(snapshot, catalog, isolation);
  const result = searchAssignments(snapshot, catalog, evaluate,
    { maxNodes, frozenSlots: isolation.frozenSlots, excludedIds: isolation.excludedIds,
      groupNeighbors: createGroupNeighbors(snapshot, catalog, isolation, model?.registry),
      initialAssignments: resetContext ? resetsWorkHistorySeeds(snapshot, seeds, resetContext.history) : seeds });
  const improving = resetContext ? result.frontier.filter(candidate => improvesOriginalUpper(candidate.score, resetContext.originalUpper)) : [];
  const candidates = improving.length ? improving : result.frontier;
  const selected = model ? model.select(candidates) : candidates[0];
  const modifiers = evaluateModifiers(selected.assignment);
  const serialized = serializeDefinedFields(snapshot, selected.assignment, catalog, isolation.frozenSlots);
  return {
    preview: serialized.data,
    diagnostics: {
      compatibility: 'local-preview-only', ...isolation,
      dataVersion: catalog.version,
      objective: selected.score,
      mood: evaluateMood(snapshot, selected.assignment, catalog, modifiers),
      ...(model ? { approximation: model.diagnostics(selected.assignment) } : {}),
      ...(modifiers.entryEvents?.length ? { entryEvents: modifiers.entryEvents } : {}),
      unevaluated: modifiers.unevaluated,
      search: { nodes: result.nodes, evaluated: result.evaluated, exhausted: result.exhausted,
        stopReason: result.stopReason, incomparableAlternatives: result.frontier.length,
        selection: result.frontier.length > 1 ? 'stable-preview-not-value-optimum' : 'single-frontier-result' },
      rest: { target: restTarget, unassignedTired: tired.size - restTarget },
      blockers: ['RESPONSE_METRICS_UNDEFINED', 'CONSUMER_CONTRACT_UNVERIFIED'],
    },
  };
}
