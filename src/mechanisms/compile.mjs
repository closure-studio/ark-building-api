import { createHash } from 'node:crypto';
import { skillRegistry } from './registry.mjs';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(skillRegistry);
const unknown = () => ({ status: 'unsupported', reason: 'UNRECOGNIZED_MECHANISM' });

/** 完整描述只校验漂移，不参与选择算法或提取参数。 */
export function registeredSkill(buff, registry = skillRegistry) {
  if (!buff || typeof buff.buffId !== 'string' || typeof buff.description !== 'string'
    || !Object.hasOwn(registry, buff.buffId)) return undefined;
  const entry = registry[buff.buffId];
  if (entry.roomType !== buff.roomType
    || entry.descriptionSha256 !== createHash('sha256').update(buff.description).digest('hex')) return undefined;
  return entry;
}

/** 显式登记不是公式认证；数值正确性仍由独立黄金测试验收。 */
export function compileBuff(buff, characterNames = {}, registry = skillRegistry) {
  const entry = registeredSkill(buff, registry);
  if (!entry?.effects) return unknown();
  for (const [id, name] of Object.entries(entry.partnerNames ?? {})) {
    if (characterNames[id] !== name || Object.values(characterNames).filter(value => value === name).length !== 1) return unknown();
  }
  return { status: 'compiled', effects: entry.effects };
}
