import { readFileSync } from 'node:fs';
import { skillRegistry } from '../../src/mechanisms/registry.mjs';
import { compileBuff as compile } from '../../src/mechanisms/compile.mjs';
import { planIsolation as isolate } from '../../src/mechanisms/isolation.mjs';
import { createIsolatedEvaluator as prepare, evaluateModifiers as evaluate } from '../../src/mechanisms/evaluate.mjs';
import { buildCoverageReport as report } from '../../src/data/report.mjs';

// 静态迁移输入，不是预期值或解析器；测试中的人工数值断言保持独立。
const records = new Map(JSON.parse(readFileSync(new URL('./mechanism-records.json', import.meta.url)),
  (_, value) => value === '__UNBOUNDED__' ? Infinity : value)
  .map(({ input, entries }) => [JSON.stringify(input), entries]));
export function fixtureRegistry(catalog) {
  const registry = { ...skillRegistry };
  for (const buff of Object.values(catalog.buffs)) {
    if (Object.hasOwn(skillRegistry, buff.buffId)) continue;
    const entries = records.get(JSON.stringify([buff.roomType, buff.description])) ?? [];
    const entry = entries.find(entry => Object.entries(entry.partnerNames ?? {})
      .every(([id, name]) => catalog.characterNames?.[id] === name));
    if (entry) registry[buff.buffId] = entry;
  }
  return registry;
}
export const compileBuff = (buff, characterNames = {}) => compile(buff, characterNames,
  fixtureRegistry({ buffs: { input: buff }, characterNames }));
export const planIsolation = (snapshot, catalog) => isolate(snapshot, catalog, fixtureRegistry(catalog));
export const createIsolatedEvaluator = (snapshot, catalog) => prepare(snapshot, catalog, fixtureRegistry(catalog));
export const evaluateModifiers = (snapshot, assignment, catalog) => evaluate(snapshot, assignment, catalog, fixtureRegistry(catalog));
export const evaluateIsolatedModifiers = (snapshot, assignment, catalog) => createIsolatedEvaluator(snapshot, catalog)(assignment);
export const buildCoverageReport = catalog => report(catalog, fixtureRegistry(catalog));
