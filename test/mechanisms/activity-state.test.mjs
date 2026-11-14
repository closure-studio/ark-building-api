import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';
import { productionObjective } from '../../src/solver/objective.mjs';
import { evaluateConfirmedStateCandidate } from '../../src/solver/confirmed-state.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const trainingIds = ['control_train_spd[010]', 'control_train_spd[011]', 'control_train_spd[012]'];
const exchangeIds = ['meet_spd&exchange[000]', 'meet_spd&exchange[001]', 'meet_spd&exchange[999]'];
function fixture(buffIds, type) {
  const input = syntheticPlayer(['char_285_medic2', 'char_286_cast3', 'char_126_shotst']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.roomSlots.s = { roomId: type, level: 3, state: 2, charInstIds: [1] };
  input.building.roomSlots.t = { roomId: 'TRAINING', level: 3, state: 2, charInstIds: [2, 3] };
  input.building.rooms.TRAINING = { t: { trainer: { charInstId: 2 }, trainee: { charInstId: 3, state: 1 } } };
  if (type === 'MEETING') input.building.rooms.MEETING = { s: { infoShare: { ts: 0, reward: 0 } } };
  for (const id of [1, 2, 3]) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId: id === 1 ? 's' : 't' });
  const data = { ...catalog, chars: { ...catalog.chars, char_285_medic2: { ...catalog.chars.char_285_medic2,
    buffChar: buffIds.map(buffId => ({ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] })) } } };
  return { input, data };
}
function result(f) {
  const snapshot = normalize(f.input, f.data);
  return { snapshot, modifiers: evaluateModifiers(snapshot, { s: [1], d: [] }, f.data) };
}

test('三条训练技能从真实枚举投影；TRAINING才触发且同类取最高，训练人员不参与安排', () => {
  for (const buffs of [...trainingIds.map(id => [id]), trainingIds]) {
    const f = fixture(buffs, 'CONTROL');
    for (const state of [1, 2, 3, 0, 1]) {
      f.input.building.rooms.TRAINING.t.trainee.state = state;
      const { snapshot, modifiers } = result(f);
      assert.equal(snapshot.trainingActive, state === 1);
      assert.equal(modifiers.rooms.s.trainingSpeed, state === 1 ? 0.05 : 0);
      assert.deepEqual(snapshot.reservedIds, [2, 3]);
      assert.deepEqual(planIsolation(snapshot, f.data).excludedIds, []);
      const assignment = { s: [1], d: [] };
      const score = productionObjective(snapshot, assignment, f.data, modifiers);
      assert.deepEqual(score.primary, [0]);
      assert.ok(score.limitations.includes('TRAINING_VALUE_NOT_RANKED'));
      const confirmed = evaluateConfirmedStateCandidate(snapshot, assignment, f.data, {
        scenario: 'confirmed-current-state', assignment, trainingActive: state === 1,
      });
      assert.deepEqual(confirmed.modifiers, modifiers);
    }
  }
});
test('训练状态缺失与施工不猜false；无训练室为false，非法枚举/活跃空学员拒绝', () => {
  const f = fixture(trainingIds, 'CONTROL');
  delete f.input.building.rooms.TRAINING.t.trainee.state;
  const snapshot = normalize(f.input, f.data);
  assert.equal(snapshot.trainingActive, undefined);
  assert.throws(() => result(f), error => error.code === 'MISSING_MECHANISM_STATE');
  assert.throws(() => planIsolation(snapshot, f.data), error => error.code === 'MISSING_MECHANISM_STATE');
  f.input.building.roomSlots.s.charInstIds = [];
  f.input.building.chars[1].roomSlotId = '';
  assert.deepEqual(planIsolation(normalize(f.input, f.data), f.data).excludedIds, [1]);
  f.input.building.roomSlots.s.charInstIds = [1];
  f.input.building.chars[1].roomSlotId = 's';
  for (const state of [-1, 4, null, '1', 1.5]) {
    f.input.building.rooms.TRAINING.t.trainee.state = state;
    assert.throws(() => normalize(f.input, f.data), error => error.code === 'INVALID_REQUEST');
  }
  f.input.building.rooms.TRAINING.t.trainee.state = 1;
  f.input.building.rooms.TRAINING.t.trainee.charInstId = -1;
  assert.throws(() => normalize(f.input, f.data), error => error.code === 'INVALID_REQUEST');
  f.input.building.rooms.TRAINING.t.trainee.charInstId = 3;
  f.input.building.roomSlots.t.state = 1;
  assert.equal(normalize(f.input, f.data).trainingActive, undefined);
  delete f.input.building.roomSlots.t;
  for (const id of [2, 3]) f.input.building.chars[id].roomSlotId = '';
  assert.equal(result(f).modifiers.rooms.s.trainingSpeed, 0);
});
test('三条交流技能从截止Unix秒投影，过期待领奖不视为交流；请求内状态不随对象修改', t => {
  t.mock.method(Date, 'now', () => 2_000_000_000_000);
  for (const buffId of exchangeIds) {
    const f = fixture([buffId], 'MEETING');
    for (const [ts, reward, active] of [[2_000_000_001, 0, true], [2_000_000_000, 0, false], [1_999_999_999, 1, false], [0, 0, false], [2_000_000_001, 0, true]]) {
      f.input.building.rooms.MEETING.s.infoShare = { ts, reward };
      const before = structuredClone(f.input);
      const { snapshot, modifiers } = result(f);
      assert.equal(snapshot.rooms.find(room => room.slot === 's').clueExchangeActive, active);
      assert.equal(modifiers.rooms.s.clueSpeed, active ? 0.3 : 0);
      assert.deepEqual(f.input, before);
      f.input.building.rooms.MEETING.s.infoShare.ts = 0;
      assert.equal(snapshot.rooms.find(room => room.slot === 's').clueExchangeActive, active);
    }
  }
});
test('交流状态缺失不猜零；非法截止时间拒绝，闲置持有人排除不污染其他方案', () => {
  const f = fixture([exchangeIds[0]], 'MEETING');
  delete f.input.building.rooms.MEETING.s.infoShare;
  assert.throws(() => result(f), error => error.code === 'MISSING_MECHANISM_STATE');
  assert.throws(() => planIsolation(normalize(f.input, f.data), f.data), error => error.code === 'MISSING_MECHANISM_STATE');
  f.input.building.roomSlots.s.charInstIds = [];
  f.input.building.chars[1].roomSlotId = '';
  assert.deepEqual(planIsolation(normalize(f.input, f.data), f.data).excludedIds, [1]);
  for (const ts of [-1, null, '2000000000', 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    f.input.building.rooms.MEETING.s.infoShare = { ts };
    assert.throws(() => normalize(f.input, f.data), error => error.code === 'INVALID_REQUEST');
  }
  f.input.building.rooms.MEETING.s.infoShare = { ts: 0 };
  assert.deepEqual(planIsolation(normalize(f.input, f.data), f.data).excludedIds, []);
});
