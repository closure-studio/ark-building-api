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
  const candidate = { ...snapshot, rooms: snapshot.rooms,
    operators: snapshot.operators.map(operator => ({ ...operator })) };
  if (Object.hasOwn(state, 'completedWorkHours')) {
    requireState(state.completedWorkHours !== null && typeof state.completedWorkHours === 'object'
      && !Array.isArray(state.completedWorkHours), 'workHours');
    candidate.operators = snapshot.operators.map(operator => ({ ...operator,
      completedWorkHours: state.completedWorkHours[operator.instId] }));
  }
  if (Object.hasOwn(state, 'trainingActive')) {
    requireState(typeof state.trainingActive === 'boolean', 'control_train_spd[010]');
    candidate.trainingActive = state.trainingActive;
  }
  if (Object.hasOwn(state, 'clueExchangeActive')) {
    requireState(typeof state.clueExchangeActive === 'boolean', 'meet_spd&exchange[000]');
    candidate.rooms = snapshot.rooms.map(room => room.type === 'MEETING'
      ? { ...room, clueExchangeActive: state.clueExchangeActive } : room);
  }
  const rooms = new Map(snapshot.rooms.flatMap(room => (assignment[room.slot] ?? []).map(id => [id, room])));
  const clueGuarantees = [];
  const resolveSkill = (buff, operator) => {
    const room = rooms.get(operator.instId);
    const entry = registeredSkill(buff, registry);
    if (room && Object.hasOwn(registry, buff.buffId) && !entry) throw new MechanismError(buff.buffId);
    const rule = confirmedStateRules[buff.buffId];
    if (!rule || rule.kind === 'target' || !room || room.type !== buff.roomType) {
      const compiled = compileBuff(buff, catalog.characterNames, registry);
      if (room?.type === buff.roomType && compiled.effects?.some(effect => effect.scope === 'singleTarget')) {
        const target = state.dormTargets?.[operator.instId];
        requireState(target === null || (Number.isSafeInteger(target) && (rule?.allowSelf || target !== operator.instId)
          && assignment[room.slot].includes(target)), buff.buffId);
        candidate.operators.find(value => value.instId === operator.instId).confirmedDormTarget = target;
      }
      return compiled;
    }
    const id = operator.instId;
    let effects;
    if (rule.kind === 'clueGuarantee') {
      const consumed = state.soloConsumedMood?.[id];
      requireState(Number.isFinite(consumed) && consumed >= 0, buff.buffId);
      clueGuarantees.push({ sourceId: id, slot: room.slot,
        faction: assignment[room.slot].length === 1 && consumed > 16 ? rule.faction : null });
      effects = [];
    } else if (rule.kind === 'entry') {
      requireState(Array.isArray(state.resolvedEntryEventIds) && state.resolvedEntryEventIds.includes(id), buff.buffId);
      effects = [];
    }
    return compileBuff(buff, catalog.characterNames, { [buff.buffId]: { ...entry, effects } });
  };
  const modifiers = evaluateModifiers(candidate, assignment, catalog, registry, resolveSkill);
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
