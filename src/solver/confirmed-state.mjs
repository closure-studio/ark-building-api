import { isDeepStrictEqual } from 'node:util';
import { unlockedBuffs } from '../data/catalog.mjs';
import { validateAssignment } from '../validate/assignment.mjs';
import { compileBuff, registeredSkill } from '../mechanisms/compile.mjs';
import { skillRegistry } from '../mechanisms/registry.mjs';
import { confirmedStateRules } from '../mechanisms/confirmed-state-rules.mjs';
import { evaluateModifiers, MechanismError } from '../mechanisms/evaluate.mjs';
import { evaluateMood } from '../mechanisms/mood.mjs';
import { productionObjective } from './objective.mjs';
import { SearchError } from './search.mjs';

function requireState(condition, buffId) {
  if (condition) return;
  const error = new MechanismError(buffId);
  error.code = 'MISSING_MECHANISM_STATE';
  throw error;
}
const effect = (stat, value, scope = 'room', extra = {}) => ({ stat, value, scope, stacking: 'sum', ...extra });

function identityBonus(rule, target, catalog, buffId) {
  if (rule.targetName) {
    requireState(typeof catalog.characterNames[target.charId] === 'string', buffId);
    return catalog.characterNames[target.charId] === rule.targetName ? 0.45 : 0;
  }
  if (rule.targetFaction) {
    const factions = catalog.characterAffiliations?.[target.charId];
    requireState(Array.isArray(factions), buffId);
    return factions.includes(rule.targetFaction) ? 0.45 : 0;
  }
  if (rule.hunter) {
    const groups = ['cc.tag.mh', 'cc.tag.mh2'].map(key => catalog.operatorGroups?.[key]);
    requireState(groups.every(Array.isArray), buffId);
    return groups.some(group => group.includes(target.charId)) ? 0.45 : 0;
  }
  return 0;
}

export function applyConfirmedDormEntry(snapshot, assignment, catalog, event) {
  if (event?.scenario !== 'confirmed-dorm-entry') throw new SearchError('STATE_SCENARIO_REQUIRED', 422);
  if (!isDeepStrictEqual(event.assignment, assignment)) throw new SearchError('STATE_ASSIGNMENT_MISMATCH', 422);
  validateAssignment(snapshot, assignment, catalog);
  const buffId = 'dorm_exchangeAp[000]';
  const source = snapshot.operators.find(op => op.instId === event.sourceId);
  const room = snapshot.rooms.find(room => room.type === 'DORMITORY' && assignment[room.slot].includes(event.sourceId));
  requireState(source && room, buffId);
  const buff = unlockedBuffs(catalog, source).find(buff => buff.buffId === buffId);
  requireState(buff && registeredSkill(buff), buffId);
  requireState(event.previousId === null || (Number.isSafeInteger(event.previousId) && event.previousId !== source.instId
    && assignment[room.slot].includes(event.previousId)), buffId);
  const maxAp = catalog.chars[source.charId].maxManpower;
  requireState(Number.isSafeInteger(maxAp) && maxAp > 0 && Number.isFinite(source.ap) && source.ap >= 0 && source.ap <= maxAp, buffId);
  const result = structuredClone(snapshot);
  if (source.ap !== maxAp || event.previousId === null) return result;
  const previous = result.operators.find(op => op.instId === event.previousId);
  requireState(Number.isFinite(previous.ap) && previous.ap >= 0 && previous.ap <= maxAp
    && catalog.chars[previous.charId].maxManpower === maxAp, buffId);
  result.operators.find(op => op.instId === event.sourceId).ap = previous.ap;
  previous.ap = source.ap;
  return result;
}

