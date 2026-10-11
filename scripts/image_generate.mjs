#!/usr/bin/env node
/**
 * image_generate.mjs — Seedream 文生图（/images/generations，同步返回）。
 * 生图耗时较长（数十秒），脚本默认 300s 超时 + 1 次重试。
 *
 * 用法：
 *   node scripts/image_generate.mjs --prompt "主体+行为+环境+风格光影" [--size 2K] [--out out.png]
 *       [--model doubao-seedream-5-0-260128] [--n 1]
 *
 * 输出：stdout JSON { model, savedTo, bytes, revisedPrompt? }；图片写入 --out（默认 output/image-<ts>.png）。
 */
import { gateway, parseArgs, fail, downloadTo } from './gateway.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv);
if (!args.prompt) fail('缺少 --prompt（文生图公式：主体+行为+环境+风格光影，文字内容加双引号，≤300 汉字）');

const model = args.model ?? 'doubao-seedream-5-0-260128';

try {
  const { data } = await gateway('/images/generations', {
    method: 'POST',
    body: {
      model,
      prompt: String(args.prompt),
      size: args.size ?? '2K',
      n: Number(args.n ?? 1),
      response_format: 'url',
    },
    timeoutMs: 300_000,
    retries: 1,
    quiet: true,
  });

  const items = data?.data;
  if (!Array.isArray(items) || items.length === 0) {
    fail('响应缺少 data[].url', JSON.stringify(data).slice(0, 800));
  }

  const saved = [];
  for (let i = 0; i < items.length; i++) {
    const url = items[i]?.url;
    if (!url) continue;
    // n>1 时自动加序号，避免 --out 覆盖同一路径
    let out;
    if (args.out) {
      const base = resolve(String(args.out));
      const dot = base.lastIndexOf('.');
      out = i > 0 && dot > 0 ? `${base.slice(0, dot)}-${i + 1}${base.slice(dot)}` : base;
    } else {
      out = resolve(`output/image-${Date.now()}${i > 0 ? `-${i}` : ''}.png`);
    }
    const { filePath, bytes } = await downloadTo(url, out);
    saved.push({ savedTo: filePath, bytes });
  }
  console.log(JSON.stringify({ model, count: saved.length, ...saved[0], all: saved, revisedPrompt: items[0]?.revised_prompt ?? null }, null, 2));
} catch (e) {
  fail('生图失败', e.body ?? e.message);
}
