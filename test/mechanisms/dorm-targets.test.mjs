import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { evaluateModifiers, createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';
import { evaluateMood } from '../../src/mechanisms/mood.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const goldenCases = [
  ['dorm_rec_single_P[000]', 0.55, 0], ['dorm_rec_single_P[001]', 0.55, 0],
  ['dorm_rec_single_P[002]', 0.55, 0], ['dorm_rec_single_power[000]', 0.55, 0],
  ['dorm_rec_single_power[001]', 0.55, 0], ['dorm_rec_single&tag[000]', 0.55, 0],
  ['dorm_rec_bd_n1_n3[000]', 0.65, 0], ['dorm_rec_single[000]', 0.65, 0],
  ['dorm_rec_single[001]', 0.65, 0], ['dorm_rec_single[010]', 0.55, 0],
  ['dorm_rec_single[1010]', 0.55, 0], ['dorm_rec_single_power[100]', 0.55, 0],
  ['dorm_rec_single[020]', 0.75, 0], ['dorm_rec_single[030]', 0.7, 0],
  ['dorm_rec_single[031]', 0.7, 0], ['dorm_rec_single[032]', 0.7, 0],
  ['dorm_rec_single[033]', 0.7, 0], ['dorm_rec_single&oneself[000]', 0.2, 0.4],
  ['dorm_rec_single&oneself[001]', 0.25, 0.5], ['dorm_rec_single&oneself[010]', 0.3, 0.3],
  ['dorm_rec_single&oneself[011]', 0.35, 0.35], ['dorm_rec_single&oneself[012]', 0.35, 0.35],
  ['dorm_rec_single&oneself[020]', 0.4, 0.2], ['dorm_rec_single&oneself[021]', 0.5, 0.25],
  ['dorm_rec_single&oneself[030]', 0.5, 0.25], ['dorm_rec_single&oneself[040]', 0.4, 0.4],
];
function fixture(buffId = 'dorm_rec_single[000]') {
  const chars = { ...catalog.chars,
    source: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] },
    plain: { maxManpower: 8640000, buffChar: [] } };
  const data = { ...catalog, chars, characterNames: { ...catalog.characterNames, source: '来源', plain: '普通目标' },
    characterAffiliations: { ...catalog.characterAffiliations, source: [], plain: [] } };
  const snapshot = { operators: [1, 2, 3, 4].map(instId => ({ instId, charId: instId === 1 ? 'source' : 'plain',
    evolvePhase: 0, level: 1, ap: instId === 1 ? 8640000 : 3600000 })),
    rooms: [{ slot: 'd', type: 'DORMITORY', level: 3, capacity: 5, comfort: 3000, occupants: [], originalSeats: [] }],
    reservedIds: [], facilities: [] };
  return { snapshot, data };
}
for (const [id, target, self] of goldenCases) test(`默认单体独立数值 ${id}`, () => {
  const { snapshot, data } = fixture(id);
  snapshot.operators[2].ap = 0;
  const before = structuredClone(snapshot);
  const evaluate = createIsolatedEvaluator(snapshot, data);
  const result = evaluate({ d: [1, 2, 3] });
  near(result.operators[2].moodRecovery ?? 0, target);
  near(result.operators[1].moodRecovery ?? 0, self);
  near(result.operators[3].moodRecovery ?? 0, 0);
  assert.deepEqual(result.diagnostics.excludedIds, []);
  evaluate({ d: [] });
  assert.deepEqual(evaluate({ d: [1, 2, 3] }), result);
  assert.deepEqual(snapshot, before);
});
test('缺失全局心情上限不能伪装成可跳过的候选歧义', () => {
  for (const buffId of ['dorm_rec_single[000]', 'dorm_exchangeAp[000]']) {
    const { snapshot, data } = fixture(buffId);
    delete data.chars.source.maxManpower;
    assert.throws(() => evaluateModifiers(snapshot, { d: [2, 1] }, data),
      error => error.code === 'DATA_NOT_READY' && error.candidateDependent !== true);
  }
});

