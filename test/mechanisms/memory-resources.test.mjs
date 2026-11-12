import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { skillRegistry } from '../../src/mechanisms/registry.mjs';
import { createIsolatedEvaluator, evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture() {
  const names = ['絮雨', '迷迭香', '爱丽丝'];
  const operators = names.map((name, index) => ({ instId: index + 1,
    charId: Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name),
    evolvePhase: 2, level: 1, ap: 4320000 }));
  const rooms = [['h', 'HIRE', [1]], ['m', 'MANUFACTURE', [2]], ['d', 'DORMITORY', [3]]]
    .map(([slot, type, occupants]) => ({ slot, type, occupants, level: 3, capacity: 5, formulaId: '4' }));
  return { snapshot: { rooms, operators, reservedIds: [], facilities: rooms.map(room => ({ ...room, state: 2 })) },
    assignment: Object.fromEntries(rooms.map(room => [room.slot, [...room.occupants]])) };
}

test('絮雨额外招募位生成碎片并二次转换，精英替换及离岗不残留资源', () => {
  const { snapshot, assignment } = fixture();
  for (const [phase, level, expected] of [[2, 1, 0.04], [2, 2, 0.14], [2, 3, 0.24], [0, 3, 0.04], [2, 1, 0.04]]) {
    snapshot.operators[0].evolvePhase = phase;
    snapshot.facilities.find(room => room.type === 'HIRE').level = level;
    snapshot.rooms[0].level = level;
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const result = evaluate(assignment);
    assert.equal(result.diagnostics.mode, 'full');
    close(result.rooms.h.contactSpeed, 0.2);
    close(result.rooms.m.production, expected);
    close(evaluate({ ...assignment, h: [] }).rooms.m.production, 0.04);
    assert.deepEqual(evaluate(assignment), result);
    close(evaluateModifiers({ ...snapshot, rooms: [...snapshot.rooms].reverse() }, assignment, catalog).rooms.m.production, expected);
  }
});

test('记忆碎片缺设施状态拒绝，疲劳来源只能离岗，不清空其他来源的感知', () => {
  const { snapshot, assignment } = fixture();
  assert.throws(() => evaluateModifiers({ ...snapshot, facilities: undefined }, assignment, catalog), { code: 'MISSING_MECHANISM_STATE' });
  snapshot.operators[0].ap = 0;
  assert.throws(() => evaluateModifiers(snapshot, assignment, catalog));
  close(evaluateModifiers(snapshot, { ...assignment, h: [] }, catalog).rooms.m.production, 0.04);
  close(evaluateModifiers(snapshot, { ...assignment, h: [], d: [1, 3] }, catalog).rooms.m.production, 0.05);
});

test('真实车尔尼的小节生成与锁定恢复未实现时仍拒绝，不能只求值转换半个技能组', () => {
  const { snapshot } = fixture();
  const charId = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === '车尔尼');
  snapshot.operators.push({ instId: 4, charId, evolvePhase: 2, level: 1, ap: 4320000 });
  snapshot.rooms[2].occupants.push(4);
  assert.throws(() => planIsolation(snapshot, catalog), { code: 'UNISOLATABLE_MECHANISM' });
});

test('小节转换使用上游数量，缺来源为零；真实车尔尼的单体恢复仍保守隔离', () => {
  const { snapshot, assignment } = fixture();
  assignment.h = [];
  // 单独验证转换合同；合成小节来源不代表车尔尼的锁定恢复已实现。
  const description = '测试小节来源';
  const buff = { buffId: 'test-notes', roomType: 'DORMITORY', description };
  const data = { ...catalog, buffs: { ...catalog.buffs, [buff.buffId]: buff }, chars: { ...catalog.chars,
    converter: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: 'dorm_rec_bd_n1[100]', cond: { phase: 0, level: 1 } }] }] },
    source: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: buff.buffId, cond: { phase: 0, level: 1 } }] }] },
  } };
  snapshot.operators[2].charId = 'converter';
  snapshot.operators.push({ instId: 4, charId: 'source', evolvePhase: 0, level: 1, ap: 4320000 });
  const registry = { ...skillRegistry, [buff.buffId]: { roomType: buff.roomType,
    descriptionSha256: createHash('sha256').update(description).digest('hex'),
    effects: [{ stat: 'resource', scope: 'room', resource: 'notes', basis: 'roomLevel', value: 1, stacking: 'sum' }] } };
  for (const [level, expected] of [[1, 0.03], [3, 0.05], [5, 0.07]]) {
    snapshot.rooms[2].level = level;
    const result = evaluateModifiers(snapshot, { ...assignment, d: [3, 4] }, data, registry);
    close(result.rooms.m.production, expected);
    close(evaluateModifiers(snapshot, assignment, data, registry).rooms.m.production, 0.01);
    close(evaluateModifiers(snapshot, { ...assignment, d: [4] }, data, registry).rooms.m.production, 0.01);
  }
});
