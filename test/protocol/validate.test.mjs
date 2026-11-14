import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as validators from '../../src/validate/assignment.mjs';
const { validateAssignment } = validators;

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

test('请求内校验器逐次拒绝非法候选且失败后可继续校验合法安排', () => {
  const validate = validators.createAssignmentValidator(snapshot, mood, ['work']);
  for (const candidate of [null, { work: [1] }, { ...good(), fake: [] },
    { work: [1], rest: [1] }, { work: [99], rest: [2] },
    { work: [3], rest: [2] }, { work: [2], rest: [1] },
    { work: [1, 2], rest: [] }, { work: [], rest: [2] },
    { work: '1', rest: [] }]) {
    assert.throws(() => validate(candidate), { code: 'INVALID_ASSIGNMENT' });
    assert.equal(validate(good()), true);
  }
  assert.equal(validate({ work: [1], rest: [] }), true);
  assert.equal(validate(good()), true);
  assert.throws(() => validators.createAssignmentValidator(snapshot, mood, ['missing'])(good()),
    { code: 'INVALID_ASSIGNMENT' });
});

test('复用校验器不串请求的疲劳阈值、保留人员或冻结席位顺序', () => {
  const next = structuredClone(snapshot);
  next.reservedIds = [];
  next.rooms[0].capacity = 2;
  next.rooms[0].occupants = [1, 3];
  const first = validators.createAssignmentValidator(snapshot, mood);
  const second = validators.createAssignmentValidator(next, mood, ['work']);
  const tired = validators.createAssignmentValidator(next, { tiredApThreshold: 400 });
  assert.equal(second({ work: [1, 3], rest: [2] }), true);
  assert.throws(() => second({ work: [3, 1], rest: [2] }), { code: 'INVALID_ASSIGNMENT' });
  assert.throws(() => first({ work: [3], rest: [2] }), { code: 'INVALID_ASSIGNMENT' });
  assert.throws(() => tired({ work: [3], rest: [2] }), { code: 'INVALID_ASSIGNMENT' });
  assert.equal(first(good()), true);
  assert.equal(second({ work: [1, 3], rest: [] }), true);
});
