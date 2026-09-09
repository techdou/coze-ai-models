# Embedding — 向量化与语义检索

SDK：`coze-coding-dev-sdk`，仅后端使用。适用：语义搜索、聚类、推荐、RAG 检索召回、多模态检索。

## 模型

| 模型 ID | 说明 |
| --- | --- |
| `doubao-embedding-vision-251215` | 默认模型，文本/图片/视频多模态向量化 |

以 `references/models.json` 的 `embedding` 组为准。

## API 签名（以 SDK 类型定义为准）

```typescript
import { EmbeddingClient, Config } from 'coze-coding-dev-sdk';

const client = new EmbeddingClient();
```

### embedText / embedTexts — 文本向量化

```typescript
// 位置参数：直接返回向量（不是 { data } 包装）
const vector: number[] = await client.embedText('Coze 是一站式 AI 开发平台', {
  dimensions: 2048, // 可选；省略用模型默认
  instructions: '根据标题和摘要判断新闻话题类别', // 可选：生成指引，提升检索场景效果
});

// 多条文本
const vectors = await client.embedTexts(['新闻一：……', '新闻二：……'], {
  instructions: '按语义相似性聚类',
});
```

### embedImage / embedImages / embedVideo / embedVideos — 多模态向量化

```typescript
const imgVec: number[] = await client.embedImage('https://example.com/photo.jpg', {
  instructions: '将图片转换为可用于跨模态检索的向量',
});
const vidVec: number[] = await client.embedVideo('https://example.com/clip.mp4');
// 复数版本：embedImages(urls, options) / embedVideos(urls, options)
```

### embedMultimodal — 图文/视频组合向量化

```typescript
// 三个位置参数（数组可分别留空），返回 EmbeddingResponse
const res = await client.embedMultimodal(
  ['海边日落'],                 // texts
  ['https://example.com/sun.jpg'], // imageUrls
  [],                            // videoUrls
  { dimensions: 1024 }
);
const embedding = res.data?.embedding; // 单条向量：number[]
```

### 批量与高级

```typescript
// 批量多组文本（带并发控制）
const batchVectors = await client.batchEmbed(
  [['doc-1a', 'doc-1b'], ['doc-2a']], // string[][]
  { dimensions: 2048 },
  3 // maxConcurrent
);

// 多向量输出（一段文本拆成多个向量，适合长文分段检索）
const multiVecs: number[][] | undefined = await client.embedWithMultiVectors('长文本……');

// 稀疏向量（关键词精确匹配，与稠密向量做混合检索）
const sparse = await client.embedWithSparse('短文本');
```

### 余弦相似度

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

## 选型与 dims

- 纯文本知识库 → `embedText/embedTexts`；图片素材库 → `embedImage`；跨模态"以文搜图" → 文本与图片用同模型、同 `dimensions` 向量化。
- `dimensions` 越大精度越高、存储越贵；RAG 常用 1024/2048。
- 同一索引内所有向量必须同模型、同 `dimensions`，混用会语义错乱。

## RAG 标准流程

1. 文档切分（按段落/语义，避免超长）→ 2. 入库：`embedTexts` + 向量库 → 3. 查询：`embedText(query)` → 4. 余弦相似度 Top-K → 5. 结果作为上下文交给 LLM 生成。

## 注意事项

- 本地文件（图片/视频/音频）先上传对象存储获取 URL，再传 URL 给 SDK。
- Next.js 中转发请求头：`new EmbeddingClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers))`。
- 错误处理：SDK 失败时抛出异常（读 `err.message`），用 `try/catch` 包裹；不要自行猜测返回错误字段。
