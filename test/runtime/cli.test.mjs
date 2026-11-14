import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const command = (name, args = []) => exec(process.execPath, [`${root}/scripts/${name}.mjs`, ...args], { cwd: root, timeout: 15000 });

test('数据检查CLI读取锁定版本并输出覆盖缺口，不把编译计为数值验收', async () => {
  const { stdout } = await command('check-data');
  const report = JSON.parse(stdout);
  assert.equal(report.summary.total, 542);
  assert.ok(report.summary.unsupported > 0);
  assert.equal(report.summary.numericallyVerified, 0);
  assert.equal(report.rows.length, 542);
  assert.match(report.version.characterSha256, /^[a-f0-9]{64}$/);
});

test('独立目录从其他工作目录启动时读取仓库内数据，并允许显式覆盖数据路径', async t => {
  const isolated = await mkdtemp(join(tmpdir(), 'scheduling-checkout-'));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  for (const name of ['src', 'scripts', 'data/ArknightsGamedataPure/excel']) {
    await cp(join(root, name), join(isolated, name), { recursive: true });
  }
  const script = join(isolated, 'scripts/check-data.mjs');
  const run = args => exec(process.execPath, [script, ...args], { cwd: root, timeout: 15000 });
  const { stdout } = await run([]);
  assert.equal(JSON.parse(stdout).summary.total, 542);
  await rm(join(isolated, 'data'), { recursive: true });
  await assert.rejects(run([]), error => error.code === 1 && !error.stderr.includes(isolated));
  const overridden = await run(['--data-dir', join(root, 'data/ArknightsGamedataPure')]);
  assert.equal(JSON.parse(overridden.stdout).summary.total, 542);
});

test('数值证据CLI实际运行锁定技能黄金测试并逐条关联，不冒充完整游戏验收', async () => {
  const { stdout } = await command('verify-data');
  const report = JSON.parse(stdout);
  assert.equal(report.summary.total, 542);
  assert.equal(report.summary.numericallyVerified, 0);
  assert.ok(report.goldenVerification.passed > 0);
  assert.equal(report.goldenVerification.failed, 0);
  const verified = report.rows.filter(row => row.goldenEvidence);
  assert.equal(verified.length, report.goldenVerification.skills);
  assert.ok(verified.length > 100);
  for (const buffId of ['manu_formula_spd[000]', 'dorm_hireToRecAll[000]', 'manu_prod_spd_train&lv[000]',
    'meet_spd_condChar[000]', 'manu_prod_spd_reduce[000]', 'dorm_rec_all&single[000]', 'trade_ord_spd&limit[101]',
    'trade_ord_limit&cost_P[000]', 'power_rec_spd_P[000]', 'control_mp_cost_double[001]',
    'control_mp_cost&faction[000]', 'manu_formula_spd&bd[001]', 'trade_ord_spd_par[001]',
    'hire_spd_dorm&lv[000]', 'dorm_rec_all&tired[000]', 'trade_ord_spd_ext[000]', 'control_dorm_rec2[000]']) {
    assert.ok(verified.some(row => row.buffId === buffId), `${buffId} 缺少实际运行的条件黄金证据`);
  }
  assert.ok(verified.every(row => row.status === 'compiled' && row.goldenEvidence.scope === 'skill-increments'));
  assert.ok(verified.every(row => !row.unverifiedRequirements.includes('EXACT_BUFF_GOLDEN_CASE')));
  assert.ok(verified.every(row => row.unverifiedRequirements.includes('DOMAIN_FORMULA_EVIDENCE')));
  assert.ok(report.rows.filter(row => row.status === 'unsupported').every(row => !row.goldenEvidence));
});

test('CLI拒绝未知选项、非法端口、缺值和坏数据路径，不输出内部路径堆栈', async () => {
  for (const [script, args] of [
    ['start', ['--port', '-1']], ['start', ['--port', '1.5']],
    ['start', ['--port']], ['start', ['--host', '0.0.0.0']],
    ['check-data', ['--data-dir', 'private-missing-data']],
    ['verify-data', ['--unknown']],
  ]) {
    await assert.rejects(command(script, args), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stderr.includes('private-missing-data'), false);
      assert.equal(error.stderr.includes(' at '), false);
      return true;
    });
  }
});

test('启动CLI只监听回环地址，返回健康状态与准确兼容标识', async t => {
  const child = spawn(process.execPath, [`${root}/scripts/start.mjs`, '--port', '0'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { child.kill(); await exited; });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动未就绪')), 15000);
    let output = '';
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`启动提前退出: ${code}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) {
        clearTimeout(timer);
        try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); }
      }
    });
  });
  assert.equal(address.host, '127.0.0.1');
  assert.equal(address.compatibility, 'arkhost-assignment-v1');
  const response = await fetch(`http://${address.host}:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});
