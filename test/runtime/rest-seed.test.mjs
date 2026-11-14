import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { arrangePreview } from '../../src/arrange.mjs';
import { createSchedulingService } from '../../src/runtime/service.mjs';
import { send } from '../fixtures/http.mjs';
import { baseLayout } from '../fixtures/base-layout.mjs';

const dataDirectory = fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url));
const catalog = await loadCatalog(dataDirectory, dataPin);
function fixture() {
  const roster = Array(40).fill('char_286_cast3');
  roster[3] = 'char_196_sunbr';
  roster[8] = 'char_120_hibisc';
  const input = baseLayout(roster, '243');
  for (const op of Object.values(input.troop.chars)) op.evolvePhase = 2;
  return input;
}
function checkRest(result) {
  const arranged = (result.data ?? result.preview).arranged;
  const rested = arranged.Dormitory.flatMap(room => room.RoomChar.map(op => op.Inst.Inst));
  for (let id = 1; id <= 10; id++) assert.ok(rested.includes(id), `疲劳人员${id}必须保留休息覆盖`);
  const all = Object.values(arranged).flatMap(rooms => rooms.flatMap(room => room.RoomChar.map(op => op.Inst.Inst)));
  assert.equal(new Set(all).size, all.length);
  assert.ok(result.diagnostics.search.nodes <= 2000);
  assert.equal(result.diagnostics.rest.target, 10);
}

test('真实单体恢复来源晚于同AP目标时，默认预算仍构造完整可求值休息起点', () => {
  const input = fixture(), before = structuredClone(input);
  const result = arrangePreview(input, catalog, { maxNodes: 2000 });
  checkRest(result);
  assert.ok(Object.values(result.diagnostics.mood).some(value => value.changePerHour > 2), '完整求值必须计算单体恢复，不能忽略来源');
  assert.deepEqual(input, before);
});

test('替代休息起点计入既有节点预算，不在搜索外额外求值', () => {
  const input = fixture();
  assert.throws(() => arrangePreview(input, catalog, { maxNodes: 2 }), { code: 'SEARCH_BUDGET_EXCEEDED' });
  const result = arrangePreview(input, catalog, { maxNodes: 3 });
  checkRest(result);
  assert.equal(result.diagnostics.search.nodes, 3);
});

test('多个同AP恢复来源挤在同宿舍时分散起点，保留全部疲劳人员', () => {
  const input = fixture();
  for (const id of [2, 3, 5]) input.troop.chars[id].charId = input.building.chars[id].charId = 'char_148_nearl';
  const before = structuredClone(input);
  checkRest(arrangePreview(input, catalog, { maxNodes: 2000 }));
  assert.deepEqual(input, before);
});

test('已冻结历史目标房保留原座位，其他同AP疲劳来源仍能休息', () => {
  const input = fixture();
  input.building.roomSlots.dorm0.charInstIds = [4, 1, 2];
  for (const id of [4, 1, 2]) input.building.chars[id].roomSlotId = 'dorm0';
  const before = structuredClone(input);
  const result = arrangePreview(input, catalog, { maxNodes: 2000 });
  const room = result.preview.arranged.Dormitory.find(room => room.Slot === 'dorm0');
  assert.ok(result.diagnostics.frozenSlots.includes('dorm0'));
  assert.deepEqual(room.RoomChar.map(op => op.Inst.Inst), [4, 1, 2]);
  const rested = result.preview.arranged.Dormitory.flatMap(room => room.RoomChar.map(op => op.Inst.Inst));
  for (let id = 1; id <= 10; id++) assert.ok(rested.includes(id));
  assert.deepEqual(input, before);
});

test('休息起点不能吞掉全局数据错误，失败后下一合法请求仍可求值', () => {
  const input = fixture(), bad = structuredClone(catalog);
  delete bad.chars.char_196_sunbr.maxManpower;
  assert.throws(() => arrangePreview(input, bad, { maxNodes: 2000 }), { code: 'DATA_NOT_READY' });
  checkRest(arrangePreview(input, catalog, { maxNodes: 2000 }));
});

test('默认HTTP覆盖同AP疲劳、历史冻结、失败和恢复，不更改输入或节点预算', async t => {
  const service = await createSchedulingService({ dataDirectory, pin: dataPin });
  t.after(() => service.close());
  const address = await service.listen();
  const post = input => send(address.port, JSON.stringify(input));
  const input = fixture(), before = structuredClone(input);
  const first = await post(input);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  checkRest(first.body);
  const failed = await post({ troop: {} });
  assert.equal(failed.status, 400);
  assert.equal(failed.body.data?.arranged, undefined);
  const frozen = structuredClone(input);
  frozen.building.roomSlots.dorm0.charInstIds = [4, 1, 2];
  for (const id of [4, 1, 2]) frozen.building.chars[id].roomSlotId = 'dorm0';
  const protectedResponse = await post(frozen);
  assert.equal(protectedResponse.status, 200, JSON.stringify(protectedResponse.body));
  assert.ok(protectedResponse.body.diagnostics.frozenSlots.includes('dorm0'));
  assert.deepEqual(protectedResponse.body.data.arranged.Dormitory.find(room => room.Slot === 'dorm0')
    .RoomChar.map(op => op.Inst.Inst), [4, 1, 2]);
  const rested = protectedResponse.body.data.arranged.Dormitory.flatMap(room => room.RoomChar.map(op => op.Inst.Inst));
  for (let id = 1; id <= 10; id++) assert.ok(rested.includes(id));
  const restored = await post(input);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  checkRest(restored.body);
  assert.deepEqual(restored.body.data.arranged, first.body.data.arranged);
  assert.deepEqual(input, before);
});
