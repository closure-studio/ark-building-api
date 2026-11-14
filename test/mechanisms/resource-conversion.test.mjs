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
  const chars = ['char_2027_wang', 'char_4078_bdhkgt', 'char_473_mberry', 'char_455_nothin', 'char_2025_shu'];
  const rooms = [['c', 'CONTROL', [1]], ['m', 'MANUFACTURE', [2, 5]], ['h', 'HIRE', [3]], ['t', 'TRADING', [4]], ['d', 'DORMITORY', []]]
    .map(([slot, type, occupants]) => ({ slot, type, occupants, level: 3, capacity: 3, formulaId: '4' }));
  const snapshot = { rooms, reservedIds: [], operators: chars.map((charId, i) => ({ instId: i + 1, charId, evolvePhase: 2, level: 1, ap: 4320000 })),
    facilities: rooms.map(r => ({ slot: r.slot, type: r.type, level: r.level, state: 2 })) };
  return { snapshot, assignment: Object.fromEntries(rooms.map(r => [r.slot, [...r.occupants]])) };
}

test('望按实际设施比较，相等走贸易、实地更多走制造，不依赖站内人数', () => {
  const { snapshot, assignment } = fixture();
  const first = evaluateModifiers(snapshot, assignment, catalog);
  close(first.rooms.t.orderSpeed, 0.27);
  close(first.rooms.m.production, 0.14);
  snapshot.rooms.push({ slot: 'm2', type: 'MANUFACTURE', level: 1, capacity: 1, occupants: [] });
  assignment.m2 = [];
  const second = evaluateModifiers(snapshot, assignment, catalog);
  close(second.rooms.t.orderSpeed, 0.2);
  close(second.rooms.m.production, 0.16);
  snapshot.rooms.push({ slot: 'p', type: 'POWER', level: 1, capacity: 1, occupants: [] });
  assignment.p = [];
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.27);
  assert.deepEqual(evaluateModifiers({ ...snapshot, rooms: [...snapshot.rooms].reverse() }, assignment, catalog).rooms,
    evaluateModifiers(snapshot, assignment, catalog).rooms);
});

test('截云转化不消耗烟火，先全局汇总后取整；精英替换及来源离岗无残留', () => {
  const { snapshot, assignment } = fixture();
  assignment.c = [];
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  close(evaluate(assignment).rooms.m.production, 0.14);
  const shifted = { ...assignment, m: [2], d: [5] };
  close(evaluate(shifted).rooms.m.production, 0.08);
  close(evaluate(shifted).rooms.t.orderSpeed, 0.21);
  close(evaluate({ ...shifted, h: [] }).rooms.m.production, 0);
  close(evaluate(assignment).rooms.m.production, 0.14);
  snapshot.operators[1].evolvePhase = 0;
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.m.production, 0.1);
});

test('感知资源两级转换：双宿舍人数源相加，梦境先转感知再供制造和贸易消费', () => {
  const { snapshot, assignment } = fixture();
  snapshot.operators[1].charId = 'char_391_rosmon';
  snapshot.operators[3].charId = 'char_4046_ebnhlz';
  snapshot.operators[4].charId = 'char_338_iris';
  assignment.c = []; assignment.h = []; assignment.m = [2]; assignment.d = [5];
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const result = evaluate(assignment);
  close(result.rooms.m.production, 0.05); // 两个宿舍人数源共2，三级梦境+3。
  close(result.rooms.t.orderSpeed, 0.02);
  close(result.operators[5].moodRecovery, 0.1);
  close(evaluate({ ...assignment, d: [] }).rooms.m.production, 0);
  close(evaluate({ ...assignment, t: [] }).rooms.m.production, 0.04);
  assert.deepEqual(evaluate(assignment), result);
  assert.deepEqual(evaluateModifiers({ ...snapshot, rooms: [...snapshot.rooms].reverse() }, assignment, catalog).rooms, result.rooms);
});

test('夕令12点边界跨资源切换，令消除夕自耗，离岗与恢复无缓存残留', () => {
  const { snapshot, assignment } = fixture();
  snapshot.operators[0].charId = 'char_2015_dusk';
  snapshot.operators[1].charId = 'char_391_rosmon';
  snapshot.operators[2].charId = 'char_2023_ling';
  assignment.c = [1, 3]; assignment.h = []; assignment.m = [2, 5]; assignment.d = [];
  for (const [duskAp, lingAp, production, trade] of [
    [4320000, 4320000, 0.15, 0.15], [4320001, 4320000, 0.2, 0],
    [4320000, 4320001, 0.1, 0.3], [4320001, 4320001, 0.15, 0.15],
  ]) {
    snapshot.operators[0].ap = duskAp; snapshot.operators[2].ap = lingAp;
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const result = evaluate(assignment);
    close(result.rooms.m.production, production);
    close(result.rooms.t.orderSpeed, trade);
    assert.equal(result.operators[1].moodCost, undefined); // 自耗被消除，不保留零值效果。
    close(result.operators[1].moodRecovery, 0.05);
    const withoutLing = evaluate({ ...assignment, c: [1] });
    close(withoutLing.operators[1].moodCost, 0.5);
    close(withoutLing.rooms.m.production, duskAp > 4320000 ? 0.1 : 0.05);
    assert.deepEqual(evaluate(assignment), result);
  }
  assert.throws(() => evaluateModifiers(snapshot, assignment, { ...catalog, manpowerDisplayFactor: undefined }),
    { code: 'MISSING_MECHANISM_STATE' });
});

