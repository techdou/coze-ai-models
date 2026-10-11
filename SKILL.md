---
name: coze-ai-models
description: 通过 Coze 模型网关（OpenAI 兼容）与 coze-coding-dev-sdk 调用全部 AI 模型能力，附一套实测通过的调用脚本（chat/image_generate/video_generate/tts/asr/embed），内置重试、超时、容错轮询与模型清单同步。覆盖 LLM 对话/流式/视觉理解、生图（Seedream）、生视频（Seedance 2.0 文生/首尾帧/多模态参考）、TTS 语音合成、ASR 语音识别、Embedding 向量化、模型选型与调用报错排障。当用户要求生成图片/视频/语音、语音转文字、向量化/语义检索/RAG、使用 Coze 网关或 Model Hub，或提到 Seedream/Seedance/Doubao/GLM 等模型 ID 时使用。
metadata:
  version: "0.2.0"
---

# Coze AI Models — 网关模型调用（脚本工具箱 + SDK 参考）

## 任务目标

帮 Agent 在涉及 `coze-coding-dev-sdk` 与 Coze 模型网关的任务里做对三件事：

1. **选对模型**：按模态与场景从 `references/models.json` 选模型（默认模型已标注）。
2. **用对工具**：优先调用 `scripts/` 下已实测的脚本，而不是手写 fetch。
3. **跟上变化**：清单过时或缺模型时运行同步脚本，而不是编造模型 ID。

## 连接配置（先读取）

- Node.js 22+；网关配置统一通过 `scripts/config.mjs` 的 `loadConfig()` 读取。逐字段优先使用本技能目录 `.env` 中的非空值，其次使用进程环境变量；不依赖当前工作目录，不修改系统环境变量。
- 字段为 `COZE_MODELS_BASE_URL` 和 `COZE_MODELS_API_KEY`，模板见 `.env.example`。根地址自动补 `/v1`，已带 `/v1` 的地址不重复追加。两项均未配置才走原有 Coze SDK 路径；只配置一项则报错。
- 配置网关时使用 OpenAI 兼容协议：`const config = loadConfig(); const client = new OpenAI(config);`。先加载配置，再创建客户端；配置仅限服务端。其他语言也遵守相同字段和优先级。
- 网关 Key 不可作为 Coze 官方开发者凭证使用。现有 references 中的 `coze-coding-dev-sdk` 示例用于直连 Coze；网关调用应对照其 `/docs`，不能直接套用 SDK 的客户端或请求参数。
- 验证配置与脚本鲁棒性：`node --test tests/`（config 6 项 + scripts 离线鲁棒性 5 项，零 API 消耗）；只读连通性验证：`node scripts/update_models.mjs`。

## 调用脚本（已实测，优先使用）

`scripts/` 下有一套**全部实测通过**的网关调用脚本，内置稳定性机制：指数退避重试（仅网络错误/429/5xx；4xx 参数错误不重试）、独立超时、任务类容错轮询、下载重试、密钥不落日志。**能调脚本就不要手写 fetch**；脚本不支持的能力（首尾帧、多模态参考等）再按 references 手写，并优先贡献回本 skill。

| 需求 | 脚本 | 默认模型 |
| --- | --- | --- |
| LLM 对话/推理（流式由 SDK 承担，脚本为同步问答） | `scripts/chat.mjs --prompt "..." [--image 图片URL] [--video 视频URL] [--json]` | `doubao-seed-2-0-pro-260215` |
| 生图 | `scripts/image_generate.mjs --prompt "..." [--size 2K] [--out out.png]` | `doubao-seedream-5-0-260128` |
| 生视频（文生） | `scripts/video_generate.mjs --prompt "..." [--duration 8] [--resolution 720p] [--out v.mp4]` | `doubao-seedance-2-0-260128` |
| TTS 合成 | `scripts/tts.mjs --input "文本" [--voice zh_female_xiaohe_uranus_bigtts] [--out a.mp3]` | `doubao-tts` |
| ASR 识别 | `scripts/asr.mjs --file audio.mp3` | `doubao-asr` |
| 向量化 | `scripts/embed.mjs --input "文本"` | `doubao-embedding-vision-251215` |

所有脚本输出 JSON 到 stdout、错误到 stderr（含网关返回体）、退出码 0/1。公共库 `scripts/gateway.mjs` 提供 `gateway()/fail()/parseArgs()/downloadTo()`，写新脚本时基于它。

**实测参数边界（2026-10-09，网关 https://models.coze.site）**：

