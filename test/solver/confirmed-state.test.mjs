import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { fileURLToPath } from 'node:url';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { compileBuff } from '../../src/mechanisms/compile.mjs';
import { confirmedStateRules } from '../../src/mechanisms/confirmed-state-rules.mjs';
import { evaluateConfirmedStateCandidate, applyConfirmedDormEntry } from '../../src/solver/confirmed-state.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function fixture(buffIds, type = catalog.buffs[buffIds[0]].roomType) {
  const baseId = Object.keys(catalog.chars)[0];
  const chars = { ...catalog.chars };
  const operators = buffIds.map((buffId, i) => {
    const charId = `char_confirmed_${i}`;
    chars[charId] = { ...catalog.chars[baseId], buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] };
    return { instId: i + 1, charId, evolvePhase: 0, level: 1, ap: 3600000 };
  });
  const room = { slot: 'r', type, level: 3, capacity: Math.max(3, operators.length), comfort: 3000,
    occupants: operators.map(op => op.instId), formulaId: '1', strategy: 'O_GOLD' };
  const snapshot = { operators, rooms: [room], facilities: [{ ...room, state: 2 }], reservedIds: [] };
  const assignment = { r: operators.map(op => op.instId) };
  const state = { scenario: 'confirmed-current-state', assignment: structuredClone(assignment) };
  return { snapshot, assignment, state, data: { ...catalog, chars } };
}
const run = f => evaluateConfirmedStateCandidate(f.snapshot, f.assignment, f.data, f.state);

for (const id of Object.keys(confirmedStateRules)) test(`条件登记不改变默认编译：${id}`, () => {
  assert.equal(compileBuff(catalog.buffs[id], catalog.characterNames).status, 'unsupported');
});

test('真实刻俄柏与崖心按解锁和已确认状态求值，练度回退、换位不复用旧状态', () => {
  const operators = ['刻俄柏', '崖心'].map((name, i) => ({ instId: i + 1,
    charId: Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name),
    evolvePhase: 0, level: 1, ap: 3600000 }));
  const rooms = [
    { slot: 'm', type: 'MANUFACTURE', level: 3, capacity: 3, occupants: [1], formulaId: '1' },
    { slot: 'd', type: 'DORMITORY', level: 3, capacity: 5, comfort: 3000, occupants: [2] },
  ];
  const snapshot = { operators, rooms, reservedIds: [], facilities: rooms.map(room => ({ ...room, state: 2 })) };
  const assignment = { m: [1], d: [2] };
  const state = { scenario: 'confirmed-current-state', assignment: structuredClone(assignment),
    completedWorkHours: { 1: 5 }, dormTargets: { 2: null } };
  const value = () => evaluateConfirmedStateCandidate(snapshot, assignment, catalog, state);
  for (const [phase, expected] of [[0, 0], [2, 0.25], [0, 0]]) {
    operators[0].evolvePhase = phase;
    near(value().modifiers.rooms.m.production ?? 0, expected);
    near(value().modifiers.operators[2].moodRecovery, 0.5);
  }
  assignment.m = []; assignment.d = [2, 1];
  assert.throws(value, { code: 'STATE_ASSIGNMENT_MISMATCH' });
  state.assignment = structuredClone(assignment);
  const rest = value();
  near(rest.modifiers.rooms.m.production ?? 0, 0);
  assert.ok(rest.objective.limitations.includes('CONFIRMED_ASSIGNMENT_ONLY'));
});

test('条件求值仍拒绝重复人员、超容量和保留岗位挪用', () => {
  const f = fixture(['dorm_rec_single[000]', 'dorm_rec_all[000]']);
  f.state.dormTargets = { 1: 2 };
  f.assignment.r = [1, 1]; f.state.assignment = structuredClone(f.assignment);
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
  f.assignment.r = [1, 2]; f.state.assignment = structuredClone(f.assignment);
  f.snapshot.rooms[0].capacity = 1;
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
  f.snapshot.rooms[0].capacity = 3; f.snapshot.reservedIds = [1];
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
});

