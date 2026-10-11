# 生视频（Seedance）— 调用与 Prompt 范式

SDK：`coze-coding-dev-sdk`（多模态参考需 >= 0.7.24），仅后端使用。返回的视频 URL 已托管在对象存储，直接使用。

## 模型

| 模型 ID | 能力 |
| --- | --- |
| `doubao-seedance-2-0-260128`（默认） | 文生视频、首尾帧、多模态参考（参考图 0-9 / 参考视频 0-3 / 参考音频 0-3）、视频编辑与延长、同步生成音频 |

以 `references/models.json` 的 `video` 组为准（2026-09-29 核对：SDK 官方文档与 Coze Model Hub registry 仅含 Seedance 2.0，网关 /v1/models 实测 video 组亦仅 Seedance 2.0；旧模型 `doubao-seedance-1-0-pro-250528` 已不在当前可用清单）。

## API 签名

```typescript
import { VideoGenerationClient, Config } from 'coze-coding-dev-sdk';

const client = new VideoGenerationClient();

const response = await client.videoGeneration(
  contentItems, // Content[]，见下方三种场景
  {
    model: 'doubao-seedance-2-0-260128',
    duration: 5,           // 秒，4-12（-1 智能选择）
    ratio: '16:9',         // '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive'
    resolution: '720p',    // '480p' | '720p' | '1080p'
    generateAudio: true,   // 同步生成音频；静默视频设 false
    watermark: true,
    camerafixed: false,    // true 固定机位
    seed: 12345,           // 可选，复现结果
    maxWaitTime: 900,      // 轮询最长等待秒数
    returnLastFrame: false, // true 时返回 lastFrameUrl（用于连续分段）
  }
);

response.videoUrl;      // string | null
response.lastFrameUrl;  // 尾帧图 URL（returnLastFrame: true 时）
response.response.status; // 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
response.response.error_message; // 失败原因
```

`Content` 类型（三种场景互斥，SDK 客户端校验，违例抛 400）：

```typescript
type Content = TextContent | ImageURLContent | VideoURLContent | AudioURLContent;

interface TextContent   { type: 'text'; text: string; }
interface ImageURLContent {
  type: 'image_url';
  image_url: { url: string };
  role?: 'first_frame' | 'last_frame' | 'reference_image';
}
interface VideoURLContent { type: 'video_url'; video_url: { url: string }; role?: 'reference_video'; }
interface AudioURLContent { type: 'audio_url'; audio_url: { url: string }; role?: 'reference_audio'; }
```

### 三种场景与互斥规则

| 场景 | content 组成 | 支持模型 |
| --- | --- | --- |
| 文生视频 | 仅 TextContent | 全部 |
| 首尾帧图生视频 | `role: 'first_frame'`（≤1）+ 可选 `role: 'last_frame'`（≤1，须配首帧）+ Text | 全部 |
| 多模态参考 | `reference_image`（0-9）+ `reference_video`（0-3）+ `reference_audio`（0-3）+ Text | 仅 `doubao-seedance-2-0-260128` |

- 不可混用首尾帧与 reference_*；多模态参考至少含 1 张参考图或 1 个参考视频（纯音频不允许）。
- 近似"首尾帧 + 参考素材"：用多模态场景，在 prompt 里指定"首帧使用图片1，尾帧使用图片2"；要严格保证首尾帧则用首尾帧场景。
- 素材在 prompt 中按下标引用：参考图/视频/音频按出现顺序编号为"图片1、图片2…视频1…音频1…"。

多模态参考示例（官方）：

```typescript
const content: Content[] = [
  { type: 'text',
    text: '全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。' +
          '第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；' +
          '首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果……尾帧定格为图片2。' },
  { type: 'image_url', image_url: { url: 'https://example.com/pic1.jpg' }, role: 'reference_image' },
  { type: 'image_url', image_url: { url: 'https://example.com/pic2.jpg' }, role: 'reference_image' },
  { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
  { type: 'audio_url', audio_url: { url: 'https://example.com/bgm.mp3' }, role: 'reference_audio' },
];
```

## 官方 Prompt 范式（对齐火山引擎《Seedance 提示词指南》）

### 文生视频公式

```text
主体 + 动作 + 背景 + 镜头语言 + 光影氛围
```

- **主体**：给出完整视觉档案——种族/性别/年龄、外貌、服饰、配饰、表情。多主体时分行为写，可命名（如"女孩 A"）。
- **动作**：包含时间、空间、力度；多动作按 `主体1+运动1+运动2` 或 `主体1+运动1+主体2+运动2` 结构。
- **环境**：宏观（城市/山林/海边）+ 中观（客厅/教室/甲板）+ 微观（咖啡杯上的热气）。
- **镜头语言**：用专业运镜术语（推/拉/摇/移/跟/升降、航拍俯拍、手持晃动、超广角/鱼眼、长焦特写）。
- **光影氛围**：柔和晨光、金色黄昏、霓虹夜景、赛博朋克等。

示例：

```text
一位身着黑色皮衣的短发女孩骑摩托车穿过霓虹闪烁的雨夜街道，
镜头从低角度仰拍逐渐拉远并跟随，霓虹灯在湿漉漉的路面上形成反光，电影感强对比光。
```

### 图生视频公式

```text
主体 + 运动，背景 + 运动，镜头 + 运动
```

- **简单直接**：提示词聚焦"什么在动、怎么动、镜头怎么动"，复杂堆砌反而降低效果。
- **特征描述具体**：明确主体的外貌、动作幅度与速度。
- **遵从图片**：不与图片内容事实冲突（如静态人物照片就不要写"奔跑中的女孩"）；想改事实应先编辑图片。
- 首尾帧场景：prompt 描述两帧之间的过渡过程。
- 多模态参考场景：明确每个素材的用途（"使用视频1的第一视角构图"、"使用音频1作为背景音乐"、"首帧为图片1"）。
- 注意：Seedance 1.0 不响应负向提示词（"不要出现 XX"不生效）；1.5+/2.x 时代可将质量约束作为正向描述（"画面稳定无畸变、主体不变形"）。

### 质量控制（2.x 适用）

在 prompt 末尾补充正向质量约束：`画面稳定、细节清晰、主体特征一致、无文字水印、无畸变闪烁`。

## 注意事项

- 用户上传的参考图/视频/音频先转存对象存储再传 URL。
- `duration` 有效范围 4-12 秒（-1 智能选择），不要传 15 等越界值。
- 连续多段视频保持一致性：`returnLastFrame: true` 取尾帧，作为下一段的 `first_frame`。
- 批量生成用顺序或并发池（Promise.all + 分批）；长任务依赖 `maxWaitTime`，默认 900s。
- 请求头转发：`new VideoGenerationClient(config, HeaderUtils.extractForwardHeaders(request.headers))`。
