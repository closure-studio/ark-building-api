import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedEvaluator, evaluateModifiers } from '../fixtures/mechanisms.mjs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';

// 人工值只描述技能增量，不把它冒充设施基础速率或协议ProdSpeed。
function fixture(specs, rooms) {
  const chars = {}, buffs = {};
  const operators = specs.map(([id, roomType, description]) => {
    const charId = `char_${id}`, buffId = `buff_${id}`;
    chars[charId] = { buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] };
    buffs[buffId] = { buffId, roomType, description };
    return { instId: id, charId, evolvePhase: 0, level: 1, ap: 8640000 };
  });
  const snapshot = { operators, reservedIds: [], rooms: rooms.map(([slot, type, level, occupants]) => ({
    slot, type, level, occupants, capacity: 5,
  })) };
  const assignment = Object.fromEntries(snapshot.rooms.map(r => [r.slot, r.occupants]));
  return { snapshot, assignment, catalog: { chars, buffs, tiredApThreshold: 100 } };
}
const run = f => evaluateModifiers(f.snapshot, f.assignment, f.catalog);

test('热情值合计固定与宿舍人数来源，40点门槛和配方目标随换岗重算', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，热情值+20；每有8点热情值，自身心情每小时消耗+0.01，所有贸易站订单效率+1%（同种效果取最高）'],
    [2, 'CONTROL', '进驻控制中枢时，热情值+10；会客室线索搜集速度提升+5%（同种效果取最高）'],
    [3, 'CONTROL', '进驻控制中枢时，热情值+10；人脉资源的联络速度+10%（同种效果取最高）'],
    [4, 'CONTROL', '进驻控制中枢时，宿舍内每有1名干员，热情值+1'],
    [5, 'CONTROL', '进驻控制中枢时，所有生产贵金属类配方的制造站生产力+1%，每有20点热情值，所有生产贵金属类配方的制造站生产力+1%'],
    [6, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.1'],
  ], [['c', 'CONTROL', 5, [1, 2, 3, 4, 5]], ['g', 'MANUFACTURE', 3, []],
    ['e', 'MANUFACTURE', 3, []], ['t', 'TRADING', 3, []], ['r', 'MEETING', 3, []],
    ['h', 'HIRE', 3, []], ['d', 'DORMITORY', 5, [6]]]);
  for (const [id, slot] of [[7, 'g'], [8, 'e'], [9, 't'], [10, 'r'], [11, 'h']]) {
    const charId = `char_${id}`;
    f.catalog.chars[charId] = { buffChar: [] };
    f.snapshot.operators.push({ instId: id, charId, evolvePhase: 0, level: 1, ap: 8640000 });
    f.snapshot.rooms.find(r => r.slot === slot).occupants.push(id);
  }
  f.catalog.buffs.pressure = { buffId: 'pressure', roomType: 'CONTROL',
    description: '进驻控制中枢时，热情值处于40点及以上时，自身心情每小时消耗+0.05' };
  f.catalog.chars.char_5.buffChar.push({ buffData: [{ buffId: 'pressure', cond: { phase: 0, level: 1 } }] });
  f.snapshot.rooms.find(r => r.slot === 'g').formulaId = 'gold';
  f.snapshot.rooms.find(r => r.slot === 'e').formulaId = 'exp';
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' }, exp: { buffType: 'M_EXP' } };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [c, d, gold, trade, pressure, selfCost] of [
    [[1, 2, 3, 4, 5], [6], 0.03, 0.05, 0.05, 0.05],
    [[1, 2, 3, 4, 5], [], 0.03, 0.05, 0.05, 0.05],
    [[1, 2, 4, 5], [3, 6], 0.02, 0.04, 0, 0.04],
    [[1, 2, 5], [3, 4, 6], 0.02, 0.03, 0, 0.03],
    [[5], [1, 2, 3, 4, 6], 0.01, 0, 0, 0],
    [[1, 2, 3, 4, 5], [6], 0.03, 0.05, 0.05, 0.05],
  ]) {
    const result = evaluate({ ...f.assignment, c, d });
    assert.ok(Math.abs(result.rooms.g.production - gold) < 1e-12);
    assert.equal(result.rooms.e.production ?? 0, 0);
    assert.equal(result.rooms.t.orderSpeed ?? 0, trade);
    assert.equal(result.operators[5].moodCost ?? 0, pressure);
    assert.equal(result.operators[1].moodCost ?? 0, selfCost);
    assert.equal(result.rooms.r.clueSpeed ?? 0, c.includes(2) ? 0.05 : 0);
    assert.equal(result.rooms.h.contactSpeed ?? 0, c.includes(3) ? 0.1 : 0);
  }
});

test('中枢阵营点数相互独立，只统计在岗成员且换岗后重算消费者', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，控制中枢内每有1名彩虹小队干员，则情报储备+1'],
    [2, 'CONTROL', '进驻控制中枢时，控制中枢内每有1名乌萨斯学生自治团干员，则乌萨斯特饮+1'],
    [3, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+20%，每1点情报储备额外+5%联络速度，每1瓶乌萨斯特饮额外+5%联络速度'],
    [4, 'MEETING', '进驻会客室时，线索搜集速度提升5%，同时每1点情报储备额外提升5%'],
    [5, 'MANUFACTURE', '进驻制造站时，生产力+20%，每有1瓶乌萨斯特饮，则仓库容量上限+2'],
    [6, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗-0.1'],
  ], [['h', 'HIRE', 3, [3]], ['r', 'MEETING', 3, [4]], ['m', 'MANUFACTURE', 3, [5]],
    ['c', 'CONTROL', 5, [1, 2, 6]], ['d', 'DORMITORY', 5, []]]);
  f.catalog.characterAffiliations = { char_1: ['彩虹小队'], char_2: ['乌萨斯学生自治团'],
    char_3: ['彩虹小队'], char_4: [], char_5: ['乌萨斯学生自治团'], char_6: ['彩虹小队'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [c, d, contact, clue, capacity] of [
    [[1, 2, 6], [], 0.35, 0.15, 2],
    [[1, 2], [6], 0.3, 0.1, 2],
    [[2, 6], [1], 0.25, 0.05, 2],
    [[1, 6], [2], 0.3, 0.15, 0],
    [[], [1, 2, 6], 0.2, 0.05, 0],
    [[1, 2, 6], [], 0.35, 0.15, 2],
  ]) {
    const result = evaluate({ ...f.assignment, c, d });
    assert.ok(Math.abs(result.rooms.h.contactSpeed - contact) < 1e-12);
    assert.ok(Math.abs(result.rooms.r.clueSpeed - clue) < 1e-12);
    assert.equal(result.rooms.m.capacity, capacity);
    assert.equal(result.rooms.m.production, 0.2);
  }
  delete f.catalog.characterAffiliations.char_6;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('木天蓼两类来源相加，只数中枢小队成员，换岗后制造贸易同步重算', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗+0.5，木天蓼+8'],
    [2, 'CONTROL', '进驻控制中枢时，控制中枢内每有1名怪物猎人小队干员，则木天蓼+2'],
    [3, 'MANUFACTURE', '进驻制造站时，仓库容量上限+8，生产力+5%，同时每有1个木天蓼，则生产力+1%'],
    [4, 'TRADING', '进驻贸易站时，订单获取效率+5%，且订单上限+2，同时每有1个木天蓼，则订单获取效率+3%'],
  ], [['m', 'MANUFACTURE', 3, [3]], ['t', 'TRADING', 3, [4]],
    ['c', 'CONTROL', 5, [1, 2]], ['d', 'DORMITORY', 5, []]]);
  f.catalog.operatorGroups = { 'cc.tag.mh': ['char_1', 'char_2', 'char_3'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [assignment, production, orderSpeed] of [
    [f.assignment, 0.17, 0.41],
    [{ m: [3], t: [4], c: [2], d: [1] }, 0.07, 0.11],
    [{ m: [3], t: [4], c: [1], d: [2] }, 0.13, 0.29],
    [{ m: [3], t: [4], c: [], d: [1, 2] }, 0.05, 0.05],
    [f.assignment, 0.17, 0.41],
  ]) {
    const result = evaluate(assignment);
    assert.ok(Math.abs(result.rooms.m.production - production) < 1e-12);
    assert.ok(Math.abs(result.rooms.t.orderSpeed - orderSpeed) < 1e-12);
    assert.equal(result.rooms.m.capacity, 8);
    assert.equal(result.rooms.t.capacity, 2);
    assert.equal(result.operators[1].moodCost, assignment.c.includes(1) ? 0.5 : undefined);
  }
  f.snapshot.rooms.reverse();
  assert.ok(Math.abs(run(f).rooms.t.orderSpeed - 0.41) < 1e-12);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('条件包装的木天蓼来源在伙伴不在中枢时不产生点数', () => {
  const f = fixture([
    [1, 'CONTROL', '当与伙伴一起进驻控制中枢时，自身心情每小时消耗+0.5，木天蓼+8'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+0%'],
    [3, 'MANUFACTURE', '进驻制造站时，仓库容量上限+8，生产力+5%，同时每有1个木天蓼，则生产力+1%'],
  ], [['c', 'CONTROL', 5, [1]], ['m', 'MANUFACTURE', 3, [2, 3]]]);
  f.catalog.characterNames = { char_2: '伙伴' };
  assert.equal(run(f).rooms.m.production, 0.05);
  f.assignment = { c: [1, 2], m: [3] };
  assert.equal(run(f).rooms.m.production, 0.13);
});

test('工程机器人读取设施等级而非人数，包含训练加工且截断到64', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，基建内除活动室外每间设施每级+1个工程机器人，上限64个'],
    [2, 'MANUFACTURE', '进驻制造站时，每8个工程机器人+5%生产力'],
  ], [['m', 'MANUFACTURE', 3, [1, 2]], ['d', 'DORMITORY', 5, []]]);
  const facilities = [
    { slot: 'm', type: 'MANUFACTURE', level: 3, state: 2 },
    { slot: 'd', type: 'DORMITORY', level: 5, state: 2 },
    { slot: 'training', type: 'TRAINING', level: 3, state: 2 },
    { slot: 'workshop', type: 'WORKSHOP', level: 3, state: 2 },
    { slot: 'meeting', type: 'MEETING', level: 2, state: 2 },
    { slot: 'private', type: 'PRIVATE', level: 3, state: 2 },
  ];
  f.snapshot.facilities = facilities;
  assert.equal(run(f).rooms.m.production, 0.1);
  f.snapshot.facilities = facilities.filter(room => room.type !== 'TRAINING');
  assert.equal(run(f).rooms.m.production, 0.05);
  f.snapshot.facilities = [...facilities, ...Array.from({ length: 11 }, (_, index) => ({
    slot: `extra${index}`, type: 'DORMITORY', level: 5, state: 2,
  }))];
  assert.equal(run(f).rooms.m.production, 0.4);
  f.assignment = { m: [2], d: [1] };
  assert.equal(run(f).rooms.m.production, 0);
  f.assignment = { m: [1, 2], d: [] };
  assert.equal(run(f).rooms.m.production, 0.4);
  for (const bad of [undefined, [...facilities, facilities[0]],
    facilities.map(room => room.slot === 'training' ? { ...room, state: 1 } : room),
    facilities.map(room => room.slot === 'training' ? { ...room, level: NaN } : room),
    [...facilities, { slot: 'unknown', type: 'UNKNOWN', level: 1, state: 2 }]]) {
    f.snapshot.facilities = bad;
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  }
});

test('办公室共鸣只计额外招募位，离岗清除并拒绝不明设施状态', () => {
  const f = fixture([
    [1, 'HIRE', '进驻人力办公室时，每个招募位（不包含初始招募位）+15点无声共鸣'],
    [2, 'TRADING', '进驻贸易站时，每2点无声共鸣+1%订单效率'],
  ], [['h', 'HIRE', 3, [1]], ['t', 'TRADING', 3, [2]], ['d', 'DORMITORY', 5, []]]);
  for (const [level, expected] of [[1, 0], [2, 0.07], [3, 0.15]]) {
    f.snapshot.rooms[0].level = level;
    f.snapshot.facilities = [{ slot: 'h', type: 'HIRE', state: 2, level }];
    const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
    assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, expected);
    assert.equal(evaluate({ h: [], t: [2], d: [1] }).rooms.t.orderSpeed, 0);
    assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, expected);
  }
  for (const facilities of [undefined,
    [{ slot: 'h', type: 'HIRE', state: 1, level: 3 }],
    [{ slot: 'h', type: 'HIRE', state: 2, level: 4 }],
    [{ slot: 'h', type: 'HIRE', state: 2, level: 3 }, { slot: 'h2', type: 'HIRE', state: 2, level: 3 }]]) {
    f.snapshot.facilities = facilities;
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  }
});

test('无声共鸣按来源宿舍全部人数计数，分档恢复先合并再取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内每有1名干员，无声共鸣+1'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2，每有5点无声共鸣，该宿舍内所有干员的心情每小时恢复额外+0.01（同种效果取最高）'],
    [3, 'TRADING', '进驻贸易站时，每2点无声共鸣+1%订单效率'],
    [4, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.205（同种效果取最高）'],
    [5, 'POWER', '进驻发电站时，无人机充能速度+0%'],
    [6, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['t', 'TRADING', 3, [3]], ['d', 'DORMITORY', 5, [1, 2, 4, 5, 6]], ['d2', 'DORMITORY', 1, []]]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [assignment, speed, recovery] of [
    [f.assignment, 0.02, 0.21],
    [{ t: [3], d: [1, 2, 4, 5], d2: [6] }, 0.02, 0.205],
    [{ t: [3], d: [2, 4, 5, 6], d2: [1] }, 0, 0.205],
    [{ t: [1, 3], d: [2, 4, 5, 6], d2: [] }, 0, 0.205],
    [f.assignment, 0.02, 0.21],
  ]) {
    const result = evaluate(assignment);
    assert.equal(result.rooms.t.orderSpeed, speed);
    assert.ok(Math.abs(result.operators[2].moodRecovery - recovery) < 1e-12);
  }
});

test('宿舍等级产生料理供制造与贸易消费，换岗与房间遍历顺序不残留点数', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，当前宿舍每级提供1层魔物料理'],
    [2, 'MANUFACTURE', '进驻制造站时，每1点魔物料理+1%生产力'],
    [3, 'TRADING', '进驻贸易站时，每1点魔物料理+1%订单效率'],
  ], [['m', 'MANUFACTURE', 3, [2]], ['t', 'TRADING', 3, [3]],
    ['d', 'DORMITORY', 5, [1]], ['d2', 'DORMITORY', 2, []]]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [assignment, expected] of [
    [f.assignment, 0.05], [{ m: [2], t: [3], d: [], d2: [1] }, 0.02],
    [{ m: [1, 2], t: [3], d: [], d2: [] }, 0], [f.assignment, 0.05],
  ]) {
    const result = evaluate(assignment);
    assert.equal(result.rooms.m.production, expected);
    assert.equal(result.rooms.t.orderSpeed, expected);
  }
  f.snapshot.rooms.reverse();
  assert.equal(run(f).rooms.m.production, 0.05);
});

