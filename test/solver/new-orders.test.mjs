import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { compileBuff } from '../../src/mechanisms/compile.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { evaluateNewOrderCandidate } from '../../src/solver/new-orders.mjs';
import { searchAssignments } from '../../src/solver/search.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const scenario = 'steady-new-gold-orders';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture(names) {
  const operators = names.map((name, i) => ({ instId: i + 1,
    charId: Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name),
    evolvePhase: 2, level: 30, ap: 4320000 }));
  const rooms = [{ slot: 't', type: 'TRADING', level: 3, capacity: 3, strategy: 'O_GOLD', occupants: operators.map(op => op.instId) }];
  return { snapshot: { rooms, operators, reservedIds: [], facilities: rooms.map(room => ({ ...room, state: 2 })) },
    assignment: { t: operators.map(op => op.instId) } };
}
const run = ({ snapshot, assignment }, data = catalog) => evaluateNewOrderCandidate(snapshot, assignment, data, scenario);
const metric = (result, key) => result.objective.primary[result.objective.primaryKeys.indexOf(key)];

for (const [name, gold, lmd, kind] of [
  ['可露希尔', 2, 1200, 'closure'], ['U-Official', 2, 1000, 'forceTwo'],
  ['佩佩', 0, 1000, 'pepe'], ['但书', 4.5, 2250, 'breach'], ['龙舌兰', 2.9, 1550, 'ordinary'],
]) test(`真实${name}完整解锁组进入新订单情景，默认接口编译仍不激活`, () => {
  const fixtureData = fixture([name]);
  const result = run(fixtureData);
  near(result.rooms.t.meanGold, gold); near(result.rooms.t.meanLmd, lmd);
  assert.equal(result.rooms.t.orders[0].kind, kind);
  assert.equal(result.scenario, scenario);
  near(metric(result, 'item:3003:perHour'), -result.rooms.t.goldPerHour);
  near(metric(result, 'item:4001:perHour'), result.rooms.t.lmdPerHour);
  assert.throws(() => evaluateModifiers(fixtureData.snapshot, fixtureData.assignment, catalog), { code: 'UNSUPPORTED_MECHANISM' });
});

test('已确认状态与新订单条件可以同时求值，旧候选状态不能复用', () => {
  const f = fixture(['可露希尔', '崖心']);
  f.snapshot.rooms[0].occupants = [1];
  const dorm = { slot: 'd', type: 'DORMITORY', level: 3, capacity: 5, comfort: 3000, occupants: [2] };
  f.snapshot.rooms.push(dorm);
  f.snapshot.facilities.push({ ...dorm, state: 2 });
  f.assignment = { t: [1], d: [2] };
  const state = { scenario: 'confirmed-current-state', assignment: structuredClone(f.assignment), dormTargets: { 2: null } };
  const value = evaluateNewOrderCandidate(f.snapshot, f.assignment, catalog, scenario, state);
  near(value.rooms.t.meanLmd, 1200);
  near(value.modifiers.operators[2].moodRecovery, 0.5);
  assert.ok(value.objective.limitations.includes('STATE_PROVENANCE_AND_TIMING_UNCONFIRMED'));
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  state.assignment.d = [];
  assert.throws(() => evaluateNewOrderCandidate(f.snapshot, f.assignment, catalog, scenario, state), { code: 'STATE_ASSIGNMENT_MISMATCH' });
});

test('新订单情景必须显式选择，不能作为当前订单状态或HTTP契约的默认值', () => {
  const { snapshot, assignment } = fixture(['可露希尔']);
  for (const value of [undefined, null, 'current-orders', {}, true]) {
    assert.throws(() => evaluateNewOrderCandidate(snapshot, assignment, catalog, value), { code: 'ORDER_SCENARIO_REQUIRED' });
  }
  snapshot.rooms[0].strategy = 'O_DIAMOND';
  assert.throws(() => run({ snapshot, assignment }), { code: 'ORDER_STRATEGY_UNSUPPORTED' });
});

