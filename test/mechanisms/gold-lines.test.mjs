import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator, evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture(goldRooms = 2) {
  const names = ['鸿雪', '图耶', '绮良', '杜林', '桃金娘', '褐果', '至简', '特克诺', '石英'];
  const operators = names.map((name, index) => ({ instId: index + 1,
    charId: Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name),
    evolvePhase: ['杜林'].includes(name) ? 0 : 2, level: 1, ap: 4320000 }));
  const rooms = [
    { slot: 't', type: 'TRADING', occupants: [1, 2, 3], formulaId: 'O_GOLD', level: 3, capacity: 3 },
    { slot: 'other', type: 'TRADING', occupants: [], formulaId: 'O_GOLD', level: 3, capacity: 3 },
    { slot: 'd', type: 'DORMITORY', occupants: [4, 5, 6, 7], level: 5, capacity: 5 },
    ...Array.from({ length: goldRooms }, (_, i) => ({ slot: `m${i}`, type: 'MANUFACTURE', occupants: [], formulaId: '4', level: 3, capacity: 3 })),
  ];
  return { snapshot: { rooms, operators, reservedIds: [], facilities: rooms.map(r => ({ slot: r.slot, type: r.type, level: r.level, state: 2 })) },
    assignment: Object.fromEntries(rooms.map(r => [r.slot, [...r.occupants]])) };
}

for (const [goldRooms, pair, trio] of [[2, 0.8, 1.1], [3, 0.85, 1.15], [4, 1.05, 1.6], [5, 1.1, 1.65]]) {
  test(`${goldRooms}座实际赤金制造站：鸿图组合与绮良增线不递归放大虚拟线`, () => {
    const { snapshot, assignment } = fixture(goldRooms);
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const first = evaluate(assignment);
    assert.equal(first.diagnostics.mode, 'full');
    close(first.rooms.t.orderSpeed, trio);
    close(evaluate({ ...assignment, t: [1, 2] }).rooms.t.orderSpeed, pair);
    assert.deepEqual(evaluate(assignment), first);
    close(evaluateModifiers({ ...snapshot, rooms: [...snapshot.rooms].reverse() }, { ...assignment, t: [3, 2, 1] }, catalog).rooms.t.orderSpeed, trio);
  });
}

test('绮良/鸿雪增线对另一贸易站生效，来源离岗及杜林换人即时重算', () => {
  const { snapshot, assignment } = fixture();
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const split = { ...assignment, t: [1, 3], other: [2] };
  close(evaluate(split).rooms.other.orderSpeed, 0.65);
  close(evaluate({ ...split, t: [1] }).rooms.other.orderSpeed, 0.5);
  close(evaluate({ ...split, t: [3] }).rooms.other.orderSpeed, 0.35);
  close(evaluate({ ...split, d: [4, 5, 6] }).rooms.other.orderSpeed, 0.5);
  close(evaluate({ ...split, d: [4, 5, 6, 7, 8] }).rooms.other.orderSpeed, 0.65);
  // 空闲的第五名不计入；在岗杜林最多四名。
  close(evaluate(split).rooms.other.orderSpeed, 0.65);
});

test('绮良与图耶精零每四条取整，不把同名高阶技能叠加', () => {
  const { snapshot, assignment } = fixture(3);
  snapshot.operators[0].evolvePhase = 0;
  snapshot.operators[1].evolvePhase = 0;
  snapshot.operators[2].evolvePhase = 0;
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.25);
  snapshot.rooms.push({ slot: 'm3', type: 'MANUFACTURE', occupants: [], formulaId: '4', level: 3, capacity: 3 });
  assignment.m3 = [];
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.55);
});

test('配方按四类去重，不按配方ID、制造站人数或房间等级计数', () => {
  const { snapshot, assignment } = fixture(5);
  assignment.t = [9];
  for (const [index, id] of ['1', '2', '4', '5', '13'].entries()) snapshot.rooms.find(r => r.slot === `m${index}`).formulaId = id;
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.38);
  snapshot.rooms.find(r => r.slot === 'm4').formulaId = '14';
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.38);
  for (const room of snapshot.rooms.filter(r => r.type === 'MANUFACTURE')) { room.formulaId = '4'; room.level = 1; }
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.32);
});

test('没有赤金制造站为零条，虚拟线仍可由杜林提供', () => {
  const { snapshot, assignment } = fixture(0);
  close(evaluateModifiers(snapshot, assignment, catalog).rooms.t.orderSpeed, 0.6);
  close(evaluateModifiers(snapshot, { ...assignment, t: [9] }, catalog).rooms.t.orderSpeed, 0.3);
});

test('赤金与配方技能缺配方或杜林名单时拒绝，不静默按零计算', () => {
  const { snapshot, assignment } = fixture();
  snapshot.rooms.find(r => r.slot === 'm0').formulaId = 'missing';
  for (const t of [[1, 2, 3], [9]]) assert.throws(() => evaluateModifiers(snapshot, { ...assignment, t }, catalog), { code: 'MISSING_MECHANISM_STATE' });
  snapshot.rooms.find(r => r.slot === 'm0').formulaId = '4';
  assert.throws(() => evaluateModifiers(snapshot, assignment, { ...catalog, operatorGroups: {} }), { code: 'MISSING_MECHANISM_STATE' });
  assert.throws(() => evaluateModifiers({ ...snapshot, facilities: undefined }, assignment, catalog), { code: 'MISSING_MECHANISM_STATE' });
});

test('受保护宿舍触发杜林产线时双向冻结跨站来源与消费者，指标未求值', () => {
  const { snapshot, assignment } = fixture();
  const charId = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === '山');
  snapshot.operators.push({ instId: 10, charId, evolvePhase: 2, level: 1, ap: 4320000 });
  snapshot.rooms.find(r => r.slot === 'd').occupants.push(10);
  assignment.d.push(10);
  snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', occupants: [], level: 3, capacity: 2 });
  assignment.meeting = [];
  const plan = planIsolation(snapshot, catalog);
  assert.ok(['d', 't', 'other'].every(slot => plan.frozenSlots.includes(slot)));
  const result = createIsolatedEvaluator(snapshot, catalog)(assignment);
  for (const slot of ['d', 't', 'other']) {
    assert.ok(result.unevaluated.slots.includes(slot));
    assert.equal(result.rooms[slot], undefined);
  }
});
