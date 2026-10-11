#!/usr/bin/env node
/**
 * update_models.mjs — 实时拉取 coze-coding-dev-sdk 支持的模型清单，更新 references/models.json
 *
 * 用法（在目标项目根目录执行，项目需已安装 coze-coding-dev-sdk）：
 *   node coze-ai-models/scripts/update_models.mjs
 *   node coze-ai-models/scripts/update_models.mjs --fallback-only
 *
 * 行为：
 *   1. 调用 SDK listModels() 拉取 LLM/视觉模型，按输入模态分类为 llm / vision
 *   2. 与内置静态媒体基线（Seedream / Seedance / TTS / Embedding）合并
 *   3. 写入 references/models.json（generatedAt + sdkSync 状态）
 *   4. 上游失败时不覆盖已有同步数据，回退静态基线并记录错误
 *
 * 退出码：0 = 成功产出 models.json（含上游失败但已回退）；非 0 = 文件写入失败等致命错误
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, listGatewayModels } from './config.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODELS_JSON_PATH = path.resolve(SCRIPT_DIR, '..', 'references', 'models.json');
const LIST_MODELS_TIMEOUT_MS = 20_000;

/** 静态媒体基线：SDK listModels 只覆盖 LLM/视觉模型，生图/生视频/语音/向量来自各官方技能文档 */
const STATIC_BASELINE = {
  image: [
    {
      id: 'doubao-seedream-5-0-260128',
      name: 'Seedream 5.0（默认）',
      type: 'image',
      description: '旗舰文生图/图生图/组图模型',
      default: true,
      source: 'static',
    },
    {
      id: 'doubao-seedream-4-5-251128',
      name: 'Seedream 4.5',
      type: 'image',
      description: '上一代生图模型，速度更快',
      source: 'static',
    },
  ],
  video: [
    {
      id: 'doubao-seedance-2-0-260128',
      name: 'Seedance 2.0（默认）',
      type: 'video',
      description: '文生视频/首尾帧/多模态参考（参考图+视频+音频）/同步音频生成',
      default: true,
      source: 'static',
    },
    // 2026-09-29 核对：SDK 官方文档与 Coze Model Hub registry 仅含 Seedance 2.0，
    // 网关 /v1/models 实测 video 组亦仅 Seedance 2.0；旧条目 doubao-seedance-1-0-pro-250528
    // 已从可用清单移除（如需了解请在 SDK 文档再确认）。
  ],
  embedding: [
    {
      id: 'doubao-embedding-vision-251215',
      name: 'Doubao Embedding Vision（默认）',
      type: 'embedding',
      description: '多模态向量化：文本/图片/视频，dimensions 512/1024/2048',
      default: true,
      source: 'static',
    },
  ],
  tts: {
    engine: 'TTSClient',
    defaultSpeaker: 'zh_female_xiaohe_uranus_bigtts',
    note: '完整音色清单见 references/audio-tts-asr.md（30+ 音色，按语言与风格分组）',
  },
  asr: {
    engine: 'ASRClient',
    model: 'doubao-asr',
    note: '语音识别。音频 ≤ 2 小时、≤ 100MB，支持 WAV/MP3/M4A/OGG OPUS，可 URL 或 Base64 提交；详细用法与限制见 references/audio-tts-asr.md',
  },
};

/** LLM 静态基线：listModels 不可用时的兜底（与 coze 官方技能文档当前清单一致） */
const STATIC_LLM_BASELINE = [
  {
    id: 'doubao-seed-2-0-pro-260215',
    name: 'Doubao Seed 2.0 Pro',
    type: 'llm',
    inputTypes: ['text', 'image', 'video'],
    outputTypes: ['text'],
    description: '旗舰级全能通用模型，复杂推理与长链路任务',
    default: true,
    source: 'static',
  },
  {
    id: 'doubao-seed-2-0-lite-260215',
    name: 'Doubao Seed 2.0 Lite',
    type: 'llm',
    inputTypes: ['text', 'image', 'video'],
    outputTypes: ['text'],
    description: '性能与成本均衡的通用模型',
    source: 'static',
  },
  {
    id: 'doubao-seed-2-0-mini-260215',
    name: 'Doubao Seed 2.0 Mini',
    type: 'llm',
    inputTypes: ['text', 'image', 'video'],
    outputTypes: ['text'],
    description: '低时延、高并发、成本敏感场景',
    source: 'static',
  },
  {
    id: 'glm-4-7-251222',
    name: 'GLM-4.7',
    type: 'llm',
    inputTypes: ['text'],
    outputTypes: ['text'],
    description: '智谱旗舰，编程与多步骤推理',
    source: 'static',
  },
];

