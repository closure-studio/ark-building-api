import { DataError, unlockedBuffs } from '../data/catalog.mjs';
import { skillRegistry } from '../mechanisms/registry.mjs';
import { registeredSkill } from '../mechanisms/compile.mjs';
import { evaluateModifiers, MechanismError } from '../mechanisms/evaluate.mjs';
import { evaluateMood } from '../mechanisms/mood.mjs';
import { projectGoldOrders } from '../mechanisms/gold-orders.mjs';
import { productionObjective } from './objective.mjs';
import { SearchError } from './search.mjs';
import { evaluateConfirmedStateCandidate } from './confirmed-state.mjs';

const registry = Object.fromEntries(Object.entries(skillRegistry).map(([id, entry]) => [id,
  entry.newOrderEffects ? { ...entry, effects: entry.newOrderEffects } : entry]));

/** 内部条件求值；调用者必须声明新订单稳定情景，默认HTTP和求解入口不启用。 */
export function evaluateNewOrderCandidate(snapshot, assignment, catalog, scenario, confirmedState) {
  if (scenario !== 'steady-new-gold-orders') throw new SearchError('ORDER_SCENARIO_REQUIRED', 422);
  if (snapshot.rooms.some(room => room.type === 'TRADING' && room.strategy !== 'O_GOLD')) {
    throw new SearchError('ORDER_STRATEGY_UNSUPPORTED', 422);
  }
  // 在按房型筛选前拒绝已知技能漂移，避免错房数据被误当成无关技能跳过。
  const assigned = new Set(Object.values(assignment).flat());
  for (const operator of snapshot.operators.filter(value => assigned.has(value.instId))) {
    for (const buff of unlockedBuffs(catalog, operator)) {
      if (Object.hasOwn(registry, buff.buffId) && !registeredSkill(buff, registry)) throw new MechanismError(buff.buffId);
    }
  }
  const stateResult = confirmedState === undefined ? null
    : evaluateConfirmedStateCandidate(snapshot, assignment, catalog, confirmedState, registry);
  const modifiers = stateResult?.modifiers ?? evaluateModifiers(snapshot, assignment, catalog, registry);
  const mood = stateResult?.mood ?? evaluateMood(snapshot, assignment, catalog, modifiers);
  const base = stateResult?.objective ?? productionObjective(snapshot, assignment, catalog, modifiers);
  const primary = new Map(base.primaryKeys.flatMap((key, i) =>
    key === 'no-production' || key.startsWith('trading:') ? [] : [[key, base.primary[i]]]));
  const rooms = {};
  for (const room of snapshot.rooms.filter(room => room.type === 'TRADING')) {
    const count = assignment[room.slot].length;
    const bonus = modifiers.rooms[room.slot];
    const speed = catalog.tradingData?.phases?.[room.level - 1]?.orderSpeed
      + count * catalog.tradingData?.basicSpeedBuff + (bonus.orderSpeed ?? 0);
    rooms[room.slot] = count ? projectGoldOrders({ level: room.level, speed,
      closure: Boolean(bonus.newOrderClosure), pepe: Boolean(bonus.newOrderPepe),
      forceTwo: Boolean(bonus.newOrderForceTwo), breach: Boolean(bonus.newOrderBreach),
      breachExtra: bonus.newOrderBreachExtra ?? 0, investment: bonus.newOrderInvestment ?? 0 })
      : { orders: [], lmdPerHour: 0, goldPerHour: 0 };
    const { lmdPerHour, goldPerHour } = rooms[room.slot];
    primary.set('item:4001:perHour', (primary.get('item:4001:perHour') ?? 0) + lmdPerHour);
    primary.set('item:3003:perHour', (primary.get('item:3003:perHour') ?? 0) - goldPerHour);
  }
  if (!primary.size) primary.set('no-production', 0);
  if (![...primary.values()].every(Number.isFinite)) throw new DataError();
  const primaryKeys = [...primary.keys()].sort();
  return { scenario, rooms, modifiers, mood,
    ...(stateResult ? { clueGuarantees: stateResult.clueGuarantees, trainingSpeedBonus: stateResult.trainingSpeedBonus } : {}),
    objective: { ...base,
    primaryKeys, primary: primaryKeys.map(key => primary.get(key)),
    limitations: [...base.limitations.filter(value => value !== 'TRADE_ORDER_VALUE_UNDEFINED'),
      'ORDER_TIMING_UNCONFIRMED', 'STEADY_NEW_ORDERS_ONLY', 'CONTINUOUS_DELIVERY_AND_GOLD_SUPPLY_ASSUMED'] } };
}
