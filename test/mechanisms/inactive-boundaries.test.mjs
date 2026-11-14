import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';
import { createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const cases = [
  ['char_264_f12yin', 'meet_flag[010]', 'MEETING'],
  ['char_4013_kjera', 'meet_flag[040]', 'MEETING'],
  ['char_401_elysm', 'meet_flag[060]', 'MEETING'],
  ['char_405_absin', 'meet_flag[050]', 'MEETING'],
  ['char_492_quercu', 'meet_flag[070]', 'MEETING'],
];
function fixture(charId, type) {
  return { reservedIds: [], operators: [{ instId: 1, charId, evolvePhase: 2, level: 1, ap: 8640000 }],
    rooms: [{ slot: 'work', type, level: 1, capacity: 1, occupants: [], formulaId: '1' },
      { slot: 'dorm', type: 'DORMITORY', level: 1, capacity: 5, occupants: [] }] };
}
for (const [charId, buffId, type] of cases) {
  test(`${buffId} 未入驻不能阻塞其他人，但也不能作为已支持候选入驻`, () => {
    const snapshot = fixture(charId, type);
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const result = evaluate({ work: [], dorm: [] });
    assert.equal(result.diagnostics.mode, 'partial');
    assert.deepEqual(result.diagnostics.excludedIds, [1]);
    assert.ok(result.diagnostics.unresolved.some(item => item.buffId === buffId));
    assert.throws(() => evaluate({ work: [1], dorm: [] }), { code: 'EXCLUDED_OPERATOR_ASSIGNED' });
  });
  test(`${buffId} 已在目标岗位且缺历史状态仍拒绝，不能凭离岗证明冻结`, () => {
    const snapshot = fixture(charId, type);
    snapshot.rooms[0].occupants = [1];
    assert.throws(() => planIsolation(snapshot, catalog), { code: 'UNISOLATABLE_MECHANISM' });
  });
  test(`${buffId} 原在宿舍保留原位，低心情不被当作工作候选`, () => {
    const snapshot = fixture(charId, type);
    snapshot.rooms[1].occupants = [1];
    snapshot.operators[0].ap = 0;
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const result = evaluate({ work: [], dorm: [1] });
    assert.deepEqual(result.diagnostics.frozenSlots, ['dorm']);
    assert.deepEqual(result.unevaluated.operatorIds, [1]);
    assert.equal(result.rooms.dorm, undefined);
    assert.throws(() => evaluate({ work: [], dorm: [] }));
  });
  test(`${buffId} 描述漂移不能继续使用离岗边界`, () => {
    const buffs = { ...catalog.buffs, [buffId]: { ...catalog.buffs[buffId], description: catalog.buffs[buffId].description + '，离岗后仍生效' } };
    assert.throws(() => planIsolation(fixture(charId, type), { ...catalog, buffs }), { code: 'UNISOLATABLE_MECHANISM' });
  });
}

for (const [charId, buffId] of [
  ['char_123_fang', 'manu_prod_spd_addition[030]'],
  ['char_2013_cerber', 'manu_prod_spd_addition[031]'],
  ['char_124_kroos', 'manu_prod_spd_addition[040]'],
  ['char_336_folivo', 'manu_prod_spd_addition[041]'],
]) {
  test(`${buffId} 历史时长未知时完整保留原岗，不伪造生产指标且禁止换人`, () => {
    const snapshot = fixture(charId, 'MANUFACTURE');
    snapshot.rooms[0].occupants = [1];
    const evaluate = createIsolatedEvaluator(snapshot, catalog);
    const result = evaluate({ work: [1], dorm: [] });
    assert.deepEqual(result.diagnostics.frozenSlots, ['work']);
    assert.ok(result.diagnostics.unresolved.some(item => item.buffId === buffId));
    assert.equal(result.rooms.work, undefined);
    assert.deepEqual(result.unevaluated.operatorIds, [1]);
    assert.throws(() => evaluate({ work: [], dorm: [1] }), { code: 'INVALID_ASSIGNMENT' });
    const changed = { ...catalog, buffs: { ...catalog.buffs,
      [buffId]: { ...catalog.buffs[buffId], description: catalog.buffs[buffId].description + '，离岗后仍生效' } } };
    assert.throws(() => planIsolation(snapshot, changed), { code: 'UNISOLATABLE_MECHANISM' });
    snapshot.rooms[0].occupants = [];
    const inactive = createIsolatedEvaluator(snapshot, catalog);
    assert.deepEqual(inactive({ work: [], dorm: [] }).diagnostics.excludedIds, []);
    assert.ok(inactive({ work: [1], dorm: [] }).sources.some(source => source.buffId === buffId));
  });
}
