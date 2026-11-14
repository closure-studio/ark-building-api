import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMood } from '../../src/mechanisms/mood.mjs';

function fixture() {
  const operators = Array.from({ length: 7 }, (_, i) => ({ instId: i + 1, charId: `c${i + 1}`, ap: 3600000 }));
  const snapshot = { operators, reservedIds: [], rooms: [
    { slot: 'c', type: 'CONTROL', level: 5 },
    { slot: 'm', type: 'MANUFACTURE', level: 3 },
    { slot: 'd', type: 'DORMITORY', level: 1, comfort: 5000 },
  ] };
  const assignment = { c: [1, 2], m: [3, 4, 5], d: [6, 7] };
  const catalog = { manpowerDisplayFactor: 360000, controlData: { basicCostBuff: -5 },
    manufactManpowerCostByNum: [0, 0, -5, -10],
    dormData: { phases: [{ manpowerRecover: 160, decorationLimit: 1000 }] },
    chars: Object.fromEntries(operators.map(o => [o.charId, { maxManpower: 8640000 }])) };
  const modifiers = { operators: { 3: { moodCost: -0.25 }, 6: { moodRecovery: 0.5 } }, unevaluated: { slots: [] } };
  return { snapshot, assignment, catalog, modifiers };
}
const run = f => evaluateMood(f.snapshot, f.assignment, f.catalog, f.modifiers);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('中枢减耗只算一次，制造人数减耗和自身技能分别叠加', () => {
  const result = run(fixture());
  near(result[1].changePerHour, -0.9);
  near(result[3].changePerHour, -0.55);
  near(result[4].changePerHour, -0.8);
  assert.equal(result[3].current, 10);
});
test('宿舍氛围按等级上限截断，恢复技能不被误当成消耗', () => {
  const result = run(fixture());
  near(result[6].changePerHour, 2.5);
  near(result[7].changePerHour, 2);
});
test('满心情不继续增加，未进驻人员不伪造恢复速率', () => {
  const f = fixture(); f.snapshot.operators[5].ap = 8640000; f.assignment.d = [6];
  const result = run(f);
  assert.equal(result[6].changePerHour, 0);
  assert.equal(result[7], undefined);
});
test('负消耗允许工作中恢复，而不强行截断成零', () => {
  const f = fixture(); f.modifiers.operators[1] = { moodRecovery: 1.5 };
  near(run(f)[1].changePerHour, 0.6);
});
test('冻结未知区不输出伪心情值；冻结中枢则拒绝计算依赖区', () => {
  const f = fixture(); f.modifiers.unevaluated.slots = ['d'];
  assert.equal(run(f)[6], undefined);
  f.modifiers.unevaluated.slots = ['c'];
  assert.throws(() => run(f), { code: 'UNKNOWN_MOOD_DEPENDENCY' });
});
test('独占恢复固定为每小时2点，不叠加氛围、等级和外部恢复，满心情仍截断', () => {
  const f = fixture();
  f.modifiers.operators[6] = { fixedMoodRecovery: 2, moodRecovery: 1.5 };
  near(run(f)[6].changePerHour, 2);
  f.catalog.dormData.phases[0].manpowerRecover = 400;
  f.catalog.dormData.phases[0].decorationLimit = 5000;
  near(run(f)[6].changePerHour, 2);
  near(run(f)[7].changePerHour, 6);
  f.snapshot.operators[5].ap = 8640000;
  near(run(f)[6].changePerHour, 0);
});
test('独占恢复只作用于宿舍且非法固定值不产生NaN', () => {
  const f = fixture(); f.modifiers.operators[3] = { fixedMoodRecovery: 2 };
  near(run(f)[3].changePerHour, -0.8);
  f.modifiers.operators[6] = { fixedMoodRecovery: NaN };
  assert.throws(() => run(f), { code: 'DATA_NOT_READY' });
});
test('基础消耗数据缺失或技能增量非法时不返回NaN', () => {
  const f = fixture(); delete f.catalog.manufactManpowerCostByNum;
  assert.throws(() => run(f), { code: 'DATA_NOT_READY' });
  const g = fixture(); g.modifiers.operators[3].moodCost = NaN;
  assert.throws(() => run(g), { code: 'DATA_NOT_READY' });
});
