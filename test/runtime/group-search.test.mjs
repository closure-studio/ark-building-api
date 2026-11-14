import test from 'node:test';
import assert from 'node:assert/strict';
import { send } from '../fixtures/http.mjs';
import { fileURLToPath } from 'node:url';
import { createSchedulingService } from '../../src/runtime/service.mjs';
import { syntheticPlayer, dataPin } from '../fixtures/player.mjs';

// 使用锁定表中的完整角色，覆盖解锁、持有与疲劳过滤直至HTTP输出。
test('真实伙伴技能通过HTTP按持有、解锁、疲劳和恢复重新计算', async t => {
  const service = await createSchedulingService({
    dataDirectory: fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), pin: dataPin,
  });
  t.after(() => service.close());
  const address = await service.listen();
  const post = input => send(address.port, JSON.stringify(input));
  const input = syntheticPlayer(['char_1042_phatm2', 'char_4198_christ']);
  input.building.roomSlots.m.level = 2;
  input.building.rooms.MANUFACTURE.m.formulaId = '1';
  for (const op of Object.values(input.troop.chars)) op.evolvePhase = 2;
  for (const op of Object.values(input.building.chars)) op.ap = 8640000;
  const original = structuredClone(input);
  const results = [];
  for (const stage of ['active', 'locked', 'tired', 'missing', 'restored']) {
    const candidate = structuredClone(input);
    if (stage === 'locked') candidate.troop.chars[2].evolvePhase = 0;
    if (stage === 'tired') candidate.building.chars[1].ap = 0;
    if (stage === 'missing') { delete candidate.troop.chars[1]; delete candidate.building.chars[1]; }
    const response = await post(candidate);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.diagnostics.excludedIds, []);
    assert.deepEqual(response.body.diagnostics.frozenSlots, []);
    const room = response.body.data.arranged.Manufacture[0];
    const ids = room.RoomChar.map(op => op.Inst.Inst);
    if (stage === 'active' || stage === 'restored') assert.deepEqual(ids.sort((a, b) => a - b), [1, 2]);
    if (stage === 'tired' || stage === 'missing') assert.ok(!ids.includes(1));
    assert.ok(response.body.diagnostics.search.nodes <= 2000);
    results.push(response.body.diagnostics.objective.primary);
  }
  assert.deepEqual(results[0], results[4]);
  assert.ok(results[0][0] > results[1][0]);
  assert.ok(results[0][0] > results[2][0]);
  assert.ok(results[0][0] > results[3][0]);
  assert.deepEqual(input, original);
});
