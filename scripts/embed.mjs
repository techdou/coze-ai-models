#!/usr/bin/env node
/**
 * embed.mjs — 文本向量化（POST /embeddings，OpenAI 兼容）。
 *
 * 用法：
 *   node scripts/embed.mjs --input "要向量化的文本" [--model doubao-embedding-vision-251215] [--input-file f.txt]
 *
 * 输出：stdout JSON { model, dimensions, head(前8维), usage }；完整向量过大不直接输出。
 */
import { gateway, parseArgs, fail } from './gateway.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv);
let input = args.input ?? null;
if (!input && args['input-file']) {
  try {
    input = readFileSync(resolve(String(args['input-file'])), 'utf8');
  } catch (e) {
    fail(`无法读取 --input-file`, e.message);
  }
}
if (!input) fail('缺少 --input 或 --input-file');

const model = args.model ?? 'doubao-embedding-vision-251215';

try {
  const { data } = await gateway('/embeddings', {
    method: 'POST',
    body: { model, input },
    timeoutMs: 60_000,
    retries: 2,
  });
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) fail('响应缺少 data[0].embedding', JSON.stringify(data).slice(0, 500));
  console.log(JSON.stringify({ model: data.model, dimensions: vec.length, head: vec.slice(0, 8), usage: data.usage }, null, 2));
} catch (e) {
  fail('Embedding 调用失败', e.body ?? e.message);
}