test('尚未支持的料理来源伙伴条件整条拒绝，不忽略条件产生点数', () => {
  const f = fixture([
    [1, 'DORMITORY', '当与伙伴一起进驻宿舍时，当前宿舍每级提供1层魔物料理'],
    [2, 'MANUFACTURE', '进驻制造站时，每1点魔物料理+1%生产力'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['m', 'MANUFACTURE', 3, [2, 3]], ['d', 'DORMITORY', 5, [1]]]);
  f.catalog.characterNames = { char_3: '伙伴' };
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  f.assignment = { m: [2], d: [1, 3] };
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
});

test('料理点数缺少来源为零，重复来源的未知叠加不猜测', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，当前宿舍每级提供1层魔物料理'],
    [2, 'DORMITORY', '进驻宿舍时，当前宿舍每级提供1层魔物料理'],
    [3, 'MANUFACTURE', '进驻制造站时，每1点魔物料理+1%生产力'],
  ], [['m', 'MANUFACTURE', 3, [3]], ['d', 'DORMITORY', 5, [1, 2]]]);
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  f.assignment.d = [];
  assert.equal(run(f).rooms.m.production, 0);
});

test('术语小队按全部贸易站人数加成，包含自身且换岗后重算', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，订单上限+3，且每有一个泡影国狩猎小队干员进驻贸易站，订单获取效率+20%'],
    [2, 'POWER', '进驻发电站时，无人机充能速度+0%'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['t', 'TRADING', 3, [1]], ['t2', 'TRADING', 3, [2, 3]], ['d', 'DORMITORY', 1, []]]);
  f.catalog.operatorGroups = { 'cc.tag.mh2': ['char_1', 'char_2'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [assignment, expected] of [
    [f.assignment, 0.4],
    [{ t: [1, 3], t2: [], d: [2] }, 0.2],
    [{ t: [1, 2, 3], t2: [], d: [] }, 0.4],
    [f.assignment, 0.4],
  ]) {
    const result = evaluate(assignment);
    assert.equal(result.rooms.t.orderSpeed, expected);
    assert.equal(result.rooms.t.orderLimit, 3);
    assert.equal(result.rooms.t2.orderSpeed, undefined);
  }
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('贸易效率分档仅放大房内技能，按5%取整、封顶并在换岗后重算', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，当前贸易站内干员提供的每5%订单获取效率，额外提供5%效率，最多提供25%效率'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+24%'],
    [3, 'CONTROL', '进驻控制中枢时，所有贸易站订单效率+7%（同种效果取最高）'],
  ], [['t', 'TRADING', 3, [1, 2]], ['c', 'CONTROL', 5, [3]], ['d', 'DORMITORY', 1, []]]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.t.orderSpeed - 0.51) < 1e-12);
  assert.ok(Math.abs(evaluate({ t: [1], c: [3], d: [2] }).rooms.t.orderSpeed - 0.07) < 1e-12);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.t.orderSpeed - 0.51) < 1e-12);
  for (const [bonus, expected] of [[4, 0.11], [5, 0.17], [25, 0.57], [60, 0.92]]) {
    f.catalog.buffs.buff_2.description = `进驻贸易站时，订单获取效率+${bonus}%`;
    assert.ok(Math.abs(run(f).rooms.t.orderSpeed - expected) < 1e-12);
  }
});

test('贸易效率分档包含容量派生贡献且与人员遍历顺序无关', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，当前贸易站内干员提供的每5%订单获取效率，额外提供5%效率，最多提供35%效率'],
    [2, 'TRADING', '进驻贸易站时，当前贸易站内干员提升的每个订单上限，提供4%订单获取效率'],
    [3, 'TRADING', '进驻贸易站时，订单上限+4'],
  ], [['t', 'TRADING', 3, [1, 2, 3]]]);
  for (const ids of [[1, 2, 3], [3, 2, 1]]) {
    f.assignment.t = ids;
    assert.ok(Math.abs(run(f).rooms.t.orderSpeed - 0.31) < 1e-12);
  }
  f.catalog.buffs.buff_3.description = '进驻贸易站时，订单上限+10';
  assert.ok(Math.abs(run(f).rooms.t.orderSpeed - 0.75) < 1e-12);
});

test('工作场所伙伴分别加成且按候选换岗重算，不计宿舍与空闲', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，订单获取效率+30%；当伙伴甲、伙伴乙入驻工作场所时（不包含副手），订单获取效率分别额外+5%'],
    [2, 'POWER', '进驻发电站时，无人机充能速度+0%'],
    [3, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗-0.1'],
  ], [['t', 'TRADING', 3, [1]], ['p', 'POWER', 1, [2]], ['c', 'CONTROL', 5, [3]], ['d', 'DORMITORY', 1, []]]);
  f.catalog.characterNames = { char_2: '伙伴甲', char_3: '伙伴乙' };
  f.snapshot.facilities = f.snapshot.rooms.map(room => ({ ...room, state: 2 }));
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const [assignment, expected] of [
    [f.assignment, 0.4],
    [{ t: [1], p: [2], c: [], d: [3] }, 0.35],
    [{ t: [1], p: [], c: [], d: [2] }, 0.3],
    [{ t: [1, 2, 3], p: [], c: [], d: [] }, 0.4],
  ]) assert.ok(Math.abs(evaluate(assignment).rooms.t.orderSpeed - expected) < 1e-12);
});

test('工作场所伙伴计入受保护训练室，不计加工站，缺设施状态拒绝', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，订单获取效率+25%；当伙伴入驻工作场所时（不包含副手），订单获取效率额外+5%'],
    [2, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['t', 'TRADING', 3, [1]]]);
  f.catalog.characterNames = { char_2: '伙伴' };
  f.snapshot.reservedIds = [2];
  f.snapshot.operators[1].roomSlotId = 'reserved';
  f.snapshot.facilities = [{ slot: 'reserved', type: 'TRAINING', level: 1, state: 2 }];
  assert.ok(Math.abs(run(f).rooms.t.orderSpeed - 0.3) < 1e-12);
  f.snapshot.facilities[0].type = 'WORKSHOP';
  assert.equal(run(f).rooms.t.orderSpeed, 0.25);
  delete f.snapshot.facilities;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('队友生产力分档加成排除自身、外部中枢与设施数量，并在换岗后重算', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内其他干员提供的每5%生产力（不包含根据设施数量提供加成的生产力），额外提供5%生产力，最多提供40%生产力'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+24%'],
    [3, 'MANUFACTURE', '进驻制造站时，每间宿舍每级为贵金属类配方的生产力+5%'],
    [4, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]], ['other', 'MANUFACTURE', 3, []],
    ['d', 'DORMITORY', 1, []], ['c', 'CONTROL', 5, [4]]]);
  f.snapshot.rooms[0].formulaId = 'gold';
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' } };
  f.catalog.buffs.own = { buffId: 'own', roomType: 'MANUFACTURE', description: '进驻制造站时，生产力+10%' };
  f.catalog.chars.char_1.buffChar.push({ buffData: [{ buffId: 'own', cond: { phase: 0, level: 1 } }] });
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const team of [[1, 2, 3], [3, 2, 1]]) {
    assert.ok(Math.abs(evaluate({ ...f.assignment, m: team }).rooms.m.production - 0.61) < 1e-12);
  }
  assert.ok(Math.abs(evaluate({ ...f.assignment, m: [1, 3], other: [2] }).rooms.m.production - 0.17) < 1e-12);
});

for (const [bonus, expected] of [[0, 0], [4, 0.04], [5, 0.1], [35, 0.7], [40, 0.8], [75, 1.15]]) {
  test(`队友生产力分档边界 ${bonus}% 与40%上限`, () => {
    const f = fixture([
      [1, 'MANUFACTURE', '进驻制造站时，当前制造站内其他干员提供的每5%生产力（不包含根据设施数量提供加成的生产力），额外提供5%生产力，最多提供40%生产力'],
      [2, 'MANUFACTURE', `进驻制造站时，生产力+${bonus}%`],
    ], [['m', 'MANUFACTURE', 3, [1, 2]]]);
    assert.ok(Math.abs(run(f).rooms.m.production - expected) < 1e-12);
  });
}

test('队友生产力分档使用容量派生加成，归零技能仍先于分档求值', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内其他干员提供的每5%生产力（不包含根据设施数量提供加成的生产力），额外提供5%生产力，最多提供40%生产力'],
    [2, 'MANUFACTURE', '进驻制造站时，仓库容量上限+10'],
    [3, 'MANUFACTURE', '进驻制造站时，当前制造站内干员提升的每格仓库容量，提供2%生产力'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]]]);
  assert.ok(Math.abs(run(f).rooms.m.production - 0.4) < 1e-12);
  f.catalog.buffs.buff_2.description = '进驻制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+5%的生产力';
  f.snapshot.rooms.push({ slot: 'p', type: 'POWER', level: 1, capacity: 1, occupants: [] });
  f.assignment.p = [];
  assert.equal(run(f).rooms.m.production, 0.05);
});

test('中枢岁心情清除只作用于同房岁干员且缺身份拒绝', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，消除当前控制中枢内所有岁干员自身心情消耗的影响'],
    [2, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗+0.5'],
    [3, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗-0.5'],
    [4, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员心情每小时恢复+0.05'],
  ], [['c', 'CONTROL', 5, [1, 2, 3, 4]], ['other', 'CONTROL', 5, []]]);
  f.catalog.characterAffiliations = { char_1: ['炎-岁'], char_2: ['炎-岁'], char_3: [], char_4: [] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const result = evaluate(f.assignment);
  assert.equal(result.operators[2].moodCost, undefined);
  assert.equal(result.operators[3].moodCost, -0.5);
  assert.equal(result.operators[2].moodRecovery, 0.05);
  const moved = evaluate({ c: [2, 3, 4], other: [1] });
  assert.equal(moved.operators[2].moodCost, 0.5);
  delete f.catalog.characterAffiliations.char_2;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('中枢伙伴条件心情清除不扩散至队友且伙伴离开立即失效', () => {
  const f = fixture([
    [1, 'CONTROL', '当与丰川祥子一起进驻控制中枢时，消除自身心情消耗的影响'],
    [2, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗+0.5'],
  ], [['c', 'CONTROL', 5, [1, 2]], ['d', 'DORMITORY', 1, []]]);
  f.catalog.characterNames = { char_2: '丰川祥子' };
  f.catalog.chars.char_1.buffChar.push(f.catalog.chars.char_2.buffChar[0]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).operators[1].moodCost, undefined);
  assert.equal(evaluate(f.assignment).operators[2].moodCost, 0.5);
  assert.equal(evaluate({ c: [1], d: [2] }).operators[1].moodCost, 0.5);
});

test('制造心情清除同时消除正负自身增量，保留队友减耗且换岗重算', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，消除当前制造站内所有干员自身心情消耗的影响'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+25%，心情每小时消耗+0.25'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+15%，心情每小时消耗-0.25'],
    [4, 'MANUFACTURE', '进驻制造站时，当前制造站内所有干员心情每小时消耗-0.1'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3, 4]], ['other', 'MANUFACTURE', 3, []]]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const order of [[1, 2, 3, 4], [4, 3, 2, 1]]) {
    const result = evaluate({ ...f.assignment, m: order });
    assert.equal(result.rooms.m.production, 0.4);
    for (const id of order) assert.equal(result.operators[id].moodCost, -0.1);
  }
  const moved = evaluate({ ...f.assignment, m: [2, 3, 4], other: [1] });
  assert.ok(Math.abs(moved.operators[2].moodCost - 0.15) < 1e-12);
  assert.ok(Math.abs(moved.operators[3].moodCost + 0.35) < 1e-12);
});

