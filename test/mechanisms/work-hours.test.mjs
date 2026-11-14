import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers, createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const cases = [
  ['manu_prod_cost_min[001]', 'production', 0],
  ['manu_prod_spd_addition[030]', 'production', 0.2],
  ['manu_prod_spd_addition[031]', 'production', 0.2],
  ['manu_prod_spd_addition[040]', 'production', 0.15],
  ['manu_prod_spd_addition[041]', 'production', 0.15],
  ['manu_prod_spd_addition[100]', 'production', 0],
  ['meet_spd_hast[000]', 'clueSpeed', 0.2],
  ['power_rec_spd&addition[000]', 'droneSpeed', 0.1],
  ['power_rec_spd&addition[001]', 'droneSpeed', 0.15],
];
function fixture(buffId) {
  const charId = 'char_285_medic2';
  const type = catalog.buffs[buffId].roomType;
  const data = { ...catalog, chars: { ...catalog.chars, [charId]: { ...catalog.chars[charId],
    buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] } } };
  const input = syntheticPlayer([charId, 'char_286_cast3']);
  input.building.chars[1].ap = 8640000;
  input.building.roomSlots.m = { roomId: type, level: 3, state: 2, charInstIds: [] };
  return { input, data };
}
for (const [id, stat, initial] of cases) test(`新入驻暖机第一小时，不虚构保留历史：${id}`, () => {
  const f = fixture(id);
  // 名字相似的额外字段不得成为默认历史证据。
  f.input.building.chars[1].workTime = 99999999;
  f.input.building.chars[1].completedWorkHours = 99;
  const snapshot = normalize(f.input, f.data);
  const before = structuredClone(snapshot);
  const evaluate = createIsolatedEvaluator(snapshot, f.data);
  assert.equal(evaluate({ m: [1], d: [2] }).rooms.m[stat], initial);
  evaluate({ m: [], d: [1, 2] });
  assert.equal(evaluate({ m: [1], d: [2] }).rooms.m[stat], initial);
  assert.deepEqual(snapshot, before);
  f.input.building.roomSlots.m.charInstIds = [1];
  f.input.building.chars[1].roomSlotId = 'm';
  const retained = normalize(f.input, f.data);
  assert.deepEqual(planIsolation(retained, f.data).frozenSlots, ['m']);
  assert.throws(() => evaluateModifiers(retained, { m: [1], d: [] }, f.data), { code: 'MISSING_MECHANISM_STATE' });
});
test('协议无法保留冻结房内的前置空位时拒绝，不能压缩后冒充保留', () => {
  const f = fixture('manu_prod_spd_addition[030]');
  f.input.building.roomSlots.m.charInstIds = [-1, 1];
  f.input.building.chars[1].roomSlotId = 'm';
  assert.throws(() => planIsolation(normalize(f.input, f.data), f.data), { code: 'UNISOLATABLE_MECHANISM' });
  f.input.building.roomSlots.m.charInstIds = [1, -1];
  assert.deepEqual(planIsolation(normalize(f.input, f.data), f.data).frozenSlots, ['m']);
});
test('同房换位/跨房重置；含空座位时不把压缩后序号当作原位置', () => {
  const f = fixture('manu_prod_spd_addition[030]');
  f.input.building.roomSlots.m.charInstIds = [2, 1];
  f.input.building.chars[1].roomSlotId = 'm';
  f.input.building.chars[2].roomSlotId = 'm';
  let snapshot = normalize(f.input, f.data);
  assert.equal(evaluateModifiers(snapshot, { m: [1, 2], d: [] }, f.data).rooms.m.production, 0.2);
  assert.throws(() => evaluateModifiers(snapshot, { m: [2, 1], d: [] }, f.data), { code: 'MISSING_MECHANISM_STATE' });
  f.input.building.roomSlots.n = { ...f.input.building.roomSlots.m, charInstIds: [] };
  f.input.building.rooms.MANUFACTURE.n = { ...f.input.building.rooms.MANUFACTURE.m };
  snapshot = normalize(f.input, f.data);
  assert.equal(evaluateModifiers(snapshot, { m: [2], n: [1], d: [] }, f.data).rooms.n.production, 0.2);
  delete f.input.building.roomSlots.n;
  f.input.building.roomSlots.m.charInstIds = [-1, 1, 2];
  snapshot = normalize(f.input, f.data);
  assert.equal(evaluateModifiers(snapshot, { m: [1, 2], d: [] }, f.data).rooms.m.production, 0.2);
});
