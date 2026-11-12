import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCatalog, unlockedBuffs, coverageInventory } from '../../src/data/catalog.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const fixture = () => ({
  chars: { new_operator: { charId: 'new_operator', maxManpower: 8640000, buffChar: [
    { buffData: [
      { buffId: 'base', cond: { phase: 0, level: 1 } },
      { buffId: 'upgraded', cond: { phase: 1, level: 50 } },
    ] },
    { buffData: [{ buffId: 'secondary', cond: { phase: 2, level: 1 } }] },
  ] } },
  buffs: Object.fromEntries(['base', 'upgraded', 'secondary', 'unused'].map(buffId => [buffId, {
    buffId, roomType: 'MANUFACTURE', description: 'synthetic effect', efficiency: 0,
  }])),
  rooms: { MANUFACTURE: { phases: [{ maxStationedNum: 1, manpowerCost: 100 }] } },
  manufactFormulas: { '4': { requireRooms: [{ roomId: 'MANUFACTURE', roomLevel: 1 }] } },
  manpowerDisplayFactor: 360000, tiredApThreshold: 100, comfortLimit: 5000,
});
async function directory(t, data = fixture()) {
  const root = resolve(workspace, '../.tmp/scheduling-validation');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(resolve(root, 'catalog-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(resolve(dir, 'excel'));
  const bytes = JSON.stringify(data);
  await writeFile(resolve(dir, 'excel/building_data.json'), bytes);
  return { dir, pin: { commit: '1'.repeat(40), buildingSha256: createHash('sha256').update(bytes).digest('hex') } };
}
test('新charId复用已有buff自动解锁；精英升级后的低等级不倒退技能', async t => {
  const { dir, pin } = await directory(t);
  const catalog = await loadCatalog(dir, pin);
  const ids = (evolvePhase, level) => unlockedBuffs(catalog, { charId: 'new_operator', evolvePhase, level }).map(b => b.buffId);
  assert.deepEqual(ids(0, 50), ['base']);
  assert.deepEqual(ids(1, 49), ['base']);
  assert.deepEqual(ids(1, 50), ['upgraded']);
  assert.deepEqual(ids(2, 1), ['upgraded', 'secondary']);
  assert.throws(() => { catalog.chars.new_operator.maxManpower = 1; }, TypeError);
});
test('可选角色表经独立散列校验后提供姓名，不按角色ID硬编码组合', async t => {
  const data = fixture();
  data.chars.future_operator = { charId: 'future_operator', maxManpower: 8640000, buffChar: [] };
  const { dir, pin } = await directory(t, data);
  const bytes = JSON.stringify({ new_operator: { name: '测试角色' }, future_operator: { name: '未来角色' },
    trap_copy: { name: '测试角色' } });
  const characterSha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(dir, 'excel/character_table.json'), bytes);
  const catalog = await loadCatalog(dir, { ...pin, characterSha256 });
  assert.equal(catalog.characterNames.new_operator, '测试角色');
  assert.equal(catalog.characterNames.future_operator, '未来角色');
  assert.equal(catalog.characterNames.trap_copy, undefined);
  assert.equal(catalog.version.characterSha256, characterSha256);
  await assert.rejects(loadCatalog(dir, { ...pin, characterSha256: '0'.repeat(64) }), { code: 'DATA_NOT_READY' });
  await assert.rejects(loadCatalog(dir, { ...pin, characterSha256: 'invalid' }), { code: 'DATA_NOT_READY' });
});

test('锁定阵营表按角色国籍组织小队关联，未知标签和坏版本不能激活', async t => {
  const { dir, pin } = await directory(t);
  const characters = { new_operator: { name: '新角色', nationId: 'sami', groupId: 'blacksteel', teamId: null } };
  const teams = { sami: { powerId: 'sami', powerName: '萨米' }, blacksteel: { powerId: 'blacksteel', powerName: '黑钢国际' } };
  const save = async (name, value) => {
    const bytes = JSON.stringify(value);
    await writeFile(resolve(dir, `excel/${name}.json`), bytes);
    return createHash('sha256').update(bytes).digest('hex');
  };
  const characterSha256 = await save('character_table', characters);
  const teamSha256 = await save('handbook_team_table', teams);
  const fullPin = { ...pin, characterSha256, teamSha256 };
  const catalog = await loadCatalog(dir, fullPin);
  assert.deepEqual(catalog.characterAffiliations.new_operator, ['萨米', '黑钢国际']);
  assert.throws(() => catalog.characterAffiliations.new_operator.push('伪造阵营'), TypeError);
  await assert.rejects(loadCatalog(dir, { ...fullPin, teamSha256: '0'.repeat(64) }), { code: 'DATA_NOT_READY' });
  await assert.rejects(loadCatalog(dir, { ...pin, teamSha256 }), { code: 'DATA_NOT_READY' });
  characters.new_operator.groupId = 'missing';
  await assert.rejects(loadCatalog(dir, { ...fullPin, characterSha256: await save('character_table', characters) }), { code: 'DATA_NOT_READY' });
  assert.deepEqual(catalog.characterAffiliations.new_operator, ['萨米', '黑钢国际']);
});

test('锁定角色分支区分行医与普通医疗，不从职业大类猜测', async () => {
  const { dataPin } = await import('../../src/data/pin.mjs');
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), dataPin);
  assert.equal(catalog.characterSubProfessions.char_1016_agoat2, 'wandermedic');
  assert.equal(catalog.characterSubProfessions.char_285_medic2, 'physician');
  assert.throws(() => { catalog.characterSubProfessions.char_285_medic2 = 'wandermedic'; }, TypeError);
});