for (const [type, text, stat, one, two, cap] of [
  ['TRADING', '订单获取效率+25%，基建内（不包含副手及活动室）每有一间进驻精英干员的设施，订单获取效率额外+2%（最多10间）', 'orderSpeed', 0.27, 0.29, 0.45],
  ['HIRE', '人脉资源的联络速度+30%，基建内（不包含副手及活动室）每有一间进驻精英干员的设施，联络速度额外+4%（最多5间）', 'contactSpeed', 0.34, 0.38, 0.5],
]) test(`${type}精英按设施去重、换岗重算、保留训练室并限制上限`, () => {
  const prefix = type === 'TRADING' ? '进驻贸易站时，' : '进驻人力办公室时，';
  const f = fixture([
    [1, type, prefix + text],
    ...Array.from({ length: 12 }, (_, i) => [i + 2, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['source', type, 3, [1]], ['d1', 'DORMITORY', 1, [2, 3]], ['d2', 'DORMITORY', 1, []],
    ...Array.from({ length: 10 }, (_, i) => [`extra${i}`, 'DORMITORY', 1, []])]);
  f.snapshot.facilities = f.snapshot.rooms.map(r => ({ ...r, state: 2 }));
  f.catalog.operatorGroups = { 'cc.g.elite': Array.from({ length: 12 }, (_, i) => `char_${i + 2}`) };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const check = (assignment, expected) => assert.ok(Math.abs(evaluate(assignment).rooms.source[stat] - expected) < 1e-12);
  check(f.assignment, one);
  check({ ...f.assignment, d1: [2], d2: [3] }, two);
  check({ ...f.assignment, d1: [2, 3], ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`extra${i}`, [i + 4]])) }, cap);
  f.snapshot.reservedIds = [3];
  f.snapshot.operators.find(o => o.instId === 3).roomSlotId = 'training';
  f.snapshot.facilities.push({ slot: 'training', type: 'TRAINING', level: 3, state: 2 });
  f.assignment.d1 = [2];
  assert.ok(Math.abs(run(f).rooms.source[stat] - two) < 1e-12);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('基建术语成员按人数计入自身与受保护岗位，限制四人且离岗重算', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，生产力+20%，基建内（不包含副手）每有1名S.E.E.S.干员（最多4名），生产力额外+5%'],
    ...[2, 3, 4, 5, 6].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['m', 'MANUFACTURE', 3, [1]], ['d', 'DORMITORY', 1, [2, 3]], ['c', 'CONTROL', 1, []]]);
  f.snapshot.facilities = f.snapshot.rooms.map(r => ({ ...r, state: 2 }));
  f.catalog.operatorGroups = { 'cc.tag.sees': ['char_1', 'char_2', 'char_3', 'char_4', 'char_5'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const check = (assignment, expected) => assert.ok(Math.abs(evaluate(assignment).rooms.m.production - expected) < 1e-12);
  check(f.assignment, 0.35);
  check({ ...f.assignment, d: [2, 3, 4, 5, 6] }, 0.4);
  check({ ...f.assignment, d: [6] }, 0.25);
  check(f.assignment, 0.35);
  f.snapshot.reservedIds = [4, 5];
  for (const [id, type] of [[4, 'TRAINING'], [5, 'WORKSHOP']]) {
    f.snapshot.operators.find(o => o.instId === id).roomSlotId = type;
    f.snapshot.facilities.push({ slot: type, type, level: 1, state: 2 });
  }
  assert.ok(Math.abs(run(f).rooms.m.production - 0.4) < 1e-12);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('骑士生产力按目标制造站术语成员计数，换岗不缓存且缺身份拒绝', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，每个进驻在制造站的骑士干员生产力+7%'],
    ...[2, 3, 4].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['c', 'CONTROL', 1, [1]], ['m1', 'MANUFACTURE', 1, [2, 3]],
    ['m2', 'MANUFACTURE', 1, [4]], ['d', 'DORMITORY', 1, []]]);
  f.catalog.operatorGroups = { 'cc.tag.knight': ['char_2', 'char_3'] };
  // 同阵营不是骑士身份的替代判断。
  f.catalog.characterAffiliations = { char_2: [], char_3: [], char_4: ['骑士'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.m1.production, 0.14);
  assert.equal(evaluate(f.assignment).rooms.m2.production, undefined);
  const swapped = evaluate({ ...f.assignment, m1: [2], m2: [3, 4] });
  assert.equal(swapped.rooms.m1.production, 0.07);
  assert.equal(swapped.rooms.m2.production, 0.07);
  assert.equal(evaluate({ ...f.assignment, m1: [], d: [2, 3] }).rooms.m1.production, undefined);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('怪物猎人中枢伙伴按候选占位触发，自己与其它房间成员不触发，缺身份拒绝', () => {
  const f = fixture([
    [1, 'CONTROL', '当与怪物猎人小队干员进驻控制中枢一起工作时，所有制造站生产力+2%（同种效果取最高）'],
    [2, 'CONTROL', '当与怪物猎人小队干员进驻控制中枢一起工作时，所有贸易站订单效率+7%（同种效果取最高）'],
    ...[3, 4, 5].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['c', 'CONTROL', 1, [1, 2]], ['m', 'MANUFACTURE', 1, [4]],
    ['t', 'TRADING', 1, [5]], ['d', 'DORMITORY', 1, [3]]]);
  f.catalog.operatorGroups = { 'cc.tag.mh': ['char_1', 'char_2'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.m.production, 0.02);
  assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, 0.07);
  const alone = evaluate({ ...f.assignment, c: [1], d: [2, 3] });
  assert.equal(alone.rooms.m.production, undefined);
  assert.equal(alone.rooms.t.orderSpeed, undefined);
  assert.equal(evaluate({ ...f.assignment, c: [1, 3], d: [2] }).rooms.m.production, undefined);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('作业平台按候选发电站占位计数：数量、阈值、自身排除与虚拟设施联动', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，如果有2台以上作业平台进驻在发电站，则所有制造站生产力+2%（同种效果取最高）'],
    [2, 'MANUFACTURE', '进驻制造站时，每有1台作业平台进驻发电站，贵金属类配方的生产力+10%'],
    [3, 'POWER', '进驻发电站时，如果其他发电站内没有进驻作业平台，则发电站额外+1(仅影响设施数量)'],
    [4, 'POWER', '进驻发电站时，如果其他作业平台进驻在发电站，则无人机充能速度+5%'],
    [5, 'POWER', '进驻发电站时，无人机充能速度+0%'],
    [6, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1，同时每有1间发电站，则恢复效果额外+0.1（叠加后的最终值同种效果取最高）'],
  ], [['c', 'CONTROL', 1, [1]], ['m', 'MANUFACTURE', 1, [2]], ['p1', 'POWER', 1, [3]],
    ['p2', 'POWER', 1, [4]], ['p3', 'POWER', 1, [5]], ['d', 'DORMITORY', 1, [6]]]);
  f.catalog.operatorGroups = { 'cc.tag.op': ['char_3', 'char_4'] };
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' }, exp: { buffType: 'M_EXP' } };
  f.snapshot.rooms[1].formulaId = 'gold';
  assert.ok(Math.abs(run(f).rooms.m.production - 0.22) < 1e-9);
  assert.equal(run(f).rooms.p2.droneSpeed, 0.05);
  assert.equal(run(f).operators[6].moodRecovery, 0.4);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const swapped = { ...f.assignment, p2: [], d: [6, 4] };
  assert.equal(evaluate(swapped).rooms.m.production, 0.1);
  assert.equal(evaluate(swapped).operators[6].moodRecovery, 0.5);
  assert.equal(evaluate({ ...f.assignment, p1: [], d: [6, 3] }).rooms.p2.droneSpeed, undefined);
  f.snapshot.rooms[1].formulaId = 'exp';
  assert.equal(run(f).rooms.m.production, 0.02);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('全基建行医恢复按分支计数、四人封顶，换岗与资料缺失不能静默归零', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，基建内（不包含副手及活动室使用者）每名行医干员为该宿舍内所有干员心情每小时恢复速度+0.06（最多生效4名，且同种效果取最高）'],
    ...[2, 3, 4, 5, 6, 7, 8].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['d', 'DORMITORY', 1, [1, 2]], ['p', 'POWER', 1, [3, 4, 5, 6]]]);
  f.catalog.characterSubProfessions = { char_1: 'physician', char_2: 'wandermedic',
    char_3: 'wandermedic', char_4: 'wandermedic', char_5: 'wandermedic', char_6: 'wandermedic',
    char_7: 'wandermedic', char_8: 'wandermedic' };
  f.snapshot.facilities = [{ slot: 'w', type: 'WORKSHOP', state: 2, level: 1 }];
  f.snapshot.reservedIds = [7];
  f.snapshot.operators[6].roomSlotId = 'w';
  assert.equal(run(f).operators[1].moodRecovery, 0.24);
  f.assignment.p = [];
  assert.equal(run(f).operators[1].moodRecovery, 0.12);
  f.catalog.characterSubProfessions.char_2 = 'physician';
  assert.equal(run(f).operators[1].moodRecovery, 0.06);
  f.snapshot.reservedIds = [];
  assert.equal(run(f).operators[1].moodRecovery, 0);
  delete f.catalog.characterSubProfessions.char_2;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('全基建阵营设施按房间去重，计入宿舍和受保护岗位，候选换岗重新计数', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，基建内（不包含副手及活动室）每有一间进驻岁干员的设施，订单获取效率+4%（最多5间）'],
    ...[2, 3, 4, 5, 6, 7, 8].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['t', 'TRADING', 1, [1]], ['d', 'DORMITORY', 1, [2, 3]],
    ['p', 'POWER', 1, [4]], ['d2', 'DORMITORY', 1, [5]], ['d3', 'DORMITORY', 1, [6]]]);
  f.catalog.characterAffiliations = Object.fromEntries(f.snapshot.operators.map(o => [o.charId, ['炎-岁']]));
  f.snapshot.reservedIds = [7];
  f.snapshot.operators[6].roomSlotId = 'w';
  f.snapshot.facilities = [{ slot: 'w', type: 'WORKSHOP', state: 2, level: 1 }];
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, 0.2);
  // 同房两人只算一间，空闲8号不计数，加工位始终保留。
  assert.equal(evaluate({ t: [1], d: [2, 3], p: [], d2: [], d3: [] }).rooms.t.orderSpeed, 0.12);
  assert.equal(evaluate({ t: [1], d: [2], p: [3], d2: [], d3: [] }).rooms.t.orderSpeed, 0.16);
  f.catalog.characterAffiliations.char_1 = [];
  assert.equal(run(f).rooms.t.orderSpeed, 0.2);
  delete f.catalog.characterAffiliations.char_2;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('贸易容量减益在汇总后保底一单，换人和房间等级不会残留旧容量', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，订单获取效率+25%，且订单上限-6（订单最少为1）'],
    [2, 'TRADING', '进驻贸易站时，订单上限+3'],
  ], [['t', 'TRADING', 1, [1]]]);
  f.catalog.tradingData = { phases: [{ orderLimit: 6 }, { orderLimit: 8 }, { orderLimit: 10 }] };
  assert.deepEqual(run(f).rooms.t, { orderSpeed: 0.25, capacity: -5 });
  f.assignment.t = [1, 2];
  assert.deepEqual(run(f).rooms.t, { orderSpeed: 0.25, capacity: -3 });
  f.assignment.t = [2, 1];
  assert.deepEqual(run(f).rooms.t, { orderSpeed: 0.25, capacity: -3 });
  f.assignment.t = [1];
  f.snapshot.rooms[0].level = 3;
  assert.deepEqual(run(f).rooms.t, { orderSpeed: 0.25, capacity: -6 });
  f.assignment.t = [2];
  assert.deepEqual(run(f).rooms.t, { capacity: 3 });
  f.assignment.t = [1];
  delete f.catalog.tradingData;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('宿舍平分恢复仅分给未满心情者，单人和多人分组取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，使心情未满的宿舍成员，平均分配到总计每小时心情恢复+0.8的加成（该技能对单名干员和多名干员生效时，同种效果分别取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.3（同种效果取最高）'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['d', 'DORMITORY', 1, [1, 2, 3]]]);
  for (const op of f.snapshot.operators) f.catalog.chars[op.charId].maxManpower = 8640000;
  f.snapshot.operators[0].ap = 3600000;
  f.snapshot.operators[1].ap = 3600000;
  let actual = run(f);
  assert.equal(actual.operators[1].moodRecovery, 0.4);
  assert.equal(actual.operators[2].moodRecovery, 0.4);
  assert.equal(actual.operators[3].moodRecovery, 0.3);
  f.snapshot.operators[1].ap = 8640000;
  actual = run(f);
  assert.equal(actual.operators[1].moodRecovery, 1.1);
  assert.equal(actual.operators[2].moodRecovery, 0.3);
  f.snapshot.operators[0].ap = 8640000;
  assert.equal(run(f).operators[1].moodRecovery, 0.3);
  delete f.catalog.chars.char_3.maxManpower;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('中枢全基建阵营线索加成封顶取最高，耗情只受本房伙伴影响', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，基建内（不包含副手及活动室使用者）每有1名米诺斯干员，会客室线索搜集速度+4%（最多+20%，同种效果取最高）；当与萨尔贡干员进驻控制中枢一起工作时，自身心情每小时消耗+0.02'],
    [2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+10%（同种效果取最高）'],
    ...[3, 4, 5, 6, 7, 8].map(id => [id, 'MEETING', '进驻会客室时，线索搜集速度提升0%']),
  ], [['c', 'CONTROL', 1, [1, 2]], ['r', 'MEETING', 1, [3]], ['d', 'DORMITORY', 1, [4, 5, 6, 7, 8]]]);
  f.snapshot.facilities = [];
  f.catalog.characterAffiliations = Object.fromEntries(f.snapshot.operators.map(o => [o.charId, o.instId === 2 ? ['萨尔贡'] : ['米诺斯']]));
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.r.clueSpeed, 0.2);
  assert.equal(evaluate(f.assignment).operators[1].moodCost, 0.02);
  const changed = evaluate({ c: [1], r: [3], d: [2] });
  assert.equal(changed.rooms.r.clueSpeed, 0.08);
  assert.equal(changed.operators[1].moodCost, undefined);
  assert.equal(evaluate({ c: [1, 2], r: [], d: [] }).rooms.r.clueSpeed, undefined);
});

test('中枢指定伙伴恢复只给伙伴，离开后不影响无条件宿舍加成', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，所有宿舍内所有干员的心情每小时恢复+0.05（同种效果取最高）；当与测试伙伴一起进驻控制中枢时，测试伙伴的心情每小时恢复+0.1'],
    [2, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['c', 'CONTROL', 1, [1, 2]], ['d', 'DORMITORY', 1, [3]]]);
  f.catalog.characterNames = { char_2: '测试伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const active = evaluate(f.assignment);
  assert.equal(active.operators[1].moodRecovery, 0.05);
  assert.ok(Math.abs(active.operators[2].moodRecovery - 0.15) < 1e-12);
  assert.equal(active.operators[3].moodRecovery, 0.05);
  const changed = evaluate({ c: [1], d: [2, 3] });
  assert.equal(changed.operators[1].moodRecovery, undefined);
  assert.equal(changed.operators[2].moodRecovery, 0.05);
  assert.equal(changed.operators[3].moodRecovery, 0.05);
});

test('中枢指定伙伴耗情与跨房速度同时受伙伴在岗条件约束', () => {
  const f = fixture([
    [1, 'CONTROL', '当与测试伙伴一起进驻控制中枢时，测试伙伴心情每小时消耗+0.05，会客室线索搜集速度额外提升+5%（同种效果取最高）'],
    [2, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05'],
    [3, 'MEETING', '进驻会客室时，线索搜集速度提升10%'],
  ], [['c', 'CONTROL', 1, [1, 2]], ['r', 'MEETING', 1, [3]], ['d', 'DORMITORY', 1, []]]);
  f.catalog.characterNames = { char_2: '测试伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const active = evaluate(f.assignment);
  assert.equal(active.operators[1].moodCost, undefined);
  assert.equal(active.operators[2].moodCost, 0.05);
  assert.ok(Math.abs(active.rooms.r.clueSpeed - 0.15) < 1e-12);
  const changed = evaluate({ c: [1], r: [3], d: [2] });
  assert.equal(changed.rooms.r.clueSpeed, 0.1);
  assert.equal(changed.operators[2].moodCost, undefined);
});

test('宿舍全基建阵营恢复封顶并与本房群体恢复取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，基建内（不包含副手及活动室使用者）每名岁干员为该宿舍内所有干员心情每小时恢复速度+0.06（最多生效4名，且同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）'],
    ...[3, 4, 5, 6].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['d', 'DORMITORY', 1, [1, 2, 3, 4, 5]], ['p', 'POWER', 1, [6]]]);
  f.snapshot.facilities = [];
  f.catalog.characterAffiliations = Object.fromEntries(f.snapshot.operators.map(o => [o.charId, ['炎-岁']]));
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).operators[1].moodRecovery, 0.24);
  assert.equal(evaluate(f.assignment).operators[5].moodRecovery, 0.24);
  assert.equal(evaluate(f.assignment).operators[6].moodRecovery, undefined);
  assert.equal(evaluate({ d: [1, 2], p: [] }).operators[1].moodRecovery, 0.2);
  delete f.catalog.characterAffiliations.char_6;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('宿舍目标阵营额外恢复按受益者取最高，不增加非目标恢复', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.15，如果目标是莱欧斯小队干员，则恢复效果额外+0.15（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['d', 'DORMITORY', 1, [1, 2, 3]]]);
  f.catalog.characterAffiliations = { char_1: [], char_2: ['莱欧斯小队'], char_3: [] };
  const result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.2);
  assert.equal(result.operators[2].moodRecovery, 0.3);
  assert.equal(result.operators[3].moodRecovery, 0.2);
  delete f.catalog.characterAffiliations.char_3;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('全基建阵营计数含受保护设施和宿舍，不含空闲，换岗重算并封顶', () => {
  const f = fixture([
    [1, 'POWER', '进驻发电站时，无人机充能速度+10%，基建内（不包含副手及活动室使用者）每有1名除自身以外的莱茵生命干员（最多5名），充能速度额外+3%'],
    ...[2, 3, 4, 5, 6, 7, 8].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['p', 'POWER', 1, [1]], ['d', 'DORMITORY', 1, [2, 3, 4, 5, 6]]]);
  f.catalog.characterAffiliations = Object.fromEntries(f.snapshot.operators.map(o => [o.charId, ['莱茵生命']]));
  f.snapshot.reservedIds = [7];
  f.snapshot.operators.find(o => o.instId === 7).roomSlotId = 'w';
  f.snapshot.facilities = [{ slot: 'w', type: 'WORKSHOP', state: 2, level: 1 }];
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.p.droneSpeed, 0.25);
  // 仅受保护加工位仍在岗：自身和空闲成员都不计入额外加成。
  assert.equal(evaluate({ p: [1], d: [] }).rooms.p.droneSpeed, 0.13);
  delete f.snapshot.facilities;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('全基建制造阵营按人数上限和配方计算，减耗属于技能持有人', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，基建内（不包含副手及活动室使用者）每有1名黑钢国际干员（最多3名），贵金属类配方的生产力+2%，心情每小时消耗-0.15'],
    ...[2, 3, 4, 5].map(id => [id, 'MANUFACTURE', '进驻制造站时，生产力+0%']),
  ], [['m', 'MANUFACTURE', 1, [1]], ['d', 'DORMITORY', 1, [2, 3, 4, 5]]]);
  f.snapshot.facilities = [];
  f.catalog.characterAffiliations = Object.fromEntries(f.snapshot.operators.map(o => [o.charId, ['黑钢国际']]));
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' }, exp: { buffType: 'M_EXP' } };
  f.snapshot.rooms[0].formulaId = 'gold';
  assert.equal(run(f).rooms.m.production, 0.06);
  assert.ok(Math.abs(run(f).operators[1].moodCost + 0.45) < 1e-12);
  f.assignment.d = [];
  assert.equal(run(f).rooms.m.production, 0.02);
  assert.equal(run(f).operators[1].moodCost, -0.15);
  f.snapshot.rooms[0].formulaId = 'exp';
  assert.equal(run(f).rooms.m.production, undefined);
  assert.equal(run(f).operators[1].moodCost, -0.15);
});

