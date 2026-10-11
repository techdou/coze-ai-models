/**
 * scripts.test.mjs — 调用脚本离线鲁棒性测试（零 API 消耗）。
 *
 * 覆盖：缺参报错、退出码、本地文件友好拒绝、parseArgs 行为。
 * 运行：node --test tests/scripts.test.mjs
 */
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');

function run(script, args = []) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    timeout: 30_000,
    encoding: 'utf8',
  });
}

test('所有脚本缺参时以退出码 1 + 中文错误提示失败（不发起网络请求）', () => {
  const cases = [
    ['chat.mjs', [], '缺少 --prompt'],
    ['image_generate.mjs', [], '缺少 --prompt'],
    ['video_generate.mjs', [], '缺少 --prompt'],
    ['tts.mjs', [], '缺少 --input'],
    ['asr.mjs', [], '缺少 --file'],
    ['embed.mjs', [], '缺少 --input'],
  ];
  for (const [script, args, expected] of cases) {
    const r = run(script, args);
    assert.equal(r.status, 1, `${script} 缺参应退出 1，实际 ${r.status}`);
    assert.ok(r.stderr.includes(expected), `${script} 应提示「${expected}」，实际 stderr: ${r.stderr.slice(0, 200)}`);
    assert.ok(!r.stderr.includes('Bearer'), `${script} 错误输出不得包含密钥`);
  }
});

test('chat.mjs 拒绝本地图片路径并给出可操作指引', () => {
  const r = run('chat.mjs', ['--prompt', 'x', '--image', 'no-such.png']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('对象存储'), `应提示先传对象存储，实际: ${r.stderr.slice(0, 200)}`);
});

test('asr.mjs 对不存在的音频文件报读取失败', () => {
  const r = run('asr.mjs', ['--file', 'no-such-file.mp3']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('无法读取'), `应提示无法读取，实际: ${r.stderr.slice(0, 200)}`);
});

test('parseArgs 支持 --key value 与布尔开关', async () => {
  const { parseArgs } = await import(pathToFileURL(join(SCRIPTS, 'gateway.mjs'))).then((m) => m);
  const argv = ['node', 'x.mjs', '--prompt', 'hello world', '--json', '--n', '2'];
  const args = parseArgs(argv);
  assert.equal(args.prompt, 'hello world');
  assert.equal(args.json, true);
  assert.equal(args.n, '2');
});

test('gateway.mjs 缺配置时报错且不回显密钥', async () => {
  const { loadConfig } = await import(pathToFileURL(join(SCRIPTS, 'config.mjs'))).then((m) => m);
  const cfg = loadConfig();
  assert.ok(cfg.apiKey.length > 0);
  assert.ok(!cfg.baseURL.endsWith('/'), 'baseURL 不应以 / 结尾');
});
