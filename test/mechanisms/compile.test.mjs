import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBuff } from '../fixtures/mechanisms.mjs';

// 此文件验证已登记的合成参数输入；未知ID/漂移合同直接由 registry.test.mjs 验证。
const buff = (description, roomType = 'MANUFACTURE') => ({ buffId: 'synthetic', roomType, description });

test('热情值使用已登记的新参数，拒绝零步长、错房和未知尾句', () => {
  const text = '进驻控制中枢时，所有生产贵金属类配方的制造站生产力+2%，每有10点热情值，所有生产贵金属类配方的制造站生产力+3%';
  const compiled = compileBuff(buff(text, 'CONTROL'));
  assert.equal(compiled.status, 'compiled');
  assert.equal(compiled.effects[0].step, 10);
  assert.equal(compiled.effects[0].value, 0.03);
  for (const description of [text.replace('10点', '0点'), `${text}，并产生未知效果`]) {
    assert.notEqual(compileBuff(buff(description, 'CONTROL')).status, 'compiled');
  }
  assert.notEqual(compileBuff(buff(text, 'MANUFACTURE')).status, 'compiled');
});

test('阵营点数使用已登记参数，拒绝零步长、错配资源及不完整描述', () => {
  for (const [type, name, body, invalid] of [
    ['CONTROL', '控制中枢', '控制中枢内每有1名彩虹小队干员，则情报储备+2', '控制中枢内每有1名彩虹小队干员，则乌萨斯特饮+2'],
    ['CONTROL', '控制中枢', '控制中枢内每有1名乌萨斯学生自治团干员，则乌萨斯特饮+3', '控制中枢内每有1名乌萨斯学生自治团干员，则乌萨斯特饮+0'],
    ['MANUFACTURE', '制造站', '生产力+15%，每有3瓶乌萨斯特饮，则仓库容量上限+4', '生产力+15%，每有0瓶乌萨斯特饮，则仓库容量上限+4'],
    ['MEETING', '会客室', '线索搜集速度提升7%，同时每2点情报储备额外提升3%', '线索搜集速度提升7%，同时每0点情报储备额外提升3%'],
    ['HIRE', '人力办公室', '人脉资源的联络速度+15%，每2点情报储备额外+3%联络速度，每3瓶乌萨斯特饮额外+4%联络速度',
      '人脉资源的联络速度+15%，每2点情报储备额外+3%联络速度，每0瓶乌萨斯特饮额外+4%联络速度'],
  ]) {
    const prefix = `进驻${name}时，`;
    assert.equal(compileBuff(buff(prefix + body, type)).status, 'compiled');
    assert.equal(compileBuff(buff(prefix + invalid, type)).status, 'unsupported');
    assert.equal(compileBuff(buff(prefix + body + '，未知联动', type)).status, 'unsupported');
    assert.equal(compileBuff(buff('进驻发电站时，' + body, 'POWER')).status, 'unsupported');
  }
});

test('木天蓼参数可复用但零步长、未知尾句和错房必须拒绝', () => {
  for (const [type, name, body, invalid] of [
    ['CONTROL', '控制中枢', '自身心情每小时消耗+0.3，木天蓼+9', '自身心情每小时消耗+0.3，木天蓼+0'],
    ['CONTROL', '控制中枢', '控制中枢内每有1名怪物猎人小队干员，则木天蓼+3', '控制中枢内每有1名怪物猎人小队干员，则木天蓼+0'],
    ['MANUFACTURE', '制造站', '仓库容量上限+6，生产力+7%，同时每有2个木天蓼，则生产力+3%', '仓库容量上限+6，生产力+7%，同时每有0个木天蓼，则生产力+3%'],
    ['TRADING', '贸易站', '订单获取效率+7%，且订单上限+3，同时每有2个木天蓼，则订单获取效率+4%', '订单获取效率+7%，且订单上限+3，同时每有0个木天蓼，则订单获取效率+4%'],
  ]) {
    const prefix = `进驻${name}时，`;
    assert.equal(compileBuff(buff(prefix + body, type)).status, 'compiled');
    assert.equal(compileBuff(buff(prefix + invalid, type)).status, 'unsupported');
    assert.equal(compileBuff(buff(prefix + body + '，未知联动', type)).status, 'unsupported');
    assert.equal(compileBuff(buff('进驻发电站时，' + body, 'POWER')).status, 'unsupported');
  }
});

