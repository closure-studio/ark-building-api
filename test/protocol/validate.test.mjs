import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment } from '../../src/validate/assignment.mjs';

const snapshot = {
  operators: [
    { instId: 1, ap: 8640000 }, { instId: 2, ap: 0 }, { instId: 3, ap: 400 },
  ],
  rooms: [
    { slot: 'work', type: 'MANUFACTURE', capacity: 1, occupants: [1] },
    { slot: 'rest', type: 'DORMITORY', capacity: 5, occupants: [2] },
  ],
  reservedIds: [3],
};
const mood = { tiredApThreshold: 100 };
const good = () => ({ work: [1], rest: [2] });
const rejects = (value, frozen = []) => assert.throws(() => validateAssignment(snapshot, value, mood, frozen), { code: 'INVALID_ASSIGNMENT' });
test('独立校验允许合法工作与休息、缺员和空位', () => {
  assert.equal(validateAssignment(snapshot, good(), mood), true);
  assert.equal(validateAssignment(snapshot, { work: [], rest: [1, 2] }, mood), true);
});
test('拒绝重复、未知、加工训练预留人员与超员', () => {
  rejects({ work: [1], rest: [1] });
  rejects({ work: [99], rest: [2] });
  rejects({ work: [3], rest: [2] });
  rejects({ work: [1, 2], rest: [] });
});
test('拒绝漏房、伪造房间或畸形分配', () => {
  rejects({ work: [1] }); rejects({ ...good(), fake: [] });
  rejects({ work: '1', rest: [] }); rejects(null);
});
test('疲劳人员不能上班；冻结原安排不绕过合法性', () => {
  rejects({ work: [2], rest: [1] });
  rejects({ work: [], rest: [2] }, ['work']);
  assert.equal(validateAssignment(snapshot, good(), mood, ['work']), true);
  rejects(good(), ['missing']);
});