test('绑定完整效率与心情效果，精英替代和离岗重算，不残留加成', () => {
  const f = fixture(['可露希尔', '龙舌兰']);
  const result = run(f);
  near(result.modifiers.rooms.t.orderSpeed, 0.1);
  near(result.rooms.t.meanSeconds, 8640 / 1.12);
  near(result.mood[2].changePerHour, -0.70);
  f.snapshot.operators[0].evolvePhase = 0;
  const reduced = run(f);
  near(reduced.modifiers.rooms.t.orderSpeed ?? 0, 0);
  near(reduced.rooms.t.meanLmd, 1550);
  f.snapshot.operators[1].evolvePhase = 0;
  near(run(f).rooms.t.meanLmd, 1500);
  f.snapshot.operators[1].evolvePhase = 2;
  near(run(f).rooms.t.meanLmd, 1550);
  f.assignment.t = [1];
  near(run(f).rooms.t.meanLmd, 1450);
  f.assignment.t = [];
  const empty = run(f);
  assert.deepEqual(empty.rooms.t, { orders: [], lmdPerHour: 0, goldPerHour: 0 });
  assert.ok(empty.objective.primary.every(value => value === 0));
});

test('但书精零/精二与龙舌兰投资叠加，投资不叠到违约上', () => {
  const f = fixture(['但书', '龙舌兰']);
  near(run(f).rooms.t.meanLmd, 2350);
  f.snapshot.operators[0].evolvePhase = 0;
  near(run(f).rooms.t.meanLmd, 1950);
  f.snapshot.operators[1].evolvePhase = 0;
  near(run(f).rooms.t.meanLmd, 1900);
  const reverse = { ...f, assignment: { t: [2, 1] } };
  assert.deepEqual(run(reverse).rooms, run(f).rooms);
});

test('佩佩覆盖其他特殊订单但不删除完整技能自带效率和心情效果', () => {
  const f = fixture(['佩佩', '可露希尔', '龙舌兰']);
  const result = run(f);
  near(result.rooms.t.meanSeconds, 16200); near(result.rooms.t.lmdPerHour, 1000 / 4.5);
  near(result.rooms.t.goldPerHour, 0); near(result.modifiers.rooms.t.orderSpeed, 0.1);
  near(result.mood[3].changePerHour, -0.65);
  f.snapshot.operators[0].evolvePhase = 0;
  assert.equal(run(f).rooms.t.orders[0].kind, 'closure');
});

test('指纹漂移、缺技能、未支持概率、疲劳与人员互斥均不被情景入口绕过', () => {
  const f = fixture(['可露希尔']);
  const id = 'trade_ord_closure[000]';
  const data = { ...catalog, buffs: { ...catalog.buffs, [id]: { ...catalog.buffs[id], description: `${catalog.buffs[id].description}漂移` } } };
  assert.throws(() => run(f, data), { code: 'UNSUPPORTED_MECHANISM' });
  assert.throws(() => run(fixture(['柏喙'])), { code: 'UNSUPPORTED_MECHANISM' });
  f.snapshot.operators[0].ap = 0;
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
  f.snapshot.operators[0].ap = 4320000;
  f.assignment.t = [1, 1];
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
  for (const buffId of ['trade_ord_closure[000]', 'trade_ord_pepe[000]', 'trade_ord_spd&wt[000]',
    'trade_ord_law[000]', 'trade_ord_against[000]', 'trade_ord_against[010]', 'trade_ord_long[000]', 'trade_ord_long[010]']) {
    assert.equal(compileBuff(catalog.buffs[buffId], catalog.characterNames).status, 'unsupported');
  }
});

test('赤金生产净值扣掉订单消耗，相同收入不同消耗不再等价', () => {
  const f = fixture(['可露希尔']);
  const formulaId = Object.keys(catalog.manufactFormulas).find(id => catalog.manufactFormulas[id].itemId === '3003');
  assert.ok(formulaId);
  f.snapshot.rooms.push({ slot: 'm', type: 'MANUFACTURE', level: 3, capacity: 3, formulaId, occupants: [] });
  const op = { ...f.snapshot.operators[0], instId: 2, evolvePhase: 0 };
  f.snapshot.operators.push(op); f.assignment.m = [2];
  const result = run(f);
  const formula = catalog.manufactFormulas[formulaId];
  const generated = (catalog.manufactData.phases[2].speed + catalog.manufactData.basicSpeedBuff) * formula.count * 3600 / formula.costPoint;
  near(metric(result, 'item:3003:perHour'), generated - result.rooms.t.goldPerHour);
  assert.ok(result.objective.limitations.includes('ORDER_TIMING_UNCONFIRMED'));
});

