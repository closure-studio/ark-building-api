import { unlockedBuffs } from '../data/catalog.mjs';
import { compileBuff } from '../mechanisms/compile.mjs';

function* combinations(values, count, start = 0, picked = []) {
  if (!count) { yield picked; return; }
  for (let i = start; i <= values.length - count; i++) {
    yield* combinations(values, count - 1, i + 1, [...picked, values[i]]);
  }
}

function mergeBindings(...groups) {
  const slots = new Map();
  for (const [slot, id] of groups.flat()) {
    if (slots.has(id) && slots.get(id) !== slot) return null;
    slots.set(id, slot);
  }
  return [...slots].map(([id, slot]) => [slot, id]);
}

function* distribute(members, targets, bindings, index = 0) {
  if (index === members.length) { yield bindings; return; }
  for (const target of targets) {
    const next = mergeBindings(bindings, [[target.slot, members[index]]]);
    if (next && next.filter(([slot]) => slot === target.slot).length <= target.capacity) {
      yield* distribute(members, targets, next, index + 1);
    }
  }
}

/** 只从已解锁、指纹一致的关系生成候选；模板不负责给完整方案打分。 */
export function createGroupNeighbors(snapshot, catalog, isolation, registry) {
  const fixed = new Set([...snapshot.reservedIds, ...isolation.excludedIds,
    ...snapshot.rooms.filter(room => isolation.frozenSlots.includes(room.slot)).flatMap(room => room.occupants)]);
  const operators = snapshot.operators.filter(op => !fixed.has(op.instId) && op.ap > catalog.tiredApThreshold);
  const healthy = new Set(operators.map(op => op.instId));
  const rooms = snapshot.rooms.filter(room => !isolation.frozenSlots.includes(room.slot));
  const rules = [], extraRules = [], resourceEntries = [];
  for (const op of operators) for (const buff of unlockedBuffs(catalog, op)) {
    const effects = compileBuff(buff, catalog.characterNames, registry).effects ?? [];
    for (const room of rooms.filter(room => room.type === buff.roomType)) {
      const localPartners = new Set();
      for (const effect of effects) {
        if (effect.formula && effect.formula !== catalog.manufactFormulas?.[room.formulaId]?.buffType) continue;
        if (['resource', 'resourceConversion'].includes(effect.stat) || effect.basis === 'resource') {
          resourceEntries.push({ effect, binding: [room.slot, op.instId], type: room.type });
        }
        if (['targetGroupProduct', 'operatorGroupCount'].includes(effect.basis)
          && ['production', 'orderSpeed'].includes(effect.stat)) {
          const targets = rooms.filter(target => target.type === effect.partnerRoomType);
          const partners = operators.filter(other => other.instId !== op.instId
            && catalog.operatorGroups?.[effect.operatorGroup]?.includes(other.charId)).map(other => other.instId);
          const size = Math.min(partners.length, targets.reduce((sum, target) => sum + target.capacity, 0));
          if (size) extraRules.push({ type: room.type, groups: function* () {
            for (let count = size; count > 0; count--) for (const members of combinations(partners, count)) {
              yield* distribute(members, targets, [[room.slot, op.instId]]);
            }
          } });
        }
        if (effect.partnerCharId && !effect.partnerRole) {
          for (const partner of operators.filter(other => other.charId === effect.partnerCharId && other.instId !== op.instId)) {
            const targets = effect.baseOccupants ? rooms.filter(target => !effect.workplaceOnly || target.type !== 'DORMITORY')
              : effect.partnerRoomType ? rooms.filter(target => target.type === effect.partnerRoomType) : [room];
            for (const target of targets) {
              rules.push({ type: room.type, bindings: [[room.slot, op.instId], [target.slot, partner.instId]] });
              if (target.slot === room.slot) localPartners.add(partner.instId);
            }
          }
        }
        if (effect.basis === 'localFactionCount') {
          const partners = operators.filter(other => other.instId !== op.instId
            && catalog.characterAffiliations?.[other.charId]?.includes(effect.faction)).map(other => other.instId);
          if (partners.length) rules.push({ type: room.type, slot: room.slot, source: op.instId,
            partners, size: Math.min(room.capacity - 1, partners.length) });
        }
      }
      if (localPartners.size > 1 && localPartners.size < room.capacity) {
        rules.push({ type: room.type, bindings: [[room.slot, op.instId], ...[...localPartners].map(id => [room.slot, id])] });
      }
    }
  }
  // 沿登记的资源关系回溯来源；合并兼容分支，保留单支备选，不枚举全部来源子集。
  function resourcePaths(resource, visiting = new Set()) {
    if (visiting.has(resource)) return [];
    const next = new Set([...visiting, resource]), paths = [];
    let combined = [];
    for (const entry of resourceEntries.filter(({ effect }) => effect.resource === resource
      && ['resource', 'resourceConversion'].includes(effect.stat))) {
      const tails = entry.effect.stat === 'resourceConversion'
        ? resourcePaths(entry.effect.sourceResource, next) : [[]];
      for (const tail of tails) {
        const bindings = mergeBindings([entry.binding], tail);
        if (!bindings) continue;
        paths.push(bindings);
        combined = mergeBindings(combined, bindings) ?? combined;
        if (paths.length >= 32) return [combined, ...paths];
      }
    }
    return paths.length ? [combined, ...paths] : [];
  }
  for (const entry of resourceEntries.filter(({ effect }) => effect.basis === 'resource'
    && ['production', 'orderSpeed'].includes(effect.stat))) {
    for (const path of resourcePaths(entry.effect.resource)) {
      const bindings = mergeBindings([entry.binding], path);
      if (bindings) {
        const fillsDorm = resourceEntries.some(({ effect, binding }) => effect.stat === 'resource'
          && effect.basis === 'baseOccupants' && effect.partnerRoomType === 'DORMITORY'
          && bindings.some(([slot, id]) => slot === binding[0] && id === binding[1]));
        extraRules.push({ type: entry.type, bindings,
          fillSlots: fillsDorm ? rooms.filter(room => room.type === 'DORMITORY').map(room => room.slot) : [] });
      }
    }
  }
  // 生产关系先试；不根据单人分数删除伙伴，也不把优先级当作收益上界。
  rules.sort((a, b) => Number(!['MANUFACTURE', 'TRADING'].includes(a.type))
    - Number(!['MANUFACTURE', 'TRADING'].includes(b.type)));
  // 保留旧关系的尝试顺序；扩展关系只使用同一预算的余量。
  rules.push(...extraRules);
  return function* groupNeighbors(base) {
    const seen = new Set([JSON.stringify(base)]);
    let attempts = 0;
    for (const rule of rules) {
      const groups = rule.groups ? rule.groups() : rule.bindings ? [rule.bindings] : (function* () {
        for (const members of combinations(rule.partners, rule.size)) {
          yield [[rule.slot, rule.source], ...members.map(id => [rule.slot, id])];
        }
      })();
      for (const bindings of groups) {
        if (++attempts > 512) return;
        const moving = new Set(bindings.map(([, id]) => id));
        const required = new Map();
        for (const [slot, id] of bindings) {
          if (!required.has(slot)) required.set(slot, []);
          required.get(slot).push(id);
        }
        if ([...required].some(([slot, ids]) => ids.length > rooms.find(room => room.slot === slot).capacity)) continue;
        const next = structuredClone(base), displaced = [];
        for (const room of rooms) next[room.slot] = next[room.slot].filter(id => !moving.has(id));
        for (const [slot, ids] of required) {
          const room = rooms.find(room => room.slot === slot);
          const keep = next[slot].slice(0, room.capacity - ids.length);
          displaced.push(...next[slot].slice(keep.length));
          next[slot] = [...keep, ...ids];
        }
        if (displaced.some(id => !healthy.has(id))) continue;
        // 优先补回组合成员腾出的原岗位，避免无故损失其他房间的生产。
        for (const id of displaced) {
          const target = rooms.find(room => !required.has(room.slot) && base[room.slot].some(id => moving.has(id))
            && next[room.slot].length < room.capacity);
          if (target) next[target.slot].push(id);
        }
        const used = new Set(Object.values(next).flat());
        for (const slot of rule.fillSlots ?? []) {
          const room = rooms.find(room => room.slot === slot);
          for (const op of operators) {
            if (next[slot].length >= room.capacity) break;
            if (!used.has(op.instId)) { next[slot].push(op.instId); used.add(op.instId); }
          }
        }
        const signature = JSON.stringify(next);
        if (seen.has(signature)) continue;
        seen.add(signature);
        yield next;
      }
    }
  };
}
