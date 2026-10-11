#!/usr/bin/env node
/**
 * chat.mjs — LLM 对话 / 视觉理解（OpenAI 兼容 /chat/completions）。
 *
 * 用法：
 *   node scripts/chat.mjs --prompt "你好" [--model doubao-seed-2-0-pro-260215] [--system "角色设定"]
 *   node scripts/chat.mjs --prompt "描述这张图" --image https://...        # 图片 URL
 *   node scripts/chat.mjs --prompt "描述这段视频" --video https://...      # 视频 URL（实测可用）
 *   node scripts/chat.mjs --prompt "..." --json                            # 输出完整响应
 *
 * 输出：stdout JSON { model, content, usage }；退出码非 0 = 失败（原因在 stderr）。
 * 实测边界（2026-10-09）：素材 URL 仅支持 http/https（data: 会 400）；外网素材（如 Wikimedia）
 * 上游拉取可能 504 超时——素材建议先上传 coze 对象存储再传 URL。
 */
import { gateway, parseArgs, fail } from './gateway.mjs';

const args = parseArgs(process.argv);
if (!args.prompt) fail('缺少 --prompt');

const content = [{ type: 'text', text: String(args.prompt) }];
if (args.image) {
  const url = String(args.image);
  // 实测（2026-10-09）：网关 image_url.url 仅支持 http/https，data: URL 会 400。
  // 本地文件需先上传到对象存储拿 URL 再传入。
  if (!/^https?:\/\//.test(url)) {
    fail('--image 仅支持 http/https URL（网关不接受 data: URL）。本地文件请先上传对象存储获取 URL。');
  }
  content.push({ type: 'image_url', image_url: { url } });
}
if (args.video) {
  content.push({ type: 'video_url', video_url: { url: String(args.video) } });
}

const messages = [];
if (args.system) messages.push({ role: 'system', content: String(args.system) });
messages.push({ role: 'user', content });

try {
  const { data } = await gateway('/chat/completions', {
    method: 'POST',
    body: {
      model: args.model ?? 'doubao-seed-2-0-pro-260215',
      messages,
      stream: false,
    },
    timeoutMs: 180_000,
    retries: 2,
  });
  const reply = data?.choices?.[0]?.message?.content;
  if (reply === undefined) fail('响应缺少 choices[0].message.content', JSON.stringify(data));
  if (args.json) {
    console.log(JSON.stringify({ model: data.model, content: reply, usage: data.usage }, null, 2));
  } else {
    console.log(JSON.stringify({ model: data.model, content: reply, usage: data.usage }));
  }
} catch (e) {
  fail('LLM 调用失败', e.body ?? e.message);
}
