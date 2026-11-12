import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageReport } from '../fixtures/mechanisms.mjs';

function catalog() {
  return {
    version: { commit: '1'.repeat(40), buildingSha256: '2'.repeat(64) },
    chars: { char_new: { buffChar: [{ buffData: [{ buffId: 'plain', cond: { phase: 0, level: 1 } }] }] } },
    buffs: {
      plain: { buffId: 'plain', roomType: 'MANUFACTURE', description: '进驻制造站时，生产力+25%' },
      compound: { buffId: 'compound', roomType: 'MANUFACTURE', description: '进驻制造站时，生产力+25%，未来机制' },
      training: { buffId: 'training', roomType: 'TRAINING', description: '未来机制' },
    },
  };
}

test('每条目标技能入账，完整解析与数值验收分开，不隐藏不支持条目', () => {
  const report = buildCoverageReport(catalog());
  assert.deepEqual(report.summary, { total: 2, compiled: 1, unsupported: 1, numericallyVerified: 0 });
  assert.deepEqual(report.byRoom.MANUFACTURE, { total: 2, compiled: 1, unsupported: 1, numericallyVerified: 0 });
  const plain = report.rows.find(row => row.buffId === 'plain');
  assert.equal(plain.status, 'compiled');
  assert.equal(plain.numericStatus, 'pending');
  assert.equal(plain.effects[0].value, 0.25);
  assert.deepEqual(plain.unverifiedRequirements, ['EXACT_BUFF_GOLDEN_CASE', 'DOMAIN_FORMULA_EVIDENCE']);
  assert.equal(plain.unlocks[0].charId, 'char_new');
  assert.match(plain.source, /building_data.json@1{40}#buffs\/plain$/);
  const compound = report.rows.find(row => row.buffId === 'compound');
  assert.equal(compound.status, 'unsupported');
  assert.equal(compound.reason, 'UNRECOGNIZED_MECHANISM');
  assert.equal(compound.effects, undefined);
});

test('已登记新参数和新角色进入账本，不借用旧版本验收结论', () => {
  const data = catalog();
  const previous = buildCoverageReport(data);
  data.version.commit = '3'.repeat(40);
  data.buffs.fresh = { buffId: 'fresh', roomType: 'TRADING', description: '进驻贸易站时，订单获取效率+42%' };
  data.chars.another = { buffChar: [{ buffData: [{ buffId: 'fresh', cond: { phase: 1, level: 20 } }] }] };
  const updated = buildCoverageReport(data);
  assert.equal(updated.summary.total, 3);
  assert.equal(updated.summary.compiled, 2);
  assert.equal(updated.summary.numericallyVerified, 0);
  assert.equal(updated.rows.find(row => row.buffId === 'fresh').effects[0].value, 0.42);
  assert.equal(previous.version.commit, '1'.repeat(40));
  assert.equal(previous.rows.length, 2);
});

test('覆盖账本使用与求值器相同的锁定角色关系，不把已解析组合漏记', () => {
  const data = catalog();
  data.characterNames = { partner: '队友' };
  data.buffs.pair = { buffId: 'pair', roomType: 'TRADING', description: '当与队友在同一个贸易站时，订单获取效率+65%' };
  const row = buildCoverageReport(data).rows.find(row => row.buffId === 'pair');
  assert.equal(row.status, 'compiled');
  assert.equal(row.effects[0].partnerCharId, 'partner');
  assert.equal(row.numericStatus, 'pending');
});

test('完整解析后的效果族可追溯且排序稳定，生成报告不修改原数据', () => {
  const data = catalog();
  const before = JSON.stringify(data);
  const first = buildCoverageReport(data);
  const second = buildCoverageReport(data);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(first.rows.find(row => row.buffId === 'plain').families, ['production/room/sum/constant/any']);
  assert.deepEqual(first.version, data.version);
});
