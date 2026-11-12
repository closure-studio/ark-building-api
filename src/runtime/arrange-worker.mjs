import { parentPort, workerData } from 'node:worker_threads';
import { arrangePreview } from '../arrange.mjs';

try {
  const { preview, diagnostics } = arrangePreview(workerData.input, workerData.catalog, { maxNodes: workerData.maxNodes });
  const result = {
    data: preview,
    diagnostics: {
      ...diagnostics, compatibility: 'arkhost-assignment-v1', blockers: [],
      scope: 'single-arrangement', gameExecutionVerified: false,
    },
  };
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  // 只传原因码，不传原始异常消息、堆栈或请求；HTTP端仍须用白名单映射。
  parentPort.postMessage({ ok: false, code: error?.code ?? 'INTERNAL_ERROR' });
}
