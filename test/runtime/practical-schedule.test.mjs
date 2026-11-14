import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin, syntheticPlayer } from '../fixtures/player.mjs';
import { arrangePreview } from '../../src/arrange.mjs';
import { createSchedulingService } from '../../src/runtime/service.mjs';

const dataDirectory = fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url));
const catalog = await loadCatalog(dataDirectory, dataPin);
function fixture(strong = true) {
  const names = ['克洛丝', '香草', '杰西卡', '芬', ...(strong ? ['夜烟', '泡普卡'] : [])];
  const ids = names.map(name => Object.keys(catalog.chars).find(id => catalog.characterNames[id] === name));
  const input = syntheticPlayer(ids);
  for (const op of Object.values(input.troop.chars)) { op.evolvePhase = 1; op.level = 60; }
  for (const op of Object.values(input.building.chars)) op.ap = 8640000;
  input.building.roomSlots.m.level = 2;
  input.building.roomSlots.m.charInstIds = [1, 2];
  input.building.roomSlots.n = { roomId: 'MANUFACTURE', level: 2, state: 2, charInstIds: [3, 4] };
  input.building.rooms.MANUFACTURE.n = { formulaId: '4', capacity: 24 };
  for (const id of [1, 2]) input.building.chars[id].roomSlotId = 'm';
  for (const id of [3, 4]) input.building.chars[id].roomSlotId = 'n';
  return input;
}

test('可用制造班表超过原班暖机上限时解除历史闭包，不要求最优解', () => {
  const input = fixture(), before = structuredClone(input);
  const result = arrangePreview(input, catalog, { maxNodes: 2000 });
  assert.deepEqual(result.diagnostics.frozenSlots, []);
  assert.equal(result.diagnostics.workHistoryReset.comparison, 'capped-original-production');
  assert.ok(result.diagnostics.objective.primary[0] > result.diagnostics.workHistoryReset.originalUpper.primary[0]);
  assert.ok(result.diagnostics.search.nodes <= 2000);
  const rooms = result.preview.arranged.Manufacture;
  const all = Object.values(result.preview.arranged).flatMap(group => group.flatMap(room => room.RoomChar.map(op => op.Inst.Inst)));
  assert.equal(new Set(all).size, all.length);
  for (const [id, slot, seat] of [[1, 'm', 0], [4, 'n', 1]]) {
    const room = rooms.find(room => room.Slot === slot);
    assert.notEqual(room.RoomChar[seat]?.Inst.Inst, id, '缺历史的原位不能被当作首小时');
  }
  assert.deepEqual(input, before);
});

test('不能超过满暖机原班时保留历史冻结；小预算不绕过保护', () => {
  const input = fixture(false);
  const result = arrangePreview(input, catalog, { maxNodes: 2000 });
  assert.deepEqual(result.diagnostics.frozenSlots, ['m', 'n']);
  assert.equal(result.diagnostics.workHistoryReset, undefined);
  assert.ok(result.diagnostics.search.nodes <= 2000);
  assert.deepEqual(arrangePreview(fixture(), catalog, { maxNodes: 3 }).diagnostics.frozenSlots, ['m', 'n']);
});

test('百人候选池仍在默认预算内找到高效率制造班表', () => {
  const input = fixture();
  for (let id = 7; id <= 114; id++) {
    input.troop.chars[id] = { instId: id, charId: 'char_285_medic2', evolvePhase: 0, level: 1 };
    input.building.chars[id] = { charId: 'char_285_medic2', ap: 8640000, roomSlotId: '' };
  }
  for (const [from, to] of [[5, 56], [6, 43]]) {
    input.troop.chars[to] = { ...input.troop.chars[from], instId: to };
    input.building.chars[to] = input.building.chars[from];
    delete input.troop.chars[from]; delete input.building.chars[from];
  }
  const result = arrangePreview(input, catalog, { maxNodes: 2000 });
  assert.deepEqual(result.diagnostics.frozenSlots, []);
  assert.ok(result.diagnostics.workHistoryReset);
  assert.ok(result.diagnostics.search.nodes <= 2000);
});

test('默认HTTP生成可用制造班表，历史伪造无效，失败后可恢复', async t => {
  const service = await createSchedulingService({ dataDirectory, pin: dataPin });
  t.after(() => service.close());
  const { port } = await service.listen(0);
  const post = async input => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/arrange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  const first = await post(fixture());
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.diagnostics.frozenSlots, []);
  assert.ok(first.body.diagnostics.workHistoryReset);
  assert.equal((await post({ troop: {} })).status, 400);
  const injected = fixture();
  injected.building.chars[1].completedWorkHours = 9999;
  const restored = await post(injected);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.data.arranged, first.body.data.arranged);
});
