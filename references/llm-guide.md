# LLM — 文本生成与视觉理解

SDK：`coze-coding-dev-sdk`，仅后端使用。适用：对话、写作、推理、结构化输出、**视觉理解（图片/视频输入）**。

## 模型

默认 `doubao-seed-2-0-pro-260215`（SDK 内置默认）。完整清单以 `references/models.json` 的 `llm` / `vision` 组为准（可用更新脚本刷新，来源 Coze 上游实时同步 + 静态基线）。

常见模型：`doubao-seed-2-0-pro/lite/mini-260215`、`glm-4-7-251222`。选型：复杂推理/长上下文/多模态理解 → pro；成本/速度优先 → lite/mini。

## API 签名

```typescript
import { LLMClient, Config } from 'coze-coding-dev-sdk';

const client = new LLMClient();

// 一次性生成（非流式）
const response = await client.invoke(
  [
    { role: 'system', content: '你是资深编辑' },
    { role: 'user', content: '把这句话改写得更简洁：……' },
  ],
  {
    model: 'doubao-seed-2-0-lite-260215',  // 可省略，默认 pro
    temperature: 0.7,
    thinking: 'disabled',                  // 'enabled' 开启深度思考（耗时更长）
    caching: 'disabled',                   // 'enabled' 开启会话前缀缓存
  }
);
response.content; // string
```

流式（推荐，交互类需求默认流式）：

```typescript
const stream = client.stream(messages, { model: 'doubao-seed-2-0-mini-260215' });
for await (const chunk of stream) {
  process.stdout.write(String(chunk.content)); // AIMessageChunk.content
}
```

视觉理解（消息 content 用数组形式，模型需支持对应输入模态）：

```typescript
const vision = await client.invoke([
  {
    role: 'user',
    content: [
      { type: 'text', text: '这张图里有什么？' },
      { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } },
      // 视频理解：{ type: 'video_url', video_url: { url: 'https://example.com/clip.mp4' } }
    ],
  },
]);
```

## Next.js 中转发请求头

```typescript
import { HeaderUtils } from 'coze-coding-dev-sdk';
const headers = HeaderUtils.extractForwardHeaders(request.headers);
const client = new LLMClient(new Config(), headers);
```

## 注意事项

- 模型能力以 Coze 上游实际返回为准，禁止虚构模型 ID；发现清单里没有的模型先跑更新脚本。
- 消息结构：`role` 取 `system | user | assistant`；通常以一条 system 定角色，后接 user/assistant 多轮。
- 交互式产品一律走 `stream`；`invoke` 用于后台批处理。
- 流式循环体内不要做重计算，逐 chunk 直接下发给前端（SSE）。
