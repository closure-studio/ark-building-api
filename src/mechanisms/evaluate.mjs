import { unlockedBuffs } from '../data/catalog.mjs';
import { validateAssignment } from '../validate/assignment.mjs';
import { compileBuff } from './compile.mjs';

import { planIsolation, IsolationError } from './isolation.mjs';

/** 仅在同一不可变请求快照内复用；不跨请求缓存数据版本或解锁状态。 */
export function createIsolatedEvaluator(snapshot, catalog, registry) {
  const diagnostics = planIsolation(snapshot, catalog, registry);
  const compiled = new Map();
  const prepared = new Map(snapshot.operators.map(operator => [operator.instId,
    unlockedBuffs(catalog, operator).map(buff => {
      if (!compiled.has(buff.buffId)) compiled.set(buff.buffId, compileBuff(buff, catalog.characterNames, registry));
      return { buff, compiled: compiled.get(buff.buffId) };
    })]));
  return assignment => evaluateIsolated(snapshot, assignment, catalog, diagnostics, prepared);
}

export function evaluateIsolatedModifiers(snapshot, assignment, catalog, registry) {
  return createIsolatedEvaluator(snapshot, catalog, registry)(assignment);
}

function evaluateIsolated(snapshot, assignment, catalog, diagnostics, prepared) {
  validateAssignment(snapshot, assignment, catalog, diagnostics.frozenSlots);
  const frozen = new Set(diagnostics.frozenSlots);
  const excluded = new Set(diagnostics.excludedIds);
  for (const room of snapshot.rooms) {
    if (!frozen.has(room.slot) && assignment[room.slot].some(id => excluded.has(id))) {
      throw new IsolationError('EXCLUDED_OPERATOR_ASSIGNED');
    }
  }
  const result = computeModifiers(snapshot, assignment, catalog, frozen, prepared);
  const operatorIds = snapshot.rooms.filter(room => frozen.has(room.slot))
    .flatMap(room => assignment[room.slot]).sort((a, b) => a - b);
  for (const slot of frozen) delete result.rooms[slot];
  for (const id of operatorIds) delete result.operators[id];
  return { ...result, diagnostics: structuredClone(diagnostics),
    unevaluated: { slots: [...diagnostics.frozenSlots], operatorIds } };
}

export class MechanismError extends Error {
  constructor(buffId) {
    super('当前方案包含尚未支持的完整技能效果');
    this.code = 'UNSUPPORTED_MECHANISM';
    this.status = 422;
    this.buffId = buffId;
  }
}

function readFacilityLevel(snapshot, effect, buffId) {
  const facilityType = effect.basis === 'extraRecruitSlots' ? 'HIRE' : effect.facilityType;
  const facilities = snapshot.facilities?.filter(facility => facility.type === facilityType);
  // 等级联动不依赖人员；缺失快照和施工中等级含义尚未证实，不能当作零级。
  if (!facilities || facilities.length > 1 || facilities.some(facility =>
    ![0, 2].includes(facility.state) || !Number.isSafeInteger(facility.level) || facility.level < 0
    || (effect.basis === 'extraRecruitSlots' && facility.level > 3))) {
    const error = new MechanismError(buffId);
    error.code = 'MISSING_MECHANISM_STATE';
    throw error;
  }
  return facilities[0]?.state === 2 ? facilities[0].level : 0;
}

function accumulate(target, effect, value) {
  let totals = target.get(effect.stat);
  if (!totals) { totals = { sum: 0, maxima: new Map() }; target.set(effect.stat, totals); }
  if (effect.stacking === 'max') {
    const group = effect.stackingGroup ?? 'default';
    const previous = totals.maxima.get(group);
    totals.maxima.set(group, previous === undefined ? value : Math.max(previous, value));
  } else totals.sum += value;
}
function values(totals) {
  return Object.fromEntries([...totals].map(([stat, { sum, maxima }]) =>
    [stat, sum + [...maxima.values()].reduce((total, value) => total + value, 0)]));
}

/** 仅计算技能增量，不包含未经证实的设施基础速率、资源换算或协议指标。 */
export function evaluateModifiers(snapshot, assignment, catalog, registry, resolveSkill) {
  validateAssignment(snapshot, assignment, catalog);
  // 条件求值在内部显式提供逐实例技能；HTTP入口不传入此解析器。
  const prepared = resolveSkill && new Map(snapshot.operators.map(operator => [operator.instId,
    unlockedBuffs(catalog, operator).map(buff => ({ buff, compiled: resolveSkill(buff, operator) }))]));
  return computeModifiers(snapshot, assignment, catalog, new Set(), prepared, registry);
}

