import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
function fixture() {
  const input = syntheticPlayer(['char_1027_greyy2']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.roomSlots.p = { roomId: 'POWER', level: 1, state: 2, charInstIds: [1] };
  input.building.rooms.POWER = { p: {} };
  Object.assign(input.building.chars[1], { ap: 8640000, roomSlotId: 'p' });
  input.building.status = { labor: { maxValue: 200, value: 0 } };
  return input;
}
function power(input) {
  return evaluateModifiers(normalize(input, catalog), { p: [1], d: [] }, catalog).rooms.p.droneSpeed;
}

test('承曦格雷伊充能按上限十架分档并封顶，不使用当前库存', () => {
  const input = fixture();
  for (const [maxValue, expected] of [[0, 0], [9, 0], [10, 0.01], [199, 0.19], [200, 0.2], [249, 0.24], [250, 0.25], [300, 0.25], [10, 0.01]]) {
    input.building.status.labor.maxValue = maxValue;
    for (const value of [0, maxValue]) {
      input.building.status.labor.value = value;
      assert.ok(Math.abs(power(input) - expected) < 1e-12);
    }
  }
});
test('缺少无人机上限拒绝求值；离岗后不再需要该状态且不残留加成', () => {
  const input = fixture();
  delete input.building.status;
  const snapshot = normalize(input, catalog);
  const assignment = { p: [1], d: [] };
  assert.throws(() => evaluateModifiers(snapshot, assignment, catalog), error => error.code === 'MISSING_MECHANISM_STATE');
  assert.deepEqual(evaluateModifiers(snapshot, { p: [], d: [] }, catalog).rooms.p, {});
  for (const droneLimit of [null, NaN, Infinity, -1, '200', 0.5]) {
    snapshot.droneLimit = droneLimit;
    assert.throws(() => evaluateModifiers(snapshot, assignment, catalog), error => error.code === 'MISSING_MECHANISM_STATE');
  }
});
test('精二虚拟发电联动与充能共存；机器人离岗及练度往返重算联动', () => {
  const input = syntheticPlayer(['char_1027_greyy2', 'char_285_medic2', 'char_400_weedy']);
  input.building.status = { labor: { maxValue: 200, value: 0 } };
  input.building.roomSlots.p = { roomId: 'POWER', level: 1, state: 2, charInstIds: [1] };
  input.building.roomSlots.q = { roomId: 'POWER', level: 1, state: 2, charInstIds: [2] };
  input.building.rooms.POWER = { p: {}, q: {} };
  input.building.roomSlots.m.charInstIds = [3];
  for (const [id, roomSlotId] of [[1, 'p'], [2, 'q'], [3, 'm']]) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId });
  for (const [phase, robotTeam, expected] of [[0, [2], 0.2], [2, [2], 0.2], [2, [], 0.3], [0, [], 0.2], [2, [], 0.3]]) {
    input.troop.chars[1].evolvePhase = phase;
    const result = evaluateModifiers(normalize(input, catalog), { p: [1], q: robotTeam, m: [3], d: [] }, catalog);
    assert.ok(Math.abs(result.rooms.p.droneSpeed - 0.2) < 1e-12);
    assert.ok(Math.abs(result.rooms.m.production - expected) < 1e-12, JSON.stringify(result.rooms));
  }
});
