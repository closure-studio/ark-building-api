import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAssignments } from '../../src/solver/search.mjs';

function fixture() {
  return {
    snapshot: { operators: [1, 2, 3].map(instId => ({ instId, ap: 1000 })), reservedIds: [], rooms: [
      { slot: 'm', type: 'MANUFACTURE', capacity: 1, occupants: [] },
      { slot: 't', type: 'TRADING', capacity: 1, occupants: [] },
      { slot: 'd', type: 'DORMITORY', capacity: 1, occupants: [] },
    ] },
    catalog: { tiredApThreshold: 100 },
  };
}
const score = (primary, secondary = []) => ({ primary, secondary });
const solve = (f, evaluate, options = {}) => searchAssignments(f.snapshot, f.catalog, evaluate, options);

test('全局分配不逐房贪心：跨房人员互斥，小阵容完整枚举', () => {
  const f = fixture();
  const result = solve(f, a => score([
    a.m.includes(1) ? 10 : a.m.includes(2) ? 9 : 0,
    a.t.includes(1) ? 10 : 0,
  ]));
  assert.equal(result.exhausted, true);
  assert.ok(result.frontier.some(r => r.assignment.m[0] === 2 && r.assignment.t[0] === 1));
  for (const r of result.frontier) {
    const ids = Object.values(r.assignment).flat();
    assert.equal(ids.length, new Set(ids).size);
  }
});

test('不同量纲保留Pareto前沿，不相加；主目标劣势不能靠辅助分补偿', () => {
  const f = fixture(); f.snapshot.rooms = [f.snapshot.rooms[0]];
  const values = { 1: score([10, 0], [1]), 2: score([0, 10], [0]), 3: score([0, 9], [9999]) };
  const result = solve(f, a => values[a.m[0]] ?? score([0, 0], [0]));
  assert.deepEqual(result.frontier.map(r => r.assignment.m[0]).sort(), [1, 2]);
});

test('主目标相同再比较辅助收益，完全同分稳定决胜且不改原快照', () => {
  const f = fixture(); f.snapshot.rooms = [f.snapshot.rooms[0]];
  const before = JSON.stringify(f);
  const result = solve(f, a => score([a.m.length], [a.m.includes(1) ? 0 : 1]));
  assert.equal(result.frontier.length, 1);
  assert.deepEqual(result.frontier[0].assignment.m, [2]);
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(solve(f, a => score([a.m.length], [a.m.includes(1) ? 0 : 1])).frontier, result.frontier);
});

test('冻结人员跨房保留，疲劳人员只能休息，保护设施人员不得挪用', () => {
  const f = fixture();
  f.snapshot.rooms[0].occupants = [1];
  f.snapshot.operators[1].ap = 100;
  f.snapshot.reservedIds = [3];
  const result = solve(f, a => score([a.d.length]), { frozenSlots: ['m'] });
  assert.deepEqual(result.frontier[0].assignment, { m: [1], t: [], d: [2] });
  f.snapshot.operators[0].ap = 0;
  assert.throws(() => solve(f, () => score([0]), { frozenSlots: ['m'] }), { code: 'INVALID_ASSIGNMENT' });
});

test('隔离排除人员不重新进入候选，冻结原岗位仍可保留', () => {
  const f = fixture();
  let result = solve(f, a => score([a.m.includes(1) ? 100 : a.m.length]), { excludedIds: [1] });
  assert.ok(result.frontier.every(r => !Object.values(r.assignment).flat().includes(1)));
  f.snapshot.rooms[0].occupants = [1];
  result = solve(f, a => score([a.m.length]), { excludedIds: [1], frozenSlots: ['m'] });
  assert.deepEqual(result.frontier[0].assignment.m, [1]);
  assert.throws(() => solve(f, () => score([0]), { excludedIds: [99] }), RangeError);
});

test('空阵容、缺员、没有宿舍仍返回真实空位，不伪造满编', () => {
  const f = fixture(); f.snapshot.operators = [];
  const result = solve(f, () => score([0]));
  assert.deepEqual(result.frontier[0].assignment, { m: [], t: [], d: [] });
});

