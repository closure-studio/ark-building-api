import { unlockedBuffs } from '../data/catalog.mjs';
import { validateAssignment, AssignmentError } from '../validate/assignment.mjs';
import { compileBuff, registeredSkill } from './compile.mjs';
import { resolveDormTarget } from './dorm-targets.mjs';

export class IsolationError extends Error {
  constructor(code) { super(code); this.code = code; this.status = 422; }
}

/** 隔离计划仅供内部使用：冻结部分的未知指标不可据此序列化成0。 */
export function planIsolation(snapshot, catalog, registry, { resetWorkHistory = false } = {}) {
  const frozen = new Set();
  const excluded = new Set();
  const unresolved = [];
  const edges = new Map(snapshot.rooms.map(room => [room.slot, new Set()]));
  const connect = (a, b) => { edges.get(a).add(b); edges.get(b).add(a); };
  // 中枢人数的基础减耗不是buff条目，仍是冻结工作区必须保护的输入依赖。
  if (catalog.controlData?.basicCostBuff) {
    for (const control of snapshot.rooms.filter(room => room.type === 'CONTROL')) {
      for (const target of snapshot.rooms.filter(room => room.type !== 'DORMITORY')) {
        connect(control.slot, target.slot);
      }
    }
  }
  const resourceRooms = new Map();
  const powerCountSources = new Set();
  const powerCountConsumers = new Set();
  const reserved = new Set(snapshot.reservedIds);
  const operators = new Map(snapshot.operators.map(operator => [operator.instId, operator]));
  for (const operator of snapshot.operators) {
    if (reserved.has(operator.instId)) continue;
    const current = snapshot.rooms.find(room => room.occupants.includes(operator.instId));
    for (const buff of unlockedBuffs(catalog, operator)) {
      const sourceRooms = snapshot.rooms.filter(room => room.type === buff.roomType);
      if (!sourceRooms.length) continue;
      const compiled = compileBuff(buff, catalog.characterNames, registry);
      const missingHistory = compiled.status === 'compiled' && current?.type === buff.roomType
        && compiled.effects.some(effect => (effect.basis === 'workHours' && !resetWorkHistory
          && (!Number.isSafeInteger(operator.completedWorkHours) || operator.completedWorkHours < 0))
          || (effect.scope === 'singleTarget' && resolveDormTarget(current,
            current.originalSeats ?? current.occupants, operator.instId, operators, catalog,
            { allowSelf: effect.allowSelf }) === undefined));
      if (missingHistory) {
        frozen.add(current.slot);
        unresolved.push({ instId: operator.instId, slot: current.slot,
          buffId: buff.buffId, reason: compiled.effects.some(effect => effect.scope === 'singleTarget')
            ? 'MISSING_DORM_TARGET_HISTORY' : 'MISSING_WORK_HISTORY' });
      }
      const missingState = compiled.status === 'compiled'
        && compiled.effects.some(effect => (effect.basis === 'droneLimit'
          && (!Number.isSafeInteger(snapshot.droneLimit) || snapshot.droneLimit < 0))
          || (effect.partnerRole === 'trainer' && !Array.isArray(snapshot.trainingTrainerIds))
          || (effect.basis === 'trainingActive' && typeof snapshot.trainingActive !== 'boolean')
          || (effect.basis === 'clueExchangeActive' && sourceRooms.some(room => typeof room.clueExchangeActive !== 'boolean')));
      if (compiled.status !== 'compiled' || missingState) {
        const boundary = registeredSkill(buff, registry)?.isolation;
        if (current?.type === buff.roomType) {
          if (missingState) throw new IsolationError('MISSING_MECHANISM_STATE');
          if (boundary !== 'local') throw new IsolationError('UNISOLATABLE_MECHANISM');
          frozen.add(current.slot);
          unresolved.push({ instId: operator.instId, slot: current.slot,
            buffId: buff.buffId, reason: 'UNQUANTIFIED_LOCAL_EFFECT' });
        } else {
          if (boundary !== 'local' && boundary !== 'inactiveOnly') {
            throw new IsolationError('UNISOLATABLE_MECHANISM');
          }
          // 不移动具有未知候选效果的持有人；有原岗位则同时保留该房间。
          excluded.add(operator.instId);
          if (current) frozen.add(current.slot);
          unresolved.push({ instId: operator.instId, slot: current?.slot ?? null,
            buffId: buff.buffId, reason: missingState ? 'MISSING_MECHANISM_STATE' : 'UNSUPPORTED_CANDIDATE_EFFECT' });
        }
        continue;
      }
      // 包括尚未进驻的候选：不能通过换人向受保护区域新增全局效果。
      for (const effect of compiled.effects) {
        for (const source of sourceRooms) {
          for (const resource of [effect.resource, effect.sourceResource].filter(Boolean)) {
            if (!resourceRooms.has(resource)) resourceRooms.set(resource, new Set());
            resourceRooms.get(resource).add(source.slot);
          }
          if (effect.stat === 'powerRoomCount') powerCountSources.add(source.slot);
          if (effect.basis === 'powerRooms') powerCountConsumers.add(source.slot);
          for (const target of snapshot.rooms.filter(room => effect.baseOccupants
            || room.type === effect.scope || effect.targetRoomTypes?.includes(room.type) || room.type === effect.partnerRoomType)) {
            connect(source.slot, target.slot);
          }
        }
      }
    }
  }
  for (const source of powerCountSources) {
    for (const target of powerCountConsumers) connect(source, target);
  }
  for (const slots of resourceRooms.values()) {
    const [first, ...rest] = slots;
    for (const slot of rest) connect(first, slot);
  }
  const pending = [...frozen];
  for (let i = 0; i < pending.length; i++) {
    for (const target of edges.get(pending[i])) {
      if (!frozen.has(target)) { frozen.add(target); pending.push(target); }
    }
  }
  const frozenSlots = [...frozen].sort();
  // ArkHost只能在名单尾部补空位；冻结原岗的中间空位不可被压缩而触发重新进驻。
  if (snapshot.rooms.some(room => frozen.has(room.slot) && room.originalSeats
    && room.occupants.some((id, index) => room.originalSeats[index] !== id))) {
    throw new IsolationError('UNISOLATABLE_MECHANISM');
  }
  const original = Object.fromEntries(snapshot.rooms.map(room => [room.slot, [...room.occupants]]));
  try {
    // 全部原占位的互斥关系都必须可靠，不能靠清空非冻结房间掩盖重复身份。
    const occupied = Object.values(original).flat();
    if (new Set(occupied).size !== occupied.length) throw new AssignmentError();
    validateAssignment(snapshot, Object.fromEntries(snapshot.rooms.map(room => [room.slot,
      frozen.has(room.slot) ? [...room.occupants] : []])), catalog, frozenSlots);
  } catch (error) {
    if (!(error instanceof AssignmentError)) throw error;
    throw new IsolationError('INVALID_FROZEN_ASSIGNMENT');
  }
  return { mode: unresolved.length ? 'partial' : 'full', frozenSlots,
    excludedIds: [...excluded].sort((a, b) => a - b), unresolved };
}