test('全基建伙伴从角色表解析，受保护岗位可触发而空闲不触发', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，订单获取效率+25%；当测试伙伴在基建内时（不包含副手及活动室使用者），订单获取效率额外+5%'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+0%'],
  ], [['t', 'TRADING', 1, [1]], ['d', 'DORMITORY', 1, [2]]]);
  f.catalog.characterNames = { char_2: '测试伙伴' };
  f.snapshot.facilities = [];
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, 0.3);
  assert.equal(evaluate({ t: [1], d: [] }).rooms.t.orderSpeed, 0.25);
  f.snapshot.reservedIds = [2]; f.assignment.d = [];
  f.snapshot.operators[1].roomSlotId = 'training';
  f.snapshot.facilities = [{ slot: 'training', type: 'TRAINING', state: 2, level: 1 }];
  assert.equal(run(f).rooms.t.orderSpeed, 0.3);
});

test('会客室阵营条件只计同房其他成员，不以名字或持有数量触发', () => {
  const f = fixture([
    [1, 'MEETING', '进驻会客室时，线索搜集速度提升10%，与其他萨米干员进驻会客室一起工作时，线索搜集速度额外提升5%，自身心情每小时消耗+0.5'],
    [2, 'MEETING', '进驻会客室时，线索搜集速度提升20%'],
    [3, 'MEETING', '进驻会客室时，线索搜集速度提升20%'],
  ], [['a', 'MEETING', 1, [1, 2]], ['b', 'MEETING', 1, [3]]]);
  f.catalog.characterAffiliations = { char_1: ['萨米'], char_2: ['萨米'], char_3: ['黑钢国际'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const active = evaluate(f.assignment);
  assert.ok(Math.abs(active.rooms.a.clueSpeed - 0.35) < 1e-12);
  assert.equal(active.operators[1].moodCost, 0.5);
  assert.equal(evaluate({ a: [1], b: [2, 3] }).rooms.a.clueSpeed, 0.1);
  assert.equal(evaluate({ a: [1], b: [2, 3] }).operators[1].moodCost, undefined);
  assert.ok(Math.abs(evaluate({ a: [1, 3], b: [2] }).rooms.a.clueSpeed - 0.3) < 1e-12);
  delete f.catalog.characterAffiliations.char_2;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('同房阵营计数包含自身而不重复国籍组织，换房后重算恢复和贸易效率', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，控制中枢内每个谢拉格干员可使控制中枢内所有干员的心情每小时恢复+0.05'],
    [2, 'TRADING', '进驻贸易站时，同个贸易站中每有1名拉特兰干员，当前贸易站订单获取效率+15%'],
    [3, 'TRADING', '进驻贸易站时，订单获取效率+30%；当前贸易站内存在格拉斯哥帮干员时，订单获取效率额外+10%'],
    [4, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05'],
  ], [['c', 'CONTROL', 1, [1, 4]], ['t', 'TRADING', 1, [2, 3]]]);
  f.catalog.characterAffiliations = { char_1: ['谢拉格'], char_2: ['拉特兰'], char_3: ['格拉斯哥帮'], char_4: ['谢拉格', '谢拉格'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const active = evaluate(f.assignment);
  assert.ok(Math.abs(active.operators[1].moodRecovery - 0.15) < 1e-12);
  assert.ok(Math.abs(active.operators[4].moodRecovery - 0.15) < 1e-12);
  assert.ok(Math.abs(active.rooms.t.orderSpeed - 0.55) < 1e-12);
  const changed = evaluate({ c: [1, 2], t: [3, 4] });
  assert.equal(changed.operators[1].moodRecovery, 0.05);
  assert.equal(changed.rooms.t.orderSpeed, 0.4);
});

test('中枢跨房阵营按目标房间人数计算，换岗重算且不污染另一房间', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗+0.5；每个进驻在制造站的黑钢国际干员，生产力+5%'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+10%'],
    [4, 'MANUFACTURE', '进驻制造站时，生产力+15%'],
  ], [['c', 'CONTROL', 1, [1]], ['a', 'MANUFACTURE', 1, [2, 3]], ['b', 'MANUFACTURE', 1, [4]]]);
  f.catalog.characterAffiliations = { char_1: [], char_2: ['黑钢国际'], char_3: ['黑钢国际'], char_4: [] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const active = evaluate(f.assignment);
  assert.ok(Math.abs(active.rooms.a.production - 0.4) < 1e-12);
  assert.equal(active.rooms.b.production, 0.15);
  assert.equal(active.operators[1].moodCost, 0.5);
  const changed = evaluate({ c: [1], a: [4], b: [2, 3] });
  assert.equal(changed.rooms.a.production, 0.15);
  assert.ok(Math.abs(changed.rooms.b.production - 0.4) < 1e-12);
  delete f.catalog.characterAffiliations.char_4;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('中枢贸易阵营容量和门槛分别在每座贸易站计算', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，每个进驻在贸易站的谢拉格干员，订单获取效率-15%，订单上限+6'],
    [2, 'CONTROL', '进驻控制中枢时，每个存在3名谢拉格干员的贸易站，订单获取效率+10%'],
    [3, 'TRADING', '进驻贸易站时，订单获取效率+10%'],
    [4, 'TRADING', '进驻贸易站时，订单获取效率+10%'],
    [5, 'TRADING', '进驻贸易站时，订单获取效率+10%'],
  ], [['c', 'CONTROL', 1, [1, 2]], ['a', 'TRADING', 1, [3, 4, 5]], ['b', 'TRADING', 1, []]]);
  f.catalog.characterAffiliations = Object.fromEntries(f.snapshot.operators.map(o => [o.charId, ['谢拉格']]));
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.a.orderSpeed + 0.05) < 1e-12);
  assert.equal(evaluate(f.assignment).rooms.a.capacity, 18);
  const changed = evaluate({ c: [1, 2], a: [3, 4], b: [5] });
  assert.ok(Math.abs(changed.rooms.a.orderSpeed + 0.1) < 1e-12);
  assert.ok(Math.abs(changed.rooms.b.orderSpeed + 0.05) < 1e-12);
  assert.equal(changed.rooms.a.capacity, 12);
  assert.equal(changed.rooms.b.capacity, 6);
});

test('阵营条件中枢增益仍按同种最高值，不让自身或无关同房人触发', () => {
  const f = fixture([
    [1, 'CONTROL', '当与龙门近卫局干员进驻控制中枢一起工作时，所有制造站生产力+3%（同种效果取最高）'],
    [2, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['c', 'CONTROL', 1, [1, 2]], ['m', 'MANUFACTURE', 1, [3]]]);
  f.catalog.characterAffiliations = { char_1: ['龙门近卫局'], char_2: ['龙门近卫局'], char_3: [] };
  assert.equal(run(f).rooms.m.production, 0.23);
  f.assignment.c = [1];
  assert.equal(run(f).rooms.m.production, 0.2);
  f.assignment.c = [1, 3];
  f.assignment.m = [2];
  assert.deepEqual(run(f).rooms.m, {});
});

test('制造同房派系加成保持配方条件且不按同派人数重复触发', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，作战记录类配方的生产力+30%，当与乌萨斯学生自治团干员在同一个制造站时，作战记录类配方的生产力额外+10%'],
    [2, 'MANUFACTURE', '进驻制造站时，当前制造站内每个A1小队干员为自身+10%的生产力'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+10%'],
  ], [['m', 'MANUFACTURE', 1, [1, 2, 3]]]);
  f.catalog.characterAffiliations = { char_1: ['乌萨斯学生自治团'], char_2: ['乌萨斯学生自治团', '行动预备组A1'], char_3: ['行动预备组A1'] };
  f.catalog.manufactFormulas = { exp: { buffType: 'M_EXP' }, gold: { buffType: 'M_GOLD' } };
  f.snapshot.rooms[0].formulaId = 'exp';
  assert.ok(Math.abs(run(f).rooms.m.production - 0.7) < 1e-12);
  f.snapshot.rooms[0].formulaId = 'gold';
  assert.ok(Math.abs(run(f).rooms.m.production - 0.3) < 1e-12);
  f.snapshot.rooms[0].formulaId = 'exp';
  f.assignment.m = [1, 3];
  assert.equal(run(f).rooms.m.production, 0.4);
});

test('中枢红松配方效果按目标制造站而不是中枢配方计算', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，每个进驻在制造站的红松骑士团干员，作战记录类配方的生产力+10%，贵金属类配方的生产力-10%'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['c', 'CONTROL', 1, [1]], ['m', 'MANUFACTURE', 1, [2]], ['n', 'MANUFACTURE', 1, [3]]]);
  f.catalog.characterAffiliations = { char_1: [], char_2: ['红松骑士团'], char_3: ['红松骑士团'] };
  f.catalog.manufactFormulas = { exp: { buffType: 'M_EXP' }, gold: { buffType: 'M_GOLD' } };
  f.snapshot.rooms[1].formulaId = 'exp';
  f.snapshot.rooms[2].formulaId = 'gold';
  assert.ok(Math.abs(run(f).rooms.m.production - 0.3) < 1e-12);
  assert.equal(run(f).rooms.n.production, 0.1);
  delete f.snapshot.rooms[2].formulaId;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('格拉斯哥贸易人数和指定伙伴加成独立计数，中枢按每站投放', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，同个贸易站中每有1名格拉斯哥帮干员，当前贸易站订单获取效率+20%；当与推进之王在同一个贸易站时，订单获取效率额外+35%'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+10%'],
    [3, 'CONTROL', '进驻控制中枢时，同一贸易站中，每有1名格拉斯哥帮干员，订单获取效率+10%'],
  ], [['a', 'TRADING', 1, [1, 2]], ['b', 'TRADING', 1, []], ['c', 'CONTROL', 1, [3]]]);
  f.catalog.characterNames = { char_2: '推进之王' };
  f.catalog.characterAffiliations = { char_1: ['格拉斯哥帮'], char_2: ['格拉斯哥帮'], char_3: [] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.a.orderSpeed - 1.05) < 1e-12);
  const split = evaluate({ a: [1], b: [2], c: [3] });
  assert.ok(Math.abs(split.rooms.a.orderSpeed - 0.3) < 1e-12);
  assert.equal(split.rooms.b.orderSpeed, 0.2);
});

test('发电站派系伙伴须在任一发电站工作，自身和宿舍成员不触发', () => {
  const f = fixture([
    [1, 'POWER', '进驻发电站时，如果其他拉特兰干员进驻在发电站，则无人机充能速度+5%'],
    [2, 'POWER', '进驻发电站时，无人机充能速度+10%'],
  ], [['p', 'POWER', 1, [1]], ['q', 'POWER', 1, [2]], ['d', 'DORMITORY', 1, []]]);
  f.catalog.characterAffiliations = { char_1: ['拉特兰'], char_2: ['拉特兰'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.p.droneSpeed, 0.05);
  assert.equal(evaluate(f.assignment).rooms.q.droneSpeed, 0.1);
  assert.deepEqual(evaluate({ p: [1], q: [], d: [2] }).rooms.p, {});
});

test('贸易配方多样性未证实类别及停产语义时拒绝，不将条件猜成零收益', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，订单获取效率+30%，制造站每有1类配方进行加工，则当前贸易站订单获取效率额外+2%'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
    [4, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
  ], [['t', 'TRADING', 3, [1]], ['a', 'MANUFACTURE', 3, [2]], ['b', 'MANUFACTURE', 3, [3]], ['c', 'MANUFACTURE', 3, [4]]]);
  f.catalog.manufactFormulas = { exp1: { buffType: 'M_EXP' }, exp2: { buffType: 'M_EXP' }, gold: { buffType: 'M_GOLD' } };
  for (const [index, formulaId] of [[1, 'exp1'], [2, 'exp2'], [3, 'gold']]) f.snapshot.rooms[index].formulaId = formulaId;
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  f.assignment.c = [];
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
});

