import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/data/catalog.mjs';
import { buildCoverageReport } from '../src/data/report.mjs';
import { dataPin } from '../src/data/pin.mjs';

try {
  const { values } = parseArgs({ options: { 'data-dir': { type: 'string' } }, allowPositionals: false });
  const directory = values['data-dir'] ?? fileURLToPath(new URL('../data/ArknightsGamedataPure/', import.meta.url));
  const catalog = await loadCatalog(directory, dataPin);
  console.log(JSON.stringify(buildCoverageReport(catalog), null, 2));
} catch {
  console.error('数据检查失败：请检查参数、数据目录及锁定版本。');
  process.exitCode = 1;
}
