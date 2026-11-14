import { syntheticPlayer } from './player.mjs';

/** 合成布局，不代表真实账号；每个charId最多一个实例。 */
export function baseLayout(charIds, layout = '252') {
  const input = syntheticPlayer(charIds);
  input.building.roomSlots = {};
  input.building.rooms = { MANUFACTURE: {}, TRADING: {}, DORMITORY: {} };
  const add = (slot, type, level, detail) => {
    input.building.roomSlots[slot] = { roomId: type, level, state: 2, charInstIds: [] };
    if (detail) input.building.rooms[type][slot] = detail;
  };
  add('control', 'CONTROL', 5);
  for (let i = 0; i < Number(layout[0]); i++) add(`trade${i}`, 'TRADING', 3, { strategy: 'O_GOLD', stockLimit: 10, stock: [] });
  for (let i = 0; i < Number(layout[1]); i++) add(`manufact${i}`, 'MANUFACTURE', 3, { formulaId: i % 2 ? '4' : '1', capacity: 24 });
  for (let i = 0; i < Number(layout[2]); i++) add(`power${i}`, 'POWER', 3);
  for (let i = 0; i < 4; i++) add(`dorm${i}`, 'DORMITORY', 1, { comfort: 1000 });
  add('meeting', 'MEETING', 2); add('hire', 'HIRE', 1);
  Object.values(input.building.chars).forEach((char, i) => { char.ap = i < 10 ? 0 : 8640000; });
  return input;
}