test('后入驻选择已有人员中唯一最低心情，不选更晚的新最低者', () => {
  const { snapshot, data } = fixture();
  snapshot.operators[1].ap = 3600000;
  snapshot.operators[2].ap = 1800000;
  snapshot.operators[3].ap = 0;
  const result = evaluateModifiers(snapshot, { d: [2, 3, 1, 4] }, data);
  near(result.operators[3].moodRecovery, 0.65);
  near(result.operators[2].moodRecovery ?? 0, 0);
  near(result.operators[4].moodRecovery ?? 0, 0);
});
test('保留原来源且唯一未满目标保持绑定，新入驻低心情不抢目标', () => {
  const { snapshot, data } = fixture();
  snapshot.rooms[0].occupants = [1, 2]; snapshot.rooms[0].originalSeats = [1, 2];
  snapshot.operators[2].ap = 0;
  near(evaluateModifiers(snapshot, { d: [1, 2, 3] }, data).operators[2].moodRecovery, 0.65);
});
test('保留来源的多个历史目标不可从当前最低心情反推；新候选同值也不猜', () => {
  const { snapshot, data } = fixture();
  snapshot.rooms[0].occupants = [1, 2, 3]; snapshot.rooms[0].originalSeats = [1, 2, 3];
  assert.deepEqual(planIsolation(snapshot, data).frozenSlots, ['d']);
  snapshot.rooms[0].occupants = []; snapshot.rooms[0].originalSeats = [];
  assert.throws(() => evaluateModifiers(snapshot, { d: [2, 3, 1] }, data),
    error => error.code === 'MISSING_MECHANISM_STATE' && error.candidateDependent === true);
  near(evaluateModifiers(snapshot, { d: [1, 2, 3] }, data).operators[2].moodRecovery, 0.65);
});
test('旧房间存在已满人员时不能排除其历史锁定，只剩一个未满人也不反推', () => {
  const { snapshot, data } = fixture();
  snapshot.rooms[0].occupants = [1, 2, 3]; snapshot.rooms[0].originalSeats = [1, 2, 3];
  snapshot.operators[2].ap = 8640000;
  assert.deepEqual(planIsolation(snapshot, data).frozenSlots, ['d']);
});

test('来源换位不转移仍在原座位的绑定目标；目标变更位置释放旧绑定', () => {
  const { snapshot, data } = fixture();
  snapshot.rooms[0].occupants = [1, 2]; snapshot.rooms[0].originalSeats = [1, 2];
  snapshot.operators[2].ap = 1800000;
  const retained = evaluateModifiers(snapshot, { d: [3, 2, 1] }, data);
  near(retained.operators[2].moodRecovery, 0.65);
  near(retained.operators[3].moodRecovery ?? 0, 0);
  const moved = evaluateModifiers(snapshot, { d: [1, 3, 2] }, data);
  near(moved.operators[3].moodRecovery, 0.65);
  near(moved.operators[2].moodRecovery ?? 0, 0);
});
test('空位保持物理索引；满心情目标不提供虚构恢复；蓝毒例外可作用自身', () => {
  const { snapshot, data } = fixture();
  snapshot.rooms[0].originalSeats = [-1, 2]; snapshot.rooms[0].occupants = [2];
  near(evaluateModifiers(snapshot, { d: [1, 2] }, data).operators[2].moodRecovery, 0.65);
  for (const op of snapshot.operators) op.ap = 8640000;
  const full = evaluateModifiers(snapshot, { d: [1, 2, 3] }, data);
  assert.ok(Object.values(full.operators).every(value => !value.moodRecovery));
  const f = fixture('dorm_rec_single_P[002]');
  f.snapshot.operators[0].ap = 0;
  f.data.characterNames.source = '蓝毒';
  near(evaluateModifiers(f.snapshot, { d: [1, 2] }, f.data).operators[1].moodRecovery, 1);
});

test('跨房移出原锁定目标时不猜房间执行先后；不相关移出不能打断保留绑定', () => {
  const { snapshot, data } = fixture();
  snapshot.operators.push(...[5, 6, 7].map(instId => ({ instId, charId: 'plain', evolvePhase: 0, level: 1,
    ap: instId === 5 ? 8640000 : instId === 6 ? 3600000 : 0 })));
  snapshot.operators[2].ap = 8640000; snapshot.operators[3].ap = 8640000;
  snapshot.rooms[0].occupants = [1, 2]; snapshot.rooms[0].originalSeats = [1, -1, -1, -1, 2];
  snapshot.rooms.push({ slot: 'm', type: 'MANUFACTURE', level: 3, capacity: 3, formulaId: '1', occupants: [] });
  assert.throws(() => evaluateModifiers(snapshot, { d: [1, 6, 7, 5], m: [2] }, data),
    error => error.code === 'MISSING_MECHANISM_STATE' && error.candidateDependent === true);
  snapshot.rooms[0].occupants = [1, 3, 4, 5, 2]; snapshot.rooms[0].originalSeats = [1, 3, 4, 5, 2];
  snapshot.operators[0].confirmedDormTarget = 2;
  near(evaluateModifiers(snapshot, { d: [1, 6, 4, 5, 2], m: [3] }, data).operators[2].moodRecovery, 0.65);
});

