import test from 'node:test';
import assert from 'node:assert/strict';
import { planIsolation } from '../fixtures/mechanisms.mjs';

function fixture() {
  return {
    snapshot: { reservedIds: [], operators: [1, 2, 3].map(instId => ({
      instId, charId: `char_${instId}`, evolvePhase: 0, level: 1, ap: 1000,
    })), rooms: [
      { slot: 'r', type: 'MEETING', capacity: 2, occupants: [1], level: 3 },
      { slot: 'c', type: 'CONTROL', capacity: 5, occupants: [2], level: 5 },
      { slot: 'm', type: 'MANUFACTURE', capacity: 3, occupants: [3], level: 3 },
    ] },
    catalog: { tiredApThreshold: 100, chars: Object.fromEntries([1, 2, 3].map(id => [
      `char_${id}`, { buffChar: [] },
    ])), buffs: {} },
  };
}
function skill(f, id, type, description, phase = 0) {
  const buffId = `b${Object.keys(f.catalog.buffs).length}`;
  f.catalog.buffs[buffId] = { buffId, roomType: type, description };
  f.catalog.chars[`char_${id}`].buffChar.push({ buffData: [{ buffId, cond: { phase, level: 1 } }] });
}
const run = f => planIsolation(f.snapshot, f.catalog);
const clue = '进驻会客室时，更容易获得线索板上尚未拥有的线索';

test('全基建伙伴与阵营输入连接所有候选房间的双向冻结闭包', () => {
  for (const [type, description] of [
    ['MANUFACTURE', '进驻制造站时，生产力+20%，基建内（不包含副手）每有1名S.E.E.S.干员（最多4名），生产力额外+5%'],
    ['TRADING', '进驻贸易站时，订单获取效率+25%；当伙伴在基建内时（不包含副手及活动室使用者），订单获取效率额外+5%'],
    ['TRADING', '进驻贸易站时，订单获取效率+25%；当伙伴入驻工作场所时（不包含副手），订单获取效率额外+5%'],
    ['TRADING', '进驻贸易站时，订单获取效率+25%，基建内（不包含副手及活动室）每有一间进驻精英干员的设施，订单获取效率额外+2%（最多10间）'],
    ['HIRE', '进驻人力办公室时，人脉资源的联络速度+30%，基建内（不包含副手及活动室）每有一间进驻精英干员的设施，联络速度额外+4%（最多5间）'],
    ['POWER', '进驻发电站时，无人机充能速度+10%，基建内（不包含副手及活动室使用者）每有1名除自身以外的莱茵生命干员（最多5名），充能速度额外+3%'],
    ['DORMITORY', '进驻宿舍时，基建内（不包含副手及活动室使用者）每名行医干员为该宿舍内所有干员心情每小时恢复速度+0.06（最多生效4名，且同种效果取最高）'],
  ]) {
    const f = fixture();
    skill(f, 1, 'MEETING', clue);
    f.snapshot.rooms[2].type = type;
    f.catalog.characterNames = { char_2: '伙伴' };
    skill(f, 3, type, description);
    assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
  }
});

test('虚拟发电站数量将中枢及伙伴房间连到受保护的数量消费者', () => {
  const f = fixture();
  skill(f, 1, 'MEETING', clue);
  skill(f, 1, 'MANUFACTURE', '进驻制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+5%的生产力');
  skill(f, 2, 'CONTROL', '进驻控制中枢时，如果测试伙伴进驻在发电站，发电站额外+2（仅影响设施数量）');
  f.catalog.characterNames = { char_3: '测试伙伴' };
  f.snapshot.rooms.push({ slot: 'p', type: 'POWER', capacity: 1, occupants: [], level: 1 });
  // 未知会客效果持有人原在制造站，因此先保留原岗位；数量修正仍须双向闭包。
  skill(f, 3, 'MEETING', '进驻会客室时，未定义的房内效果');
  assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'p', 'r']);
});