test('中枢虚拟发电站只改变数量联动，伙伴换岗即时失效且不伪造房间', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，如果测试伙伴进驻在发电站，发电站额外+2（仅影响设施数量）'],
    [2, 'POWER', '进驻发电站时，无人机充能速度+10%'],
    [3, 'MANUFACTURE', '进驻制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+5%的生产力'],
    [4, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1，同时每有1间发电站，则恢复效果额外+0.05（叠加后的最终值同种效果取最高）'],
  ], [['m', 'MANUFACTURE', 1, [3]], ['d', 'DORMITORY', 1, [4]], ['p', 'POWER', 1, [2]], ['c', 'CONTROL', 1, [1]]]);
  f.catalog.characterNames = { char_2: '测试伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const active = evaluate(f.assignment);
  assert.ok(Math.abs(active.rooms.m.production - 0.15) < 1e-12);
  assert.equal(active.operators[4].moodRecovery, 0.25);
  assert.equal(active.rooms.p.droneSpeed, 0.1);
  assert.equal(Object.keys(active.rooms).length, 4);
  const inactive = evaluate({ ...f.assignment, p: [], d: [4, 2] });
  assert.equal(inactive.rooms.m.production, 0.05);
  assert.ok(Math.abs(inactive.operators[4].moodRecovery - 0.15) < 1e-12);
  assert.equal(evaluate({ ...f.assignment, c: [] }).rooms.m.production, 0.05);
  f.snapshot.rooms.reverse();
  assert.deepEqual(run(f).rooms, active.rooms);
  assert.deepEqual(run(f).operators, active.operators);
});

test('中枢招聘阈值在汇总基础及直接加成后严格比较，唯一增益不自触发', () => {
  const description = '进驻控制中枢时，人力办公室联络速度小于30%时（其中包含基础联络速度5%），则联络速度额外+20%（该加成全局效果唯一，不受其它加成影响）';
  const f = fixture([
    [1, 'CONTROL', description], [2, 'CONTROL', description],
    [3, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+20%'],
    [4, 'CONTROL', '进驻控制中枢时，人力办公室联络速度+5%（同种效果取最高）'],
  ], [['c', 'CONTROL', 1, [1, 2]], ['h', 'HIRE', 1, [3]]]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.h.contactSpeed, 0.4);
  assert.equal(evaluate({ c: [1, 2, 4], h: [3] }).rooms.h.contactSpeed, 0.25);
  assert.equal(evaluate({ c: [4], h: [3] }).rooms.h.contactSpeed, 0.25);
  assert.deepEqual(evaluate({ c: [1, 2], h: [] }).rooms.h, {});
  for (const [speed, want] of [[24, 0.44], [25, 0.25], [26, 0.26]]) {
    f.catalog.buffs.buff_3.description = `进驻人力办公室时，人脉资源的联络速度+${speed}%`;
    assert.ok(Math.abs(run(f).rooms.h.contactSpeed - want) < 1e-12);
  }
});

test('心情落差按原始单位和完整档位扣减产能，缺最大心情不猜值', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，生产力+30%，自身每有4点心情落差，生产力-5%']], [['m', 'MANUFACTURE', 1, [1]]]);
  f.catalog.manpowerDisplayFactor = 360000;
  f.catalog.chars.char_1.maxManpower = 8640000;
  for (const [ap, want] of [[8640000, 0.3], [7200001, 0.3], [7200000, 0.25], [5760000, 0.2], [101, 0.05]]) {
    f.snapshot.operators[0].ap = ap;
    assert.ok(Math.abs(run(f).rooms.m.production - want) < 1e-12);
  }
  delete f.catalog.chars.char_1.maxManpower;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('心情落差严格大于阈值才同时给予生产和容量，换人后重新判断', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，当自身心情落差大于12时，生产力+10%，仓库容量+6']], [['m', 'MANUFACTURE', 1, [1]]]);
  f.catalog.manpowerDisplayFactor = 360000;
  f.catalog.chars.char_1.maxManpower = 8640000;
  for (const [ap, production, capacity] of [[4320001, 0, 0], [4320000, 0, 0], [4319999, 0.1, 6]]) {
    f.snapshot.operators[0].ap = ap;
    const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
    assert.equal(evaluate(f.assignment).rooms.m.production ?? 0, production);
    assert.equal(evaluate(f.assignment).rooms.m.capacity ?? 0, capacity);
    assert.deepEqual(evaluate({ m: [] }).rooms.m, {});
  }
});

test('贸易归零只抑制其他同房来源，保留自身按队友加成、中枢、容量和全员心情消耗', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，当前贸易站内其他干员提供的订单获取效率全部归零，且每人为自身+45%订单获取效率，同时全体心情每小时消耗+0.25'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+30%，订单上限+4'],
    [3, 'TRADING', '进驻贸易站时，当前贸易站内干员提升的每个订单上限，提供4%订单获取效率'],
    [4, 'CONTROL', '进驻控制中枢时，所有贸易站订单效率+7%（同种效果取最高）'],
  ], [['t', 'TRADING', 3, [1, 2, 3]], ['c', 'CONTROL', 1, [4]]]);
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const team of [[1, 2, 3], [3, 2, 1]]) {
    const result = evaluate({ t: team, c: [4] });
    assert.ok(Math.abs(result.rooms.t.orderSpeed - 0.97) < 1e-12);
    assert.equal(result.rooms.t.capacity, 4);
    for (const id of team) assert.equal(result.operators[id].moodCost, 0.25);
  }
  assert.ok(Math.abs(evaluate({ t: [2, 3], c: [4] }).rooms.t.orderSpeed - 0.53) < 1e-12);
  assert.equal(evaluate({ t: [1], c: [4] }).rooms.t.orderSpeed, 0.07);
});

test('贸易订单容量分档转效率忽略基础容量、向下取整并在上限封顶', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，当前贸易站内干员提升的每5个订单上限，提供25%订单获取效率，最多提供100%效率'],
    [2, 'TRADING', '进驻贸易站时，订单上限+4'],
  ], [['t', 'TRADING', 3, [1, 2]]]);
  for (const [capacity, want] of [[4, 0], [5, 0.25], [9, 0.25], [10, 0.5], [20, 1], [25, 1], [-2, 0]]) {
    f.catalog.buffs.buff_2.description = `进驻贸易站时，订单上限${capacity >= 0 ? '+' : ''}${capacity}`;
    assert.equal(run(f).rooms.t.orderSpeed, want);
  }
});

test('条件归零只在伙伴同房时启用，候选移走伙伴立即恢复队友加成', () => {
  for (const [type, slot, description, direct, stat, active] of [
    ['MANUFACTURE', 'm', '进驻制造站时，当与伙伴在同一个制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+5%的生产力', '进驻制造站时，生产力+30%', 'production', 0.05],
    ['TRADING', 't', '当与伙伴在同一个贸易站时，当前贸易站内其他干员提供的订单获取效率全部归零，且每人为自身+45%订单获取效率，同时全体心情每小时消耗+0.25', '进驻贸易站时，订单获取效率+30%', 'orderSpeed', 0.9],
  ]) {
    const f = fixture([[1, type, description], [2, type, direct],
      [3, 'POWER', '进驻发电站时，无人机充能速度+0%']],
    [[slot, type, 3, [1, 2]], ['p', 'POWER', 1, []]]);
    f.catalog.characterNames = { char_3: '伙伴' };
    const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
    for (const [team, want] of [[[1, 2], 0.3], [[1, 2, 3], active], [[3, 2, 1], active], [[1, 2], 0.3]]) {
      assert.equal(evaluate({ [slot]: team, p: [] }).rooms[slot][stat], want);
    }
  }
});

test('条件技能类别转换不在伙伴缺席时启用', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内每个标准化类技能为自身+5%的生产力'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+15%'],
    [3, 'MANUFACTURE', '进驻制造站时，当与伙伴在同一个制造站时，当前制造站内所有莱茵科技类、红松骑士团类技能也全都视作标准化类技能'],
    [4, 'POWER', '进驻发电站时，无人机充能速度+0%'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]]]);
  for (const [id, name] of [[1, '意识协议'], [2, '莱茵科技·α'], [3, '意识兼容']]) f.catalog.buffs[`buff_${id}`].buffName = name;
  f.catalog.characterNames = { char_4: '伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate({ m: [1, 2, 3] }).rooms.m.production, 0.15);
  assert.equal(evaluate({ m: [1, 2, 3, 4] }).rooms.m.production, 0.2);
  assert.equal(evaluate({ m: [1, 2, 3] }).rooms.m.production, 0.15);
});

test('制造技能族按当前解锁技能计数，兼容转换不重复计数且换人重算', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内每个标准化类技能为自身+5%的生产力'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+15%'],
    [4, 'MANUFACTURE', '进驻制造站时，当前制造站内所有莱茵科技类、红松骑士团类技能也全都视作标准化类技能'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3, 4]]]);
  for (const [id, name] of [[1, '意识协议'], [2, '标准化·β'], [3, '莱茵科技·α'], [4, '意识兼容']]) {
    f.catalog.buffs[`buff_${id}`].buffName = name;
  }
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const team of [[1, 2, 3, 4], [4, 3, 2, 1]]) {
    assert.ok(Math.abs(evaluate({ m: team }).rooms.m.production - 0.5) < 1e-12);
  }
  assert.ok(Math.abs(evaluate({ m: [1, 2, 3] }).rooms.m.production - 0.45) < 1e-12);
  assert.equal(evaluate({ m: [1, 4] }).rooms.m.production, 0);
  f.catalog.buffs.buff_3.buffName = '红松骑士团·未来参数';
  assert.ok(Math.abs(run(f).rooms.m.production - 0.5) < 1e-12);
  delete f.catalog.buffs.buff_3.buffName;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('技能族产能与容量联动按技能而非人数计数，配方不匹配也保留族身份', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内每个金属工艺类技能为自身+5%的生产力'],
    [2, 'MANUFACTURE', '进驻制造站时，贵金属类配方的生产力+30%'],
    [3, 'MANUFACTURE', '进驻制造站时，当前制造站内每个莱茵科技类技能为自身+5的仓库上限容量'],
    [4, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
    [5, 'MANUFACTURE', '进驻制造站时，当前制造站内每个莱茵科技类技能为自身+5%的生产力'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3, 4, 5]]]);
  for (const [id, name] of [[1, '打工心得'], [2, '金属工艺·α'], [3, '勘探背包'], [4, '莱茵科技·β'], [5, '源石技艺理论应用']]) {
    f.catalog.buffs[`buff_${id}`].buffName = name;
  }
  f.snapshot.rooms[0].formulaId = 'exp';
  f.catalog.manufactFormulas = { exp: { buffType: 'M_EXP' } };
  assert.ok(Math.abs(run(f).rooms.m.production - 0.35) < 1e-12);
  assert.equal(run(f).rooms.m.capacity, 5);
  f.assignment.m = [1, 2, 3, 5];
  assert.equal(run(f).rooms.m.production, 0.05);
  assert.equal(run(f).rooms.m.capacity, 0);
});

test('跨房指定伙伴的定向加成只作用于伙伴当前房间，其他同类房间不获益', () => {
  const f = fixture([
    [1, 'POWER', '进驻发电站时，伙伴所在的制造站生产力+5%'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+15%'],
  ], [['p', 'POWER', 1, [1]], ['m', 'MANUFACTURE', 3, [2]], ['n', 'MANUFACTURE', 3, [3]]]);
  f.catalog.characterNames = { char_2: '伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.m.production - 0.3) < 1e-12);
  assert.equal(evaluate(f.assignment).rooms.n.production, 0.15);
  const moved = evaluate({ p: [1], m: [3], n: [2] });
  assert.equal(moved.rooms.m.production, 0.15);
  assert.ok(Math.abs(moved.rooms.n.production - 0.3) < 1e-12);
  assert.equal(evaluate({ p: [1], m: [], n: [3] }).rooms.n.production, 0.15);
});

test('中枢两位伙伴条件独立生效，订单容量只加给对应贸易站', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，当甲入驻会客室时，会客室线索搜集速度+5%；当乙入驻贸易站时，乙所在贸易站订单上限+2'],
    [2, 'MEETING', '进驻会客室时，线索搜集速度提升10%'],
    [3, 'TRADING', '进驻贸易站时，订单获取效率+15%'],
    [4, 'TRADING', '进驻贸易站时，订单获取效率+25%'],
  ], [['c', 'CONTROL', 1, [1]], ['meet', 'MEETING', 1, [2]], ['t', 'TRADING', 3, [3]], ['u', 'TRADING', 3, [4]]]);
  f.catalog.characterNames = { char_2: '甲', char_3: '乙' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const result = evaluate(f.assignment);
  assert.ok(Math.abs(result.rooms.meet.clueSpeed - 0.15) < 1e-12);
  assert.equal(result.rooms.t.capacity, 2);
  assert.equal(result.rooms.u.capacity, undefined);
  const moved = evaluate({ c: [1], meet: [], t: [4], u: [3] });
  assert.equal(moved.rooms.meet.clueSpeed, undefined);
  assert.equal(moved.rooms.t.capacity, undefined);
  assert.equal(moved.rooms.u.capacity, 2);
});

