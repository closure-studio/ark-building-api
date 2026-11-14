import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator, evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
function fixture() {
  const ids = ['char_473_mberry', 'char_455_nothin', 'char_2025_shu', 'char_4083_chimes', 'char_286_cast3'];
  const rooms = [['h', 'HIRE', [1]], ['t', 'TRADING', [2, 4]], ['m', 'MANUFACTURE', [3]], ['d', 'DORMITORY', [5]]]
    .map(([slot, type, occupants]) => ({ slot, type, occupants, level: 3, capacity: 3 }));
  const snapshot = { rooms, reservedIds: [],
    operators: ids.map((charId, index) => ({ instId: index + 1, charId, evolvePhase: index === 4 ? 0 : 2, level: 1, ap: 4320000 })),
    facilities: rooms.map(room => ({ slot: room.slot, type: room.type, level: room.level, state: 2 })),
  };
  return { snapshot, assignment: Object.fromEntries(rooms.map(room => [room.slot, [...room.occupants]])) };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('人间烟火用真实角色解锁，宿舍换人跨过21点分档且预计算不残留', () => {
  const { snapshot, assignment } = fixture();
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const first = evaluate(assignment);
  assert.equal(first.diagnostics.mode, 'full');
  close(first.rooms.t.orderSpeed, 0.21);
  close(first.rooms.m.production, 0.07);
  close(first.operators[2].moodCost, -0.14);
  close(first.operators[4].moodCost, -0.14);
  const emptyDorm = evaluate({ ...assignment, d: [] });
  close(emptyDorm.rooms.t.orderSpeed, 0.2);
  close(emptyDorm.rooms.m.production, 0.06);
  const noSource = evaluate({ ...assignment, h: [] });
  close(noSource.rooms.t.orderSpeed, 0.01);
  close(noSource.rooms.m.production, 0);
  close(noSource.operators[2].moodCost, -0.1);
  assert.deepEqual(evaluate(assignment), first);
  const reversed = { ...snapshot, rooms: [...snapshot.rooms].reverse() };
  assert.deepEqual(evaluateModifiers(reversed, assignment, catalog).rooms, first.rooms);
});

test('人间烟火办公室缺失或施工不能当作零，技能未解锁时不要求无关状态', () => {
  const { snapshot, assignment } = fixture();
  for (const facilities of [undefined, snapshot.facilities.map(room => room.slot === 'h' ? { ...room, state: 1 } : room)]) {
    assert.throws(() => evaluateModifiers({ ...snapshot, facilities }, assignment, catalog), { code: 'MISSING_MECHANISM_STATE' });
  }
  snapshot.operators[0].evolvePhase = 1;
  delete snapshot.facilities;
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.01);
});

test('未知线索偏好冻结时，人间烟火来源、消费者及宿舍触发房间双向冻结', () => {
  const { snapshot } = fixture();
  snapshot.operators.push({ instId: 6, charId: 'char_1050_chen3', evolvePhase: 2, level: 1, ap: 4320000 });
  snapshot.rooms.push({ slot: 'r', type: 'MEETING', capacity: 2, level: 3, occupants: [6] });
  const result = planIsolation(snapshot, catalog);
  assert.deepEqual(result.frozenSlots, ['d', 'h', 'm', 'r', 't']);
  assert.equal(result.mode, 'partial');
});
