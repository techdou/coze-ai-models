---
name: coze-ai-models
description: 适配与调用 coze-coding-dev-sdk 全部 AI 模型能力：LLM 对话/流式/视觉理解、生图（Seedream）、生视频（Seedance 含首尾帧与多模态参考）、TTS 语音合成、ASR 语音识别、Embedding 向量化；内置模型清单、真实 API 签名与官方 prompt 范式，并附同步脚本实时拉取 SDK 最新模型。当用户要求生成图片/视频/语音、语音转文字、向量化/语义检索/RAG、模型选型或调用报错排障，或提到 Seedream/Seedance/Doubao/GLM 等模型 ID 时使用。
---

# Coze AI Models — SDK 模型适配与调用参考

## 任务目标

帮 Agent 在涉及 `coze-coding-dev-sdk` 的任务里做对三件事：

1. **选对模型**：按模态与场景从 `references/models.json` 选模型（默认模型已标注）。
2. **写对调用**：按 references 中的 API 签名（已对照 SDK 类型定义核实）与官方 prompt 范式生成代码，不虚构参数。
3. **跟上变化**：清单过时或缺模型时运行同步脚本，而不是编造模型 ID。

## 连接配置（先读取）

- Node.js 22+；网关配置统一通过 `scripts/config.mjs` 的 `loadConfig()` 读取。逐字段优先使用本技能目录 `.env` 中的非空值，其次使用进程环境变量；不依赖当前工作目录，不修改系统环境变量。
- 字段为 `COZE_MODELS_BASE_URL` 和 `COZE_MODELS_API_KEY`，模板见 `.env.example`。根地址自动补 `/v1`，已带 `/v1` 的地址不重复追加。两项均未配置才走原有 Coze SDK 路径；只配置一项则报错。
- 配置网关时使用 OpenAI 兼容协议：`const config = loadConfig(); const client = new OpenAI(config);`。先加载配置，再创建客户端；配置仅限服务端。其他语言也遵守相同字段和优先级。
- 网关 Key 不可作为 Coze 官方开发者凭证使用。现有 references 中的 `coze-coding-dev-sdk` 示例用于直连 Coze；网关调用应对照其 `/docs`，不能直接套用 SDK 的客户端或请求参数。
- 运行 `scripts/update_models.mjs`：配置网关时 GET `/v1/models`，保存 `references/gateway-models.json`；无网关配置时才调用 SDK `listModels()`。网关失败时报错并保留旧清单，不切换到官方接口。`--fallback-only` 仍仅更新原有静态清单。
- 网关模式下可用模型 ID 以 `gateway-models.json` 为准；列表仅确认 ID，不证明模态或功能支持。原 `models.json` 的静态基线不代表此 Key 的可用权限。
- `.env` 含密钥：不得打印、提交或打入 `.skill` 包；分享时只包含 `.env.example`。`.gitignore` 已忽略本地配置，但打包工具未必遵守它，打包时显式排除。
- 验证配置：`node --test tests/config.test.mjs`；只读连通性验证：`node scripts/update_models.mjs`。

## 何时使用

- 生成图片/海报/头像/Logo，"画一张/组图/多图一致性"类需求
- 生成视频、图生视频、首尾帧、多素材参考视频（"图片1/音频1"式素材引用）
- TTS 配音/口播/朗读/SSML/选音色；ASR 语音转文字
- 文本/图片/视频向量化、语义检索、RAG 入库与召回
- LLM 对话、流式输出、思考模式、图片/视频理解
- 用户点名模型 ID（如 `doubao-seedream-5-0-260128`）或问"有哪些模型可用"
- 模型调用报 400/403/model not found/参数校验失败的排障

## 决策路由表

| 需求 | 读这个文件 | 默认模型 |
| --- | --- | --- |
| 对话/推理/写作/视觉理解（图+视频输入） | `references/llm-guide.md` | `doubao-seed-2-0-pro-260215` |
| 生图（文生图/图生图编辑/组图） | `references/image-generation.md` | `doubao-seedream-5-0-260128` |
| 生视频（文生/首尾帧/多模态参考） | `references/video-generation.md` | `doubao-seedance-2-0-260128` |
| TTS 合成 / ASR 识别 | `references/audio-tts-asr.md` | TTS 默认音色 `zh_female_xiaohe_uranus_bigtts` |
| 向量化/检索/RAG | `references/embedding-guide.md` | `doubao-embedding-vision-251215` |
| 各模态当前可用模型清单 | `references/models.json` | — |

