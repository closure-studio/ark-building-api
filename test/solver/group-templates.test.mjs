import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { arrangePreview } from '../../src/arrange.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { syntheticPlayer } from '../fixtures/player.mjs';
import { createGroupNeighbors } from '../../src/solver/group-templates.mjs';
import { createAssignmentValidator } from '../../src/validate/assignment.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} != ${expected}`);
function fixture(size = 80) {
  const filler = Array.from({ length: size - 2 }, (_, i) => `filler_${i}`);
  const ids = [...filler, 'char_102_texas', 'char_140_whitew'];
  const data = { ...catalog, chars: { ...catalog.chars } };
  for (const id of filler) data.chars[id] = { maxManpower: 8640000,
    buffChar: [{ buffData: [{ buffId: 'trade_ord_spd[000]', cond: { phase: 0, level: 1 } }] }] };
  const input = syntheticPlayer(ids);
  for (const op of Object.values(input.building.chars)) op.ap = 8640000;
  input.building.roomSlots = { t: { roomId: 'TRADING', level: 3, state: 2, charInstIds: [] } };
  input.building.rooms = { TRADING: { t: { strategy: 'O_GOLD', stockLimit: 10, stock: [] } } };
  return { data, input };
}
function solve({ data, input }, maxNodes = 400) {
  const before = JSON.stringify(input);
  const result = arrangePreview(input, data, { maxNodes });
  assert.ok(result.diagnostics.search.nodes <= maxNodes);
  assert.equal(JSON.stringify(input), before);
  const assignment = Object.fromEntries(Object.values(result.preview.arranged).flat()
    .map(room => [room.Slot, room.RoomChar.map(op => op.Inst.Inst)]));
  const modifiers = evaluateModifiers(normalize(input, data), assignment, data);
  return { result, assignment, modifiers };
}

test('80人小预算仍能发现单独换入会降分的高编号伙伴班组', () => {
  const { assignment, modifiers } = solve(fixture());
  assert.ok(assignment.t.includes(79));
  assert.ok(assignment.t.includes(80));
  near(modifiers.rooms.t.orderSpeed, 0.85);
});

test('小阵容最终班组与独立穷举数值一致，不用求解器输出充当oracle', () => {
  const size = 6;
  let expected = 0;
  for (let mask = 0; mask < 2 ** size; mask++) {
    const ids = Array.from({ length: size }, (_, i) => i + 1).filter(id => mask & 2 ** (id - 1));
    if (ids.length > 3) continue;
    const value = ids.filter(id => id <= size - 2).length * 0.2
      + (ids.includes(size - 1) && ids.includes(size) ? 0.65 : 0);
    expected = Math.max(expected, value);
  }
  const { result, modifiers } = solve(fixture(size), 10000);
  assert.equal(result.diagnostics.search.exhausted, true);
  near(modifiers.rooms.t.orderSpeed, expected);
});

test('同房阵营模板保留单人弱贡献来源，按完整班组求值', () => {
  const filler = Array.from({ length: 77 }, (_, i) => `filler_${i}`);
  const ids = [...filler, 'char_1036_fang2', 'char_123_fang', 'char_122_beagle'];
  const data = { ...catalog, chars: { ...catalog.chars } };
  for (const id of ids) data.chars[id] = { maxManpower: 8640000, buffChar: [{ buffData: [{
    buffId: id === 'char_1036_fang2' ? 'manu_prod_spd&fraction[000]'
      : filler.includes(id) ? 'manu_prod_spd[010]' : 'manu_prod_spd[020]',
    cond: { phase: 0, level: 1 },
  }] }] };
  const input = syntheticPlayer(ids);
  for (const op of Object.values(input.building.chars)) op.ap = 8640000;
  input.building.roomSlots = { m: { roomId: 'MANUFACTURE', level: 3, state: 2, charInstIds: [] } };
  input.building.rooms = { MANUFACTURE: { m: { formulaId: '4', capacity: 24 } } };
  const { assignment, modifiers } = solve({ data, input });
  assert.deepEqual([...assignment.m].sort((a, b) => a - b), [78, 79, 80]);
  near(modifiers.rooms.m.production, 0.8);
});

