#!/usr/bin/env node
/**
 * 独立同步网关 /models 与 SDK listModels()，失败或跳过时保留上次同步的清单。
 * 用法：node update_models.mjs [--target gateway|sdk|all] [--fallback-only]
 * 默认 all；--fallback-only 只离线刷新 SDK 静态基线。
 * 退出码：0 = 已记录所选的同步结果（含上游失败/跳过）；非 0 = 参数或文件错误。
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadConfig, listGatewayModels } from './config.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = path.resolve(SCRIPT_DIR, '..', 'references');
const SDK_PACKAGE = 'coze-coding-dev-sdk';
const SDK_SKIP_REASON = '没有 SDK 开发者凭证：请导出 COZE_API_TOKEN 或登录 Coze CLI / 桌面端。';
const GATEWAY_SKIP_REASON = '未配置 COZE_MODELS_BASE_URL 和 COZE_MODELS_API_KEY。';
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

function readCatalog(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

function hasSdkCredential() {
  // 仅检查登录文件是否存在；凭证读取和校验由 SDK 处理。
  const home = path.join(homedir(), '.coze');
  return Boolean(process.env.COZE_API_TOKEN?.trim()) || [
    'cli/config.json', 'bridge/pat-token', 'desktop/runtime.beta.json', 'desktop/runtime.json',
  ].some((file) => existsSync(path.join(home, file)));
}

async function loadSdk() {
  let mod;
  try {
    const fromProject = createRequire(path.join(process.cwd(), 'package.json'));
    let entry;
    try {
      entry = pathToFileURL(fromProject.resolve(SDK_PACKAGE)).href;
    } catch {
      entry = import.meta.resolve(SDK_PACKAGE);
    }
    mod = await import(entry);
  } catch {
    throw new Error('未能加载 coze-coding-dev-sdk，请在项目根目录安装或升级 SDK。');
  }
  return mod?.default && typeof mod.default.listModels === 'function' ? mod.default : mod;
}

async function refreshSdk(fallbackOnly) {
  if (fallbackOnly) return { skipReason: '--fallback-only：仅刷新静态基线。' };
  if (!hasSdkCredential()) return { skipReason: SDK_SKIP_REASON };

  const sdk = await loadSdk();
  if (typeof sdk.listModels !== 'function') {
    throw new Error('SDK 不含 listModels 导出，请升级 coze-coding-dev-sdk。');
  }

  let timer;
  let upstream;
  const timeout = Symbol('timeout');
  try {
    upstream = await Promise.race([
      sdk.listModels(),
      new Promise((resolve) => { timer = setTimeout(resolve, LIST_MODELS_TIMEOUT_MS, timeout); }),
    ]);
  } catch (error) {
    const configError = error?.originalError ?? error;
    if (configError?.name === 'ConfigurationError' && (
      configError.message === 'project requires COZE_API_TOKEN' ||
      configError.message === 'Developer credential is unavailable; log in with Coze CLI first'
    )) return { skipReason: SDK_SKIP_REASON };
    // SDK 异常可能含请求信息；仅记录已知类别，不输出原始错误或响应体。
    if (Number.isInteger(error?.statusCode)) throw new Error(`SDK listModels 失败（HTTP ${error.statusCode}）。`);
    if (error?.name === 'NetworkError') throw new Error('SDK listModels 网络请求失败。');
    throw new Error('SDK listModels 未返回结果或调用失败。');
  } finally {
    clearTimeout(timer);
  }
  if (upstream === timeout) throw new Error(`SDK listModels 超时（${LIST_MODELS_TIMEOUT_MS}ms）。`);
  const models = Array.isArray(upstream) ? upstream.map(mapUpstreamModel).filter(Boolean) : [];
  if (models.length === 0) throw new Error('SDK listModels 返回清单为空或结构异常。');
  return { models: [...new Map(models.map((model) => [model.id, model])).values()] };
}

async function refreshGateway() {
  const gateway = loadConfig();
  if (!gateway) return { skipReason: GATEWAY_SKIP_REASON };
  const models = await listGatewayModels(gateway);
  if (models.length === 0) throw new Error('网关 /models 返回空清单。');
  return { baseURL: gateway.baseURL, models };
}

function buildSdkModels(previous, fresh) {
  const models = new Map(STATIC_LLM_BASELINE.map((model) => [model.id, model]));
  const cached = [previous?.llm, previous?.vision].filter(Array.isArray).flat();
  for (const model of fresh ?? cached) {
    if (model?.source !== 'upstream' || !model.id) continue;
    const isDefault = models.get(model.id)?.default;
    models.set(model.id, isDefault ? { ...model, default: true } : model);
  }
  return {
    llm: [...models.values()].filter((model) => model.type !== 'vision'),
    vision: [...models.values()].filter((model) => model.type === 'vision'),
    ...STATIC_BASELINE,
  };
}

async function updateCatalog(side, fallbackOnly) {
  const gateway = side === 'gateway';
  const name = gateway ? 'gateway-models.json' : 'models.json';
  const key = gateway ? 'gatewaySync' : 'sdkSync';
  const file = path.join(REFERENCES_DIR, name);
  try {
    const previous = readCatalog(file);
    const previousSync = previous[key];
    // 网关旧版没有同步元数据；其 generatedAt 只在实时拉取成功时写入。
    const legacySuccessAt = gateway && !previousSync && Array.isArray(previous.models) ? previous.generatedAt : null;
    const lastSuccessAt = previousSync?.lastSuccessAt ??
      (previousSync?.success ? previousSync.attemptedAt : legacySuccessAt) ?? null;
    const attemptedAt = new Date().toISOString();
    let result;
    let error = null;
    try {
      result = gateway ? await refreshGateway() : await refreshSdk(fallbackOnly);
    } catch (failure) {
      error = failure.message;
    }
    const generatedAt = new Date().toISOString();
    const success = Boolean(result?.models);
    const sync = {
      success,
      skipped: Boolean(result?.skipReason),
      skipReason: result?.skipReason ?? null,
      error,
      upstreamCount: result?.models?.length ?? 0,
      attemptedAt,
      lastSuccessAt: success ? generatedAt : lastSuccessAt,
    };
    const catalog = gateway ? {
      source: 'gateway',
      baseURL: result?.baseURL ?? previous.baseURL ?? null,
      models: result?.models ?? previous.models ?? [],
    } : { models: buildSdkModels(previous.models, result?.models) };
    writeFileSync(file, `${JSON.stringify({ generatedAt, [key]: sync, ...catalog }, null, 2)}\n`, 'utf8');
    const message = success ? `同步成功（${sync.upstreamCount} 个模型）` :
      sync.skipped ? `跳过：${sync.skipReason}` : `同步失败：${sync.error}`;
    console[error ? 'warn' : 'log'](`[update] ${name} ${message}`);
  } catch (error) {
    throw new Error(`${name} 读写失败：${error.code ?? '文件错误'}。`);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    target: { type: 'string', default: 'all' },
    'fallback-only': { type: 'boolean', default: false },
  } });
  const { target, 'fallback-only': fallbackOnly } = values;
  if (!['gateway', 'sdk', 'all'].includes(target)) throw new Error('--target 必须为 gateway、sdk 或 all。');
  if (fallbackOnly && target === 'gateway') throw new Error('--fallback-only 不支持 --target gateway。');

  const sides = fallbackOnly ? ['sdk'] : target === 'all' ? ['gateway', 'sdk'] : [target];
  const results = await Promise.allSettled(sides.map((side) => updateCatalog(side, fallbackOnly)));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`[update] ${result.reason.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(`[update] ${error.code ?? error.message} 用法：update_models.mjs [--target gateway|sdk|all] [--fallback-only]`);
  process.exitCode = 1;
});
