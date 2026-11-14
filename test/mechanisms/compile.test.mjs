import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { compileBuff, registeredSkill } from '../../src/mechanisms/compile.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const compile = id => compileBuff(catalog.buffs[id], catalog.characterNames);

test('编译器从显式登记读取参数，不从文案或efficiency提取效果', () => {
  const known = catalog.buffs['manu_prod_spd[010]'];
  assert.deepEqual(compileBuff({ ...known, efficiency: 999 }).effects,
    [{ stat: 'production', scope: 'room', value: 0.25, stacking: 'sum' }]);
  const buff = { buffId: 'synthetic', roomType: 'MANUFACTURE', description: '已审核的合成输入，无可解析参数' };
  const effects = [{ stat: 'production', scope: 'room', value: 0.37, stacking: 'sum' }];
  const entry = { roomType: buff.roomType,
    descriptionSha256: createHash('sha256').update(buff.description).digest('hex'), effects };
  assert.deepEqual(compileBuff(buff, {}, { synthetic: entry }), { status: 'compiled', effects });
});

test('复合登记完整保留效率、容量和自身消耗的符号与作用域', () => {
  assert.deepEqual(compile('manu_prod_spd&limit&cost[000]').effects, [
    { stat: 'production', scope: 'room', value: -0.05, stacking: 'sum' },
    { stat: 'capacity', scope: 'room', value: 16, stacking: 'sum' },
    { stat: 'moodCost', scope: 'self', value: -0.15, stacking: 'sum' },
  ]);
});

test('生产、贸易、无人机、线索、招聘与宿舍效果保留量纲及叠加规则', () => {
  for (const [id, stat, scope, value, stacking] of [
    ['manu_prod_spd[010]', 'production', 'room', 0.25, 'sum'],
    ['trade_ord_spd[010]', 'orderSpeed', 'room', 0.2, 'sum'],
    ['power_rec_spd[000]', 'droneSpeed', 'room', 0.1, 'sum'],
    ['meet_spd[010]', 'clueSpeed', 'room', 0.15, 'sum'],
    ['hire_spd[010]', 'contactSpeed', 'room', 0.3, 'sum'],
    ['dorm_rec_oneself[000]', 'moodRecovery', 'self', 0.7, 'sum'],
    ['dorm_rec_all[000]', 'moodRecovery', 'occupants', 0.1, 'max'],
  ]) assert.deepEqual(compile(id).effects, [{ stat, scope, value, stacking }], id);
});

test('编译结果保留宿舍总等级与当前房间等级两种依赖', () => {
  assert.deepEqual(compile('trade_ord_spd&dorm&lv[000]').effects,
    [{ stat: 'orderSpeed', scope: 'room', value: 0.01, stacking: 'sum', basis: 'dormitoryLevels' }]);
  assert.deepEqual(compile('trade_ord_limit&trade&lv[000]').effects,
    [{ stat: 'capacity', scope: 'room', value: 1, stacking: 'sum', basis: 'roomLevel' }]);
});

test('仅登记隔离边界不能编译出效果；畸形输入保持不支持', () => {
  const boundary = catalog.buffs['meet_spd_notOwned[000]'];
  assert.ok(registeredSkill(boundary));
  assert.deepEqual(compileBuff(boundary), { status: 'unsupported', reason: 'UNRECOGNIZED_MECHANISM' });
  for (const buff of [undefined, null, {}, { buffId: 1 }, { buffId: boundary.buffId },
    { ...boundary, description: null }]) {
    assert.equal(registeredSkill(buff), undefined);
    assert.deepEqual(compileBuff(buff), { status: 'unsupported', reason: 'UNRECOGNIZED_MECHANISM' });
  }
});