test('跨房伙伴整体搬入并回填原岗位，全局求值仍计另一房间的损失', () => {
  const f = fixture();
  f.data.chars = { ...f.data.chars, source: { maxManpower: 8640000,
    buffChar: [{ buffData: [{ buffId: 'manu_formula_spd_P[000]', cond: { phase: 0, level: 1 } }] }] },
    char_196_sunbr: { ...f.data.chars.char_196_sunbr, buffChar: [] } };
  f.input.troop.chars[79].charId = 'source'; f.input.building.chars[79].charId = 'source';
  f.input.troop.chars[80].charId = 'char_196_sunbr'; f.input.building.chars[80].charId = 'char_196_sunbr';
  f.input.building.roomSlots.m = { roomId: 'MANUFACTURE', level: 3, state: 2, charInstIds: [] };
  f.input.building.rooms.MANUFACTURE = { m: { formulaId: '1', capacity: 24 } };
  const snapshot = normalize(f.input, f.data);
  const base = { m: [1, 2, 3], t: [4, 5, 6] };
  const isolation = { frozenSlots: [], excludedIds: [] };
  const neighbors = [...createGroupNeighbors(snapshot, f.data, isolation)(base)];
  assert.ok(neighbors.length > 0);
  const validate = createAssignmentValidator(snapshot, f.data);
  for (const next of neighbors) {
    validate(next);
    assert.ok(next.m.includes(79)); assert.ok(next.t.includes(80));
    const modifiers = evaluateModifiers(snapshot, next, f.data);
    near(modifiers.rooms.m.production, 0.35);
    near(modifiers.rooms.t.orderSpeed, 0.4);
  }
  assert.deepEqual(base, { m: [1, 2, 3], t: [4, 5, 6] });
  const fromOtherRooms = { m: [1, 2, 80], t: [4, 5, 79] };
  for (const next of createGroupNeighbors(snapshot, f.data, isolation)(fromOtherRooms)) {
    validate(next);
    assert.equal(next.m.length, 3); assert.equal(next.t.length, 3);
  }
  snapshot.rooms.find(room => room.slot === 'm').formulaId = '4';
  assert.deepEqual([...createGroupNeighbors(snapshot, f.data, isolation)(base)], []);
  snapshot.rooms.find(room => room.slot === 'm').formulaId = '1';
  snapshot.operators.find(op => op.instId === 79).evolvePhase = 0;
  f.data.chars.source.buffChar[0].buffData[0].cond.phase = 2;
  assert.deepEqual([...createGroupNeighbors(snapshot, f.data, isolation)(base)], []);
});

test('冻结、排除和指纹漂移不进入组合模板，有序完整候选去重', () => {
  const f = fixture(), snapshot = normalize(f.input, f.data), base = { t: [1, 2, 3] };
  const isolation = { frozenSlots: [], excludedIds: [] };
  const neighbors = [...createGroupNeighbors(snapshot, f.data, isolation)(base)];
  assert.ok(neighbors.length > 0);
  assert.equal(new Set(neighbors.map(value => JSON.stringify(value))).size, neighbors.length);
  assert.deepEqual([...createGroupNeighbors(snapshot, f.data, { ...isolation, excludedIds: [80] })(base)], []);
  snapshot.rooms[0].occupants = [80];
  assert.deepEqual([...createGroupNeighbors(snapshot, f.data, { ...isolation, frozenSlots: ['t'] })({ t: [80] })], []);
  f.data.chars.char_140_whitew = { ...f.data.chars.char_140_whitew, buffChar: [] };
  f.data.buffs = { ...f.data.buffs, 'trade_ord_spd&cost_P[000]': {
    ...f.data.buffs['trade_ord_spd&cost_P[000]'], description: 'unverified drift',
  } };
  assert.deepEqual([...createGroupNeighbors(snapshot, f.data, isolation)(base)], []);
});

function crossFixture(kind) {
  const f = fixture();
  const rows = kind === 'abyssal' ? [['control_mp_aegir2[010]'], [], [], [],
    ['manu_prod_spd[004]'], ['manu_prod_spd[004]'], ['manu_prod_spd[004]']]
    : kind === 'resource' ? [['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'],
      ['hire_spd_bd_n1_n1[100]', 'hire_spd_bd_n1[000]'],
      ['dorm_rec_bd_n1_n2[000]', 'dorm_rec_bd_n1[000]'], ['manu_prod_spd[004]']]
      : [['manu_token_prod_spd[010]'], [], [], [], ['manu_prod_spd[004]']];
  const ids = Array.from({ length: 80 }, (_, i) => `cross_${i}`);
  f.data.chars = Object.fromEntries(ids.map(id => [id, { maxManpower: 8640000, buffChar: [] }]));
  rows.forEach((skills, index) => { f.data.chars[ids[80 - rows.length + index]].buffChar = skills.map(buffId => ({
    buffData: [{ buffId, cond: { phase: 0, level: 1 } }],
  })); });
  f.data.characterAffiliations = Object.fromEntries(ids.map(id => [id, []]));
  f.data.operatorGroups = { ...catalog.operatorGroups,
    'cc.g.abyssal': ids.slice(74, 77), 'cc.tag.op': ids.slice(76, 79) };
  f.input = syntheticPlayer(ids);
  for (const op of Object.values(f.input.building.chars)) op.ap = 8640000;
  f.input.building.roomSlots = { m: { roomId: 'MANUFACTURE', level: kind === 'abyssal' ? 3 : 1, state: 2, charInstIds: [] } };
  f.input.building.rooms = { MANUFACTURE: { m: { formulaId: '4', capacity: 24 } } };
  const add = (slot, type, level = 1, details = {}) => {
    f.input.building.roomSlots[slot] = { roomId: type, level, state: 2, charInstIds: [] };
    (f.input.building.rooms[type] ??= {})[slot] = details;
  };
  if (kind === 'abyssal') add('c', 'CONTROL');
  if (kind === 'resource') { add('h', 'HIRE', 3); add('d', 'DORMITORY', 5, { comfort: 1000 }); }
  if (kind === 'power') for (let i = 0; i < 3; i++) add(`p${i}`, 'POWER');
  return f;
}