test('会客室同房伙伴条件保留基础速度，条件消耗只在伙伴在岗时生效', () => {
  const f = fixture([
    [1, 'MEETING', '进驻会客室时，线索搜集速度提升10%，当与伙伴进驻会客室一起工作时，线索搜集速度额外提升15%，自身心情每小时消耗+0.5'],
    [2, 'MEETING', '进驻会客室时，线索搜集速度提升20%'],
  ], [['meet', 'MEETING', 1, [1, 2]]]);
  f.catalog.characterNames = { char_2: '伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const together = evaluate(f.assignment);
  assert.ok(Math.abs(together.rooms.meet.clueSpeed - 0.45) < 1e-12);
  assert.equal(together.operators[1].moodCost, 0.5);
  const alone = evaluate({ meet: [1] });
  assert.equal(alone.rooms.meet.clueSpeed, 0.1);
  assert.equal(alone.operators[1].moodCost, undefined);
});

test('会客室跨宿舍与招聘跨中枢条件依赖候选占位，不吞基础消耗', () => {
  const f = fixture([
    [1, 'MEETING', '进驻会客室时，如果伙伴进驻在宿舍，则线索搜集速度额外提升10%'],
    [2, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.1'],
    [3, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+35%，心情每小时消耗-0.25，如果伙伴进驻在控制中枢，则人脉资源的联络速度额外+10%'],
  ], [['meet', 'MEETING', 1, [1]], ['d', 'DORMITORY', 1, [2]], ['h', 'HIRE', 1, [3]], ['c', 'CONTROL', 1, []]]);
  f.catalog.characterNames = { char_2: '伙伴' };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const resting = evaluate(f.assignment);
  assert.equal(resting.rooms.meet.clueSpeed, 0.1);
  assert.equal(resting.rooms.h.contactSpeed, 0.35);
  assert.equal(resting.operators[3].moodCost, -0.25);
  const working = evaluate({ meet: [1], d: [], h: [3], c: [2] });
  assert.equal(working.rooms.meet.clueSpeed, undefined);
  assert.ok(Math.abs(working.rooms.h.contactSpeed - 0.45) < 1e-12);
  assert.equal(working.operators[3].moodCost, -0.25);
});

const suppression = '当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），';
test('制造归零保留设施数量加成、容量和中枢加成，不依赖人员遍历顺序', () => {
  const f = fixture([
    [1, 'MANUFACTURE', `进驻制造站时，${suppression}每个发电站为当前制造站+10%的生产力`],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+30%，仓库容量上限+8'],
    [3, 'MANUFACTURE', '进驻制造站时，每个贸易站为当前制造站贵金属类配方的生产力+20%'],
    [4, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]], ['p', 'POWER', 1, []], ['t', 'TRADING', 1, []], ['c', 'CONTROL', 1, [4]]]);
  f.snapshot.rooms[0].formulaId = 'gold';
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' } };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  for (const occupants of [[1, 2, 3], [3, 2, 1]]) {
    f.assignment.m = occupants;
    const result = evaluate(f.assignment);
    assert.ok(Math.abs(result.rooms.m.production - 0.32) < 1e-12);
    assert.equal(result.rooms.m.capacity, 8);
  }
  f.assignment.m = [2, 3];
  assert.ok(Math.abs(evaluate(f.assignment).rooms.m.production - 0.52) < 1e-12);
});

test('制造归零按当前同房人数增加容量与生产，多个归零源互相抑制非设施产能', () => {
  const f = fixture([
    [1, 'MANUFACTURE', `进驻制造站时，${suppression}每个当前制造站内干员为当前制造站+10%生产力，仓库容量上限+5`],
    [2, 'MANUFACTURE', `进驻制造站时，${suppression}每个发电站为当前制造站+15%的生产力`],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+30%'],
  ], [['m', 'MANUFACTURE', 3, [1, 3]], ['p', 'POWER', 1, []]]);
  assert.ok(Math.abs(run(f).rooms.m.production - 0.2) < 1e-12);
  assert.equal(run(f).rooms.m.capacity, 10);
  f.assignment.m = [1, 2, 3];
  assert.ok(Math.abs(run(f).rooms.m.production - 0.15) < 1e-12);
  assert.equal(run(f).rooms.m.capacity, 15);
});

test('制造归零同时阻止队友容量转换产能，但不移除容量本身', () => {
  const f = fixture([
    [1, 'MANUFACTURE', `进驻制造站时，${suppression}每个当前制造站内干员为当前制造站仓库容量上限+5`],
    [2, 'MANUFACTURE', '进驻制造站时，当前制造站内干员提升的每格仓库容量，提供2%生产力'],
  ], [['m', 'MANUFACTURE', 3, [1, 2]]]);
  assert.equal(run(f).rooms.m.production ?? 0, 0);
  assert.equal(run(f).rooms.m.capacity, 10);
});

const capacityTier = '进驻制造站时，当前制造站内干员根据自身提升的仓库容量提供一定的生产力。提升16格以下的，每格仓库容量提供1%生产力；提升大于16格的，每格仓库容量提供3%生产力（无法与回收利用叠加，且优先生效）';

test('容量分档按每名来源合计而非全房容量，16格包含在低档', () => {
  for (const [left, right, expected] of [[0, 0, 0], [15, 0, 0.15], [16, 0, 0.16], [17, 0, 0.51], [14, 6, 0.2], [20, -4, 0.6]]) {
    const f = fixture([
      [1, 'MANUFACTURE', capacityTier],
      [2, 'MANUFACTURE', `进驻制造站时，仓库容量上限+${left}`],
      [3, 'MANUFACTURE', `进驻制造站时，仓库容量上限${right < 0 ? '' : '+'}${right}`],
    ], [['m', 'MANUFACTURE', 3, [1, 2, 3]]]);
    for (const occupants of [[1, 2, 3], [3, 2, 1]]) {
      f.assignment.m = occupants;
      assert.ok(Math.abs(run(f).rooms.m.production - expected) < 1e-12, `${left}/${right}`);
      assert.equal(run(f).rooms.m.capacity, left + right);
    }
  }
});

test('容量分档先合并同一干员多个容量技能，且优先于回收利用', () => {
  const f = fixture([
    [1, 'MANUFACTURE', capacityTier],
    [2, 'MANUFACTURE', '进驻制造站时，仓库容量上限+10'],
    [3, 'MANUFACTURE', '进驻制造站时，当前制造站内干员提升的每格仓库容量，提供2%生产力'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]]]);
  f.catalog.buffs.extra = { buffId: 'extra', roomType: 'MANUFACTURE', description: '进驻制造站时，仓库容量上限+8' };
  f.catalog.chars.char_2.buffChar.push({ buffData: [{ buffId: 'extra', cond: { phase: 0, level: 1 } }] });
  assert.ok(Math.abs(run(f).rooms.m.production - 0.54) < 1e-12);
  f.assignment.m = [2, 3];
  assert.ok(Math.abs(run(f).rooms.m.production - 0.36) < 1e-12);
});

test('制造归零抑制容量分档生产力但保留容量', () => {
  const f = fixture([
    [1, 'MANUFACTURE', capacityTier],
    [2, 'MANUFACTURE', `进驻制造站时，${suppression}每个当前制造站内干员为当前制造站仓库容量上限+5`],
    [3, 'MANUFACTURE', '进驻制造站时，当前制造站内干员提升的每格仓库容量，提供2%生产力'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]]]);
  assert.equal(run(f).rooms.m.production ?? 0, 0);
  assert.equal(run(f).rooms.m.capacity, 15);
});

test('设施等级加成保留基础项、封顶且不依赖设施人员', () => {
  for (const [type, description, facilityType, stat, cases] of [
    ['MANUFACTURE', '进驻制造站时，训练室每级为当前制造站+10%生产力，最多30%', 'TRAINING', 'production', [[0, 0], [1, 0.1], [3, 0.3], [4, 0.3]]],
    ['TRADING', '进驻贸易站时，订单获取效率+25%，会客室每级额外提供5%获取效率，最多提供40%效率', 'MEETING', 'orderSpeed', [[0, 0.25], [1, 0.3], [3, 0.4], [4, 0.4]]],
    ['TRADING', '进驻贸易站时，订单获取效率+15%，会客室每级额外提供5%获取效率，最多提供30%效率', 'MEETING', 'orderSpeed', [[0, 0.15], [1, 0.2], [3, 0.3], [4, 0.3]]],
  ]) {
    const f = fixture([[1, type, description]], [['work', type, 1, [1]]]);
    for (const [level, want] of cases) {
      f.snapshot.facilities = [{ slot: 'linked', type: facilityType, level, state: level ? 2 : 0 }];
      assert.ok(Math.abs(run(f).rooms.work[stat] - want) < 1e-12, `${type}/${level}`);
    }
    f.snapshot.facilities = [];
    assert.ok(Math.abs(run(f).rooms.work[stat] - cases[0][1]) < 1e-12);
  }
});

test('设施等级资料缺失或处于施工状态时拒绝猜测加成', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，训练室每级为当前制造站+10%生产力，最多30%']], [['m', 'MANUFACTURE', 1, [1]]]);
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  f.snapshot.facilities = [{ slot: 't', type: 'TRAINING', level: 2, state: 1 }];
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('锁定表设施等级技能经真实描述编译和人工数值验证', async () => {
  const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
  for (const [buffId, facilityType, stat, want] of [
    ['manu_prod_spd_train&lv[000]', 'TRAINING', 'production', 0.2],
    ['trade_ord_spd&meet[000]', 'MEETING', 'orderSpeed', 0.35],
    ['trade_ord_spd&meet[010]', 'MEETING', 'orderSpeed', 0.25],
  ]) {
    const buff = catalog.buffs[buffId];
    const f = fixture([[1, buff.roomType, buff.description]], [['work', buff.roomType, 1, [1]]]);
    f.snapshot.facilities = [{ slot: 'linked', type: facilityType, level: 2, state: 2 }];
    assert.ok(Math.abs(run(f).rooms.work[stat] - want) < 1e-12, buffId);
  }
});

test('宿舍心情阈值按原始单位逐人判断，以下包含临界值且整条恢复参与取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员心情每小时恢复+0.15，同时该宿舍内心情18以下的干员恢复效果额外+0.1（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）'],
    [3, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.1'],
  ], [['d', 'DORMITORY', 1, [1, 2, 3]], ['other', 'DORMITORY', 1, []]]);
  f.catalog.manpowerDisplayFactor = 360000;
  // 18点的原始值6480000，前后一个原始单位不能先舍入成整数心情。
  [6479999, 6480000, 6480001].forEach((ap, i) => { f.snapshot.operators[i].ap = ap; });
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  let result = evaluate(f.assignment);
  assert.equal(result.operators[1].moodRecovery, 0.25);
  assert.equal(result.operators[2].moodRecovery, 0.25);
  assert.ok(Math.abs(result.operators[3].moodRecovery - 0.3) < 1e-12);
  f.assignment.d = [2, 3]; f.assignment.other = [1];
  result = evaluate(f.assignment);
  assert.equal(result.operators[1].moodRecovery, 0.25);
  assert.equal(result.operators[2].moodRecovery, 0.2);
  assert.ok(Math.abs(result.operators[3].moodRecovery - 0.3) < 1e-12);
});

test('无基础值的阈值恢复仅覆盖满足条件人员，支持数据参数变化', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内心情20以下的干员恢复效果额外+0.1（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.1'],
  ], [['d', 'DORMITORY', 1, [1, 2]]]);
  f.catalog.manpowerDisplayFactor = 360000;
  f.snapshot.operators[0].ap = 7200000;
  f.snapshot.operators[1].ap = 7200001;
  assert.equal(run(f).operators[1].moodRecovery, 0.1);
  assert.equal(run(f).operators[2].moodRecovery, 0.1);
  f.catalog.buffs.buff_1.description = '进驻宿舍时，该宿舍内心情21以下的干员恢复效果额外+0.12（同种效果取最高）';
  assert.equal(run(f).operators[2].moodRecovery, 0.22);
});

test('锁定表中的两条宿舍阈值技能保留展示标签语义并通过人工边界值', async () => {
  const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
  for (const [buffId, at, below, above] of [
    ['dorm_rec_all&tired[000]', 6480000, 0.25, 0.15],
    ['dorm_rec_all&tired[100]', 7200000, 0.1, 0],
  ]) {
    const f = fixture([[1, 'DORMITORY', catalog.buffs[buffId].description]], [['d', 'DORMITORY', 1, [1]]]);
    f.catalog.manpowerDisplayFactor = catalog.manpowerDisplayFactor;
    for (const [ap, want] of [[at - 1, below], [at, below], [at + 1, above]]) {
      f.snapshot.operators[0].ap = ap;
      assert.equal(run(f).operators[1].moodRecovery, want, `${buffId} ap=${ap}`);
    }
  }
});

test('阈值恢复缺少心情换算系数时明确拒绝，不猜测单位', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内心情20以下的干员恢复效果额外+0.1（同种效果取最高）'],
  ], [['d', 'DORMITORY', 1, [1]]]);
  for (const factor of [undefined, 0, -1, Infinity]) {
    f.catalog.manpowerDisplayFactor = factor;
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  }
});

test('宿舍未满心情人数增量先合并再取最高，按当前候选成员计数且包含自身', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2；同时该宿舍每有1名心情未满的干员，则恢复效果额外+0.01（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.21（同种效果取最高）'],
    [3, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.1'],
  ], [['d', 'DORMITORY', 1, [1, 2, 3]], ['other', 'DORMITORY', 1, []]]);
  for (const char of Object.values(f.catalog.chars)) char.maxManpower = 8640000;
  f.snapshot.operators[0].ap = 8639999;
  f.snapshot.operators[2].ap = 0;
  let result = run(f);
  assert.ok(Math.abs(result.operators[1].moodRecovery - 0.22) < 1e-12);
  assert.ok(Math.abs(result.operators[2].moodRecovery - 0.22) < 1e-12);
  assert.ok(Math.abs(result.operators[3].moodRecovery - 0.32) < 1e-12);
  f.assignment.d = [1, 2]; f.assignment.other = [3];
  result = run(f);
  assert.ok(Math.abs(result.operators[1].moodRecovery - 0.21) < 1e-12);
  assert.equal(result.operators[3].moodRecovery, 0.1);
  f.snapshot.operators[0].ap = 8640000;
  assert.equal(run(f).operators[1].moodRecovery, 0.21);
});

test('未满心情人数效果缺少角色心情上限时拒绝，不假定所有人已满', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2；同时该宿舍每有1名心情未满的干员，则恢复效果额外+0.01（同种效果取最高）'],
  ], [['d', 'DORMITORY', 1, [1]]]);
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('额外招募位按办公室0/1/2/3级对应0/0/1/2，恢复合并后取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员心情每小时恢复+0.1，同时每个招募位（不包含初始招募位）额外+0.1恢复效果（叠加后的最终值同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.15（同种效果取最高）'],
  ], [['d', 'DORMITORY', 3, [1, 2]]]);
  for (const [level, expected] of [[0, 0.15], [1, 0.15], [2, 0.2], [3, 0.3]]) {
    f.snapshot.facilities = [{ slot: 'h', type: 'HIRE', level, state: level ? 2 : 0 }];
    assert.ok(Math.abs(run(f).operators[2].moodRecovery - expected) < 1e-12);
  }
  f.snapshot.facilities = [];
  assert.equal(run(f).operators[2].moodRecovery, 0.15);
  for (const facilities of [undefined, [{ type: 'HIRE', level: 2, state: 1 }],
    [{ type: 'HIRE', level: 4, state: 2 }], [{ type: 'HIRE', level: 2, state: 2 }, { type: 'HIRE', level: 2, state: 2 }]]) {
    f.snapshot.facilities = facilities;
    assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
  }
});

test('办公室招募位联动分别影响联络、心情和跨房线索，换人重算', () => {
  const f = fixture([
    [1, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+35%，同时每个招募位（不包含初始招募位）额外+5%会客室线索搜集速度'],
    [2, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+35%，同时每个招募位（不包含初始招募位）使心情每小时消耗-0.1'],
    [3, 'HIRE', '进驻人力办公室时，每个招募位（不包含初始招募位）+10%人脉资源的联络速度'],
    [4, 'MEETING', '进驻会客室时，线索搜集速度提升20%'],
  ], [['h', 'HIRE', 3, [1]], ['r', 'MEETING', 3, [4]]]);
  f.snapshot.facilities = [{ slot: 'h', type: 'HIRE', level: 3, state: 2 }];
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.r.clueSpeed - 0.3) < 1e-12);
  assert.equal(evaluate(f.assignment).rooms.h.contactSpeed, 0.35);
  f.assignment.h = [2];
  assert.equal(evaluate(f.assignment).rooms.r.clueSpeed, 0.2);
  assert.equal(evaluate(f.assignment).operators[2].moodCost, -0.2);
  f.assignment.h = [3];
  assert.equal(evaluate(f.assignment).rooms.h.contactSpeed, 0.2);
});

