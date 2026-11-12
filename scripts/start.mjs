import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSchedulingService } from '../src/runtime/service.mjs';
import { dataPin } from '../src/data/pin.mjs';

let service;
try {
  const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, port: { type: 'string' } }, allowPositionals: false });
  const portText = values.port ?? '8787';
  if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new RangeError('非法端口');
  const dataDirectory = values['data-dir'] ?? fileURLToPath(new URL('../data/ArknightsGamedataPure/', import.meta.url));
  service = await createSchedulingService({ dataDirectory, pin: dataPin });
  const address = await service.listen(Number(portText));
  const stop = () => { void service.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(JSON.stringify({ host: address.address, port: address.port, compatibility: 'arkhost-assignment-v1' }));
} catch {
  await service?.close();
  console.error('启动失败：请检查参数、数据版本或端口占用。');
  process.exitCode = 1;
}