test('作业平台成员来自散列锁定术语表，坏引用或坏版本不能激活', async t => {
  const { dir, pin } = await directory(t);
  const save = async (name, data) => {
    const bytes = JSON.stringify(data);
    await writeFile(resolve(dir, `excel/${name}.json`), bytes);
    return createHash('sha256').update(bytes).digest('hex');
  };
  const characterSha256 = await save('character_table', { new_operator: { name: '未来平台' } });
  const terms = { termDescriptionDict: { 'cc.tag.op': {
    termId: 'cc.tag.op', termName: '作业平台', description: '包含以下干员\n未来平台',
  } } };
  const constSha256 = await save('gamedata_const', terms);
  const fullPin = { ...pin, characterSha256, constSha256 };
  const catalog = await loadCatalog(dir, fullPin);
  assert.deepEqual(catalog.operatorGroups['cc.tag.op'], ['new_operator']);
  assert.equal(catalog.version.constSha256, constSha256);
  assert.throws(() => catalog.operatorGroups['cc.tag.op'].push('other'), TypeError);
  await assert.rejects(loadCatalog(dir, { ...fullPin, constSha256: '0'.repeat(64) }), { code: 'DATA_NOT_READY' });
  await assert.rejects(loadCatalog(dir, { ...pin, constSha256 }), { code: 'DATA_NOT_READY' });
  for (const description of ['包含以下干员\n不存在', '包含以下干员\n', '包含以下干员\n未来平台、未来平台', '其它格式']) {
    terms.termDescriptionDict['cc.tag.op'].description = description;
    await assert.rejects(loadCatalog(dir, { ...fullPin, constSha256: await save('gamedata_const', terms) }), { code: 'DATA_NOT_READY' });
  }
  assert.deepEqual(catalog.operatorGroups['cc.tag.op'], ['new_operator']);
});

test('怪物猎人小队由锁定术语成员解析而非角色阵营推断', async () => {
  const { dataPin } = await import('../../src/data/pin.mjs');
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), dataPin);
  assert.deepEqual(catalog.operatorGroups['cc.tag.mh'], ['char_1030_noirc2', 'char_1029_yato2', 'char_4077_palico']);
  assert.throws(() => catalog.operatorGroups['cc.tag.mh'].push('other'), TypeError);
});

