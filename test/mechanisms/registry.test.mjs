import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { compileBuff } from '../../src/mechanisms/compile.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';
import { skillRegistry, registrySource } from '../../src/mechanisms/registry.mjs';
import { buildCoverageReport } from '../../src/data/report.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { createHash } from 'node:crypto';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const known = catalog.buffs['manu_prod_spd[010]'];

test('未登记ID不能借用相同文案的机制', () => {
  assert.equal(compileBuff({ ...known, buffId: 'future_unregistered' }).status, 'unsupported');
});

test('已登记ID的完整描述变参后不能静默获得新效果', () => {
  assert.equal(compileBuff({ ...known, description: known.description.replace('25%', '42%') }).status, 'unsupported');
});

test('已登记ID错房或描述追加条件拒绝，原始登记仍可用', () => {
  assert.equal(compileBuff({ ...known, roomType: 'TRADING' }).status, 'unsupported');
  assert.equal(compileBuff({ ...known, description: known.description + '，未来条件' }).status, 'unsupported');
  assert.deepEqual(compileBuff(known).effects, [{ stat: 'production', scope: 'room', value: 0.25, stacking: 'sum' }]);
});

test('未知ID不能仅凭进驻前缀取得未入驻不生效的隔离证明', () => {
  const data = { ...catalog, buffs: { unknown: { buffId: 'unknown', roomType: 'MANUFACTURE', description: '进驻制造站时，未来未知技能' } },
    chars: { source: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: 'unknown', cond: { phase: 0, level: 1 } }] }] } } };
  const snapshot = { rooms: [{ slot: 'm', type: 'MANUFACTURE', capacity: 3, level: 1, occupants: [] }], reservedIds: [],
    operators: [{ instId: 1, charId: 'source', evolvePhase: 0, level: 1, ap: 8640000 }] };
  assert.throws(() => planIsolation(snapshot, data), { code: 'UNISOLATABLE_MECHANISM' });
});

test('新ID和同ID变参必须显式登记，数据回退不污染既有登记', () => {
  const changed = { ...known, description: known.description.replace('25%', '42%') };
  const entry = { ...skillRegistry[known.buffId],
    descriptionSha256: createHash('sha256').update(changed.description).digest('hex'),
    effects: [{ stat: 'production', scope: 'room', value: 0.42, stacking: 'sum' }] };
  const updated = { ...skillRegistry, [known.buffId]: entry, future: entry };
  assert.equal(compileBuff(changed).status, 'unsupported');
  assert.equal(compileBuff(changed, {}, updated).effects[0].value, 0.42);
  assert.equal(compileBuff({ ...changed, buffId: 'future' }).status, 'unsupported');
  assert.equal(compileBuff({ ...changed, buffId: 'future' }, {}, updated).effects[0].value, 0.42);
  assert.equal(compileBuff(known, {}, updated).status, 'unsupported');
  assert.equal(compileBuff(known).effects[0].value, 0.25);
});

test('已登记隔离证明随描述或房间漂移失效，回退后恢复', () => {
  const buffId = 'meet_spd_notOwned[000]';
  const original = catalog.buffs[buffId];
  const data = { ...catalog, buffs: { [buffId]: original }, chars: {
    source: { buffChar: [{ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] }] },
  } };
  const snapshot = { rooms: [
    { slot: 'r', type: 'MEETING', capacity: 2, level: 1, occupants: [1] },
    { slot: 'c', type: 'CONTROL', capacity: 5, level: 1, occupants: [] },
  ], reservedIds: [],
    operators: [{ instId: 1, charId: 'source', evolvePhase: 0, level: 1, ap: 8640000 }] };
  assert.deepEqual(planIsolation(snapshot, data).frozenSlots, ['c', 'r']);
  for (const replacement of [{ ...original, description: original.description + '，并影响全基建' },
    { ...original, roomType: 'CONTROL' }]) {
    data.buffs[buffId] = replacement;
    assert.throws(() => planIsolation(snapshot, data), { code: 'UNISOLATABLE_MECHANISM' });
  }
  data.buffs[buffId] = original;
  assert.deepEqual(planIsolation(snapshot, data).frozenSlots, ['c', 'r']);
});

test('新角色复用已有ID，解锁与回退经实际求值器生效', () => {
  const data = { ...catalog, chars: { new_char: {
    buffChar: [{ buffData: [{ buffId: known.buffId, cond: { phase: 1, level: 20 } }] }],
  } } };
  const snapshot = { rooms: [{ slot: 'm', type: 'MANUFACTURE', level: 1, capacity: 1, occupants: [1] }],
    reservedIds: [], operators: [{ instId: 1, charId: 'new_char', evolvePhase: 0, level: 1, ap: 8640000 }] };
  for (const [phase, level, expected] of [[0, 1, 0], [1, 19, 0], [1, 20, 0.25], [0, 1, 0]]) {
    Object.assign(snapshot.operators[0], { evolvePhase: phase, level });
    assert.equal(evaluateModifiers(snapshot, { m: [1] }, data).rooms.m.production ?? 0, expected);
  }
});

test('登记的伙伴身份缺失、改名或重名拒绝，不能误用旧关联', () => {
  const [id, entry] = Object.entries(skillRegistry).find(([, entry]) => entry.partnerNames);
  const [partnerId, name] = Object.entries(entry.partnerNames)[0];
  assert.equal(compileBuff(catalog.buffs[id], catalog.characterNames).status, 'compiled');
  const missing = { ...catalog.characterNames };
  delete missing[partnerId];
  for (const names of [missing, { ...catalog.characterNames, [partnerId]: '另一个身份' },
    { ...catalog.characterNames, duplicate: name }]) {
    assert.equal(compileBuff(catalog.buffs[id], names).status, 'unsupported');
  }
});

test('覆盖报告显式暴露新ID及旧ID漂移，不把隔离登记计入支持', () => {
  const before = buildCoverageReport(catalog);
  const changed = { ...catalog, buffs: { ...catalog.buffs,
    [known.buffId]: { ...known, description: known.description + '，未知条件' },
    future: { ...known, buffId: 'future' },
  } };
  assert.equal(before.summary.total, 542);
  assert.equal(before.summary.numericallyVerified, 0);
  assert.deepEqual(buildCoverageReport(changed).summary,
    { ...before.summary, total: 543, compiled: before.summary.compiled - 1, unsupported: before.summary.unsupported + 2 });
  assert.deepEqual(buildCoverageReport(catalog), before);
  assert.deepEqual(registrySource, dataPin);
});

test('返回效果不可修改，后续请求不会读到被调用方污染的登记', () => {
  const result = compileBuff(known);
  assert.throws(() => { result.effects[0].value = 9; }, TypeError);
  assert.throws(() => result.effects.push({}), TypeError);
  assert.equal(compileBuff(known).effects[0].value, 0.25);
});