/** 调用者提供已确认且绑定本次安排的状态；不读取或推断原始workTime/历史目标。 */
export function evaluateConfirmedStateCandidate(snapshot, assignment, catalog, state, registry = skillRegistry) {
  if (state?.scenario !== 'confirmed-current-state') throw new SearchError('STATE_SCENARIO_REQUIRED', 422);
  if (!isDeepStrictEqual(state.assignment, assignment)) throw new SearchError('STATE_ASSIGNMENT_MISMATCH', 422);
  validateAssignment(snapshot, assignment, catalog);
  const rooms = new Map(snapshot.rooms.flatMap(room => (assignment[room.slot] ?? []).map(id => [id, room])));
  const operators = new Map(snapshot.operators.map(op => [op.instId, op]));
  const boostedSlots = new Set(snapshot.rooms.filter(room => room.type === 'DORMITORY'
    && (assignment[room.slot] ?? []).some(id => operators.has(id) && unlockedBuffs(catalog, operators.get(id))
      .some(buff => buff.buffId === 'dorm_rec_toone[000]'))).map(room => room.slot));
  for (const room of snapshot.rooms.filter(room => boostedSlots.has(room.slot))) {
    requireState(assignment[room.slot].every(id => typeof catalog.characterNames[operators.get(id)?.charId] === 'string'), 'dorm_rec_toone[000]');
  }
  const clueGuarantees = [];
  const resolveSkill = (buff, operator) => {
    const room = rooms.get(operator.instId);
    const entry = registeredSkill(buff, registry);
    if (room && Object.hasOwn(registry, buff.buffId) && !entry) throw new MechanismError(buff.buffId);
    const rule = confirmedStateRules[buff.buffId];
    if (!rule || !room || room.type !== buff.roomType) {
      const compiled = compileBuff(buff, catalog.characterNames, registry);
      if (compiled.status !== 'compiled' || room?.type !== 'DORMITORY' || buff.roomType !== 'DORMITORY'
        || !boostedSlots.has(room.slot) || catalog.characterNames[operator.charId] !== '推进之王') return compiled;
      return { ...compiled, effects: compiled.effects.flatMap(value => {
        if (value.stat !== 'moodRecovery' || !['others', 'occupants'].includes(value.scope)) return [value];
        return assignment[room.slot].filter(id => value.scope === 'occupants' || id !== operator.instId).map(id => {
          const factions = catalog.characterAffiliations?.[operators.get(id).charId];
          requireState(Array.isArray(factions), 'dorm_rec_toone[000]');
          return { ...value, scope: 'confirmedTarget', targetInstId: id, value: value.value + (factions.includes('格拉斯哥帮') ? 0.3 : 0) };
        });
      }) };
    }
    const id = operator.instId;
    let effects;
    if (rule.kind === 'hours') {
      const hours = state.completedWorkHours?.[id];
      requireState(Number.isSafeInteger(hours) && hours >= 0, buff.buffId);
      const value = rule.threshold ? (hours >= rule.threshold ? rule.cap : rule.initial)
        : Math.min(rule.cap, rule.initial + hours * rule.increment);
      effects = [effect(rule.stat, value)];
    } else if (rule.kind === 'exchange') {
      requireState(typeof state.clueExchangeActive === 'boolean', buff.buffId);
      effects = [effect('clueSpeed', state.clueExchangeActive ? 0.3 : 0)];
    } else if (rule.kind === 'training') {
      requireState(typeof state.trainingActive === 'boolean', buff.buffId);
      effects = [effect('trainingSpeed', state.trainingActive ? 0.05 : 0, 'room', { stacking: 'max' })];
    } else if (rule.kind === 'clueGuarantee') {
      const consumed = state.soloConsumedMood?.[id];
      requireState(Number.isFinite(consumed) && consumed >= 0, buff.buffId);
      clueGuarantees.push({ sourceId: id, slot: room.slot,
        faction: assignment[room.slot].length === 1 && consumed > 16 ? rule.faction : null });
      effects = [];
    } else if (rule.kind === 'siegeRecovery') {
      effects = [];
    } else if (rule.kind === 'entry') {
      requireState(Array.isArray(state.resolvedEntryEventIds) && state.resolvedEntryEventIds.includes(id), buff.buffId);
      effects = [];
    } else {
      const target = state.dormTargets?.[id];
      requireState(target === null || (Number.isSafeInteger(target) && (rule.allowSelf || target !== id)
        && assignment[room.slot].includes(target)), buff.buffId);
      const targetOperator = snapshot.operators.find(value => value.instId === target);
      const value = target === null ? 0 : rule.value + identityBonus(rule, targetOperator, catalog, buff.buffId);
      effects = target === null ? [] : [effect('moodRecovery', value, 'confirmedTarget',
        { targetInstId: target, stacking: 'max', stackingGroup: 'singleTarget' })];
      if (rule.self) effects.push(effect('moodRecovery', rule.self, 'self'));
      if (rule.notes) effects.push(effect('resource', 1, 'room', { resource: 'notes', basis: 'roomLevel' }));
    }
    return compileBuff(buff, catalog.characterNames, { [buff.buffId]: { ...entry, effects } });
  };
  const modifiers = evaluateModifiers(snapshot, assignment, catalog, registry, resolveSkill);
  const mood = evaluateMood(snapshot, assignment, catalog, modifiers);
  const base = productionObjective(snapshot, assignment, catalog, modifiers);
  const limitations = ['STATE_PROVENANCE_AND_TIMING_UNCONFIRMED', 'CONFIRMED_ASSIGNMENT_ONLY',
    ...(clueGuarantees.length ? ['CLUE_VALUE_NOT_RANKED'] : []),
    ...(Object.values(modifiers.rooms).some(room => Object.hasOwn(room, 'trainingSpeed')) ? ['TRAINING_VALUE_NOT_RANKED'] : [])];
  const objective = { ...base, limitations: [...base.limitations, ...limitations] };
  return { scenario: state.scenario, modifiers, mood, objective, clueGuarantees,
    trainingSpeedBonus: Math.max(0, ...Object.values(modifiers.rooms).map(room => room.trainingSpeed ?? 0)),
    limitations };
}
