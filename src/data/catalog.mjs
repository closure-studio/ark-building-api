import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const targetTypes = new Set(['CONTROL', 'POWER', 'MANUFACTURE', 'TRADING', 'DORMITORY', 'MEETING', 'HIRE']);
export class DataError extends Error {
  constructor() {
    super('锁定的游戏数据未就绪');
    this.code = 'DATA_NOT_READY';
    this.status = 503;
  }
}
function check(ok) { if (!ok) throw new DataError(); }
function record(value) { check(value !== null && typeof value === 'object' && !Array.isArray(value)); return value; }
function integer(value, min, max = Number.MAX_SAFE_INTEGER) {
  check(Number.isSafeInteger(value) && value >= min && value <= max);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validate(data) {
  record(data);
  for (const field of ['chars', 'buffs', 'rooms', 'manufactFormulas']) record(data[field]);
  integer(data.manpowerDisplayFactor, 1);
  integer(data.tiredApThreshold, 0);
  integer(data.comfortLimit, 0);
  for (const [id, buff] of Object.entries(data.buffs)) {
    record(buff);
    check(buff.buffId === id && typeof buff.description === 'string');
    check(Object.hasOwn(data.rooms, buff.roomType));
  }
  for (const [id, char] of Object.entries(data.chars)) {
    record(char);
    check(char.charId === id);
    integer(char.maxManpower, data.tiredApThreshold + 1);
    check(Array.isArray(char.buffChar));
    for (const group of char.buffChar) {
      check(Array.isArray(record(group).buffData));
      const conditions = new Set();
      for (const entry of group.buffData) {
        record(entry); record(entry.cond);
        check(Object.hasOwn(data.buffs, entry.buffId));
        integer(entry.cond.phase, 0, 2); integer(entry.cond.level, 1, 90);
        const key = `${entry.cond.phase}:${entry.cond.level}`;
        check(!conditions.has(key)); conditions.add(key);
      }
    }
  }
  for (const room of Object.values(data.rooms)) {
    check(Array.isArray(record(room).phases) && room.phases.length > 0);
    for (const phase of room.phases) integer(record(phase).maxStationedNum, 0);
  }
  for (const formula of Object.values(data.manufactFormulas)) {
    check(Array.isArray(record(formula).requireRooms));
    for (const room of formula.requireRooms) {
      record(room); check(Object.hasOwn(data.rooms, room.roomId));
      integer(room.roomLevel, 1, data.rooms[room.roomId].phases.length);
    }
  }
}

/** 散列验证文件内容；commit是来源标识，不冒充已验证的Git工作树身份。 */
export async function loadCatalog(directory, pin) {
  try {
    check(/^[a-f0-9]{40}$/.test(pin?.commit) && /^[a-f0-9]{64}$/.test(pin?.buildingSha256));
    const bytes = await readFile(resolve(directory, 'excel/building_data.json'));
    check(createHash('sha256').update(bytes).digest('hex') === pin.buildingSha256);
    const data = JSON.parse(bytes.toString('utf8'));
    validate(data);
    const characterNames = {};
    const characterAffiliations = {};
    const characterSubProfessions = {};
    const operatorGroups = {};
    let teams;
    if (pin.teamSha256 !== undefined) {
      check(pin.characterSha256 !== undefined && /^[a-f0-9]{64}$/.test(pin.teamSha256));
      const teamBytes = await readFile(resolve(directory, 'excel/handbook_team_table.json'));
      check(createHash('sha256').update(teamBytes).digest('hex') === pin.teamSha256);
      teams = record(JSON.parse(teamBytes.toString('utf8')));
      for (const [id, team] of Object.entries(teams)) {
        check(record(team).powerId === id && typeof team.powerName === 'string' && team.powerName.trim().length > 0);
      }
    }
    if (pin.characterSha256 !== undefined) {
      check(/^[a-f0-9]{64}$/.test(pin.characterSha256));
      const characterBytes = await readFile(resolve(directory, 'excel/character_table.json'));
      check(createHash('sha256').update(characterBytes).digest('hex') === pin.characterSha256);
      const characters = record(JSON.parse(characterBytes.toString('utf8')));
      const alters = [];
      let hasCompleteAlterIdentity = true;
      for (const [id, character] of Object.entries(characters)) {
        const name = record(character).name;
        check(typeof name === 'string' && name.trim().length > 0);
        // 角色表还含同名召唤物；组合技能只能引用基建角色，不能因此制造姓名歧义。
        if (Object.hasOwn(data.chars, id)) {
          characterNames[id] = name;
          if (character.isSpChar === undefined) hasCompleteAlterIdentity = false;
          else {
            check(typeof character.isSpChar === 'boolean');
            if (character.isSpChar) alters.push(id);
          }
          if (character.subProfessionId !== undefined) {
            check(typeof character.subProfessionId === 'string' && character.subProfessionId.trim().length > 0);
            characterSubProfessions[id] = character.subProfessionId;
          }
          if (teams) {
            const labels = [];
            for (const key of ['nationId', 'groupId', 'teamId']) {
              const affiliation = character[key];
              check(affiliation === null || (typeof affiliation === 'string' && Object.hasOwn(teams, affiliation)));
              if (affiliation !== null) labels.push(teams[affiliation].powerName);
            }
            characterAffiliations[id] = [...new Set(labels)];
          }
        }
      }
      check(Object.keys(data.chars).every(id => Object.hasOwn(characterNames, id)));
      // 不完整的旧表保留未知状态，不能把缺字段的角色当成普通干员。
      if (hasCompleteAlterIdentity) operatorGroups['cc.g.sp'] = alters;
    }
    if (pin.constSha256 !== undefined) {
      check(pin.characterSha256 !== undefined && /^[a-f0-9]{64}$/.test(pin.constSha256));
      const constBytes = await readFile(resolve(directory, 'excel/gamedata_const.json'));
      check(createHash('sha256').update(constBytes).digest('hex') === pin.constSha256);
      const terms = record(record(JSON.parse(constBytes.toString('utf8'))).termDescriptionDict);
      for (const [termId, termName] of [['cc.tag.op', '作业平台'], ['cc.tag.mh', '怪物猎人小队'], ['cc.tag.mh2', '泡影国狩猎小队'], ['cc.tag.knight', '骑士'], ['cc.g.elite', '精英干员'], ['cc.tag.sees', 'S.E.E.S.'], ['cc.tag.durin', '杜林族'], ['cc.g.abyssal', '深海猎人']]) {
        // 旧版术语表可以缺少新增身份；求值时仍会明确拒绝缺失的身份条件。
        if (termId !== 'cc.tag.op' && !Object.hasOwn(terms, termId)) continue;
        const term = record(terms[termId]);
        check(term.termId === termId && term.termName === termName);
        check(typeof term.description === 'string');
        const names = /^包含以下干员\r?\n([^\r\n]+)$/.exec(term.description)?.[1].split('、');
        check(names?.length > 0 && new Set(names).size === names.length);
        operatorGroups[termId] = names.map(name => {
          const matches = Object.entries(characterNames).filter(([, value]) => value === name);
          check(matches.length === 1);
          return matches[0][0];
        });
      }
    }
    return freeze({ ...data, characterNames, characterAffiliations, characterSubProfessions, operatorGroups, version: { commit: pin.commit, buildingSha256: pin.buildingSha256,
      ...(pin.characterSha256 !== undefined ? { characterSha256: pin.characterSha256 } : {}),
      ...(pin.teamSha256 !== undefined ? { teamSha256: pin.teamSha256 } : {}),
      ...(pin.constSha256 !== undefined ? { constSha256: pin.constSha256 } : {}) } });
  } catch {
    // 路径、原始数据和JSON异常不得穿透HTTP错误边界。
    throw new DataError();
  }
}

export function unlockedBuffs(catalog, operator) {
  check(Object.hasOwn(catalog.chars, operator.charId));
  integer(operator.evolvePhase, 0, 2); integer(operator.level, 1, 90);
  const result = [];
  for (const group of catalog.chars[operator.charId].buffChar) {
    let selected;
    for (const entry of group.buffData) {
      const { phase, level } = entry.cond;
      const unlocked = operator.evolvePhase > phase || (operator.evolvePhase === phase && operator.level >= level);
      if (unlocked && (!selected || phase > selected.cond.phase || (phase === selected.cond.phase && level > selected.cond.level))) selected = entry;
    }
    if (selected) result.push(catalog.buffs[selected.buffId]);
  }
  return result;
}

/** 母集只说明待核查范围；支持状态必须由经过黄金测试的机制编译器给出。 */
export function coverageInventory(catalog) {
  const unlocks = new Map();
  for (const [charId, char] of Object.entries(catalog.chars)) {
    char.buffChar.forEach((group, slot) => {
      for (const entry of group.buffData) {
        const list = unlocks.get(entry.buffId) ?? [];
        list.push({ charId, slot, ...entry.cond });
        unlocks.set(entry.buffId, list);
      }
    });
  }
  return Object.values(catalog.buffs)
    .filter(buff => targetTypes.has(buff.roomType))
    .sort((a, b) => a.buffId.localeCompare(b.buffId, 'en'))
    .map(buff => ({ buffId: buff.buffId, roomType: buff.roomType, description: buff.description,
      status: 'unreviewed', unlocks: unlocks.get(buff.buffId) ?? [],
      source: `excel/building_data.json@${catalog.version.commit}#buffs/${buff.buffId}` }));
}
