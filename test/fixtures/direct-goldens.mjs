// 人工核对的技能增量，不从编译器输出或描述中的数字生成预期值。
// 只匹配完整文案；同名ID、前缀及局部文案均不自动获得验收。
export const directGoldens = [{
  type: 'HIRE', body: '人脉资源的联络速度+20%，同时每个招募位（不包含初始招募位）+10点记忆碎片',
  scenarios: [1, 2, 3].map(level => ({
    levels: { HIRE: level }, room: { contactSpeed: 0.2 },
    companionBuffs: { 2: ['hire_spd_bd_n1[000]'], 4: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
    global: { MANUFACTURE: { production: 0.01 + (level - 1) * 0.1 } },
    inactiveRooms: { MANUFACTURE: { production: 0.01 } },
  })),
}, {
  type: 'HIRE', body: '每1点记忆碎片转化为1点感知信息，心情耗尽时清空所有记忆碎片和自身累积的感知信息',
  scenarios: [1, 2, 3].map(level => ({
    levels: { HIRE: level }, room: { contactSpeed: 0.2 },
    companionBuffs: { 2: ['hire_spd_bd_n1_n1[100]'], 4: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
    global: { MANUFACTURE: { production: 0.01 + (level - 1) * 0.1 } },
    inactiveRooms: { HIRE: { contactSpeed: 0.2 }, MANUFACTURE: { production: 0.01 } },
  })),
}, {
  type: 'DORMITORY', body: '每1个小节转化为1点感知信息',
  companionBuffs: { 4: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
  global: { MANUFACTURE: { production: 0.02 } },
  inactiveRooms: { MANUFACTURE: { production: 0.01 } },
}, {
  type: 'POWER', body: '如果逻各斯进驻在训练室协助位，则无人机充能速度+5%',
  scenarios: [
    { trainer: '逻各斯', room: { droneSpeed: 0.05 } },
    { trainer: '阿米娅', room: {} },
    { room: {} },
  ],
}, {
  type: 'POWER', body: '每10架无人机上限+1%无人机充能速度（最多+25%）',
  scenarios: [
    { droneLimit: 9, room: { droneSpeed: 0 } },
    { droneLimit: 10, room: { droneSpeed: 0.01 } },
    { droneLimit: 200, room: { droneSpeed: 0.2 } },
    { droneLimit: 250, room: { droneSpeed: 0.25 } },
    { droneLimit: 300, room: { droneSpeed: 0.25 } },
  ],
}, {
  type: 'CONTROL', body: '控制中枢内每个异格干员可使控制中枢内所有干员的心情每小时恢复+0.05',
  scenarios: [
    { self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
    { partner: { name: '炎狱炎熔' }, self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.05 } },
    { partner: { name: '斯卡蒂' }, self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
    { partner: { name: '浊心斯卡蒂', type: 'POWER' }, self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
  ],
}, {
  type: 'TRADING', body: '当前订单数与订单上限每差1笔订单，则订单获取效率+4%',
  scenarios: [
    { stocks: { TRADING: 0 }, room: { orderSpeed: 0.24 } },
    { levels: { TRADING: 3 }, stocks: { TRADING: 2 }, companionBuffs: { 2: ['trade_ord_limit&cost[000]'] },
      room: { orderSpeed: 0.52, capacity: 5 }, other: { moodCost: -0.25 },
      inactiveRooms: { TRADING: { capacity: 5 } }, inactiveOperators: { 2: { moodCost: -0.25 } } },
  ],
}, {
  type: 'CONTROL', body: '控制中枢内每个鲤氏侦探事务所干员可使该派系干员额外恢复心情，同时每人可使控制中枢内所有干员的心情每小时恢复+0.2',
  scenarios: [
    { self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
    { partner: { name: '阿', faction: '鲤氏侦探事务所' }, self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.25 } },
    { partners: [{ name: '阿', faction: '鲤氏侦探事务所' }, { name: '老鲤', instId: 3, faction: '鲤氏侦探事务所' }],
      assignment: { MANUFACTURE: [] }, team: [1, 2, 3], self: { moodRecovery: 0.1 }, other: { moodRecovery: 0.5 },
      globalOperators: { MANUFACTURE: { moodRecovery: 0.5 } } },
  ],
}, {
  type: 'DORMITORY', body: '自身心情每小时恢复+2，同时无法获得其他来源提供的心情恢复效果',
  self: { fixedMoodRecovery: 2 },
}, {
  type: 'CONTROL', body: '部分设施内处于工作状态的干员心情每小时恢复+0.1；同时控制中枢内部分技能可以为其他设施内处于工作状态的干员额外提供心情恢复',
  scenarios: [
    { globalOperators: { POWER: { moodRecovery: 0.1 }, HIRE: { moodRecovery: 0.1 }, MEETING: { moodRecovery: 0.1 }, MANUFACTURE: { moodRecovery: 0 }, TRADING: { moodRecovery: 0 } } },
    { companionBuffs: { 2: ['control_mp_cost[000]'] }, self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.05 },
      globalOperators: { POWER: { moodRecovery: 0.15 }, HIRE: { moodRecovery: 0.15 }, MEETING: { moodRecovery: 0.15 }, MANUFACTURE: { moodRecovery: 0.05 }, TRADING: { moodRecovery: 0.05 } },
      inactiveOperators: { 2: { moodRecovery: 0.05 } } },
  ],
}, {
  type: 'CONTROL', body: '自身心情每小时消耗+0.5；每个岁干员进驻在宿舍和活动室以外的设施则人间烟火+5（最多5名）',
  scenarios: [
    { self: { moodCost: 0.5 }, companionBuffs: { 4: ['trade_ord_spd_bd_n2[000]'] }, global: { TRADING: { orderSpeed: 0.01 } } },
    { partner: { name: '年', faction: '炎-岁', type: 'POWER' }, self: { moodCost: 0.5 }, companionBuffs: { 4: ['trade_ord_spd_bd_n2[000]'] }, global: { TRADING: { orderSpeed: 0.06 } } },
    { partner: { name: '年', faction: '炎-岁', type: 'DORMITORY' }, self: { moodCost: 0.5 }, companionBuffs: { 4: ['trade_ord_spd_bd_n2[000]'] }, global: { TRADING: { orderSpeed: 0.01 } }, inactiveRooms: { TRADING: { orderSpeed: 0.01 } } },
  ],
}, {
  type: 'CONTROL', body: '其他设施内处于工作状态的干员心情每小时恢复+0.05；同时每有20点人间烟火，则额外+0.05，（与控制中枢加成有特殊比较规则）',
  scenarios: [
    { globalOperators: Object.fromEntries(['POWER', 'MANUFACTURE', 'TRADING', 'HIRE', 'MEETING'].map(type => [type, { moodRecovery: 0.05 }])) },
    { levels: { HIRE: 3 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'] },
      globalOperators: Object.fromEntries(['POWER', 'MANUFACTURE', 'TRADING', 'HIRE', 'MEETING'].map(type => [type, { moodRecovery: 0.1 }])) },
  ],
}, {
  type: 'CONTROL', body: '其他设施内处于工作状态的干员心情每小时恢复+0.1，当魔王进驻中枢时额外+0.1（与控制中枢加成有特殊比较规则）',
  scenarios: [
    { globalOperators: Object.fromEntries(['POWER', 'MANUFACTURE', 'TRADING', 'HIRE', 'MEETING'].map(type => [type, { moodRecovery: 0.1 }])) },
    { partner: { name: '魔王' }, globalOperators: Object.fromEntries(['POWER', 'MANUFACTURE', 'TRADING', 'HIRE', 'MEETING'].map(type => [type, { moodRecovery: 0.2 }])) },
  ],
}, {
  type: 'CONTROL', body: '控制中枢内所有干员的心情每小时恢复+0.05；当自身心情处于12以下时，人间烟火+15',
  scenarios: [
    { ap: { 1: 4320000 }, companionBuffs: { 3: ['manu_prod_spd_bd[300]'] },
      self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.05 }, global: { MANUFACTURE: { production: 0.05 } } },
    { ap: { 1: 4320001 }, companionBuffs: { 3: ['manu_prod_spd_bd[300]'] },
      self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.05 }, global: { MANUFACTURE: { production: 0 } },
      inactiveRooms: { MANUFACTURE: { production: 0 } } },
  ],
}, {
  type: 'CONTROL', body: '当自身心情大于12时，人间烟火+15；当自身心情处于12以下时，感知信息+10',
  scenarios: [
    { ap: { 1: 4320000 }, companionBuffs: { 3: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'], 4: ['trade_ord_spd_bd_n2[000]'] },
      global: { MANUFACTURE: { production: 0.11 }, TRADING: { orderSpeed: 0.01 } } },
    { ap: { 1: 4320001 }, companionBuffs: { 3: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'], 4: ['trade_ord_spd_bd_n2[000]'] },
      global: { MANUFACTURE: { production: 0.01 }, TRADING: { orderSpeed: 0.16 } },
      inactiveRooms: { MANUFACTURE: { production: 0.01 }, TRADING: { orderSpeed: 0.01 } } },
  ],
}, {
  type: 'CONTROL', body: '自身心情每小时消耗+0.5；当自身心情大于12时，感知信息+10',
  scenarios: [
    { ap: { 1: 4320000 }, companionBuffs: { 3: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
      self: { moodCost: 0.5 }, global: { MANUFACTURE: { production: 0.01 } } },
    { ap: { 1: 4320001 }, companionBuffs: { 3: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
      self: { moodCost: 0.5 }, global: { MANUFACTURE: { production: 0.11 } },
      inactiveRooms: { MANUFACTURE: { production: 0.01 } } },
  ],
}, {
  type: 'DORMITORY', body: '该宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高），同时当前宿舍每级提供1层梦境',
  levels: { DORMITORY: 3 }, companionBuffs: { 2: ['dorm_rec_bd_n1[000]'], 4: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
  self: { moodRecovery: 0.1 }, other: { moodRecovery: 0.1 }, global: { MANUFACTURE: { production: 0.05 } },
  inactiveRooms: { MANUFACTURE: { production: 0.01 } },
}, {
  type: 'DORMITORY', body: '每1层梦境转化为1点感知信息',
  levels: { DORMITORY: 3 }, companionBuffs: { 2: ['dorm_rec_bd_n1_n2[000]'], 4: ['manu_prod_spd_bd_n1[000]', 'manu_prod_spd_bd[010]'] },
  self: { moodRecovery: 0.1 }, other: { moodRecovery: 0.1 }, global: { MANUFACTURE: { production: 0.05 } },
  inactiveRooms: { MANUFACTURE: { production: 0.01 } }, inactiveOperators: { 2: { moodRecovery: 0.1 } },
}, {
  type: 'MANUFACTURE', body: '宿舍内每有1名干员则感知信息+1，同时每1点感知信息转化为1点思维链环',
  companionBuffs: { 2: ['manu_prod_spd_bd[010]'] }, room: { production: 0.01 }, inactiveRooms: { MANUFACTURE: { production: 0 } },
}, ...[2, 1].map(step => ({
  type: 'MANUFACTURE', body: `每${step}点思维链环+1%生产力`,
  companionBuffs: { 2: ['manu_prod_spd_bd_n1[000]'] }, room: { production: step === 2 ? 0 : 0.01 },
})), {
  type: 'TRADING', body: '宿舍内每有1名干员则感知信息+1，同时每1点感知信息转化为1点无声共鸣',
  companionBuffs: { 2: ['trade_ord_spd_bd[010]'] }, room: { orderSpeed: 0 }, inactiveRooms: { TRADING: { orderSpeed: 0 } },
}, {
  type: 'CONTROL', body: '若外势大于等于实地，所有贸易站订单效率+7%；若实地大于外势，所有制造站生产力+2%（同种效果取最高）',
  global: { TRADING: { orderSpeed: 0.07 } },
}, {
  type: 'MANUFACTURE', body: '每5点人间烟火转化为1点巫术结晶',
  scenarios: [
    { companionBuffs: { 2: ['manu_prod_spd_bd[201]'] }, room: { production: 0 }, inactiveRooms: { MANUFACTURE: { production: 0 } } },
    { levels: { HIRE: 3 }, companionBuffs: { 2: ['manu_prod_spd_bd[201]'], 8: ['hire_spd_bd_n1_n1[200]'] },
      room: { production: 0.08 }, inactiveRooms: { MANUFACTURE: { production: 0 } } },
  ],
}, ...[1, 2].map(value => ({
  type: 'MANUFACTURE', body: `每1点巫术结晶+${value}%生产力`,
  scenarios: [
    { room: { production: 0 } },
    { levels: { HIRE: 3 }, companionBuffs: { 2: ['manu_bd_to_bd[000]'], 8: ['hire_spd_bd_n1_n1[200]'] },
      room: { production: value === 1 ? 0.04 : 0.08 } },
  ],
})), {
  // 锁定原文在“人间烟火”前多一个 <，保留数据原样，不通过清洗掩盖漂移。
  type: 'HIRE', body: '每个招募位（不包含初始招募位）+10点<人间烟火',
  scenarios: [
    { companionBuffs: { 5: ['trade_ord_spd_bd_n2[000]'] }, global: { TRADING: { orderSpeed: 0.01 } },
      inactiveRooms: { TRADING: { orderSpeed: 0.01 } } },
    { levels: { HIRE: 3 }, companionBuffs: { 5: ['trade_ord_spd_bd_n2[000]'] },
      global: { TRADING: { orderSpeed: 0.21 } }, inactiveRooms: { TRADING: { orderSpeed: 0.01 } } },
  ],
}, {
  type: 'TRADING', body: '宿舍内每有1名干员则人间烟火+1，同时每有1点人间烟火，则订单获取效率+1%',
  scenarios: [
    { room: { orderSpeed: 0.01 } },
    { levels: { HIRE: 3 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'] }, room: { orderSpeed: 0.21 } },
  ],
}, {
  type: 'MANUFACTURE', body: '每3点人间烟火+1%生产力',
  scenarios: [
    { room: { production: 0 } },
    { levels: { HIRE: 3 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'] }, room: { production: 0.06 } },
    { levels: { HIRE: 3 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'], 4: ['trade_ord_spd_bd_n2[000]'] },
      room: { production: 0.07 }, global: { TRADING: { orderSpeed: 0.21 } },
      inactiveRooms: { TRADING: { orderSpeed: 0.21 } } },
  ],
}, {
  type: 'MEETING', body: '线索搜集速度提升20%，同时每10点人间烟火额外提升1%',
  scenarios: [
    { room: { clueSpeed: 0.2 } },
    { levels: { HIRE: 2 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'] }, room: { clueSpeed: 0.21 } },
    { levels: { HIRE: 3 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'] }, room: { clueSpeed: 0.22 } },
  ],
}, ...[0.01, 0.02].map((value, index) => ({
  type: 'TRADING', body: `贸易站内全体干员每小时心情消耗-0.1，每有10点人间烟火，则额外-${value}`,
  scenarios: [
    { self: { moodCost: -0.1 }, other: { moodCost: -0.1 } },
    { levels: { HIRE: 3 }, companionBuffs: { 8: ['hire_spd_bd_n1_n1[200]'], 2: ['trade_ord_spd_bd_n2[000]'] },
      room: { orderSpeed: 0.21 }, self: { moodCost: index === 0 ? -0.12 : -0.14 },
      other: { moodCost: index === 0 ? -0.12 : -0.14 }, inactiveRooms: { TRADING: { orderSpeed: 0.21 } } },
  ],
})), ...[0.5, 1].map(value => ({
  type: 'CONTROL', body: `所有生产贵金属类配方的制造站生产力+${value}%，每有20点热情值，所有生产贵金属类配方的制造站生产力+${value}%`,
  scenarios: [
    { formulas: { MANUFACTURE: '1' } },
    { formulas: { MANUFACTURE: '4' }, global: { MANUFACTURE: { production: value / 100 } } },
    { formulas: { MANUFACTURE: '4' }, companionBuffs: { 2: ['control_mp_bd&trade[000]'] },
      global: { MANUFACTURE: { production: value / 50 }, TRADING: { orderSpeed: 0.02 } },
      other: { moodCost: 0.02 }, inactiveRooms: { TRADING: { orderSpeed: 0.02 } },
      inactiveOperators: { 2: { moodCost: 0.02 } } },
  ],
})), {
  type: 'CONTROL', body: '热情值处于40点及以上时，自身心情每小时消耗+0.05',
  scenarios: [
    {},
    { companionBuffs: { 2: ['control_mp_bd&trade[000]', 'control_meeting_spd&bd[000]', 'control_hire_spd&bd[000]'] },
      self: { moodCost: 0.05 }, other: { moodCost: 0.05 },
      global: { TRADING: { orderSpeed: 0.05 }, MEETING: { clueSpeed: 0.05 }, HIRE: { contactSpeed: 0.1 } },
      inactiveRooms: { TRADING: { orderSpeed: 0.05 }, MEETING: { clueSpeed: 0.05 }, HIRE: { contactSpeed: 0.1 } },
      inactiveOperators: { 2: { moodCost: 0.05 } } },
  ],
}, {
  type: 'CONTROL', body: '热情值+20；每有8点热情值，自身心情每小时消耗+0.01，所有贸易站订单效率+1%（同种效果取最高）',
  self: { moodCost: 0.02 }, global: { TRADING: { orderSpeed: 0.02 } },
}, {
  type: 'CONTROL', body: '热情值+10；会客室线索搜集速度提升+5%（同种效果取最高）',
  companionBuffs: { 2: ['control_mp_bd&trade[000]'] }, other: { moodCost: 0.03 },
  global: { MEETING: { clueSpeed: 0.05 }, TRADING: { orderSpeed: 0.03 } },
  inactiveRooms: { TRADING: { orderSpeed: 0.02 } }, inactiveOperators: { 2: { moodCost: 0.02 } },
}, {
  type: 'CONTROL', body: '热情值+10；人脉资源的联络速度+10%（同种效果取最高）',
  companionBuffs: { 2: ['control_mp_bd&trade[000]'] }, other: { moodCost: 0.03 },
  global: { HIRE: { contactSpeed: 0.1 }, TRADING: { orderSpeed: 0.03 } },
  inactiveRooms: { TRADING: { orderSpeed: 0.02 } }, inactiveOperators: { 2: { moodCost: 0.02 } },
}, {
  type: 'CONTROL', body: '宿舍内每有1名干员，热情值+1',
  assignment: { DORMITORY: [5, 6, 7, 8], POWER: [], MEETING: [], HIRE: [] },
  companionBuffs: { 2: ['control_mp_bd&trade[000]'] }, other: { moodCost: 0.03 },
  global: { TRADING: { orderSpeed: 0.03 } }, inactiveRooms: { TRADING: { orderSpeed: 0.02 } },
  inactiveOperators: { 2: { moodCost: 0.02 } },
}, {
  type: 'CONTROL', body: '控制中枢内每有1名彩虹小队干员，则情报储备+1',
  partner: { name: '灰烬', faction: '彩虹小队' }, companionBuffs: { 7: ['meet_spd_bd[000]'] },
  global: { MEETING: { clueSpeed: 0.1 } }, inactiveRooms: { MEETING: { clueSpeed: 0.05 } },
}, {
  type: 'CONTROL', body: '控制中枢内每有1名乌萨斯学生自治团干员，则乌萨斯特饮+1',
  partner: { name: '凛冬', faction: '乌萨斯学生自治团' }, companionBuffs: { 3: ['manu_prod_bd[000]'] },
  global: { MANUFACTURE: { production: 0.2, capacity: 2 } },
  inactiveRooms: { MANUFACTURE: { production: 0.2, capacity: 0 } },
}, {
  type: 'MANUFACTURE', body: '生产力+20%，每有1瓶乌萨斯特饮，则仓库容量上限+2',
  scenarios: [
    { room: { production: 0.2, capacity: 0 } },
    { partner: { name: '凛冬', faction: '乌萨斯学生自治团', type: 'CONTROL' },
      companionBuffs: { 3: ['control_mp_bd[010]'] }, room: { production: 0.2, capacity: 2 } },
  ],
}, {
  type: 'MEETING', body: '线索搜集速度提升5%，同时每1点情报储备额外提升5%',
  scenarios: [
    { room: { clueSpeed: 0.05 } },
    { partner: { name: '灰烬', faction: '彩虹小队', type: 'CONTROL' },
      companionBuffs: { 3: ['control_mp_bd[000]'] }, room: { clueSpeed: 0.1 } },
  ],
}, {
  type: 'HIRE', body: '人脉资源的联络速度+20%，每1点情报储备额外+5%联络速度，每1瓶乌萨斯特饮额外+5%联络速度',
  scenarios: [
    { room: { contactSpeed: 0.2 } },
    { partner: { name: '灰烬', faction: '彩虹小队', type: 'CONTROL' },
      companionBuffs: { 3: ['control_mp_bd[000]'] }, room: { contactSpeed: 0.25 } },
    { partner: { name: '凛冬', faction: '乌萨斯学生自治团', type: 'CONTROL' },
      companionBuffs: { 3: ['control_mp_bd[010]'] }, room: { contactSpeed: 0.25 } },
  ],
}, {
  type: 'CONTROL', body: '自身心情每小时消耗+0.5，木天蓼+8',
  companionBuffs: { 3: ['manu_prod_spd&limit&bd[000]'] }, self: { moodCost: 0.5 },
  global: { MANUFACTURE: { production: 0.13, capacity: 8 } },
  inactiveRooms: { MANUFACTURE: { production: 0.05, capacity: 8 } },
}, {
  type: 'CONTROL', body: '控制中枢内每有1名怪物猎人小队干员，则木天蓼+2',
  partner: { name: '火龙S黑角' }, companionBuffs: { 4: ['trade_ord_spd&limit&bd[000]'] },
  global: { TRADING: { orderSpeed: 0.11, capacity: 2 } },
  inactiveRooms: { TRADING: { orderSpeed: 0.05, capacity: 2 } },
}, {
  type: 'MANUFACTURE', body: '仓库容量上限+8，生产力+5%，同时每有1个木天蓼，则生产力+1%',
  scenarios: [
    { room: { production: 0.05, capacity: 8 } },
    { companionBuffs: { 3: ['control_mp_cost&bd2[010]'] }, room: { production: 0.13, capacity: 8 },
      globalOperators: { CONTROL: { moodCost: 0.5 } }, inactiveOperators: { 3: { moodCost: 0.5 } } },
  ],
}, {
  type: 'TRADING', body: '订单获取效率+5%，且订单上限+2，同时每有1个木天蓼，则订单获取效率+3%',
  scenarios: [
    { room: { orderSpeed: 0.05, capacity: 2 } },
    { companionBuffs: { 3: ['control_mp_cost&bd2[010]'] }, room: { orderSpeed: 0.29, capacity: 2 },
      globalOperators: { CONTROL: { moodCost: 0.5 } }, inactiveOperators: { 3: { moodCost: 0.5 } } },
  ],
}, {
  type: 'MANUFACTURE', body: '基建内除活动室外每间设施每级+1个工程机器人，上限64个',
  scenarios: [
    { room: {} },
    { trainingLevel: 1, companionBuffs: { 2: ['manu_prod_spd_bd[110]'] }, room: { production: 0.05 },
      inactiveRooms: { MANUFACTURE: { production: 0 } } },
  ],
}, ...[16, 8].map(step => ({
  type: 'MANUFACTURE', body: `每${step}个工程机器人+5%生产力`,
  scenarios: [
    { room: { production: 0 } },
    { trainingLevel: 1, companionBuffs: { 2: ['manu_constrLv[000]'] },
      room: { production: step === 8 ? 0.05 : 0 } },
    { levels: { CONTROL: 5, DORMITORY: 5, MANUFACTURE: 3 },
      companionBuffs: { 2: ['manu_constrLv[000]'] }, room: { production: step === 8 ? 0.1 : 0.05 } },
  ],
})), {
  type: 'HIRE', body: '每个招募位（不包含初始招募位）+15点无声共鸣',
  scenarios: [
    { levels: { HIRE: 1 }, companionBuffs: { 5: ['trade_ord_spd_bd[010]'] },
      global: { TRADING: { orderSpeed: 0 } } },
    { levels: { HIRE: 2 }, companionBuffs: { 5: ['trade_ord_spd_bd[010]'] },
      global: { TRADING: { orderSpeed: 0.07 } } },
    { levels: { HIRE: 3 }, companionBuffs: { 5: ['trade_ord_spd_bd[010]'] },
      global: { TRADING: { orderSpeed: 0.15 } }, inactiveRooms: { TRADING: { orderSpeed: 0 } } },
  ],
}, {
  type: 'DORMITORY', body: '该宿舍内每有1名干员，无声共鸣+1',
  companionBuffs: { 5: ['trade_ord_spd_bd[010]'] },
  global: { TRADING: { orderSpeed: 0.01 } }, inactiveRooms: { TRADING: { orderSpeed: 0 } },
}, {
  type: 'DORMITORY', body: '该宿舍内所有干员的心情每小时恢复+0.2，每有5点无声共鸣，该宿舍内所有干员的心情每小时恢复额外+0.01（同种效果取最高）',
  companionBuffs: { 2: ['dorm_bd_num[000]'] }, self: { moodRecovery: 0.2 }, other: { moodRecovery: 0.2 },
}, ...[4, 2].map(step => ({
  type: 'TRADING', body: `每${step}点无声共鸣+1%订单效率`,
  scenarios: [
    { room: { orderSpeed: 0 } },
    { companionBuffs: { 5: ['dorm_bd_num[000]'] },
      assignment: { DORMITORY: [5, 8], HIRE: [] }, room: { orderSpeed: step === 4 ? 0 : 0.01 } },
  ],
})), {
  type: 'MEETING', body: '每拥有1点魔物料理，线索搜集速度额外提升2%',
  scenarios: [
    { room: { clueSpeed: 0 } },
    { levels: { DORMITORY: 5 }, companionBuffs: { 6: ['dorm_rec_bd_dungeon[000]'] }, room: { clueSpeed: 0.1 } },
  ],
}, {
  type: 'DORMITORY', body: '当前宿舍每级提供1层魔物料理',
  scenarios: [
    { levels: { DORMITORY: 5 }, companionBuffs: {
      4: ['manu_prod_spd_bd[400]'], 5: ['trade_ord_spd_bd[100]'],
    }, global: { MANUFACTURE: { production: 0.05 }, TRADING: { orderSpeed: 0.05 } },
    inactiveRooms: { MANUFACTURE: { production: 0 }, TRADING: { orderSpeed: 0 } } },
  ],
}, {
  type: 'MANUFACTURE', body: '每1点魔物料理+1%生产力',
  scenarios: [
    { room: { production: 0 } },
    { levels: { DORMITORY: 5 }, companionBuffs: { 5: ['dorm_rec_bd_dungeon[000]'] }, room: { production: 0.05 } },
  ],
}, {
  type: 'TRADING', body: '每1点魔物料理+1%订单效率',
  scenarios: [
    { room: { orderSpeed: 0 } },
    { levels: { DORMITORY: 5 }, companionBuffs: { 5: ['dorm_rec_bd_dungeon[000]'] }, room: { orderSpeed: 0.05 } },
  ],
}, {
  type: 'TRADING', body: '当前贸易站内干员提供的每5%订单获取效率，额外提供5%效率，最多提供25%效率',
  scenarios: [
    { room: { orderSpeed: 0 } },
    { companionBuffs: { 2: ['trade_ord_spd[000]'] }, room: { orderSpeed: 0.4 } },
    { companionBuffs: { 2: ['trade_ord_spd[020]'] }, room: { orderSpeed: 0.6 },
      inactiveRooms: { TRADING: { orderSpeed: 0.35 } } },
  ],
}, {
  type: 'TRADING', body: '当前贸易站内干员提供的每5%订单获取效率，额外提供5%效率，最多提供35%效率',
  scenarios: [
    { room: { orderSpeed: 0 } },
    { companionBuffs: { 2: ['trade_ord_spd[000]'] }, room: { orderSpeed: 0.4 } },
    { companionBuffs: { 2: ['trade_ord_spd[020]'] }, room: { orderSpeed: 0.7 },
      inactiveRooms: { TRADING: { orderSpeed: 0.35 } } },
  ],
}, {
  type: 'TRADING', body: '订单获取效率+25%；当伊内丝入驻工作场所时（不包含副手），订单获取效率额外+5%',
  scenarios: [
    { room: { orderSpeed: 0.25 } },
    { partner: { name: '伊内丝', type: 'POWER' }, room: { orderSpeed: 0.3 } },
    { partner: { name: '伊内丝', type: 'DORMITORY' }, room: { orderSpeed: 0.25 } },
  ],
}, {
  type: 'TRADING', body: '订单获取效率+30%；当伊内丝、W入驻工作场所时（不包含副手），订单获取效率分别额外+5%',
  scenarios: [
    { room: { orderSpeed: 0.3 } },
    { partner: { name: '伊内丝', type: 'POWER' }, room: { orderSpeed: 0.35 } },
    { partner: { name: 'W', type: 'CONTROL' }, room: { orderSpeed: 0.35 } },
    { partners: [{ name: '伊内丝', type: 'POWER' }, { name: 'W', type: 'CONTROL' }], room: { orderSpeed: 0.4 } },
    { partners: [{ name: '伊内丝', type: 'DORMITORY' }, { name: 'W', type: 'CONTROL' }], room: { orderSpeed: 0.35 } },
  ],
}, {
  type: 'MANUFACTURE', body: '当前制造站内其他干员提供的每5%生产力（不包含根据设施数量提供加成的生产力），额外提供5%生产力，最多提供40%生产力',
  scenarios: [
    { room: { production: 0 } },
    { companionBuffs: { 2: ['manu_prod_spd[000]'] }, room: { production: 0.3 } },
    { companionBuffs: { 2: ['manu_prod_spd[000]', 'manu_prod_spd[010]'] }, room: { production: 0.8 } },
    { companionBuffs: { 2: ['manu_prod_spd&power[000]'] }, room: { production: 0.05 },
      inactiveRooms: { MANUFACTURE: { production: 0.05 } } },
  ],
}, {
  type: 'CONTROL', body: '消除当前控制中枢内所有岁干员自身心情消耗的影响',
  scenarios: [
    { partner: { name: '年', faction: '炎-岁' }, companionBuffs: { 2: ['control_bd_spd[000]'] } },
    { companionBuffs: { 2: ['control_bd_spd[000]'] }, other: { moodCost: 0.5 },
      inactiveOperators: { 2: { moodCost: 0.5 } } },
  ],
}, {
  type: 'CONTROL', description: '当与丰川祥子一起进驻控制中枢时，消除自身心情消耗的影响',
  scenarios: [
    { partner: { name: '丰川祥子' }, companionBuffs: { 1: ['control_mp_cost_reset[000]', 'control_bd_spd[000]'] } },
    { companionBuffs: { 1: ['control_mp_cost_reset[000]', 'control_bd_spd[000]'] }, self: { moodCost: 0.5 } },
  ],
}, {
  type: 'MANUFACTURE', body: '消除当前制造站内所有干员自身心情消耗的影响',
  scenarios: [
    { companionBuffs: { 2: ['manu_prod_spd&limit&cost[100]', 'manu_cost[000]'] },
      room: { production: 0.2 }, self: { moodCost: -0.1 }, other: { moodCost: -0.1 } },
    { companionBuffs: { 2: ['manu_prod_limit&cost[000]', 'manu_cost[000]'] },
      room: { capacity: 8 }, self: { moodCost: -0.1 }, other: { moodCost: -0.1 },
      inactiveRooms: { MANUFACTURE: { capacity: 8 } }, inactiveOperators: { 2: { moodCost: -0.35 } } },
  ],
}];
const add = (type, body, room = {}, self = {}, other = {}, global = {}) =>
  directGoldens.push({ type, body, room, self, other, global });

for (const [text, value] of [['15', 0.15], ['20', 0.2], ['25', 0.25], ['30', 0.3]]) {
  add('MANUFACTURE', `生产力+${text}%`, { production: value });
}
for (const [text, value] of [['10', 0.1], ['15', 0.15], ['20', 0.2]]) {
  add('POWER', `无人机充能速度+${text}%`, { droneSpeed: value });
}
for (const [text, value] of [['10', 0.1], ['15', 0.15], ['20', 0.2], ['25', 0.25]]) {
  add('MEETING', `线索搜集速度提升${text}%`, { clueSpeed: value });
}
for (const [text, value] of [['20', 0.2], ['30', 0.3], ['35', 0.35], ['40', 0.4], ['45', 0.45]]) {
  add('HIRE', `人脉资源的联络速度+${text}%`, { contactSpeed: value });
}
for (const [text, value] of [['20', 0.2], ['30', 0.3], ['35', 0.35]]) {
  add('TRADING', `订单获取效率+${text}%`, { orderSpeed: value });
}
for (const [speed, capacity, expectedSpeed, expectedCapacity] of [
  ['10', '2', 0.1, 2], ['10', '4', 0.1, 4], ['25', '1', 0.25, 1],
  ['15', '2', 0.15, 2], ['15', '4', 0.15, 4], ['20', '4', 0.2, 4], ['30', '1', 0.3, 1],
]) add('TRADING', `订单获取效率+${speed}%，且订单上限+${capacity}`, { orderSpeed: expectedSpeed, capacity: expectedCapacity });
add('TRADING', '订单获取效率+30%，心情每小时消耗-0.25', { orderSpeed: 0.3 }, { moodCost: -0.25 });
add('TRADING', '订单上限+5，心情每小时消耗-0.25', { capacity: 5 }, { moodCost: -0.25 });
add('TRADING', '贸易站内干员心情每小时消耗-0.1', {}, { moodCost: -0.1 }, { moodCost: -0.1 });
add('MANUFACTURE', '当前制造站内所有干员心情每小时消耗-0.1', {}, { moodCost: -0.1 }, { moodCost: -0.1 });
for (const [text, capacity] of [['8', 8], ['10', 10], ['16', 16]]) {
  add('MANUFACTURE', `仓库容量上限+${text}，心情每小时消耗-0.25`, { capacity }, { moodCost: -0.25 });
}
add('MANUFACTURE', '仓库容量上限+6，生产力+10%', { capacity: 6, production: 0.1 });
add('MANUFACTURE', '仓库容量上限+10，生产力+10%', { capacity: 10, production: 0.1 });
add('MANUFACTURE', '生产力-5%，仓库容量上限+16，心情每小时消耗-0.15', { production: -0.05, capacity: 16 }, { moodCost: -0.15 });
add('MANUFACTURE', '生产力-5%，仓库容量上限+19，心情每小时消耗-0.25', { production: -0.05, capacity: 19 }, { moodCost: -0.25 });
add('MANUFACTURE', '生产力+25%，仓库容量上限-12，心情每小时消耗+0.25', { production: 0.25, capacity: -12 }, { moodCost: 0.25 });
add('MANUFACTURE', '生产力-20%，仓库容量上限+17，心情每小时消耗-0.25', { production: -0.2, capacity: 17 }, { moodCost: -0.25 });
add('MANUFACTURE', '生产力+20%，心情每小时消耗+0.25', { production: 0.2 }, { moodCost: 0.25 });
add('MANUFACTURE', '生产力+30%，心情每小时消耗+0.25', { production: 0.3 }, { moodCost: 0.25 });
add('MANUFACTURE', '生产力+25%，仓库容量上限+6', { production: 0.25, capacity: 6 });
add('MANUFACTURE', '生产力+20%，仓库容量上限-8', { production: 0.2, capacity: -8 });
for (const [text, value] of [['10', 0.1], ['20', 0.2], ['30', 0.3]]) {
  add('HIRE', `人脉资源的联络速度+${text}%，心情每小时消耗-0.25`, { contactSpeed: value }, { moodCost: -0.25 });
}
add('HIRE', '人脉资源的联络速度+45%，心情每小时消耗+2', { contactSpeed: 0.45 }, { moodCost: 2 });
add('HIRE', '人脉资源的联络速度+50%，心情每小时消耗+0.5', { contactSpeed: 0.5 }, { moodCost: 0.5 });
add('HIRE', '人脉资源的联络速度+30%，心情每小时消耗+1', { contactSpeed: 0.3 }, { moodCost: 1 });
add('HIRE', '人脉资源的联络速度+45%，心情每小时消耗+1', { contactSpeed: 0.45 }, { moodCost: 1 });
add('MEETING', '线索搜集速度提升35%，心情每小时消耗+2', { clueSpeed: 0.35 }, { moodCost: 2 });
add('POWER', '心情每小时消耗-0.52', {}, { moodCost: -0.52 });
add('POWER', '心情每小时消耗-0.3', {}, { moodCost: -0.3 });
for (const [text, value] of [['0.1', 0.1], ['0.15', 0.15], ['0.2', 0.2]]) {
  add('DORMITORY', `该宿舍内所有干员的心情每小时恢复+${text}（同种效果取最高）`, {}, { moodRecovery: value }, { moodRecovery: value });
}
for (const [text, value] of [['0.55', 0.55], ['0.7', 0.7], ['0.75', 0.75], ['0.85', 0.85], ['1', 1]]) {
  add('DORMITORY', `自身心情每小时恢复+${text}`, {}, { moodRecovery: value });
}
add('DORMITORY', '自身心情每小时恢复-0.1，该宿舍内所有干员的心情每小时恢复+0.2（同种效果取最高）', {}, { moodRecovery: 0.1 }, { moodRecovery: 0.2 });
add('DORMITORY', '自身心情每小时恢复-0.1，该宿舍内所有干员的心情每小时恢复+0.25（同种效果取最高）', {}, { moodRecovery: 0.15 }, { moodRecovery: 0.25 });
add('DORMITORY', '自身心情每小时恢复+0.55，该宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高）', {}, { moodRecovery: 0.65 }, { moodRecovery: 0.1 });
add('DORMITORY', '该宿舍内除自身以外所有干员的心情每小时恢复+0.1（同种效果取最高）', {}, {}, { moodRecovery: 0.1 });
add('CONTROL', '控制中枢内所有干员的心情每小时恢复+0.05', {}, { moodRecovery: 0.05 }, { moodRecovery: 0.05 });
add('CONTROL', '所有制造站生产力+2%（同种效果取最高）', {}, {}, {}, { MANUFACTURE: { production: 0.02 } });
add('CONTROL', '所有贸易站订单效率+7%（同种效果取最高）', {}, {}, {}, { TRADING: { orderSpeed: 0.07 } });
add('CONTROL', '人力办公室联络速度+10%（同种效果取最高）', {}, {}, {}, { HIRE: { contactSpeed: 0.1 } });
add('CONTROL', '会客室线索搜集速度+25%（同种效果取最高）', {}, {}, {}, { MEETING: { clueSpeed: 0.25 } });
add('CONTROL', '会客室线索搜集速度+15%（同种效果取最高）', {}, {}, {}, { MEETING: { clueSpeed: 0.15 } });

// 条件的正反例共享同条完整文案，数值由人工表给出；不能只验证生效分支。
const conditional = (type, body, scenarios) => directGoldens.push({ type, body, scenarios });
conditional('MANUFACTURE', '生产力+20%，基建内（不包含副手）每有1名S.E.E.S.干员（最多4名），生产力额外+5%', [
  { room: { production: 0.2 } },
  { partners: [{ name: '结城理', type: 'DORMITORY' }], room: { production: 0.25 } },
  { partners: [{ name: '埃癸斯', type: 'DORMITORY' }, { name: '岳羽由加莉', type: 'CONTROL' },
    { name: '虎狼丸', type: 'POWER' }], room: { production: 0.35 } },
]);
for (const [type, body, stat, base, one, two] of [
  ['TRADING', '订单获取效率+25%，基建内（不包含副手及活动室）每有一间进驻精英干员的设施，订单获取效率额外+2%（最多10间）', 'orderSpeed', 0.25, 0.27, 0.29],
  ['HIRE', '人脉资源的联络速度+30%，基建内（不包含副手及活动室）每有一间进驻精英干员的设施，联络速度额外+4%（最多5间）', 'contactSpeed', 0.3, 0.34, 0.38],
]) conditional(type, body, [
  { partners: [{ name: '芬', type: 'MANUFACTURE' }], room: { [stat]: base } },
  { assignment: { CONTROL: [], POWER: [], MANUFACTURE: [3, 4], DORMITORY: [] },
    partners: [{ name: '煌', instId: 3 }, { name: '迷迭香', instId: 4 }], room: { [stat]: one } },
  { partners: [{ name: '煌', type: 'MANUFACTURE' }, { name: '迷迭香', type: 'DORMITORY' }], room: { [stat]: two } },
]);
conditional('CONTROL', '所有宿舍内精英干员的心情每小时恢复+0.1（同种效果取最高）', [
  { partners: [{ name: '煌', type: 'DORMITORY' }], globalOperators: { DORMITORY: { moodRecovery: 0.1 } } },
  { partners: [{ name: '迷迭香', type: 'DORMITORY' }], globalOperators: { DORMITORY: { moodRecovery: 0.1 } } },
  { partners: [{ name: '芬', type: 'DORMITORY' }] },
  { partners: [{ name: '煌', type: 'MANUFACTURE' }] },
]);
conditional('CONTROL', '每个进驻在制造站的骑士干员生产力+7%', [
  { partners: [{ name: '临光', type: 'MANUFACTURE' }], global: { MANUFACTURE: { production: 0.07 } } },
  { partners: [{ name: '砾', type: 'MANUFACTURE' }], global: { MANUFACTURE: { production: 0.07 } } },
  { partners: [{ name: '正义骑士号', type: 'MANUFACTURE' }], global: { MANUFACTURE: { production: 0.07 } } },
  { partners: [{ name: '芬', type: 'MANUFACTURE' }] },
]);
for (const [type, body, first, fifth, formulaId] of [
  ['HIRE', '人脉资源的联络速度+5%，每间宿舍每级额外+1%人脉资源的联络速度', { contactSpeed: 0.06 }, { contactSpeed: 0.1 }],
  ['HIRE', '人脉资源的联络速度+5%，每间宿舍每级额外+2%人脉资源的联络速度', { contactSpeed: 0.07 }, { contactSpeed: 0.15 }],
  ['POWER', '每间宿舍每级为充能速度额外+0.5%', { droneSpeed: 0.005 }, { droneSpeed: 0.025 }],
  ['TRADING', '每间宿舍每级+1%获取效率', { orderSpeed: 0.01 }, { orderSpeed: 0.05 }],
  ['TRADING', '每间宿舍每级+2%获取效率', { orderSpeed: 0.02 }, { orderSpeed: 0.1 }],
  ['MANUFACTURE', '每间宿舍每级为贵金属类配方的生产力+1%', { production: 0.01 }, { production: 0.05 }, '4'],
]) conditional(type, body, [
  { levels: { DORMITORY: 1 }, formulaId, room: first },
  { levels: { DORMITORY: 5 }, formulaId, room: fifth },
  ...(formulaId ? [{ formulaId: '1' }] : []),
]);
for (const [text, recovery] of [['0.1', 0.15], ['0.15', 0.2]]) conditional('DORMITORY',
  `该宿舍内所有干员的心情每小时恢复+${text}，同时每有1间发电站，则恢复效果额外+0.05（叠加后的最终值同种效果取最高）`,
  [{ self: { moodRecovery: recovery }, other: { moodRecovery: recovery } }]);
conditional('DORMITORY', '该宿舍内所有干员心情每小时恢复+0.15，同时该宿舍内心情18以下的干员恢复效果额外+0.1（同种效果取最高）', [
  { ap: { 1: 6480001, 2: 6480000 }, self: { moodRecovery: 0.15 }, other: { moodRecovery: 0.25 } },
  { ap: { 1: 6479999, 2: 4320000 }, self: { moodRecovery: 0.25 }, other: { moodRecovery: 0.25 } },
]);
conditional('DORMITORY', '该宿舍内心情20以下的干员恢复效果额外+0.1（同种效果取最高）', [
  { ap: { 1: 7200001, 2: 7200000 }, self: { moodRecovery: 0 }, other: { moodRecovery: 0.1 } },
  { ap: { 1: 7199999 }, self: { moodRecovery: 0.1 }, other: { moodRecovery: 0.1 } },
]);
for (const [name, text, extra, base, active] of [
  ['乌尔比安', '25', '5', 0.25, 0.3], ['乌尔比安', '30', '10', 0.3, 0.4],
  ['伺夜', '25', '5', 0.25, 0.3], ['伺夜', '30', '10', 0.3, 0.4],
]) conditional('TRADING', `订单获取效率+${text}%；当${name}在基建内时（不包含副手及活动室使用者），订单获取效率额外+${extra}%`, [
  { room: { orderSpeed: base } },
  { partner: { name, type: 'DORMITORY' }, room: { orderSpeed: active } },
  { partner: { name, type: 'POWER' }, room: { orderSpeed: active } },
]);
conditional('CONTROL', '所有宿舍内所有干员的心情每小时恢复+0.05（同种效果取最高）；当与丰川祥子一起进驻控制中枢时，丰川祥子的心情每小时恢复+0.1', [
  { globalOperators: { DORMITORY: { moodRecovery: 0.05 } } },
  { partner: { name: '丰川祥子' }, other: { moodRecovery: 0.1 }, globalOperators: { DORMITORY: { moodRecovery: 0.05 } } },
]);
directGoldens.push({ type: 'CONTROL', description: '当与丰川祥子一起进驻控制中枢时，丰川祥子心情每小时消耗+0.05，会客室线索搜集速度额外提升+5%（同种效果取最高）', scenarios: [
  {}, { partner: { name: '丰川祥子' }, other: { moodCost: 0.05 }, global: { MEETING: { clueSpeed: 0.05 } } },
] });
for (const [text, production] of [['20', 0.2], ['3', 0.03]]) conditional('MANUFACTURE',
  `每个贸易站为当前制造站贵金属类配方的生产力+${text}%`, [
    { formulaId: '4', room: { production } }, { formulaId: '1' },
  ]);
for (const [speed, cap, value] of [['4', '20', 0.08], ['5', '25', 0.1]]) conditional('CONTROL',
  `基建内（不包含副手及活动室使用者）每有1名米诺斯干员，会客室线索搜集速度+${speed}%（最多+${cap}%，同种效果取最高）；当与萨尔贡干员进驻控制中枢一起工作时，自身心情每小时消耗+0.02`, [
    { global: { MEETING: { clueSpeed: 0 } } },
    { partners: [{ name: '帕拉斯', faction: '米诺斯', type: 'POWER' }, { name: '火神', faction: '米诺斯', type: 'MANUFACTURE' }], global: { MEETING: { clueSpeed: value } } },
    { partners: [{ name: '帕拉斯', faction: '米诺斯', type: 'POWER' }, { name: '火神', faction: '米诺斯', type: 'MANUFACTURE' }, { name: '泡泡', faction: '萨尔贡' }], global: { MEETING: { clueSpeed: value } }, self: { moodCost: 0.02 } },
  ]);
for (const [faction, count, speed, suffix, people, value] of [
  ['黑钢国际', '3', '2', '，心情每小时消耗-0.15', ['杰西卡', '香草'], 0.04],
  ['莱茵生命', '5', '3', '', ['赫默', '梅尔'], 0.06],
]) conditional('MANUFACTURE', `基建内（不包含副手及活动室使用者）每有1名${faction}干员（最多${count}名），贵金属类配方的生产力+${speed}%${suffix}`, [
  { formulaId: '4', room: { production: 0 }, self: suffix ? { moodCost: 0 } : {} },
  { formulaId: '4', partners: people.map((name, index) => ({ name, faction, type: index ? 'MEETING' : 'POWER' })), room: { production: value }, self: suffix ? { moodCost: -0.3 } : {} },
  { formulaId: '1', partners: people.map((name, index) => ({ name, faction, type: index ? 'MEETING' : 'POWER' })), self: suffix ? { moodCost: -0.3 } : {} },
]);
conditional('POWER', '无人机充能速度+10%，基建内（不包含副手及活动室使用者）每有1名除自身以外的莱茵生命干员（最多5名），充能速度额外+3%', [
  { room: { droneSpeed: 0.1 } },
  { partners: [{ name: '赫默', faction: '莱茵生命', type: 'MANUFACTURE' }, { name: '梅尔', faction: '莱茵生命', type: 'MEETING' }], room: { droneSpeed: 0.16 } },
]);
conditional('CONTROL', '每个存在3名谢拉格干员的贸易站，订单获取效率+10%', [
  {},
  { partners: [{ name: '银灰', faction: '谢拉格', instId: 4 }, { name: '初雪', faction: '谢拉格', instId: 3 }],
    assignment: { TRADING: [3, 4], MANUFACTURE: [] } },
  { partners: [{ name: '银灰', faction: '谢拉格', instId: 4 }, { name: '初雪', faction: '谢拉格', instId: 3 }, { name: '崖心', faction: '谢拉格', instId: 5 }],
    assignment: { TRADING: [3, 4, 5], MANUFACTURE: [], DORMITORY: [] }, global: { TRADING: { orderSpeed: 0.1 } } },
]);
for (const [percent, production] of [[5, 0.05], [10, 0.1]]) conditional('MANUFACTURE',
  `每有1台作业平台进驻发电站，贵金属类配方的生产力+${percent}%`, [
    { formulaId: '4', room: { production: 0 } },
    { formulaId: '4', partner: { name: 'Lancet-2', type: 'POWER' }, room: { production } },
    { formulaId: '3', partner: { name: 'Lancet-2', type: 'POWER' } },
  ]);
conditional('TRADING', '订单上限+3，且每有一个泡影国狩猎小队干员进驻贸易站，订单获取效率+20%', [
  { room: { capacity: 3, orderSpeed: 0 } },
  { partner: { name: '焰狐龙梓兰' }, room: { capacity: 3, orderSpeed: 0.2 } },
  { partner: { name: '焰狐龙梓兰', type: 'DORMITORY' }, room: { capacity: 3, orderSpeed: 0 } },
]);
conditional('CONTROL', '如果有2台以上作业平台进驻在发电站，则所有制造站生产力+2%（同种效果取最高）', [
  {},
  { partner: { name: 'Lancet-2', type: 'POWER' } },
  { assignment: { POWER: [5, 6], DORMITORY: [] },
    partners: [{ name: 'Lancet-2', instId: 5 }, { name: 'Castle-3', instId: 6 }],
    global: { MANUFACTURE: { production: 0.02 } } },
]);
conditional('POWER', '如果其他作业平台进驻在发电站，则无人机充能速度+5%', [
  {},
  { partner: { name: 'Lancet-2' }, room: { droneSpeed: 0.05 } },
]);
conditional('POWER', '如果其他发电站内没有进驻作业平台，则发电站额外+1(仅影响设施数量)', [
  { companionBuffs: { 4: ['manu_prod_spd&power[000]'] }, global: { MANUFACTURE: { production: 0.1 } },
    inactiveRooms: { MANUFACTURE: { production: 0.05 } } },
]);
conditional('CONTROL', '如果Lancet-2进驻在发电站，发电站额外+2（仅影响设施数量）', [
  { companionBuffs: { 3: ['manu_prod_spd&power[000]'] }, global: { MANUFACTURE: { production: 0.05 } } },
  { partner: { name: 'Lancet-2', type: 'POWER' }, companionBuffs: { 3: ['manu_prod_spd&power[000]'] }, global: { MANUFACTURE: { production: 0.15 } }, inactiveRooms: { MANUFACTURE: { production: 0.05 } } },
]);
conditional('DORMITORY', '基建内（不包含副手及活动室使用者）每名岁干员为该宿舍内所有干员心情每小时恢复速度+0.06（最多生效4名，且同种效果取最高）', [
  { self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
  { partner: { name: '年', faction: '炎-岁', type: 'POWER' }, self: { moodRecovery: 0.06 }, other: { moodRecovery: 0.06 } },
  { partners: [{ name: '年', faction: '炎-岁', type: 'POWER' }, { name: '夕', faction: '炎-岁', type: 'MEETING' }], self: { moodRecovery: 0.12 }, other: { moodRecovery: 0.12 } },
]);
conditional('TRADING', '基建内（不包含副手及活动室）每有一间进驻岁干员的设施，订单获取效率+4%（最多5间）', [
  { room: { orderSpeed: 0 } },
  { partner: { name: '年', faction: '炎-岁', type: 'POWER' }, room: { orderSpeed: 0.04 } },
  { partners: [{ name: '年', faction: '炎-岁', type: 'POWER' }, { name: '夕', faction: '炎-岁', type: 'MEETING' }], room: { orderSpeed: 0.08 } },
]);
conditional('MANUFACTURE', '当前制造站内干员提升的每格仓库容量，提供2%生产力', [
  { room: { production: 0 } },
  { companionBuffs: { 2: ['manu_prod_limit&cost[000]'] }, room: { capacity: 8, production: 0.16 }, other: { moodCost: -0.25 },
    inactiveRooms: { MANUFACTURE: { capacity: 8 } }, inactiveOperators: { 2: { moodCost: -0.25 } } },
]);
for (const [body, speed] of [
  ['当前贸易站内干员提升的每个订单上限，提供4%订单获取效率', 0.2],
  ['当前贸易站内干员提升的每5个订单上限，提供25%订单获取效率，最多提供100%效率', 0.25],
]) conditional('TRADING', body, [
  { room: { orderSpeed: 0 } },
  { companionBuffs: { 2: ['trade_ord_limit&cost[000]'] }, room: { capacity: 5, orderSpeed: speed }, other: { moodCost: -0.25 },
    inactiveRooms: { TRADING: { capacity: 5 } }, inactiveOperators: { 2: { moodCost: -0.25 } } },
]);
conditional('TRADING', '当前贸易站内其他干员提供的订单获取效率全部归零，且每人为自身+45%订单获取效率，同时全体心情每小时消耗+0.25', [
  { team: [1], room: { orderSpeed: 0 }, self: { moodCost: 0.25 } },
  { companionBuffs: { 2: ['trade_ord_spd&limit[000]'] }, room: { orderSpeed: 0.45, capacity: 2 }, self: { moodCost: 0.25 }, other: { moodCost: 0.25 },
    inactiveRooms: { TRADING: { orderSpeed: 0.1, capacity: 2 } } },
]);
for (const [body, first, pair] of [
  ['每个当前制造站内干员为当前制造站仓库容量上限+5', { capacity: 5 }, { capacity: 10 }],
  ['每个当前制造站内干员为当前制造站+10%生产力，仓库容量上限+5', { production: 0.1, capacity: 5 }, { production: 0.2, capacity: 10 }],
  ['每个发电站为当前制造站+5%的生产力', { production: 0.05 }, { production: 0.05 }],
  ['每个发电站为当前制造站+10%的生产力', { production: 0.1 }, { production: 0.1 }],
  ['每个发电站为当前制造站+15%的生产力', { production: 0.15 }, { production: 0.15 }],
]) conditional('MANUFACTURE', `当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），${body}`, [
  { team: [1], room: first },
  { companionBuffs: { 2: ['manu_prod_spd[000]'] }, room: pair, inactiveRooms: { MANUFACTURE: { production: 0.15 } } },
]);
for (const [body, buffId, formulaId, room, inactive] of [
  ['当前制造站内每个莱茵科技类技能为自身+5的仓库上限容量', 'manu_prod_spd[001]', undefined, { production: 0.15, capacity: 5 }, { production: 0.15 }],
  ['当前制造站内每个标准化类技能为自身+5%的生产力', 'manu_prod_spd[000]', undefined, { production: 0.2 }, { production: 0.15 }],
  ['当前制造站内每个莱茵科技类技能为自身+5%的生产力', 'manu_prod_spd[001]', undefined, { production: 0.2 }, { production: 0.15 }],
  ['当前制造站内每个金属工艺类技能为自身+5%的生产力', 'manu_formula_spd[100]', '4', { production: 0.35 }, { production: 0.3 }],
]) conditional('MANUFACTURE', body, [
  { room: body.includes('容量') ? { capacity: 0 } : { production: 0 } },
  { formulaId, companionBuffs: { 2: [buffId] }, room, inactiveRooms: { MANUFACTURE: inactive } },
]);
conditional('MANUFACTURE', '当前制造站内所有莱茵科技类、红松骑士团类技能也全都视作标准化类技能', [
  {},
  { companionBuffs: { 2: ['manu_prod_spd[001]', 'manu_skill_spd1[000]'] }, room: { production: 0.2 }, inactiveRooms: { MANUFACTURE: { production: 0.15 } } },
  { companionBuffs: { 2: ['manu_prod_spd[002]', 'manu_skill_spd1[000]'] }, room: { production: 0.2 }, inactiveRooms: { MANUFACTURE: { production: 0.15 } } },
]);
conditional('CONTROL', '人力办公室联络速度小于30%时（其中包含基础联络速度5%），则联络速度额外+20%（该加成全局效果唯一，不受其它加成影响）', [
  { global: { HIRE: { contactSpeed: 0.2 } } },
  { companionBuffs: { 8: ['hire_spd[000]'] }, global: { HIRE: { contactSpeed: 0.4 } }, inactiveRooms: { HIRE: { contactSpeed: 0.2 } } },
  { companionBuffs: { 8: ['hire_spd[010]'] }, global: { HIRE: { contactSpeed: 0.3 } }, inactiveRooms: { HIRE: { contactSpeed: 0.3 } } },
]);
for (const [text, capacity] of [['1', 1], ['2', 2]]) conditional('CONTROL',
  `当伊内丝入驻会客室时，会客室线索搜集速度+5%；当赫德雷入驻贸易站时，赫德雷所在贸易站订单上限+${text}`, [
    {}, { partner: { name: '伊内丝', type: 'MEETING' }, global: { MEETING: { clueSpeed: 0.05 } } },
    { partner: { name: '赫德雷', type: 'TRADING' }, global: { TRADING: { capacity } } },
    { partners: [{ name: '伊内丝', type: 'MEETING' }, { name: '赫德雷', type: 'TRADING' }], global: { MEETING: { clueSpeed: 0.05 }, TRADING: { capacity } } },
  ]);
conditional('CONTROL', '每个进驻在制造站的红松骑士团干员，作战记录类配方的生产力+10%，贵金属类配方的生产力-10%', [
  { formulas: { MANUFACTURE: '1' } },
  { partner: { name: '野鬃', faction: '红松骑士团', type: 'MANUFACTURE' }, formulas: { MANUFACTURE: '1' }, global: { MANUFACTURE: { production: 0.1 } } },
  { partner: { name: '野鬃', faction: '红松骑士团', type: 'MANUFACTURE' }, formulas: { MANUFACTURE: '4' }, global: { MANUFACTURE: { production: -0.1 } } },
  { partner: { name: '野鬃', faction: '红松骑士团', type: 'MANUFACTURE' }, formulas: { MANUFACTURE: '5' } },
]);
for (const [body, global] of [
  ['所有制造站生产力+2%', { MANUFACTURE: { production: 0.02 } }],
  ['所有贸易站订单效率+7%', { TRADING: { orderSpeed: 0.07 } }],
]) directGoldens.push({ type: 'CONTROL', description: `当与怪物猎人小队干员进驻控制中枢一起工作时，${body}（同种效果取最高）`, scenarios: [
  {},
  { partner: { name: '火龙S黑角' }, global },
  { partner: { name: '麒麟R夜刀' }, global },
  { partner: { name: '泰拉大陆调查团' }, global },
  { partner: { name: '黑角' } },
  { partner: { name: '夜刀' } },
  { partner: { name: '泰拉大陆调查团', type: 'DORMITORY' } },
] });
directGoldens.push({ type: 'CONTROL', description: '当与龙门近卫局干员进驻控制中枢一起工作时，所有制造站生产力+3%（同种效果取最高）', scenarios: [
  {}, { partner: { name: '陈', faction: '龙门近卫局' }, global: { MANUFACTURE: { production: 0.03 } } },
] });
for (const [name, capacity, cost] of [['德克萨斯', 2, -0.1], ['德克萨斯', 4, -0.1], ['能天使', undefined, -0.3], ['伺夜', 2, -0.1]]) {
  directGoldens.push({ type: 'TRADING', description: `当与${name}在同一个贸易站时，心情每小时消耗${cost}${capacity === undefined ? '' : `，订单上限+${capacity}`}`,
    scenarios: [{}, { partner: { name }, room: capacity === undefined ? {} : { capacity }, self: { moodCost: cost } }] });
}
directGoldens.push({ type: 'TRADING', description: '当与拉普兰德在同一个贸易站时，心情每小时消耗+0.3，订单获取效率+65%',
  scenarios: [{}, { partner: { name: '拉普兰德' }, room: { orderSpeed: 0.65 }, self: { moodCost: 0.3 } }] });
for (const [text, recovery] of [['0.05', 0.05], ['0.1', 0.1]]) {
  directGoldens.push({ type: 'CONTROL', description: `当与阿米娅一起进驻控制中枢时，自身和阿米娅心情每小时恢复+${text}`,
    scenarios: [{}, { partner: { name: '阿米娅' }, self: { moodRecovery: recovery }, other: { moodRecovery: recovery } }] });
}
directGoldens.push({ type: 'CONTROL', description: '当与阿进驻控制中枢一起工作时，控制中枢内所有干员心情每小时恢复+0.25',
  scenarios: [{}, { partner: { name: '阿' }, self: { moodRecovery: 0.25 }, other: { moodRecovery: 0.25 } }] });
conditional('TRADING', '订单获取效率+20%；当与能天使在同一个贸易站时，订单获取效率额外+25%', [
  { room: { orderSpeed: 0.2 } }, { partner: { name: '能天使' }, room: { orderSpeed: 0.45 } },
]);
conditional('POWER', '如果凯尔希进驻在控制中枢，则无人机充能速度+5%', [
  {}, { partner: { name: '凯尔希', type: 'CONTROL' }, room: { droneSpeed: 0.05 } },
]);
conditional('POWER', '无人机充能速度+15%，如果结城理进驻在制造站，则无人机充能速度额外+5%', [
  { room: { droneSpeed: 0.15 } }, { partner: { name: '结城理', type: 'MANUFACTURE' }, room: { droneSpeed: 0.2 } },
]);
conditional('POWER', '野鬃所在的制造站生产力+5%', [
  {}, { partner: { name: '野鬃', type: 'MANUFACTURE' }, global: { MANUFACTURE: { production: 0.05 } } },
]);
conditional('MEETING', '如果菲亚梅塔进驻在宿舍，则线索搜集速度额外提升10%', [
  {}, { partner: { name: '菲亚梅塔', type: 'DORMITORY' }, room: { clueSpeed: 0.1 } },
]);
conditional('HIRE', '人脉资源的联络速度+35%，心情每小时消耗-0.25，如果凛御银灰进驻在控制中枢，则人脉资源的联络速度额外+10%', [
  { room: { contactSpeed: 0.35 }, self: { moodCost: -0.25 } },
  { partner: { name: '凛御银灰', type: 'CONTROL' }, room: { contactSpeed: 0.45 }, self: { moodCost: -0.25 } },
]);
conditional('MEETING', '线索搜集速度提升10%，当与提丰进驻会客室一起工作时，线索搜集速度额外提升15%，自身心情每小时消耗+0.5', [
  { room: { clueSpeed: 0.1 } }, { partner: { name: '提丰' }, room: { clueSpeed: 0.25 }, self: { moodCost: 0.5 } },
]);
conditional('MEETING', '当与铃兰进驻会客室一起工作时，线索搜集速度额外提升30%', [
  {}, { partner: { name: '铃兰' }, room: { clueSpeed: 0.3 } },
]);
for (const [body, name, type, formulaId, production] of [
  ['若古米在贸易站，则作战记录类配方的生产力+35%', '古米', 'TRADING', '1', 0.35],
  ['当与温米在同一个制造站时，贵金属类配方的生产力+15%', '温米', 'MANUFACTURE', '4', 0.15],
  ['当与酒神在同一个制造站时，作战记录类配方的生产力+30%', '酒神', 'MANUFACTURE', '1', 0.3],
]) conditional('MANUFACTURE', body, [
  { formulaId }, { partner: { name, type }, formulaId, room: { production } },
  { partner: { name, type }, formulaId: '5' },
]);
for (const [faction, name] of [['龙门近卫局', '陈'], ['乌萨斯学生自治团', '古米'], ['谢拉格', '讯使'], ['彩虹小队', '战车']]) {
  conditional('CONTROL', `控制中枢内每个${faction}干员可使控制中枢内所有干员的心情每小时恢复+0.05`, [
    { self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
    { partner: { name, faction }, self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.05 } },
  ]);
}
for (const [body, type, name, faction, global, self = {}] of [
  ['自身心情每小时消耗+0.5；每个进驻在制造站的黑钢国际干员，生产力+5%', 'MANUFACTURE', '香草', '黑钢国际', { production: 0.05 }, { moodCost: 0.5 }],
  ['自身心情每小时消耗+0.5，每个进驻在会客室的乌萨斯学生自治团干员，线索搜集速度+10%', 'MEETING', '古米', '乌萨斯学生自治团', { clueSpeed: 0.1 }, { moodCost: 0.5 }],
  ['每个进驻在贸易站的谢拉格干员，订单获取效率-15%，订单上限+6', 'TRADING', '讯使', '谢拉格', { orderSpeed: -0.15, capacity: 6 }],
  ['同一贸易站中，每有1名格拉斯哥帮干员，订单获取效率+10%', 'TRADING', '摩根', '格拉斯哥帮', { orderSpeed: 0.1 }],
  ['每个进驻在贸易站的叙拉古干员，订单获取效率+5%', 'TRADING', '红云', '叙拉古', { orderSpeed: 0.05 }],
]) conditional('CONTROL', body, [
  { self }, { partner: { name, faction, type }, self, global: { [type]: global } },
]);
for (const [faction, name, extra, cost] of [['萨米', '远山', 0.05, 0.5], ['黑钢国际', '香草', 0.15, 0.5], ['黑钢国际', '香草', 0.2, undefined]]) {
  conditional('MEETING', `线索搜集速度提升10%，与其他${faction}干员进驻会客室一起工作时，线索搜集速度额外提升${extra * 100}%${cost === undefined ? '' : '，自身心情每小时消耗+0.5'}`, [
    { room: { clueSpeed: 0.1 } }, { partner: { name, faction }, room: { clueSpeed: 0.1 + extra }, self: cost === undefined ? {} : { moodCost: cost } },
  ]);
}
conditional('MANUFACTURE', '作战记录类配方的生产力+30%，当与乌萨斯学生自治团干员在同一个制造站时，作战记录类配方的生产力额外+10%', [
  { formulaId: '1', room: { production: 0.3 } },
  { formulaId: '1', partner: { name: '古米', faction: '乌萨斯学生自治团' }, room: { production: 0.4 } },
  { formulaId: '4', partner: { name: '古米', faction: '乌萨斯学生自治团' } },
]);
conditional('TRADING', '同个贸易站中每有1名拉特兰干员，当前贸易站订单获取效率+15%', [
  { room: { orderSpeed: 0 } }, { partner: { name: '翎羽', faction: '拉特兰' }, room: { orderSpeed: 0.15 } },
]);
conditional('TRADING', '订单获取效率+30%；当前贸易站内存在格拉斯哥帮干员时，订单获取效率额外+10%', [
  { room: { orderSpeed: 0.3 } }, { partner: { name: '摩根', faction: '格拉斯哥帮' }, room: { orderSpeed: 0.4 } },
]);
conditional('TRADING', '同个贸易站中每有1名格拉斯哥帮干员，当前贸易站订单获取效率+20%；当与推进之王在同一个贸易站时，订单获取效率额外+35%', [
  { room: { orderSpeed: 0 } }, { partner: { name: '摩根', faction: '格拉斯哥帮' }, room: { orderSpeed: 0.2 } },
  { partner: { name: '推进之王', faction: '格拉斯哥帮' }, room: { orderSpeed: 0.55 } },
]);
conditional('POWER', '如果其他拉特兰干员进驻在发电站，则无人机充能速度+5%', [
  {}, { partner: { name: '翎羽', faction: '拉特兰' }, room: { droneSpeed: 0.05 } },
]);
conditional('DORMITORY', '该宿舍内所有干员的心情每小时恢复+0.15，如果目标是莱欧斯小队干员，则恢复效果额外+0.15（同种效果取最高）', [
  { self: { moodRecovery: 0.15 }, other: { moodRecovery: 0.15 } },
  { partner: { name: '莱欧斯', faction: '莱欧斯小队' }, self: { moodRecovery: 0.15 }, other: { moodRecovery: 0.3 } },
]);
conditional('CONTROL', '所有宿舍内所有干员的心情每小时恢复+0.05（同种效果取最高）', [
  { globalOperators: { DORMITORY: { moodRecovery: 0.05 } } },
]);
for (const [text, clueSpeed, cost] of [['35', 0.35, undefined], ['50', 0.5, 2], ['15', 0.15, 1], ['35', 0.35, 1]]) {
  conditional('MEETING', `如果会客室内只有自身处于工作状态时，线索搜集速度提升${text}%${cost === undefined ? '' : `，心情每小时消耗+${cost}`}`, [
    { team: [1], room: { clueSpeed }, self: cost === undefined ? {} : { moodCost: cost } }, { team: [1, 2] },
  ]);
}
conditional('MANUFACTURE', '生产力+30%，自身每有4点心情落差，生产力-5%', [
  { ap: { 1: 8640000 }, room: { production: 0.3 } },
  { ap: { 1: 7200001 }, room: { production: 0.3 } },
  { ap: { 1: 7200000 }, room: { production: 0.25 } },
  { ap: { 1: 4320000 }, room: { production: 0.15 } },
]);
conditional('MANUFACTURE', '当前制造站内干员根据自身提升的仓库容量提供一定的生产力。提升16格以下的，每格仓库容量提供1%生产力；提升大于16格的，每格仓库容量提供3%生产力（无法与回收利用叠加，且优先生效）', [
  { room: { production: 0 } },
  { companionBuffs: { 2: ['manu_prod_limit&cost[020]'] }, room: { capacity: 16, production: 0.16 }, other: { moodCost: -0.25 } },
  { companionBuffs: { 2: ['manu_prod_spd&limit&cost[020]'] }, room: { capacity: 17, production: 0.31 }, other: { moodCost: -0.25 } },
  { companionBuffs: { 2: ['manu_prod_spd&limit&cost[001]', 'manu_prod_spd_variable[000]'] },
    room: { capacity: 19, production: 0.52 }, other: { moodCost: -0.25 },
    inactiveRooms: { MANUFACTURE: { capacity: 19, production: 0.33 } }, inactiveOperators: { 2: { moodCost: -0.25 } } },
]);
conditional('MANUFACTURE', '当自身心情落差大于12时，生产力+10%，仓库容量+6', [
  { ap: { 1: 4320001 } }, { ap: { 1: 4320000 } },
  { ap: { 1: 4319999 }, room: { production: 0.1, capacity: 6 } },
]);
conditional('DORMITORY', '使心情未满的宿舍成员，平均分配到总计每小时心情恢复+0.8的加成（该技能对单名干员和多名干员生效时，同种效果分别取最高）', [
  { ap: { 1: 8640000, 2: 8640000 } },
  { ap: { 1: 8640000 }, other: { moodRecovery: 0.8 } },
  { ap: { 2: 8640000 }, self: { moodRecovery: 0.8 } },
  { self: { moodRecovery: 0.4 }, other: { moodRecovery: 0.4 } },
]);
conditional('DORMITORY', '该宿舍内所有干员的心情每小时恢复+0.2；同时该宿舍每有1名心情未满的干员，则恢复效果额外+0.01（同种效果取最高）', [
  { ap: { 1: 8640000, 2: 8640000 }, self: { moodRecovery: 0.2 }, other: { moodRecovery: 0.2 } },
  { ap: { 1: 8640000 }, self: { moodRecovery: 0.21 }, other: { moodRecovery: 0.21 } },
  { self: { moodRecovery: 0.22 }, other: { moodRecovery: 0.22 } },
]);
conditional('DORMITORY', '自身心情每小时恢复+0.7；如果该宿舍内有其他干员，则每人额外为自身心情每小时恢复+0.05', [
  { team: [1], self: { moodRecovery: 0.7 } }, { self: { moodRecovery: 0.75 } },
]);
conditional('DORMITORY', '该宿舍内所有干员的心情每小时恢复+0.15，同时当前宿舍每级为恢复效果额外+0.02（叠加后的最终值同种效果取最高）', [
  { levels: { DORMITORY: 1 }, self: { moodRecovery: 0.17 }, other: { moodRecovery: 0.17 } },
  { levels: { DORMITORY: 5 }, self: { moodRecovery: 0.25 }, other: { moodRecovery: 0.25 } },
]);
for (const [text, speed, low, high] of [['20', 0.2, -2, -2], ['25', 0.25, -5, -6]]) {
  conditional('TRADING', `订单获取效率+${text}%，且订单上限${text === '20' ? '-2' : '-6'}（订单最少为1）`, [
    { levels: { TRADING: 1 }, room: { orderSpeed: speed, capacity: low } },
    { levels: { TRADING: 3 }, room: { orderSpeed: speed, capacity: high } },
  ]);
}
conditional('TRADING', '当前贸易站每级+1个订单上限', [
  { room: { capacity: 1 } }, { levels: { TRADING: 3 }, room: { capacity: 3 } },
]);
for (const [text, orderSpeed] of [['15', 0.15], ['10', 0.1], ['20', 0.2]]) {
  conditional('TRADING', `贸易站内除自身以外每名处于工作状态的干员+${text}%订单获取效率`, [
    { team: [1], room: { orderSpeed: 0 } }, { room: { orderSpeed } },
  ]);
}
for (const [name, formulaId, values] of [
  ['作战记录', '1', [['20', 0.2], ['25', 0.25], ['30', 0.3], ['35', 0.35]]],
  ['贵金属', '4', [['30', 0.3], ['35', 0.35]]],
  ['源石', '13', [['30', 0.3], ['35', 0.35]]],
]) {
  for (const [text, production] of values) conditional('MANUFACTURE', `${name}类配方的生产力+${text}%`, [
    { formulaId, room: { production } }, { formulaId: '5' },
  ]);
}
for (const [body, formulaId, production, moodCost] of [
  ['贵金属类配方的生产力+25%，心情每小时消耗+0.25', '4', 0.25, 0.25],
  ['作战记录类配方的生产力+20%，心情每小时消耗-0.25', '1', 0.2, -0.25],
  ['作战记录类配方的生产力+35%，心情每小时消耗-0.25', '1', 0.35, -0.25],
  ['作战记录类配方的生产力+35%，心情每小时消耗+0.25', '1', 0.35, 0.25],
]) conditional('MANUFACTURE', body, [
  { formulaId, room: { production }, self: { moodCost } }, { formulaId: '5', self: { moodCost } },
]);
conditional('MANUFACTURE', '生产作战记录类配方时，心情每小时消耗-0.25', [
  { formulaId: '1', self: { moodCost: -0.25 } }, { formulaId: '4' },
]);
for (const [text, capacity] of [['4', 4], ['12', 12], ['15', 15]]) {
  conditional('MANUFACTURE', `生产作战记录类配方时，仓库容量上限+${text}`, [
    { formulaId: '1', room: { capacity } }, { formulaId: '4' },
  ]);
}
conditional('DORMITORY', '基建内（不包含副手及活动室使用者）每名行医干员为该宿舍内所有干员心情每小时恢复速度+0.06（最多生效4名，且同种效果取最高）', [
  { self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
  { partner: { name: '纯烬艾雅法拉' }, self: { moodRecovery: 0.06 }, other: { moodRecovery: 0.06 } },
  { partner: { name: '桑葚' }, self: { moodRecovery: 0.06 }, other: { moodRecovery: 0.06 } },
  { partner: { name: '芙蓉' }, self: { moodRecovery: 0 }, other: { moodRecovery: 0 } },
]);
conditional('MANUFACTURE', '当前制造站内每个A1小队干员为自身+10%的生产力', [
  { room: { production: 0 } },
  { partner: { name: '芬', faction: '行动预备组A1' }, room: { production: 0.1 } },
  { partner: { name: '米格鲁', faction: '行动预备组A1' }, room: { production: 0.1 } },
  { partner: { name: '克洛丝', faction: '行动预备组A1' }, room: { production: 0.1 } },
  { partner: { name: '黑角', faction: '行动组A4' }, room: { production: 0 } },
]);
conditional('MANUFACTURE', '训练室每级为当前制造站+10%生产力，最多30%', [
  { room: { production: 0 } }, { trainingLevel: 1, room: { production: 0.1 } },
  { trainingLevel: 2, room: { production: 0.2 } }, { trainingLevel: 3, room: { production: 0.3 } },
]);
for (const [body, initial, third] of [
  ['订单获取效率+25%，会客室每级额外提供5%获取效率，最多提供40%效率', 0.3, 0.4],
  ['订单获取效率+15%，会客室每级额外提供5%获取效率，最多提供30%效率', 0.2, 0.3],
]) conditional('TRADING', body, [
  { levels: { MEETING: 1 }, room: { orderSpeed: initial } },
  { levels: { MEETING: 3 }, room: { orderSpeed: third } },
]);
for (const [body, first, second, third] of [
  ['该宿舍内所有干员心情每小时恢复+0.15，同时每个招募位（不包含初始招募位）额外+0.05恢复效果（叠加后的最终值同种效果取最高）', 0.15, 0.2, 0.25],
  ['该宿舍内所有干员心情每小时恢复+0.1，同时每个招募位（不包含初始招募位）额外+0.05恢复效果（叠加后的最终值同种效果取最高）', 0.1, 0.15, 0.2],
  ['该宿舍内所有干员心情每小时恢复+0.1，同时每个招募位（不包含初始招募位）额外+0.1恢复效果（叠加后的最终值同种效果取最高）', 0.1, 0.2, 0.3],
]) conditional('DORMITORY', body, [[1, first], [2, second], [3, third]].map(([level, moodRecovery]) => ({
  levels: { HIRE: level }, self: { moodRecovery }, other: { moodRecovery },
})));
conditional('HIRE', '每个招募位（不包含初始招募位）+10%人脉资源的联络速度', [
  { levels: { HIRE: 1 }, room: { contactSpeed: 0 } },
  { levels: { HIRE: 2 }, room: { contactSpeed: 0.1 } },
  { levels: { HIRE: 3 }, room: { contactSpeed: 0.2 } },
]);
conditional('HIRE', '人脉资源的联络速度+35%，同时每个招募位（不包含初始招募位）使心情每小时消耗-0.1', [
  { levels: { HIRE: 1 }, room: { contactSpeed: 0.35 }, self: { moodCost: 0 } },
  { levels: { HIRE: 3 }, room: { contactSpeed: 0.35 }, self: { moodCost: -0.2 } },
]);
conditional('MEETING', '每个招募位（不包含初始招募位）提升5%线索搜集速度', [
  { levels: { HIRE: 1 }, room: { clueSpeed: 0 } }, { levels: { HIRE: 3 }, room: { clueSpeed: 0.1 } },
]);
for (const step of [4, 2]) {
  conditional('TRADING', `订单获取效率+5%，每有${step}条赤金生产线，则当前贸易站订单获取效率额外+15%`, [
    { formulas: { MANUFACTURE: '4' }, room: { orderSpeed: 0.05 } },
    { formulas: { MANUFACTURE: '1' }, room: { orderSpeed: 0.05 } },
  ]);
  conditional('TRADING', `订单获取效率+5%，每有${step}条赤金生产线，则为当前贸易站额外提供2条赤金生产线`, [
    { formulas: { MANUFACTURE: '4' }, room: { orderSpeed: 0.05 } },
    { formulas: { MANUFACTURE: '1' }, room: { orderSpeed: 0.05 } },
  ]);
}
conditional('TRADING', '每有1条赤金生产线，则当前贸易站订单获取效率+5%', [
  { formulas: { MANUFACTURE: '4' }, room: { orderSpeed: 0.05 } },
  { formulas: { MANUFACTURE: '1' }, room: { orderSpeed: 0 } },
]);
conditional('TRADING', '订单获取效率+30%，制造站每有1类配方进行加工，则当前贸易站订单获取效率额外+2%', [
  { formulas: { MANUFACTURE: '4' }, room: { orderSpeed: 0.32 } },
  { formulas: { MANUFACTURE: '1' }, room: { orderSpeed: 0.32 } },
]);
conditional('TRADING', '基建内（不包含副手及活动室使用者）每1名杜林族干员（最多4名）为当前贸易站提供1条赤金生产线', [
  { formulas: { MANUFACTURE: '4' }, companionBuffs: { 2: ['trade_ord_spd&gold[100]'] }, room: { orderSpeed: 0.05 }, inactiveRooms: { TRADING: { orderSpeed: 0.05 } } },
  { formulas: { MANUFACTURE: '4' }, partner: { name: '杜林', type: 'DORMITORY' }, companionBuffs: { 2: ['trade_ord_spd&gold[100]'] }, room: { orderSpeed: 0.1 }, inactiveRooms: { TRADING: { orderSpeed: 0.05 } } },
]);

conditional('CONTROL', '每有1个深海猎人干员进驻在宿舍以外的设施，则自身心情每小时消耗+0.5；反之则自身心情每小时恢复+0.5，如果进驻在宿舍内的深海猎人干员为满心情，则额外+0.5', [
  { partner: { name: '斯卡蒂' }, self: { moodCost: 0.5 } },
  { partner: { name: '斯卡蒂', type: 'DORMITORY' }, self: { moodCost: -0.5 } },
  { partner: { name: '斯卡蒂', type: 'DORMITORY' }, ap: { 5: 8640000 }, self: { moodCost: -1 } },
]);
conditional('CONTROL', '控制中枢内所有干员的心情每小时恢复+0.05；基建内（不包含副手及活动室使用者）深海猎人干员获得特殊加成（与部分技能有特殊叠加规则）', [
  { self: { moodRecovery: 0.05 }, other: { moodRecovery: 0.05 } },
]);

for (const [text, contactSpeed] of [['30', 0.3], ['35', 0.35]]) conditional('HIRE',
  `人脉资源的联络速度+${text}%，同时每个招募位（不包含初始招募位）额外+5%会客室线索搜集速度`, [
    { levels: { HIRE: 1 }, room: { contactSpeed }, global: { MEETING: { clueSpeed: 0 } } },
    { levels: { HIRE: 3 }, room: { contactSpeed }, global: { MEETING: { clueSpeed: 0.1 } } },
  ]);