test('组合伙伴不得按单人分数预剪枝，枚举结果与独立笛卡尔积oracle一致', () => {
  const f = fixture();
  f.snapshot.rooms = [{ slot: 'm', type: 'MANUFACTURE', capacity: 2, occupants: [] },
    { slot: 'p', type: 'POWER', capacity: 1, occupants: [] }];
  const value = a => (a.m.includes(1) && a.m.includes(2) ? 30 : a.m.length) + a.p.length;
  let expected = -Infinity;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const choices = [a, b, c];
    const assignment = { m: [1, 2, 3].filter((_, i) => choices[i] === 1), p: [1, 2, 3].filter((_, i) => choices[i] === 2) };
    if (assignment.m.length <= 2 && assignment.p.length <= 1) expected = Math.max(expected, value(assignment));
  }
  const result = solve(f, a => score([value(a)]));
  assert.equal(result.frontier[0].score.primary[0], expected);
  assert.deepEqual(result.frontier[0].assignment.m, [1, 2]);
});

test('节点预算耗尽保留已校验可行解，不伪称已穷尽或无解', () => {
  const f = fixture();
  const result = solve(f, a => score([a.m.length]), { maxNodes: 1 });
  assert.equal(result.exhausted, false);
  assert.equal(result.stopReason, 'NODE_BUDGET');
  assert.equal(result.nodes, 1);
  assert.ok(result.frontier.length > 0);
});

test('求值器可明确排除不支持方案，但内部错误和无效数值不得吞掉', () => {
  const f = fixture();
  assert.throws(() => solve(f, () => null), { code: 'NO_EVALUABLE_ASSIGNMENT', status: 422 });
  assert.throws(() => solve(f, () => { throw new Error('bug'); }), /bug/);
  for (const invalid of [score([NaN]), score([Infinity]), score([]), {}, score([1], [NaN])]) {
    assert.throws(() => solve(f, () => invalid), { code: 'INVALID_OBJECTIVE' });
  }
  let calls = 0;
  assert.throws(() => solve(f, () => score(++calls === 1 ? [1] : [1, 2])), { code: 'INVALID_OBJECTIVE' });
  assert.throws(() => solve(f, () => null, { maxNodes: 1 }), { status: 503 });
});

test('预算内先验证并保留初始可行方案，不等待深度搜索碰到满编', () => {
  const f = fixture();
  const seed = { m: [2], t: [1], d: [3] };
  const result = solve(f, a => score([a.m.length + a.t.length]), { maxNodes: 2, initialAssignments: [seed] });
  assert.deepEqual(result.frontier[0].assignment, seed);
  assert.equal(result.nodes, 2);
  assert.equal(result.exhausted, false);
  assert.throws(() => solve(f, () => score([0]), { initialAssignments: [{ m: [1], t: [1], d: [] }] }), { code: 'INVALID_ASSIGNMENT' });
  assert.throws(() => solve(f, () => score([0]), { excludedIds: [1], initialAssignments: [seed] }), { code: 'INVALID_ASSIGNMENT' });
});

test('大阵容预算内可用高编号空闲人员改进起点，不困在DFS早期分支', () => {
  const f = fixture();
  f.snapshot.operators = Array.from({ length: 80 }, (_, i) => ({ instId: i + 1, ap: 1000 }));
  f.snapshot.rooms = [{ slot: 'm', type: 'MANUFACTURE', capacity: 1, occupants: [] }];
  const result = solve(f, a => score([a.m[0] === 80 ? 100 : a.m.length]), {
    maxNodes: 400, initialAssignments: [{ m: [1] }],
  });
  assert.deepEqual(result.frontier[0].assignment.m, [80]);
  assert.equal(result.exhausted, false);
  assert.ok(result.nodes <= 400);
});

test('初始方案通过跨房交换改进，同时不挪用冻结和保留人员', () => {
  const f = fixture();
  f.snapshot.operators.push({ instId: 4, ap: 1000 });
  f.snapshot.reservedIds = [4];
  f.snapshot.rooms[2].occupants = [3];
  const result = solve(f, a => score([(a.m.includes(2) ? 10 : 0) + (a.t.includes(1) ? 10 : 0)]), {
    maxNodes: 12, frozenSlots: ['d'], initialAssignments: [{ m: [1], t: [2], d: [3] }],
  });
  assert.deepEqual(result.frontier[0].assignment, { m: [2], t: [1], d: [3] });
});

