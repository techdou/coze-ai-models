#!/usr/bin/env node
/**
 * asr.mjs — 语音识别（POST /audio/transcriptions，JSON body + base64 音频）。
 * 网关要求 JSON 而非 multipart；音频文件读取后 base64 编码放入 audio 字段。
 *
 * 用法：
 *   node scripts/asr.mjs --file audio.mp3 [--model doubao-asr] [--language zh]
 *
 * 输出：stdout JSON { text, raw }。
 */
import { gateway, parseArgs, fail } from './gateway.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv);
if (!args.file) fail('缺少 --file（音频文件路径，mp3/wav）');

const filePath = resolve(String(args.file));
let b64;
try {
  b64 = readFileSync(filePath).toString('base64');
} catch (e) {
  fail(`无法读取音频文件: ${filePath}`, e.message);
}

// 网关要求 JSON body；实测（2026-10-09）正确字段为 base64（纯 base64 串）或 url（http[s] URL，非 data:）
const model = args.model ?? 'doubao-asr';
const candidates = [{ model, base64: b64 }];

let lastBody = null;
for (const body of candidates) {
  try {
    const { data } = await gateway('/audio/transcriptions', {
      method: 'POST',
      body,
      timeoutMs: 180_000,
      retries: 1,
      quiet: true,
    });
    const text = data?.text ?? data?.output?.text ?? null;
    console.log(JSON.stringify({ text, raw: data }, null, 2));
    process.exit(0);
  } catch (e) {
    lastBody = e;
    // 4xx 参数类错误才尝试下一字段名；5xx/网络错误由 gateway 已重试过
    if (e.status && e.status >= 500) fail('ASR 服务端错误', e.body ?? e.message);
  }
}
fail('ASR 调用失败（base64 字段）', lastBody?.body ?? lastBody?.message);
