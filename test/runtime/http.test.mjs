import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createLocalServer } from '../../src/runtime/http.mjs';
import { createExecutor } from '../../src/runtime/executor.mjs';

function send(port, body = '{}', { path = '/api/v1/arrange', method = 'POST', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method,
      headers: { 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
async function setup(t, options = {}) {
  const executor = createExecutor(new URL('../fixtures/runtime-worker.mjs', import.meta.url), {
    timeoutMs: 500, maxQueue: 0,
  });
  const service = createLocalServer({ execute: (input, context) => executor.run(input, context), ...options });
  const address = await service.listen();
  t.after(async () => { await service.close(); await executor.close(); });
  assert.equal(address.address, '127.0.0.1');
  return { ...service, port: address.port };
}

test('本地POST交给真实worker；计算占用期间健康检查不被阻塞，过载返回503', async t => {
  const server = await setup(t);
  const pending = send(server.port, JSON.stringify({ delay: 250, value: 8 }));
  // 等实际服务进入计算，而非仅假设客户端发送完成。
  while (!(await send(server.port, '', { method: 'GET', path: '/health' })).body.busy) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal((await send(server.port)).status, 503);
  assert.deepEqual(await pending, { status: 200, body: { value: 8 } });
});

test('格式、类型、大小和路由错误在进入计算前返回明确错误', async t => {
  let calls = 0;
  const server = await setup(t, { maxBodyBytes: 32, execute: async () => { calls++; return {}; } });
  const cases = [
    ['{', {}, 400, 'INVALID_JSON'],
    ['[]', {}, 400, 'INVALID_REQUEST'],
    ['null', {}, 400, 'INVALID_REQUEST'],
    ['{}', { headers: { 'content-type': 'text/plain' } }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['x'.repeat(33), {}, 413, 'REQUEST_TOO_LARGE'],
    ['{}', { path: '/other' }, 404, 'NOT_FOUND'],
    ['{}', { method: 'PUT' }, 405, 'METHOD_NOT_ALLOWED'],
  ];
  for (const [body, options, status, code] of cases) {
    const result = await send(server.port, body, options);
    assert.equal(result.status, status);
    assert.equal(result.body.error.code, code);
  }
  assert.equal(calls, 0);
});

test('worker崩溃与死循环脱敏，后续请求仍可执行', async t => {
  const server = await setup(t);
  for (const [mode, code, status] of [['throw', 'WORKER_FAILED', 500], ['hang', 'COMPUTE_TIMEOUT', 503]]) {
    const result = await send(server.port, JSON.stringify({ mode }));
    assert.equal(result.status, status);
    assert.equal(result.body.error.code, code);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.equal((await send(server.port, '{"value":9}')).body.value, 9);
});

test('陌生异常及伪造code/status不穿透错误边界', async t => {
  const server = await setup(t, { execute: async () => {
    throw Object.assign(new Error('token=secret'), { status: 418, code: 'secret-account' });
  } });
  assert.deepEqual(await send(server.port), {
    status: 500, body: { error: { code: 'INTERNAL_ERROR', message: '排班服务内部错误' } },
  });
});

test('客户端断开会取消CPU任务，关闭服务会取消所有未完成任务', async t => {
  const server = await setup(t);
  const req = request({ host: '127.0.0.1', port: server.port, path: '/api/v1/arrange', method: 'POST',
    headers: { 'content-type': 'application/json' } });
  req.on('error', () => {});
  req.end('{"mode":"hang"}');
  while (!(await send(server.port, '', { method: 'GET', path: '/health' })).body.busy) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  req.destroy();
  while ((await send(server.port, '', { method: 'GET', path: '/health' })).body.busy) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal((await send(server.port, '{"value":10}')).body.value, 10);
  const pending = send(server.port, '{"mode":"hang"}').catch(() => undefined);
  while (!(await send(server.port, '', { method: 'GET', path: '/health' })).body.busy) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await server.close();
  await pending;
  await server.close();
});
