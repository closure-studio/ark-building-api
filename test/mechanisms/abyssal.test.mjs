import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
function fixture(phase = 2) {
  const names = ['歌蕾蒂娅', '斯卡蒂', '幽灵鲨', '安哲拉', '乌尔比安'];
  const chars = names.map(name => Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name));
  assert.ok(chars.every(Boolean));
  const data = { ...catalog, chars: { ...catalog.chars, plain: { maxManpower: 8640000, buffChar: [] } } };
  // 独立校验联动公式；除来源外移除个人技能，再另测真实完整角色。
  for (const id of chars.slice(1)) data.chars[id] = { maxManpower: 8640000, buffChar: [] };
  const operators = [...chars, 'plain'].map((charId, index) => ({ instId: index + 1, charId,
    evolvePhase: phase, level: 1, ap: 4320000 }));
  const rooms = [
    { slot: 'c', type: 'CONTROL', level: 5, capacity: 5, occupants: [1] },
    { slot: 'm', type: 'MANUFACTURE', level: 3, capacity: 3, occupants: [2, 3, 4] },
    { slot: 'n', type: 'MANUFACTURE', level: 3, capacity: 3, occupants: [5] },
    { slot: 'd', type: 'DORMITORY', level: 5, capacity: 5, comfort: 5000, occupants: [6] },
  ];
  const snapshot = { operators, rooms, reservedIds: [], facilities: rooms.map(r => ({ ...r, state: 2 })) };
  return { data, snapshot, assignment: Object.fromEntries(rooms.map(r => [r.slot, [...r.occupants]])) };
}

test('深海名单由锁定术语提供，不将异格自动视为同一成员', () => {
  assert.equal(catalog.operatorGroups['cc.g.abyssal']?.length, 5);
  assert.ok(!catalog.operatorGroups['cc.g.abyssal'].includes('char_1012_skadi2'));
});

for (const [phase, main, split] of [[0, 0.45, 0.2], [2, 0.9, 0.4]]) {
  test(`完整深海联动精${phase}：跨站计数、单站封顶、来源换岗与恢复`, () => {
    const { snapshot, data, assignment } = fixture(phase);
    const evaluate = createIsolatedEvaluator(snapshot, data);
    const result = evaluate(assignment);
    close(result.rooms.m.production, main);
    close(result.rooms.n.production, split);
    close(result.operators[1].moodCost, 2.5);
    close(result.operators[1].moodRecovery, 0.05);
    const moved = evaluate({ c: [1], m: [2, 3], n: [], d: [4, 5, 6] });
    close(moved.rooms.m.production, phase === 0 ? 0.2 : 0.4);
    close(moved.operators[1].moodCost, 0.5);
    assert.equal(evaluate({ c: [], m: [2, 3, 4], n: [5], d: [1, 6] }).rooms.m.production, undefined);
    assert.deepEqual(evaluate(assignment), result);
    const reversed = { ...snapshot, rooms: [...snapshot.rooms].reverse() };
    const reordered = createIsolatedEvaluator(reversed, data)(assignment);
    assert.deepEqual(reordered.rooms, result.rooms);
    assert.deepEqual(reordered.operators, result.operators);
  });
}

test('满心情宿舍、空闲与保护岗位分别计数，缺状态明确拒绝', () => {
  const { snapshot, data } = fixture();
  snapshot.operators[1].ap = 8640000;
  snapshot.operators[4].roomSlotId = 'training';
  snapshot.reservedIds = [5];
  snapshot.facilities.push({ slot: 'training', type: 'TRAINING', level: 3, state: 2 });
  const assignment = { c: [1], m: [], n: [], d: [2, 3, 6] };
  const result = createIsolatedEvaluator(snapshot, data)(assignment);
  // 工作：自身和训练室+1；宿舍：满心情-1、半心情-0.5；空闲安哲拉不计。
  close(result.operators[1].moodCost, -0.5);
  delete snapshot.facilities;
  assert.throws(() => createIsolatedEvaluator(snapshot, data)(assignment), { code: 'MISSING_MECHANISM_STATE' });
});

test('深海加成优先于配合意识，自动化清零优先于深海加成', () => {
  const { snapshot, data } = fixture();
  data.chars.plain = { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: 'manu_prod_spd_variable2[000]', cond: { phase: 0, level: 1 } }] }] };
  assert.ok(catalog.buffs['manu_prod_spd_variable2[000]']);
  const assignment = { c: [1], m: [2, 6], n: [3, 4], d: [5] };
  close(createIsolatedEvaluator(snapshot, data)(assignment).rooms.m.production, 0.3);
  data.chars.plain.buffChar[0].buffData[0].buffId = 'manu_prod_spd&power[000]';
  assert.equal(createIsolatedEvaluator(snapshot, data)(assignment).rooms.m.production ?? 0, 0);
});

test('深海名单与满心情上限缺失时拒绝，不把未知条件当零', () => {
  const { snapshot, data } = fixture();
  const assignment = { c: [1], m: [2], n: [], d: [3] };
  assert.throws(() => createIsolatedEvaluator(snapshot, { ...data, operatorGroups: {} })(assignment),
    { code: 'MISSING_MECHANISM_STATE' });
  const charId = snapshot.operators[2].charId;
  data.chars[charId] = { ...data.chars[charId], maxManpower: undefined };
  assert.throws(() => createIsolatedEvaluator(snapshot, data)(assignment), { code: 'MISSING_MECHANISM_STATE' });
});

test('深海隔离覆盖宿舍与制造站的触发条件，不能冻结后间接换人', () => {
  const { snapshot, data } = fixture();
  const unknown = catalog.buffs['manu_prod_spd_addition[100]'];
  assert.ok(unknown);
  data.chars.plain = { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: unknown.buffId, cond: { phase: 0, level: 1 } }] }] };
  const plan = planIsolation(snapshot, data);
  assert.deepEqual(plan.frozenSlots, ['c', 'd', 'm', 'n']);
});