const PROVIDER_RULES = [
  { match: /^(doubao|seed)/, provider: 'ByteDance' },
  { match: /^glm/, provider: 'Zhipu AI' },
  { match: /^deepseek/, provider: 'DeepSeek' },
  { match: /^(kimi|moonshot)/, provider: 'Moonshot AI' },
  { match: /^qwen/, provider: 'Alibaba' },
];

function inferProvider(modelId) {
  const lower = String(modelId || '').toLowerCase();
  const hit = PROVIDER_RULES.find((rule) => rule.match.test(lower));
  return hit ? hit.provider : 'Unknown';
}

function normalizeTypes(types) {
  if (!Array.isArray(types)) return [];
  return types
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim().toLowerCase());
}

/** LLMModelInfo → 统一条目；输入含 image/video 即视为视觉理解模型 */
function mapUpstreamModel(info) {
  const id = String(info?.model_id || '').trim();
  if (id === '') return null;

  const inputTypes = normalizeTypes(info?.input_types);
  const outputTypes = normalizeTypes(info?.output_types);
  const isVision = inputTypes.some((t) => t === 'image' || t === 'video');

  const name = String(info?.show_name || info?.model_name || id).trim();
  const description = String(info?.model_desc || '').trim();

  return {
    id,
    name,
    provider: inferProvider(id),
    type: isVision ? 'vision' : 'llm',
    inputTypes,
    outputTypes,
    ...(description !== '' ? { description } : {}),
    ...(info?.model_version ? { version: String(info.model_version).trim() } : {}),
    source: 'upstream',
  };
}

/** 读取之前 models.json 的 sdkSync（用于失败时保留上次成功同步的信息） */
function readPreviousSync() {
  try {
    if (!existsSync(MODELS_JSON_PATH)) return null;
    const parsed = JSON.parse(readFileSync(MODELS_JSON_PATH, 'utf8'));
    return parsed?.sdkSync ?? null;
  } catch {
    return null;
  }
}

/** 读取之前同步成功的上游条目（llm + vision），上游失败回退时避免丢数据 */
function readPreviousUpstreamModels() {
  try {
    if (!existsSync(MODELS_JSON_PATH)) return [];
    const parsed = JSON.parse(readFileSync(MODELS_JSON_PATH, 'utf8'));
    const models = parsed?.models ?? {};
    const entries = [...(Array.isArray(models.llm) ? models.llm : []), ...(Array.isArray(models.vision) ? models.vision : [])];
    return entries.filter((m) => m && m.source === 'upstream' && typeof m.id === 'string' && m.id !== '');
  } catch {
    return [];
  }
}

/** 按幂等 id 合并：当前清单优先，历史上游条目补位（去重） */
function mergePreviousUpstream(llmEntries, visionEntries) {
  const previous = readPreviousUpstreamModels();
  if (previous.length === 0) return { llm: llmEntries, vision: visionEntries };

  const byId = new Map();
  for (const entry of [...llmEntries, ...visionEntries]) byId.set(entry.id, entry);
  for (const entry of previous) if (!byId.has(entry.id)) byId.set(entry.id, entry);

  const merged = [...byId.values()];
  return {
    llm: merged.filter((entry) => entry.type !== 'vision'),
    vision: merged.filter((entry) => entry.type === 'vision'),
  };
}

async function loadSdk() {
  let mod;
  try {
    mod = await import('coze-coding-dev-sdk');
  } catch (err) {
    throw new Error(
      `未能加载 coze-coding-dev-sdk（${err?.code ?? err?.message ?? err}）。` +
      '请在项目根目录安装：pnpm add coze-coding-dev-sdk，或改用 --fallback-only 仅刷新静态基线。'
    );
  }
  return mod?.default && typeof mod.default.listModels === 'function' ? mod.default : mod;
}