test('共鸣完整参数复用，零步长及未知尾句不误认为支持', () => {
  for (const [type, name, body, invalid] of [
    ['HIRE', '人力办公室', '每个招募位（不包含初始招募位）+12点无声共鸣', '每个招募位（不包含初始招募位）+0点无声共鸣'],
    ['DORMITORY', '宿舍', '该宿舍内每有1名干员，无声共鸣+2', '该宿舍内每有1名干员，无声共鸣+0'],
    ['TRADING', '贸易站', '每3点无声共鸣+2%订单效率', '每0点无声共鸣+2%订单效率'],
    ['DORMITORY', '宿舍', '该宿舍内所有干员的心情每小时恢复+0.3，每有3点无声共鸣，该宿舍内所有干员的心情每小时恢复额外+0.02（同种效果取最高）',
      '该宿舍内所有干员的心情每小时恢复+0.3，每有0点无声共鸣，该宿舍内所有干员的心情每小时恢复额外+0.02（同种效果取最高）'],
  ]) {
    const prefix = `进驻${name}时，`;
    assert.equal(compileBuff(buff(prefix + body, type)).status, 'compiled');
    assert.equal(compileBuff(buff(prefix + invalid, type)).status, 'unsupported');
    assert.equal(compileBuff(buff(prefix + body + '，未知联动', type)).status, 'unsupported');
  }
});

test('料理完整参数可复用，零步长、错房及未知尾句不编译', () => {
  const cases = [
    ['DORMITORY', '当前宿舍每级提供2层魔物料理'],
    ['MANUFACTURE', '每3点魔物料理+2%生产力'],
    ['TRADING', '每3点魔物料理+2%订单效率'],
    ['MEETING', '每拥有3点魔物料理，线索搜集速度额外提升4%'],
  ];
  const names = { DORMITORY: '宿舍', MANUFACTURE: '制造站', TRADING: '贸易站', MEETING: '会客室' };
  for (const [type, body] of cases) {
    const text = `进驻${names[type]}时，${body}`;
    assert.equal(compileBuff(buff(text, type)).status, 'compiled');
    for (const invalid of [text + '，未知联动', text.replace(/每3|每拥有3|每级提供2/, match => match.replace(/\d/, '0'))]) {
      assert.equal(compileBuff(buff(invalid, type)).status, 'unsupported');
    }
    assert.equal(compileBuff(buff(`进驻发电站时，${body}`, 'POWER')).status, 'unsupported');
  }
});

test('怪物猎人伙伴条件保留术语身份、同中枢与排除自身约束，未知尾句仍拒绝', () => {
  for (const effect of ['所有制造站生产力+2%（同种效果取最高）', '所有贸易站订单效率+7%（同种效果取最高）']) {
    const text = `当与怪物猎人小队干员进驻控制中枢一起工作时，${effect}`;
    const result = compileBuff(buff(text, 'CONTROL'));
    assert.equal(result.status, 'compiled');
    assert.equal(result.effects[0].operatorGroup, 'cc.tag.mh');
    assert.equal(result.effects[0].partnerRoomType, 'CONTROL');
    assert.equal(result.effects[0].excludeSelf, true);
    assert.equal(result.effects[0].minimumGroupCount, 1);
    assert.equal(compileBuff(buff(`${text}，未知联动`, 'CONTROL')).status, 'unsupported');
  }
});

test('全基建术语人数使用已登记参数并拒绝未知身份、错房和尾句', () => {
  const text = '进驻制造站时，生产力+12%，基建内（不包含副手）每有1名S.E.E.S.干员（最多3名），生产力额外+7%';
  const result = compileBuff(buff(text, 'MANUFACTURE'));
  assert.equal(result.status, 'compiled');
  assert.equal(result.effects[0].value, 0.12);
  assert.equal(result.effects[1].value, 0.07);
  assert.equal(result.effects[1].maxCount, 3);
  for (const [description, type] of [[text, 'POWER'],
    [text.replace('S.E.E.S.', '未知小队'), 'MANUFACTURE'],
    [text.replace('最多3名', '最多0名'), 'MANUFACTURE'],
    [text + '，未定义效果', 'MANUFACTURE'],
  ]) assert.equal(compileBuff(buff(description, type)).status, 'unsupported');
});

test('小队贸易计数使用已登记参数，拒绝分数容量、错房及未知小队或尾句', () => {
  const text = '进驻贸易站时，订单上限+4，且每有一个泡影国狩猎小队干员进驻贸易站，订单获取效率+12%';
  const result = compileBuff(buff(text, 'TRADING'));
  assert.equal(result.status, 'compiled');
  assert.equal(result.effects[0].value, 4);
  assert.equal(result.effects[1].value, 0.12);
  assert.equal(result.effects[1].operatorGroup, 'cc.tag.mh2');
  assert.equal(result.effects[1].partnerRoomType, 'TRADING');
  for (const [description, type] of [
    [text.replace('+4', '+4.5'), 'TRADING'], [text, 'MANUFACTURE'],
    [text.replace('泡影国狩猎小队', '未知小队'), 'TRADING'],
    [text + '，未来未知联动', 'TRADING'],
  ]) assert.equal(compileBuff(buff(description, type)).status, 'unsupported');
});

