import { Worker } from 'node:worker_threads';

export class RuntimeError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

/** 单计算槽位；任务结算前确认线程退出，防止超时任务继续占用CPU。 */
export function createExecutor(workerUrl, { maxQueue = 2, timeoutMs = 5000 } = {}) {
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 0
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('无效的线程容量或时间预算');
  }
  const queue = [];
  let active;
  let closed = false;
  let closing;

  function pump() {
    if (active || closed || !queue.length) return;
    const task = queue.shift();
    active = task;
    try {
      task.worker = new Worker(workerUrl, { workerData: task.data });
      task.timer = setTimeout(() => settle(task, new RuntimeError('COMPUTE_TIMEOUT')), timeoutMs);
      task.worker.once('message', value => settle(task, null, value));
      task.worker.once('error', () => settle(task, new RuntimeError('WORKER_FAILED', 500)));
      task.worker.once('exit', () => settle(task, new RuntimeError('WORKER_FAILED', 500)));
    } catch {
      settle(task, new RuntimeError('WORKER_FAILED', 500));
    }
  }

  function settle(task, error, value) {
    if (task.finishing) return task.finished;
    task.finishing = true;
    clearTimeout(task.timer);
    task.signal?.removeEventListener('abort', task.abort);
    const queuedIndex = queue.indexOf(task);
    if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
    task.finished = (async () => {
      try {
        if (task.worker) await task.worker.terminate();
      } catch {
        error = new RuntimeError('WORKER_FAILED', 500);
      }
      if (active === task) active = undefined;
      if (error) task.reject(error);
      else task.resolve(value);
      pump();
    })();
    return task.finished;
  }

  return {
    run(data, { signal } = {}) {
      if (closed) return Promise.reject(new RuntimeError('SERVICE_CLOSED'));
      if (signal?.aborted) return Promise.reject(new RuntimeError('REQUEST_ABORTED', 499));
      if (active && queue.length >= maxQueue) return Promise.reject(new RuntimeError('SERVICE_BUSY'));
      let copy;
      try { copy = structuredClone(data); }
      catch { return Promise.reject(new RuntimeError('WORKER_FAILED', 500)); }
      return new Promise((resolve, reject) => {
        const task = { data: copy, signal, resolve, reject };
        task.abort = () => settle(task, new RuntimeError('REQUEST_ABORTED', 499));
        signal?.addEventListener('abort', task.abort, { once: true });
        queue.push(task);
        pump();
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      const tasks = [...queue, ...(active ? [active] : [])];
      closing = Promise.all(tasks.map(task => settle(task, new RuntimeError('SERVICE_CLOSED')))).then(() => undefined);
      return closing;
    },
  };
}
