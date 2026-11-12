import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../src/protocol/normalize.mjs';

// 合成资料，不复制游戏整表；只有本组契约实际需要的字段。
const catalog = {
  chars: { char_a: { maxManpower: 8640000 }, char_b: { maxManpower: 8640000 } },
  rooms: {
    MANUFACTURE: { phases: [{ maxStationedNum: 1 }, { maxStationedNum: 2 }, { maxStationedNum: 3 }] },
    WORKSHOP: { phases: [{ maxStationedNum: 1 }] },
    DORMITORY: { phases: [{ maxStationedNum: 5 }] },
  },
  manufactFormulas: { '4': { requireRooms: [{ roomId: 'MANUFACTURE', roomLevel: 1 }] } },
  comfortLimit: 5000,
};
function input() {
  return {
    token: 'must-not-survive',
    troop: { chars: {
      '1': { instId: 1, charId: 'char_a', level: 80, evolvePhase: 2, private: 'secret' },
      '2': { instId: 2, charId: 'char_b', level: 1, evolvePhase: 0 },
    } },
    building: {
      chars: {
        '1': { charId: 'char_a', ap: 3742935, roomSlotId: 'slot_14' },
        '2': { charId: 'char_b', ap: 0, roomSlotId: '' },
      },
      roomSlots: { slot_14: { level: 3, state: 2, roomId: 'MANUFACTURE', charInstIds: [1, -1, -1] } },
      rooms: { MANUFACTURE: { slot_14: { formulaId: '4', capacity: 60 } } },
    },
  };
}
function invalid(change, code = 'INVALID_REQUEST') {
  const value = input(); change(value);
  assert.throws(() => normalize(value, catalog), error => error.code === code);
}

