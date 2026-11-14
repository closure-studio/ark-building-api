import { createServer } from 'node:http';

const errors = {
  INVALID_JSON: [400, '请求不是有效JSON'],
  INVALID_REQUEST: [400, '请求中的基建数据无效'],
  DATA_MISMATCH: [422, '请求与锁定的游戏数据不兼容'],
  DATA_NOT_READY: [503, '锁定的游戏数据未就绪'],
  UNISOLATABLE_MECHANISM: [422, '未支持机制无法安全隔离，未生成新安排'],
  INVALID_FROZEN_ASSIGNMENT: [422, '受保护的原安排不满足合法性要求'],
  UNSUPPORTED_MECHANISM: [422, '当前方案包含尚未支持的完整技能效果'],
  MISSING_MECHANISM_STATE: [422, '机制计算缺少必要状态'],
  UNKNOWN_MOOD_DEPENDENCY: [422, '心情依赖无法可靠计算'],
  NO_EVALUABLE_ASSIGNMENT: [422, '未找到可可靠求值的合法安排'],
  SEARCH_BUDGET_EXCEEDED: [503, '搜索预算内未获得合法安排'],
  INVALID_PRODUCTION_RATE: [422, '生产速率无法可靠计算'],
  UNSUPPORTED_MEDIA_TYPE: [415, '仅支持application/json'],
  REQUEST_TOO_LARGE: [413, '请求超过大小限制'],
  NOT_FOUND: [404, '接口不存在'],
  METHOD_NOT_ALLOWED: [405, '不支持此请求方法'],
  SERVICE_BUSY: [503, '计算容量已满'],
  SERVICE_CLOSED: [503, '服务正在关闭'],
  COMPUTE_TIMEOUT: [503, '计算超出时间预算'],
  WORKER_FAILED: [500, '计算线程异常'],
  INTERNAL_ERROR: [500, '排班服务内部错误'],
};

/** 仅绑定回环地址；execute负责领域校验，宿主只处理传输和请求生命周期。 */
export function createLocalServer({ execute, maxBodyBytes = 1024 * 1024, maxRequests = 8 } = {}) {
  if (typeof execute !== 'function' || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1
    || !Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new RangeError('无效的HTTP配置');
  const tasks = new Set();
  let closed = false;
  let closing;
  function reply(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  function fail(res, code) {
    if (!Object.hasOwn(errors, code)) code = 'INTERNAL_ERROR';
    const [status, message] = errors[code];
    reply(res, status, { error: { code, message } });
  }
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5000 }, async (req, res) => {
    if (closed) { fail(res, 'SERVICE_CLOSED'); req.resume(); return; }
    if (req.url === '/health' && req.method === 'GET') {
      reply(res, 200, { status: 'ok', busy: tasks.size > 0 }); req.resume(); return;
    }
    if (req.url !== '/api/v1/arrange') { fail(res, 'NOT_FOUND'); req.resume(); return; }
    if (req.method !== 'POST') { fail(res, 'METHOD_NOT_ALLOWED'); req.resume(); return; }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      fail(res, 'UNSUPPORTED_MEDIA_TYPE'); req.resume(); return;
    }
    if (tasks.size >= maxRequests) { fail(res, 'SERVICE_BUSY'); req.resume(); return; }
    const controller = new AbortController();
    const task = { controller, done: undefined };
    tasks.add(task);
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnected);
    let finish;
    task.done = new Promise(resolve => { finish = resolve; });
    try {
      const chunks = [];
      let length = 0;
      // 使用事件监听而非提前退出async iterator，保证413响应发出前不销毁socket。
      const body = await new Promise((resolve, reject) => {
        const abort = () => reject(new Error('REQUEST_ABORTED'));
        controller.signal.addEventListener('abort', abort, { once: true });
        req.on('data', chunk => {
          length += chunk.length;
          if (length > maxBodyBytes) {
            fail(res, 'REQUEST_TOO_LARGE');
            controller.abort();
          } else chunks.push(chunk);
        });
        req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.once('error', reject);
        req.once('close', () => controller.signal.removeEventListener('abort', abort));
      });
      let input;
      try { input = JSON.parse(body); }
      catch { fail(res, 'INVALID_JSON'); return; }
      if (!input || typeof input !== 'object' || Array.isArray(input)) { fail(res, 'INVALID_REQUEST'); return; }
      const result = await execute(input, { signal: controller.signal });
      reply(res, 200, result);
    } catch (error) {
      if (!controller.signal.aborted) fail(res, error?.code);
    } finally {
      res.removeListener('close', disconnected);
      tasks.delete(task);
      finish();
    }
  });
  return {
    listen(port = 0) {
      if (closed) return Promise.reject(new Error('服务已关闭'));
      return new Promise((resolve, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve(server.address());
        });
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      const pending = [...tasks];
      for (const task of pending) task.controller.abort();
      closing = Promise.all([
        ...pending.map(task => task.done),
        new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
      ]).then(() => undefined);
      return closing;
    },
  };
}