test('骑士中枢与全部制造站双向冻结，不因候选换岗改变受保护加成', () => {
  for (const holder of [2, 3]) {
    const f = fixture();
    f.snapshot.rooms.push({ slot: 'm2', type: 'MANUFACTURE', capacity: 3, occupants: [], level: 3 });
    skill(f, holder, 'MEETING', '进驻会客室时，未定义的房内效果');
    skill(f, 2, 'CONTROL', '进驻控制中枢时，每个进驻在制造站的骑士干员生产力+7%');
    assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'm2']);
  }
});

test('怪物猎人中枢条件与制造贸易目标双向冻结，已支持持有人不被排除', () => {
  for (const [type, effect] of [['MANUFACTURE', '所有制造站生产力+2%'], ['TRADING', '所有贸易站订单效率+7%']]) {
    for (const holder of [2, 3]) {
      const f = fixture();
      f.snapshot.rooms[2].type = type;
      skill(f, holder, 'MEETING', '进驻会客室时，未定义的房内效果');
      skill(f, 2, 'CONTROL', `当与怪物猎人小队干员进驻控制中枢一起工作时，${effect}（同种效果取最高）`);
      const plan = run(f);
      assert.deepEqual(plan.frozenSlots, ['c', 'm']);
      if (holder !== 2) assert.ok(!plan.excludedIds.includes(2));
    }
  }
});

test('热情值连接宿舍人数来源、中枢与生产目标，双向冻结不漏触发房间', () => {
  for (const holder of [1, 2, 3]) {
    const f = fixture();
    f.snapshot.rooms[0].type = 'DORMITORY';
    f.snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', capacity: 2, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', '进驻会客室时，未定义的房内效果');
    skill(f, 2, 'CONTROL', '进驻控制中枢时，宿舍内每有1名干员，热情值+1');
    skill(f, 2, 'CONTROL', '进驻控制中枢时，所有生产贵金属类配方的制造站生产力+1%，每有20点热情值，所有生产贵金属类配方的制造站生产力+1%');
    assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
  }
});

