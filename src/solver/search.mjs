import { AssignmentError, validateAssignment } from '../validate/assignment.mjs';
import { neighboringAssignments } from './neighbors.mjs';

export class SearchError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// 不对不同量纲加权；主目标支配时不允许辅助收益逆转，主目标相等才比辅助项。
function compare(left, right) {
  for (const key of ['primary', 'secondary']) {
    const more = left[key].some((value, i) => value > right[key][i]);
    const less = left[key].some((value, i) => value < right[key][i]);
    if (more && less) return 'incomparable';
    if (more) return 'better';
    if (less) return 'worse';
  }
  return 'equal';
}

/** 有界小阵容精确搜索。分数由领域求值器提供，不把通用搜索分数当游戏收益。 */
export function searchAssignments(snapshot, catalog, evaluate, { maxNodes = 100_000, frozenSlots = [], excludedIds = [], initialAssignments = [] } = {}) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new RangeError('maxNodes必须为正整数');
  if (!Array.isArray(excludedIds) || excludedIds.some(id => !snapshot.operators.some(op => op.instId === id))) {
    throw new RangeError('excludedIds必须引用快照中的人员');
  }
  const frozen = new Set(frozenSlots);
  const rooms = [...snapshot.rooms].sort((a, b) => a.slot.localeCompare(b.slot, 'en'));
  const assignment = Object.fromEntries(rooms.map(room => [room.slot, frozen.has(room.slot) ? [...room.occupants] : []]));
  validateAssignment(snapshot, assignment, catalog, frozenSlots);
  const unavailable = new Set([...snapshot.reservedIds, ...excludedIds, ...Object.values(assignment).flat()]);
  const operators = snapshot.operators.filter(operator => !unavailable.has(operator.instId)).sort((a, b) => a.instId - b.instId);
  const availableRooms = rooms.filter(room => !frozen.has(room.slot));
  const frontier = [];
  let dimensions;
  let nodes = 1;
  let evaluated = 0;
  let exhausted = true;

  function consider(proposed = assignment) {
    validateAssignment(snapshot, proposed, catalog, frozenSlots);
    if (availableRooms.some(room => proposed[room.slot].some(id => excludedIds.includes(id)))) throw new AssignmentError();
    const candidate = structuredClone(proposed);
    const score = evaluate(candidate);
    evaluated++;
    if (score === null) return;
    if (!score || !Array.isArray(score.primary) || !score.primary.length || !Array.isArray(score.secondary)
      || ![...score.primary, ...score.secondary].every(Number.isFinite)) throw new SearchError('INVALID_OBJECTIVE');
    const shape = `${score.primary.length}:${score.secondary.length}`;
    if (dimensions !== undefined && dimensions !== shape) throw new SearchError('INVALID_OBJECTIVE');
    dimensions = shape;
    // 求值器无权改变分配，保留搜索生成的方案而非其可能修改的入参。
    const result = { assignment: structuredClone(proposed), score: structuredClone(score) };
    const signature = JSON.stringify(result.assignment);
    for (const current of frontier) {
      const relation = compare(result.score, current.score);
      if (relation === 'worse' || (relation === 'equal' && signature >= JSON.stringify(current.assignment))) return;
    }
    for (let i = frontier.length - 1; i >= 0; i--) {
      const relation = compare(result.score, frontier[i].score);
      if (relation === 'better' || relation === 'equal') frontier.splice(i, 1);
    }
    frontier.push(result);
    return result;
  }

  // 首先检查真实空位/冻结安排，预算很小时也不虚构满编或把无结果说成无解。
  consider();
  for (const seed of initialAssignments) {
    if (nodes >= maxNodes) { exhausted = false; break; }
    nodes++;
    consider(seed);
  }
  // 先利用合法起点做完整方案的邻域求值，给DFS保留至少一半节点预算。
  // 这不是全局最优证明；小样本仍由下面的完整枚举验证组合解。
  const neighborhoodLimit = Math.floor(maxNodes / 2);
  const expanded = new Set();
  if (initialAssignments.length) {
    while (nodes < neighborhoodLimit) {
      let base = frontier.find(result => !expanded.has(JSON.stringify(result.assignment)));
      if (!base) break;
      expanded.add(JSON.stringify(base.assignment));
      // 每名候选仍检查全部去向，下一名接续严格改进；同分/不可比不强行换轨。
      for (const neighbor of neighboringAssignments(() => base.assignment, availableRooms, operators, catalog.tiredApThreshold)) {
        if (nodes >= neighborhoodLimit) break;
        nodes++;
        const improved = consider(neighbor);
        if (improved && compare(improved.score, base.score) === 'better') base = improved;
      }
    }
  }
  function visit(index) {
    if (nodes >= maxNodes) { exhausted = false; return; }
    nodes++;
    if (index === operators.length) { consider(); return; }
    const operator = operators[index];
    for (const room of availableRooms) {
      if (assignment[room.slot].length >= room.capacity
        || (room.type !== 'DORMITORY' && operator.ap <= catalog.tiredApThreshold)) continue;
      assignment[room.slot].push(operator.instId);
      visit(index + 1);
      assignment[room.slot].pop();
      if (!exhausted) return;
    }
    visit(index + 1);
  }
  visit(0);
  if (!frontier.length) throw new SearchError(exhausted ? 'NO_EVALUABLE_ASSIGNMENT' : 'SEARCH_BUDGET_EXCEEDED', exhausted ? 422 : 503);
  frontier.sort((a, b) => JSON.stringify(a.assignment).localeCompare(JSON.stringify(b.assignment), 'en'));
  return { frontier, nodes, evaluated, exhausted, stopReason: exhausted ? null : 'NODE_BUDGET' };
}