test('多贸易站独立套用特殊订单，人员移动后重算并汇总消耗', () => {
  const f = fixture(['可露希尔', '龙舌兰', '佩佩']);
  f.snapshot.rooms[0].occupants = [1, 2];
  f.snapshot.rooms.push({ ...f.snapshot.rooms[0], slot: 'u', occupants: [3] });
  f.assignment = { t: [1, 2], u: [3] };
  const before = structuredClone(f);
  const first = run(f);
  near(first.rooms.t.meanLmd, 1200);
  near(first.rooms.u.meanLmd, 1000);
  near(metric(first, 'item:4001:perHour'), first.rooms.t.lmdPerHour + first.rooms.u.lmdPerHour);
  near(metric(first, 'item:3003:perHour'), -first.rooms.t.goldPerHour);
  assert.deepEqual(f, before);
  f.assignment = { t: [1, 2, 3], u: [] };
  const moved = run(f);
  near(metric(moved, 'item:4001:perHour'), 1000 / 4.5);
  near(metric(moved, 'item:3003:perHour'), 0);
  f.assignment = before.assignment;
  assert.deepEqual(run(f), first);
});

test('同技能新角色无需身份特判，房型和数据漂移拒绝后仍可回退', () => {
  const f = fixture(['可露希尔']);
  const charId = f.snapshot.operators[0].charId;
  const original = run(f);
  const future = 'char_test_future_order';
  const updated = { ...catalog, chars: { ...catalog.chars, [future]: catalog.chars[charId] },
    characterNames: { ...catalog.characterNames, [future]: '新角色' } };
  f.snapshot.operators[0].charId = future;
  assert.deepEqual(run(f, updated).rooms, original.rooms);
  f.snapshot.operators[0].charId = charId;
  const id = 'trade_ord_closure[000]';
  const wrong = { ...catalog, buffs: { ...catalog.buffs, [id]: { ...catalog.buffs[id], roomType: 'POWER' } } };
  assert.throws(() => run(f, wrong), { code: 'UNSUPPORTED_MECHANISM' });
  const absent = { ...catalog, buffs: { ...catalog.buffs } };
  delete absent.buffs[id];
  assert.throws(() => run(f, absent));
  assert.deepEqual(run(f), original);
});

test('已确认时长与新订单可组合求值，缺状态和旧候选状态仍拒绝', () => {
  const f = fixture(['可露希尔', '芬']);
  const formulaId = Object.keys(catalog.manufactFormulas).find(id => catalog.manufactFormulas[id].itemId === '3003');
  f.snapshot.rooms[0].occupants = [1];
  f.snapshot.rooms.push({ slot: 'm', type: 'MANUFACTURE', level: 3, capacity: 3, occupants: [2], formulaId });
  f.assignment = { t: [1], m: [2] };
  const state = { scenario: 'confirmed-current-state', assignment: structuredClone(f.assignment), completedWorkHours: { 2: 5 } };
  const combined = evaluateNewOrderCandidate(f.snapshot, f.assignment, catalog, scenario, state);
  near(combined.modifiers.rooms.m.production, 0.25);
  near(combined.rooms.t.meanLmd, 1200);
  assert.ok(combined.objective.limitations.includes('STATE_PROVENANCE_AND_TIMING_UNCONFIRMED'));
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  state.completedWorkHours = {};
  assert.throws(() => evaluateNewOrderCandidate(f.snapshot, f.assignment, catalog, scenario, state), { code: 'MISSING_MECHANISM_STATE' });
  state.assignment.m = [];
  assert.throws(() => evaluateNewOrderCandidate(f.snapshot, f.assignment, catalog, scenario, state), { code: 'STATE_ASSIGNMENT_MISMATCH' });
});

test('复用完整穷举保留高收入高消耗与低收入零消耗，独立检查前沿', () => {
  const f = fixture(['可露希尔', '佩佩']);
  f.snapshot.rooms[0].capacity = 1; f.snapshot.rooms[0].occupants = [];
  const evaluate = assignment => evaluateNewOrderCandidate(f.snapshot, assignment, catalog, scenario).objective;
  const result = searchAssignments(f.snapshot, catalog, evaluate, { maxNodes: 1000 });
  assert.equal(result.exhausted, true);
  assert.deepEqual(result.frontier.map(item => item.assignment.t).sort(), [[1], [2]]);
  const closure = result.frontier.find(item => item.assignment.t[0] === 1).score;
  const pepe = result.frontier.find(item => item.assignment.t[0] === 2).score;
  assert.ok(closure.primary[0] < pepe.primary[0]);
  assert.ok(closure.primary[1] > pepe.primary[1]);
  near(closure.primary[0], -0.925); near(closure.primary[1], 555);
  near(pepe.primary[0], 0); near(pepe.primary[1], 1000 / 4.5);
});
