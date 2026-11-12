import { DataError } from '../data/catalog.mjs';

function finite(value) { if (!Number.isFinite(value)) throw new DataError(); return value; }

/** 当前瞬时心情变化（点/小时）；不预测班次长度、疲劳后的生产或未来恢复。 */
export function evaluateMood(snapshot, assignment, catalog, modifiers) {
  const frozen = new Set(modifiers.unevaluated?.slots ?? []);
  const controls = snapshot.rooms.filter(room => room.type === 'CONTROL');
  if (controls.some(room => frozen.has(room.slot))
    && snapshot.rooms.some(room => room.type !== 'DORMITORY' && !frozen.has(room.slot) && assignment[room.slot].length)) {
    const error = new Error('中枢心情依赖未求值');
    error.code = 'UNKNOWN_MOOD_DEPENDENCY'; error.status = 422; throw error;
  }
  const controlCount = controls.reduce((sum, room) => sum + assignment[room.slot].length, 0);
  const controlReduction = controlCount ? finite(catalog.controlData?.basicCostBuff) * controlCount / 100 : 0;
  const operators = new Map(snapshot.operators.map(op => [op.instId, op]));
  const result = {};
  const factor = finite(catalog.manpowerDisplayFactor);
  if (factor <= 0) throw new DataError();
  for (const room of snapshot.rooms) {
    if (frozen.has(room.slot) || !assignment[room.slot].length) continue;
    let base;
    if (room.type === 'DORMITORY') {
      const phase = catalog.dormData?.phases?.[room.level - 1];
      // PRTS宿舍效用：等级基础 + 0.0004 × 有效氛围，非直接使用未截断家具总值。
      base = finite(phase?.manpowerRecover) / 100
        + Math.min(finite(room.comfort), finite(phase?.decorationLimit)) * 0.0004;
    } else {
      const countKey = { MANUFACTURE: 'manufactManpowerCostByNum', TRADING: 'tradingManpowerCostByNum' }[room.type];
      const teamReduction = countKey ? finite(catalog[countKey]?.[assignment[room.slot].length]) / 100 : 0;
      base = -(1 + controlReduction + teamReduction);
    }
    for (const id of assignment[room.slot]) {
      const op = operators.get(id);
      const bonus = modifiers.operators[id] ?? {};
      let rate = room.type === 'DORMITORY' && bonus.fixedMoodRecovery !== undefined
        ? finite(bonus.fixedMoodRecovery)
        : finite(base + finite(bonus.moodRecovery ?? 0) - finite(bonus.moodCost ?? 0));
      const max = finite(catalog.chars[op.charId].maxManpower);
      if ((op.ap >= max && rate > 0) || (op.ap <= 0 && rate < 0)) rate = 0;
      result[id] = { current: finite(op.ap) / factor, changePerHour: rate };
    }
  }
  return result;
}
