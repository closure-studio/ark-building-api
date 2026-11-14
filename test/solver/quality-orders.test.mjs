import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { compileBuff } from '../../src/mechanisms/compile.mjs';
import { evaluateNewOrderCandidate } from '../../src/solver/new-orders.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const cases = [
  ['trade_ord_wt&cost[000]', 3, [0.15, 0.30, 0.55], 3.4, 14184],
  ['trade_ord_wt&cost[001]', 3, [0.15, 0.30, 0.55], 3.4, 14184],
  ['trade_ord_wt&cost[002]', 3, [0.15, 0.30, 0.55], 3.4, 14184],
  ['trade_ord_wt&cost[003]', 3, [0.15, 0.30, 0.55], 3.4, 14184],
  ['trade_ord_wt&cost[004]', 3, [0.15, 0.30, 0.55], 3.4, 14184],
  ['trade_ord_wt&cost[010]', 5, [0.05, 0.10, 0.85], 3.8, 15768],
  ['trade_ord_wt&cost[011]', 5, [0.05, 0.10, 0.85], 3.8, 15768],
  ['trade_ord_wt&cost[012]', 5, [0.05, 0.10, 0.85], 3.8, 15768],
];
function fixture(buffId) {
  const data = { ...catalog, chars: { ...catalog.chars,
    source: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId, cond: { phase: 1, level: 1 } }] }] },
    plain: { maxManpower: 8640000, buffChar: [] } } };
  const room = { slot: 't', type: 'TRADING', level: 3, capacity: 3, occupants: [1, 2], strategy: 'O_GOLD' };
  const snapshot = { operators: [1, 2].map(instId => ({ instId, charId: instId === 1 ? 'source' : 'plain',
    level: 1, evolvePhase: 1, ap: 4320000 })), rooms: [room], facilities: [{ ...room, state: 2 }], reservedIds: [] };
  const assignment = { t: [1, 2] };
  const state = { scenario: 'confirmed-current-state', assignment: structuredClone(assignment), completedWorkHours: {} };
  return { data, snapshot, assignment, state };
}
const run = f => evaluateNewOrderCandidate(f.snapshot, f.assignment, f.data, 'steady-new-gold-orders', f.state);
for (const [id, hours, probabilities, meanGold, meanSeconds] of cases) {
  test(`已确认单一品质峰值与完整减耗 ${id}`, () => {
    const f = fixture(id);
    f.state.completedWorkHours[1] = hours;
    const before = structuredClone(f.snapshot);
    const result = run(f);
    assert.deepEqual(result.rooms.t.orders.map(order => order.probability), probabilities);
    assert.deepEqual(result.rooms.t.orders.map(order => order.baseSeconds), [8640, 12600, 16560]);
    near(result.rooms.t.meanGold, meanGold);
    near(result.rooms.t.meanLmd, meanGold * 500);
    near(result.rooms.t.meanSeconds, meanSeconds / 1.02);
    near(result.mood[1].changePerHour, -0.7);
    near(result.mood[2].changePerHour, -0.95);
    assert.deepEqual(f.snapshot, before);
    assert.equal(compileBuff(catalog.buffs[id], catalog.characterNames).status, 'unsupported');
    f.state.completedWorkHours[1] = 10000;
    assert.deepEqual(run(f), result);
    f.snapshot.operators[0].evolvePhase = 0;
    near(run(f).rooms.t.meanGold, 2.9);
    f.snapshot.operators[0].evolvePhase = 1;
    assert.deepEqual(run(f), result);
  });
  test(`品质曲线未确认区间、缺历史与失效绑定不猜值 ${id}`, () => {
    const f = fixture(id);
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
    f.state.completedWorkHours[1] = hours - 1;
    assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
    f.state.completedWorkHours[1] = hours;
    f.assignment.t = [2, 1];
    assert.throws(() => run(f), { code: 'STATE_ASSIGNMENT_MISMATCH' });
    f.state.assignment = structuredClone(f.assignment);
    near(run(f).rooms.t.meanGold, meanGold);
  });
}
for (const [first, second, gold, seconds] of [
  ['trade_ord_wt&cost[000]', 'trade_ord_wt&cost[001]', 3.52, 14659.2],
  ['trade_ord_wt&cost[000]', 'trade_ord_wt&cost[010]', 3.8, 15768],
]) test(`PRTS明确列出的双来源峰值观测 ${first}+${second}`, () => {
  const f = fixture(first);
  f.data.chars.plain.buffChar = [{ buffData: [{ buffId: second, cond: { phase: 0, level: 1 } }] }];
  f.state.completedWorkHours = { 1: 5, 2: 5 };
  for (const order of [[1, 2], [2, 1]]) {
    f.assignment.t = order; f.state.assignment = structuredClone(f.assignment);
    const result = run(f).rooms.t;
    near(result.meanGold, gold); near(result.meanLmd, gold * 500);
    near(result.meanSeconds, seconds / 1.02);
  }
});

for (const [fixed, gold, lmd] of [['trade_ord_closure[000]', 2, 1200], ['trade_ord_pepe[000]', 0, 1000]]) {
  test(`固定订单覆盖品质分布时不要求无关暖机历史，仍保留完整减耗 ${fixed}`, () => {
    const f = fixture('trade_ord_wt&cost[010]');
    f.data.chars.plain.buffChar = [{ buffData: [{ buffId: 'trade_ord_wt&cost[011]', cond: { phase: 0, level: 1 } }] }];
    f.data.chars.fixed = { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: fixed, cond: { phase: 0, level: 1 } }] }] };
    f.snapshot.operators.push({ instId: 3, charId: 'fixed', level: 1, evolvePhase: 1, ap: 4320000 });
    f.assignment.t.push(3); f.state.assignment = structuredClone(f.assignment);
    const result = run(f);
    near(result.rooms.t.meanGold, gold); near(result.rooms.t.meanLmd, lmd);
    near(result.modifiers.operators[1].moodCost, -0.25);
    near(result.modifiers.operators[2].moodCost, -0.25);
    f.data.buffs = { ...f.data.buffs, 'trade_ord_wt&cost[010]': {
      ...f.data.buffs['trade_ord_wt&cost[010]'], description: '漂移' } };
    assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  });
}

test('未列明的双β组合和低等级站保持拒绝，失败不污染下一合法候选', () => {
  const f = fixture('trade_ord_wt&cost[010]');
  f.state.completedWorkHours = { 1: 5, 2: 5 };
  const good = run(f);
  f.data.chars.plain.buffChar = [{ buffData: [{ buffId: 'trade_ord_wt&cost[010]', cond: { phase: 0, level: 1 } }] }];
  assert.throws(() => run(f), { code: 'QUALITY_CONDITION_UNCONFIRMED' });
  f.data.chars.plain.buffChar = [];
  f.snapshot.rooms[0].level = 2;
  assert.throws(() => run(f), { code: 'QUALITY_CONDITION_UNCONFIRMED' });
  f.snapshot.rooms[0].level = 3;
  assert.deepEqual(run(f), good);
});