test('锁定表十一条招募位技能按真实描述通过1/2/3级办公室人工数值', async () => {
  const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
  const cases = [
    ['dorm_hireToRecAll[000]', 'moodRecovery', [0.15, 0.2, 0.25]],
    ['dorm_hireToRecAll[001]', 'moodRecovery', [0.1, 0.15, 0.2]],
    ['dorm_hireToRecAll[021]', 'moodRecovery', [0.1, 0.2, 0.3]],
    ['hire_spd_cost&clue[000]', 'moodCost', [0, -0.1, -0.2]],
    ['hire_spd_cost&extra[000]', 'contactSpeed', [0, 0.1, 0.2]],
    ...['100', '101', '110', '120', '121'].map(id => [`hire_spd&clue[${id}]`, 'clueSpeed', [0, 0.05, 0.1]]),
    ['meet_spd&clue[000]', 'clueSpeed', [0, 0.05, 0.1]],
  ];
  for (const [buffId, stat, values] of cases) {
    const buff = catalog.buffs[buffId];
    const crossRoom = buff.roomType === 'HIRE' && stat === 'clueSpeed';
    const specs = [[1, buff.roomType, buff.description]];
    const rooms = [['work', buff.roomType, 1, [1]]];
    if (crossRoom) {
      specs.push([2, 'MEETING', '进驻会客室时，线索搜集速度提升0%']);
      rooms.push(['r', 'MEETING', 1, [2]]);
    }
    const f = fixture(specs, rooms);
    for (const [index, want] of values.entries()) {
      f.snapshot.facilities = [{ slot: 'h', type: 'HIRE', level: index + 1, state: 2 }];
      const result = run(f);
      const got = stat.startsWith('mood') ? result.operators[1][stat]
        : result.rooms[buff.roomType === 'HIRE' && stat === 'clueSpeed' ? 'r' : 'work'][stat];
      assert.ok(Math.abs(got - want) < 1e-12, `${buffId}/${index + 1}: ${got}`);
      if (buffId.startsWith('hire_spd&clue')) {
        const base = ['110', '120'].some(id => buffId.includes(id)) ? 0.3 : 0.35;
        assert.equal(result.rooms.work.contactSpeed, base);
      }
    }
  }
});

test('制造同房伙伴与配方条件同时满足才生效，预计算后换人仍重新判断', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当与未来队友在同一个制造站时，贵金属类配方的生产力+15%'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['m', 'MANUFACTURE', 3, [1, 2]], ['other', 'MANUFACTURE', 3, []]]);
  f.catalog.characterNames = { char_1: '新角色', char_2: '未来队友' };
  f.snapshot.rooms[0].formulaId = 'gold';
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' }, exp: { buffType: 'M_EXP' } };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.ok(Math.abs(evaluate(f.assignment).rooms.m.production - 0.35) < 1e-12);
  f.assignment.m = [1]; f.assignment.other = [2];
  assert.equal(evaluate(f.assignment).rooms.m.production, undefined);
  f.assignment.m = [1, 2]; f.assignment.other = [];
  f.snapshot.rooms[0].formulaId = 'exp';
  assert.equal(run(f).rooms.m.production, 0.2);
});

test('制造跨房伙伴仅在贸易站触发，贸易基础速度不随同房伙伴离开而消失', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，若未来队友在贸易站，则作战记录类配方的生产力+35%'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+20%；当与制造伙伴在同一个贸易站时，订单获取效率额外+25%'],
  ], [['m', 'MANUFACTURE', 3, [1]], ['t', 'TRADING', 3, [2]]]);
  f.catalog.characterNames = { char_1: '制造伙伴', char_2: '未来队友' };
  f.snapshot.rooms[0].formulaId = 'exp';
  f.catalog.manufactFormulas = { exp: { buffType: 'M_EXP' } };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  assert.equal(evaluate(f.assignment).rooms.m.production, 0.35);
  assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, 0.2);
  f.assignment.m = []; f.assignment.t = [1, 2];
  assert.equal(evaluate(f.assignment).rooms.t.orderSpeed, 0.45);
  f.assignment.m = [1, 2]; f.assignment.t = [];
  assert.equal(evaluate(f.assignment).rooms.m.production, undefined);
});

test('锁定表四条制造贸易伙伴技能通过真实描述与人工数值', async () => {
  const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
  for (const [buffId, name, partnerRoom, formula, stat, want] of [
    ['manu_prod_spd_double[000]', '温米', 'MANUFACTURE', 'M_GOLD', 'production', 0.15],
    ['manu_prod_spd_double[100]', '酒神', 'MANUFACTURE', 'M_EXP', 'production', 0.3],
    ['manu_formula_spd_P[000]', '古米', 'TRADING', 'M_EXP', 'production', 0.35],
    ['trade_ord_spd&multiPar[100]', '能天使', 'TRADING', undefined, 'orderSpeed', 0.45],
  ]) {
    const buff = catalog.buffs[buffId];
    const partnerId = Object.entries(catalog.characterNames).find(([, value]) => value === name)[0];
    const f = fixture([[1, buff.roomType, buff.description], [2, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.1']],
      [['work', buff.roomType, 3, [1]], ['partner', partnerRoom, 3, []]]);
    f.catalog.characterNames = catalog.characterNames;
    f.snapshot.operators[1].charId = partnerId;
    f.catalog.chars[partnerId] = f.catalog.chars.char_2;
    f.snapshot.rooms[0].formulaId = 'recipe';
    f.catalog.manufactFormulas = { recipe: { buffType: formula } };
    f.assignment[partnerRoom === buff.roomType ? 'work' : 'partner'].push(2);
    assert.ok(Math.abs(run(f).rooms.work[stat] - want) < 1e-12, buffId);
  }
});

test('指定干员同房组合由角色表驱动，条件控制整条效率与自身消耗', () => {
  const f = fixture([
    [1, 'TRADING', '当与未来队友在同一个贸易站时，心情每小时消耗+0.3，订单获取效率+65%'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+20%'],
  ], [['a', 'TRADING', 3, [1, 2]], ['b', 'TRADING', 3, []]]);
  f.catalog.characterNames = { char_1: '新角色', char_2: '未来队友' };
  let result = run(f);
  assert.ok(Math.abs(result.rooms.a.orderSpeed - 0.85) < 1e-12);
  assert.equal(result.operators[1].moodCost, 0.3);
  assert.equal(result.operators[2].moodCost, undefined);
  f.assignment.a = [1]; f.assignment.b = [2];
  result = run(f);
  assert.equal(result.rooms.a.orderSpeed, undefined);
  assert.equal(result.operators[1].moodCost, undefined);
  assert.equal(result.rooms.b.orderSpeed, 0.2);
});

test('发电站跨房指定角色条件跟随候选安排，不依赖旧占位或角色白名单', () => {
  const f = fixture([
    [1, 'POWER', '进驻发电站时，如果未来中枢干员进驻在控制中枢，则无人机充能速度+5%'],
    [2, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+20%'],
  ], [['p1', 'POWER', 3, [1]], ['p2', 'POWER', 3, [3]], ['c', 'CONTROL', 5, [2]]]);
  f.catalog.characterNames = { char_1: '新角色', char_2: '未来中枢干员', char_3: '其他人' };
  let result = run(f);
  assert.equal(result.rooms.p1.droneSpeed, 0.05);
  assert.equal(result.rooms.p2.droneSpeed, 0.2);
  f.assignment.c = []; f.assignment.p2 = [2, 3];
  result = run(f);
  assert.equal(result.rooms.p1.droneSpeed, undefined);
  assert.equal(result.rooms.p2.droneSpeed, 0.2);
});

test('指定角色在任一发电站时仅触发技能所在站的额外加成，基础加成始终保留', () => {
  const f = fixture([
    [1, 'POWER', '进驻发电站时，无人机充能速度+15%，如果未来队友进驻在发电站，则无人机充能速度额外+5%'],
    [2, 'POWER', '进驻发电站时，无人机充能速度+20%'],
  ], [['p1', 'POWER', 3, [1]], ['p2', 'POWER', 3, [2]], ['c', 'CONTROL', 5, []]]);
  f.catalog.characterNames = { char_1: '新角色', char_2: '未来队友' };
  let result = run(f);
  assert.equal(result.rooms.p1.droneSpeed, 0.2);
  assert.equal(result.rooms.p2.droneSpeed, 0.2);
  f.assignment.p2 = []; f.assignment.c = [2];
  result = run(f);
  assert.equal(result.rooms.p1.droneSpeed, 0.15);
  assert.equal(result.rooms.p2.droneSpeed, undefined);
  delete f.catalog.characterNames;
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
});

test('发电站制造伙伴条件只读当前候选的制造占位，未知尾句仍拒绝', () => {
  const description = '进驻发电站时，无人机充能速度+15%，如果未来队友进驻在制造站，则无人机充能速度额外+5%';
  const f = fixture([
    [1, 'POWER', description],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['p', 'POWER', 3, [1]], ['m', 'MANUFACTURE', 3, [2]], ['c', 'CONTROL', 5, []]]);
  f.catalog.characterNames = { char_1: '新角色', char_2: '未来队友' };
  assert.equal(run(f).rooms.p.droneSpeed, 0.2);
  f.assignment.m = []; f.assignment.c = [2];
  assert.equal(run(f).rooms.p.droneSpeed, 0.15);
  f.catalog.buffs.buff_1.description = description + '，未来未知效果';
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
});

test('中枢同房恢复区分全员与自身和指定队友，不能影响无关干员', () => {
  const f = fixture([
    [1, 'CONTROL', '当与队友进驻控制中枢一起工作时，控制中枢内所有干员心情每小时恢复+0.25'],
    [2, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05'],
    [3, 'CONTROL', '当与队友一起进驻控制中枢时，自身和队友心情每小时恢复+0.05'],
    [4, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['c', 'CONTROL', 5, [1, 2, 3, 4]]]);
  f.catalog.characterNames = { char_1: '甲', char_2: '队友', char_3: '乙', char_4: '丙' };
  const result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.3);
  assert.equal(result.operators[2].moodRecovery, 0.35);
  assert.equal(result.operators[3].moodRecovery, 0.35);
  assert.equal(result.operators[4].moodRecovery, 0.3);
});

test('中枢精英恢复只给宿舍术语成员，换岗重算且缺身份拒绝', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，所有宿舍内精英干员的心情每小时恢复+0.1（同种效果取最高）'],
    [2, 'CONTROL', '进驻控制中枢时，所有宿舍内精英干员的心情每小时恢复+0.2（同种效果取最高）'],
    ...[3, 4, 5].map(id => [id, 'POWER', '进驻发电站时，无人机充能速度+0%']),
  ], [['c', 'CONTROL', 5, [1, 2]], ['d1', 'DORMITORY', 1, [3, 4]],
    ['d2', 'DORMITORY', 1, []], ['m', 'MANUFACTURE', 3, [5]]]);
  f.catalog.operatorGroups = { 'cc.g.elite': ['char_3', 'char_5'] };
  const evaluate = createIsolatedEvaluator(f.snapshot, f.catalog);
  const result = evaluate(f.assignment);
  assert.equal(result.operators[3].moodRecovery, 0.2);
  for (const id of [1, 2, 4, 5]) assert.equal(result.operators[id].moodRecovery, undefined);
  const moved = evaluate({ ...f.assignment, d1: [4], d2: [5], m: [3] });
  assert.equal(moved.operators[5].moodRecovery, 0.2);
  assert.equal(moved.operators[3].moodRecovery, undefined);
  delete f.catalog.operatorGroups;
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE' });
});

test('中枢宿舍恢复作用每个宿舍人员，同种全局取最高并与宿舍本地效果叠加', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，所有宿舍内所有干员的心情每小时恢复+0.05（同种效果取最高）'],
    [2, 'CONTROL', '进驻控制中枢时，所有宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高）'],
    [3, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）'],
    [4, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
    [5, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['c', 'CONTROL', 5, [1, 2]], ['d1', 'DORMITORY', 1, [3]],
    ['d2', 'DORMITORY', 1, [4]], ['m', 'MANUFACTURE', 3, [5]]]);
  const result = run(f);
  assert.ok(Math.abs(result.operators[3].moodRecovery - 0.3) < 1e-12);
  assert.equal(result.operators[4].moodRecovery, 0.1);
  assert.equal(result.operators[1].moodRecovery, undefined);
  assert.equal(result.operators[5].moodRecovery, undefined);
  assert.equal(result.rooms.d1.moodRecovery, undefined);
});

test('宿舍等级恢复先合并整条技能再与全员恢复取最高，换等级不重复叠加基础值', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.15，同时当前宿舍每级为恢复效果额外+0.02（叠加后的最终值同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）'],
  ], [['d', 'DORMITORY', 5, [1, 2]]]);
  let result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.25);
  assert.equal(result.operators[2].moodRecovery, 0.25);
  f.snapshot.rooms[0].level = 1;
  result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.2);
});

test('宿舍排除自身的群体恢复只作用同房其他人员，并按受益者取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内除自身以外所有干员的心情每小时恢复+0.1（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.05（同种效果取最高）'],
    [3, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.3'],
  ], [['d', 'DORMITORY', 1, [1, 2]], ['other', 'DORMITORY', 1, [3]]]);
  const result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.05);
  assert.equal(result.operators[2].moodRecovery, 0.1);
  assert.equal(result.operators[3].moodRecovery, 0.3);
});

test('同房其他干员人数只增加技能持有人的宿舍恢复，不计自身或别的宿舍', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.7；如果该宿舍内有其他干员，则每人额外为自身心情每小时恢复+0.05'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['d', 'DORMITORY', 1, [1, 2]], ['other', 'DORMITORY', 1, [3]]]);
  let result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.75);
  assert.equal(result.operators[2].moodRecovery, undefined);
  assert.equal(result.operators[3].moodRecovery, undefined);
  f.assignment.d = [1]; f.assignment.other = [2, 3];
  result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.7);
});

test('源石配方加成只作用对应配方，不与芯片配方混淆', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，源石类配方的生产力+35%']],
    [['m', 'MANUFACTURE', 3, [1]]]);
  f.catalog.manufactFormulas = { origin: { buffType: 'M_DIAMOND' }, chip: { buffType: 'M_ASC' } };
  f.snapshot.rooms[0].formulaId = 'origin';
  assert.equal(run(f).rooms.m.production, 0.35);
  f.snapshot.rooms[0].formulaId = 'chip';
  assert.equal(run(f).rooms.m.production, undefined);
});

test('贸易站数量联动按设施数而非等级人数求值，只作用贵金属配方', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，每个贸易站为当前制造站贵金属类配方的生产力+20%']],
    [['m', 'MANUFACTURE', 3, [1]], ['t1', 'TRADING', 1, []], ['t2', 'TRADING', 3, []]]);
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' }, exp: { buffType: 'M_EXP' } };
  f.snapshot.rooms[0].formulaId = 'gold';
  assert.equal(run(f).rooms.m.production, 0.4);
  f.snapshot.rooms.pop(); delete f.assignment.t2;
  assert.equal(run(f).rooms.m.production, 0.2);
  f.snapshot.rooms[0].formulaId = 'exp';
  assert.equal(run(f).rooms.m.production, undefined);
});

