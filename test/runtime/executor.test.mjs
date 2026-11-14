import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutor } from '../../src/runtime/executor.mjs';

const workerUrl = new URL('../fixtures/runtime-worker.mjs', import.meta.url);

test('单worker与有限队列：满载立即拒绝，结束后后续任务可运行', async t => {
  const executor = createExecutor(workerUrl, { maxQueue: 1, timeoutMs: 2000 });
  t.after(() => executor.close());
  const first = executor.run({ delay: 50, value: 1 });
  const second = executor.run({ value: 2 });
  await assert.rejects(executor.run({ value: 3 }), { code: 'SERVICE_BUSY', status: 503 });
  assert.deepEqual(await first, { value: 1 });
  assert.deepEqual(await second, { value: 2 });
  assert.deepEqual(await executor.run({ value: 4 }), { value: 4 });
});

test('超时强制终止死循环，释放容量，不把私有错误暴露到外层', async t => {
  const executor = createExecutor(workerUrl, { timeoutMs: 300 });
  t.after(() => executor.close());
  await assert.rejects(executor.run({ mode: 'hang' }), { code: 'COMPUTE_TIMEOUT', status: 503 });
  assert.deepEqual(await executor.run({ value: 5 }), { value: 5 });
  await assert.rejects(executor.run({ mode: 'throw' }), error => error.code === 'WORKER_FAILED'
    && error.status === 500 && !error.message.includes('private'));
  await assert.rejects(executor.run({ mode: 'exit' }), { code: 'WORKER_FAILED' });
  assert.deepEqual(await executor.run({ value: 6 }), { value: 6 });
});

test('排队与运行中取消均释放任务；取消前已完成的任务不受影响', async t => {
  const executor = createExecutor(workerUrl, { maxQueue: 1, timeoutMs: 2000 });
  t.after(() => executor.close());
  const running = new AbortController();
  const queued = new AbortController();
  const first = assert.rejects(executor.run({ mode: 'hang' }, { signal: running.signal }), { code: 'REQUEST_ABORTED' });
  const second = assert.rejects(executor.run({ value: 2 }, { signal: queued.signal }), { code: 'REQUEST_ABORTED' });
  queued.abort();
  await second;
  running.abort();
  await first;
  assert.deepEqual(await executor.run({ value: 3 }), { value: 3 });
  await assert.rejects(executor.run({}, { signal: queued.signal }), { code: 'REQUEST_ABORTED' });
});

test('关闭等待worker真正退出，拒绝运行和排队任务，重复关闭安全', async () => {
  const executor = createExecutor(workerUrl, { maxQueue: 1, timeoutMs: 2000 });
  const first = assert.rejects(executor.run({ mode: 'hang' }), { code: 'SERVICE_CLOSED' });
  const second = assert.rejects(executor.run({ value: 2 }), { code: 'SERVICE_CLOSED' });
  await executor.close();
  await Promise.all([first, second]);
  await executor.close();
  await assert.rejects(executor.run({}), { code: 'SERVICE_CLOSED' });
});

test('不可克隆请求不会占用容量；无效预算在创建前拒绝', async t => {
  const executor = createExecutor(workerUrl);
  t.after(() => executor.close());
  await assert.rejects(executor.run({ value: () => 1 }), { code: 'WORKER_FAILED' });
  assert.deepEqual(await executor.run({ value: 7 }), { value: 7 });
  for (const options of [{ maxQueue: -1 }, { maxQueue: 1.5 }, { timeoutMs: 0 }, { timeoutMs: Infinity }]) {
    assert.throws(() => createExecutor(workerUrl, options), RangeError);
  }
});
