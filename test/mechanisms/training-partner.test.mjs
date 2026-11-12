import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
function fixture() {
  const input = syntheticPlayer(['char_4136_phonor', 'char_4133_logos', 'char_285_medic2']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.troop.chars[1].level = 30;
  input.building.roomSlots.p = { roomId: 'POWER', level: 1, state: 2, charInstIds: [1] };
  input.building.roomSlots.t = { roomId: 'TRAINING', level: 3, state: 2, charInstIds: [2, 3] };
  input.building.rooms.POWER = { p: {} };
  input.building.rooms.TRAINING = { t: { trainer: { charInstId: 2 }, trainee: { charInstId: 3 } } };
  for (const id of [1, 2, 3]) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId: id === 1 ? 'p' : 't' });
  return input;
}
function speed(input) {
  const snapshot = normalize(input, catalog);
  return evaluateModifiers(snapshot, { p: [1], d: [] }, catalog).rooms.p.droneSpeed;
}
test('咒文共鸣只由逻各斯协助位触发，学员位不触发，角色与解锁往返重算', () => {
  const input = fixture();
  for (const [trainer, level, expected] of [[2, 30, 0.15], [3, 30, 0.1], [-1, 30, 0.1], [2, 1, 0.1], [2, 30, 0.15]]) {
    input.building.rooms.TRAINING.t.trainer.charInstId = trainer;
    input.building.rooms.TRAINING.t.trainee.charInstId = trainer === 2 ? 3 : 2;
    input.troop.chars[1].level = level;
    assert.ok(Math.abs(speed(input) - expected) < 1e-12);
  }
});
test('协助位状态只保留校验后的实例ID；训练人员继续受保护', () => {
  const input = fixture();
  const snapshot = normalize(input, catalog);
  assert.deepEqual(snapshot.trainingTrainerIds, [2]);
  assert.deepEqual(snapshot.reservedIds, [2, 3]);
  input.building.rooms.TRAINING.t.trainer.charInstId = 3;
  assert.deepEqual(snapshot.trainingTrainerIds, [2]);
  for (const id of [0, 1, 999, '2', null, 1.5]) {
    input.building.rooms.TRAINING.t.trainer.charInstId = id;
    assert.throws(() => normalize(input, catalog), error => error.code === 'INVALID_REQUEST');
  }
  input.building.rooms.TRAINING.t.trainer.charInstId = 2;
  input.building.rooms.TRAINING.t.trainee.charInstId = 2;
  assert.throws(() => normalize(input, catalog), error => error.code === 'INVALID_REQUEST');
  input.building.rooms.TRAINING.t.trainee.charInstId = 3;
  assert.deepEqual(normalize(input, catalog).trainingTrainerIds, [2]);
});
test('训练室资料缺失或施工不猜协助者；无训练室与空协助位明确为零额外加成', () => {
  const input = fixture();
  delete input.building.rooms.TRAINING;
  assert.throws(() => speed(input), error => error.code === 'MISSING_MECHANISM_STATE');
  const snapshot = normalize(input, catalog);
  assert.throws(() => planIsolation(snapshot, catalog), error => error.code === 'MISSING_MECHANISM_STATE');
  input.building.roomSlots.p.charInstIds = [];
  input.building.chars[1].roomSlotId = '';
  const inactive = planIsolation(normalize(input, catalog), catalog);
  assert.deepEqual(inactive.excludedIds, [1]);
  assert.equal(inactive.unresolved[0].reason, 'MISSING_MECHANISM_STATE');
  input.building.roomSlots.p.charInstIds = [1];
  input.building.chars[1].roomSlotId = 'p';
  input.building.rooms.TRAINING = { t: { trainer: { charInstId: 2 } } };
  input.building.roomSlots.t.state = 1;
  assert.throws(() => speed(input), error => error.code === 'MISSING_MECHANISM_STATE');
  delete input.building.roomSlots.t;
  for (const id of [2, 3]) input.building.chars[id].roomSlotId = '';
  assert.ok(Math.abs(speed(input) - 0.1) < 1e-12);
});