## 何时运行同步脚本

`references/models.json` 由 `scripts/update_models.mjs` 维护。以下情况**先跑一次再选型**：

1. 用户提到的模型不在 models.json 中（可能为上游新增）。
2. models.json 的 `generatedAt` 距今超过 7 天，且当前环境具备开发者凭证。
3. 调用报"model not found / 无权限"类错误时，刷新确认模型是否下线或改名。

运行方式（在项目根目录）：

```bash
node coze-ai-models/scripts/update_models.mjs                 # 优先实时同步，失败自动回退
node coze-ai-models/scripts/update_models.mjs --fallback-only # 无凭证/离线环境仅用静态基线
```

- 脚本始终 exit 0；成败看输出与 models.json 的 `sdkSync` 字段。
- 实时同步需 Coze 开发者凭证（CLI 登录）；无凭证环境自动回退静态基线，且不会覆盖历史同步成功的数据。

## models.json 结构

```jsonc
{
  "generatedAt": "2026-09-04T…",   // 最后写入时间
  "sdkSync": {                     // 最近一次同步状态
    "success": true,               // 本次是否实时拉取成功
    "skipped": false,              // 是否 --fallback-only 跳过实时同步
    "lastSuccessAt": null,         // 最近一次实时成功时间
    "upstreamCount": 0,            // 上游返回的模型数
    "error": null                  // 本次失败原因（成功为 null）
  },
  "models": { "llm": [], "vision": [], "image": [], "video": [], "tts": {}, "embedding": [] }
}
```

- 条目带 `source: 'static'`（静态基线）或 `'upstream'`（SDK 实时同步）；判断清单新鲜度看 `source` + `sdkSync`。

## 操作步骤

1. 按决策路由表打开对应 reference，读"模型能力表 + 参数边界"后再写代码；拿不准模型是否可用 → 先跑同步脚本。
2. 生图/生视频 prompt 按 references 中的官方范式撰写：文生图 = 主体+行为+环境+风格光影（文字内容加双引号，≤300 汉字）；文生视频 = 主体+动作+背景+镜头语言+光影；图生视频 = 主体+运动，背景+运动，镜头+运动。
3. 用户上传的参考素材先转对象存储再传 URL；跨模态组合需求（先生图再图生视频、配乐配音）按序串联对应 reference 的管线。
4. 排障顺序：对照 reference 的参数边界检查传参 → 查 models.json 是否缺该模型 → 跑同步脚本 → 把上游错误脱敏透传给用户。

## 资源索引

- `references/models.json`：选模型前先查；含各模态清单、默认模型、`source` 与同步状态
- `references/llm-guide.md`：LLM invoke/stream、思考模式、视觉理解消息结构、请求头转发
- `references/image-generation.md`：生图 API 签名、size 校验规则与静默回退、组图、官方 Seedream prompt 范式
- `references/video-generation.md`：生视频三场景与互斥规则、素材引用、返回结构、官方 Seedance prompt 范式
- `references/audio-tts-asr.md`：TTS 传参/SSML/音色清单、ASR 输入方式与时长大小限制
- `references/embedding-guide.md`：向量化方法签名、dimensions、多模态联合向量、RAG 入库检索流程
- `scripts/update_models.mjs`：模型清单同步脚本（用法见"何时运行同步脚本"）

## 注意事项

- SDK 仅服务端可用；Next.js 中转发请求头统一用 `new XxxClient(config, HeaderUtils.extractForwardHeaders(request.headers))`（各 reference 有示例，SDK >= 0.7.10）。
- LLM 交互类需求一律走 `client.stream()`（流式优先）；`invoke` 只用于后台批处理。
- TTS 的 `uid` 必填；生图非法 size 会被 SDK 静默回退 2K（不报错）；Seedance 首尾帧与多模态参考互斥，且多模态参考仅 2.0 支持。
- 模型能力与参数档位以 models.json 和上游实际返回为准，禁止编造模型 ID。
- 维护本 skill：修改后运行 `node --check scripts/update_models.mjs` 与官方 quick_validate.py，并重新打包 `.skill`。
