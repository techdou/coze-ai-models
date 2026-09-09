# 生图（Seedream）— 调用与 Prompt 范式

SDK：`coze-coding-dev-sdk`，仅后端使用。返回的图片 URL 已托管在对象存储，直接使用，勿重复转存。

## 模型

| 模型 ID | 说明 |
| --- | --- |
| `doubao-seedream-5-0-260128` | 默认模型，旗舰质量 |
| `doubao-seedream-4-5-251128` | 上一代，速度更快 |

以 `references/models.json` 的 `image` 组为准（可用更新脚本刷新）。

## API 签名

```typescript
import { ImageGenerationClient, Config } from 'coze-coding-dev-sdk';

const client = new ImageGenerationClient();

const response = await client.generate({
  prompt: '画一只猫',
  model: 'doubao-seedream-5-0-260128',
  size: '2K',                    // '2K' | '4K' | 'WIDTHxHEIGHT'（2560x1440 至 4096x4096）
  watermark: false,
  responseFormat: 'url',         // 'url' | 'b64_json'
  optimizePromptMode: 'auto',    // 'auto' | 'required' | 'disabled'（简短 prompt 建议 'required'）
  image: [                       // 可选：参考图 URL 数组（图生图），多图输入时顺序对应"图一/图二/图三"
    'https://example.com/ref1.png',
  ],
  sequentialImageGeneration: 'disabled', // 'auto' | 'disabled'：组图模式
  // sequentialImageGeneration: 'auto' 时可配 maxImages: 1-15
});
```

批量：

```typescript
const batch = await client.batchGenerate([
  { prompt: '描述 A', size: '2K' },
  { prompt: '描述 B', size: '2K' },
]);
```

响应统一用 helper 解析：

```typescript
import { getResponseHelper } from 'coze-coding-dev-sdk';

const helper = getResponseHelper(response);
if (helper.success) {
  helper.imageUrls;   // string[]（responseFormat: 'url' 时）
  helper.imageB64List; // string[]（responseFormat: 'b64_json' 时）
} else {
  helper.errorMessages; // string[]
}
```

Next.js 中转发请求头（SDK >= 0.7.10，headers 是构造函数第二参数，不接受 `{ customHeaders }` 写法）：

```typescript
import { HeaderUtils } from 'coze-coding-dev-sdk';
const client = new ImageGenerationClient(config, HeaderUtils.extractForwardHeaders(request.headers));
```

### size 校验规则（SDK 源码实锤，勿凭记忆编造档位）

- 预设档位只有 `'2K'`（默认）与 `'4K'`，经 SDK 传 `'1K'` 等其他档位无效。
- 自定义 `'WIDTHxHEIGHT'`（正整数）：总像素须在 3,686,400（2560x1440）至 16,777,216（4096x4096）之间，宽高比 1:16 ~ 16:1。
- **非法 size 不会报错，而是被静默回退为默认 `'2K'`**——用户明确要求特定尺寸时务必先校验再传参。
- 字段默认值：`size: '2K'`、`watermark: true`、`responseFormat: 'url'`、`optimizePromptMode: 'standard'`、`sequentialImageGeneration: 'disabled'`（组图最大 15 张）。

## 官方 Prompt 范式（对齐火山引擎《Seedream 4.0-5.0 提示词指南》）

### 通用规则

- **结构**：自然语言清晰描述 `主体 + 行为 + 环境`，再补充 `风格、色彩、光影、构图、氛围`。
- **明确用途**：写明应用场景（海报、表情包、贴纸、头像、周边、包装等），模型会匹配相应设计规范与文字排版。
- **精准风格词**：用具体明确的风格描述或参考图（摄影风格 / 艺术风格 / 设计风格），避免模糊表述。
- **文字内容必须加双引号**：需要图中出现的文字（如产品名、标题、乐谱）用 `""` 包裹；生成中文文字建议放在 prompt 前半段。
- **长度**：不超过 300 汉字 / 600 英文单词；过长的 prompt 应精简或分拆多次生成。

### 场景范式

**1. 文生图（4.5 / 5.0 lite 等快速模型）**：简洁精确的 prompt 优于冗长堆砌，聚焦主体、动作、场景即可，不必像传统模型那样堆砌大量风格词。示例：

```text
A cozy coffee shop interior, warm morning light through large windows,
a barista latte-art at the wooden counter, plants on shelves, shot on 35mm film
```

**2. 图生图 · 编辑**：明确指示编辑对象与变化，简洁优于复杂描述；复杂画面用箭头/线框/涂鸦标注要修改的位置与内容。示例：

```text
为图中女孩画上酒红色的巫师帽，背景改为万圣节的南瓜庄园，整体色调变暗
```

**3. 图生图 · 参考图**：明确"参考什么"（人物形象、产品材质、风格）+ "做什么"（新场景/新动作）。示例：

```text
参考图中人物的形象与服装，生成她在樱花树下回眸一笑的照片
```

**4. 多图输入组合**：prompt 中用"图一/图二/图三"指代 `image` 数组顺序。示例：

```text
用图一的人物替换图二中的服务员，并参考图三的电影风格进行调色
```

**5. 多图输出（组图）**：用"一系列/一套/组图"或具体数字触发，配合 `sequentialImageGeneration: 'auto'` + `maxImages`。示例：

```text
生成一套 4 张的春天系列插画：桃花、新芽、燕子、细雨，统一的淡青色调与留白构图
```

## 注意事项

- 本地文件先上传对象存储获取 URL，再把 URL 传给 `image`。
- 需要画面中带文字时，把要显示的精确文字放入 `""`，并考虑构图留白；不要指望模型自动排版长文案。
- 简短 prompt（< 10 词）建议 `optimizePromptMode: 'required'`，让模型先扩写。
- 参数越界（size 超出 2560x1440~4096x4096）会报错，动态尺寸先做范围校验。
