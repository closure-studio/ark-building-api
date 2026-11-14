import test from 'node:test';
import assert from 'node:assert/strict';
import { productionObjective } from '../../src/solver/objective.mjs';

function fixture() {
  return {
    snapshot: { rooms: [
      { slot: 'm', type: 'MANUFACTURE', level: 1, formulaId: 'gold' },
      { slot: 't', type: 'TRADING', level: 1, strategy: 'O_GOLD' },
      { slot: 'p', type: 'POWER', level: 1 },
    ] },
    assignment: { m: [1, 2], t: [3], p: [4] },
    catalog: {
      manufactData: { basicSpeedBuff: 0.01, phases: [{ speed: 1 }] },
      manufactFormulas: { gold: { itemId: '3003', count: 1, costPoint: 4320 } },
      tradingData: { basicSpeedBuff: 0.01, phases: [{ orderSpeed: 1 }] },
      powerData: { basicSpeedBuff: 0.05 },
    },
    modifiers: { rooms: { m: { production: 0.4 }, t: { orderSpeed: 0.3 }, p: { droneSpeed: 0.2 } }, unevaluated: { slots: [] } },
  };
}
const run = f => productionObjective(f.snapshot, f.assignment, f.catalog, f.modifiers);

test('制造按同物资件/小时计算，贸易保持分房间速率，不冒充龙门币换算', () => {
  const result = run(fixture());
  assert.deepEqual(result.primaryKeys, ['item:3003:perHour', 'trading:t:speed']);
  assert.ok(Math.abs(result.primary[0] - 1.1833333333333333) < 1e-12);
  assert.equal(result.primary[1], 1.31);
  assert.equal(result.secondary[0], 1.25);
  assert.ok(result.limitations.includes('CROSS_RESOURCE_VALUE_UNDEFINED'));
});
test('同物资跨配方聚合但不同物资不相加，向量不随空房改变维数', () => {
  const f = fixture();
  f.snapshot.rooms.push({ slot: 'm2', type: 'MANUFACTURE', level: 1, formulaId: 'gold' });
  f.assignment.m2 = [5]; f.modifiers.rooms.m2 = {};
  const full = run(f);
  assert.ok(Math.abs(full.primary[0] - (1.42 + 1.01) * 3600 / 4320) < 1e-12);
  f.assignment.m2 = []; f.assignment.m = []; f.assignment.t = [];
  assert.deepEqual(run(f).primary, [0, 0]);
  assert.deepEqual(run(f).primaryKeys, full.primaryKeys);
});
test('冻结区域不入分数，不能输出一个零分冒充已计算', () => {
  const f = fixture(); f.modifiers.unevaluated.slots = ['m']; delete f.modifiers.rooms.m;
  assert.deepEqual(run(f).primaryKeys, ['trading:t:speed']);
  assert.deepEqual(run(f).primary, [1.31]);
});
test('没有主生产设施时使用恒等主目标而非把辅助收益伪装为生产', () => {
  const f = fixture(); f.snapshot.rooms = [f.snapshot.rooms[2]];
  assert.deepEqual(run(f).primary, [0]);
  assert.deepEqual(run(f).primaryKeys, ['no-production']);
});
test('错误配方时间和负生产速率不能静默变成零', () => {
  const f = fixture(); f.catalog.manufactFormulas.gold.costPoint = 0;
  assert.throws(() => run(f), { code: 'DATA_NOT_READY' });
  const g = fixture(); g.modifiers.rooms.m.production = -3;
  assert.throws(() => run(g), { code: 'INVALID_PRODUCTION_RATE' });
});
