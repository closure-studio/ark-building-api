import { parentPort, workerData } from 'node:worker_threads';

if (workerData.mode === 'hang') {
  while (true) { /* 模拟不能合作取消的CPU搜索，必须由宿主终止。 */ }
} else if (workerData.mode === 'throw') {
  throw new Error('private-worker-path-and-input');
} else if (workerData.mode === 'exit') {
  process.exit(0);
} else {
  setTimeout(() => parentPort.postMessage({ value: workerData.value }), workerData.delay ?? 0);
}
