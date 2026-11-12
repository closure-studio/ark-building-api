import { validateAssignment } from '../validate/assignment.mjs';

const roomTypes = {
  CONTROL: ['Control', 4], POWER: ['Power', 3], MANUFACTURE: ['Manufacture', 1],
  TRADING: ['Trading', 2], DORMITORY: ['Dormitory', 0], MEETING: ['Meeting', 5], HIRE: ['Hire', 6],
};

/** 仅适配协议已证实字段；不表示未知指标或消费方兼容性已经验收。 */
export function serializeDefinedFields(snapshot, assignment, catalog, frozenSlots = []) {
  validateAssignment(snapshot, assignment, catalog, frozenSlots);
  const arranged = Object.fromEntries(Object.values(roomTypes).map(([name]) => [name, []]));
  const operators = new Map(snapshot.operators.map(operator => [operator.instId, operator]));
  for (const room of snapshot.rooms) {
    const [name, type] = roomTypes[room.type];
    const encoded = {
      RoomType: type, Slot: room.slot, Level: room.level, CharNum: room.capacity,
      RoomChar: assignment[room.slot].map(id => {
        const operator = operators.get(id);
        return { Char: operator.charId, Inst: { Ap: operator.ap, Inst: id,
          Ev: operator.evolvePhase, Lvl: operator.level, Char: operator.charId } };
      }),
    };
    if (room.type === 'MANUFACTURE' && room.formulaId !== undefined) encoded.Formula = room.formulaId;
    arranged[name].push(encoded);
  }
  return { data: { arranged } };
}