test('中枢阵营来源经双资源消费者连接容量与线索的双向冻结闭包', () => {
  for (const holder of [1, 2, 3]) {
    const f = fixture();
    f.snapshot.rooms.push({ slot: 'h', type: 'HIRE', capacity: 1, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', clue);
    skill(f, 2, 'CONTROL', '进驻控制中枢时，控制中枢内每有1名彩虹小队干员，则情报储备+1');
    skill(f, 2, 'CONTROL', '进驻控制中枢时，控制中枢内每有1名乌萨斯学生自治团干员，则乌萨斯特饮+1');
    skill(f, 3, 'MANUFACTURE', '进驻制造站时，生产力+20%，每有1瓶乌萨斯特饮，则仓库容量上限+2');
    skill(f, 1, 'MEETING', '进驻会客室时，线索搜集速度提升5%，同时每1点情报储备额外提升5%');
    skill(f, 1, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+20%，每1点情报储备额外+5%联络速度，每1瓶乌萨斯特饮额外+5%联络速度');
    assert.deepEqual(run(f).frozenSlots, ['c', 'h', 'm', 'r']);
  }
});

test('木天蓼固定及小队来源相加无依赖遗漏', () => {
  for (const holder of [1, 2, 3]) {
    const f = fixture();
    f.snapshot.rooms[0].type = 'TRADING';
    f.snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', capacity: 2, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', clue);
    skill(f, 2, 'CONTROL', '进驻控制中枢时，自身心情每小时消耗+0.5，木天蓼+8');
    skill(f, 2, 'CONTROL', '进驻控制中枢时，控制中枢内每有1名怪物猎人小队干员，则木天蓼+2');
    skill(f, 3, 'MANUFACTURE', '进驻制造站时，仓库容量上限+8，生产力+5%，同时每有1个木天蓼，则生产力+1%');
    skill(f, 1, 'TRADING', '进驻贸易站时，订单获取效率+5%，且订单上限+2，同时每有1个木天蓼，则订单获取效率+3%');
    assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
  }
});

test('工程机器人来源与异站消费者双向冻结，不冻结只贡献固定等级的房间', () => {
  for (const holder of [2, 3]) {
    const f = fixture();
    f.snapshot.rooms[1].type = 'MANUFACTURE';
    skill(f, holder, 'MEETING', clue);
    skill(f, 2, 'MANUFACTURE', '进驻制造站时，基建内除活动室外每间设施每级+1个工程机器人，上限64个');
    skill(f, 3, 'MANUFACTURE', '进驻制造站时，每8个工程机器人+5%生产力');
    assert.deepEqual(run(f).frozenSlots, ['c', 'm']);
  }
});

test('办公室共鸣将来源与消费者双向冻结', () => {
  for (const holder of [1, 2]) {
    const f = fixture();
    f.snapshot.rooms[0].type = 'TRADING';
    f.snapshot.rooms[1].type = 'HIRE';
    f.snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', capacity: 2, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', clue);
    skill(f, 2, 'HIRE', '进驻人力办公室时，每个招募位（不包含初始招募位）+15点无声共鸣');
    skill(f, 1, 'TRADING', '进驻贸易站时，每2点无声共鸣+1%订单效率');
    assert.deepEqual(run(f).frozenSlots, ['c', 'r']);
  }
});

test('共鸣点数将来源、贸易消费者和恢复消费者双向冻结', () => {
  for (const holder of [1, 2, 3]) {
    const f = fixture();
    f.snapshot.rooms[0].type = 'TRADING';
    f.snapshot.rooms[1].type = 'DORMITORY';
    f.snapshot.rooms[2].type = 'DORMITORY';
    f.snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', capacity: 2, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', clue);
    skill(f, 2, 'DORMITORY', '进驻宿舍时，该宿舍内每有1名干员，无声共鸣+1');
    skill(f, 1, 'TRADING', '进驻贸易站时，每2点无声共鸣+1%订单效率');
    skill(f, 3, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.2，每有5点无声共鸣，该宿舍内所有干员的心情每小时恢复额外+0.01（同种效果取最高）');
    assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
  }
});

test('料理点数生产与消费房间形成双向冻结闭包', () => {
  for (const holder of [1, 2]) {
    const f = fixture();
    f.snapshot.rooms[0].type = 'MANUFACTURE';
    f.snapshot.rooms[1].type = 'DORMITORY';
    f.snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', capacity: 2, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', clue);
    skill(f, 2, 'DORMITORY', '进驻宿舍时，当前宿舍每级提供1层魔物料理');
    skill(f, 1, 'MANUFACTURE', '进驻制造站时，每1点魔物料理+1%生产力');
    skill(f, 3, 'MANUFACTURE', '进驻制造站时，每1点魔物料理+1%生产力');
    assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
  }
});

test('小队贸易人数联动将全部贸易站纳入双向冻结闭包', () => {
  for (const holder of [1, 3]) {
    const f = fixture();
    f.snapshot.rooms[0].type = 'TRADING';
    f.snapshot.rooms[2].type = 'TRADING';
    f.snapshot.rooms.push({ slot: 'meeting', type: 'MEETING', capacity: 2, occupants: [], level: 1 });
    skill(f, holder, 'MEETING', clue);
    skill(f, 1, 'TRADING', '进驻贸易站时，订单上限+3，且每有一个泡影国狩猎小队干员进驻贸易站，订单获取效率+20%');
    assert.deepEqual(run(f).frozenSlots, ['m', 'r']);
  }
});

