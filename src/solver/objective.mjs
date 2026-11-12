import { DataError } from '../data/catalog.mjs';
import { SearchError } from './search.mjs';

function finite(value) { if (!Number.isFinite(value)) throw new DataError(); return value; }

/** 生产分项Pareto目标；不将资源换算缺口掩盖为任意权重或直接百分比求和。 */
export function productionObjective(snapshot, assignment, catalog, modifiers) {
  const primary = new Map(), secondary = new Map();
  const frozen = new Set(modifiers.unevaluated?.slots ?? []);
  for (const room of snapshot.rooms) {
    if (frozen.has(room.slot)) continue;
    const count = assignment[room.slot].length;
    const bonus = modifiers.rooms[room.slot];
    if (!bonus) throw new DataError();
    let key, speed, base, perPerson, increment, target = primary;
    if (room.type === 'MANUFACTURE') {
      const formula = catalog.manufactFormulas[room.formulaId];
      if (!formula || typeof formula.itemId !== 'string' || finite(formula.costPoint) <= 0 || finite(formula.count) <= 0) throw new DataError();
      key = `item:${formula.itemId}:perHour`;
      base = catalog.manufactData?.phases?.[room.level - 1]?.speed;
      perPerson = catalog.manufactData?.basicSpeedBuff;
      increment = bonus.production ?? 0;
      speed = finite(base) + count * finite(perPerson) + finite(increment);
      if (speed < 0) throw new SearchError('INVALID_PRODUCTION_RATE', 422);
      primary.set(key, (primary.get(key) ?? 0) + (count ? speed * formula.count * 3600 / formula.costPoint : 0));
      continue;
    }
    if (room.type === 'TRADING') {
      // 未确认订单状态/概率模型：只比较同一房间固定策略的速率，不跨站换算收益。
      key = `trading:${room.slot}:speed`;
      base = catalog.tradingData?.phases?.[room.level - 1]?.orderSpeed;
      perPerson = catalog.tradingData?.basicSpeedBuff; increment = bonus.orderSpeed ?? 0;
    } else {
      const spec = { POWER: ['powerData', 'droneSpeed'], MEETING: ['meetingData', 'clueSpeed'], HIRE: ['hireData', 'contactSpeed'] }[room.type];
      if (!spec) continue;
      const [dataKey, stat] = spec;
      key = `${room.slot}:${stat}`; base = 1; perPerson = catalog[dataKey]?.basicSpeedBuff;
      increment = bonus[stat] ?? 0; target = secondary;
    }
    speed = finite(base) + count * finite(perPerson) + finite(increment);
    if (speed < 0) throw new SearchError('INVALID_PRODUCTION_RATE', 422);
    target.set(key, count ? speed : 0);
  }
  if (!primary.size) primary.set('no-production', 0);
  const primaryKeys = [...primary.keys()].sort(), secondaryKeys = [...secondary.keys()].sort();
  return { primaryKeys, primary: primaryKeys.map(key => primary.get(key)),
    secondaryKeys, secondary: secondaryKeys.map(key => secondary.get(key)),
    limitations: ['CROSS_RESOURCE_VALUE_UNDEFINED', 'CURRENT_RATE_NOT_REALIZED_OUTPUT',
      ...(snapshot.rooms.some(room => room.type === 'TRADING') ? ['TRADE_ORDER_VALUE_UNDEFINED'] : [])] };
}
