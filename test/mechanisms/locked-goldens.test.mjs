import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { evaluateModifiers } from '../../src/mechanisms/evaluate.mjs';
import { directGoldens } from '../fixtures/direct-goldens.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const names = { CONTROL: '控制中枢', MANUFACTURE: '制造站', TRADING: '贸易站', DORMITORY: '宿舍', POWER: '发电站', MEETING: '会客室', HIRE: '人力办公室' };
function close(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-12, `${key}: ${actual[key]} != ${expected[key]}`);
}

// 文案原文作为固定输入，完整人工预期作为oracle；不依赖编译器的effects来生成预期。
for (const golden of directGoldens) {
  const description = golden.description ?? `进驻${names[golden.type]}时，${golden.body}`;
  const buffs = Object.values(catalog.buffs).filter(buff => buff.roomType === golden.type
    && buff.description.replace(/<(?:[@$]cc\.[\w.]+|\/)>/g, '') === description);
  test(`黄金资料存在：${description}`, () => assert.ok(buffs.length > 0));
  for (const buff of buffs) {
    test(`锁定技能数值 ${buff.buffId}`, () => {
      const data = { ...catalog, characterSubProfessions: { ...catalog.characterSubProfessions, source: 'physician', plain: 'physician' }, characterAffiliations: { ...catalog.characterAffiliations, source: [], plain: [] }, chars: {
        source: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: buff.buffId, cond: { phase: 0, level: 1 } }] }] },
        plain: { maxManpower: 8640000, buffChar: [] },
      } };
      const types = [golden.type, ...Object.keys(names).filter(type => type !== golden.type)];
      const rooms = types.map((type, index) => ({ slot: type, type, level: 1, capacity: 5,
        occupants: index === 0 ? [1, 2] : [index + 2] }));
      const operators = Array.from({ length: 8 }, (_, index) => ({ instId: index + 1,
        charId: index === 0 ? 'source' : 'plain', evolvePhase: 0, level: 1, ap: 4320000 }));
      const snapshot = { rooms, operators, reservedIds: [] };
      const assignment = Object.fromEntries(rooms.map(room => [room.slot, room.occupants]));
      for (const scenario of golden.scenarios ?? [golden]) {
        snapshot.droneLimit = scenario.droneLimit;
        snapshot.trainingTrainerIds = [];
        snapshot.reservedIds = [];
        operators.splice(8);
        if (scenario.trainer) {
          const charId = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === scenario.trainer);
          assert.ok(charId, `锁定协助者不存在：${scenario.trainer}`);
          operators.push({ instId: 9, charId, evolvePhase: 0, level: 1, ap: 4320000, roomSlotId: 'training' });
          data.chars[charId] = data.chars.plain;
          snapshot.trainingTrainerIds = [9];
          snapshot.reservedIds = [9];
        }
        for (const room of rooms) {
          room.level = scenario.levels?.[room.type] ?? 1;
          room.formulaId = scenario.formulas?.[room.type];
          room.stockCount = scenario.stocks?.[room.type];
        }
        rooms[0].formulaId = scenario.formulaId;
        snapshot.facilities = rooms.map(room => ({ slot: room.slot, type: room.type, level: room.level, state: 2 }));
        if (scenario.trainingLevel || scenario.trainer) snapshot.facilities.push({ slot: 'training', type: 'TRAINING', level: scenario.trainingLevel ?? 1, state: 2 });
        for (const room of rooms) assignment[room.slot] = [...(scenario.assignment?.[room.slot] ?? room.occupants)];
        for (const operator of operators) {
          operator.ap = scenario.ap?.[operator.instId] ?? 4320000;
          if (operator.instId <= 8) operator.charId = operator.instId === 1 ? 'source' : 'plain';
        }
        for (const partner of scenario.partners ?? (scenario.partner ? [scenario.partner] : [])) {
          const charId = Object.keys(catalog.characterNames).find(id => catalog.characterNames[id] === partner.name);
          assert.ok(charId, `锁定角色不存在：${partner.name}`);
          if (partner.faction) assert.ok(catalog.characterAffiliations[charId].includes(partner.faction));
          const target = partner.type ?? golden.type;
          const partnerId = partner.instId ?? (target === golden.type ? 2 : rooms.find(room => room.type === target).occupants[0]);
          operators.find(operator => operator.instId === partnerId).charId = charId;
          data.chars[charId] = data.chars.plain;
        }
        for (const [instId, buffIds] of Object.entries(scenario.companionBuffs ?? {})) {
          const operator = operators.find(operator => operator.instId === Number(instId));
          const affiliations = data.characterAffiliations[operator.charId];
          operator.charId = `companion-${instId}`;
          for (const buffId of buffIds) assert.ok(catalog.buffs[buffId], `锁定技能不存在：${buffId}`);
          data.characterAffiliations[operator.charId] = affiliations;
          data.chars[operator.charId] = { maxManpower: 8640000,
            buffChar: buffIds.map(buffId => ({ buffData: [{ buffId, cond: { phase: 0, level: 1 } }] })) };
        }
        const team = scenario.team ?? [1, 2];
        for (const order of [team, [...team].reverse()]) {
          assignment[golden.type] = order;
          const result = evaluateModifiers(snapshot, assignment, data);
          close(result.rooms[golden.type], scenario.room ?? {});
          close(result.operators[1], scenario.self ?? {});
          close(result.operators[2], scenario.other ?? {});
          for (const room of rooms.slice(1)) {
            close(result.rooms[room.slot], scenario.global?.[room.type] ?? {});
            close(result.operators[room.occupants[0]], scenario.globalOperators?.[room.type] ?? {});
          }
        }
      }
      assignment[golden.type] = [2];
      const inactive = evaluateModifiers(snapshot, assignment, data);
      const last = golden.scenarios?.at(-1) ?? golden;
      for (const [slot, value] of Object.entries(inactive.rooms)) close(value, last.inactiveRooms?.[slot] ?? {});
      for (const [id, value] of Object.entries(inactive.operators)) close(value, last.inactiveOperators?.[id] ?? {});
    });
  }
}
