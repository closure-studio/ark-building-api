import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/data/catalog.mjs';
import { buildCoverageReport } from '../src/data/report.mjs';
import { dataPin } from '../src/data/pin.mjs';

try {
  parseArgs({ options: {}, allowPositionals: false });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = await loadCatalog(fileURLToPath(new URL('../data/ArknightsGamedataPure/', import.meta.url)), dataPin);
  // node:test 的内部上下文会让嵌套子进程输出非 TAP；验证进程必须独立运行。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--test', '--test-reporter=tap', 'test/mechanisms/locked-goldens.test.mjs'],
    { cwd: root, env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const passed = Number(/^# pass (\d+)$/m.exec(stdout)?.[1]);
  const failed = Number(/^# fail (\d+)$/m.exec(stdout)?.[1]);
  const ids = new Set([...stdout.matchAll(/^ok \d+ - 锁定技能数值 (.+)$/gm)].map(match => match[1].trim()));
  if (!Number.isSafeInteger(passed) || passed <= 0 || failed !== 0 || !ids.size) throw new Error('无有效数值证据');
  const report = buildCoverageReport(catalog);
  for (const id of ids) {
    const row = report.rows.find(row => row.buffId === id);
    if (!row || row.status !== 'compiled') throw new Error('数值证据与覆盖清单不一致');
    row.goldenEvidence = { scope: 'skill-increments', test: `锁定技能数值 ${id}`,
      fixture: 'test/fixtures/direct-goldens.mjs', source: row.source };
    row.unverifiedRequirements = row.unverifiedRequirements.filter(item => item !== 'EXACT_BUFF_GOLDEN_CASE');
  }
  // 技能增量的通过记录不是游戏完整公式、叠加组合或真实消费方验收。
  report.goldenVerification = { command: 'node --test --test-reporter=tap test/mechanisms/locked-goldens.test.mjs',
    passed, failed, skills: ids.size, verifiedAt: new Date().toISOString() };
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('数值证据验证失败：请检查参数、锁定数据及黄金测试。');
  process.exitCode = 1;
}
