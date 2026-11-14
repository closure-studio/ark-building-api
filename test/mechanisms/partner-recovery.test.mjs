import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator, evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';
import { evaluateMood } from '../../src/mechanisms/mood.mjs';
import { skillRegistry } from '../../src/mechanisms/registry.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture() {
  const operators = ['char_154_morgan', 'char_112_siege', 'char_157_dagda', 'char_501_durin'].map((charId, i) =>
    ({ instId: i + 1, charId, evolvePhase: 0, level: 1, ap: 3600000 }));
  const rooms = ['d', 'e'].map((slot, i) => ({ slot, type: 'DORMITORY', level: 3, capacity: 5,
    comfort: 0, occupants: i ? [] : [1, 2, 3, 4] }));
  return { snapshot: { operators, rooms, reservedIds: [], facilities: rooms.map(room => ({ ...room, state: 2 })) },
    assignment: { d: [1, 2, 3, 4], e: [] } };
}

test('摩根默认增强推进之王原贡献后与群体恢复取最高，不独立叠加也不增强自身恢复', () => {
  const { snapshot, assignment } = fixture();
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const result = evaluate(assignment);
  assert.deepEqual(result.diagnostics.frozenSlots, []);
  assert.deepEqual(result.diagnostics.excludedIds, []);
  assert.equal(result.diagnostics.mode, 'full');
  // 推进之王0.15+0.3胜过杜林0.2；非帮派目标仅收到杜林/推进之王原群体恢复。
  for (const [id, expected] of [[1, 0.45], [2, 0.45], [3, 0.45], [4, 0.1]]) near(result.operators[id].moodRecovery, expected);
  snapshot.operators[3].level = 30;
  const stronger = evaluateModifiers(snapshot, assignment, catalog);
  for (const id of [1, 2, 3]) near(stronger.operators[id].moodRecovery, 0.45);
  near(stronger.operators[4].moodRecovery, 0.15);
  snapshot.operators[1].evolvePhase = 2;
  const elite = evaluateModifiers(snapshot, assignment, catalog);
  for (const id of [1, 2, 3]) near(elite.operators[id].moodRecovery, 0.5);
  near(elite.operators[4].moodRecovery, 0.15);
});

test('恢复联动随候选分房、来源离岗、练度回退重算，复用求值不残留或修改输入', () => {
  const { snapshot, assignment } = fixture();
  const before = structuredClone({ snapshot, assignment });
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const original = evaluate(assignment);
  near(evaluate({ d: [2, 3, 4], e: [1] }).operators[3].moodRecovery, 0.2);
  near(evaluate({ d: [1, 3, 4], e: [2] }).operators[3].moodRecovery, 0.2);
  near(evaluate({ d: [3, 4], e: [1, 2] }).operators[3].moodRecovery, 0.2);
  near(evaluate({ d: [1, 3], e: [] }).operators[3].moodRecovery ?? 0, 0);
  near(evaluate({ d: [2, 3], e: [] }).operators[3].moodRecovery, 0.15);
  assert.deepEqual(evaluate(assignment), original);
  assert.deepEqual({ snapshot, assignment }, before);
  assert.deepEqual(evaluateModifiers({ ...snapshot, rooms: [...snapshot.rooms].reverse() },
    { d: [...assignment.d].reverse(), e: [] }, catalog).operators, original.operators);
});

test('恢复联动缺目标阵营拒绝，不把未知身份当非帮派；满心情仍被物理心情上限截断', () => {
  const { snapshot, assignment } = fixture();
  const affiliations = { ...catalog.characterAffiliations };
  delete affiliations[snapshot.operators[2].charId];
  assert.throws(() => evaluateModifiers(snapshot, assignment, { ...catalog, characterAffiliations: affiliations }),
    { code: 'MISSING_MECHANISM_STATE' });
  snapshot.operators[2].ap = 8640000;
  const result = evaluateModifiers(snapshot, assignment, catalog);
  near(result.operators[3].moodRecovery, 0.45);
  near(evaluateMood(snapshot, assignment, catalog, result)[3].changePerHour, 0);
});

test('摩根指纹漂移失去支持；合成局部边界冻结同宿舍不扩散到另一宿舍', () => {
  const { snapshot, assignment } = fixture();
  const id = 'dorm_rec_toone[000]';
  const drift = { ...catalog, buffs: { ...catalog.buffs, [id]: { ...catalog.buffs[id], description: catalog.buffs[id].description + '漂移' } } };
  assert.throws(() => planIsolation(snapshot, drift), { code: 'UNISOLATABLE_MECHANISM' });
  // 仅用测试登记强制一个局部冻结；不代表安赛尔的真实锁定恢复已支持或可局部隔离。
  snapshot.operators.push({ instId: 5, charId: 'char_212_ansel', evolvePhase: 0, level: 1, ap: 3600000 });
  snapshot.rooms[0].occupants.push(5);
  const registry = { ...skillRegistry, 'dorm_rec_single[010]': { ...skillRegistry['dorm_rec_single[010]'], isolation: 'local' } };
  const isolation = planIsolation(snapshot, catalog, registry);
  assert.deepEqual(isolation.frozenSlots, ['d']);
  const result = createIsolatedEvaluator(snapshot, catalog, registry)({ ...assignment, d: [1, 2, 3, 4, 5] });
  assert.deepEqual(result.unevaluated.slots, ['d']);
  assert.equal(result.operators[3], undefined);
});
