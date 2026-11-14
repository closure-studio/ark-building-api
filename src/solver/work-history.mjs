import { unlockedBuffs } from '../data/catalog.mjs';
import { compileBuff } from '../mechanisms/compile.mjs';
import { planIsolation } from '../mechanisms/isolation.mjs';
import { createIsolatedEvaluator } from '../mechanisms/evaluate.mjs';
import { productionObjective } from './objective.mjs';

/** 仅正向封顶制造暖机可用上限构造参考；不是对缺失历史的推断。 */
export function workHistoryResetContext(snapshot, catalog, maxNodes, model) {
  if (maxNodes < 20) return null;
  const isolation = planIsolation(snapshot, catalog, model?.registry);
  const history = isolation.unresolved.filter(item => item.reason === 'MISSING_WORK_HISTORY');
  if (!history.length || isolation.unresolved.some(item => item.slot !== null && item.reason !== 'MISSING_WORK_HISTORY')) return null;
  const relaxed = planIsolation(snapshot, catalog, model?.registry, { resetWorkHistory: true });
  if (relaxed.frozenSlots.length) return null;
  const upper = structuredClone(snapshot);
  for (const item of history) {
    const operator = upper.operators.find(op => op.instId === item.instId);
    const effects = unlockedBuffs(catalog, operator).filter(buff => buff.roomType === 'MANUFACTURE')
      .flatMap(buff => compileBuff(buff, catalog.characterNames).effects ?? []).filter(effect => effect.basis === 'workHours');
    if (!effects.length || effects.some(effect => effect.stat !== 'production' || effect.scope !== 'room'
      || !Number.isFinite(effect.cap) || !(effect.value > 0) || (effect.offset ?? 0) < 0)) return null;
    operator.completedWorkHours = Math.max(...effects.map(effect => Math.max(0,
      Math.ceil((effect.cap - (effect.offset ?? 0)) / effect.value) * (effect.step ?? 1))));
  }
  const assignment = Object.fromEntries(snapshot.rooms.map(room => [room.slot, [...room.occupants]]));
  let originalUpper;
  try {
    const modifiers = createIsolatedEvaluator(upper, catalog, model?.registry)(assignment);
    const base = productionObjective(upper, assignment, catalog, modifiers);
    originalUpper = model ? model.project(assignment, modifiers, base) : base;
  } catch (error) {
    if (['INVALID_ASSIGNMENT', 'MISSING_MECHANISM_STATE', 'QUALITY_CONDITION_UNCONFIRMED'].includes(error.code)) return null;
    throw error;
  }
  return { history, originalUpper };
}

export function resetsWorkHistorySeeds(snapshot, seeds, history) {
  return seeds.map(seed => {
    const assignment = structuredClone(seed);
    for (const room of snapshot.rooms) {
      const ids = assignment[room.slot];
      if (!history.some(item => item.slot === room.slot
        && ids.indexOf(item.instId) !== -1
        && ids.indexOf(item.instId) === (room.originalSeats ?? room.occupants).indexOf(item.instId))) continue;
      if (ids.length > 1) ids.push(ids.shift());
      else {
        const id = ids.pop();
        const target = snapshot.rooms.find(other => other.slot !== room.slot && other.type === room.type
          && assignment[other.slot].length < other.capacity);
        if (target) assignment[target.slot].push(id);
      }
    }
    return assignment;
  });
}

export function improvesOriginalUpper(score, upper) {
  if (JSON.stringify(score.primaryKeys) !== JSON.stringify(upper.primaryKeys)
    || JSON.stringify(score.secondaryKeys.slice(0, upper.secondaryKeys.length)) !== JSON.stringify(upper.secondaryKeys)) return false;
  return score.primary.every((value, index) => value >= upper.primary[index] - 1e-12)
    && upper.secondary.every((value, index) => score.secondary[index] >= value - 1e-12)
    && score.primary.some((value, index) => value > upper.primary[index] + 1e-12);
}
