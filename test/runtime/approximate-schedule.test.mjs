import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { arrangePreview } from '../../src/arrange.mjs';
import { syntheticPlayer } from '../fixtures/player.mjs';
import { normalize } from '../../src/protocol/normalize.mjs';
import { evaluateModifiers, createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { evaluateMood } from '../../src/mechanisms/mood.mjs';
import { practicalModel } from '../../src/solver/practical.mjs';
import { productionObjective } from '../../src/solver/objective.mjs';
import { baseLayout } from '../fixtures/base-layout.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
function fixture(buffId, type) {
  const data = { ...catalog, chars: { ...catalog.chars, source: { maxManpower: 8640000,
    buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] } } };
  const input = syntheticPlayer(['source']);
  input.building.chars[1].ap = 4320000;
  input.building.chars[1].roomSlotId = 'x';
  input.building.roomSlots = { x: { roomId: type, level: 3, state: 2, charInstIds: [1] } };
  input.building.rooms[type] = { x: type === 'TRADING' ? { strategy: 'O_GOLD', stockLimit: 10, stock: [] } : {} };
  return { data, input };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const roomIds = result => Object.values(result.preview.arranged).flat().find(room => room.Slot === 'x')
  .RoomChar.map(op => op.Inst.Inst);

test('生产优先可使用未知线索偏好的中枢人员，完整保留明确心情惩罚', () => {
  const { data, input } = fixture('control_clue_cost[000]', 'CONTROL');
  const before = structuredClone(input);
  assert.throws(() => arrangePreview(input, data), { code: 'UNISOLATABLE_MECHANISM' });
  const snapshot = normalize(input, data), assignment = { x: [1] };
  const model = practicalModel(snapshot, data);
  const modifiers = evaluateModifiers(snapshot, assignment, data, model.registry);
  near(evaluateMood(snapshot, assignment, data, modifiers)[1].changePerHour, -2.45);
  const result = arrangePreview(input, data, { practical: true });
  assert.deepEqual(result.diagnostics.frozenSlots, []);
  assert.equal(result.diagnostics.approximation.mode, 'production-priority');
  assert.ok(model.diagnostics(assignment).skills.some(row => row.buffId === 'control_clue_cost[000]'));
  assert.deepEqual(input, before);
});

test('线索类别未知仍计算已知搜集速度，不冒充类别概率数值', () => {
  const { data, input } = fixture('meet_spd&team[010]', 'MEETING');
  const result = arrangePreview(input, data, { practical: true });
  assert.deepEqual(roomIds(result), [1]);
  const score = result.diagnostics.objective;
  near(score.secondary[score.secondaryKeys.indexOf('x:clueSpeed')], 1.15);
  assert.ok(result.diagnostics.approximation.assumptions.includes('clue-type-preferences-not-scored'));
});

test('实用订单按长期龙门币比较，单列赤金消耗并保留当前订单未验证标记', () => {
  const { data, input } = fixture('trade_ord_closure[000]', 'TRADING');
  const before = structuredClone(input);
  const result = arrangePreview(input, data, { practical: true });
  assert.deepEqual(roomIds(result), [1]);
  const score = result.diagnostics.objective;
  near(score.primary[score.primaryKeys.indexOf('item:4001:perHour')], 555);
  near(score.primary[score.primaryKeys.indexOf('item:3003:perHour')], 0);
  near(score.resourceBalance.goldProducedPerHour, 0);
  near(score.resourceBalance.goldConsumedPerHour, 0.925);
  near(score.resourceBalance.goldNetPerHour, -0.925);
  assert.ok(score.limitations.includes('STEADY_NEW_ORDERS_ONLY'));
  assert.ok(result.diagnostics.approximation.assumptions.includes('steady-new-orders-after-warmup'));
  assert.deepEqual(input, before);
});

test('条件伙伴只触发对应速度与心情，缺席时不生效', () => {
  for (const [buffId, partnerId, type, baseSpeed, extraSpeed] of [
    ['meet_spd&bd[010]', 'char_2012_typhon', 'MEETING', 0.1, 0.15],
    ['meet_spd_notOwned_P[000]', 'char_1048_orchd2', 'CONTROL', 0, 0.1],
  ]) {
    const { data, input } = fixture(buffId, 'MEETING');
    data.chars = { ...data.chars, [partnerId]: { ...data.chars[partnerId], buffChar: [] } };
    input.troop.chars[2] = { instId: 2, charId: partnerId, level: 1, evolvePhase: 0 };
    input.building.chars[2] = { charId: partnerId, ap: 4320000, roomSlotId: '' };
    if (type === 'CONTROL') {
      input.building.roomSlots.c = { roomId: type, level: 5, state: 2, charInstIds: [] };
    }
    const snapshot = normalize(input, data), model = practicalModel(snapshot, data);
    for (const present of [false, true]) {
      const assignment = { x: type === 'MEETING' && present ? [1, 2] : [1],
        ...(type === 'CONTROL' ? { c: present ? [2] : [] } : {}) };
      const modifiers = evaluateModifiers(snapshot, assignment, data, model.registry);
      near(modifiers.rooms.x.clueSpeed ?? 0, baseSpeed + (present ? extraSpeed : 0));
      if (type === 'MEETING') near(modifiers.operators[1].moodCost ?? 0, present ? 0.5 : 0);
    }
  }
});

test('全部41条线索投影和16条订单技能均可经过实用入口，严格登记不变', () => {
  const model = practicalModel({ rooms: [], operators: [] }, catalog);
  const entries = Object.entries(model.registry).filter(([, entry]) => entry.approximation);
  assert.equal(entries.filter(([, entry]) => entry.approximation === 'clue-type-preferences-not-scored').length, 41);
  assert.equal(entries.filter(([, entry]) => entry.approximation === 'steady-new-orders-after-warmup').length, 16);
  for (const [buffId, entry] of entries) {
    const { data, input } = fixture(buffId, entry.roomType);
    const before = structuredClone(input);
    const result = arrangePreview(input, data, { practical: true, maxNodes: 2000 });
    assert.ok(result.diagnostics.search.nodes <= 2000, buffId);
    assert.deepEqual(input, before, buffId);
    assert.ok(result.diagnostics.objective.primary.every(Number.isFinite), buffId);
    if (entry.roomType === 'TRADING') assert.deepEqual(roomIds(result), [1], buffId);
  }
});

test('同预算全持有班表不能因省赤金而主动降低贸易收入', () => {
  for (const layout of ['252', '243']) {
    const input = baseLayout(Object.keys(catalog.chars), layout);
    for (const op of Object.values(input.troop.chars)) { op.evolvePhase = 2; op.level = 90; }
    const snapshot = normalize(input, catalog), model = practicalModel(snapshot, catalog);
    const old = arrangePreview(input, catalog, { maxNodes: 2000 });
    const assignment = Object.fromEntries(Object.values(old.preview.arranged).flat()
      .map(room => [room.Slot, room.RoomChar.map(op => op.Inst.Inst)]));
    const modifiers = createIsolatedEvaluator(snapshot, catalog, model.registry, { resetWorkHistory: true })(assignment);
    const baseline = model.project(assignment, modifiers, productionObjective(snapshot, assignment, catalog, modifiers));
    const next = arrangePreview(input, catalog, { maxNodes: 2000, practical: true }).diagnostics.objective;
    const value = score => score.primary[score.primaryKeys.indexOf('item:4001:perHour')];
    assert.ok(value(next) + 1e-9 >= value(baseline), `${layout}: ${value(next)} < ${value(baseline)}`);
  }
});

test('近似不放行漂移描述、重复人员或疲劳工作岗', () => {
  const { data, input } = fixture('control_clue_cost[000]', 'CONTROL');
  data.buffs = { ...data.buffs, 'control_clue_cost[000]': { ...data.buffs['control_clue_cost[000]'], description: '漂移' } };
  assert.throws(() => arrangePreview(input, data, { practical: true }), { code: 'UNISOLATABLE_MECHANISM' });
  data.buffs = catalog.buffs;
  input.building.roomSlots.m = { roomId: 'MANUFACTURE', level: 1, state: 2, charInstIds: [1] };
  assert.throws(() => arrangePreview(input, data, { practical: true }));
  input.building.roomSlots.m.charInstIds = [];
  input.building.chars[1].ap = 0;
  const result = arrangePreview(input, data, { practical: true });
  assert.ok(!roomIds(result).includes(1));
});
