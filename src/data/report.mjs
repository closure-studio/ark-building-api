import { coverageInventory } from './catalog.mjs';
import { compileBuff } from '../mechanisms/compile.mjs';

const counts = () => ({ total: 0, compiled: 0, unsupported: 0, numericallyVerified: 0 });

/** 登记覆盖不是公式认证；只有真实黄金用例及公式证据才能提升数值验收状态。 */
export function buildCoverageReport(catalog, registry) {
  const summary = counts();
  const byRoom = {};
  const rows = coverageInventory(catalog).map(row => {
    const result = compileBuff(catalog.buffs[row.buffId], catalog.characterNames, registry);
    const room = byRoom[row.roomType] ??= counts();
    for (const counter of [summary, room]) { counter.total++; counter[result.status]++; }
    const families = result.status === 'compiled' ? [...new Set(result.effects.map(effect =>
      [effect.stat, effect.scope, effect.stacking, effect.basis ?? 'constant', effect.formula ?? 'any'].join('/')))].sort() : [];
    return { ...row, ...result, families, numericStatus: 'pending',
      unverifiedRequirements: ['EXACT_BUFF_GOLDEN_CASE', 'DOMAIN_FORMULA_EVIDENCE'] };
  });
  return { version: { ...catalog.version }, summary, byRoom, rows };
}
