import { skillRegistry } from '../mechanisms/registry.mjs';
import { unlockedBuffs } from '../data/catalog.mjs';
import { projectNewOrderObjective } from './new-orders.mjs';

const speed = (stat, value, extra = {}) => ({ stat, scope: 'room', value, stacking: 'sum', ...extra });
const clue = value => speed('clueSpeed', value);
const mood = (value, scope = 'occupants') => speed('moodCost', value, { scope });
// 只投影已核对的ID；描述和房型指纹继续由原registry校验，未知类别概率不生成数值。
const clueEffects = {
  'control_clue_cost[000]': [mood(1.5)],
  'control_clue_cost[010]': [mood(0.5)],
  'control_clue_cost[011]': [],
  'control_clue_cost&faction[990]': [mood(0.25, 'otherOccupants')],
  'control_clue_faction[070]': [],
  'hire_spd&clue2[230]': [speed('contactSpeed', 0.2)],
  'hire_spd&clue2[250]': [speed('contactSpeed', 0.2)],
  'hire_spd&clue2[260]': [speed('contactSpeed', 0.2)],
  'meet_flag[010]': [], 'meet_flag[040]': [], 'meet_flag[050]': [],
  'meet_flag[060]': [], 'meet_flag[070]': [],
  'meet_spd_notOwned_P[000]': [clue(0.1)],
  'meet_spd_notOwned[000]': [], 'meet_spd_notOwned[001]': [],
  'meet_spd_notOwned[002]': [], 'meet_spd_notOwned[003]': [], 'meet_spd_notOwned[004]': [],
  'meet_spd_notOwned[010]': [clue(0.1)],
  'meet_spd_notOwned&exchange[000]': [], 'meet_spd_Owned[000]': [],
  'meet_spd&bd[010]': [clue(0.1), clue(0.15), mood(0.5, 'self')],
  'meet_spd&bd[999]': [clue(0.1)],
  'meet_spd&condChar_mustget[000]': [], 'meet_spd&condChar_mustget[100]': [],
  'meet_spd&team[010]': [clue(0.1)], 'meet_spd&team[020]': [clue(0.1)],
  'meet_spd&team[030]': [clue(0.1)], 'meet_spd&team[031]': [clue(0.1)],
  'meet_spd&team[040]': [clue(0.1)], 'meet_spd&team[041]': [clue(0.1)], 'meet_spd&team[050]': [clue(0.1)],
  'meet_spd&team[060]': [clue(0.1)], 'meet_spd&team[070]': [clue(0.1)], 'meet_spd&team[071]': [clue(0.1)],
  'meet_team[020]': [], 'meet_team[050]': [], 'meet_team[060]': [], 'meet_team[070]': [],
  'meet_team&char[000]': [],
};
// 伙伴只约束对应效果，不把未知类别偏好当作速度或资源。
const partners = {
  'meet_spd_notOwned_P[000]': ['char_1048_orchd2', '焰狐龙梓兰', 'CONTROL', [0]],
  'meet_spd&bd[010]': ['char_2012_typhon', '提丰', 'MEETING', [1, 2]],
};

const practicalRegistry = Object.fromEntries(Object.entries(skillRegistry).map(([id, entry]) => {
  if (Object.hasOwn(clueEffects, id)) {
    const effects = clueEffects[id].map(effect => ({ ...effect }));
    const partner = partners[id];
    if (partner) for (const index of partner[3]) Object.assign(effects[index], {
      partnerCharId: partner[0], partnerRoomType: partner[2],
    });
    return [id, { ...entry, effects, ...(partner ? { partnerNames: { [partner[0]]: partner[1] } } : {}),
      approximation: 'clue-type-preferences-not-scored' }];
  }
  if (entry.newOrderEffects) return [id, { ...entry,
    effects: entry.newOrderEffects.map(({ minimumWorkHours, ...steady }) => steady),
    approximation: 'steady-new-orders-after-warmup' }];
  return [id, entry];
}));

export function practicalModel(snapshot, catalog) {
  const goldOnly = snapshot.rooms.every(room => room.type !== 'TRADING' || room.strategy === 'O_GOLD');
  const registry = goldOnly ? practicalRegistry : Object.fromEntries(Object.entries(practicalRegistry)
    .map(([id, entry]) => [id, skillRegistry[id].newOrderEffects ? skillRegistry[id] : entry]));
  const relevant = snapshot.operators.flatMap(operator => unlockedBuffs(catalog, operator)
    .filter(buff => registry[buff.buffId]?.approximation
      && snapshot.rooms.some(room => room.type === buff.roomType))
    .map(buff => ({ instId: operator.instId, buffId: buff.buffId, roomType: buff.roomType,
      assumption: registry[buff.buffId].approximation })));
  const orders = relevant.some(row => row.assumption === 'steady-new-orders-after-warmup');
  return {
    registry,
    project: orders ? (assignment, modifiers, base) => {
      const { objective } = projectNewOrderObjective(snapshot, assignment, catalog, modifiers, base);
      const goldKey = 'item:3003:perHour';
      const produced = base.primary[base.primaryKeys.indexOf(goldKey)] ?? 0;
      const net = objective.primary[objective.primaryKeys.indexOf(goldKey)] ?? 0;
      // 净赤金与贸易收入天然反向；原料单列，避免阻止常规贸易提速。
      return { ...objective,
        primary: objective.primary.map((value, index) => objective.primaryKeys[index] === goldKey ? produced : value),
        resourceBalance: { goldProducedPerHour: produced, goldConsumedPerHour: produced - net, goldNetPerHour: net },
      };
    } : (_assignment, _modifiers, base) => base,
    select(candidates) {
      // 资源不可比时先让贸易站开工，再按龙门币产出选择；赤金消耗仍单列。
      const coverage = candidate => snapshot.rooms.filter(room => room.type === 'TRADING'
        && candidate.assignment[room.slot].length > 0).length;
      const covered = Math.max(...candidates.map(coverage));
      const income = candidate => candidate.score.primary[candidate.score.primaryKeys.indexOf('item:4001:perHour')] ?? 0;
      return candidates.filter(candidate => coverage(candidate) === covered)
        .reduce((best, candidate) => income(candidate) > income(best) ? candidate : best);
    },
    diagnostics(assignment) {
      const rooms = new Map(snapshot.rooms.map(room => [room.type, snapshot.rooms.filter(other => other.type === room.type)]));
      const skills = relevant.filter(row => rooms.get(row.roomType).some(room => assignment[room.slot].includes(row.instId)));
      return { mode: 'production-priority', exactCoverageUnchanged: true, skills,
        assumptions: [...new Set([...(orders ? ['steady-new-orders-after-warmup'] : []), ...skills.map(row => row.assumption)])],
        selection: 'staffed-trading-rooms-then-lmd-output',
        ...(orders ? { orderConditions: ['materials-available', 'orders-collected', 'not-full', 'stable-staff'],
          currentOrdersVerified: false } : {}) };
    },
  };
}
