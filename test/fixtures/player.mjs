export function syntheticPlayer(charIds) {
  return {
    troop: { chars: Object.fromEntries(charIds.map((charId, i) => [i + 1, { instId: i + 1, charId, level: 1, evolvePhase: 0 }])) },
    building: {
      chars: Object.fromEntries(charIds.map((charId, i) => [i + 1, { charId, ap: i === 0 ? 0 : 8640000, roomSlotId: '' }])),
      roomSlots: {
        m: { roomId: 'MANUFACTURE', level: 1, state: 2, charInstIds: [] },
        d: { roomId: 'DORMITORY', level: 1, state: 2, charInstIds: [] },
      },
      rooms: { MANUFACTURE: { m: { formulaId: '4', capacity: 24 } }, DORMITORY: { d: { comfort: 1000 } } },
    },
  };
}
export { dataPin } from '../../src/data/pin.mjs';