function computeModifiers(snapshot, assignment, catalog, frozen, prepared, registry) {
  const operators = new Map(snapshot.operators.map(operator => [operator.instId, operator]));
  const roomTotals = new Map(snapshot.rooms.map(room => [room.slot, new Map()]));
  const operatorTotals = new Map(snapshot.operators.map(operator => [operator.instId, new Map()]));
  const dormitoryLevels = snapshot.rooms.filter(room => room.type === 'DORMITORY')
    .reduce((total, room) => total + room.level, 0);
  const sources = [];
  const derived = [];
  const capacityFloors = new Map();
  const productionBySource = new Map(snapshot.rooms.map(room => [room.slot, new Map()]));
  const recordProduction = (slot, id, effect, value) => {
    if (effect.stat !== 'production' || ['powerRooms', 'tradingRooms', 'dormitoryLevels'].includes(effect.basis)) return;
    const sources = productionBySource.get(slot);
    if (!sources.has(id)) sources.set(id, new Map());
    accumulate(sources.get(id), effect, value);
  };
  const localOrderTotals = new Map(snapshot.rooms.map(room => [room.slot, new Map()]));
  const capacityBySource = new Map(snapshot.rooms.map(room => [room.slot, new Map()]));
  let baseOccupants;
  const getBaseOccupants = buffId => {
    if (baseOccupants) return baseOccupants;
    if (!Array.isArray(snapshot.facilities)) {
      const error = new MechanismError(buffId);
      error.code = 'MISSING_MECHANISM_STATE';
      throw error;
    }
    const protectedIds = snapshot.reservedIds.filter(id => {
      const facility = snapshot.facilities.find(room => room.slot === operators.get(id)?.roomSlotId);
      if (!facility || facility.state !== 2 || !['TRAINING', 'WORKSHOP'].includes(facility.type)) {
        const error = new MechanismError(buffId);
        error.code = 'MISSING_MECHANISM_STATE';
        throw error;
      }
      return true;
    });
    baseOccupants = [...new Set([...Object.values(assignment).flat(), ...protectedIds])];
    return baseOccupants;
  };
  const skillsByRoom = new Map(snapshot.rooms.filter(room => !frozen.has(room.slot)).map(room => [room.slot,
    assignment[room.slot].map(id => ({ id,
      skills: (prepared?.get(id) ?? unlockedBuffs(catalog, operators.get(id))
        .map(buff => ({ buff, compiled: compileBuff(buff, catalog.characterNames, registry) })))
        .filter(({ buff }) => buff.roomType === room.type),
    })),
  ]));
  const operatorGroupCount = (effect, id, room, buffId) => {
    const members = catalog.operatorGroups?.[effect.operatorGroup];
    if (!Array.isArray(members) || !members.length) {
      const error = new MechanismError(buffId);
      error.code = 'MISSING_MECHANISM_STATE';
      throw error;
    }
    return snapshot.rooms.filter(target => target.type === effect.partnerRoomType
      && (!effect.excludeSourceRoom || target.slot !== room.slot))
      .flatMap(target => assignment[target.slot])
      .filter(occupant => (!effect.excludeSelf || occupant !== id)
        && members.includes(operators.get(occupant).charId)).length;
  };
  const groupActive = (effect, count) => count >= (effect.minimumGroupCount ?? 0)
    && count <= (effect.maximumGroupCount ?? Infinity);
  const getPartnerOccupants = (effect, room, buffId) => {
    if (effect.partnerRole === 'trainer') {
      if (!Array.isArray(snapshot.trainingTrainerIds)) {
        const error = new MechanismError(buffId);
        error.code = 'MISSING_MECHANISM_STATE';
        throw error;
      }
      return snapshot.trainingTrainerIds;
    }
    if (!effect.baseOccupants) return effect.partnerRoomType
      ? snapshot.rooms.filter(target => target.type === effect.partnerRoomType).flatMap(target => assignment[target.slot])
      : assignment[room.slot];
    const occupants = getBaseOccupants(buffId);
    if (!effect.workplaceOnly) return occupants;
    // cc.c.room3 包含训练室，不含宿舍、加工站；换岗条件必须读取候选而非原占位。
    const working = new Set(snapshot.rooms.filter(target => target.type !== 'DORMITORY')
      .flatMap(target => assignment[target.slot]));
    for (const id of snapshot.reservedIds) {
      if (snapshot.facilities.some(target => target.slot === operators.get(id).roomSlotId
        && target.type === 'TRAINING')) working.add(id);
    }
    return occupants.filter(id => working.has(id));
  };
  const markerActive = (effect, id, room, buffId) => {
    if (effect.moodAbove !== undefined || effect.moodAtMost !== undefined) {
      if (!Number.isFinite(catalog.manpowerDisplayFactor) || catalog.manpowerDisplayFactor <= 0) {
        const error = new MechanismError(buffId);
        error.code = 'MISSING_MECHANISM_STATE';
        throw error;
      }
      if (effect.moodAbove !== undefined && operators.get(id).ap <= effect.moodAbove * catalog.manpowerDisplayFactor) return false;
      if (effect.moodAtMost !== undefined && operators.get(id).ap > effect.moodAtMost * catalog.manpowerDisplayFactor) return false;
    }
    if (effect.operatorGroup && !groupActive(effect, operatorGroupCount(effect, id, room, buffId))) return false;
    const occupants = getPartnerOccupants(effect, room, buffId);
    if (effect.partnerCharId && !occupants.some(occupant => occupant !== id
      && operators.get(occupant).charId === effect.partnerCharId)) return false;
    if (effect.partnerFaction) {
      const labels = occupants.filter(occupant => effect.includeSelf || occupant !== id).map(occupant => {
        const affiliations = catalog.characterAffiliations?.[operators.get(occupant).charId];
        if (!Array.isArray(affiliations)) {
          const error = new MechanismError(buffId);
          error.code = 'MISSING_MECHANISM_STATE';
          throw error;
        }
        return affiliations;
      });
      if (!labels.some(value => value.includes(effect.partnerFaction))) return false;
    }
    return effect.condition !== 'alone' || assignment[room.slot].length === 1;
  };
  const hasActiveMarker = (skills, stat, id, room) => skills.some(({ buff, compiled }) =>
    compiled.effects?.some(effect => effect.stat === stat && markerActive(effect, id, room, buff.buffId)));
  const resources = new Map();
  const conversions = [];
  const outerAtLeastInner = snapshot.rooms.filter(r => ['TRADING', 'POWER'].includes(r.type)).length
    >= snapshot.rooms.filter(r => r.type === 'MANUFACTURE').length;
  let manufactureTypes;
  const getManufactureTypes = buffId => {
    if (manufactureTypes) return manufactureTypes;
    manufactureTypes = snapshot.rooms.filter(r => r.type === 'MANUFACTURE').map(r => {
      const type = catalog.manufactFormulas?.[r.formulaId]?.buffType;
      if (!['M_EXP', 'M_GOLD', 'M_ASC', 'M_DIAMOND'].includes(type)) {
        const error = new MechanismError(buffId);
        error.code = 'MISSING_MECHANISM_STATE';
        throw error;
      }
      return type;
    });
    return manufactureTypes;
  };
  const actualGoldLines = buffId => getManufactureTypes(buffId).filter(type => type === 'M_GOLD').length;
  for (const room of snapshot.rooms.filter(room => !frozen.has(room.slot))) {
    for (const { id, skills } of skillsByRoom.get(room.slot)) {
      for (const { buff, compiled } of skills) {
        for (const effect of compiled.effects ?? []) {
          if (effect.stat === 'resourceConversion' && markerActive(effect, id, room, buff.buffId)) conversions.push(effect);
          if (effect.stat !== 'resource' || !markerActive(effect, id, room, buff.buffId)) continue;
          // 已核查的独立资源来源相加；其余点数仍只验证了单一来源。
          if (resources.has(effect.resource) && !['catnip', 'enthusiasm', 'humanity', 'goldLines', 'perception', 'resonance'].includes(effect.resource)) {
            const error = new MechanismError(buff.buffId);
            error.code = 'MISSING_MECHANISM_STATE';
            throw error;
          }
          let count = effect.basis === 'fixed' ? 1
            : effect.basis === 'operatorGroupCount' ? operatorGroupCount(effect, id, room, buff.buffId)
              : effect.basis === 'occupants' ? assignment[room.slot].length : room.level;
          if (effect.basis === 'actualGoldLines') count = Math.floor(actualGoldLines(buff.buffId) / effect.step);
          if (effect.basis === 'baseOperatorGroupCount') {
            const members = catalog.operatorGroups?.[effect.baseOperatorGroup];
            if (!Array.isArray(members) || !members.length) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            count = getBaseOccupants(buff.buffId).filter(occupant => members.includes(operators.get(occupant).charId)).length;
          }
          if (effect.basis === 'extraRecruitSlots') {
            count = Math.max(0, readFacilityLevel(snapshot, effect, buff.buffId) - 1);
          }
          if (effect.basis === 'baseOccupants') {
            count = snapshot.rooms.filter(r => r.type === effect.partnerRoomType)
              .reduce((sum, r) => sum + assignment[r.slot].length, 0);
          }
          if (['localFactionCount', 'baseFactionCount'].includes(effect.basis)) {
            count = 0;
            const occupants = effect.basis === 'baseFactionCount' ? getBaseOccupants(buff.buffId).filter(occupant => {
              const slot = snapshot.rooms.find(target => assignment[target.slot].includes(occupant))?.slot
                ?? operators.get(occupant).roomSlotId;
              return !effect.excludedRoomTypes.includes(snapshot.facilities.find(target => target.slot === slot)?.type);
            }) : assignment[room.slot];
            for (const occupant of occupants) {
              const labels = catalog.characterAffiliations?.[operators.get(occupant).charId];
              if (!Array.isArray(labels)) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              if (labels.includes(effect.faction)) count++;
            }
          }
          if (effect.basis === 'facilityLevels') {
            const facilities = snapshot.facilities;
            const types = ['CONTROL', 'POWER', 'MANUFACTURE', 'TRADING', 'DORMITORY',
              'WORKSHOP', 'HIRE', 'TRAINING', 'MEETING', 'PRIVATE'];
            if (!Array.isArray(facilities) || new Set(facilities.map(f => f.slot)).size !== facilities.length
              || facilities.some(f => !types.includes(f.type) || ![0, 2].includes(f.state)
                || !Number.isSafeInteger(f.level) || f.level < (f.state === 2 ? 1 : 0))
              || snapshot.rooms.some(r => !facilities.some(f => f.slot === r.slot
                && f.type === r.type && f.level === r.level && f.state === 2))) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            count = facilities.filter(f => f.state === 2 && f.type !== 'PRIVATE')
              .reduce((sum, f) => sum + f.level, 0);
          }
          resources.set(effect.resource, (resources.get(effect.resource) ?? 0)
            + Math.min(effect.cap ?? Infinity, count * effect.value));
        }
      }
    }
  }
  // 同层转化读取同一快照，不消耗输入；先完成上游，避免房间遍历顺序影响两级转换。
  let pending = conversions;
  while (pending.length) {
    const outputs = new Set(pending.map(effect => effect.resource));
    const ready = pending.filter(effect => !outputs.has(effect.sourceResource));
    if (!ready.length) throw new MechanismError('RESOURCE_CONVERSION_CYCLE');
    const input = new Map(resources);
    for (const effect of ready) {
      resources.set(effect.resource, (resources.get(effect.resource) ?? 0)
        + Math.floor((input.get(effect.sourceResource) ?? 0) / effect.step) * effect.value);
    }
    pending = pending.filter(effect => !ready.includes(effect));
  }
  let powerRoomCount = snapshot.rooms.filter(room => room.type === 'POWER').length;
  // 数量修正在各房间求值前汇总；不能让制造站/宿舍的遍历顺序改变结果。
  for (const room of snapshot.rooms.filter(room => !frozen.has(room.slot))) {
    for (const { id, skills } of skillsByRoom.get(room.slot)) {
      for (const { buff, compiled } of skills) {
        for (const effect of compiled.effects ?? []) {
          if (effect.stat === 'powerRoomCount' && markerActive(effect, id, room, buff.buffId)) {
            powerRoomCount += effect.value;
          }
        }
      }
    }
  }
  const suppressedBuffs = new Map(snapshot.rooms.map(room => [room.slot, new Set()]));
  // 跨站人数先汇总再分配到各站；不能依赖来源中枢与制造站的遍历顺序。
  for (const source of snapshot.rooms.filter(room => !frozen.has(room.slot))) {
    for (const { id, skills } of skillsByRoom.get(source.slot)) {
      for (const { buff, compiled } of skills) {
        for (const effect of compiled.effects ?? []) {
          if (effect.basis !== 'targetGroupProduct') continue;
          const total = operatorGroupCount(effect, id, source, buff.buffId);
          const members = catalog.operatorGroups[effect.operatorGroup];
          for (const target of snapshot.rooms.filter(room => room.type === effect.scope && !frozen.has(room.slot))) {
            const local = assignment[target.slot].filter(occupant => members.includes(operators.get(occupant).charId)).length;
            if (!local) continue;
            for (const buffId of effect.suppressedBuffIds) suppressedBuffs.get(target.slot).add(buffId);
            if (skillsByRoom.get(target.slot).some(({ id, skills }) => hasActiveMarker(skills, 'suppressProduction', id, target))) continue;
            accumulate(roomTotals.get(target.slot), effect, Math.min(effect.cap, effect.value * total * local));
          }
        }
      }
    }
  }
  for (const room of snapshot.rooms) {
    if (frozen.has(room.slot)) continue;
    const roomSkills = skillsByRoom.get(room.slot);
    const suppressors = roomSkills.filter(({ id, skills }) =>
      hasActiveMarker(skills, 'suppressProduction', id, room)).map(({ id }) => id);
    const tradeSuppressors = roomSkills.filter(({ id, skills }) =>
      hasActiveMarker(skills, 'suppressOrderSpeed', id, room)).map(({ id }) => id);
    const suppressedMoodIds = new Set();
    for (const { id, skills } of roomSkills) {
      for (const { buff, compiled } of skills) {
        for (const effect of compiled.effects ?? []) {
          if (effect.stat !== 'suppressSelfMoodCost' || !markerActive(effect, id, room, buff.buffId)) continue;
          for (const target of effect.scope === 'self' ? [id] : assignment[room.slot]) {
            if (effect.targetFaction) {
              const labels = catalog.characterAffiliations?.[operators.get(target).charId];
              if (!Array.isArray(labels)) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              if (!labels.includes(effect.targetFaction)) continue;
            }
            suppressedMoodIds.add(target);
          }
        }
      }
    }
    const hasCapacityTier = roomSkills.some(({ id, skills }) => skills.some(({ buff, compiled }) =>
      compiled.effects?.some(effect => effect.basis === 'operatorCapacityTier'
        && markerActive(effect, id, room, buff.buffId))));
    const skillFamilies = new Map();
    if (roomSkills.some(({ skills }) => skills.some(({ compiled }) =>
      compiled.effects?.some(effect => effect.basis === 'skillFamily')))) {
      const alias = roomSkills.some(({ id, skills }) => hasActiveMarker(skills, 'standardizationAlias', id, room));
      for (const { skills } of roomSkills) {
        for (const { buff } of skills) {
          if (typeof buff.buffName !== 'string' || !buff.buffName.trim()) {
            const error = new MechanismError(buff.buffId);
            error.code = 'MISSING_MECHANISM_STATE';
            throw error;
          }
          const family = /^(标准化|莱茵科技|红松骑士团|金属工艺)(?:·|$)/.exec(buff.buffName)?.[1];
          if (!family) continue;
          skillFamilies.set(family, (skillFamilies.get(family) ?? 0) + 1);
          if (alias && ['莱茵科技', '红松骑士团'].includes(family)) {
            skillFamilies.set('标准化', (skillFamilies.get('标准化') ?? 0) + 1);
          }
        }
      }
    }
    for (const { id, skills } of roomSkills) {
      for (const { buff, compiled } of skills) {
        if (buff.roomType !== room.type) continue;
        if (compiled.status !== 'compiled') throw new MechanismError(buff.buffId);
        sources.push({ instId: id, slot: room.slot, buffId: buff.buffId });
        if (suppressedBuffs.get(room.slot).has(buff.buffId)) continue;
        for (const effect of compiled.effects) {
          if (effect.basis === 'targetGroupProduct') continue;
          if (['suppressProduction', 'suppressOrderSpeed', 'suppressSelfMoodCost', 'standardizationAlias', 'powerRoomCount', 'resource', 'resourceConversion'].includes(effect.stat)) continue;
          if (effect.condition === 'outerAtLeastInner' && !outerAtLeastInner) continue;
          if (effect.condition === 'innerAboveOuter' && outerAtLeastInner) continue;
          if (suppressedMoodIds.has(id) && effect.stat === 'moodCost' && effect.scope === 'self') continue;
          if (effect.stat === 'orderSpeed' && tradeSuppressors.some(source => source !== id)) continue;
          // 归零只针对同房其他来源的生产力；容量、心情和外部中枢加成不受影响。
          if (effect.stat === 'production' && suppressors.some(source => source !== id)
            && !['powerRooms', 'tradingRooms', 'dormitoryLevels'].includes(effect.basis)) continue;
          const groupCount = effect.operatorGroup ? operatorGroupCount(effect, id, room, buff.buffId) : 0;
          if (effect.operatorGroup && !groupActive(effect, groupCount)) continue;
          const partnerOccupants = getPartnerOccupants(effect, room, buff.buffId);
          const partners = effect.partnerCharId ? partnerOccupants.filter(occupant =>
            occupant !== id && operators.get(occupant).charId === effect.partnerCharId) : [];
          if (effect.partnerCharId && !partners.length) continue;
          if (effect.basis === 'targetFactionCount') {
            const members = effect.targetOperatorGroup ? catalog.operatorGroups?.[effect.targetOperatorGroup] : undefined;
            if (effect.targetOperatorGroup && !Array.isArray(members)) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            for (const target of snapshot.rooms.filter(target => target.type === effect.scope)) {
              const count = assignment[target.slot].filter(occupant => {
                if (members) return members.includes(operators.get(occupant).charId);
                const labels = catalog.characterAffiliations?.[operators.get(occupant).charId];
                if (!Array.isArray(labels)) {
                  const error = new MechanismError(buff.buffId);
                  error.code = 'MISSING_MECHANISM_STATE';
                  throw error;
                }
                return labels.includes(effect.faction);
              }).length;
              if (count && effect.formula) {
                const formula = catalog.manufactFormulas?.[target.formulaId];
                if (!formula?.buffType) {
                  const error = new MechanismError(buff.buffId);
                  error.code = 'MISSING_MECHANISM_STATE';
                  throw error;
                }
                if (formula.buffType !== effect.formula) continue;
              }
              const factor = effect.minimumCount === undefined ? count : Number(count >= effect.minimumCount);
              if (factor) accumulate(roomTotals.get(target.slot), effect, effect.value * factor);
            }
            continue;
          }
          let factionCount = 0;
          let groupMoodBalance = 0;
          let subProfessionCount = 0;
          if (effect.basis === 'baseSubProfessionCount') {
            for (const occupant of partnerOccupants) {
              const branch = catalog.characterSubProfessions?.[operators.get(occupant).charId];
              if (typeof branch !== 'string' || !branch.trim()) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              if (branch === effect.subProfession) subProfessionCount++;
            }
          }
          if (effect.basis === 'baseFactionRooms' || effect.baseOperatorGroup) {
            const matches = new Set();
            const members = effect.baseOperatorGroup ? catalog.operatorGroups?.[effect.baseOperatorGroup] : undefined;
            if (effect.baseOperatorGroup && (!Array.isArray(members) || !members.length)) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            for (const occupant of partnerOccupants) {
              const operator = operators.get(occupant);
              const labels = catalog.characterAffiliations?.[operator.charId];
              if (!members && !Array.isArray(labels)) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              if (members ? members.includes(operator.charId) : labels.includes(effect.faction)) {
                const target = snapshot.rooms.find(room => assignment[room.slot].includes(occupant));
                if (effect.basis === 'baseGroupMoodBalance') {
                  if (target?.type !== 'DORMITORY') groupMoodBalance++;
                  else {
                    const max = catalog.chars[operator.charId]?.maxManpower;
                    if (!Number.isFinite(max) || max <= 0) {
                      const error = new MechanismError(buff.buffId);
                      error.code = 'MISSING_MECHANISM_STATE';
                      throw error;
                    }
                    groupMoodBalance -= operator.ap >= max ? 2 : 1;
                  }
                }
                matches.add(effect.basis === 'baseFactionRooms'
                  ? target?.slot ?? operator.roomSlotId
                  : occupant);
              }
            }
            factionCount = matches.size;
          }
          if (!effect.baseOperatorGroup && (effect.partnerFaction || ['localFactionCount', 'baseFactionCount'].includes(effect.basis))) {
            const affiliates = partnerOccupants.filter(occupant => effect.basis === 'baseFactionCount'
              ? !effect.excludeSelf || occupant !== id
              : effect.basis === 'localFactionCount' || effect.includeSelf || occupant !== id).map(occupant => {
              const labels = catalog.characterAffiliations?.[operators.get(occupant).charId];
              if (!Array.isArray(labels)) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              return labels;
            });
            factionCount = affiliates.filter(labels => labels.includes(effect.partnerFaction ?? effect.faction)).length;
            if (effect.partnerFaction && factionCount === 0) continue;
          }
          if (effect.condition === 'alone' && assignment[room.slot].length !== 1) continue;
          if (effect.basis === 'contactBelow') {
            for (const target of snapshot.rooms.filter(target => target.type === 'HIRE' && assignment[target.slot].length)) {
              derived.push({ slot: target.slot, effect });
            }
            continue;
          }
          if (['capacityBonus', 'operatorCapacityTier', 'teammateProduction', 'localOrderSpeed', 'orderVacancy'].includes(effect.basis)) {
            if (effect.basis === 'capacityBonus' && room.type === 'MANUFACTURE' && hasCapacityTier) continue;
            derived.push({ slot: room.slot, id, effect, buffId: buff.buffId });
            continue;
          }
          if (effect.resourceMinimum !== undefined
            && (resources.get(effect.resource) ?? 0) < effect.resourceMinimum) continue;
          if (effect.formula && ['room', 'self', 'occupants', 'otherOccupants', 'partner', 'selfAndPartner'].includes(effect.scope)) {
            const formula = catalog.manufactFormulas?.[room.formulaId];
            if (!formula?.buffType) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            if (formula.buffType !== effect.formula) continue;
          }
          let deficitSteps = 0;
          if (effect.basis === 'moodDeficitSteps' || effect.deficitAbove !== undefined) {
            const operator = operators.get(id);
            const maximum = catalog.chars[operator.charId]?.maxManpower;
            const unit = catalog.manpowerDisplayFactor;
            if (!Number.isFinite(maximum) || maximum <= 0 || !Number.isFinite(unit) || unit <= 0) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            const deficit = Math.max(0, maximum - operator.ap);
            if (effect.deficitAbove !== undefined && deficit <= effect.deficitAbove * unit) continue;
            if (effect.basis === 'moodDeficitSteps') deficitSteps = Math.floor(deficit / (effect.step * unit));
          }
          let unfullCount = 0;
          const unfullOccupants = [];
          if (effect.basis === 'unfullOccupants' || effect.basis === 'sharedRecovery') {
            for (const occupant of assignment[room.slot]) {
              const operator = operators.get(occupant);
              const max = catalog.chars[operator.charId]?.maxManpower;
              if (!Number.isFinite(max) || max <= 0) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              if (operator.ap < max) {
                unfullCount++;
                unfullOccupants.push(occupant);
              }
            }
          }
          if (effect.basis === 'sharedRecovery') {
            const sharedEffect = { ...effect, stackingGroup: unfullCount === 1 ? 'singleTarget' : 'default' };
            for (const occupant of unfullOccupants) {
              accumulate(operatorTotals.get(occupant), sharedEffect, effect.value / unfullCount);
            }
            continue;
          }
          let facilityLevel = 0;
          if (effect.basis === 'facilityLevel' || effect.basis === 'extraRecruitSlots') {
            facilityLevel = readFacilityLevel(snapshot, effect, buff.buffId);
          }
          if (effect.basis === 'droneLimit' && (!Number.isSafeInteger(snapshot.droneLimit) || snapshot.droneLimit < 0)) {
            const error = new MechanismError(buff.buffId);
            error.code = 'MISSING_MECHANISM_STATE';
            throw error;
          }
          // 初始2位；办公室1/2/3级共2/3/4位，不能把等级当额外位数。
          // 绮良只按实际制造站增线；先汇总虚拟来源，消费时再加实际线，避免递归与遍历顺序依赖。
          const factor = effect.basis === 'goldLines' ? Math.floor((actualGoldLines(buff.buffId) + (resources.get('goldLines') ?? 0)) / effect.step)
            : effect.basis === 'droneLimit' ? Math.floor(snapshot.droneLimit / effect.step)
            : effect.basis === 'formulaTypes' ? new Set(getManufactureTypes(buff.buffId)).size
            : effect.basis === 'resource' ? Math.floor((resources.get(effect.resource) ?? 0) / effect.step)
            : effect.basis === 'operatorGroupCount' ? groupCount
            : effect.basis === 'baseGroupMoodBalance' ? groupMoodBalance
            : effect.basis === 'baseSubProfessionCount' ? Math.min(effect.maxCount, subProfessionCount)
            : ['baseFactionCount', 'baseFactionRooms'].includes(effect.basis) ? Math.min(effect.maxCount, factionCount)
            : effect.basis === 'localFactionCount' ? factionCount
            : effect.basis === 'localSkillCount' ? roomSkills.reduce((count, source) => count
              + source.skills.filter(({ buff, compiled }) => compiled.status === 'compiled' && effect.buffIds.includes(buff.buffId)).length, 0)
            : effect.basis === 'skillFamily' ? (skillFamilies.get(effect.family) ?? 0)
            : effect.basis === 'moodDeficitSteps' ? deficitSteps
            : effect.basis === 'extraRecruitSlots' ? Math.max(0, facilityLevel - 1)
            : effect.basis === 'facilityLevel' ? facilityLevel
            : effect.basis === 'unfullOccupants' ? unfullCount
            : effect.basis === 'dormitoryLevels' ? dormitoryLevels
            : effect.basis === 'roomLevel' ? room.level
              : effect.basis === 'powerRooms' ? powerRoomCount
                : effect.basis === 'tradingRooms' ? snapshot.rooms.filter(r => r.type === 'TRADING').length
                  : effect.basis === 'occupants' ? assignment[room.slot].length
                    : effect.basis === 'otherOccupants' ? assignment[room.slot].length - 1 : 1;
          const value = Math.min(effect.cap ?? Infinity, (effect.offset ?? 0) + effect.value * factor);
          let rawThreshold;
          if (effect.threshold !== undefined) {
            rawThreshold = effect.threshold * catalog.manpowerDisplayFactor;
            if (!Number.isFinite(catalog.manpowerDisplayFactor) || catalog.manpowerDisplayFactor <= 0 || !Number.isFinite(rawThreshold)) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
          }
          if (effect.scope === 'self') accumulate(operatorTotals.get(id), effect, value);
          else if (effect.scope === 'confirmedTarget') accumulate(operatorTotals.get(effect.targetInstId), effect, value);
          else if (effect.scope === 'selfAndPartner' || effect.scope === 'partner') {
            const targets = effect.scope === 'partner' ? partners : [id, ...partners];
            for (const occupant of targets) accumulate(operatorTotals.get(occupant), effect, value);
          } else if (effect.scope === 'occupants' || effect.scope === 'otherOccupants') {
            for (const occupant of assignment[room.slot]) {
              if (effect.scope === 'occupants' || occupant !== id) {
                let bonus = rawThreshold !== undefined && operators.get(occupant).ap <= rawThreshold ? effect.thresholdBonus : 0;
                if (effect.targetFaction) {
                  const labels = catalog.characterAffiliations?.[operators.get(occupant).charId];
                  if (!Array.isArray(labels)) {
                    const error = new MechanismError(buff.buffId);
                    error.code = 'MISSING_MECHANISM_STATE';
                    throw error;
                  }
                  if (labels.includes(effect.targetFaction)) bonus += (effect.targetBonus ?? 0) + (effect.targetBonusPerCount ?? 0) * factor;
                }
                accumulate(operatorTotals.get(occupant), effect, value + bonus);
              }
            }
          } else if (effect.scope === 'room') {
            accumulate(roomTotals.get(room.slot), effect, value);
            recordProduction(room.slot, id, effect, value);
            if (effect.stat === 'orderSpeed') accumulate(localOrderTotals.get(room.slot), effect, value);
            if (effect.stat === 'capacity') {
              const capacities = capacityBySource.get(room.slot);
              capacities.set(id, (capacities.get(id) ?? 0) + value);
            }
            if (effect.minimumCapacity) {
              const base = catalog.tradingData?.phases?.[room.level - 1]?.orderLimit;
              if (!Number.isSafeInteger(base) || base < 1) {
                const error = new MechanismError(buff.buffId);
                error.code = 'MISSING_MECHANISM_STATE';
                throw error;
              }
              capacityFloors.set(room.slot, effect.minimumCapacity - base);
            }
          } else {
            const members = effect.targetOperatorGroup ? catalog.operatorGroups?.[effect.targetOperatorGroup] : undefined;
            if (effect.targetOperatorGroup && !Array.isArray(members)) {
              const error = new MechanismError(buff.buffId);
              error.code = 'MISSING_MECHANISM_STATE';
              throw error;
            }
            for (const target of snapshot.rooms) {
              if ((target.type === effect.scope || effect.targetRoomTypes?.includes(target.type)) && assignment[target.slot].length > 0
                && (!effect.targetPartner || assignment[target.slot].some(occupant => partners.includes(occupant)))) {
                if (effect.formula) {
                  const formula = catalog.manufactFormulas?.[target.formulaId];
                  if (!formula?.buffType) {
                    const error = new MechanismError(buff.buffId);
                    error.code = 'MISSING_MECHANISM_STATE';
                    throw error;
                  }
                  if (formula.buffType !== effect.formula) continue;
                }
                if (effect.target === 'occupants') {
                  for (const occupant of assignment[target.slot]) {
                    if (!members || members.includes(operators.get(occupant).charId)) accumulate(operatorTotals.get(occupant), effect, value);
                  }
                } else accumulate(roomTotals.get(target.slot), effect, value);
              }
            }
          }
        }
      }
    }
  }
  // 下限约束作用于合计容量，不能先截断某个干员的减益再加上队友增益。
  for (const [slot, minimum] of capacityFloors) {
    const totals = roomTotals.get(slot);
    const capacity = values(totals).capacity;
    if (capacity < minimum) accumulate(totals, { stat: 'capacity', stacking: 'sum' }, minimum - capacity);
  }
  // 派生效率在所有人员的直接容量效果之后计算，避免依赖遍历顺序。
  const directValues = new Map([...roomTotals].map(([slot, totals]) => [slot, values(totals)]));
  for (const { slot, id, effect, buffId } of derived) {
    if (['teammateProduction', 'localOrderSpeed'].includes(effect.basis)) continue;
    if (effect.basis === 'orderVacancy') {
      const room = snapshot.rooms.find(room => room.slot === slot);
      const base = catalog.tradingData?.phases?.[room.level - 1]?.orderLimit;
      if (!Number.isSafeInteger(base) || base < 1 || !Number.isSafeInteger(room.stockCount) || room.stockCount < 0) {
        const error = new MechanismError(buffId);
        error.code = 'MISSING_MECHANISM_STATE';
        throw error;
      }
      const vacancy = Math.max(0, base + (directValues.get(slot).capacity ?? 0) - room.stockCount);
      accumulate(roomTotals.get(slot), effect, vacancy * effect.value);
      accumulate(localOrderTotals.get(slot), effect, vacancy * effect.value);
      continue;
    }
    if (effect.basis === 'contactBelow') {
      if ((directValues.get(slot).contactSpeed ?? 0) + effect.base < effect.threshold) {
        accumulate(roomTotals.get(slot), effect, effect.value);
      }
      continue;
    }
    if (effect.basis === 'operatorCapacityTier') {
      const production = [...capacityBySource.get(slot).values()].reduce((total, capacity) =>
        total + Math.max(0, capacity) * (capacity > effect.threshold ? effect.upperValue : effect.value), 0);
      accumulate(roomTotals.get(slot), effect, production);
      recordProduction(slot, id, effect, production);
      continue;
    }
    const capacity = values(roomTotals.get(slot)).capacity ?? 0;
    const factor = effect.step ? Math.floor(Math.max(0, capacity) / effect.step) : Math.max(0, capacity);
    const production = Math.min(effect.cap ?? Infinity, factor * effect.value);
    accumulate(roomTotals.get(slot), effect, production);
    recordProduction(slot, id, effect, production);
    if (effect.stat === 'orderSpeed') accumulate(localOrderTotals.get(slot), effect, production);
  }
  // 房内直接及容量派生加成参与分档，外部中枢和分档自身不参与放大。
  for (const { slot, effect } of derived.filter(entry => entry.effect.basis === 'localOrderSpeed')) {
    const speed = values(localOrderTotals.get(slot)).orderSpeed ?? 0;
    const steps = Math.floor(Math.max(0, speed) / effect.step + 1e-10);
    accumulate(roomTotals.get(slot), effect, Math.min(effect.cap, steps * effect.value));
  }
  // 读取直接与容量派生的队友贡献，不将设施数量或外部中枢加成再放大。
  for (const { slot, id, effect } of derived.filter(entry => entry.effect.basis === 'teammateProduction')) {
    const teammates = [...productionBySource.get(slot)].filter(([source]) => source !== id)
      .reduce((total, [, totals]) => total + (values(totals).production ?? 0), 0);
    const steps = Math.floor(Math.max(0, teammates) / effect.step + 1e-10);
    accumulate(roomTotals.get(slot), effect, Math.min(effect.cap, steps * effect.value));
  }
  return {
    rooms: Object.fromEntries([...roomTotals].map(([slot, totals]) => [slot, values(totals)])),
    operators: Object.fromEntries([...operatorTotals].map(([id, totals]) => [id, values(totals)])),
    sources,
  };
}
