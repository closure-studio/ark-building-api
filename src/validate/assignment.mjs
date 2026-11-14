export class AssignmentError extends Error {
  constructor() {
    super('排班结果未通过独立合法性校验');
    this.code = 'INVALID_ASSIGNMENT';
    this.status = 500;
  }
}
function check(value) { if (!value) throw new AssignmentError(); }

/** 与求解器分离；任何输出（包括冻结安排）都必须通过这里。 */
export function validateAssignment(snapshot, assignment, mood, frozenSlots = []) {
  return createAssignmentValidator(snapshot, mood, frozenSlots)(assignment);
}

/** 仅在同一不可变请求快照内复用索引；人员互斥与占位仍逐候选检查。 */
export function createAssignmentValidator(snapshot, mood, frozenSlots = []) {
  const rooms = new Map(snapshot.rooms.map(room => [room.slot, room]));
  const operators = new Map(snapshot.operators.map(operator => [operator.instId, operator]));
  const reserved = new Set(snapshot.reservedIds);
  return assignment => {
    check(assignment !== null && typeof assignment === 'object' && !Array.isArray(assignment));
    const used = new Set();
    check(Object.keys(assignment).length === rooms.size);
    check(frozenSlots.every(slot => rooms.has(slot)));
    for (const [slot, ids] of Object.entries(assignment)) {
      const room = rooms.get(slot);
      check(room && Array.isArray(ids) && ids.length <= room.capacity);
      for (const id of ids) {
        const operator = operators.get(id);
        check(operator && !used.has(id) && !reserved.has(id));
        check(room.type === 'DORMITORY' || operator.ap > mood.tiredApThreshold);
        used.add(id);
      }
      if (frozenSlots.includes(slot)) {
        check(ids.length === room.occupants.length && ids.every((id, i) => id === room.occupants[i]));
      }
    }
    return true;
  };
}
