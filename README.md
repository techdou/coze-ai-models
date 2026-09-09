# coze-ai-models

一个 Claude Code / ZCode 等 agent 技能（skill）：适配并调用 Coze 平台全部 AI 模型能力——LLM 对话/流式/视觉理解、生图、生视频、TTS 语音合成、ASR 语音识别、Embedding。模型选型、参数细节、各家差异全部沉淀在 `references/` 下的分域指南里，agent 按需查阅，不必每次试探 API。

## 能力分域

| 域 | 覆盖内容 | 参考文档 |
|---|---|---|
| LLM | 对话/流式/视觉理解，模型特性与选型 | `references/llm-guide.md` |
| 生图 | Seedream 系列文生图 | `references/image-generation.md` |
| 生视频 | Seedance 系列（含首尾帧、多模态参考图） | `references/video-generation.md` |
| 语音 | TTS 合成 / ASR 识别 | `references/audio-tts-asr.md` |
| 向量 | Embedding 模型与调用 | `references/embedding-guide.md` |

`references/models.json` 为模型清单快照，可用 `scripts/update_models.mjs` 从网关刷新。

## 安装

```bash
git clone https://github.com/techdou/coze-ai-models.git ~/.agents/skills/coze-ai-models
```

克隆到你的 agent 技能目录（路径按你的环境调整，如 `.claude/skills/`、`.zcode/skills/`）。

## 配置

```bash
cp .env.example .env
```

编辑 `.env` 填入：

- `COZE_MODELS_BASE_URL` — 模型网关地址
- `COZE_MODELS_API_KEY` — 网关 API key

`.env` 已被 `.gitignore` 挡住，不会入库。

## 两条调用路径（二选一）

- **Coze 沙箱内**：走 `coze-coding-dev-sdk` 的 Client（沙箱自带凭证，无需 `.env`）。
- **本地环境**：走 OpenAI 兼容接口（读 `.env`），`base_url` 需带 `/v1` 后缀。

细节见 `SKILL.md`。

## 测试

```bash
node tests/config.test.mjs
```

## License

[MIT](LICENSE)
