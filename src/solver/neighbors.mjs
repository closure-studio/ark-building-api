/** 一人离岗/移动/替换与跨房交换；只生成邻居，不用单人评分剪掉组合成员。 */
export function* neighboringAssignments(currentAssignment, rooms, operators, tiredApThreshold) {
  let base = currentAssignment();
  const byId = new Map(operators.map(op => [op.instId, op]));
  const roomBySlot = new Map(rooms.map(room => [room.slot, room]));
  // 满编不一定更好；先枚举离岗，避免低预算被大量换人邻居耗尽。
  for (const room of rooms) for (const id of base[room.slot]) {
    if (!byId.has(id)) continue;
    const next = structuredClone(base);
    next[room.slot] = next[room.slot].filter(value => value !== id);
    yield next;
  }
  for (const operator of operators) {
    base = currentAssignment();
    const source = Object.keys(base).find(slot => base[slot].includes(operator.instId));
    if (source && !roomBySlot.has(source)) continue;
    for (const target of rooms) {
      if (source === target.slot || (target.type !== 'DORMITORY' && operator.ap <= tiredApThreshold)) continue;
      const replaced = [...base[target.slot]];
      if (replaced.length < target.capacity) replaced.push(null);
      for (const id of replaced) {
        if (id !== null && source && roomBySlot.get(source).type !== 'DORMITORY'
          && byId.get(id).ap <= tiredApThreshold) continue;
        const next = structuredClone(base);
        if (source) next[source] = next[source].filter(value => value !== operator.instId);
        if (id !== null) {
          next[target.slot] = next[target.slot].filter(value => value !== id);
          if (source) next[source].push(id);
        }
        next[target.slot].push(operator.instId);
        yield next;
      }
    }
  }
}
