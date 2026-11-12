import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { productionObjective } from '../../src/solver/objective.mjs';
import { searchAssignments } from '../../src/solver/search.mjs';
import { arrangePreview } from '../../src/arrange.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const trio = ['char_4055_bgsnow', 'char_402_tuye', 'char_478_kirara'];
function player(charIds) {
  const input = syntheticPlayer(charIds);
  input.building.roomSlots.m2 = { roomId: 'MANUFACTURE', level: 1, state: 2, charInstIds: [] };
  input.building.rooms.MANUFACTURE.m2 = { formulaId: '4', capacity: 24 };
  input.building.roomSlots.t = { roomId: 'TRADING', level: 3, state: 2, charInstIds: [] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 10, stock: [] } };
  for (const [id, char] of Object.entries(input.troop.chars)) {
    char.evolvePhase = trio.includes(char.charId) ? 2 : 0;
    input.building.chars[id].ap = 8640000;
  }
  return input;
}
const rounded = values => values.map(v => Math.round(v * 1e10) / 1e10).join(',');

// 预期只用人工核对的两实线/零杜林公式，不调用登记、求值或搜索代码。
function oracle() {
  const scores = [];
  for (let mask = 0; mask < 5 ** 5; mask++) {
    let value = mask;
    const slots = Array.from({ length: 5 }, () => { const slot = value % 5; value = Math.floor(value / 5); return slot; });
    const count = slot => slots.filter(v => v === slot).length;
    if (count(1) > 1 || count(2) > 1 || count(3) > 3) continue;
    const lines = slots[2] === 3 ? 4 : 2;
    const bonus = (slots[0] === 3 ? lines * 0.05 : 0)
      + (slots[1] === 3 ? 0.05 + Math.floor(lines / 2) * 0.15 : 0)
      + (slots[2] === 3 ? 0.05 : 0);
    scores.push([1.01 * (count(1) + count(2)) * 5 / 6, count(3) ? 1 + 0.01 * count(3) + bonus : 0]);
  }
  return [...new Set(scores.filter(a => !scores.some(b => b.every((v, i) => v >= a[i]) && b.some((v, i) => v > a[i]))).map(rounded))].sort();
}

test('五人赤金生产链完整枚举对照独立oracle，不把跨资源分数相加', () => {
  const snapshot = normalize(player([...trio, 'char_286_cast3', 'char_285_medic2']), catalog);
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const result = searchAssignments(snapshot, catalog, a => productionObjective(snapshot, a, catalog, evaluate(a)));
  assert.equal(result.exhausted, true);
  assert.deepEqual([...new Set(result.frontier.map(r => rounded(r.score.primary)))].sort(), oracle());
  assert.deepEqual(oracle(), ['1.6833333333,1.63']);
  assert.ok(result.frontier.some(r => [...r.assignment.t].sort().join(',') === '1,2,3'));
});

for (const ids of [[...trio, 'char_286_cast3', 'char_285_medic2'], ['char_286_cast3', 'char_285_medic2', ...trio]]) {
  test(`默认预算主动组建赤金班组，不依赖成员ID或已有正确原岗（${ids[0]}）`, () => {
    const input = player(ids);
    const before = structuredClone(input);
    const result = arrangePreview(input, catalog, { maxNodes: 2000 });
    assert.deepEqual(result.preview.arranged.Trading[0].RoomChar.map(c => c.Char).sort(), [...trio].sort());
    assert.ok(result.preview.arranged.Manufacture.every(r => r.RoomChar.length === 1));
    assert.deepEqual(result.diagnostics.frozenSlots, []);
    assert.deepEqual(result.diagnostics.excludedIds, []);
    assert.equal(rounded(result.diagnostics.objective.primary), '1.6833333333,1.63');
    assert.deepEqual(input, before);
  });
}

const orders = [trio, [trio[0], trio[2], trio[1]], [trio[1], trio[0], trio[2]],
  [trio[1], trio[2], trio[0]], [trio[2], trio[0], trio[1]], [...trio].reverse()];
for (const order of orders) {
  for (const occupied of [false, true]) {
    test(`八十人候选池默认预算组齐赤金组合：${order.join('/')}，原岗${occupied}`, () => {
      const input = player([...Array(77).fill('char_286_cast3'), ...order]);
      if (occupied) {
        for (const [slot, ids] of Object.entries({ m: [78], m2: [79], d: [80], t: [1, 2, 3] })) {
          input.building.roomSlots[slot].charInstIds = ids;
          for (const id of ids) input.building.chars[id].roomSlotId = slot;
        }
      }
      const before = structuredClone(input);
      const result = arrangePreview(input, catalog, { maxNodes: 2000 });
      assert.deepEqual(result.preview.arranged.Trading[0].RoomChar.map(c => c.Char).sort(), [...trio].sort());
      assert.equal(rounded(result.diagnostics.objective.primary), '1.6833333333,1.63');
      assert.equal(result.diagnostics.search.exhausted, false);
      assert.ok(result.diagnostics.search.nodes <= 2000);
      assert.deepEqual(result.diagnostics.frozenSlots, []);
      assert.deepEqual(result.diagnostics.excludedIds, []);
      assert.deepEqual(input, before);
    });
  }
}

test('人手不足时明确保留跨资源不可比，不把空制造站方案说成收益最优', () => {
  const result = arrangePreview(player(trio), catalog, { maxNodes: 2000 });
  assert.ok(result.diagnostics.search.incomparableAlternatives > 1);
  assert.equal(result.diagnostics.search.selection, 'stable-preview-not-value-optimum');
  assert.ok(result.diagnostics.objective.limitations.includes('CROSS_RESOURCE_VALUE_UNDEFINED'));
});
