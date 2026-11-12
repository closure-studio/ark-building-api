import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { arrangePreview } from '../../src/arrange.mjs';
import { syntheticPlayer, dataPin } from '../fixtures/player.mjs';

const catalog = await loadCatalog(resolve(fileURLToPath(new URL('../../', import.meta.url)), 'data/ArknightsGamedataPure'), dataPin);

test('真实锁定数据+合成玩家贯通求解/独立校验/响应，疲劳人员进宿舍', () => {
  const input = syntheticPlayer(['char_285_medic2', 'char_286_cast3']);
  const result = arrangePreview(input, catalog, { maxNodes: 1000 });
  assert.equal(result.diagnostics.compatibility, 'local-preview-only');
  assert.equal(result.diagnostics.search.exhausted, true);
  assert.ok(result.preview.arranged.Dormitory[0].RoomChar.some(c => c.Inst.Inst === 1));
  assert.ok(result.preview.arranged.Manufacture[0].RoomChar.some(c => c.Inst.Inst === 2));
  assert.equal(result.diagnostics.mood[1].changePerHour, 2);
  assert.equal(result.data, undefined, '未完成的契约不得伪装成可执行成功响应');
});
test('空阵容得到真实空位；缺资料不能被自动补成空阵容', () => {
  const result = arrangePreview(syntheticPlayer([]), catalog);
  assert.deepEqual(result.preview.arranged.Manufacture[0].RoomChar, []);
  assert.throws(() => arrangePreview({}, catalog), { code: 'INVALID_REQUEST' });
});
test('大阵容低预算先安置疲劳人员并保留在岗生产，不依赖遍历到完整叶子', () => {
  const input = syntheticPlayer(Array(80).fill('char_286_cast3'));
  input.building.roomSlots.m.charInstIds = [80];
  input.building.chars[80].roomSlotId = 'm';
  const result = arrangePreview(input, catalog, { maxNodes: 3 });
  assert.equal(result.diagnostics.search.exhausted, false);
  assert.ok(result.preview.arranged.Dormitory[0].RoomChar.some(c => c.Inst.Inst === 1));
  assert.equal(result.preview.arranged.Manufacture[0].RoomChar.length, 1);
});

test('未知技能在其原岗位无法隔离时拒绝时拒绝，不输出新安排', () => {
  const custom = structuredClone(catalog);
  const charId = 'char_future';
  custom.chars[charId] = { charId, maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: 'future', cond: { phase: 0, level: 1 } }] }] };
  custom.buffs.future = { buffId: 'future', roomType: 'MANUFACTURE', description: '进驻制造站时，全基建未知效果' };
  const input = syntheticPlayer([charId]); input.building.chars[1].ap = 8640000;
  input.building.chars[1].roomSlotId = 'm'; input.building.roomSlots.m.charInstIds = [1];
  assert.throws(() => arrangePreview(input, custom), { code: 'UNISOLATABLE_MECHANISM' });
});
