import { DataError } from '../data/catalog.mjs';

function replayDormSeats(seats, occupants, onRemove, onEnter) {
  const remove = index => {
    const previous = seats[index];
    seats[index] = -1;
    return onRemove(previous);
  };
  for (let index = 0; index < Math.max(seats.length, occupants.length); index++) {
    const next = occupants[index] ?? -1;
    if ((seats[index] ?? -1) === next) continue;
    if (!remove(index)) return false;
    const previousIndex = next > 0 ? seats.indexOf(next) : -1;
    if (previousIndex !== -1 && !remove(previousIndex)) return false;
    seats[index] = next;
    if (!onEnter(next, index)) return false;
  }
  return true;
}

/** 仅使用已给定心情和座位事件；undefined表示不能证明目标，不猜历史或同值优先级。 */
export function resolveDormTarget(room, occupants, sourceId, operators, catalog,
  { allowSelf = false, events = [], outsideDeparture = false } = {}) {
  const seats = [...(room.originalSeats ?? room.occupants)];
  const source = operators.get(sourceId);
  if ([...seats, ...occupants].some(id => id > 0
    && (!Number.isSafeInteger(catalog.chars[operators.get(id)?.charId]?.maxManpower)
      || catalog.chars[operators.get(id).charId].maxManpower <= 0))) throw new DataError();
  if (Object.hasOwn(source, 'confirmedDormTarget')) {
    const target = source.confirmedDormTarget;
    return target === null || (Number.isSafeInteger(target) && occupants.includes(target)
      && (allowSelf || target !== sourceId)) ? target : undefined;
  }
  const changedAp = new Map();
  const ap = id => changedAp.get(id) ?? operators.get(id).ap;
  const eligible = () => seats.filter(id => id > 0 && (allowSelf || id !== sourceId))
    .filter(id => ap(id) < catalog.chars[operators.get(id).charId]?.maxManpower);
  let active = seats.includes(sourceId);
  let target = null;
  if (active) {
    // 已满人员也可能仍被历史锁定，不能仅凭当前AP把他们从历史目标中排除。
    const possible = seats.filter(id => id > 0 && (allowSelf || id !== sourceId));
    if (possible.length > 1 || (possible.length === 1 && !eligible().includes(possible[0]))) return undefined;
    target = possible[0] ?? null;
  }
  const initialTarget = target;
  const originallyActive = active;
  const refresh = () => {
    if (!active) return true;
    if (target !== null && seats.includes(target)) return true;
    const possible = eligible();
    const lowest = Math.min(...possible.map(ap));
    const selected = possible.filter(id => ap(id) === lowest);
    if (selected.length > 1) return false;
    target = selected[0] ?? null;
    return true;
  };
  const known = replayDormSeats(seats, occupants, previous => {
    if (previous === sourceId) active = false;
    if (previous === target) target = null;
    return refresh();
  }, (next, index) => {
    for (const event of events.filter(event => event.index === index)) {
      // PRTS说明锁定至回满及同位绑定，但未证实交换填满目标后是否立即重新选人。
      if (event.previousId === target) return false;
      changedAp.set(event.sourceId, event.sourceAp);
      changedAp.set(event.previousId, event.previousAp);
    }
    if (next === sourceId) active = true;
    return refresh();
  });
  const bindingKept = originallyActive && target === initialTarget && (target === null
    || (room.originalSeats ?? room.occupants).indexOf(target) === occupants.indexOf(target));
  // 接口未承诺跨房提交顺序；原锁定目标先去别房可能改变本房重新选人的时点。
  return known && (!outsideDeparture || bindingKept) ? target : undefined;
}

export function dormIdentityBonus(effect, target, catalog) {
  if (effect.targetName) {
    const name = catalog.characterNames[target.charId];
    return typeof name === 'string' ? Number(name === effect.targetName) * 0.45 : undefined;
  }
  if (effect.targetFaction) {
    const factions = catalog.characterAffiliations?.[target.charId];
    return Array.isArray(factions) ? Number(factions.includes(effect.targetFaction)) * 0.45 : undefined;
  }
  if (effect.hunter) {
    const groups = ['cc.tag.mh', 'cc.tag.mh2'].map(key => catalog.operatorGroups?.[key]);
    return groups.every(Array.isArray) ? Number(groups.some(group => group.includes(target.charId))) * 0.45 : undefined;
  }
  return 0;
}

/** 旧队列只给在场集合，不声称掌握其历史进驻顺序。 */
export function resolveDormExchanges(room, occupants, operators, catalog, exchangeIds) {
  const seats = [...(room.originalSeats ?? room.occupants)];
  const previousOld = new Set(seats.filter(id => id > 0));
  const newEntries = [];
  const ap = new Map();
  const events = [];
  const known = replayDormSeats(seats, occupants, previous => {
    previousOld.delete(previous);
    const index = newEntries.indexOf(previous);
    if (index !== -1) newEntries.splice(index, 1);
    return true;
  }, (next, index) => {
    if (exchangeIds.has(next)) {
      const source = operators.get(next);
      const maximum = catalog.chars[source.charId]?.maxManpower;
      const sourceBefore = ap.get(next) ?? source.ap;
      if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new DataError();
      if (!Number.isFinite(sourceBefore) || sourceBefore < 0 || sourceBefore > maximum) return false;
      if (sourceBefore === maximum) {
        if (!newEntries.length && previousOld.size > 1) return false;
        const previousId = newEntries.at(-1) ?? [...previousOld][0] ?? null;
        if (previousId !== null) {
          if (!occupants.includes(previousId)) return false;
          const previous = operators.get(previousId);
          const previousBefore = ap.get(previousId) ?? previous.ap;
          const previousMaximum = catalog.chars[previous.charId]?.maxManpower;
          if (!Number.isSafeInteger(previousMaximum) || previousMaximum <= 0) throw new DataError();
          if (previousMaximum !== maximum || !Number.isFinite(previousBefore)
            || previousBefore < 0 || previousBefore > maximum) return false;
          ap.set(next, previousBefore);
          ap.set(previousId, sourceBefore);
          events.push({ slot: room.slot, index, sourceId: next, previousId,
            sourceBefore, previousBefore, sourceAp: previousBefore, previousAp: sourceBefore });
        }
      }
    }
    if (next > 0) newEntries.push(next);
    return true;
  });
  return known ? events : undefined;
}