for (const [id, stat, at0, at1, at5, at12] of [
  ['manu_prod_cost_min[001]', 'production', 0, 0, 0, 0.1],
  ['manu_prod_spd_addition[030]', 'production', 0.2, 0.21, 0.25, 0.25],
  ['manu_prod_spd_addition[031]', 'production', 0.2, 0.21, 0.25, 0.25],
  ['manu_prod_spd_addition[040]', 'production', 0.15, 0.17, 0.25, 0.25],
  ['manu_prod_spd_addition[041]', 'production', 0.15, 0.17, 0.25, 0.25],
  ['manu_prod_spd_addition[100]', 'production', 0, 0.02, 0.1, 0.2],
  ['meet_spd_hast[000]', 'clueSpeed', 0.2, 0.22, 0.3, 0.3],
  ['power_rec_spd&addition[000]', 'droneSpeed', 0.1, 0.11, 0.15, 0.15],
  ['power_rec_spd&addition[001]', 'droneSpeed', 0.15, 0.16, 0.2, 0.2],
]) test(`已确认完整小时条件：${id}`, () => {
  const f = fixture([id]);
  for (const [hours, value] of [[0, at0], [1, at1], [5, at5], [12, at12], [10000, at12]]) {
    f.state.completedWorkHours = { 1: hours };
    near(run(f).modifiers.rooms.r[stat], value);
  }
  assert.throws(() => evaluateModifiers(f.snapshot, f.assignment, f.data), { code: 'UNSUPPORTED_MECHANISM' });
});

for (const id of ['meet_spd&exchange[000]', 'meet_spd&exchange[001]', 'meet_spd&exchange[999]']) {
  test(`明确交流状态：${id}`, () => {
    const f = fixture([id]);
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
    f.state.clueExchangeActive = false;
    near(run(f).modifiers.rooms.r.clueSpeed, 0);
    f.state.clueExchangeActive = true;
    near(run(f).modifiers.rooms.r.clueSpeed, 0.3);
  });
}

test('三个中枢训练来源取最高，训练活动状态必须明确', () => {
  const f = fixture(['control_train_spd[010]', 'control_train_spd[011]', 'control_train_spd[012]']);
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  f.state.trainingActive = true;
  near(run(f).trainingSpeedBonus, 0.05);
  f.state.trainingActive = false;
  near(run(f).trainingSpeedBonus, 0);
});

for (const [id, target, self] of [
  ['dorm_rec_single[000]', 0.65, 0], ['dorm_rec_single[001]', 0.65, 0],
  ['dorm_rec_single[010]', 0.55, 0], ['dorm_rec_single[1010]', 0.55, 0],
  ['dorm_rec_single_power[100]', 0.55, 0], ['dorm_rec_single[020]', 0.75, 0],
  ['dorm_rec_single[030]', 0.7, 0], ['dorm_rec_single[031]', 0.7, 0],
  ['dorm_rec_single[032]', 0.7, 0], ['dorm_rec_single[033]', 0.7, 0],
  ['dorm_rec_single&oneself[000]', 0.2, 0.4], ['dorm_rec_single&oneself[001]', 0.25, 0.5],
  ['dorm_rec_single&oneself[010]', 0.3, 0.3], ['dorm_rec_single&oneself[011]', 0.35, 0.35],
  ['dorm_rec_single&oneself[012]', 0.35, 0.35], ['dorm_rec_single&oneself[020]', 0.4, 0.2],
  ['dorm_rec_single&oneself[021]', 0.5, 0.25], ['dorm_rec_single&oneself[030]', 0.5, 0.25],
  ['dorm_rec_single&oneself[040]', 0.4, 0.4],
]) test(`锁定目标及自身完整效果：${id}`, () => {
  const f = fixture([id, 'dorm_rec_all[000]']);
  f.state.dormTargets = { 1: 2 };
  const result = run(f);
  near(result.modifiers.operators[2].moodRecovery, target + 0.1);
  near(result.modifiers.operators[1].moodRecovery, self + 0.1);
  f.state.dormTargets[1] = null;
  near(run(f).modifiers.operators[2].moodRecovery, 0.1);
});

test('均摊恢复仅一人未满时与单体取最高，多人未满时归群体', () => {
  const f = fixture(['dorm_rec_single[000]', 'dorm_rec_all&single[000]', 'dorm_rec_all[000]']);
  f.state.dormTargets = { 1: 3 };
  for (const op of f.snapshot.operators.slice(0, 2)) op.ap = f.data.chars[op.charId].maxManpower;
  near(run(f).modifiers.operators[3].moodRecovery, 0.9);
  f.snapshot.operators[1].ap = 3600000;
  near(run(f).modifiers.operators[3].moodRecovery, 1.05);
});