test('高编号中枢与三个深海成员同时入岗，2000节点发现0.9而非0.6制造增量', () => {
  const { assignment, modifiers } = solve(crossFixture('abyssal'), 2000);
  assert.ok(assignment.c.includes(74));
  assert.deepEqual([...assignment.m].sort((a, b) => a - b), [75, 76, 77]);
  near(modifiers.rooms.m.production, 0.9);
});

test('高编号记忆和小节来源同时接通转换链，2000节点发现0.30而非0.20制造增量', () => {
  const { assignment, modifiers } = solve(crossFixture('resource'), 2000);
  assert.deepEqual(assignment.m, [77]);
  assert.deepEqual(assignment.h, [78]);
  assert.ok(assignment.d.includes(79));
  assert.equal(assignment.d.length, 5);
  near(modifiers.rooms.m.production, 0.30);
});

test('群体成员分配至三个发电站，2000节点发现0.30而非0.20制造增量', () => {
  const { assignment, modifiers } = solve(crossFixture('power'), 2000);
  assert.deepEqual(assignment.m, [76]);
  assert.deepEqual(['p0', 'p1', 'p2'].flatMap(slot => assignment[slot]).sort((a, b) => a - b), [77, 78, 79]);
  near(modifiers.rooms.m.production, 0.30);
});

test('跨房模板不修改输入，保持唯一人员与容量，并尊重疲劳、预留、排除和冻结', () => {
  for (const kind of ['abyssal', 'resource', 'power']) for (const mode of ['normal', 'tired', 'reserved', 'excluded', 'frozen']) {
    const f = crossFixture(kind);
    const source = kind === 'abyssal' ? 74 : kind === 'resource' ? 77 : 76;
    const slot = kind === 'abyssal' ? 'c' : 'm';
    if (mode === 'tired') f.input.building.chars[source].ap = 0;
    const snapshot = normalize(f.input, f.data);
    if (mode === 'reserved') snapshot.reservedIds.push(source);
    const base = Object.fromEntries(snapshot.rooms.map(room => [room.slot, []]));
    const isolation = { frozenSlots: mode === 'frozen' ? [slot] : [], excludedIds: mode === 'excluded' ? [source] : [] };
    if (mode === 'frozen') { base[slot] = [source]; snapshot.rooms.find(room => room.slot === slot).occupants = [source]; }
    const before = JSON.stringify({ snapshot, base });
    const neighbors = [...createGroupNeighbors(snapshot, f.data, isolation)(base)];
    const validate = createAssignmentValidator(snapshot, f.data, isolation.frozenSlots);
    assert.ok(neighbors.length <= 512);
    assert.equal(new Set(neighbors.map(value => JSON.stringify(value))).size, neighbors.length);
    for (const next of neighbors) validate(next);
    if (mode === 'normal') assert.ok(neighbors.length > 0);
    else assert.deepEqual(neighbors, [], `${kind}: ${mode}`);
    assert.equal(JSON.stringify({ snapshot, base }), before);
  }
});

test('疲劳伙伴与保护岗位人员不能为了凑组合被重新启用', () => {
  for (const mode of ['tired', 'reserved']) {
    const f = fixture();
    if (mode === 'tired') f.input.building.chars[80].ap = 0;
    else {
      f.input.building.roomSlots.w = { roomId: 'WORKSHOP', level: 1, state: 2, charInstIds: [80] };
      f.input.building.chars[80].roomSlotId = 'w';
    }
    const { assignment, modifiers } = solve(f);
    assert.ok(!assignment.t.includes(80));
    near(modifiers.rooms.t.orderSpeed, 0.6);
  }
});
