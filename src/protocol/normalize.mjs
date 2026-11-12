const targetTypes = new Set(['CONTROL', 'POWER', 'MANUFACTURE', 'TRADING', 'DORMITORY', 'MEETING', 'HIRE']);
const protectedTypes = new Set(['TRAINING', 'WORKSHOP', 'PRIVATE', 'ELEVATOR', 'CORRIDOR']);

export class InputError extends Error {
  constructor(code = 'INVALID_REQUEST') {
    super(code === 'DATA_MISMATCH' ? '请求与锁定的游戏数据不兼容' : '请求中的基建数据无效');
    this.code = code;
    this.status = code === 'DATA_MISMATCH' ? 422 : 400;
  }
}
function requireValue(ok, code) { if (!ok) throw new InputError(code); }
function record(value) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}
function text(value) { requireValue(typeof value === 'string' && value.length > 0); return value; }
function own(value, key) { return Object.hasOwn(value, key) ? value[key] : undefined; }

/** 将原始快照收窄为计算必需数据；不保留账号信息或原始对象引用。 */
export function normalize(input, catalog) {
  const root = record(input);
  const troop = record(record(root.troop).chars);
  const building = record(root.building);
  const chars = record(building.chars);
  const slots = record(building.roomSlots);
  const details = record(building.rooms);
  const status = building.status === undefined ? undefined : record(building.status);
  const labor = status?.labor === undefined ? undefined : record(status.labor);
  const droneLimit = labor?.maxValue === undefined ? undefined : integer(labor.maxValue);
  const operators = [];
  const byId = new Map();
  requireValue(Object.keys(troop).length === Object.keys(chars).length);
  for (const [key, rawValue] of Object.entries(troop)) {
    const raw = record(rawValue);
    const instId = integer(raw.instId, 1);
    requireValue(key === String(instId));
    const base = record(own(chars, key));
    const charId = text(raw.charId);
    requireValue(base.charId === charId);
    const definition = own(catalog.chars, charId);
    requireValue(definition, 'DATA_MISMATCH');
    requireValue(typeof base.roomSlotId === 'string');
    const operator = {
      instId, charId, level: integer(raw.level, 1, 90),
      evolvePhase: integer(raw.evolvePhase, 0, 2),
      ap: integer(base.ap, 0, definition.maxManpower), roomSlotId: base.roomSlotId,
    };
    operators.push(operator);
    byId.set(instId, operator);
  }
  const rooms = [];
  const facilities = [];
  const reservedIds = [];
  let trainingTrainerIds = [];
  const occupied = new Map();
  for (const [slot, rawValue] of Object.entries(slots)) {
    text(slot);
    const raw = record(rawValue);
    const state = integer(raw.state, 0, 2);
    const type = text(raw.roomId);
    requireValue(targetTypes.has(type) || protectedTypes.has(type), 'DATA_MISMATCH');
    const definition = own(catalog.rooms, type);
    requireValue(definition, 'DATA_MISMATCH');
    const level = integer(raw.level, state === 0 ? 0 : 1, definition.phases.length);
    const capacity = level === 0 ? 0 : definition.phases[level - 1].maxStationedNum;
    requireValue(Array.isArray(raw.charInstIds) && raw.charInstIds.length <= capacity);
    const occupants = [];
    for (const id of raw.charInstIds) {
      if (id === -1) continue;
      integer(id, 1);
      const operator = byId.get(id);
      requireValue(operator && !occupied.has(id) && operator.roomSlotId === slot);
      occupied.set(id, slot);
      occupants.push(id);
    }
    facilities.push({ slot, type, level, state });
    if (type === 'TRAINING' && state !== 0) {
      const training = details.TRAINING === undefined ? undefined : record(details.TRAINING);
      const detail = training?.[slot] === undefined ? undefined : record(training[slot]);
      if (state !== 2 || detail?.trainer === undefined) trainingTrainerIds = undefined;
      else {
        const trainer = integer(record(detail.trainer).charInstId, -1);
        requireValue(trainer === -1 || occupants.includes(trainer));
        if (detail.trainee !== undefined) {
          const trainee = integer(record(detail.trainee).charInstId, -1);
          requireValue(trainee === -1 || (occupants.includes(trainee) && trainee !== trainer));
        }
        if (trainer !== -1) trainingTrainerIds?.push(trainer);
      }
    }
    // 建造/升级中的设施不作为可优化房间，其占用不能被候选生成挪走。
    if (state !== 2 || protectedTypes.has(type)) {
      reservedIds.push(...occupants);
      continue;
    }
    const room = { slot, type, level, capacity, occupants };
    if (['MANUFACTURE', 'TRADING', 'DORMITORY'].includes(type)) {
      const detail = record(own(record(own(details, type)), slot));
      if (type === 'MANUFACTURE') {
        room.formulaId = text(detail.formulaId);
        const formula = own(catalog.manufactFormulas, room.formulaId);
        requireValue(formula, 'DATA_MISMATCH');
        // requireRooms描述历史解锁；原快照中的在用配方可在降级后的设施继续使用。
        room.inputCapacity = integer(detail.capacity);
      } else if (type === 'TRADING') {
        room.strategy = text(detail.strategy);
        requireValue(['O_GOLD', 'O_DIAMOND'].includes(room.strategy), 'DATA_MISMATCH');
        room.stockLimit = integer(detail.stockLimit);
        requireValue(Array.isArray(detail.stock));
        // 订单结构未证实，不将其当空库存：后续机制必须检测此数量并拒绝缺状态计算。
        room.stockCount = detail.stock.length;
      } else {
        room.comfort = integer(detail.comfort, 0, catalog.comfortLimit);
      }
    }
    rooms.push(room);
  }
  for (const operator of operators) {
    requireValue(operator.roomSlotId === '' ? !occupied.has(operator.instId) : occupied.get(operator.instId) === operator.roomSlotId);
  }
  return {
    ...(droneLimit === undefined ? {} : { droneLimit }),
    ...(trainingTrainerIds === undefined ? {} : { trainingTrainerIds: trainingTrainerIds.sort((a, b) => a - b) }),
    operators: operators.sort((a, b) => a.instId - b.instId),
    rooms: rooms.sort((a, b) => a.slot.localeCompare(b.slot, 'en')),
    reservedIds: reservedIds.sort((a, b) => a - b),
    facilities: facilities.sort((a, b) => a.slot.localeCompare(b.slot, 'en')),
  };
}
