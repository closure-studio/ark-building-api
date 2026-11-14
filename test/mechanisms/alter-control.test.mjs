import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';
import { evaluateMood } from '../../src/mechanisms/mood.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture() {
  const names = ['炎狱炎熔', '寒芒克洛丝', '濯尘芙蓉', '浊心斯卡蒂', '斯卡蒂'];
  const operators = names.map((name, index) => ({ instId: index + 1,
    charId: Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name),
    evolvePhase: 0, level: 1, ap: 4320000 }));
  assert.ok(operators.every(operator => operator.charId));
  const rooms = [
    { slot: 'c', type: 'CONTROL', level: 5, capacity: 5, occupants: [1, 2, 3, 4, 5] },
    { slot: 'd', type: 'DORMITORY', level: 1, capacity: 5, comfort: 0, occupants: [] },
  ];
  const snapshot = { operators, rooms, reservedIds: [], facilities: rooms.map(room => ({ ...room, state: 2 })) };
  return { snapshot, assignment: { c: [1, 2, 3, 4, 5], d: [] } };
}

test('三名真实异格来源叠加，含自身；原版不计、全中枢人员受益', () => {
  const { snapshot, assignment } = fixture();
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const result = evaluate(assignment);
  for (const id of assignment.c) close(result.operators[id].moodRecovery, 0.6);
  const mood = evaluateMood(snapshot, assignment, catalog, result);
  for (const id of assignment.c) close(mood[id].changePerHour, -0.15);
  const reversed = evaluate({ c: [...assignment.c].reverse(), d: [] });
  assert.deepEqual(reversed.operators, result.operators);
  assert.deepEqual(evaluate(assignment), result);
});

test('单一来源也计自身，异格离开中枢或来源离岗不残留计数', () => {
  const { snapshot } = fixture();
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  close(evaluate({ c: [1, 5], d: [] }).operators[1].moodRecovery, 0.05);
  const shared = evaluate({ c: [1, 4, 5], d: [] });
  close(shared.operators[5].moodRecovery, 0.1);
  close(evaluate({ c: [1, 5], d: [4] }).operators[5].moodRecovery, 0.05);
  assert.equal(evaluate({ c: [4, 5], d: [1] }).operators[5].moodRecovery, undefined);
  assert.deepEqual(evaluate({ c: [1, 4, 5], d: [] }), shared);
});

test('异格名单缺失明确拒绝，不把未知身份当零人', () => {
  const { snapshot, assignment } = fixture();
  assert.throws(() => createIsolatedEvaluator(snapshot, { ...catalog, operatorGroups: {} })(assignment),
    { code: 'MISSING_MECHANISM_STATE' });
});

test('真实异格组合不再被隔离为未知全局机制', () => {
  const { snapshot } = fixture();
  const plan = planIsolation(snapshot, catalog);
  assert.equal(plan.mode, 'full');
  assert.deepEqual(plan.frozenSlots, []);
  assert.deepEqual(plan.excludedIds, []);
});
