import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedEvaluator, evaluateIsolatedModifiers } from '../fixtures/mechanisms.mjs';

function fixture() {
  return {
    snapshot: { reservedIds: [], operators: [1, 2].map(instId => ({
      instId, charId: `char_${instId}`, evolvePhase: 0, level: 1, ap: 1000,
    })), rooms: [
      { slot: 'r', type: 'MEETING', capacity: 2, occupants: [1], level: 3 },
      { slot: 'm', type: 'MANUFACTURE', capacity: 3, occupants: [2], level: 3 },
    ] },
    catalog: { tiredApThreshold: 100,
      chars: Object.fromEntries([1, 2].map(id => [`char_${id}`, {
        buffChar: [{ buffData: [{ buffId: `b${id}`, cond: { phase: 0, level: 1 } }] }],
      }])),
      buffs: {
        b1: { buffId: 'b1', roomType: 'MEETING', description: '进驻会客室时，更容易获得线索板上尚未拥有的线索' },
        b2: { buffId: 'b2', roomType: 'MANUFACTURE', description: '进驻制造站时，生产力+25%' },
      },
    },
  };
}
const run = (f, assignment = { r: [1], m: [2] }) => evaluateIsolatedModifiers(f.snapshot, assignment, f.catalog);

test('请求内复用求值仍逐方案校验，且不复用前一个候选的加成', () => {
  const f = fixture();
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate({ r: [1], m: [2] }).rooms.m.production, 0.25);
  assert.deepEqual(evaluate({ r: [1], m: [] }).rooms.m, {});
  assert.throws(() => evaluate({ r: [], m: [1, 2] }), { code: 'INVALID_ASSIGNMENT' });
  assert.throws(() => evaluate({ r: [1], m: [2, 2] }), { code: 'INVALID_ASSIGNMENT' });
  const previous = evaluate({ r: [1], m: [2] });
  previous.diagnostics.frozenSlots.length = 0;
  assert.deepEqual(evaluate({ r: [1], m: [2] }).unevaluated.slots, ['r']);
});

test('不同请求的数据版本与解锁条件不共享编译结果', () => {
  const f = fixture();
  const first = createIsolatedEvaluator(f.snapshot, f.catalog);
  const next = structuredClone(f);
  next.catalog.buffs.b2.description = '进驻制造站时，生产力+40%';
  const second = createIsolatedEvaluator(next.snapshot, next.catalog);
  assert.equal(first({ r: [1], m: [2] }).rooms.m.production, 0.25);
  assert.equal(second({ r: [1], m: [2] }).rooms.m.production, 0.4);
  next.snapshot.operators[1].level = 1;
  next.catalog.chars.char_2.buffChar[0].buffData[0].cond.level = 30;
  const locked = createIsolatedEvaluator(next.snapshot, next.catalog);
  assert.deepEqual(locked({ r: [1], m: [2] }).rooms.m, {});
});

test('降级区域不输出零值或部分增量，未冻结区域仍计算真实技能增量', () => {
  const f = fixture();
  const result = run(f);
  assert.equal(result.diagnostics.mode, 'partial');
  assert.deepEqual(result.unevaluated, { slots: ['r'], operatorIds: [1] });
  assert.equal(Object.hasOwn(result.rooms, 'r'), false);
  assert.equal(Object.hasOwn(result.operators, 1), false);
  assert.equal(result.rooms.m.production, 0.25);
  assert.deepEqual(result.sources.map(s => s.buffId), ['b2']);
});

test('部分求值不能更改冻结占位或将未知空闲持有人重新入队', () => {
  const f = fixture();
  assert.throws(() => run(f, { r: [], m: [1, 2] }), { code: 'INVALID_ASSIGNMENT' });
  f.snapshot.rooms[0].occupants = [];
  assert.throws(() => run(f), { code: 'EXCLUDED_OPERATOR_ASSIGNED', status: 422 });
  const result = run(f, { r: [], m: [2] });
  assert.equal(result.rooms.m.production, 0.25);
});

test('全局依赖闭包冻结后不能泄漏已知半段加成到未求值区域', () => {
  const f = fixture();
  f.snapshot.rooms.push({ slot: 'c', type: 'CONTROL', capacity: 5, occupants: [2], level: 5 });
  f.snapshot.rooms[1].occupants = [];
  f.catalog.buffs.b2 = { buffId: 'b2', roomType: 'CONTROL',
    description: '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高），所有制造站生产力+2%（同种效果取最高）' };
  const result = run(f, { r: [1], c: [2], m: [] });
  assert.deepEqual(result.unevaluated.slots, ['c', 'm', 'r']);
  assert.deepEqual(result.rooms, {});
  assert.deepEqual(result.sources, []);
});

test('无未知技能时保持完整求值语义且不修改输入', () => {
  const f = fixture();
  f.catalog.buffs.b1.description = '进驻会客室时，线索搜集速度提升10%';
  const before = JSON.stringify(f);
  const result = run(f);
  assert.equal(result.diagnostics.mode, 'full');
  assert.equal(result.rooms.r.clueSpeed, 0.1);
  assert.deepEqual(result.unevaluated, { slots: [], operatorIds: [] });
  assert.equal(JSON.stringify(f), before);
});
