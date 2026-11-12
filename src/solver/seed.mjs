import { validateAssignment } from '../validate/assignment.mjs';

/** 起点只保证合法与休息覆盖，不按单人评分删除任何联动候选。 */
export function seedAssignment(snapshot, catalog, isolation) {
  const frozen = new Set(isolation.frozenSlots);
  const operators = new Map(snapshot.operators.map(op => [op.instId, op]));
  const used = new Set([...snapshot.reservedIds, ...isolation.excludedIds]);
  const assignment = Object.fromEntries(snapshot.rooms.map(room => [room.slot, frozen.has(room.slot) ? [...room.occupants] : []]));
  for (const ids of Object.values(assignment)) for (const id of ids) used.add(id);
  const rooms = snapshot.rooms.filter(room => !frozen.has(room.slot));
  const dorms = rooms.filter(room => room.type === 'DORMITORY');
  const tired = snapshot.operators.filter(op => op.ap <= catalog.tiredApThreshold && !used.has(op.instId))
    .sort((a, b) => a.ap - b.ap || a.instId - b.instId);
  for (const op of tired) {
    const room = dorms.find(room => assignment[room.slot].length < room.capacity);
    if (!room) break;
    assignment[room.slot].push(op.instId); used.add(op.instId);
  }
  // 合法原岗位优先保留；疲劳人员已挪到宿舍，不强行冻结非法工作状态。
  for (const room of rooms) {
    for (const id of room.occupants) {
      if (used.has(id) || assignment[room.slot].length >= room.capacity
        || (room.type !== 'DORMITORY' && operators.get(id).ap <= catalog.tiredApThreshold)) continue;
      assignment[room.slot].push(id); used.add(id);
    }
  }
  const healthy = snapshot.operators.filter(op => !used.has(op.instId) && op.ap > catalog.tiredApThreshold)
    .sort((a, b) => a.instId - b.instId);
  // 仅提供确定性起点；最终是否保留必须经完整联动求值，而非满编即最优。
  const work = rooms.filter(room => room.type !== 'DORMITORY').sort((a, b) => {
    const production = room => ['MANUFACTURE', 'TRADING'].includes(room.type) ? 0 : 1;
    return production(a) - production(b) || a.slot.localeCompare(b.slot, 'en');
  });
  for (const room of work) {
    while (assignment[room.slot].length < room.capacity && healthy.length) assignment[room.slot].push(healthy.shift().instId);
  }
  validateAssignment(snapshot, assignment, catalog, isolation.frozenSlots);
  return assignment;
}