async function fetchUpstreamModels() {
  const sdk = await loadSdk();
  if (typeof sdk.listModels !== 'function') {
    throw new Error('SDK 不含 listModels 导出（请升级 coze-coding-dev-sdk）');
  }
  const upstream = await Promise.race([
    sdk.listModels(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`listModels 超时（${LIST_MODELS_TIMEOUT_MS}ms）`)), LIST_MODELS_TIMEOUT_MS)
    ),
  ]);
  if (!Array.isArray(upstream)) {
    throw new Error('listModels 返回结构异常（非数组）');
  }
  return upstream;
}

async function main() {
  const fallbackOnly = process.argv.includes('--fallback-only');
  const now = new Date().toISOString();

  if (!fallbackOnly) {
    const gateway = loadConfig();
    if (gateway) {
      const models = await listGatewayModels(gateway);
      const destination = path.resolve(SCRIPT_DIR, '..', 'references', 'gateway-models.json');
      writeFileSync(destination, `${JSON.stringify({ generatedAt: now, source: 'gateway', baseURL: gateway.baseURL, models }, null, 2)}\n`, 'utf8');
      console.log(`[update] Gateway model list saved: ${models.length} models.`);
      return;
    }
  }

  let sdkSync;
  let llmEntries = [...STATIC_LLM_BASELINE];
  let visionEntries = [];

  if (fallbackOnly) {
    sdkSync = { success: false, skipped: true, error: null, upstreamCount: 0, attemptedAt: now };
    console.log('[update] --fallback-only：跳过上游调用，仅用静态基线刷新（保留历史上游条目）');
    ({ llm: llmEntries, vision: visionEntries } = mergePreviousUpstream(llmEntries, visionEntries));
  } else {
    try {
      const upstreamList = await fetchUpstreamModels();
      const mapped = upstreamList.map(mapUpstreamModel).filter(Boolean);

      const seen = new Set();
      for (const entry of mapped) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        if (entry.type === 'vision') visionEntries.push(entry);
        else llmEntries.push(entry);
      }

      sdkSync = {
        success: true,
        skipped: false,
        error: null,
        upstreamCount: mapped.length,
        attemptedAt: now,
      };
      console.log(`[update] 上游同步成功：${mapped.length} 个模型（llm ${llmEntries.length} / vision ${visionEntries.length}）`);
    } catch (error) {
      const previous = readPreviousSync();
      const reason = error?.message ?? String(error);
      const previousSuccess = previous?.success === true ? previous : null;
      sdkSync = {
        success: false,
        skipped: false,
        error: reason,
        upstreamCount: 0,
        attemptedAt: now,
        lastSuccessAt: previousSuccess?.attemptedAt ?? null,
      };
      console.warn(`[update] 上游同步失败，回退静态基线（保留历史上游条目）：${reason}`);
      ({ llm: llmEntries, vision: visionEntries } = mergePreviousUpstream(llmEntries, visionEntries));
    }
  }

  const payload = {
    generatedAt: now,
    sdkSync,
    models: {
      llm: llmEntries,
      vision: visionEntries,
      ...STATIC_BASELINE,
    },
  };

  try {
    writeFileSync(MODELS_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[update] 写入 ${MODELS_JSON_PATH} 失败：${error?.message ?? error}`);
    process.exit(1);
  }

  const groups = Object.entries(payload.models)
    .map(([key, value]) => `${key}:${Array.isArray(value) ? value.length : 'config'}`)
    .join('  ');
  console.log(`[update] 已更新 references/models.json（${groups}）`);
  console.log(
    sdkSync.success
      ? '[update] 数据源：Coze 上游实时同步'
      : '[update] 数据源：静态基线（上游不可用/跳过，不影响参考文档中的调用方式）'
  );
}

main().catch((error) => {
  console.error(`[update] 致命错误：${error?.message ?? error}`);
  process.exit(1);
});