test('贸易效率分档使用已登记参数，拒绝零步长、负收益、错房和未知尾句', () => {
  const text = '进驻贸易站时，当前贸易站内干员提供的每7%订单获取效率，额外提供3%效率，最多提供21%效率';
  const result = compileBuff(buff(text, 'TRADING'));
  assert.equal(result.status, 'compiled');
  assert.deepEqual(result.effects, [{ stat: 'orderSpeed', scope: 'room',
    basis: 'localOrderSpeed', step: 0.07, value: 0.03, cap: 0.21, stacking: 'sum' }]);
  for (const [description, type] of [
    [text.replace('每7%', '每0%'), 'TRADING'],
    [text.replace('额外提供3%', '额外提供-3%'), 'TRADING'],
    [text.replace('最多提供21%', '最多提供-21%'), 'TRADING'],
    [text + '，未知联动', 'TRADING'], [text, 'MANUFACTURE'],
  ]) assert.equal(compileBuff(buff(description, type)).status, 'unsupported');
});

test('工作场所伙伴完整解析且歧义身份、重复伙伴、未知尾句均拒绝', () => {
  const text = '进驻贸易站时，订单获取效率+30%；当甲、乙入驻工作场所时（不包含副手），订单获取效率分别额外+7%';
  const names = { a: '甲', b: '乙' };
  const result = compileBuff(buff(text, 'TRADING'), names);
  assert.equal(result.status, 'compiled');
  assert.equal(result.effects.length, 3);
  assert.equal(result.effects[1].value, 0.07);
  for (const [description, mapping, type] of [
    [text, { a: '甲' }, 'TRADING'], [text, { ...names, c: '甲' }, 'TRADING'],
    [text.replace('甲、乙', '甲、甲'), names, 'TRADING'],
    [text.replace('分别额外', '额外'), names, 'TRADING'],
    [text + '，未知效果', names, 'TRADING'], [text, names, 'MANUFACTURE'],
  ]) assert.equal(compileBuff(buff(description, type), mapping).status, 'unsupported');
});

test('组合技能只接受可唯一解析的角色名、完整条件与完整效果', () => {
  const names = { future: '未来队友' };
  const description = '当与未来队友在同一个贸易站时，订单获取效率+65%';
  assert.equal(compileBuff(buff(description, 'TRADING'), names).status, 'compiled');
  for (const [text, type, mapping] of [
    [description, 'TRADING', {}],
    [description, 'TRADING', { a: '未来队友', b: '未来队友' }],
    [description, 'MANUFACTURE', names],
    [description + '，未来未知联动', 'TRADING', names],
    ['当与未来队友一起进驻控制中枢时，自身和其他人心情每小时恢复+0.05', 'CONTROL', names],
  ]) assert.equal(compileBuff(buff(text, type), mapping).status, 'unsupported');
});

test('制造贸易内嵌伙伴条件拒绝歧义角色、未知尾句和不匹配设施', () => {
  for (const [roomType, text] of [
    ['MANUFACTURE', '进驻制造站时，当与伙伴在同一个制造站时，贵金属类配方的生产力+15%'],
    ['MANUFACTURE', '进驻制造站时，若伙伴在贸易站，则作战记录类配方的生产力+35%'],
    ['TRADING', '进驻贸易站时，订单获取效率+20%；当与伙伴在同一个贸易站时，订单获取效率额外+25%'],
  ]) {
    assert.equal(compileBuff(buff(text, roomType), { a: '伙伴' }).status, 'compiled');
    for (const names of [{}, { a: '伙伴', b: '伙伴' }]) {
      assert.equal(compileBuff(buff(text, roomType), names).status, 'unsupported');
    }
    assert.equal(compileBuff(buff(text + '，未来未知效果', roomType), { a: '伙伴' }).status, 'unsupported');
    assert.equal(compileBuff(buff(text.replace('同一个制造站', '同一个发电站').replace('同一个贸易站', '同一个发电站').replace('若伙伴在贸易站', '若伙伴在未知站'), roomType), { a: '伙伴' }).status, 'unsupported');
  }
});

test('嵌套伙伴条件不能覆盖已解析的伙伴条件', () => {
  const names = { a: '甲', b: '乙' };
  for (const text of [
    '进驻制造站时，当与甲在同一个制造站时，若乙在贸易站，则作战记录类配方的生产力+35%',
    '进驻贸易站时，当与甲在同一个贸易站时，当与乙在同一个贸易站时，订单获取效率+25%',
    '当与甲在同一个贸易站时，当与乙在同一个贸易站时，订单获取效率+25%',
  ]) assert.equal(compileBuff(buff(text, text.includes('制造站') ? 'MANUFACTURE' : 'TRADING'), names).status, 'unsupported');
});

