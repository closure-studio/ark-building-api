import { cpus, platform, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/data/catalog.mjs';
import { buildCoverageReport } from '../src/data/report.mjs';
import { arrangePreview } from '../src/arrange.mjs';
import { baseLayout } from '../test/fixtures/base-layout.mjs';
import { dataPin } from '../test/fixtures/player.mjs';

const dataDir = process.argv[2] ?? fileURLToPath(new URL('../data/ArknightsGamedataPure', import.meta.url));
const samples = Number(process.env.BENCH_SAMPLES ?? 3), maxNodes = Number(process.env.BENCH_NODES ?? 2000);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100 || !Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new RangeError('非法基准参数');
const start = performance.now();
const catalog = await loadCatalog(dataDir, dataPin);
const coldLoadMs = performance.now() - start;
const charIds = Object.keys(catalog.chars).sort();
const cases = [];
for (const layout of ['252', '243']) {
  for (const size of [80, charIds.length]) {
    const input = baseLayout(charIds.slice(0, size), layout), runs = [];
    for (let i = 0; i < samples; i++) {
      const t = performance.now();
      try {
        const result = arrangePreview(input, catalog, { maxNodes });
        runs.push({ ms: performance.now() - t, nodes: result.diagnostics.search.nodes,
          mode: result.diagnostics.mode, excluded: result.diagnostics.excludedIds.length,
          assigned: Object.values(result.preview.arranged).flat().reduce((sum, room) => sum + room.RoomChar.length, 0),
          rest: result.diagnostics.rest, exhausted: result.diagnostics.search.exhausted });
      } catch (error) { runs.push({ ms: performance.now() - t, error: error.code ?? error.message }); }
    }
    const timings = runs.map(run => run.ms).sort((a, b) => a - b);
    const percentile = q => timings[Math.ceil(q * timings.length) - 1];
    cases.push({ layout, rosterSize: size, level: 'phase0-level1', maxNodes, samples,
      p50Ms: percentile(0.5), p95Ms: percentile(0.95), runs });
  }
}
console.log(JSON.stringify({ environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model, memoryGiB: totalmem() / 2 ** 30 },
  dataVersion: catalog.version, coldLoadMs, coverage: buildCoverageReport(catalog).summary,
  limitations: ['合成玩家/初始练度，不是精二全技能质量验收', '有限样本P95，不是生产SLA', '返回可行预览不代表找到生产最优或完整兼容'], cases }, null, 2));
