import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../src/data/catalog.mjs';
import { dataPin } from '../../src/data/pin.mjs';
import { createIsolatedEvaluator } from '../../src/mechanisms/evaluate.mjs';
import { evaluateMood } from '../../src/mechanisms/mood.mjs';
import { planIsolation } from '../../src/mechanisms/isolation.mjs';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('自律从完整锁定技能到心情速率，换房/解锁/移除均不残留且不影响队友', () => {
  const data = { ...catalog, chars: { ...catalog.chars,
    source: { maxManpower: 8640000, buffChar: [{ buffData: [{ buffId: 'dorm_recExcludeOther[000]', cond: { phase: 1, level: 1 } }] }] },
    plain: { maxManpower: 8640000, buffChar: [] },
  } };
  const snapshot = { operators: [
    { instId: 1, charId: 'source', evolvePhase: 1, level: 1, ap: 3600000 },
    { instId: 2, charId: 'plain', evolvePhase: 0, level: 1, ap: 3600000 },
  ], reservedIds: [], rooms: [{ slot: 'd', type: 'DORMITORY', level: 5, capacity: 5, comfort: 5000, occupants: [1, 2] },
    { slot: 'p', type: 'POWER', level: 3, capacity: 1, occupants: [] }] };
  const evaluate = createIsolatedEvaluator(snapshot, data);
  const assignment = { d: [1, 2], p: [] };
  const result = evaluate(assignment);
  close(evaluateMood(snapshot, assignment, data, result)[1].changePerHour, 2);
  close(evaluateMood(snapshot, assignment, data, result)[2].changePerHour, 4);
  const moved = { d: [2], p: [1] };
  assert.deepEqual(evaluate(moved).operators[1], {});
  close(evaluateMood(snapshot, moved, data, evaluate(moved))[1].changePerHour, -1);
  assert.deepEqual(evaluate(assignment), result);
  snapshot.operators[0].evolvePhase = 0;
  const locked = createIsolatedEvaluator(snapshot, data)(assignment);
  close(evaluateMood(snapshot, assignment, data, locked)[1].changePerHour, 4);
});

test('鲤氏计数数值单测（裁剪阿的未知技能）：换岗/解锁/缺身份校验', () => {
  const snapshot = { operators: [
    { instId: 1, charId: 'char_226_hmau', evolvePhase: 2, level: 1, ap: 3600000 },
    { instId: 2, charId: 'char_225_haak', evolvePhase: 0, level: 1, ap: 3600000 },
    { instId: 3, charId: 'plain', evolvePhase: 0, level: 1, ap: 3600000 },
  ], reservedIds: [], rooms: [
    { slot: 'c', type: 'CONTROL', level: 3, capacity: 3, occupants: [1, 2, 3] },
    { slot: 'd', type: 'DORMITORY', level: 1, capacity: 5, comfort: 0, occupants: [] },
  ] };
  // 阿的线索倾向不属于该数值用例，保留真实派系资料，仅移除不相干技能。
  const data = { ...catalog, chars: { ...catalog.chars, 'char_225_haak': { maxManpower: 8640000, buffChar: [] },
    plain: { maxManpower: 8640000, buffChar: [] } }, characterAffiliations: { ...catalog.characterAffiliations, plain: [] } };
  const assignment = { c: [1, 2, 3], d: [] };
  const evaluate = createIsolatedEvaluator(snapshot, data);
  const result = evaluate(assignment);
  close(result.operators[1].moodRecovery, 0.5);
  close(result.operators[2].moodRecovery, 0.5);
  close(result.operators[3].moodRecovery, 0.1);
  close(evaluateMood(snapshot, assignment, data, result)[1].changePerHour, -0.35);
  const moved = evaluate({ c: [1, 3], d: [2] });
  close(moved.operators[1].moodRecovery, 0.25);
  close(moved.operators[3].moodRecovery, 0.05);
  assert.deepEqual(moved.operators[2], {});
  assert.deepEqual(evaluate(assignment), result);
  snapshot.operators[0].evolvePhase = 0;
  assert.deepEqual(createIsolatedEvaluator(snapshot, data)(assignment).operators[1], {});
  snapshot.operators[0].evolvePhase = 2;
  const missing = { ...data, characterAffiliations: { ...data.characterAffiliations } };
  delete missing.characterAffiliations.plain;
  assert.throws(() => createIsolatedEvaluator(snapshot, missing)(assignment), { code: 'MISSING_MECHANISM_STATE' });
});

test('完整吽与槐琥中枢组合可求值，阿的真实未知技能仍拒绝', () => {
  const snapshot = { operators: [
    { instId: 1, charId: 'char_226_hmau', evolvePhase: 2, level: 1, ap: 3600000 },
    { instId: 2, charId: 'char_243_waaifu', evolvePhase: 0, level: 1, ap: 3600000 },
  ], reservedIds: [], rooms: [{ slot: 'c', type: 'CONTROL', level: 3, capacity: 3, occupants: [1, 2] }] };
  const assignment = { c: [1, 2] };
  assert.equal(planIsolation(snapshot, catalog).mode, 'full');
  const evaluate = createIsolatedEvaluator(snapshot, catalog);
  const result = evaluate(assignment);
  for (const id of [1, 2]) {
    close(result.operators[id].moodRecovery, 0.5);
    close(evaluateMood(snapshot, assignment, catalog, result)[id].changePerHour, -0.4);
  }
  assert.deepEqual(evaluate({ c: [2, 1] }), result);
  snapshot.operators[1].charId = 'char_225_haak';
  assert.throws(() => planIsolation(snapshot, catalog), { code: 'UNISOLATABLE_MECHANISM' });
});

test('仅实现自律不能绕过真实菲亚梅塔的交换心情技能隔离', () => {
  const snapshot = { operators: [{ instId: 1, charId: 'char_300_phenxi', evolvePhase: 0, level: 1, ap: 3600000 }],
    reservedIds: [], rooms: [{ slot: 'd', type: 'DORMITORY', level: 5, capacity: 5, comfort: 5000, occupants: [1] }] };
  assert.throws(() => planIsolation(snapshot, catalog), { code: 'UNISOLATABLE_MECHANISM' });
});