test('作业平台触发房与虚拟数量消费者进入双向冻结闭包', () => {
  for (const description of [
    '进驻制造站时，每有1台作业平台进驻发电站，贵金属类配方的生产力+10%',
    '进驻制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+5%的生产力',
  ]) {
    const f = fixture();
    skill(f, 1, 'MEETING', clue);
    skill(f, 3, 'MEETING', '进驻会客室时，未定义的房内效果');
    skill(f, 3, 'MANUFACTURE', description);
    skill(f, 2, 'POWER', '进驻发电站时，如果其他发电站内没有进驻作业平台，则发电站额外+1(仅影响设施数量)');
    f.snapshot.rooms[1].type = 'POWER';
    f.snapshot.rooms.push({ slot: 'p', type: 'POWER', capacity: 1, occupants: [], level: 1 });
    const plan = run(f);
    assert.deepEqual(plan.frozenSlots, ['c', 'm', 'p', 'r']);
    assert.ok(!plan.excludedIds.includes(2));
  }
});

test('同房组合通过锁定角色名解析后正常参与候选，不触发未知隔离', () => {
  const f = fixture();
  f.catalog.characterNames = { char_1: '队友', char_2: '搭档', char_3: '其他' };
  skill(f, 2, 'CONTROL', '当与队友进驻控制中枢一起工作时，控制中枢内所有干员心情每小时恢复+0.25');
  assert.equal(run(f).mode, 'full');
  assert.deepEqual(run(f).excludedIds, []);
  delete f.catalog.characterNames;
  assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM' });
});

test('局部线索概率未量化时冻结原会客室，不伪称完整优化', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  const before = JSON.stringify(f);
  const result = run(f);
  assert.deepEqual(result.frozenSlots, ['r']);
  assert.equal(result.mode, 'partial');
  assert.deepEqual(result.unresolved, [{ instId: 1, slot: 'r', buffId: 'b0', reason: 'UNQUANTIFIED_LOCAL_EFFECT' }]);
  assert.equal(JSON.stringify(f), before);
});

test('会客室固定等级不是人员依赖，冻结线索效果不误冻结贸易站', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  skill(f, 3, 'TRADING', '进驻贸易站时，订单获取效率+25%，会客室每级额外提供5%获取效率，最多提供40%效率');
  f.snapshot.rooms[2].type = 'TRADING';
  f.snapshot.facilities = f.snapshot.rooms.map(room => ({ slot: room.slot, type: room.type, level: room.level, state: 2 }));
  const result = run(f);
  assert.deepEqual(result.frozenSlots, ['r']);
  assert.deepEqual(result.excludedIds, []);
});

test('招募位跨房线索保护办公室人员，但固定等级宿舍恢复不误建人员依赖', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  f.snapshot.rooms[1].type = 'HIRE'; f.snapshot.rooms[1].capacity = 1;
  f.snapshot.rooms[2].type = 'DORMITORY';
  skill(f, 2, 'HIRE', '进驻人力办公室时，人脉资源的联络速度+35%，同时每个招募位（不包含初始招募位）额外+5%会客室线索搜集速度');
  skill(f, 3, 'DORMITORY', '进驻宿舍时，该宿舍内所有干员心情每小时恢复+0.1，同时每个招募位（不包含初始招募位）额外+0.1恢复效果（叠加后的最终值同种效果取最高）');
  assert.deepEqual(run(f).frozenSlots, ['c', 'r']);
  assert.deepEqual(run(f).excludedIds, []);
  // 当前空闲的办公室候选同样不能通过换人改变冻结会客室。
  f.snapshot.rooms[1].occupants = [];
  assert.deepEqual(run(f).frozenSlots, ['c', 'r']);
});

test('冻结沿流入及流出依赖闭包传播，不改变受保护区条件', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  skill(f, 2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  skill(f, 2, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）');
  assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
});

test('无技能中枢人员也通过基础减耗影响工作区，必须进入双向冻结闭包', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  f.catalog.controlData = { basicCostBuff: -5 };
  f.snapshot.rooms.push({ slot: 'd', type: 'DORMITORY', capacity: 5, occupants: [], level: 1 });
  assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r']);
});

