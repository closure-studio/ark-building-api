import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createSchedulingService } from '../../src/runtime/service.mjs';
import { syntheticPlayer, dataPin } from '../fixtures/player.mjs';
import { baseLayout } from '../fixtures/base-layout.mjs';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';

const dataDirectory = fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url));
async function setup(t, options = {}) {
  const service = await createSchedulingService({ dataDirectory, pin: dataPin, ...options });
  t.after(() => service.close());
  const address = await service.listen();
  // 系统分配的临时端口可能落入fetch的浏览器禁用端口表，测试使用原生HTTP。
  return input => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${address.port}/api/v1/arrange`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(input));
  });
}
test('HTTP可执行七类安排保留完整PlayerData的受保护岗位且不泄漏无关字段', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_285_medic2', 'char_286_cast3', 'char_126_shotst']);
  Object.assign(input, {
    status: { uid: 'synthetic-private-marker', nickName: 'synthetic-private-marker' },
    inventory: { synthetic: 999 }, social: { friends: ['synthetic-private-marker'] },
    dungeon: {}, mission: {}, shop: {}, recruit: {}, skin: {}, equipment: {},
  });
  input.building.roomSlots.train = { roomId: 'TRAINING', level: 3, state: 2, charInstIds: [1] };
  input.building.rooms.TRAINING = { train: { trainer: { charInstId: 1 }, trainee: { charInstId: -1 } } };
  input.building.chars[1].roomSlotId = 'train';
  input.building.roomSlots.work = { roomId: 'WORKSHOP', level: 3, state: 2, charInstIds: [3] };
  input.building.chars[3].roomSlotId = 'work';
  for (const [type, level] of [['PRIVATE', 3], ['ELEVATOR', 1], ['CORRIDOR', 1]]) {
    input.building.roomSlots[type] = { roomId: type, level, state: 2, charInstIds: [] };
  }
  input.building.roomSlots.m.level = 3;
  const before = structuredClone(input);
  const { status, body } = await post(input);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(Object.keys(body.data.arranged).sort(), ['Control', 'Dormitory', 'Hire', 'Manufacture', 'Meeting', 'Power', 'Trading']);
  assert.equal(body.preview, undefined);
  assert.equal(body.diagnostics.compatibility, 'arkhost-assignment-v1');
  assert.deepEqual(body.diagnostics.blockers, []);
  assert.equal(body.diagnostics.scope, 'single-arrangement');
  assert.equal(body.diagnostics.gameExecutionVerified, false);
  const rooms = Object.values(body.data.arranged).flat();
  assert.deepEqual(rooms.map(room => room.Slot).sort(), ['d', 'm']);
  const manufacture = body.data.arranged.Manufacture[0];
  assert.equal(manufacture.CharNum, 3);
  assert.deepEqual(manufacture.RoomChar.map(char => char.Inst.Inst), [2]);
  for (const room of rooms) {
    for (const field of ['ExtraScore', 'ProdSpeed', 'ApCost', 'RawCap']) assert.equal(room[field], undefined);
    for (const char of room.RoomChar) {
      assert.ok(char?.Inst && Number.isSafeInteger(char.Inst.Inst));
      assert.equal(char.ApCost, undefined);
      assert.equal(char.Inst.Buffs, undefined);
    }
  }
  assert.equal(JSON.stringify(body).includes('synthetic-private-marker'), false);
  assert.deepEqual(input, before);
  const empty = await post(syntheticPlayer([]));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.data.arranged.Manufacture[0].RoomChar, []);
  assert.equal(empty.body.data.arranged.Manufacture[0].CharNum, 1);
  for (const type of ['SHOP', 'RECYCLE', 'FUTURE_ROOM']) {
    input.building.roomSlots.unknown = { roomId: type, level: 1, state: 2, charInstIds: [] };
    const rejected = await post(input);
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.error.code, 'DATA_MISMATCH');
    assert.equal(rejected.body.data, undefined);
  }
  delete input.building.roomSlots.unknown;
  for (const change of [
    value => { delete value.troop.chars; },
    value => { value.building.roomSlots.m.charInstIds = [2, 2]; value.building.chars[2].roomSlotId = 'm'; },
    value => { value.building.roomSlots.m.charInstIds = [999]; },
    value => { value.building.roomSlots.train.charInstIds = [1, 2, 3]; },
    value => { value.building.chars[2].ap = -1; },
  ]) {
    const invalid = structuredClone(before); change(invalid);
    const rejected = await post(invalid);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.data, undefined);
  }
  const boundary = structuredClone(before);
  boundary.status.padding = '';
  boundary.status.padding = 'x'.repeat(1024 * 1024 - Buffer.byteLength(JSON.stringify(boundary)));
  assert.equal(Buffer.byteLength(JSON.stringify(boundary)), 1024 * 1024);
  assert.equal((await post(boundary)).status, 200);
  boundary.status.padding += 'x';
  const oversized = await post(boundary);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'REQUEST_TOO_LARGE');
  assert.equal(oversized.body.data, undefined);
  assert.equal((await post(before)).status, 200);
});

test('新订单内部情景不能通过HTTP参数激活，输出契约和默认隔离保持不变', async t => {
  const post = await setup(t);
  const catalog = await loadCatalog(dataDirectory, dataPin);
  const charId = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === '可露希尔');
  const input = syntheticPlayer([charId]);
  input.troop.chars[1].evolvePhase = 2;
  input.building.roomSlots.t = { roomId: 'TRADING', level: 3, state: 2, charInstIds: [1] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 10, stock: [] } };
  Object.assign(input.building.chars[1], { ap: 4320000, roomSlotId: 't' });
  const original = await post(input);
  assert.equal(original.status, 422, JSON.stringify(original.body));
  input.scenario = 'steady-new-gold-orders';
  const injected = await post(input);
  assert.deepEqual(injected, original);
  assert.equal(injected.body.preview, undefined);
  assert.equal(injected.body.data, undefined);
  input.building.roomSlots.t.charInstIds = [];
  input.building.chars[1].roomSlotId = '';
  const inactive = await post(input);
  assert.equal(inactive.status, 200, JSON.stringify(inactive.body));
  assert.equal(inactive.body.preview, undefined);
  assert.equal(inactive.body.diagnostics.mode, 'partial');
  assert.deepEqual(inactive.body.diagnostics.excludedIds, [1]);
  assert.deepEqual(inactive.body.data.arranged.Trading[0].RoomChar, []);
});

test('已确认状态内部入口不能通过HTTP注入启用，仍使用默认未支持边界', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_123_fang']);
  input.building.roomSlots.m.charInstIds = [1];
  input.building.chars[1].roomSlotId = 'm';
  const original = await post(input);
  assert.equal(original.status, 422, JSON.stringify(original.body));
  const confirmed = { scenario: 'confirmed-current-state', assignment: { m: [1], d: [] },
    completedWorkHours: { 1: 5 }, clueExchangeActive: true, trainingActive: true,
    dormTargets: { 1: null }, resolvedEntryEventIds: [1] };
  Object.assign(input, confirmed, { confirmedState: confirmed });
  Object.assign(input.building, { confirmedState: confirmed });
  const injected = await post(input);
  assert.deepEqual(injected, original);
  assert.equal(injected.body.preview, undefined);
  assert.equal(injected.body.data, undefined);
});

test('絮雨办公室等级和解锁跨HTTP与worker联动制造，疲劳后安排休息且清除来源', async t => {
  const post = await setup(t);
  const catalog = await loadCatalog(dataDirectory, dataPin);
  const names = ['絮雨', '迷迭香', '爱丽丝'];
  const input = syntheticPlayer(names.map(name => Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name)));
  input.building.roomSlots.h = { roomId: 'HIRE', level: 3, state: 2, charInstIds: [1] };
  input.building.rooms.HIRE = { h: {} };
  input.building.roomSlots.m.charInstIds = [2];
  input.building.roomSlots.d.charInstIds = [3];
  input.building.roomSlots.d.level = 3;
  for (const [id, slot] of [[1, 'h'], [2, 'm'], [3, 'd']]) {
    input.troop.chars[id].evolvePhase = 2;
    Object.assign(input.building.chars[id], { ap: 4320000, roomSlotId: slot });
  }
  for (const [phase, hireLevel, expected, hireIds] of [[2, 3, 1.25 / 1.2, [1]], [2, 1, 1.06 / 1.2, []], [0, 3, 1.06 / 1.2, []], [2, 3, 1.25 / 1.2, [1]]]) {
    input.troop.chars[1].evolvePhase = phase;
    input.building.roomSlots.h.level = hireLevel;
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Hire[0].RoomChar.map(char => char.Inst.Inst), hireIds);
    assert.ok(Math.abs(body.diagnostics.objective.primary[0] - expected) < 1e-12, JSON.stringify(body.diagnostics.objective));
  }
  input.building.chars[1].ap = 0;
  const tired = await post(input);
  assert.equal(tired.status, 200, JSON.stringify(tired.body));
  assert.ok(!tired.body.data.arranged.Hire[0].RoomChar.some(char => char.Inst.Inst === 1));
  assert.ok(tired.body.data.arranged.Dormitory[0].RoomChar.some(char => char.Inst.Inst === 1));
  assert.ok(Math.abs(tired.body.diagnostics.objective.primary[0] - 1.06 / 1.2) < 1e-12, JSON.stringify(tired.body));
});

test('深海真实四人组合跨HTTP与worker完整求值，练度往返清除旧加成', async t => {
  const post = await setup(t);
  const catalog = await loadCatalog(dataDirectory, dataPin);
  const names = ['歌蕾蒂娅', '斯卡蒂', '幽灵鲨', '安哲拉'];
  const input = syntheticPlayer(names.map(name => Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === name)));
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 5, state: 2, charInstIds: [1] };
  input.building.rooms.CONTROL = { c: {} };
  Object.assign(input.building.roomSlots.m, { level: 3, charInstIds: [2, 3, 4] });
  for (const id of [1, 2, 3, 4]) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId: id === 1 ? 'c' : 'm' });
  // 赤金1件/4320秒：以下生产倍率换算为件/小时。
  for (const [phase, expected] of [[0, 1.48 / 1.2], [2, 1.93 / 1.2], [0, 1.48 / 1.2]]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Control[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst).sort(), [2, 3, 4]);
    assert.ok(Math.abs(body.diagnostics.objective.primary[0] - expected) < 1e-12, JSON.stringify(body.diagnostics.objective));
  }
});

test('无人机上限跨HTTP与worker控制充能并往返重算，缺失或非法状态不伪造结果', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_1027_greyy2']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.roomSlots.p = { roomId: 'POWER', level: 1, state: 2, charInstIds: [1] };
  input.building.rooms.POWER = { p: {} };
  Object.assign(input.building.chars[1], { ap: 8640000, roomSlotId: 'p' });
  for (const [maxValue, expected] of [[200, 1.25], [250, 1.3], [9, 1.05], [200, 1.25]]) {
    input.building.status = { labor: { maxValue, value: 0 } };
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Power[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.ok(Math.abs(body.diagnostics.objective.secondary[0] - expected) < 1e-12, JSON.stringify(body.diagnostics.objective));
  }
  delete input.building.status;
  const missing = await post(input);
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error.code, 'MISSING_MECHANISM_STATE');
  assert.equal(missing.body.preview, undefined);
  assert.equal(missing.body.data, undefined);
  input.building.roomSlots.p.charInstIds = [];
  input.building.chars[1].roomSlotId = '';
  const inactive = await post(input);
  assert.equal(inactive.status, 200, JSON.stringify(inactive.body));
  assert.equal(inactive.body.diagnostics.mode, 'partial');
  assert.deepEqual(inactive.body.diagnostics.excludedIds, [1]);
  assert.ok(inactive.body.diagnostics.unresolved.some(item => item.reason === 'MISSING_MECHANISM_STATE'));
  input.building.status = { labor: { maxValue: 200 } };
  assert.equal((await post(input)).body.diagnostics.mode, 'full');
  input.building.status = { labor: { maxValue: '200' } };
  const invalid = await post(input);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_REQUEST');
  delete input.building.status;
  input.troop.chars[1].charId = input.building.chars[1].charId = 'char_377_gdglow';
  assert.equal((await post(input)).status, 200);
});

test('协助位跨HTTP与worker参与联动且训练人员不被挪用，缺资料保持显式拒绝或排除', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4136_phonor', 'char_4133_logos', 'char_285_medic2']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.troop.chars[1].level = 30;
  input.building.roomSlots.p = { roomId: 'POWER', level: 1, state: 2, charInstIds: [1] };
  input.building.roomSlots.t = { roomId: 'TRAINING', level: 3, state: 2, charInstIds: [2, 3] };
  input.building.rooms.TRAINING = { t: { trainer: { charInstId: 2 } } };
  for (const id of [1, 2, 3]) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId: id === 1 ? 'p' : 't' });
  for (const [trainer, expected] of [[2, 1.2], [3, 1.15], [-1, 1.15], [2, 1.2]]) {
    input.building.rooms.TRAINING.t.trainer.charInstId = trainer;
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.excludedIds, []);
    const placed = Object.values(body.data.arranged).flat().flatMap(room => room.RoomChar.map(char => char.Inst.Inst));
    assert.deepEqual(placed, [1]);
    assert.ok(Math.abs(body.diagnostics.objective.secondary[0] - expected) < 1e-12, JSON.stringify(body.diagnostics.objective));
  }
  delete input.building.rooms.TRAINING;
  const missing = await post(input);
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error.code, 'MISSING_MECHANISM_STATE');
  input.building.roomSlots.p.charInstIds = [];
  input.building.chars[1].roomSlotId = '';
  const inactive = await post(input);
  assert.equal(inactive.status, 200, JSON.stringify(inactive.body));
  assert.deepEqual(inactive.body.diagnostics.excludedIds, [1]);
  input.building.rooms.TRAINING = { t: { trainer: { charInstId: 1 } } };
  const invalid = await post(input);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_REQUEST');
});

test('三名异格中枢来源跨HTTP与worker恢复完整排班，移除后再加入不残留隔离', async t => {
  const post = await setup(t);
  const roster = ['char_1011_lava2', 'char_1021_kroos2', 'char_1024_hbisc2'];
  for (const count of [3, 1, 3]) {
    const input = syntheticPlayer(roster.slice(0, count));
    delete input.building.roomSlots.m;
    delete input.building.rooms.MANUFACTURE;
    const ids = Array.from({ length: count }, (_, index) => index + 1);
    input.building.roomSlots.c = { roomId: 'CONTROL', level: 5, state: 2, charInstIds: ids };
    input.building.rooms.CONTROL = { c: {} };
    for (const id of ids) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId: 'c' });
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Control[0].RoomChar.map(char => char.Inst.Inst).sort(), ids);
  }
});

test('精零孑跨HTTP按候选订单上限求值，库存变化和练度往返不残留', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_272_strong']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.chars[1].ap = 8640000;
  input.building.chars[1].roomSlotId = 't';
  input.building.roomSlots.t = { roomId: 'TRADING', level: 1, state: 2, charInstIds: [1] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 99, stock: [] } };
  for (const count of [0, 2, 0]) {
    input.building.rooms.TRADING.t.stock = Array.from({ length: count }, () => ({}));
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.ok(Math.abs(body.diagnostics.objective.primary[0] - (1.01 + (6 - count) * 0.04)) < 1e-12);
  }
  input.troop.chars[1].evolvePhase = 1;
  const unsupported = await post(input);
  assert.equal(unsupported.status, 422);
  assert.equal(unsupported.body.preview, undefined);
  assert.equal(unsupported.body.data, undefined);
  input.troop.chars[1].evolvePhase = 0;
  assert.equal((await post(input)).status, 200);
});

test('完整孑与焰狐龙梓兰跨HTTP容量参与选人，解锁回退不残留', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_272_strong', 'char_1048_orchd2']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.troop.chars[2].evolvePhase = 2;
  for (const id of [1, 2]) Object.assign(input.building.chars[id], { ap: 8640000, roomSlotId: 't' });
  input.building.roomSlots.t = { roomId: 'TRADING', level: 3, state: 2, charInstIds: [1, 2] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 99, stock: [{}, {}] } };
  for (const [phase, expected] of [[2, 1.66], [0, 1.34], [2, 1.66]]) {
    input.troop.chars[2].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Inst.Inst).sort(), [1, 2]);
    assert.ok(Math.abs(body.diagnostics.objective.primary[0] - expected) < 1e-12, JSON.stringify(body.diagnostics));
  }
});

test('真实HTTP→worker→锁定数据→求解→独立校验→兼容响应，并能连续请求', async t => {
  const post = await setup(t);
  for (let i = 0; i < 3; i++) {
    const result = await post(syntheticPlayer(['char_285_medic2', 'char_286_cast3']));
    assert.equal(result.status, 200);
    assert.equal(result.body.diagnostics.compatibility, 'arkhost-assignment-v1');
    assert.equal(result.body.data.arranged.Manufacture[0].RoomChar[0].Inst.Inst, 2);
    assert.equal(result.body.diagnostics.dataVersion.commit, dataPin.commit);
    assert.equal(result.body.preview, undefined);
  }
});
test('数据升级的未知ID与描述漂移跨HTTP拒绝，旧版本回退恢复', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scheduling-mapping-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'excel'));
  for (const file of ['character_table.json', 'handbook_team_table.json', 'gamedata_const.json']) {
    await copyFile(join(dataDirectory, 'excel', file), join(directory, 'excel', file));
  }
  const original = await readFile(join(dataDirectory, 'excel/building_data.json'));
  for (const mode of ['original', 'new-id', 'drift', 'rollback']) {
    await t.test(mode, async child => {
      const building = JSON.parse(original);
      const id = 'manu_formula_spd[010]';
      if (mode === 'new-id') {
        building.buffs.future = { ...building.buffs[id], buffId: 'future' };
        building.chars.char_286_cast3.buffChar[1].buffData[0].buffId = 'future';
      } else if (mode === 'drift') building.buffs[id].description += '，未来未知条件';
      const bytes = mode === 'original' || mode === 'rollback' ? original : Buffer.from(JSON.stringify(building));
      await writeFile(join(directory, 'excel/building_data.json'), bytes);
      const post = await setup(child, { dataDirectory: directory, pin: { ...dataPin,
        buildingSha256: createHash('sha256').update(bytes).digest('hex') } });
      const input = syntheticPlayer(['char_286_cast3']);
      input.troop.chars[1].level = 30;
      input.building.chars[1].ap = 8640000;
      const result = await post(input);
      if (mode === 'new-id' || mode === 'drift') {
        assert.equal(result.status, 422);
        assert.equal(result.body.error.code, 'UNISOLATABLE_MECHANISM');
        assert.equal(result.body.preview, undefined);
        assert.equal(result.body.data, undefined);
      } else {
        assert.equal(result.status, 200);
        assert.equal(result.body.data.arranged.Manufacture[0].RoomChar[0].Inst.Inst, 1);
      }
    });
  }
});

test('默认配置下429人两种布局经过HTTP与worker返回明确部分安排', async t => {
  const catalog = await loadCatalog(dataDirectory, dataPin);
  const ids = Object.keys(catalog.chars).sort();
  const post = await setup(t);
  for (const [layout, minimumAssigned] of [['252', 38], ['243', 36]]) {
    const { status, body } = await post(baseLayout(ids, layout));
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'partial');
    assert.equal(body.diagnostics.compatibility, 'arkhost-assignment-v1');
    assert.equal(body.preview, undefined);
    assert.equal(body.diagnostics.rest.unassignedTired, 0);
    assert.equal(body.diagnostics.search.exhausted, false);
    const assigned = Object.values(body.data.arranged).flat().flatMap(room => room.RoomChar.map(char => char.Inst.Inst));
    // 新机制解锁可能解除隔离、增加可用岗位；不把旧覆盖下的缺员数锁成目标。
    assert.ok(assigned.length >= minimumAssigned);
    for (const rooms of Object.values(body.data.arranged)) {
      for (const room of rooms) assert.ok(room.RoomChar.length <= room.CharNum);
    }
    assert.equal(new Set(assigned).size, assigned.length);
    assert.ok(body.diagnostics.excludedIds.every(id => !assigned.includes(id)));
  }
  assert.equal((await post(syntheticPlayer([]))).status, 200);
});

test('完整最高练度与混合练度阵容跨HTTP不因未入驻的历史技能整单失败，原宿舍保留', async t => {
  const catalog = await loadCatalog(dataDirectory, dataPin);
  const characters = JSON.parse(await readFile(join(dataDirectory, 'excel/character_table.json'), 'utf8'));
  const ids = Object.keys(catalog.chars).sort();
  const post = await setup(t);
  for (const layout of ['252', '243']) {
    for (const mode of ['max-empty', 'max-occupied', 'mixed-occupied']) {
      const input = baseLayout(ids, layout);
      for (const operator of Object.values(input.troop.chars)) {
        const phases = characters[operator.charId].phases;
        operator.evolvePhase = mode.startsWith('mixed') && operator.instId % 3 === 0 ? 0 : phases.length - 1;
        operator.level = phases[operator.evolvePhase].maxLevel;
      }
      const mountain = ids.indexOf('char_264_f12yin') + 1;
      // 保留未知技能持有人的原宿舍：不能以成功返回安排为由清空原占位。
      if (mode !== 'max-empty') {
        input.building.roomSlots.dorm0.charInstIds = [mountain];
        input.building.chars[mountain].roomSlotId = 'dorm0';
        input.building.chars[mountain].ap = 0;
      }
      const { status, body } = await post(input);
      assert.equal(status, 200, `${layout}/${mode}: ${JSON.stringify(body)}`);
      assert.equal(body.diagnostics.mode, 'partial');
      assert.equal(body.diagnostics.compatibility, 'arkhost-assignment-v1');
      assert.equal(body.preview, undefined);
      const rooms = Object.values(body.data.arranged).flat();
      if (mode !== 'max-empty') {
        assert.deepEqual(rooms.find(room => room.Slot === 'dorm0').RoomChar.map(char => char.Inst.Inst), [mountain]);
      }
      const assigned = rooms.flatMap(room => room.RoomChar.map(char => char.Inst.Inst));
      assert.equal(new Set(assigned).size, assigned.length);
      if (mode === 'max-empty') assert.ok(assigned.length > 1);
      // 全局联动可能把宿舍冻结扩展至全基地；不把保留原安排冒充有效优化。
      else assert.ok(body.diagnostics.frozenSlots.includes('dorm0'));
      assert.ok(body.diagnostics.excludedIds.every(id => id === mountain || !assigned.includes(id)));
    }
  }
});

test('已入驻的时间增长技能跨HTTP保持拒绝，不伪造历史产能', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_446_aroma']);
  input.troop.chars[1].evolvePhase = 2;
  input.building.chars[1].ap = 8640000;
  input.building.chars[1].roomSlotId = 'm';
  input.building.roomSlots.m.charInstIds = [1];
  const { status, body } = await post(input);
  assert.equal(status, 422);
  assert.equal(body.error.code, 'UNISOLATABLE_MECHANISM');
  assert.equal(body.preview, undefined);
  assert.equal(body.data, undefined);
});

test('训练室等级跨HTTP及worker参与制造选人，训练人员保持原岗', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4226_veen', 'char_126_shotst', 'char_285_medic2']);
  input.troop.chars[1].evolvePhase = 2;
  input.building.chars[1].ap = 8640000;
  input.building.chars[3].roomSlotId = 'train';
  input.building.roomSlots.train = { roomId: 'TRAINING', level: 3, state: 2, charInstIds: [3] };
  const before = structuredClone(input);
  const high = await post(input);
  assert.equal(high.status, 200);
  assert.equal(high.body.data.arranged.Manufacture[0].RoomChar[0].Inst.Inst, 1);
  assert.equal(Object.values(high.body.data.arranged).flat().some(room => room.RoomChar.some(char => char.Inst.Inst === 3)), false);
  assert.deepEqual(input, before);
  input.building.roomSlots.train.level = 1;
  const low = await post(input);
  assert.equal(low.status, 200);
  assert.equal(low.body.data.arranged.Manufacture[0].RoomChar[0].Inst.Inst, 2);
});

test('办公室等级跨HTTP及worker影响疲劳干员的宿舍恢复，不需要手填招募位', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4010_etlchi']);
  input.building.roomSlots.h = { roomId: 'HIRE', level: 1, state: 2, charInstIds: [] };
  const results = [];
  for (const level of [1, 2, 3]) {
    input.building.roomSlots.h.level = level;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.data.arranged.Dormitory[0].RoomChar[0].Inst.Inst, 1);
    assert.equal(body.data.arranged.Hire[0].RoomChar.length, 0);
    assert.equal(body.diagnostics.mode, 'full');
    results.push(body.diagnostics.mood[1].changePerHour);
  }
  assert.ok(Math.abs(results[1] - results[0] - 0.05) < 1e-12);
  assert.ok(Math.abs(results[2] - results[0] - 0.1) < 1e-12);
});

test('精英身份跨HTTP及worker只增加术语成员的宿舍恢复', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4195_radian', 'char_017_huang', 'char_285_medic2']);
  // 只比较中枢→宿舍链路，避免主生产优先把唯一可工作干员安排到制造站。
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.chars[1].ap = 8640000;
  input.building.chars[2].ap = 0;
  input.building.chars[3].ap = 0;
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 1, state: 2, charInstIds: [] };
  const before = structuredClone(input);
  const base = await post(input);
  input.troop.chars[1].evolvePhase = 2;
  const elite = await post(input);
  for (const result of [base, elite]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.diagnostics.mode, 'full');
    assert.equal(result.body.data.arranged.Control[0].RoomChar[0].Inst.Inst, 1);
    assert.deepEqual(result.body.data.arranged.Dormitory[0].RoomChar.map(char => char.Inst.Inst).sort(), [2, 3]);
  }
  assert.ok(Math.abs(elite.body.diagnostics.mood[2].changePerHour - base.body.diagnostics.mood[2].changePerHour - 0.1) < 1e-12);
  assert.equal(elite.body.diagnostics.mood[3].changePerHour, base.body.diagnostics.mood[3].changePerHour);
  input.troop.chars[1].evolvePhase = 0;
  assert.deepEqual(input, before);
});

test('槐琥解锁队友生产力跨HTTP与worker提高同配方产出，未解锁不误算', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_243_waaifu', 'char_126_shotst']);
  input.building.chars[1].ap = 8640000;
  input.building.roomSlots.m.level = 2;
  const rates = [];
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst).sort(), [1, 2]);
    assert.deepEqual(body.diagnostics.objective.primaryKeys, ['item:3003:perHour']);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 锁定配方4每件4320秒；队友15%经槐琥再增加15%，即0.125件/小时。
  assert.ok(Math.abs(rates[1] - rates[0] - 0.125) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('工作场所伙伴跨HTTP与worker计入训练室但不计加工站，保留受保护人员', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4088_hodrer', 'char_4087_ines']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.chars[1].ap = 8640000;
  input.building.chars[2].roomSlotId = 'reserved';
  input.building.roomSlots.t = { roomId: 'TRADING', level: 1, state: 2, charInstIds: [] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 6, stock: [] } };
  input.building.roomSlots.reserved = { roomId: 'TRAINING', level: 1, state: 2, charInstIds: [2] };
  const rates = [];
  for (const type of ['TRAINING', 'WORKSHOP', 'TRAINING']) {
    input.building.roomSlots.reserved.roomId = type;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.equal(Object.values(body.data.arranged).flat().some(room => room.RoomChar.some(char => char.Inst.Inst === 2)), false);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  assert.ok(rates[0] > rates[1]);
  assert.equal(rates[0], rates[2]);
});

test('贸易效率分档解锁跨HTTP与worker提升上限，回退练度不复用旧结果', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_383_snsant', 'char_103_angel']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.chars[1].ap = 8640000;
  input.troop.chars[2].evolvePhase = 2;
  input.building.roomSlots.t = { roomId: 'TRADING', level: 2, state: 2, charInstIds: [] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 8, stock: [] } };
  const rates = [];
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Inst.Inst).sort(), [1, 2]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  assert.ok(rates[1] > rates[0]);
  assert.equal(rates[2], rates[0]);
});

test('人间烟火经HTTP与worker按办公室等级影响制造，等级回退不残留', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_473_mberry', 'char_2025_shu']);
  input.building.roomSlots.h = { roomId: 'HIRE', level: 1, state: 2, charInstIds: [] };
  for (const id of [1, 2]) {
    input.troop.chars[id].evolvePhase = 2;
    input.building.chars[id].ap = 8640000;
  }
  const rates = [];
  for (const level of [1, 2, 3, 1]) {
    input.building.roomSlots.h.level = level;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [2]);
    assert.deepEqual(body.data.arranged.Hire[0].RoomChar.map(char => char.Inst.Inst), [1]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 0/10/20点分别提供0/3/6%生产力，配方4基础产量每小时5/6件。
  assert.ok(Math.abs(rates[1] - rates[0] - 0.025) < 1e-12);
  assert.ok(Math.abs(rates[2] - rates[0] - 0.05) < 1e-12);
  assert.equal(rates[3], rates[0]);
});

test('感知与梦境转换经HTTP和worker，宿舍等级回退重新求值且不排除完整角色', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_391_rosmon', 'char_4046_ebnhlz', 'char_338_iris']);
  input.building.roomSlots.m.charInstIds = [1];
  input.building.roomSlots.d.charInstIds = [3];
  input.building.roomSlots.t = { roomId: 'TRADING', level: 1, state: 2, charInstIds: [2] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 6, stock: [] } };
  for (const [id, slot] of [[1, 'm'], [2, 't'], [3, 'd']]) {
    input.troop.chars[id].evolvePhase = 2;
    input.building.chars[id].ap = 4320000;
    input.building.chars[id].roomSlotId = slot;
  }
  const rates = [];
  for (const level of [1, 5, 1]) {
    input.building.roomSlots.d.level = level;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Char), ['char_391_rosmon']);
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Char), ['char_4046_ebnhlz']);
    assert.deepEqual(body.data.arranged.Dormitory[0].RoomChar.map(char => char.Char), ['char_338_iris']);
    const objective = body.diagnostics.objective;
    rates.push(objective.primary);
  }
  assert.deepEqual(rates[2], rates[0]);
  for (const [index, expected] of [[0, [13 / 15, 1.02]], [1, [0.9, 1.04]]]) {
    rates[index].forEach((rate, column) => assert.ok(Math.abs(rate - expected[column]) < 1e-12));
  }
});

test('赤金生产组合跨HTTP与worker保留原岗，配方切换与回退重新计数', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4055_bgsnow', 'char_402_tuye', 'char_478_kirara']);
  input.building.roomSlots.t = { roomId: 'TRADING', level: 3, state: 2, charInstIds: [1, 2, 3] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 10, stock: [] } };
  input.building.roomSlots.m2 = { roomId: 'MANUFACTURE', level: 1, state: 2, charInstIds: [] };
  input.building.rooms.MANUFACTURE.m2 = { formulaId: '4', capacity: 24 };
  for (const id of [1, 2, 3]) {
    input.troop.chars[id].evolvePhase = 2;
    input.building.chars[id].ap = 8640000;
    input.building.chars[id].roomSlotId = 't';
  }
  const rates = [];
  for (const formulaId of ['4', '1', '4']) {
    input.building.rooms.MANUFACTURE.m2.formulaId = formulaId;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Inst.Inst).sort(), [1, 2, 3]);
    const objective = body.diagnostics.objective;
    rates.push(objective.primary[objective.primaryKeys.indexOf('trading:t:speed')]);
  }
  // 无杜林：2实线+绮良2虚线共4条，三人60%；1实线则15%。
  assert.ok(Math.abs(rates[0] - rates[1] - 0.45) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('默认HTTP预算主动集齐80人池赤金班组，疲劳与恢复请求不复用旧安排', async t => {
  const post = await setup(t);
  const trio = ['char_4055_bgsnow', 'char_402_tuye', 'char_478_kirara'];
  const input = syntheticPlayer([...Array(77).fill('char_286_cast3'), ...trio]);
  input.building.roomSlots.t = { roomId: 'TRADING', level: 3, state: 2, charInstIds: [] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 10, stock: [] } };
  input.building.roomSlots.m2 = { roomId: 'MANUFACTURE', level: 1, state: 2, charInstIds: [] };
  input.building.rooms.MANUFACTURE.m2 = { formulaId: '4', capacity: 24 };
  for (const [id, char] of Object.entries(input.troop.chars)) {
    char.evolvePhase = trio.includes(char.charId) ? 2 : 0;
    input.building.chars[id].ap = 8640000;
  }
  for (const ap of [8640000, 0, 8640000]) {
    input.building.chars[78].ap = ap;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    const trading = body.data.arranged.Trading[0].RoomChar.map(char => char.Char).sort();
    const objective = body.diagnostics.objective;
    const speed = objective.primary[objective.primaryKeys.indexOf('trading:t:speed')];
    if (ap) {
      assert.deepEqual(trading, [...trio].sort());
      assert.ok(Math.abs(speed - 1.63) < 1e-12);
    } else {
      assert.ok(!trading.includes(trio[0]));
      assert.ok(body.data.arranged.Dormitory.some(room => room.RoomChar.some(char => char.Inst.Inst === 78)));
      assert.ok(Math.abs(speed - 1.43) < 1e-12);
    }
    assert.ok(body.data.arranged.Manufacture.every(room => room.RoomChar.length === 1));
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.ok(body.diagnostics.search.nodes <= 2000);
    assert.equal(body.diagnostics.search.exhausted, false);
    assert.equal(body.diagnostics.compatibility, 'arkhost-assignment-v1');
    assert.equal(body.preview, undefined);
  }
});

test('热情值跨HTTP与worker增强贵金属生产，来源疲劳与恢复不残留', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4182_oblvns', 'char_4183_mortis', 'char_286_cast3']);
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 2, state: 2, charInstIds: [] };
  for (const id of [1, 2, 3]) input.building.chars[id].ap = 8640000;
  const rates = [];
  for (const ap of [8640000, 0, 8640000]) {
    input.building.chars[2].ap = ap;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.ok(body.data.arranged.Control[0].RoomChar.some(char => char.Inst.Inst === 1));
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 20热情值增加0.5%，配方4每小时5/6件。
  assert.ok(Math.abs(rates[0] - rates[1] - 1 / 240) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('重岳烟火跨HTTP按候选工作成员重算，疲劳离岗再恢复不污染后续请求', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_2024_chyue', 'char_2025_shu']);
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 1, state: 2, charInstIds: [] };
  for (const id of [1, 2]) {
    input.troop.chars[id].evolvePhase = 2;
    input.building.chars[id].ap = 8640000;
  }
  const rates = [];
  for (const ap of [8640000, 0, 8640000]) {
    input.building.chars[1].ap = ap;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [2]);
    assert.deepEqual(body.data.arranged.Control[0].RoomChar.map(char => char.Inst.Inst), ap ? [1] : []);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 两名工作岁的10点烟火给黍3%；疲劳重岳进宿舍，仅1点人数烟火，黍0%。
  assert.ok(Math.abs(rates[0] - rates[1] - 0.025) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('公事公办跨HTTP与worker随精英解锁往返，原中枢无需隔离或排除', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4064_mlynar', 'char_286_cast3']);
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 1, state: 2, charInstIds: [1] };
  input.building.chars[1].roomSlotId = 'c';
  for (const id of [1, 2]) input.building.chars[id].ap = 8640000;
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.diagnostics.frozenSlots, []);
    assert.deepEqual(body.diagnostics.excludedIds, []);
    assert.deepEqual(body.data.arranged.Control[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [2]);
  }
});

test('梦境感知两级转换跨HTTP及worker随宿舍等级往返重算', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_391_rosmon', 'char_338_iris']);
  for (const id of [1, 2]) input.troop.chars[id].evolvePhase = 2;
  input.building.chars[1].ap = 8640000;
  input.building.chars[2].ap = 0;
  const rates = [];
  for (const level of [1, 5, 1]) {
    input.building.roomSlots.d.level = level;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.deepEqual(body.data.arranged.Dormitory[0].RoomChar.map(char => char.Inst.Inst), [2]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 一级→五级梦境增加4点感知，迷迭香+4%，配方4为5/6件每小时。
  assert.ok(Math.abs(rates[1] - rates[0] - 1 / 30) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('情报储备跨HTTP与worker按中枢人数增加招聘速度，解锁回退不残留', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_456_ash', 'char_457_blitz']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 1, state: 2, charInstIds: [] };
  input.building.roomSlots.h = { roomId: 'HIRE', level: 1, state: 2, charInstIds: [] };
  input.troop.chars[2].evolvePhase = 2;
  input.building.chars[1].ap = input.building.chars[2].ap = 8640000;
  const rates = [];
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Hire[0].RoomChar.map(char => char.Inst.Inst), [2]);
    const objective = body.diagnostics.objective;
    rates.push(objective.secondary[objective.secondaryKeys.indexOf('h:contactSpeed')]);
  }
  assert.ok(Math.abs(rates[1] - rates[0] - 0.05) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('木天蓼跨HTTP与worker联动中枢和制造，来源疲劳后加成消失再恢复', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4077_palico', 'char_1029_yato2', 'char_1030_noirc2']);
  input.troop.chars[1].level = 30;
  input.building.chars[1].ap = 8640000;
  input.building.roomSlots.c = { roomId: 'CONTROL', level: 2, state: 2, charInstIds: [] };
  const rates = [];
  for (const ap of [8640000, 0, 8640000]) {
    input.building.chars[2].ap = ap;
    input.building.chars[3].ap = ap;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [1]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 两名小队成员供给4点，固定8点；12%增量乘配方4每小时5/6件。
  assert.ok(Math.abs(rates[0] - rates[1] - 0.1) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('机器人跨HTTP与worker计入训练加工等级，解锁回退不残留生产加成', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4054_malist']);
  input.building.chars[1].ap = 8640000;
  input.building.roomSlots.training = { roomId: 'TRAINING', level: 3, state: 2, charInstIds: [] };
  input.building.roomSlots.workshop = { roomId: 'WORKSHOP', level: 3, state: 2, charInstIds: [] };
  const rates = [];
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [1]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 现有制造/宿舍各1级，加训练/加工各3级共8；精二解锁5%增量。
  assert.ok(Math.abs(rates[1] - rates[0] - 1 / 24) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('S.E.E.S.解锁与回退跨HTTP及worker计算自身，保留训练室成员并排除非成员', async t => {
  const post = await setup(t);
  const catalog = await loadCatalog(dataDirectory, dataPin);
  const partner = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === '埃癸斯');
  const input = syntheticPlayer(['char_4217_makoto', partner]);
  input.building.chars[1].ap = 8640000;
  input.building.chars[2].roomSlotId = 'train';
  input.building.roomSlots.train = { roomId: 'TRAINING', level: 1, state: 2, charInstIds: [2] };
  const rates = [];
  for (const [phase, charId] of [[0, partner], [2, partner], [2, 'char_285_medic2'], [0, partner]]) {
    input.troop.chars[1].evolvePhase = phase;
    input.troop.chars[2].charId = charId;
    input.building.chars[2].charId = charId;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.equal(Object.values(body.data.arranged).flat().some(room => room.RoomChar.some(char => char.Inst.Inst === 2)), false);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  assert.ok(Math.abs(rates[1] - rates[0] - 0.25) < 1e-12);
  assert.ok(Math.abs(rates[1] - rates[2] - 1 / 24) < 1e-12);
  assert.equal(rates[3], rates[0]);
});

test('办公室共鸣解锁及等级回退跨HTTP与worker不再隔离来源干员', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4109_baslin']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.chars[1].ap = 8640000;
  input.building.roomSlots.h = { roomId: 'HIRE', level: 1, state: 2, charInstIds: [] };
  for (const [phase, level] of [[0, 1], [2, 3], [2, 1], [0, 1]]) {
    input.troop.chars[1].evolvePhase = phase;
    input.building.roomSlots.h.level = level;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Hire[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.deepEqual(body.diagnostics.excludedIds, []);
  }
});

test('共鸣来源及恢复技能解锁跨HTTP与worker允许疲劳干员完整休息安排', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_245_cello']);
  input.building.chars[1].ap = 0;
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Dormitory[0].RoomChar.map(char => char.Inst.Inst), [1]);
  }
});

test('料理跨HTTP与worker按宿舍等级增加制造产出，连续请求不残留点数', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_4141_marcil', 'char_4143_sensi']);
  input.troop.chars[1].evolvePhase = 2;
  input.troop.chars[2].evolvePhase = 2;
  input.building.chars[1].ap = 8640000;
  input.building.chars[2].ap = 0;
  const dorm = Object.values(input.building.roomSlots).find(room => room.roomId === 'DORMITORY');
  const rates = [];
  for (const level of [1, 5, 1]) {
    dorm.level = level;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Manufacture[0].RoomChar.map(char => char.Inst.Inst), [1]);
    assert.deepEqual(body.data.arranged.Dormitory[0].RoomChar.map(char => char.Inst.Inst), [2]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  // 配方4每件4320秒，四级宿舍差额增加4%生产力。
  assert.ok(Math.abs(rates[1] - rates[0] - 1 / 30) < 1e-12);
  assert.equal(rates[2], rates[0]);
});

test('小队贸易人数跨HTTP与worker包含持有人自身，解锁回退后清除加成', async t => {
  const post = await setup(t);
  const input = syntheticPlayer(['char_1048_orchd2']);
  delete input.building.roomSlots.m;
  delete input.building.rooms.MANUFACTURE;
  input.building.chars[1].ap = 8640000;
  input.building.roomSlots.t = { roomId: 'TRADING', level: 1, state: 2, charInstIds: [] };
  input.building.rooms.TRADING = { t: { strategy: 'O_GOLD', stockLimit: 6, stock: [] } };
  const rates = [];
  for (const phase of [0, 2, 0]) {
    input.troop.chars[1].evolvePhase = phase;
    const { status, body } = await post(input);
    assert.equal(status, 200);
    assert.equal(body.diagnostics.mode, 'full');
    assert.deepEqual(body.data.arranged.Trading[0].RoomChar.map(char => char.Inst.Inst), [1]);
    rates.push(body.diagnostics.objective.primary[0]);
  }
  assert.ok(rates[1] > rates[0]);
  assert.equal(rates[2], rates[0]);
});

test('领域输入错误与数据不匹配跨worker保留状态码且不泄漏原文', async t => {
  const post = await setup(t);
  const bad = await post({ private: 'secret-token' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'INVALID_REQUEST');
  const mismatch = await post(syntheticPlayer(['private-unknown-char']));
  assert.equal(mismatch.status, 422); assert.equal(mismatch.body.error.code, 'DATA_MISMATCH');
  assert.equal(JSON.stringify(mismatch).includes('private'), false);
  assert.equal((await post(syntheticPlayer([]))).status, 200);
});
test('坏数据版本在监听前失败，不启动一个假健康的服务', async () => {
  await assert.rejects(createSchedulingService({ dataDirectory, pin: { ...dataPin, buildingSha256: '0'.repeat(64) } }), { code: 'DATA_NOT_READY' });
});
