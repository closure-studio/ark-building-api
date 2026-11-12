import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoldOrders } from '../../src/mechanisms/gold-orders.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const run = (options = {}) => projectGoldOrders({ level: 3, speed: 1, ...options });

test('普通赤金按订单概率加权总报酬/总用时，而非每种时薪的均值', () => {
  const one = run({ level: 1 });
  near(one.lmdPerHour, 416.6666666666667); near(one.goldPerHour, 0.8333333333333334);
  const two = run({ level: 2 });
  near(two.meanSeconds, 10224); near(two.lmdPerHour, 422.5352112676056);
  const three = run();
  near(three.meanSeconds, 12204); near(three.meanLmd, 1450); near(three.meanGold, 2.9);
  near(three.lmdPerHour, 427.7286135693218);
});
test('可露希尔固定2赤金1200币并使用效率，不能只是普通2金订单', () => {
  const result = run({ speed: 1.11, closure: true });
  assert.deepEqual(result.orders, [{ probability: 1, gold: 2, lmd: 1200, baseSeconds: 8640, kind: 'closure' }]);
  near(result.lmdPerHour, 555); near(result.goldPerHour, 0.925);
});
test('佩佩零赤金固定4.5小时，不受速度影响且优先于其他特殊订单', () => {
  for (const speed of [0.01, 1, 4]) {
    const result = run({ speed, pepe: true, closure: true, forceTwo: true, breach: true, breachExtra: 2, investment: 500 });
    near(result.lmdPerHour, 222.22222222222223); near(result.goldPerHour, 0); near(result.meanSeconds, 16200);
    assert.equal(result.orders[0].kind, 'pepe');
  }
});
test('尤里卡只改交付量和报酬，不能把高档原订单用时也改成2金用时', () => {
  const result = run({ forceTwo: true, speed: 1.11 });
  assert.deepEqual(result.orders.map(order => order.baseSeconds), [8640, 12600, 16560]);
  assert.deepEqual(result.orders.map(order => [order.gold, order.lmd]), [[2, 1000], [2, 1000], [2, 1000]]);
  near(result.lmdPerHour, 327.43362831858406);
});
test('违约只标记小于4赤金的订单，增量改变交付而保留原用时', () => {
  for (const [extra, gold, lmd] of [[0, 2.9, 1450], [1, 3.7, 1850], [2, 4.5, 2250]]) {
    const result = run({ breach: true, breachExtra: extra });
    near(result.meanGold, gold); near(result.meanLmd, lmd); near(result.meanSeconds, 12204);
    assert.equal(result.orders[2].kind, 'ordinary');
    assert.equal(result.orders[0].kind, 'breach');
  }
  near(run({ breachExtra: 2 }).meanGold, 2.9);
});
test('投资只给非违约且原来大于3金的订单加报酬，不能给违约加价后订单再叠', () => {
  for (const [investment, lmd] of [[250, 1500], [500, 1550]]) {
    near(run({ investment }).meanLmd, lmd);
    const combined = run({ investment, breach: true, breachExtra: 2 });
    near(combined.meanLmd, lmd + 800);
    assert.equal(combined.orders[0].lmd, 2000);
    assert.equal(combined.orders[2].kind, 'investment');
  }
});
test('固定特别订单互斥，尤里卡和可露希尔不变违约也不获得投资报酬', () => {
  const closure = run({ closure: true, forceTwo: true, breach: true, breachExtra: 2, investment: 500 });
  assert.equal(closure.meanGold, 2); assert.equal(closure.meanLmd, 1200);
  const forced = run({ forceTwo: true, breach: true, breachExtra: 2, investment: 500 });
  assert.equal(forced.meanGold, 2); assert.equal(forced.meanLmd, 1000);
});
test('切换候选不残留特别订单效果，不修改参数', () => {
  const options = { level: 3, speed: 1, closure: true };
  run(options); assert.deepEqual(options, { level: 3, speed: 1, closure: true });
  const ordinary = run();
  run({ pepe: true });
  assert.deepEqual(run(), ordinary);
});
test('错误等级、速度和未知参数拒绝，不把概率暖机当成常规分布', () => {
  for (const options of [{ level: 0 }, { level: 4 }, { level: 1.5 }, { speed: 0 }, { speed: -1 },
    { speed: Infinity }, { speed: NaN }, { speed: '1' }, { closure: 1 }, { investment: 100 },
    { breachExtra: 3 }, { probabilityWarmup: 3 }]) {
    assert.throws(() => run(options), RangeError);
  }
});
