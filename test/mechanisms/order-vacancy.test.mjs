import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture(buffIds = []) {
  const data = { ...catalog, chars: { ...catalog.chars, partner: { maxManpower: 8640000,
    buffChar: buffIds.map(buffId => ({ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] })) } } };
  const snapshot = { operators: [
    { instId: 1, charId: 'char_272_strong', evolvePhase: 0, level: 1, ap: 4320000 },
    { instId: 2, charId: 'partner', evolvePhase: 0, level: 1, ap: 4320000 },
  ], reservedIds: [], rooms: [
    { slot: 't', type: 'TRADING', level: 3, capacity: 3, strategy: 'O_GOLD', stockCount: 2, stockLimit: 999, occupants: [1, 2] },
    { slot: 'd', type: 'DORMITORY', level: 1, capacity: 5, comfort: 0, occupants: [] },
  ] };
  return { data, snapshot, assignment: { t: [1, 2], d: [] } };
}

test('精零孑按候选基础容量及队友增量计算差额，不沿用原岗stockLimit', () => {
  const { data, snapshot, assignment } = fixture(['trade_ord_limit&cost[000]']);
  const evaluate = createIsolatedEvaluator(snapshot, data);
  const result = evaluate(assignment);
  close(result.rooms.t.orderSpeed, 0.52); // (10 + 5 - 2) * 4%
  close(result.rooms.t.capacity, 5);
  close(evaluate({ t: [1], d: [2] }).rooms.t.orderSpeed, 0.32);
  assert.equal(evaluate({ t: [2], d: [1] }).rooms.t.orderSpeed, undefined);
  assert.deepEqual(evaluate(assignment), result);
  assert.deepEqual(evaluate({ t: [2, 1], d: [] }).rooms, result.rooms);
});

test('精零孑逐房间读取库存，满库存无加成且房间等级变化重算', () => {
  for (const [level, stockCount, expected] of [[1, 0, 0.24], [2, 3, 0.2], [3, 10, 0]]) {
    const { data, snapshot, assignment } = fixture();
    Object.assign(snapshot.rooms[0], { level, stockCount });
    close(createIsolatedEvaluator(snapshot, data)(assignment).rooms.t.orderSpeed, expected);
  }
});

test('精零孑缺库存或基础容量不能按零估算', () => {
  for (const stockCount of [undefined, -1, NaN, 0.5]) {
    const { data, snapshot, assignment } = fixture();
    snapshot.rooms[0].stockCount = stockCount;
    assert.throws(() => createIsolatedEvaluator(snapshot, data)(assignment), { code: 'MISSING_MECHANISM_STATE' });
  }
  const { data, snapshot, assignment } = fixture();
  delete data.tradingData;
  assert.throws(() => createIsolatedEvaluator(snapshot, data)(assignment), { code: 'MISSING_MECHANISM_STATE' });
});

test('完整孑与焰狐龙梓兰按统一容量计差额，反序与离岗不残留', () => {
  const { snapshot, assignment } = fixture();
  snapshot.operators[1].charId = 'char_1048_orchd2';
  snapshot.operators[1].evolvePhase = 2;
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const result = evaluate(assignment);
  close(result.rooms.t.capacity, 3);
  close(result.rooms.t.orderSpeed, 0.64); // (10 + 3 - 2) * 4% + 20%
  assert.deepEqual(evaluate({ t: [2, 1], d: [] }).rooms, result.rooms);
  close(evaluate({ t: [1], d: [2] }).rooms.t.orderSpeed, 0.32);
  assert.deepEqual(evaluate(assignment), result);
});

test('精一孑仍须隔离完整未知叠加，不能因精零技能已实现而放行', () => {
  const { data, snapshot } = fixture();
  snapshot.operators[0].evolvePhase = 1;
  assert.throws(() => planIsolation(snapshot, data), { code: 'UNISOLATABLE_MECHANISM' });
});
