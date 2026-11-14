import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeDefinedFields } from '../../src/protocol/serialize.mjs';

const snapshot = {
  operators: [{ instId: 7, charId: 'char_example', evolvePhase: 2, level: 50, ap: 123456 }],
  rooms: [
    { slot: 'manufact', type: 'MANUFACTURE', level: 3, capacity: 3, occupants: [7], formulaId: '4' },
    { slot: 'dorm', type: 'DORMITORY', level: 2, capacity: 5, occupants: [] },
  ], reservedIds: [],
};
const catalog = { tiredApThreshold: 100 };

test('已定义字段适配保留原实例、原始心情与真实空位，不伪造未知指标', () => {
  const result = serializeDefinedFields(snapshot, { manufact: [7], dorm: [] }, catalog);
  assert.deepEqual(result, { data: { arranged: {
    Control: [], Power: [], Manufacture: [{ RoomType: 1, Slot: 'manufact', Level: 3, CharNum: 3,
      RoomChar: [{ Char: 'char_example', Inst: { Ap: 123456, Inst: 7, Ev: 2, Lvl: 50, Char: 'char_example' } }],
      Formula: '4' }],
    Trading: [], Dormitory: [{ RoomType: 0, Slot: 'dorm', Level: 2, CharNum: 5, RoomChar: [] }],
    Meeting: [], Hire: [],
  } } });
});

test('七类房间枚举不能按数组顺序猜测，输出每个房间一次', () => {
  const types = ['CONTROL', 'POWER', 'MANUFACTURE', 'TRADING', 'DORMITORY', 'MEETING', 'HIRE'];
  const rooms = types.map(type => ({ slot: type, type, level: 1, capacity: 1, occupants: [] }));
  const result = serializeDefinedFields({ operators: [], rooms, reservedIds: [] },
    Object.fromEntries(types.map(type => [type, []])), catalog).data.arranged;
  assert.deepEqual(Object.values(result).map(group => group[0].RoomType), [4, 3, 1, 2, 0, 5, 6]);
  assert.deepEqual(Object.values(result).map(group => group[0].Slot), types);
});

test('序列化之前独立校验，重复实例与冻结原安排被清空均拒绝', () => {
  assert.throws(() => serializeDefinedFields(snapshot, { manufact: [7], dorm: [7] }, catalog),
    { code: 'INVALID_ASSIGNMENT' });
  assert.throws(() => serializeDefinedFields(snapshot, { manufact: [], dorm: [] }, catalog, ['manufact']),
    { code: 'INVALID_ASSIGNMENT' });
  const result = serializeDefinedFields(snapshot, { manufact: [7], dorm: [] }, catalog, ['manufact']);
  assert.equal(result.data.arranged.Manufacture[0].RoomChar[0].Inst.Inst, 7);
});

test('返回对象不共享输入数组或人员引用，也不泄露附加账号字段', () => {
  const input = structuredClone(snapshot);
  input.operators[0].token = 'sensitive-test-only';
  const assignment = { manufact: [7], dorm: [] };
  const result = serializeDefinedFields(input, assignment, catalog);
  result.data.arranged.Manufacture[0].RoomChar[0].Inst.Ap = 1;
  result.data.arranged.Manufacture[0].RoomChar.pop();
  assert.equal(input.operators[0].ap, 123456);
  assert.deepEqual(assignment.manufact, [7]);
  assert.equal(JSON.stringify(result).includes('sensitive-test-only'), false);
});
