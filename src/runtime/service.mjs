import { loadCatalog } from '../data/catalog.mjs';
import { createExecutor } from './executor.mjs';
import { createLocalServer } from './http.mjs';

/** 本地预览宿主：启动时只读装载并校验数据，单次请求不访问文件或网络。 */
export async function createSchedulingService({ dataDirectory, pin, maxNodes = 2000, timeoutMs = 5000, maxQueue = 2 } = {}) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new RangeError('无效节点预算');
  const catalog = await loadCatalog(dataDirectory, pin);
  const executor = createExecutor(new URL('./arrange-worker.mjs', import.meta.url), { timeoutMs, maxQueue });
  const http = createLocalServer({ execute: async (input, context) => {
    const envelope = await executor.run({ input, catalog, maxNodes }, context);
    if (!envelope.ok) throw Object.assign(new Error('领域计算失败'), { code: envelope.code });
    return envelope.result;
  } });
  let closing;
  return {
    listen: port => http.listen(port),
    close() {
      closing ??= Promise.all([http.close(), executor.close()]).then(() => undefined);
      return closing;
    },
  };
}