for (const target of ['所有干员', '精英干员']) test(`中枢宿舍${target}恢复将宿舍人员纳入双向冻结闭包`, () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  skill(f, 2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  skill(f, 2, 'CONTROL', `进驻控制中枢时，所有宿舍内${target}的心情每小时恢复+0.05（同种效果取最高）`);
  f.snapshot.rooms.push({ slot: 'd', type: 'DORMITORY', capacity: 5, occupants: [], level: 1 });
  assert.deepEqual(run(f).frozenSlots, ['c', 'd', 'r']);
});

test('发电站的跨房角色条件纳入双向闭包，冻结中枢时不能另行优化依赖它的发电站', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  skill(f, 2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  skill(f, 3, 'POWER', '进驻发电站时，如果中枢队友进驻在控制中枢，则无人机充能速度+5%');
  f.catalog.characterNames = { char_1: '甲', char_2: '中枢队友', char_3: '乙' };
  f.snapshot.rooms.push({ slot: 'p', type: 'POWER', capacity: 1, occupants: [], level: 3 });
  assert.deepEqual(run(f).frozenSlots, ['c', 'p', 'r']);
  assert.deepEqual(run(f).excludedIds, []);
});

test('制造站冻结必须保护以其人员为条件的发电站，不把已支持角色排除', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  skill(f, 2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  skill(f, 2, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）');
  skill(f, 2, 'POWER', '进驻发电站时，无人机充能速度+15%，如果制造伙伴进驻在制造站，则无人机充能速度额外+5%');
  f.catalog.characterNames = { char_1: '甲', char_2: '乙', char_3: '制造伙伴' };
  f.snapshot.rooms.push({ slot: 'p', type: 'POWER', capacity: 1, occupants: [], level: 3 });
  assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'p', 'r']);
  assert.deepEqual(run(f).excludedIds, []);
});

test('制造对贸易伙伴的依赖双向冻结，不能换走受保护产能的触发人员', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  skill(f, 2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  skill(f, 2, 'CONTROL', '进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）');
  skill(f, 3, 'MANUFACTURE', '进驻制造站时，若贸易伙伴在贸易站，则作战记录类配方的生产力+35%');
  f.catalog.characterNames = { char_1: '贸易伙伴', char_2: '甲', char_3: '乙' };
  f.snapshot.rooms.push({ slot: 't', type: 'TRADING', capacity: 3, occupants: [], level: 3 });
  assert.deepEqual(run(f).frozenSlots, ['c', 'm', 'r', 't']);
  assert.deepEqual(run(f).excludedIds, []);
});

test('当前未激活但候选可触发的全局依赖也纳入隔离闭包', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  f.snapshot.rooms[1].occupants = [];
  skill(f, 2, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  assert.deepEqual(run(f).frozenSlots, ['c', 'r']);
});

test('新全局或混合效果不得按roomType或已识别前半句冻结', () => {
  for (const description of [clue + '，并改变所有制造站生产力', '未来未知机制',
    '进驻会客室时，更容易获得线索板上尚未拥有的线索，若焰狐龙梓兰进驻控制中枢，则线索搜集速度提升10%']) {
    const f = fixture(); skill(f, 1, 'MEETING', description);
    assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM', status: 422 });
  }
});

test('冻结安排仍校验心情与跨房互斥，不用降级掩盖无效原占位', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  f.snapshot.operators[0].ap = 100;
  assert.throws(() => run(f), { code: 'INVALID_FROZEN_ASSIGNMENT', status: 422 });
  f.snapshot.operators[0].ap = 1000;
  f.snapshot.rooms[1].occupants = [1];
  skill(f, 1, 'CONTROL', '进驻控制中枢时，会客室线索搜集速度+25%（同种效果取最高）');
  assert.throws(() => run(f), { code: 'INVALID_FROZEN_ASSIGNMENT', status: 422 });
});