test('重岳计入自身与训练/加工岁成员，排除宿舍，心情外派加成按整项取高', () => {
  const { snapshot, assignment } = fixture();
  snapshot.operators[0].charId = 'char_2024_chyue';
  assignment.m = [5]; assignment.h = []; // 黍在制造站，重岳在中枢。
  const original = createIsolatedEvaluator(snapshot, catalog);
  const result = original(assignment);
  close(result.rooms.m.production, 0.03);
  close(result.rooms.t.orderSpeed, 0.1);
  close(result.operators[1].moodCost, 0.5);
  close(result.operators[5].moodRecovery, 0.05);
  close(original({ ...assignment, m: [], d: [5] }).rooms.t.orderSpeed, 0.06);
  assert.deepEqual(original(assignment), result);
  for (const [instId, charId, type] of [[6, 'char_2014_nian', 'WORKSHOP'], [7, 'char_2027_wang', 'TRAINING']]) {
    snapshot.operators.push({ instId, charId, evolvePhase: 2, level: 1, ap: 4320000, roomSlotId: type });
    snapshot.reservedIds.push(instId);
    snapshot.facilities.push({ slot: type, type, state: 2, level: 3 });
  }
  const reserved = evaluateModifiers(snapshot, assignment, catalog);
  close(reserved.rooms.t.orderSpeed, 0.2);
  close(reserved.operators[5].moodRecovery, 0.1);
  snapshot.operators.push(
    { instId: 8, charId: 'char_4134_cetsyr', evolvePhase: 2, level: 1, ap: 4320000 },
    { instId: 9, charId: 'char_1035_wisdel', evolvePhase: 2, level: 1, ap: 4320000 });
  assignment.c.push(8, 9);
  const combined = evaluateModifiers(snapshot, assignment, catalog);
  close(combined.operators[5].moodRecovery, 0.2); // 巴别塔0.2 vs 重岳0.1，不叠加成0.3。
  assert.equal(combined.operators[1].moodRecovery, undefined); // 外派加成不作用于中枢。
  assert.equal(combined.operators[6].moodRecovery, undefined);
  assert.equal(combined.operators[7].moodRecovery, undefined);
  assert.throws(() => evaluateModifiers(snapshot, assignment, { ...catalog, characterAffiliations: {} }),
    { code: 'MISSING_MECHANISM_STATE' });
});

test('重岳工作区岁人数最多五名，候选移至宿舍后立即降档', () => {
  const { snapshot, assignment } = fixture();
  snapshot.operators[0].charId = 'char_2024_chyue';
  assignment.c = [1]; assignment.m = [5]; assignment.h = [];
  for (const [index, charId] of ['char_2014_nian', 'char_2015_dusk', 'char_2023_ling', 'char_2027_wang'].entries()) {
    const instId = 6 + index;
    snapshot.operators.push({ instId, charId, evolvePhase: 2, level: 1, ap: 4320000, roomSlotId: `train${index}` });
    snapshot.reservedIds.push(instId);
    snapshot.facilities.push({ slot: `train${index}`, type: 'TRAINING', level: 3, state: 2 });
  }
  // 多个训练槽只是求值上限夹具，不冒充合法玩家布局。
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.25);
  snapshot.reservedIds = snapshot.reservedIds.slice(0, 2);
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.2);
  close(evaluateModifiers(snapshot, { ...assignment, m: [], d: [5] }, catalog).rooms.t.orderSpeed, 0.16);
});

test('重岳触发房与外派恢复目标互相冻结，不能移动成员改变未求值房间', () => {
  const { snapshot } = fixture();
  snapshot.operators[0].charId = 'char_2024_chyue';
  snapshot.operators.push({ instId: 6, charId: 'char_1050_chen3', evolvePhase: 2, level: 1, ap: 4320000 });
  snapshot.rooms.push({ slot: 'r', type: 'MEETING', capacity: 2, level: 3, occupants: [6] });
  const withoutBaseCost = { ...catalog, controlData: { basicCostBuff: 0 } };
  assert.deepEqual(planIsolation(snapshot, withoutBaseCost).frozenSlots, ['c', 'd', 'h', 'm', 'r', 't']);
});

test('转化资源的来源、消费者和宿舍触发房进入同一隔离闭包', () => {
  const { snapshot } = fixture();
  snapshot.operators.push({ instId: 6, charId: 'char_1050_chen3', evolvePhase: 2, level: 1, ap: 4320000 });
  snapshot.rooms.push({ slot: 'r', type: 'MEETING', capacity: 2, level: 3, occupants: [6] });
  assert.deepEqual(planIsolation(snapshot, catalog).frozenSlots, ['c', 'd', 'h', 'm', 'r', 't']);
});