test('泡影国狩猎小队按锁定术语加载成员，不借用怪物猎人小队', async () => {
  const { dataPin } = await import('../../src/data/pin.mjs');
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), dataPin);
  assert.deepEqual(catalog.operatorGroups['cc.tag.mh2']?.map(id => catalog.characterNames[id]),
    ['焰狐龙梓兰', '雷狼龙S空爆', '罗德岛隐秘队']);
});

test('S.E.E.S.身份取锁定术语成员，不由角色阵营推断', async () => {
  const { dataPin } = await import('../../src/data/pin.mjs');
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), dataPin);
  assert.deepEqual(catalog.operatorGroups['cc.tag.sees']?.map(id => catalog.characterNames[id]),
    ['结城理', '埃癸斯', '岳羽由加莉', '虎狼丸']);
});

test('精英干员取锁定术语成员而非精英化等级', async () => {
  const { dataPin } = await import('../../src/data/pin.mjs');
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), dataPin);
  assert.deepEqual(catalog.operatorGroups['cc.g.elite']?.map(id => catalog.characterNames[id]),
    ['迷迭香', '煌', '逻各斯', '烛煌', '电弧', '真言', '机械师']);
});

test('异格身份只读锁定角色布尔字段，不依赖ID后缀、姓名或阵营', async t => {
  const data = fixture();
  data.chars.future_alter = { charId: 'future_alter', maxManpower: 8640000, buffChar: [] };
  const { dir, pin } = await directory(t, data);
  const characters = { new_operator: { name: '带2也不是异格2', isSpChar: false },
    future_alter: { name: '未来异格', isSpChar: true }, summon: { name: '召唤物', isSpChar: true } };
  const load = async () => {
    const bytes = JSON.stringify(characters);
    await writeFile(resolve(dir, 'excel/character_table.json'), bytes);
    return loadCatalog(dir, { ...pin, characterSha256: createHash('sha256').update(bytes).digest('hex') });
  };
  const catalog = await load();
  assert.deepEqual(catalog.operatorGroups['cc.g.sp'], ['future_alter']);
  assert.throws(() => catalog.operatorGroups['cc.g.sp'].push('new_operator'), TypeError);
  characters.future_alter.isSpChar = 'true';
  await assert.rejects(load(), { code: 'DATA_NOT_READY' });
  delete characters.future_alter.isSpChar;
  assert.equal((await load()).operatorGroups['cc.g.sp'], undefined);
  characters.future_alter.isSpChar = false;
  assert.deepEqual((await load()).operatorGroups['cc.g.sp'], []);
  assert.deepEqual(catalog.operatorGroups['cc.g.sp'], ['future_alter']);
});

test('真实异格名单区分原版和异格，覆盖新旧持有人', async () => {
  const { dataPin } = await import('../../src/data/pin.mjs');
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), dataPin);
  const names = catalog.operatorGroups['cc.g.sp']?.map(id => catalog.characterNames[id]);
  for (const name of ['炎狱炎熔', '寒芒克洛丝', '濯尘芙蓉', '浊心斯卡蒂', '赤刃明霄陈']) assert.ok(names?.includes(name), name);
  for (const name of ['炎熔', '克洛丝', '芙蓉', '斯卡蒂', '陈']) assert.ok(!names?.includes(name), name);
});

test('角色表缺少已有干员或姓名为空不能激活', async t => {
  const { dir, pin } = await directory(t);
  for (const data of [{}, { new_operator: { name: '' } }]) {
    const bytes = JSON.stringify(data);
    await writeFile(resolve(dir, 'excel/character_table.json'), bytes);
    await assert.rejects(loadCatalog(dir, { ...pin, characterSha256: createHash('sha256').update(bytes).digest('hex') }), { code: 'DATA_NOT_READY' });
  }
});

