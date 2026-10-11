#!/usr/bin/env node
/**
 * video_generate.mjs — Seedance 2.0 文生视频（POST /videos/generations + GET 轮询）。
 * 异步任务：提交返回 202 {id}，轮询同路径 GET 直到 succeeded/failed/cancelled。
 * 单次轮询网络失败自动跳过继续；轮询间隔 15s，默认上限 40 轮（约 10 分钟）。
 *
 * 用法：
 *   node scripts/video_generate.mjs --prompt "主体+动作+背景+镜头语言+光影" \
 *     [--duration 8] [--ratio 16:9] [--resolution 720p] [--out intro.mp4] \
 *     [--model doubao-seedance-2-0-260128] [--max-polls 40]
 *
 * 输出：stdout JSON { id, status, savedTo, bytes, videoUrl }；视频写入 --out（默认 output/video-<ts>.mp4）。
 * 实测（2026-10-09）：8s 720p 约 8 分钟完成；prompt 公式 = 主体+动作+背景+镜头语言+光影氛围，
 * 末尾追加正向质量约束「画面稳定无畸变、细节清晰、无文字水印」。
 * 稳定性说明：提交为非幂等 POST（retries=0，防重复计费）；轮询阶段网络失败自动跳过继续。
 */
import { gateway, parseArgs, fail, downloadTo } from './gateway.mjs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv);
if (!args.prompt) fail('缺少 --prompt');

const model = args.model ?? 'doubao-seedance-2-0-260128';
const maxPolls = Number(args['max-polls'] ?? 40);

// 1) 提交任务（POST 非幂等：自动重试可能造成重复计费任务，故 retries=0，失败由用户决定是否重跑）
let submit;
try {
  submit = await gateway('/videos/generations', {
    method: 'POST',
    body: {
      model,
      prompt: String(args.prompt),
      ...(args.duration ? { duration: Number(args.duration) } : {}),
      ...(args.ratio ? { ratio: String(args.ratio) } : {}),
      ...(args.resolution ? { resolution: String(args.resolution) } : {}),
    },
    timeoutMs: 60_000,
    retries: 0,
  });
} catch (e) {
  fail(
    '提交视频任务失败（注意：若为网络类错误，服务端可能已创建任务但响应丢失；无法按 prompt 查询任务，重跑本脚本可能产生重复计费任务）',
    e.body ?? e.message,
  );
}

const id = submit.data?.id;
if (!id) fail('提交响应缺少任务 id', JSON.stringify(submit.data).slice(0, 500));
console.error(`[video] 任务已入队: ${id}（status=${submit.data.status}）`);

// 2) 容错轮询（单次网络失败跳过继续，不计入轮次上限的失败重置）
let result = null;
for (let i = 1; i <= maxPolls; i++) {
  await new Promise((res) => setTimeout(res, 15_000));
  try {
    const { data } = await gateway(`/videos/generations/${id}`, { timeoutMs: 30_000, retries: 0, quiet: true });
    console.error(`[video] 轮询 ${i}/${maxPolls}: ${data.status}`);
    if (data.status === 'succeeded') {
      result = data;
      break;
    }
    if (['failed', 'cancelled'].includes(data.status)) {
      fail(`视频任务${data.status === 'failed' ? '失败' : '被取消'}`, data.error_message ?? JSON.stringify(data).slice(0, 500));
    }
  } catch (e) {
    console.error(`[video] 轮询 ${i}/${maxPolls} 网络异常，跳过: ${e.message}`);
  }
}
if (!result) fail(`轮询 ${maxPolls} 轮未完成，任务 id=${id}（可稍后手动查询）`);

// 3) 下载
const videoUrl = result.video_url ?? result.videoUrl;
if (!videoUrl) fail('任务成功但响应缺少 video_url', JSON.stringify(result).slice(0, 500));
const out = args.out ? resolve(String(args.out)) : resolve(`output/video-${Date.now()}.mp4`);
const { filePath, bytes } = await downloadTo(videoUrl, out);

console.log(JSON.stringify({ id, status: result.status, savedTo: filePath, bytes, videoUrl }, null, 2));