test('满心情交换只在可证的新进驻触发，物理恢复使用交换后值且候选不串状态', () => {
  const { snapshot, data } = fixture('dorm_exchangeAp[000]');
  const before = structuredClone(snapshot);
  const evaluate = createIsolatedEvaluator(snapshot, data);
  const assignment = { d: [2, 1] };
  const result = evaluate(assignment);
  assert.deepEqual(result.entryAp, { 1: 3600000, 2: 8640000 });
  assert.equal(result.entryEvents.length, 1);
  assert.equal(result.entryEvents[0].previousId, 2);
  const mood = evaluateMood(snapshot, assignment, data, result);
  near(mood[1].current, 10);
  near(mood[2].current, 24);
  near(mood[2].changePerHour, 0);
  assert.ok(mood[1].changePerHour > 0);
  assert.deepEqual(evaluate({ d: [1, 2] }).entryEvents ?? [], []);
  result.entryEvents[0].previousId = 99;
  result.entryAp[1] = 0;
  assert.equal(evaluate(assignment).entryEvents[0].previousId, 2);
  assert.deepEqual(snapshot, before);
  snapshot.rooms[0].occupants = [2, 1]; snapshot.rooms[0].originalSeats = [2, 1];
  assert.deepEqual(evaluateModifiers(snapshot, assignment, data).entryEvents ?? [], []);
  snapshot.rooms[0].occupants = []; snapshot.rooms[0].originalSeats = [];
  snapshot.operators[0].ap = 720000;
  assert.deepEqual(evaluateModifiers(snapshot, assignment, data).entryEvents ?? [], []);
});
test('前一位只可由唯一旧人或确定的新进驻事件推导，不把座位顺序当旧历史', () => {
  const { snapshot, data } = fixture('dorm_exchangeAp[000]');
  snapshot.rooms[0].occupants = [2, 3]; snapshot.rooms[0].originalSeats = [2, 3];
  assert.throws(() => evaluateModifiers(snapshot, { d: [2, 3, 1] }, data),
    error => error.code === 'MISSING_MECHANISM_STATE' && error.candidateDependent === true);
  const result = evaluateModifiers(snapshot, { d: [4, 3, 1] }, data);
  assert.equal(result.entryEvents[0].previousId, 4);
  near(result.entryAp[3] ?? snapshot.operators[2].ap, 3600000);
  snapshot.rooms[0].occupants = [2]; snapshot.rooms[0].originalSeats = [2];
  assert.equal(evaluateModifiers(snapshot, { d: [2, 1] }, data).entryEvents[0].previousId, 2);
});
test('交换使原目标回满的自动迁移未证实时跳过；显式已绑定目标仍遵守给定状态', () => {
  const { snapshot, data } = fixture('dorm_exchangeAp[000]');
  data.chars.healer = { maxManpower: 8640000, buffChar: [{ buffData: [
    { buffId: 'dorm_rec_single[000]', cond: { phase: 0, level: 1 } }] }] };
  snapshot.operators[2].charId = 'healer'; snapshot.operators[2].ap = 8640000;
  assert.throws(() => evaluateModifiers(snapshot, { d: [3, 2, 1] }, data),
    error => error.code === 'MISSING_MECHANISM_STATE' && error.candidateDependent === true);
  snapshot.operators[2].confirmedDormTarget = 2;
  const result = evaluateModifiers(snapshot, { d: [3, 2, 1] }, data);
  near(result.operators[1].moodRecovery ?? 0, 0);
  near(result.operators[2].moodRecovery, 0.65);
  near(evaluateMood(snapshot, { d: [3, 2, 1] }, data, result)[2].changePerHour, 0);
  assert.deepEqual(result.entryAp, { 1: 3600000, 2: 8640000 });
});