test('同房贸易队友人数加成排除自身，不计其他设施人员', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，贸易站内除自身以外每名处于工作状态的干员+15%订单获取效率'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+20%'],
    [3, 'TRADING', '进驻贸易站时，订单获取效率+30%'],
    [4, 'TRADING', '进驻贸易站时，订单获取效率+25%'],
  ], [['a', 'TRADING', 3, [1, 2, 3]], ['b', 'TRADING', 3, [4]]]);
  assert.equal(run(f).rooms.a.orderSpeed, 0.8);
  f.assignment.a = [1];
  assert.equal(run(f).rooms.a.orderSpeed, 0);
  assert.equal(run(f).rooms.b.orderSpeed, 0.25);
});

test('制造同房全员减耗逐人应用，不传播到其他房间', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内所有干员心情每小时消耗-0.1'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+25%，心情每小时消耗+0.25'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+20%'],
  ], [['a', 'MANUFACTURE', 3, [1, 2]], ['b', 'MANUFACTURE', 3, [3]]]);
  const result = run(f);
  assert.equal(result.operators[1].moodCost, -0.1);
  assert.equal(result.operators[2].moodCost, 0.15);
  assert.equal(result.operators[3].moodCost, undefined);
});

test('新增机制不能吞掉未知尾句或跨房工作人数条件', () => {
  for (const [type, text] of [
    ['MANUFACTURE', '进驻制造站时，源石类配方的生产力+35%，未来未知效果'],
    ['MANUFACTURE', '进驻制造站时，每个贸易站为当前制造站贵金属类配方的生产力+20%，未来未知效果'],
    ['TRADING', '进驻贸易站时，基建内除自身以外每名处于工作状态的干员+15%订单获取效率'],
  ]) {
    const f = fixture([[1, type, text]], [['a', type, 3, [1]]]);
    assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  }
});

test('本房两人加成相加，中枢同种最高额外加入且不影响另一量纲', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
    [2, 'MANUFACTURE', '进驻制造站时，生产力+15%'],
    [3, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）'],
    [4, 'CONTROL', '进驻控制中枢时，所有制造站生产力+3%（同种效果取最高）'],
    [5, 'TRADING', '进驻贸易站时，订单获取效率+30%'],
  ], [['m', 'MANUFACTURE', 3, [1, 2]], ['c', 'CONTROL', 5, [3, 4]], ['t', 'TRADING', 3, [5]]]);
  const result = run(f);
  assert.ok(Math.abs(result.rooms.m.production - 0.43) < 1e-12);
  assert.equal(result.rooms.t.orderSpeed, 0.3);
  assert.equal(result.rooms.t.production, undefined);
});

test('宿舍等级联动随快照计算，不能沿用上次求值缓存', () => {
  const f = fixture([[1, 'TRADING', '进驻贸易站时，每间宿舍每级+1%获取效率']],
    [['t', 'TRADING', 3, [1]], ['d1', 'DORMITORY', 5, []], ['d2', 'DORMITORY', 2, []]]);
  assert.equal(run(f).rooms.t.orderSpeed, 0.07);
  f.snapshot.rooms[2].level = 4;
  assert.equal(run(f).rooms.t.orderSpeed, 0.09);
});

test('宿舍全员恢复只取最高，再加各自恢复，不重复叠加', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）'],
    [3, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复+0.7'],
  ], [['d', 'DORMITORY', 5, [1, 2, 3]]]);
  const result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.2);
  assert.equal(result.operators[2].moodRecovery, 0.2);
  assert.ok(Math.abs(result.operators[3].moodRecovery - 0.9) < 1e-12);
});

test('贸易全员减耗只应用本房，自身减耗不传播给队友', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，贸易站内干员心情每小时消耗-0.1'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+20%，心情每小时消耗-0.25'],
    [3, 'TRADING', '进驻贸易站时，订单获取效率+30%'],
  ], [['a', 'TRADING', 3, [1, 2]], ['b', 'TRADING', 3, [3]]]);
  const result = run(f);
  assert.equal(result.operators[1].moodCost, -0.1);
  assert.equal(result.operators[2].moodCost, -0.35);
  assert.equal(result.operators[3].moodCost, undefined);
});

test('会客室独自工作条件同时约束速度和消耗，加入队友后整条条件失效', () => {
  const f = fixture([
    [1, 'MEETING', '进驻会客室时，如果会客室内只有自身处于工作状态时，线索搜集速度提升50%，心情每小时消耗+2'],
    [2, 'MEETING', '进驻会客室时，线索搜集速度提升10%'],
  ], [['r', 'MEETING', 3, [1]]]);
  let result = run(f);
  assert.equal(result.rooms.r.clueSpeed, 0.5);
  assert.equal(result.operators[1].moodCost, 2);
  f.assignment.r = [1, 2];
  result = run(f);
  assert.equal(result.rooms.r.clueSpeed, 0.1);
  assert.equal(result.operators[1].moodCost, undefined);
});

test('会客室独处条件不接受未知额外条件或套用到其他设施', () => {
  for (const text of [
    '进驻会客室时，如果会客室内只有自身处于工作状态时，线索搜集速度提升50%，且未知条件',
    '进驻会客室时，如果会客室内只有自身处于工作状态且未知状态时，线索搜集速度提升50%',
  ]) {
    const f = fixture([[1, 'MEETING', text]], [['r', 'MEETING', 3, [1]]]);
    assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM' });
  }
});

test('空房不凭中枢技能产生人工产能，没有工人则无工作增量', () => {
  const f = fixture([[1, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）']],
    [['c', 'CONTROL', 5, [1]], ['m', 'MANUFACTURE', 3, []]]);
  assert.deepEqual(run(f).rooms.m, {});
});

test('完整技能无法解释则拒绝求值，不把部分产能冒充完整结果', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，生产力+20%，未来全局机制']],
    [['m', 'MANUFACTURE', 3, [1]]]);
  assert.throws(() => run(f), { code: 'UNSUPPORTED_MECHANISM', status: 422 });
});

test('未解锁、未进驻及不在适用房间的技能不错误阻断具体方案求值', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '未来未知描述'],
    [2, 'TRADING', '未来未知描述'],
    [3, 'MANUFACTURE', '未来未知描述'],
  ], [['m', 'MANUFACTURE', 3, [1, 2]], ['d', 'DORMITORY', 5, []]]);
  f.catalog.chars.char_1.buffChar[0].buffData[0].cond.phase = 2;
  assert.deepEqual(run(f).rooms.m, {});
});

test('单人换到别的设施后不再带入原房增量，所有输出都是新对象', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，生产力+25%']],
    [['m', 'MANUFACTURE', 3, [1]], ['d', 'DORMITORY', 5, []]]);
  const before = JSON.stringify(f);
  const first = run(f);
  assert.equal(JSON.stringify(f), before);
  f.assignment.m = []; f.assignment.d = [1];
  assert.deepEqual(run(f).rooms.m, {});
  assert.equal(first.rooms.m.production, 0.25);
});

test('求值前验证互斥与疲劳，非法方案不能成为候选得分', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，生产力+25%']],
    [['m', 'MANUFACTURE', 3, [1]], ['d', 'DORMITORY', 5, []]]);
  f.assignment.d = [1];
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
  f.assignment.d = []; f.snapshot.operators[0].ap = 0;
  assert.throws(() => run(f), { code: 'INVALID_ASSIGNMENT' });
});

test('配方条件只控制对应效果，后续自身消耗仍生效', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，作战记录类配方的生产力+35%，心情每小时消耗+0.25']],
    [['m', 'MANUFACTURE', 3, [1]]]);
  f.catalog.manufactFormulas = { exp: { buffType: 'M_EXP' }, gold: { buffType: 'M_GOLD' } };
  f.snapshot.rooms[0].formulaId = 'exp';
  assert.equal(run(f).rooms.m.production, 0.35);
  f.snapshot.rooms[0].formulaId = 'gold';
  assert.equal(run(f).rooms.m.production, undefined);
  assert.equal(run(f).operators[1].moodCost, 0.25);
});

test('条件整句消耗和容量不能在其它配方触发', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，生产作战记录类配方时，心情每小时消耗-0.25']],
    [['m', 'MANUFACTURE', 3, [1]]]);
  f.catalog.manufactFormulas = { x: { buffType: 'M_GOLD' } };
  f.snapshot.rooms[0].formulaId = 'x';
  assert.equal(run(f).operators[1].moodCost, undefined);
  f.catalog.manufactFormulas.x.buffType = 'M_EXP';
  assert.equal(run(f).operators[1].moodCost, -0.25);
  f.catalog.buffs.buff_1.description = '进驻制造站时，生产作战记录类配方时，仓库容量上限+12';
  assert.equal(run(f).rooms.m.capacity, 12);
});

test('配方缺失不能当作条件不成立忽略；联动按宿舍等级求值', () => {
  const f = fixture([[1, 'MANUFACTURE', '进驻制造站时，每间宿舍每级为贵金属类配方的生产力+1%']],
    [['m', 'MANUFACTURE', 3, [1]], ['d', 'DORMITORY', 5, []]]);
  assert.throws(() => run(f), { code: 'MISSING_MECHANISM_STATE', status: 422 });
  f.snapshot.rooms[0].formulaId = 'gold';
  f.catalog.manufactFormulas = { gold: { buffType: 'M_GOLD' } };
  assert.equal(run(f).rooms.m.production, 0.05);
});

test('中枢全员恢复逐人叠加，不传播到制造站或宿舍', () => {
  const f = fixture([
    [1, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05'],
    [2, 'CONTROL', '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05'],
    [3, 'MANUFACTURE', '进驻制造站时，生产力+25%'],
  ], [['c', 'CONTROL', 5, [1, 2]], ['m', 'MANUFACTURE', 3, [3]]]);
  const result = run(f);
  assert.equal(result.operators[1].moodRecovery, 0.1);
  assert.equal(result.operators[2].moodRecovery, 0.1);
  assert.equal(result.operators[3].moodRecovery, undefined);
});

test('负自身恢复不被全员最高恢复覆盖，保留净增量', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，自身心情每小时恢复-0.1，该宿舍内所有干员的心情每小时恢复+0.25（同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高）'],
  ], [['d', 'DORMITORY', 5, [1, 2]]]);
  assert.equal(run(f).operators[1].moodRecovery, 0.15);
  assert.equal(run(f).operators[2].moodRecovery, 0.25);
});

test('发电站数量恢复先合并基础值，再与其他宿舍全员效果取最高', () => {
  const f = fixture([
    [1, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1，同时每有1间发电站，则恢复效果额外+0.05（叠加后的最终值同种效果取最高）'],
    [2, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.22（同种效果取最高）'],
  ], [['d', 'DORMITORY', 5, [1, 2]], ['p1', 'POWER', 3, []], ['p2', 'POWER', 1, []]]);
  assert.equal(run(f).operators[1].moodRecovery, 0.22);
  f.snapshot.rooms.push({ slot: 'p3', type: 'POWER', level: 3, occupants: [], capacity: 1 });
  f.assignment.p3 = [];
  assert.equal(run(f).operators[2].moodRecovery, 0.25);
  f.snapshot.rooms = f.snapshot.rooms.filter(room => room.type !== 'POWER');
  delete f.assignment.p1; delete f.assignment.p2; delete f.assignment.p3;
  assert.equal(run(f).operators[1].moodRecovery, 0.22);
});

test('制造容量转生产先汇总同房技能容量，不使用玩家快照中的总容量', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，当前制造站内干员提升的每格仓库容量，提供2%生产力'],
    [2, 'MANUFACTURE', '进驻制造站时，仓库容量上限+8，生产力-5%'],
    [3, 'MANUFACTURE', '进驻制造站时，仓库容量上限+10，生产力+10%'],
    [4, 'MANUFACTURE', '进驻制造站时，仓库容量上限+20'],
  ], [['m', 'MANUFACTURE', 3, [1, 2, 3]], ['other', 'MANUFACTURE', 3, [4]]]);
  f.snapshot.rooms[0].inputCapacity = 999;
  assert.equal(run(f).rooms.m.capacity, 18);
  assert.ok(Math.abs(run(f).rooms.m.production - 0.41) < 1e-12);
  // 交换技能枚举顺序，不能使派生效果在容量求值前抢跑。
  f.assignment.m = [3, 1, 2];
  assert.ok(Math.abs(run(f).rooms.m.production - 0.41) < 1e-12);
  f.assignment.m = [1];
  assert.equal(run(f).rooms.m.production, 0);
});

test('贸易订单上限转效率只读取本房技能上限并与普通效率叠加', () => {
  const f = fixture([
    [1, 'TRADING', '进驻贸易站时，当前贸易站内干员提升的每个订单上限，提供4%订单获取效率'],
    [2, 'TRADING', '进驻贸易站时，订单获取效率+30%，且订单上限+2'],
    [3, 'TRADING', '进驻贸易站时，当前贸易站每级+1个订单上限'],
  ], [['t', 'TRADING', 3, [1, 2, 3]]]);
  f.snapshot.rooms[0].stockLimit = 999;
  assert.equal(run(f).rooms.t.capacity, 5);
  assert.equal(run(f).rooms.t.orderSpeed, 0.5);
});

test('七类已编译基础规则均有真实求值用例，容量依赖房间等级', () => {
  const f = fixture([
    [1, 'MANUFACTURE', '进驻制造站时，仓库容量上限+8，生产力-5%'],
    [2, 'TRADING', '进驻贸易站时，当前贸易站每级+1个订单上限'],
    [3, 'POWER', '进驻发电站时，无人机充能速度+15%，每间宿舍每级为充能速度额外+0.5%'],
    [4, 'MEETING', '进驻会客室时，线索搜集速度提升20%'],
    [5, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+45%，每间宿舍每级额外+1%人脉资源的联络速度'],
    [6, 'CONTROL', '进驻控制中枢时，所有贸易站订单效率+7%（同种效果取最高），人力办公室联络速度+10%（同种效果取最高），会客室线索搜集速度+25%（同种效果取最高）'],
  ], [['m', 'MANUFACTURE', 3, [1]], ['t', 'TRADING', 2, [2]], ['p', 'POWER', 3, [3]],
    ['r', 'MEETING', 3, [4]], ['h', 'HIRE', 3, [5]], ['c', 'CONTROL', 5, [6]], ['d', 'DORMITORY', 5, []]]);
  const result = run(f);
  assert.equal(result.rooms.m.capacity, 8);
  assert.equal(result.rooms.m.production, -0.05);
  assert.equal(result.rooms.t.capacity, 2);
  assert.equal(result.rooms.t.orderSpeed, 0.07);
  assert.equal(result.rooms.p.droneSpeed, 0.175);
  assert.equal(result.rooms.r.clueSpeed, 0.45);
  assert.equal(result.rooms.h.contactSpeed, 0.6);
});