test('已登记合成技能参数不依赖efficiency字段', () => {
  const result = compileBuff({ ...buff('进驻制造站时，生产力<@cc.vup>+37%</>'), efficiency: 0 });
  assert.equal(result.status, 'compiled');
  assert.deepEqual(result.effects, [{ stat: 'production', scope: 'room', value: 0.37, stacking: 'sum' }]);
});

test('复合技能完整编译容量、效率和自身消耗，保留符号', () => {
  const result = compileBuff(buff('进驻制造站时，仓库容量上限+8，生产力-5%，心情每小时消耗-0.25'));
  assert.equal(result.status, 'compiled');
  assert.deepEqual(result.effects, [
    { stat: 'capacity', scope: 'room', value: 8, stacking: 'sum' },
    { stat: 'production', scope: 'room', value: -0.05, stacking: 'sum' },
    { stat: 'moodCost', scope: 'self', value: -0.25, stacking: 'sum' },
  ]);
});

test('未知后半段使整条技能不支持，不返回半套效果', () => {
  for (const description of [
    '进驻制造站时，生产力+20%，每有1瓶未定义饮料，则仓库容量上限+2',
    '进驻制造站时，生产力+20%，未来新机制',
    '进驻制造站时，生产力+20%（未来叠加规则）',
  ]) {
    const result = compileBuff(buff(description));
    assert.equal(result.status, 'unsupported');
    assert.equal(result.effects, undefined);
    assert.equal(result.reason, 'UNRECOGNIZED_MECHANISM');
  }
});

test('中枢全局同种取最高，不误编译为本房固定加成', () => {
  const result = compileBuff(buff('进驻控制中枢时，所有制造站生产力+2%（同种效果取最高）', 'CONTROL'));
  assert.deepEqual(result.effects, [{ stat: 'production', scope: 'MANUFACTURE', value: 0.02, stacking: 'max' }]);
});

test('原始描述的房间条件与roomType不一致时拒绝', () => {
  assert.equal(compileBuff(buff('进驻贸易站时，订单获取效率+20%')).status, 'unsupported');
});

test('制造、贸易、无人机、线索和招聘使用不同量纲', () => {
  for (const [type, description, stat, value] of [
    ['TRADING', '进驻贸易站时，订单获取效率+35%，且订单上限+2', 'orderSpeed', 0.35],
    ['POWER', '进驻发电站时，无人机充能速度+15%', 'droneSpeed', 0.15],
    ['MEETING', '进驻会客室时，线索搜集速度提升20%', 'clueSpeed', 0.2],
    ['HIRE', '进驻人力办公室时，人脉资源的联络速度+45%，心情每小时消耗+2', 'contactSpeed', 0.45],
  ]) {
    const result = compileBuff(buff(description, type));
    assert.equal(result.status, 'compiled');
    assert.equal(result.effects[0].stat, stat);
    assert.equal(result.effects[0].value, value);
  }
});

test('宿舍自身恢复与全员最高恢复不能混合叠加', () => {
  assert.deepEqual(compileBuff(buff('进驻宿舍时，自身心情每小时恢复+0.7', 'DORMITORY')).effects,
    [{ stat: 'moodRecovery', scope: 'self', value: 0.7, stacking: 'sum' }]);
  assert.deepEqual(compileBuff(buff('进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高）', 'DORMITORY')).effects,
    [{ stat: 'moodRecovery', scope: 'occupants', value: 0.1, stacking: 'max' }]);
});

test('宿舍等级联动和贸易站自身等级保留依赖', () => {
  assert.deepEqual(compileBuff(buff('进驻贸易站时，每间宿舍每级+1%获取效率', 'TRADING')).effects,
    [{ stat: 'orderSpeed', scope: 'room', value: 0.01, stacking: 'sum', basis: 'dormitoryLevels' }]);
  assert.deepEqual(compileBuff(buff('进驻贸易站时，当前贸易站每级+1个订单上限', 'TRADING')).effects,
    [{ stat: 'capacity', scope: 'room', value: 1, stacking: 'sum', basis: 'roomLevel' }]);
});

test('畸形标记、不有限数值、空描述和未知房间不会成为已支持机制', () => {
  for (const item of [buff(''), buff('进驻制造站时，生产力<future>+15%</future>'),
    buff(`进驻制造站时，生产力+${'9'.repeat(320)}%`), buff('进驻制造站时，生产力+20%', 'UNKNOWN'),
    buff('进驻制造站时，生产力+20%，'), { roomType: 'MANUFACTURE' }]) {
    assert.equal(compileBuff(item).status, 'unsupported');
  }
});