test('文件散列不匹配时拒绝激活，不信任声明的版本号', async t => {
  const { dir, pin } = await directory(t);
  await assert.rejects(loadCatalog(dir, { ...pin, buildingSha256: '0'.repeat(64) }), { code: 'DATA_NOT_READY' });
});
test('有散列但坏JSON或悬空buff引用仍拒绝', async t => {
  const broken = fixture(); broken.chars.new_operator.buffChar[0].buffData[0].buffId = 'missing';
  const { dir, pin } = await directory(t, broken);
  await assert.rejects(loadCatalog(dir, pin), { code: 'DATA_NOT_READY' });
  const bytes = '{bad json';
  await writeFile(resolve(dir, 'excel/building_data.json'), bytes);
  await assert.rejects(loadCatalog(dir, { ...pin, buildingSha256: createHash('sha256').update(bytes).digest('hex') }), { code: 'DATA_NOT_READY' });
});
test('离线升级与回滚不污染旧目录或已加载目录，坏版本不会替换可用数据', async t => {
  const original = fixture();
  original.buffs.base.description = '进驻制造站时，生产力+25%';
  const old = await directory(t, original);
  const before = await loadCatalog(old.dir, old.pin);
  const nextData = structuredClone(original);
  nextData.buffs.base.description = '进驻制造站时，生产力+40%';
  nextData.chars.future_operator = { ...structuredClone(nextData.chars.new_operator), charId: 'future_operator' };
  const next = await directory(t, nextData);
  next.pin.commit = '2'.repeat(40);
  const upgraded = await loadCatalog(next.dir, next.pin);
  assert.equal(upgraded.buffs.base.description, '进驻制造站时，生产力+40%');
  assert.equal(unlockedBuffs(upgraded, { charId: 'future_operator', evolvePhase: 0, level: 1 })[0].buffId, 'base');
  await assert.rejects(loadCatalog(next.dir, old.pin), { code: 'DATA_NOT_READY' });
  await writeFile(resolve(next.dir, 'excel/building_data.json'), '{broken');
  await assert.rejects(loadCatalog(next.dir, next.pin), { code: 'DATA_NOT_READY' });
  assert.equal(before.buffs.base.description, '进驻制造站时，生产力+25%');
  assert.equal(upgraded.buffs.base.description, '进驻制造站时，生产力+40%');
  const restored = await loadCatalog(old.dir, old.pin);
  assert.deepEqual(restored, before);
  assert.equal(Object.hasOwn(restored.chars, 'future_operator'), false);
});

test('覆盖母集包含未持有技能，不能把未实现条目算成支持', async t => {
  const { dir, pin } = await directory(t);
  const rows = coverageInventory(await loadCatalog(dir, pin));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.status === 'unreviewed'));
  assert.deepEqual(rows.find(row => row.buffId === 'upgraded').unlocks, [{ charId: 'new_operator', slot: 0, phase: 1, level: 50 }]);
  assert.deepEqual(rows.find(row => row.buffId === 'unused').unlocks, []);
});
test('只读锁定本地真实数据：429名角色、七类542条机制母集', async () => {
  const catalog = await loadCatalog(resolve(workspace, 'data/ArknightsGamedataPure'), {
    commit: 'dfc70c5a7aaebe5ca81790ac318e1fabe496ce0b',
    buildingSha256: '4844b7b14ade9c44c430ab3d24b14016735b0b81c521c025dca637a9ea1e08f3',
  });
  assert.equal(Object.keys(catalog.chars).length, 429);
  assert.equal(coverageInventory(catalog).length, 542);
  assert.deepEqual(unlockedBuffs(catalog, { charId: 'char_501_durin', evolvePhase: 0, level: 30 }).map(b => b.buffId), ['dorm_rec_all&oneself[001]']);
});
