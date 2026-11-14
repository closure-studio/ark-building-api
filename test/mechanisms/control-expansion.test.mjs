import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator, evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture() {
  const buffs = ['control_mp_lonely[000]', 'control_mp_cost[000]', 'control_mp_cost[001]', 'control_mp_cost&bd1[000]', 'control_mp_expand_double[000]'];
  const chars = Object.fromEntries(buffs.map((buffId, i) => [`test${i}`, { maxManpower: 8640000,
    buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] }]));
  chars.plain = { maxManpower: 8640000, buffChar: [] };
  const rooms = ['CONTROL', 'POWER', 'HIRE', 'MEETING', 'MANUFACTURE', 'TRADING', 'DORMITORY']
    .map((type, i) => ({ slot: type, type, level: 3, capacity: 5, occupants: i === 0 ? [1, 2, 3, 4] : [i + 5] }));
  const snapshot = { rooms, reservedIds: [], operators: Array.from({ length: 11 }, (_, i) => ({ instId: i + 1,
    charId: i < 5 ? `test${i}` : 'plain', evolvePhase: 0, level: 1, ap: 4320001 })) };
  return { snapshot, assignment: Object.fromEntries(rooms.map(r => [r.slot, r.occupants])), data: { ...catalog, chars } };
}

test('公事公办只扩展指定技能，基础与扩展先相加后比较，不把夕的同值恢复算作指定技能', () => {
  const { snapshot, assignment, data } = fixture();
  const evaluate = createIsolatedEvaluator(snapshot, data);
  const result = evaluate(assignment);
  close(result.operators[6].moodRecovery, 0.2);
  close(result.operators[9].moodRecovery, 0.1);
  close(result.operators[1].moodRecovery, 0.15);
  assert.deepEqual(result.operators[11], {});
  const combined = evaluate({ ...assignment, CONTROL: [1, 2, 3, 4, 5] });
  close(combined.operators[6].moodRecovery, 0.2); // 不是 max(0.1,0.1)+0.1，也不是0.3。
  close(combined.operators[9].moodRecovery, 0.1);
  const removed = evaluate({ ...assignment, CONTROL: [2, 3, 4] });
  assert.deepEqual(removed.operators[6], {});
  assert.deepEqual(evaluate(assignment), result);
  assert.deepEqual(evaluateModifiers(snapshot, { ...assignment, CONTROL: [4, 3, 2, 1] }, data).operators, result.operators);
});

test('指定技能离岗或尚未解锁不扩展，重复同名来源按实际来源计数', () => {
  const { snapshot, assignment, data } = fixture();
  close(evaluateModifiers(snapshot, { ...assignment, CONTROL: [1, 4] }, data).operators[6].moodRecovery, 0.1);
  snapshot.operators[2].charId = 'test1';
  close(evaluateModifiers(snapshot, assignment, data).operators[6].moodRecovery, 0.2);
  data.chars.test1.buffChar[0].buffData[0].cond.phase = 2;
  close(evaluateModifiers(snapshot, assignment, data).operators[6].moodRecovery, 0.1);
});

test('公事公办保护外派房间与触发中枢，冻结闭包不依赖基础中枢减耗', () => {
  const { snapshot, data } = fixture();
  snapshot.operators[1].charId = 'unknown';
  data.chars.unknown = { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: 'meet_flag[010]', cond: { phase: 0, level: 1 } }] }] };
  const plan = planIsolation(snapshot, { ...data, controlData: { basicCostBuff: 0 } });
  assert.ok(plan.excludedIds.includes(2));
  assert.deepEqual(plan.frozenSlots, ['CONTROL', 'HIRE', 'MANUFACTURE', 'MEETING', 'POWER', 'TRADING']);
});