- 视频：`POST /videos/generations` 返回 `202 {id, status: queued}`，`GET /videos/generations/{id}` 轮询至 `succeeded/failed/cancelled`，成功后取 `video_url` 下载；**chat 端点不收视频模型**（报 not available for chat）；视频默认带「AI生成」合规角标（watermark 无法关闭）；8s 720p 实测约 8 分钟完成。
- 生图：**custom size 必须在 2560x1440 ~ 4096x4096**（传 1024x1024 会 400）；用预设档 `2K` 等最稳。同步返回 `data[].url`，脚本已自动下载。**`n>1` 实测仍只返回 1 张**（网关/上游收窄，2026-10-11 复测），多图需求请多次调用；脚本的多图序号保存为防御逻辑。
- ASR：body 为 JSON（非 multipart），音频字段名是 **`base64`**（纯 base64 串）或 **`url`**（http[s] URL）；`data:` URL、`audio`、`file`、`input_audio` 等形态均报 "url or base64 is required"。
- TTS：`/audio/speech` 直接返回 mp3 二进制（ID3 帧头），不是 JSON。
- Embedding：标准 OpenAI `/embeddings` 格式，`doubao-embedding-vision-251215` 输出 2048 维。
- 视觉理解：`image_url.url` **仅支持 http/https**，`data:` URL 会 400——本地图片必须先上传对象存储；视频理解走 `video_url`（脚本 `--video`）；**外网素材（如 Wikimedia）上游拉取常 504 超时，素材务必先上传 coze 对象存储**（coze tos 的 URL 实测秒过）。
- 网络偶发瞬断（ConnectTimeout/10060）：脚本已内置跳过重试；长任务轮询失败可重跑，任务在服务端不丢。

## 深读 references（脚本不覆盖的高级能力时）

脚本未覆盖首尾帧、多模态参考（reference_image/video/audio）、流式输出、思考模式、SSML 等高级能力；需要时按需求读对应 reference，参数以 references 各文件为准：

| 需求 | 读这个文件 | 默认模型 |
| --- | --- | --- |
| 对话/流式/思考模式/视觉理解（图+视频输入） | `references/llm-guide.md` | `doubao-seed-2-0-pro-260215` |
| 生图（组图/编辑/size 校验细节） | `references/image-generation.md` | `doubao-seedream-5-0-260128` |
| 生视频（首尾帧/多模态参考/连续分段） | `references/video-generation.md` | `doubao-seedance-2-0-260128` |
| TTS SSML/音色清单、ASR 限制 | `references/audio-tts-asr.md` | TTS 默认音色 `zh_female_xiaohe_uranus_bigtts` |
| 向量化方法签名/多模态联合向量/RAG | `references/embedding-guide.md` | `doubao-embedding-vision-251215` |

生图/生视频 prompt 按官方范式撰写：文生图 = 主体+行为+环境+风格光影（文字内容加双引号，≤300 汉字）；文生视频 = 主体+动作+背景+镜头语言+光影氛围，末尾追加正向质量约束「画面稳定无畸变、细节清晰、无文字水印」；图生视频 = 主体+运动，背景+运动，镜头+运动。用户上传的参考素材先转对象存储再传 URL。

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

## 操作步骤

1. **先查上方「调用脚本」表**：需求被脚本覆盖 → 直接调脚本（这是最快、最稳的路径）。
2. 脚本不覆盖的能力（首尾帧、多模态参考、流式等）→ 按需求读对应 reference，拿准"模型能力表 + 参数边界"后再写代码；拿不准模型是否可用 → 先跑同步脚本。
3. 生图/生视频 prompt 按 references 中的官方范式撰写。
4. 用户上传的参考素材先转对象存储再传 URL；跨模态组合需求（先生图再图生视频、配乐配音）按序串联对应管线。
5. 排障顺序：对照 reference 的参数边界检查传参 → 查 models.json 是否缺该模型 → 跑同步脚本 → 把上游错误脱敏透传给用户。

## 资源索引

- `references/models.json`：选模型前先查；含各模态清单、默认模型、`source` 与同步状态
- `references/llm-guide.md`：LLM invoke/stream、思考模式、视觉理解消息结构、请求头转发
- `references/image-generation.md`：生图 API 签名、size 校验规则与静默回退、组图、官方 Seedream prompt 范式
- `references/video-generation.md`：生视频三场景与互斥规则、素材引用、返回结构、官方 Seedance prompt 范式
- `references/audio-tts-asr.md`：TTS 传参/SSML/音色清单、ASR 输入方式与时长大小限制
- `references/embedding-guide.md`：向量化方法签名、dimensions、多模态联合向量、RAG 入库检索流程

## 注意事项

- SDK 仅服务端可用；Next.js 中转发请求头统一用 `new XxxClient(config, HeaderUtils.extractForwardHeaders(request.headers))`（各 reference 有示例，SDK >= 0.7.10）。
- LLM 交互类需求一律走 `client.stream()`（流式优先）；`invoke` 只用于后台批处理。
- TTS 的 `uid` 必填；生图非法 size 会被 SDK 静默回退 2K（不报错）；Seedance 首尾帧与多模态参考互斥，且多模态参考仅 2.0 支持。
- 模型能力与参数档位以 models.json 和上游实际返回为准，禁止编造模型 ID。
- `.env` 含密钥：不得打印、提交或打入 `.skill` 包；分享时只包含 `.env.example`。`.gitignore` 已忽略本地配置，但打包工具未必遵守它，打包时显式排除。
- 维护本 skill：修改脚本后运行 `node --check scripts/*.mjs` 与 `node --test tests/`；新增/修改调用方式须先在网关上实测验证并把参数边界回写进「调用脚本」章节，禁止凭猜测更新文档。
