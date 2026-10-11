#!/usr/bin/env node
/**
 * tts.mjs — 语音合成（POST /audio/speech，返回 mp3 二进制）。
 *
 * 用法：
 *   node scripts/tts.mjs --input "要合成的文本" [--voice zh_female_xiaohe_uranus_bigtts] [--out out.mp3]
 *       [--model doubao-tts]
 *
 * 输出：stdout JSON { savedTo, bytes }；音频写入 --out（默认 output/tts-<ts>.mp3）。
 */
import { gateway, parseArgs, fail } from './gateway.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv);
if (!args.input) fail('缺少 --input');

const model = args.model ?? 'doubao-tts';
const body = { model, input: String(args.input) };
if (args.voice) body.voice = String(args.voice);

let res;
try {
  res = await gateway('/audio/speech', {
    method: 'POST',
    body,
    timeoutMs: 120_000,
    retries: 2,
    parse: 'buffer',
  });
} catch (e) {
  fail('TTS 调用失败', e.body ?? e.message);
}

// 基本校验：mp3 帧头（ID3 或 0xFFF*）
const buf = res.data;
if (buf.length < 100 || !(buf.slice(0, 3).toString() === 'ID3' || buf[0] === 0xff)) {
  fail('响应不是音频数据', buf.slice(0, 200).toString('utf8'));
}

const out = args.out ? resolve(String(args.out)) : resolve(`output/tts-${Date.now()}.mp3`);
writeFileSync(out, buf);
console.log(JSON.stringify({ savedTo: out, bytes: buf.length, model }, null, 2));