test('未知空闲持有人不误入搜索候选，也不使其他人的排班整体失败', () => {
  const f = fixture(); f.snapshot.rooms[0].occupants = [];
  skill(f, 1, 'MEETING', '进驻会客室时，未来未知全局机制');
  assert.deepEqual(run(f).excludedIds, [1]);
  assert.deepEqual(run(f).frozenSlots, []);
  assert.equal(run(f).mode, 'partial');
});

test('已识别的驻留增长条件仅能排除未进驻候选，不能把缺时长的在岗技能算作支持', () => {
  for (const description of [
    '进驻制造站后，生产力首小时+20%，此后每小时+1%，最终达到+25%',
    '进驻制造站后，生产力首小时+15%，此后每小时+2%，最终达到+25%',
  ]) {
    const f = fixture(); f.snapshot.rooms[2].occupants = [];
    skill(f, 3, 'MANUFACTURE', description);
    assert.deepEqual(run(f).excludedIds, [3]);
    assert.equal(run(f).mode, 'partial');
    f.snapshot.rooms[2].occupants = [3];
    assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM' });
  }
});

test('未进驻的订单收益技能只排除候选，在岗缺订单状态仍拒绝', () => {
  const text = '进驻贸易站后，如果下笔赤金订单交付数大于3（违约订单不视作赤金订单），则其龙门币收益+250，心情每小时消耗-0.25';
  const f = fixture();
  f.snapshot.rooms.push({ slot: 't', type: 'TRADING', capacity: 3, occupants: [], level: 3 });
  f.snapshot.rooms[2].occupants = [];
  skill(f, 3, 'TRADING', text);
  assert.deepEqual(run(f).excludedIds, [3]);
  assert.equal(run(f).mode, 'partial');
  f.snapshot.rooms[3].occupants = [3];
  assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM' });
  f.snapshot.rooms[3].occupants = [];
  f.catalog.buffs.b0.description += '，离开后仍然生效';
  assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM' });
  f.catalog.buffs.b0.description = text;
  f.catalog.buffs.b0.roomType = 'MANUFACTURE';
  assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM' });
});

test('驻留条件带未知尾句、其他房间或任意进驻后语义不能借用候选排除证明', () => {
  for (const [type, description] of [
    ['MANUFACTURE', '进驻制造站后，生产力首小时+20%，此后每小时+1%，最终达到+25%，离开后全局生效'],
    ['MEETING', '进驻制造站后，生产力首小时+20%，此后每小时+1%，最终达到+25%'],
    ['MANUFACTURE', '进驻制造站后，离开后仍持续改变全局产能'],
  ]) {
    const f = fixture(); f.snapshot.rooms[2].occupants = [];
    skill(f, 3, type, description);
    assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM' });
  }
});

test('空闲未知效果没有明确进驻触发条件时不得假设无效', () => {
  const f = fixture(); f.snapshot.rooms[0].occupants = [];
  skill(f, 1, 'MEETING', '无论进驻何处都改变所有制造站生产力');
  assert.throws(() => run(f), { code: 'UNISOLATABLE_MECHANISM', status: 422 });
});

test('未解锁技能和未持有条目不阻断；完整已知技能不触发降级', () => {
  const f = fixture(); skill(f, 1, 'MEETING', '未来未知机制', 2);
  skill(f, 3, 'MANUFACTURE', '进驻制造站时，生产力+25%');
  f.catalog.buffs.absent = { buffId: 'absent', roomType: 'MEETING', description: '未知' };
  const result = run(f);
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.frozenSlots, []);
  assert.deepEqual(result.excludedIds, []);
});

test('仅设施数量或等级依赖无需冻结其人员，静态设施数据不会因换人而改变', () => {
  const f = fixture(); skill(f, 1, 'MEETING', clue);
  f.snapshot.rooms.push({ slot: 't', type: 'TRADING', capacity: 3, occupants: [], level: 3 });
  skill(f, 3, 'TRADING', '进驻贸易站时，每间宿舍每级+1%获取效率');
  assert.deepEqual(run(f).frozenSlots, ['r']);
});