test('无人机上限从status.labor独立投影，不保留库存或共享原对象', () => {
  for (const maxValue of [0, 9, 10, 199, 200, 250, 300]) {
    const value = input();
    value.building.status = { labor: { maxValue, value: 999, buffSpeed: 123, private: 'secret' } };
    const before = structuredClone(value);
    const got = normalize(value, catalog);
    assert.equal(got.droneLimit, maxValue);
    assert.equal(got.status, undefined);
    assert.equal(got.labor, undefined);
    assert.deepEqual(value, before);
    value.building.status.labor.maxValue = 1;
    assert.equal(got.droneLimit, maxValue);
  }
});
test('无人机状态可缺省但提供时必须校验，不隐式转换或默认为零', () => {
  for (const status of [undefined, {}, { labor: {} }]) {
    const value = input();
    value.building.status = status;
    assert.equal(normalize(value, catalog).droneLimit, undefined);
  }
  for (const maxValue of [null, '200', NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    invalid(value => { value.building.status = { labor: { maxValue } }; });
  }
  for (const status of [null, [], 1, { labor: null }, { labor: [] }]) {
    invalid(value => { value.building.status = status; });
  }
});

test('保留实例和原始心情，不泄漏无关数据，也不改动输入', () => {
  const value = input(); const before = structuredClone(value);
  const got = normalize(value, catalog);
  assert.deepEqual(got.operators[0], { instId: 1, charId: 'char_a', level: 80, evolvePhase: 2, ap: 3742935, roomSlotId: 'slot_14' });
  assert.equal(got.rooms[0].capacity, 3);
  assert.deepEqual(got.rooms[0].occupants, [1]);
  assert.deepEqual(got.reservedIds, []);
  assert.equal(JSON.stringify(got).includes('secret'), false);
  assert.equal(JSON.stringify(got).includes('token'), false);
  assert.deepEqual(value, before);
});
test('有效空阵容与缺少阵容区分', () => {
  const value = input(); value.troop.chars = {}; value.building.chars = {};
  value.building.roomSlots.slot_14.charInstIds = [-1, -1, -1];
  assert.deepEqual(normalize(value, catalog).operators, []);
  invalid(v => { delete v.troop.chars; });
});
test('实例键、instId和两份charId必须一致', () => {
  invalid(v => { v.troop.chars['1'].instId = 2; });
  invalid(v => { v.building.chars['1'].charId = 'char_b'; });
  invalid(v => { delete v.building.chars['2']; });
  invalid(v => { v.building.chars['3'] = v.building.chars['2']; });
});
test('拒绝隐式数字转换、非有限数、越界或不安全整数', () => {
  for (const ap of ['123', NaN, Infinity, -1, 8640001, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    invalid(v => { v.building.chars['1'].ap = ap; });
  }
  invalid(v => { v.troop.chars['1'].evolvePhase = 3; });
  invalid(v => { v.troop.chars['1'].level = 0; });
});
test('未知数据角色和房间不得当成零技能或可用设施', () => {
  invalid(v => { v.troop.chars['1'].charId = v.building.chars['1'].charId = 'new-char'; }, 'DATA_MISMATCH');
  invalid(v => { v.building.roomSlots.slot_14.roomId = 'NEW_ROOM'; }, 'DATA_MISMATCH');
  invalid(v => { v.building.roomSlots.slot_14.state = 99; });
});
test('容量来自数据，不信任玩家数组长度；拒绝未知配方和缺失房间资料', () => {
  invalid(v => { v.building.roomSlots.slot_14.charInstIds = [1, 2, -1, -1]; });
  invalid(v => { v.building.rooms.MANUFACTURE.slot_14.formulaId = '999'; }, 'DATA_MISMATCH');
  invalid(v => { delete v.building.rooms.MANUFACTURE; });
});
test('已在使用的制造配方不因当前房间低于历史解锁等级被拒绝', () => {
  const value = input();
  value.building.roomSlots.slot_14.level = 1;
  value.building.roomSlots.slot_14.charInstIds = [1];
  const data = structuredClone(catalog);
  data.manufactFormulas['4'].requireRooms[0].roomLevel = 3;
  assert.equal(normalize(value, data).rooms[0].formulaId, '4');
});
test('占位必须双向一致，不能重复或引用不存在的实例', () => {
  invalid(v => { v.building.roomSlots.slot_14.charInstIds = [1, 1, -1]; });
  invalid(v => { v.building.roomSlots.slot_14.charInstIds = [1, 99, -1]; });
  invalid(v => { v.building.chars['1'].roomSlotId = ''; });
  invalid(v => { v.building.roomSlots.slot_14.charInstIds = [-1, -1, -1]; });
});
test('设施等级上下文保留训练室和建设状态，但不开放训练人员参与排班', () => {
  const value = input();
  const data = structuredClone(catalog);
  data.rooms.TRAINING = { phases: [{ maxStationedNum: 2 }, { maxStationedNum: 2 }, { maxStationedNum: 2 }] };
  value.building.roomSlots.train = { level: 3, state: 2, roomId: 'TRAINING', charInstIds: [2] };
  value.building.roomSlots.future = { level: 0, state: 0, roomId: 'TRAINING', charInstIds: [] };
  value.building.chars['2'].roomSlotId = 'train';
  const got = normalize(value, data);
  assert.deepEqual(got.facilities, [
    { slot: 'future', type: 'TRAINING', level: 0, state: 0 },
    { slot: 'slot_14', type: 'MANUFACTURE', level: 3, state: 2 },
    { slot: 'train', type: 'TRAINING', level: 3, state: 2 },
  ]);
  assert.deepEqual(got.reservedIds, [2]);
  assert.equal(got.rooms.length, 1);
});

test('锁定数据定义的非优化设施保留状态，零容量不能容纳人员或未知等级', () => {
  for (const [type, phases] of [['PRIVATE', 3], ['ELEVATOR', 1], ['CORRIDOR', 1]]) {
    const data = structuredClone(catalog);
    data.rooms[type] = { phases: Array.from({ length: phases }, () => ({ maxStationedNum: 0 })) };
    const value = input();
    value.building.roomSlots.other = { level: phases, state: 2, roomId: type, charInstIds: [] };
    const before = structuredClone(value);
    const got = normalize(value, data);
    assert.deepEqual(got.facilities.find(room => room.slot === 'other'), { slot: 'other', type, level: phases, state: 2 });
    assert.deepEqual(got.rooms.map(room => room.slot), ['slot_14']);
    assert.deepEqual(value, before);
    value.building.roomSlots.other.charInstIds = [2];
    value.building.chars['2'].roomSlotId = 'other';
    assert.throws(() => normalize(value, data), error => error.code === 'INVALID_REQUEST');
    value.building.roomSlots.other.charInstIds = [];
    value.building.chars['2'].roomSlotId = '';
    value.building.roomSlots.other.level = phases + 1;
    assert.throws(() => normalize(value, data), error => error.code === 'INVALID_REQUEST');
  }
});

test('加工站占用保留为预留人员，不进入目标房间', () => {
  const value = input();
  value.building.roomSlots.slot_w = { level: 1, state: 2, roomId: 'WORKSHOP', charInstIds: [2] };
  value.building.chars['2'].roomSlotId = 'slot_w';
  const got = normalize(value, catalog);
  assert.deepEqual(got.reservedIds, [2]);
  assert.equal(got.rooms.length, 1);
});
