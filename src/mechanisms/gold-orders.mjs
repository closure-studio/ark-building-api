// 只投影状态稳定且持续交付的新赤金订单；不代表当前订单或换班生效时点。
// 规则：https://prts.wiki/w/罗德岛基建/贸易站；speed含全部效率。
const probabilities = [[1, 0, 0], [0.6, 0.4, 0], [0.3, 0.5, 0.2]];
const seconds = [8640, 12600, 16560];
const keys = new Set(['level', 'speed', 'closure', 'pepe', 'forceTwo', 'breach', 'breachExtra', 'investment']);

export function projectGoldOrders(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !keys.has(key))) throw new RangeError('未知订单条件');
  const { level, speed, closure = false, pepe = false, forceTwo = false,
    breach = false, breachExtra = 0, investment = 0 } = options;
  if (![1, 2, 3].includes(level) || !Number.isFinite(speed) || speed <= 0
    || [closure, pepe, forceTwo, breach].some(value => typeof value !== 'boolean')
    || ![0, 1, 2].includes(breachExtra) || ![0, 250, 500].includes(investment)) {
    throw new RangeError('订单参数不合法');
  }

  let orders;
  if (pepe || closure) {
    orders = [{ probability: 1, gold: pepe ? 0 : 2, lmd: pepe ? 1000 : 1200,
      baseSeconds: pepe ? 16200 : 8640, kind: pepe ? 'pepe' : 'closure' }];
  } else {
    orders = probabilities[level - 1].flatMap((probability, index) => {
      if (probability === 0) return [];
      const originalGold = index + 2;
      let gold = originalGold;
      let lmd = gold * 500;
      let kind = 'ordinary';
      if (forceTwo) {
        gold = 2; lmd = 1000; kind = 'forceTwo';
      } else if (breach && originalGold < 4) {
        gold += breachExtra; lmd = gold * 500; kind = 'breach';
      } else if (investment && originalGold > 3) {
        lmd += investment; kind = 'investment';
      }
      return [{ probability, gold, lmd, baseSeconds: seconds[index], kind }];
    });
  }

  const meanGold = orders.reduce((sum, order) => sum + order.probability * order.gold, 0);
  const meanLmd = orders.reduce((sum, order) => sum + order.probability * order.lmd, 0);
  const meanSeconds = orders.reduce((sum, order) => sum + order.probability * order.baseSeconds, 0)
    / (pepe ? 1 : speed);
  // 连续交付的长期速率是总收益/总用时，不是逐档速率的概率平均。
  const lmdPerHour = meanLmd / meanSeconds * 3600;
  const goldPerHour = meanGold / meanSeconds * 3600;
  if (![meanSeconds, lmdPerHour, goldPerHour].every(Number.isFinite) || meanSeconds <= 0) {
    throw new RangeError('订单数值超出可计算范围');
  }
  return { orders, meanGold, meanLmd, meanSeconds, lmdPerHour, goldPerHour };
}
