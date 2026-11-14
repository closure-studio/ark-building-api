import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers, createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture(names, control) {
  const input = syntheticPlayer([...names, ...(control ? [control] : [])].map(name => {
    const id = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name);
    assert.ok(id, name); return id;
  }));
  for (const id of Object.keys(input.troop.chars)) {
    input.troop.chars[id].evolvePhase = 2;
    input.building.chars[id].ap = 8640000;
  }
  input.building.roomSlots.m = { roomId: 'TRADING', level: 3, state: 2, charInstIds: [] };
  delete input.building.rooms.MANUFACTURE;
  input.building.rooms.TRADING = { m: { strategy: 'O_GOLD', stockLimit: 10, stock: [] } };
  const assignment = { m: names.map((_, i) => i + 1), d: [] };
  if (control) {
    input.building.roomSlots.c = { roomId: 'CONTROL', level: 3, state: 2, charInstIds: [] };
    assignment.c = [names.length + 1];
  }
  return { input, assignment };
}
test('孑精一保留精零技能；库存效率与空位效率组合，不把精零patch掉', () => {
  const f = fixture(['孑']);
  for (const stock of [0, 3, 10, 0]) {
    f.input.building.rooms.TRADING.m.stock = Array(stock).fill({});
    const snapshot = normalize(f.input, catalog);
    const result = createIsolatedEvaluator(snapshot, catalog)(f.assignment);
    near(result.rooms.m.orderSpeed, 0.4);
    assert.deepEqual(result.diagnostics.excludedIds, []);
    assert.deepEqual(result.diagnostics.frozenSlots, []);
  }
});
test('孑银灰琳琅诗怀雅与灵知独立组合算例129%，容量派生不反向参与扣上限', () => {
  const f = fixture(['孑', '银灰', '琳琅诗怀雅'], '灵知');
  const snapshot = normalize(f.input, catalog);
  for (const order of [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]) {
    const result = evaluateModifiers(snapshot, { ...f.assignment, m: order }, catalog);
    near(result.rooms.m.capacity, 8);
    near(result.rooms.m.orderSpeed, 1.29);
  }
});
test('阿米娅全局7%不是房内干员效率，不额外扣订单上限', () => {
  const f = fixture(['孑', '能天使'], '阿米娅');
  const result = evaluateModifiers(normalize(f.input, catalog), f.assignment, catalog);
  near(result.rooms.m.capacity, -3);
  near(result.rooms.m.orderSpeed, 0.7);
});
test('市井之道优先于单独天道酬勤，雪雉仅放大其他贡献且不重复计算', () => {
  for (const [names, expected, capacity] of [
    [['孑', '雪雉'], 0.4, 0],
    [['孑', '雪雉', '银灰'], 0.8, 0],
  ]) {
    const f = fixture(names);
    const snapshot = normalize(f.input, catalog);
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const first = evaluate(f.assignment);
    near(first.rooms.m.orderSpeed, expected);
    near(first.rooms.m.capacity ?? 0, capacity);
    evaluate({ ...f.assignment, m: [] });
    assert.deepEqual(evaluate(f.assignment), first);
  }
});
test('扣容量按完整10%分档，下限1；精零回退移除市井之道', () => {
  const f = fixture(['孑', '能天使', '德克萨斯']);
  const snapshot = normalize(f.input, catalog);
  const result = evaluateModifiers(snapshot, f.assignment, catalog);
  near(result.rooms.m.capacity, -3);
  near(result.rooms.m.orderSpeed, 0.63);
  f.input.building.rooms.TRADING.m.stock = Array(8).fill({});
  const aboveLimit = evaluateModifiers(normalize(f.input, catalog), f.assignment, catalog);
  near(aboveLimit.rooms.m.capacity, -3);
  near(aboveLimit.rooms.m.orderSpeed, 0.67);
  f.input.building.rooms.TRADING.m.stock = [];
  f.input.troop.chars[1].evolvePhase = 0;
  const original = evaluateModifiers(normalize(f.input, catalog), f.assignment, catalog);
  near(original.rooms.m.capacity ?? 0, 0);
  near(original.rooms.m.orderSpeed, 0.75);
  const limited = fixture(['孑', '能天使', '锏']);
  const floor = evaluateModifiers(normalize(limited.input, catalog), limited.assignment, catalog);
  near(floor.rooms.m.capacity, -9);
  near(floor.rooms.m.orderSpeed, 0.64);
});