test('大阵容有限预算允许负贡献岗位单独离岗，不强迫以换人保持满编', () => {
  const f = fixture();
  f.snapshot.operators = Array.from({ length: 80 }, (_, i) => ({ instId: i + 1, ap: 1000 }));
  f.snapshot.rooms = f.snapshot.rooms.slice(0, 2);
  const result = solve(f, a => score([a.m.length * 10 - a.t.length * 5]), {
    maxNodes: 400, initialAssignments: [{ m: [1], t: [2] }],
  });
  assert.equal(result.frontier[0].score.primary[0], 10);
  assert.equal(result.frontier[0].assignment.m.length, 1);
  assert.deepEqual(result.frontier[0].assignment.t, []);
  assert.equal(result.exhausted, false);
  assert.ok(result.nodes <= 400);
});

for (const members of [[78, 79, 80], [80, 79, 78]]) {
  test(`同轮连续改进可组齐高编号三人班组，顺序${members.join('/')}`, () => {
    const f = fixture();
    f.snapshot.operators = Array.from({ length: 80 }, (_, i) => ({ instId: i + 1, ap: 1000 }));
    f.snapshot.rooms = [{ slot: 'm', type: 'MANUFACTURE', capacity: 3, occupants: [] }];
    const result = solve(f, a => score([members.reduce((sum, id, i) => sum + (a.m.includes(id) ? i + 1 : 0), 0)]), {
      maxNodes: 700, initialAssignments: [{ m: [1, 2, 3] }],
    });
    assert.deepEqual([...result.frontier[0].assignment.m].sort((a, b) => a - b), [78, 79, 80]);
    assert.equal(result.frontier[0].score.primary[0], 6);
    assert.equal(result.exhausted, false);
    assert.ok(result.nodes <= 700);
  });
}

test('连续改进仍保护冻结/排除/保留人员并保证疲劳人员休息', () => {
  const f = fixture();
  f.snapshot.operators = Array.from({ length: 80 }, (_, i) => ({ instId: i + 1, ap: 1000 }));
  f.snapshot.operators[79].ap = 0;
  f.snapshot.reservedIds = [77];
  f.snapshot.rooms = [
    { slot: 'm', type: 'MANUFACTURE', capacity: 3, occupants: [] },
    { slot: 'p', type: 'POWER', capacity: 1, occupants: [79] },
    { slot: 'd', type: 'DORMITORY', capacity: 1, occupants: [] },
  ];
  const result = solve(f, a => a.d.includes(80) ? score([a.m.reduce((sum, id) => sum + id, 0)]) : null, {
    maxNodes: 700, frozenSlots: ['p'], excludedIds: [78],
    initialAssignments: [{ m: [1, 2, 3], p: [79], d: [80] }],
  });
  for (const { assignment } of result.frontier) {
    assert.deepEqual([...assignment.m].sort((a, b) => a - b), [74, 75, 76]);
    assert.deepEqual(assignment.p, [79]);
    assert.deepEqual(assignment.d, [80]);
    assert.ok(!Object.values(assignment).flat().some(id => [77, 78].includes(id)));
  }
  assert.ok(result.nodes <= 700);
});

test('连续改进不能吞掉互不支配的生产方案，也不能靠辅助分抵消主生产下降', () => {
  const f = fixture();
  f.snapshot.operators = Array.from({ length: 80 }, (_, i) => ({ instId: i + 1, ap: 1000 }));
  f.snapshot.rooms = [{ slot: 'm', type: 'MANUFACTURE', capacity: 2, occupants: [] }];
  const result = solve(f, a => {
    if (a.m.includes(78) && a.m.includes(79)) return score([9, 9], [999]);
    if (a.m.includes(78)) return score([12, 10], [0]);
    if (a.m.includes(79)) return score([10, 12], [0]);
    return score([10, 10], [0]);
  }, { maxNodes: 1500, initialAssignments: [{ m: [1, 2] }] });
  assert.deepEqual(result.frontier.map(r => r.score.primary.join(',')).sort(), ['10,12', '12,10']);
});

test('非法预算和未知冻结槽位在求值之前拒绝', () => {
  const f = fixture();
  for (const maxNodes of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => solve(f, () => score([1]), { maxNodes }), RangeError);
  assert.throws(() => solve(f, () => score([1]), { frozenSlots: ['missing'] }), { code: 'INVALID_ASSIGNMENT' });
});