test('同目标单体取最高且与群体叠加，已满锁定对象不重新选人', () => {
  const f = fixture(['dorm_rec_single[000]', 'dorm_rec_single[020]', 'dorm_rec_all[020]']);
  f.state.dormTargets = { 1: 3, 2: 3 };
  near(run(f).modifiers.operators[3].moodRecovery, 0.95);
  f.snapshot.operators[2].ap = f.data.chars[f.snapshot.operators[2].charId].maxManpower;
  const full = run(f);
  near(full.mood[3].changePerHour, 0);
  near(full.modifiers.operators[1].moodRecovery, 0.2);
  f.state.dormTargets = { 1: 2, 2: 1 };
  near(run(f).modifiers.operators[1].moodRecovery, 0.95);
  near(run(f).modifiers.operators[2].moodRecovery, 0.85);
});

for (const [id, field, identity] of [
  ['dorm_rec_single_P[000]', 'name', '锡兰'], ['dorm_rec_single_P[001]', 'name', '嘉维尔'],
  ['dorm_rec_single_P[002]', 'name', '蓝毒'], ['dorm_rec_single_power[000]', 'faction', '萨米'],
  ['dorm_rec_single_power[001]', 'faction', '拉特兰'], ['dorm_rec_single&tag[000]', 'group', 'cc.tag.mh'],
]) test(`条件宿舍身份加成：${id}`, () => {
  const f = fixture([id, 'dorm_rec_all[000]']);
  const charId = f.snapshot.operators[1].charId;
  f.state.dormTargets = { 1: 2 };
  f.data.characterNames = { ...f.data.characterNames, [charId]: '普通干员' };
  f.data.characterAffiliations = { ...f.data.characterAffiliations, [charId]: [] };
  near(run(f).modifiers.operators[2].moodRecovery, 0.65);
  if (field === 'name') f.data.characterNames[charId] = identity;
  if (field === 'faction') f.data.characterAffiliations[charId] = [identity];
  if (field === 'group') f.data.operatorGroups = { ...f.data.operatorGroups, [identity]: [charId] };
  near(run(f).modifiers.operators[2].moodRecovery, 1.1);
  if (field === 'group') {
    f.data.operatorGroups = { ...f.data.operatorGroups, 'cc.tag.mh': [], 'cc.tag.mh2': [charId] };
    near(run(f).modifiers.operators[2].moodRecovery, 1.1);
    delete f.data.operatorGroups['cc.tag.mh2'];
  } else if (field === 'name') delete f.data.characterNames[charId];
  else delete f.data.characterAffiliations[charId];
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('小节来源和单体恢复完整求值，无锁定目标时仍生成资源', () => {
  const f = fixture(['dorm_rec_bd_n1_n3[000]', 'dorm_rec_bd_n1[100]', 'dorm_rec_all&bd[000]', 'trade_ord_spd_bd_n1[000]']);
  f.snapshot.rooms[0].occupants = [1, 2, 3];
  f.snapshot.rooms.push({ slot: 'trade', type: 'TRADING', level: 3, capacity: 3, occupants: [4], strategy: 'O_GOLD' });
  f.assignment = { r: [1, 2, 3], trade: [4] };
  f.state.assignment = structuredClone(f.assignment);
  f.state.dormTargets = { 1: 2 };
  // 三名宿舍人员+三级宿舍小节→感知→共鸣，总计6，群体恢复为0.21。
  near(run(f).modifiers.operators[2].moodRecovery, 0.86);
  near(run(f).modifiers.operators[1].moodRecovery, 0.21);
  f.state.dormTargets[1] = null;
  near(run(f).modifiers.operators[2].moodRecovery, 0.21);
  f.snapshot.rooms[0].level = 1;
  near(run(f).modifiers.operators[2].moodRecovery, 0.2);
});

test('蓝毒目标文案允许自身，其他单体恢复拒绝自身', () => {
  const f = fixture(['dorm_rec_single_P[002]']);
  f.state.dormTargets = { 1: 1 };
  f.data.characterNames = { ...f.data.characterNames, [f.snapshot.operators[0].charId]: '蓝毒' };
  near(run(f).modifiers.operators[1].moodRecovery, 1);
});

test('推进之王恢复增强按接收者阵营计算，与其他群体技能仍取最高', () => {
  const f = fixture(['dorm_rec_toone[000]', 'dorm_rec_all[013]', 'dorm_rec_all[000]', 'dorm_rec_all[000]']);
  const ids = f.snapshot.operators.map(o => o.charId);
  f.data.characterNames = { ...f.data.characterNames, [ids[0]]: '摩根', [ids[1]]: '推进之王', [ids[2]]: '普通', [ids[3]]: '普通2' };
  f.data.characterAffiliations = { ...f.data.characterAffiliations,
    [ids[0]]: ['格拉斯哥帮'], [ids[1]]: ['格拉斯哥帮'], [ids[2]]: ['格拉斯哥帮'], [ids[3]]: [] };
  const value = run(f);
  near(value.modifiers.operators[0 + 1].moodRecovery, 0.45);
  near(value.modifiers.operators[2].moodRecovery, 0.45);
  near(value.modifiers.operators[3].moodRecovery, 0.45);
  near(value.modifiers.operators[4].moodRecovery, 0.15);
  f.data.characterNames[ids[1]] = '其他干员';
  near(run(f).modifiers.operators[3].moodRecovery, 0.15);
});

test('明确进驻事件只交换原始心情，未满不交换且不修改传入快照', () => {
  const f = fixture(['dorm_exchangeAp[000]', 'dorm_rec_all[000]']);
  f.snapshot.operators[0].ap = 8640000;
  f.snapshot.operators[1].ap = 720000;
  const event = { scenario: 'confirmed-dorm-entry', assignment: f.assignment, sourceId: 1, previousId: 2 };
  const result = applyConfirmedDormEntry(f.snapshot, f.assignment, f.data, event);
  assert.deepEqual(result.operators.map(o => o.ap), [720000, 8640000]);
  assert.deepEqual(f.snapshot.operators.map(o => o.ap), [8640000, 720000]);
  assert.deepEqual(applyConfirmedDormEntry(result, f.assignment, f.data, event).operators.map(o => o.ap), [720000, 8640000]);
  assert.throws(() => applyConfirmedDormEntry(f.snapshot, f.assignment, f.data, { ...event, previousId: 1 }), { code: 'MISSING_MECHANISM_STATE' });
  assert.throws(() => applyConfirmedDormEntry(f.snapshot, f.assignment, f.data, { ...event, previousId: 99 }), { code: 'MISSING_MECHANISM_STATE' });
  f.state.resolvedEntryEventIds = [1];
  near(run(f).modifiers.operators[1].moodRecovery, 0.1);
  delete f.state.resolvedEntryEventIds;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

for (const [id, faction] of [
  ['meet_spd&condChar_mustget[000]', '莱茵生命'],
  ['meet_spd&condChar_mustget[100]', '罗德岛制药'],
]) test(`明确独处消耗的下一次线索保底：${id}`, () => {
  const f = fixture([id]);
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  for (const [consumed, expected] of [[0, null], [16, null], [16.001, faction], [24, faction]]) {
    f.state.soloConsumedMood = { 1: consumed };
    assert.equal(run(f).clueGuarantees[0].faction, expected);
  }
  for (const invalid of [-1, '17', NaN, Infinity]) {
    f.state.soloConsumedMood = { 1: invalid };
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  }
  const multi = fixture([id, 'meet_spd[010]']);
  multi.state.soloConsumedMood = { 1: 17 };
  assert.equal(run(multi).clueGuarantees[0].faction, null);
  assert.ok(run(multi).limitations.includes('CLUE_VALUE_NOT_RANKED'));
});

test('缺状态、非整数小时、错误目标、旧候选状态、数据漂移均拒绝', () => {
  const f = fixture(['manu_prod_spd_addition[030]']);
  for (const value of [undefined, null, -1, 0.5, '1', Infinity, NaN]) {
    f.state.completedWorkHours = { 1: value };
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  }
  f.state.completedWorkHours = { 1: 1 };
  f.state.assignment.r = [];
  assert.throws(() => run(f), { code: 'STATE_ASSIGNMENT_MISMATCH' });
  f.state.assignment = structuredClone(f.assignment);
  f.state.scenario = undefined;
  assert.throws(() => run(f), { code: 'STATE_SCENARIO_REQUIRED' });
  const d = fixture(['dorm_rec_single[000]', 'dorm_rec_all[000]']);
  for (const value of [undefined, 1, 3, '2']) {
    d.state.dormTargets = { 1: value };
    assert.throws(() => run(d), { code: 'MISSING_MECHANISM_STATE' });
  }
  d.state.dormTargets = { 1: 2 };
  for (const patch of [{ description: '改变文案' }, { roomType: 'POWER' }]) {
    const data = { ...d.data, buffs: { ...d.data.buffs,
      'dorm_rec_single[000]': { ...d.data.buffs['dorm_rec_single[000]'], ...patch } } };
    assert.throws(() => run({ ...d, data }), { code: 'UNSUPPORTED_MECHANISM' });
  }
  assert.ok(run(d));
});
